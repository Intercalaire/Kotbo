import { describe, expect, test, mock, beforeEach } from 'bun:test';
import path from 'node:path';
import { AuditLogEvent } from 'discord.js';

type PrismaArgs = Record<string, unknown>;

const mockDb = {
  auditLoggerConfig: {
    findUnique: mock((_args?: PrismaArgs): Promise<unknown> => Promise.resolve(null)),
    upsert: mock((_args: PrismaArgs): Promise<unknown> => Promise.resolve({})),
    findMany: mock((_args?: PrismaArgs): Promise<unknown[]> => Promise.resolve([])),
  },
  auditEvent: {
    create: mock((_args: PrismaArgs): Promise<unknown> => Promise.resolve({ id: 'evt-1' })),
    findMany: mock((_args?: PrismaArgs): Promise<unknown[]> => Promise.resolve([])),
    count: mock((_args?: PrismaArgs): Promise<number> => Promise.resolve(0)),
    groupBy: mock((_args?: PrismaArgs): Promise<unknown[]> => Promise.resolve([])),
    deleteMany: mock((_args: PrismaArgs): Promise<unknown> => Promise.resolve({ count: 0 })),
  },
};

const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const {
  upsertAuditConfig,
  searchAuditEvents,
  getAuditExecutors,
  resolveExecutor,
  isSameScalar,
  diffScalarFields,
  diffStringLists,
  overwriteStateMap,
  diffPermissionOverwrites,
  diffMessages,
  diffMembers,
  diffRoles,
  diffChannels,
  sanitizeAuditConfigPatch,
  buildAuditSearchWhere,
  recordAuditEvent,
  getAuditConfig,
  __resetAuditConfigCache,
  pruneOldAuditEvents,
  DEFAULT_AUDIT_CONFIG,
} = await import('../../services/analytics/auditDiffService');

beforeEach(() => {
  __resetAuditConfigCache();
  mockDb.auditEvent.create.mockClear();
  mockDb.auditEvent.deleteMany.mockClear();
  mockDb.auditLoggerConfig.findUnique.mockClear();
});

describe('isSameScalar', () => {
  test('traite null, undefined et chaîne vide comme équivalents', () => {
    expect(isSameScalar(null, undefined)).toBe(true);
    expect(isSameScalar('', null)).toBe(true);
    expect(isSameScalar(undefined, '')).toBe(true);
  });

  test('distingue deux valeurs réellement différentes', () => {
    expect(isSameScalar('a', 'b')).toBe(false);
    expect(isSameScalar(0, null)).toBe(false);
    expect(isSameScalar(false, null)).toBe(false);
  });
});

describe('diffScalarFields', () => {
  const specs = [{ key: 'name', label: 'Nom' }, { key: 'topic', label: 'Sujet' }];

  test('ne signale que les champs modifiés', () => {
    const changes = diffScalarFields({ name: 'a', topic: 'x' }, { name: 'b', topic: 'x' }, specs);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('name');
    expect(changes[0].kind).toBe('modified');
    expect(changes[0].before).toBe('a');
    expect(changes[0].after).toBe('b');
  });

  test('qualifie d\'ajout le passage d\'une valeur vide à une valeur', () => {
    const changes = diffScalarFields({ topic: null }, { topic: 'Nouveau sujet' }, specs);
    expect(changes[0].kind).toBe('added');
  });

  test('qualifie de suppression le passage d\'une valeur à vide', () => {
    const changes = diffScalarFields({ topic: 'Ancien' }, { topic: null }, specs);
    expect(changes[0].kind).toBe('removed');
  });

  test('ne produit rien quand rien ne bouge', () => {
    expect(diffScalarFields({ name: 'a' }, { name: 'a' }, specs)).toEqual([]);
  });
});

