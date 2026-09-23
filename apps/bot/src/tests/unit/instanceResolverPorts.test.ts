import { beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';

type DbInstance = {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  apiPort: number | null;
  createdAt: Date;
  discordToken: string;
  discordClientId: string;
  discordClientSecret: string;
  discordRedirectUri: string | null;
  dashboardUrl: string | null;
  dashboardOrigin: string | null;
  brandName: string | null;
  brandColor: string;
  brandLogoUrl: string | null;
  brandFaviconUrl: string | null;
  brandFooterText: string | null;
  jwtSecret: string | null;
  ownerId: string;
  maxGuilds: number;
};

let table: DbInstance[] = [];
const updateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];

/** Une instance en base, avec des valeurs par défaut sans intérêt pour le test. */
function row(overrides: Partial<DbInstance> & Pick<DbInstance, 'id' | 'createdAt'>): DbInstance {
  return {
    slug: overrides.id,
    name: overrides.id,
    enabled: true,
    apiPort: null,
    discordToken: `token-${overrides.id}`,
    discordClientId: 'client',
    discordClientSecret: 'secret',
    discordRedirectUri: null,
    dashboardUrl: `https://${overrides.id}.example.test`,
    dashboardOrigin: null,
    brandName: null,
    brandColor: '#000000',
    brandLogoUrl: null,
    brandFaviconUrl: null,
    brandFooterText: null,
    jwtSecret: 'jwt',
    ownerId: 'owner',
    maxGuilds: 1,
    ...overrides,
  };
}

const prismaMock = {
  whiteLabelInstance: {
    findMany: mock(async () =>
      [...table].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
      ),
    ),
    updateMany: mock(
      async ({ where, data }: { where: { id: string; apiPort: null }; data: { apiPort: number } }) => {
        updateManyCalls.push({ where, data });
        const target = table.find((inst) => inst.id === where.id && inst.apiPort === where.apiPort);
        if (!target) return { count: 0 };
        target.apiPort = data.apiPort;
        return { count: 1 };
      },
    ),
  },
};

for (const extension of ['ts', 'js']) {
  mock.module(path.resolve(import.meta.dir, `../../utils/db.${extension}`), () => ({
    default: prismaMock,
    prisma: prismaMock,
    prismaRead: prismaMock,
  }));
}

const { loadAllInstances, getInstanceById } = await import('../../utils/instanceResolver.js');

/** Le port du dépôt sur lequel s'appuie l'auto-incrément (8787 + 1, + 2, ...). */
const BASE_PORT = 8787;

beforeEach(() => {
  process.env.DASHBOARD_API_PORT = String(BASE_PORT);
  process.env.DASHBOARD_URL = 'https://dash.example.test';
  table = [];
  updateManyCalls.length = 0;
  prismaMock.whiteLabelInstance.updateMany.mockClear();
});

describe('loadAllInstances - attribution des ports API', () => {
  test("le port auto-assigné ne bouge pas quand l'instance précédente est désactivée", async () => {
    table = [
      row({ id: 'alpha', createdAt: new Date('2026-01-01') }),
      row({ id: 'beta', createdAt: new Date('2026-01-02') }),
    ];

    await loadAllInstances();
    const betaPort = getInstanceById('beta')!.apiPort;
    expect(getInstanceById('alpha')!.apiPort).toBe(BASE_PORT + 1);
    expect(betaPort).toBe(BASE_PORT + 2);

    // On désactive alpha : avant le correctif, beta récupérait le port d'alpha.
    table.find((inst) => inst.id === 'alpha')!.enabled = false;
    await loadAllInstances();

    expect(getInstanceById('alpha')).toBeUndefined();
    expect(getInstanceById('beta')!.apiPort).toBe(betaPort);
  });

  test('un port auto-assigné ne marche pas sur un port réservé explicitement', async () => {
    table = [
      row({ id: 'auto', createdAt: new Date('2026-01-01') }),
      // Instance désactivée, mais son port reste réservé : elle peut revenir.
      row({ id: 'fixe', createdAt: new Date('2026-01-02'), apiPort: BASE_PORT + 1, enabled: false }),
    ];

    await loadAllInstances();

    expect(getInstanceById('auto')!.apiPort).toBe(BASE_PORT + 2);
  });

  test('le port attribué est figé en base sous garde apiPort null', async () => {
    table = [row({ id: 'alpha', createdAt: new Date('2026-01-01') })];

    await loadAllInstances();

    expect(updateManyCalls).toEqual([
      { where: { id: 'alpha', apiPort: null }, data: { apiPort: BASE_PORT + 1 } },
    ]);
    expect(table[0]!.apiPort).toBe(BASE_PORT + 1);

    // Deuxième chargement : le port est déjà en base, plus rien à écrire.
    updateManyCalls.length = 0;
    await loadAllInstances();
    expect(updateManyCalls).toEqual([]);
    expect(getInstanceById('alpha')!.apiPort).toBe(BASE_PORT + 1);
  });
});
