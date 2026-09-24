/**
 * Un élément d'un autre serveur ne se manipule pas depuis le dashboard du sien.
 *
 * Tickets, événements, liens de serveur staff et invitations étaient pris par leur seul
 * identifiant : le staff d'un serveur pouvait fermer un ticket, publier un événement,
 * décider des rôles synchronisés ou marquer une invitation d'un autre serveur. Chaque
 * route vérifie désormais l'appartenance et répond « introuvable » sinon.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';

const HERE = 'guild-here';
const ELSEWHERE = 'guild-elsewhere';

/** Les écritures reçues, par « modèle.méthode ». */
let writes: string[] = [];

const rows: Record<string, (args: any) => unknown> = {
  // Chaque élément appartient à l'autre serveur : un filtre sur `guildId: HERE` ne le trouve pas.
  'ticket.findFirst': ({ where }) => (where.guildId === ELSEWHERE ? { id: where.id, guildId: ELSEWHERE, channelId: 'c1' } : null),
  'ticket.findUnique': ({ where }) => ({ id: where.id, guildId: ELSEWHERE, channelId: 'c1' }),
  'event.findFirst': ({ where }) => (where.guildId === ELSEWHERE ? { id: where.id } : null),
  'event.findUnique': ({ where }) => ({ id: where.id, guildId: ELSEWHERE }),
  'staffServerLink.findUnique': () => ({ id: 'link-1', mainGuildId: ELSEWHERE, staffGuildId: 'guild-staff-elsewhere' }),
  'guildInvite.findFirst': ({ where }) => (where.guildId === ELSEWHERE ? { code: where.code } : null),
};

const WRITE_METHODS = new Set(['create', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

const mockDb: any = new Proxy({}, {
  get(_target, model: string) {
    if (model === '$transaction') return async (arg: any) => (typeof arg === 'function' ? arg(mockDb) : Promise.all(arg));
    return new Proxy({}, {
      get(_t, method: string) {
        return async (args: any) => {
          const key = `${model}.${method}`;
          if (WRITE_METHODS.has(method)) {
            writes.push(key);
            return method.endsWith('Many') ? { count: 1 } : {};
          }
          const row = rows[key];
          if (row) return row(args);
          if (method === 'findMany') return [];
          if (method === 'count') return 0;
          return null;
        };
      },
    });
  },
});

for (const file of ['../../utils/db.ts', '../../utils/db.js']) {
  mock.module(path.resolve(import.meta.dir, file), () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
}

const { handleEventsRoutes } = await import('../../api/routes/dashboard/events.js');
const { handleStaffServerRoutes } = await import('../../api/routes/dashboard/staffServer.js');
const { handleInvitationsRoutes } = await import('../../api/routes/dashboard/modules/invitations.js');

function request(method: string, body: unknown = {}): any {
  const req: any = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = { 'content-type': 'application/json' };
  return req;
}

function response(): any {
  const res: any = { statusCode: 200, headersSent: false, body: '' };
  res.setHeader = () => undefined;
  res.writeHead = (status: number) => { res.statusCode = status; return res; };
  res.end = (chunk?: string) => { if (chunk) res.body += chunk; res.headersSent = true; };
  return res;
}

const user = { userId: 'staff-1', username: 'staff' } as any;
const access = { level: 'admin', canManageSettings: true, canModerateContent: true } as any;
const client: any = { guilds: { cache: new Map(), fetch: async () => null }, channels: { cache: new Map() } };

function moduleCtx(method: string, parts: string[], body?: unknown): any {
  return {
    req: request(method, body), res: response(), parts, url: new URL('http://localhost/'), client, user,
    guildId: HERE, access, method, auditUser: 'staff', moduleKey: parts[4],
  };
}

beforeEach(() => { writes = []; });

describe('accès entre serveurs', () => {
  test('un événement d\'un autre serveur ne se modifie ni ne se supprime', async () => {
    for (const [method, parts] of [
      ['PATCH', ['api', 'dashboard', 'guilds', HERE, 'events', 'event-1']],
      ['DELETE', ['api', 'dashboard', 'guilds', HERE, 'events', 'event-1']],
      ['GET', ['api', 'dashboard', 'guilds', HERE, 'events', 'event-1']],
    ] as const) {
      const res = response();
      await handleEventsRoutes(request(method, { title: 'x' }), res, [...parts], new URL('http://localhost/'), client, user, HERE, access);
      expect(res.statusCode).toBe(404);
    }
    expect(writes).toEqual([]);
  });

  test('les rôles d\'un lien staff d\'un autre serveur ne se touchent pas', async () => {
    for (const [method, parts] of [
      ['POST', ['api', 'dashboard', 'guilds', HERE, 'staff-server', 'link-1', 'mappings']],
      ['DELETE', ['api', 'dashboard', 'guilds', HERE, 'staff-server', 'link-1', 'mappings', 'map-1']],
      ['POST', ['api', 'dashboard', 'guilds', HERE, 'staff-server', 'link-1', 'sync']],
    ] as const) {
      const res = response();
      await handleStaffServerRoutes(request(method, { staffRoleId: 'r1' }), res, [...parts], new URL('http://localhost/'), client, user, HERE);
      expect(res.statusCode).toBe(404);
    }
    expect(writes).toEqual([]);
  });

  test('une invitation d\'un autre serveur ne se suspend ni ne se supprime', async () => {
    const suspend = moduleCtx('PUT', ['api', 'dashboard', 'guilds', HERE, 'invitations', 'abc123', 'suspend'], { suspended: true });
    await handleInvitationsRoutes(suspend);
    expect(suspend.res.statusCode).toBe(404);

    const remove = moduleCtx('DELETE', ['api', 'dashboard', 'guilds', HERE, 'invitations', 'abc123']);
    await handleInvitationsRoutes(remove);
    expect(remove.res.statusCode).toBe(404);
    expect(writes).toEqual([]);
  });

  // Les routes des tickets passent d'abord par la carte des droits du membre, qui interroge
  // Discord : le harnais serait plus gros que ce qu'il garde. La garde est lue sur la source,
  // comme `ticketOrphelinCablage`.
  test('chaque action sur un ticket le cherche aussi par son serveur', () => {
    const source = readFileSync(path.resolve(import.meta.dir, '../../api/routes/dashboard/modules/tickets.ts'), 'utf8');
    expect(source).not.toContain('prisma.ticket.findUnique({ where: { id: ticketId } })');
    expect(source.split('prisma.ticket.findFirst({ where: { id: ticketId, guildId } })').length - 1).toBe(9);
  });
});