describe('diffStringLists', () => {
  test('sépare les entrées et les sorties', () => {
    const result = diffStringLists(['a', 'b'], ['b', 'c']);
    expect(result.added).toEqual(['c']);
    expect(result.removed).toEqual(['a']);
  });

  test('ignore l\'ordre des éléments', () => {
    const result = diffStringLists(['a', 'b'], ['b', 'a']);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  test('gère les listes absentes', () => {
    expect(diffStringLists(undefined, ['a']).added).toEqual(['a']);
    expect(diffStringLists(['a'], undefined).removed).toEqual(['a']);
  });
});

describe('overwriteStateMap', () => {
  test('reconstitue l\'état tri-valué des permissions', () => {
    const states = overwriteStateMap({
      id: 'r1', type: 'role', name: '@everyone',
      allow: ['SendMessages'], deny: ['AttachFiles'],
    });
    expect(states.get('SendMessages')).toBe('allow');
    expect(states.get('AttachFiles')).toBe('deny');
    expect(states.get('ViewChannel')).toBeUndefined();
  });

  test('retourne une carte vide pour un surclassement absent', () => {
    expect(overwriteStateMap(null).size).toBe(0);
  });
});

describe('diffPermissionOverwrites', () => {
  const base = { id: 'r1', type: 'role', name: 'Membres' };

  test('classe une permission nouvellement autorisée dans added', () => {
    const changes = diffPermissionOverwrites(
      [{ ...base, allow: [], deny: [] }],
      [{ ...base, allow: ['SendMessages'], deny: [] }],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].added).toEqual(['SendMessages']);
    expect(changes[0].removed).toEqual([]);
  });

  test('classe une permission nouvellement refusée dans removed', () => {
    const changes = diffPermissionOverwrites(
      [{ ...base, allow: [], deny: [] }],
      [{ ...base, allow: [], deny: ['AttachFiles'] }],
    );
    expect(changes[0].removed).toEqual(['AttachFiles']);
  });

  test('classe un retour à l\'héritage dans reset', () => {
    const changes = diffPermissionOverwrites(
      [{ ...base, allow: ['SendMessages'], deny: [] }],
      [{ ...base, allow: [], deny: [] }],
    );
    expect(changes[0].reset).toEqual(['SendMessages']);
  });

  test('détecte le basculement direct de autorisé à refusé', () => {
    const changes = diffPermissionOverwrites(
      [{ ...base, allow: ['SendMessages'], deny: [] }],
      [{ ...base, allow: [], deny: ['SendMessages'] }],
    );
    expect(changes[0].removed).toEqual(['SendMessages']);
    expect(changes[0].added).toEqual([]);
  });

  test('marque comme ajout un surclassement entièrement nouveau', () => {
    const changes = diffPermissionOverwrites([], [{ ...base, allow: ['ViewChannel'], deny: [] }]);
    expect(changes[0].kind).toBe('added');
    expect(changes[0].label).toContain('Membres');
  });

  test('marque comme suppression un surclassement retiré', () => {
    const changes = diffPermissionOverwrites([{ ...base, allow: ['ViewChannel'], deny: [] }], []);
    expect(changes[0].kind).toBe('removed');
    expect(changes[0].reset).toEqual(['ViewChannel']);
  });

  test('préfixe d\'une arobase les cibles de type rôle uniquement', () => {
    const roleChange = diffPermissionOverwrites([], [{ ...base, allow: ['ViewChannel'], deny: [] }]);
    const memberChange = diffPermissionOverwrites(
      [],
      [{ id: 'm1', type: 'member', name: 'Alice#0001', allow: ['ViewChannel'], deny: [] }],
    );
    expect(roleChange[0].label).toBe('Permissions - @Membres');
    expect(memberChange[0].label).toBe('Permissions - Alice#0001');
  });

  test('ignore les surclassements inchangés', () => {
    const overwrite = { ...base, allow: ['SendMessages'], deny: ['AttachFiles'] };
    expect(diffPermissionOverwrites([overwrite], [{ ...overwrite }])).toEqual([]);
  });
});

describe('diffMessages', () => {
  test('détecte une édition de contenu', () => {
    const changes = diffMessages({ content: 'bonjour' }, { content: 'bonsoir' });
    expect(changes.some((c) => c.field === 'content')).toBe(true);
  });

  test('signale les pièces jointes retirées', () => {
    const changes = diffMessages(
      { content: 'a', attachments: ['photo.png'] },
      { content: 'a', attachments: [] },
    );
    const attachments = changes.find((c) => c.field === 'attachments');
    expect(attachments?.removed).toEqual(['photo.png']);
  });

  test('ne produit rien pour un message identique', () => {
    expect(diffMessages({ content: 'a' }, { content: 'a' })).toEqual([]);
  });
});

describe('diffMembers', () => {
  const noRoles = { nickname: null, avatarUrl: null, timeoutUntil: null, roles: [] };

  test('restitue les rôles par nom et non par identifiant', () => {
    const changes = diffMembers(
      { ...noRoles, roles: [{ id: '1', name: 'Membre' }] },
      { ...noRoles, roles: [{ id: '2', name: 'Modérateur' }] },
    );
    const roles = changes.find((c) => c.field === 'roles');
    expect(roles?.added).toEqual(['Modérateur']);
    expect(roles?.removed).toEqual(['Membre']);
  });

  test('ne signale pas un rôle simplement renommé comme un ajout et un retrait', () => {
    const changes = diffMembers(
      { ...noRoles, roles: [{ id: '1', name: 'Ancien nom' }] },
      { ...noRoles, roles: [{ id: '1', name: 'Nouveau nom' }] },
    );
    expect(changes.find((c) => c.field === 'roles')).toBeUndefined();
  });

  test('détecte un changement de surnom', () => {
    const changes = diffMembers({ ...noRoles, nickname: 'Bob' }, { ...noRoles, nickname: 'Bobby' });
    expect(changes[0].field).toBe('nickname');
  });

  test('détecte la pose d\'une exclusion temporaire', () => {
    const changes = diffMembers(
      { ...noRoles },
      { ...noRoles, timeoutUntil: '2026-08-01T00:00:00.000Z' },
    );
    expect(changes.find((c) => c.field === 'timeoutUntil')?.kind).toBe('added');
  });
});

describe('diffRoles', () => {
  const base = { name: 'Mod', color: 0, hoist: false, mentionable: false, position: 1, permissions: [] as string[] };

  test('sépare les permissions gagnées et perdues', () => {
    const changes = diffRoles(
      { ...base, permissions: ['KickMembers'] },
      { ...base, permissions: ['BanMembers'] },
    );
    const permissions = changes.find((c) => c.field === 'permissions');
    expect(permissions?.added).toEqual(['BanMembers']);
    expect(permissions?.removed).toEqual(['KickMembers']);
  });

  test('détecte un changement de couleur', () => {
    const changes = diffRoles({ ...base, color: 0 }, { ...base, color: 16711680 });
    expect(changes.find((c) => c.field === 'color')).toBeDefined();
  });
});

describe('diffChannels', () => {
  const base = { name: 'general', topic: null, overwrites: [] };

  test('combine changements de propriétés et de permissions', () => {
    const changes = diffChannels(
      { ...base, name: 'general', overwrites: [] },
      {
        ...base,
        name: 'general-v2',
        overwrites: [{ id: 'r1', type: 'role', name: 'Membres', allow: ['SendMessages'], deny: [] }],
      },
    );
    expect(changes.some((c) => c.field === 'name')).toBe(true);
    expect(changes.some((c) => c.field.startsWith('overwrite:'))).toBe(true);
  });
});

describe('sanitizeAuditConfigPatch', () => {
  test('borne la rétention entre 0 et 3650 jours', () => {
    expect(sanitizeAuditConfigPatch({ retentionDays: 99999 }).retentionDays).toBe(3650);
    expect(sanitizeAuditConfigPatch({ retentionDays: -5 }).retentionDays).toBe(0);
  });

  test('ignore les types invalides', () => {
    const patch = sanitizeAuditConfigPatch({ enabled: 'oui', retentionDays: 'beaucoup' });
    expect(Object.keys(patch)).toEqual([]);
  });

  test('ne retient que des identifiants Discord plausibles', () => {
    const patch = sanitizeAuditConfigPatch({ ignoredChannelIds: ['123456789012345678', 'nope', 7] });
    expect(patch.ignoredChannelIds).toEqual(['123456789012345678']);
  });

  test('accepte les bascules de capture', () => {
    const patch = sanitizeAuditConfigPatch({ captureMessages: false, captureRoles: true });
    expect(patch.captureMessages).toBe(false);
    expect(patch.captureRoles).toBe(true);
  });
});

describe('buildAuditSearchWhere', () => {
  test('restreint toujours au serveur courant', () => {
    expect(buildAuditSearchWhere('g1', {}).guildId).toBe('g1');
  });

  test('compose un intervalle de dates', () => {
    const where = buildAuditSearchWhere('g1', {
      from: new Date('2026-01-01'),
      to: new Date('2026-02-01'),
    }) as { createdAt: { gte: Date; lte: Date } };
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lte).toBeInstanceOf(Date);
  });

  test('cherche à la fois sur la cible et sur l\'auteur', () => {
    const where = buildAuditSearchWhere('g1', { search: 'alice' }) as { OR: unknown[] };
    expect(where.OR).toHaveLength(3);
  });

  test('ignore une recherche vide', () => {
    expect(buildAuditSearchWhere('g1', { search: '   ' }).OR).toBeUndefined();
  });
});

describe('recordAuditEvent', () => {
  const input = {
    guildId: 'g1',
    eventType: 'ROLE_UPDATE' as const,
    targetType: 'ROLE' as const,
    targetId: 'r1',
    before: {},
    after: {},
  };

  test('n\'écrit rien quand aucun changement n\'est détecté', async () => {
    const written = await recordAuditEvent({ ...input, changes: [] });
    expect(written).toBe(false);
    expect(mockDb.auditEvent.create).not.toHaveBeenCalled();
  });

  test('extrait les noms de champs pour permettre le filtrage SQL', async () => {
    await recordAuditEvent({
      ...input,
      changes: [
        { field: 'name', label: 'Nom', kind: 'modified' },
        { field: 'permissions', label: 'Permissions', kind: 'modified' },
      ],
    });

    const call = mockDb.auditEvent.create.mock.calls.at(-1)?.[0] as { data: { changedFields: string[] } };
    expect(call.data.changedFields).toEqual(['name', 'permissions']);
  });

  test('une erreur de base ne fait pas remonter d\'exception', async () => {
    mockDb.auditEvent.create.mockImplementationOnce(() => Promise.reject(new Error('base indisponible')));
    const written = await recordAuditEvent({
      ...input,
      changes: [{ field: 'name', label: 'Nom', kind: 'modified' }],
    });
    expect(written).toBe(false);
  });
});

describe('getAuditConfig', () => {
  test('retombe sur les valeurs par défaut sans configuration enregistrée', async () => {
    mockDb.auditLoggerConfig.findUnique.mockResolvedValueOnce(null);
    const config = await getAuditConfig('g1');
    expect(config.enabled).toBe(false);
    expect(config.retentionDays).toBe(DEFAULT_AUDIT_CONFIG.retentionDays);
  });

  test('met la configuration en cache pour éviter une requête par événement', async () => {
    mockDb.auditLoggerConfig.findUnique.mockResolvedValueOnce({
      guildId: 'g1', ...DEFAULT_AUDIT_CONFIG, enabled: true,
    });

    await getAuditConfig('g1');
    await getAuditConfig('g1');
    await getAuditConfig('g1');

    expect(mockDb.auditLoggerConfig.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('upsertAuditConfig', () => {
  test('complète la création avec les valeurs par défaut et invalide le cache', async () => {
    mockDb.auditLoggerConfig.findUnique.mockResolvedValueOnce({
      guildId: 'g1', ...DEFAULT_AUDIT_CONFIG, enabled: false,
    });
    await getAuditConfig('g1');

    mockDb.auditLoggerConfig.upsert.mockResolvedValueOnce({
      guildId: 'g1', ...DEFAULT_AUDIT_CONFIG, enabled: true,
    });
    await upsertAuditConfig('g1', { enabled: true });

    const call = mockDb.auditLoggerConfig.upsert.mock.calls.at(-1)?.[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.create.retentionDays).toBe(90);
    expect(call.update).toEqual({ enabled: true });

    // Le cache doit avoir été vidé : une nouvelle lecture repasse par la base
    mockDb.auditLoggerConfig.findUnique.mockClear();
    mockDb.auditLoggerConfig.findUnique.mockResolvedValueOnce(null);
    await getAuditConfig('g1');
    expect(mockDb.auditLoggerConfig.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('searchAuditEvents', () => {
  test('borne la taille de page et calcule le décalage', async () => {
    mockDb.auditEvent.findMany.mockResolvedValueOnce([]);
    mockDb.auditEvent.count.mockResolvedValueOnce(0);

    await searchAuditEvents('g1', { page: 3, pageSize: 500 });

    const call = mockDb.auditEvent.findMany.mock.calls.at(-1)?.[0] as { skip: number; take: number };
    expect(call.take).toBe(100);
    expect(call.skip).toBe(200);
  });

  test('refuse une page inférieure à 1', async () => {
    mockDb.auditEvent.findMany.mockResolvedValueOnce([]);
    mockDb.auditEvent.count.mockResolvedValueOnce(0);

    const result = await searchAuditEvents('g1', { page: -4 });
    expect(result.page).toBe(1);
  });
});

describe('getAuditExecutors', () => {
  test('retombe sur l\'identifiant quand le nom est inconnu', async () => {
    mockDb.auditEvent.groupBy.mockResolvedValueOnce([
      { executorId: '111', executorName: 'Alice', _count: { _all: 4 } },
      { executorId: '222', executorName: null, _count: { _all: 1 } },
    ]);

    const executors = await getAuditExecutors('g1');
    expect(executors[0]).toEqual({ id: '111', name: 'Alice', count: 4 });
    expect(executors[1].name).toBe('222');
  });
});

describe('resolveExecutor', () => {
  function guildWith(entries: unknown[]) {
    return {
      fetchAuditLogs: () => Promise.resolve({
        entries: { find: (fn: (e: never) => boolean) => entries.find(fn as never) },
      }),
    } as never;
  }

  const executor = { id: 'mod-1', tag: 'Mod#0001', username: 'mod' };

  test('retourne l\'auteur d\'une entrée récente portant sur la bonne cible', async () => {
    const result = await resolveExecutor(
      guildWith([{ targetId: 'r1', createdTimestamp: Date.now(), executor, reason: 'Ménage' }]),
      AuditLogEvent.RoleUpdate,
      'r1',
    );
    expect(result).toEqual({ id: 'mod-1', name: 'Mod#0001', reason: 'Ménage' });
  });

  test('ignore une entrée portant sur une autre cible', async () => {
    const result = await resolveExecutor(
      guildWith([{ targetId: 'autre', createdTimestamp: Date.now(), executor }]),
      AuditLogEvent.RoleUpdate,
      'r1',
    );
    expect(result).toBeNull();
  });

  test('ignore une entrée trop ancienne pour être corrélée', async () => {
    const result = await resolveExecutor(
      guildWith([{ targetId: 'r1', createdTimestamp: Date.now() - 60_000, executor }]),
      AuditLogEvent.RoleUpdate,
      'r1',
    );
    expect(result).toBeNull();
  });

  test('retourne null quand le bot ne peut pas lire l\'audit log', async () => {
    const guild = { fetchAuditLogs: () => Promise.reject(new Error('Missing Permissions')) } as never;
    expect(await resolveExecutor(guild, AuditLogEvent.RoleUpdate, 'r1')).toBeNull();
  });

  test('normalise un motif vide en null', async () => {
    const result = await resolveExecutor(
      guildWith([{ targetId: 'r1', createdTimestamp: Date.now(), executor, reason: '   ' }]),
      AuditLogEvent.RoleUpdate,
      'r1',
    );
    expect(result?.reason).toBeNull();
  });
});

describe('pruneOldAuditEvents', () => {
  test('supprime les événements au-delà de la rétention de chaque serveur', async () => {
    mockDb.auditLoggerConfig.findMany.mockResolvedValueOnce([
      { guildId: 'g1', retentionDays: 30 },
      { guildId: 'g2', retentionDays: 90 },
    ]);
    mockDb.auditEvent.deleteMany.mockResolvedValue({ count: 3 });

    await pruneOldAuditEvents();

    expect(mockDb.auditEvent.deleteMany).toHaveBeenCalledTimes(2);
    const call = mockDb.auditEvent.deleteMany.mock.calls[0][0] as {
      where: { guildId: string; createdAt: { lt: Date } };
    };
    expect(call.where.guildId).toBe('g1');
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
  });

  test('une erreur sur un serveur n\'interrompt pas la purge des autres', async () => {
    mockDb.auditLoggerConfig.findMany.mockResolvedValueOnce([
      { guildId: 'g1', retentionDays: 30 },
      { guildId: 'g2', retentionDays: 30 },
    ]);
    mockDb.auditEvent.deleteMany.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    mockDb.auditEvent.deleteMany.mockResolvedValueOnce({ count: 1 });

    await pruneOldAuditEvents();

    expect(mockDb.auditEvent.deleteMany).toHaveBeenCalledTimes(2);
  });
});
