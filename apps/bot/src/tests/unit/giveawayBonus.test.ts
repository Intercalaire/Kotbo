import { describe, expect, test, mock, beforeEach } from 'bun:test';
import path from 'node:path';

/**
 * Chances supplémentaires d'un tirage. Deux sources s'y rejoignent, et la
 * seconde était cassée : le bonus du clan vainqueur cherchait un clan par
 * `lastWinningClanId`, alors que cette colonne porte plusieurs identifiants
 * séparés par des virgules dès qu'une saison finit sur une égalité. Aucun clan
 * ne correspondait, et le bonus annoncé aux joueurs ne s'appliquait pas.
 */

let guildRow: { clanRewardGiveaway: boolean; lastWinningClanId: string | null } | null = null;
let clanRows: { roleId: string }[] = [];
let clanQuery: unknown = null;

const guildFindUnique = mock((_args?: unknown) => Promise.resolve(guildRow));
const clanFindMany = mock((args?: unknown) => {
  clanQuery = args;
  return Promise.resolve(clanRows);
});
const mockDb = {
  guild: { findUnique: guildFindUnique },
  clan: { findMany: clanFindMany },
  giveawayConfig: { findUnique: mock(() => Promise.resolve(null)) },
};

// Cache neutralisé : on observe les lectures réelles, pas un reste de test
// voisin. `getCachedGuild` fait partie du module : l'omettre casserait l'import
// de la résolution de langue, qui s'en sert.
const mockCache = {
  cache: {
    get: mock(() => Promise.resolve(null)),
    set: mock(() => Promise.resolve()),
  },
  getCachedGuild: mock(() => Promise.resolve(null)),
  getCachedDashboardSettings: mock(() => Promise.resolve(null)),
};

const resolve = (file: string) => path.resolve(import.meta.dir, `../../${file}`);
for (const ext of ['ts', 'js']) {
  mock.module(resolve(`utils/db.${ext}`), () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
  mock.module(resolve(`utils/cache.${ext}`), () => mockCache);
}

const {
  buildBonusRolesBlock,
  resolveGiveawayBonuses,
  weightForRoles,
} = await import('../../services/features/giveawayBonusService');
const { defaultAppearance } = await import('../../services/features/giveawayAppearance');

const config = (overrides: Record<string, unknown> = {}) => ({
  guildId: '1',
  locale: 'fr' as const,
  managerRoleIds: [],
  requiredRoleIds: [],
  blockedRoleIds: [],
  minAccountAgeDays: 0,
  minMemberAgeDays: 0,
  minLevel: 0,
  blockLinkedAccounts: false,
  bonusEntries: [] as { roleId: string; weight: number }[],
  clanBonusEnabled: true,
  clanBonusWeight: 2,
  showBonusRoles: true,
  ...defaultAppearance('fr'),
  ...overrides,
}) as Parameters<typeof resolveGiveawayBonuses>[1];

beforeEach(() => {
  guildRow = null;
  clanRows = [];
  clanQuery = null;
  guildFindUnique.mockClear();
  clanFindMany.mockClear();
});

describe('resolveGiveawayBonuses', () => {
  test('accorde le bonus à tous les clans à égalité', async () => {
    guildRow = { clanRewardGiveaway: true, lastWinningClanId: 'clan-a,clan-b' };
    clanRows = [{ roleId: '10' }, { roleId: '20' }];

    const bonus = await resolveGiveawayBonuses('1', config());

    expect(clanQuery).toEqual({ where: { id: { in: ['clan-a', 'clan-b'] } }, select: { roleId: true } });
    expect(bonus.clanRoleIds).toEqual(['10', '20']);
    expect(bonus.entries).toEqual([
      { roleId: '10', weight: 2 },
      { roleId: '20', weight: 2 },
    ]);
  });

  test('n\'accorde rien tant qu\'aucune saison n\'a de vainqueur', async () => {
    guildRow = { clanRewardGiveaway: true, lastWinningClanId: null };

    const bonus = await resolveGiveawayBonuses('1', config());

    expect(bonus.entries).toEqual([]);
    expect(clanFindMany).not.toHaveBeenCalled();
  });

  test('respecte le bonus de concours désactivé côté Clans', async () => {
    guildRow = { clanRewardGiveaway: false, lastWinningClanId: 'clan-a' };

    expect((await resolveGiveawayBonuses('1', config())).entries).toEqual([]);
  });

  test('laisse les giveaways refuser le bonus de clan sans toucher aux Clans', async () => {
    guildRow = { clanRewardGiveaway: true, lastWinningClanId: 'clan-a' };
    clanRows = [{ roleId: '10' }];

    const bonus = await resolveGiveawayBonuses('1', config({ clanBonusEnabled: false }));

    expect(bonus.entries).toEqual([]);
    expect(guildFindUnique).not.toHaveBeenCalled();
  });

  test('garde le meilleur poids quand un rôle est avantagé des deux côtés', async () => {
    guildRow = { clanRewardGiveaway: true, lastWinningClanId: 'clan-a' };
    clanRows = [{ roleId: '10' }];

    const bonus = await resolveGiveawayBonuses('1', config({
      bonusEntries: [{ roleId: '10', weight: 5 }],
      clanBonusWeight: 2,
    }));

    // Les avantages ne se multiplient jamais : sinon un membre de clan porteur
    // d'un rôle avantagé raflerait le tirage sans que rien ne l'annonce.
    expect(bonus.entries).toEqual([{ roleId: '10', weight: 5 }]);
  });

  test('ne consulte rien pour un concours au tirage égalitaire', async () => {
    guildRow = { clanRewardGiveaway: true, lastWinningClanId: 'clan-a' };

    const bonus = await resolveGiveawayBonuses('1', config({
      bonusEntries: [{ roleId: '10', weight: 3 }],
    }), { ignoreBonuses: true });

    expect(bonus.entries).toEqual([]);
    expect(guildFindUnique).not.toHaveBeenCalled();
  });
});

describe('weightForRoles', () => {
  test('applique le meilleur rôle porté', async () => {
    const bonus = { entries: [{ roleId: '10', weight: 2 }, { roleId: '20', weight: 4 }], clanRoleIds: [] };

    expect(weightForRoles(['10', '20'], bonus)).toBe(4);
    expect(weightForRoles(['99'], bonus)).toBe(1);
  });
});

describe('buildBonusRolesBlock', () => {
  test('annonce les rôles du plus avantagé au moins avantagé', () => {
    const block = buildBonusRolesBlock({
      entries: [{ roleId: '10', weight: 2 }, { roleId: '20', weight: 5 }],
      clanRoleIds: [],
    }, 'fr');

    expect(block).toBe('\n**Chances supplémentaires :**\n<@&20> ×5\n<@&10> ×2\n');
  });

  test('suit la langue du serveur', () => {
    const block = buildBonusRolesBlock({ entries: [{ roleId: '10', weight: 3 }], clanRoleIds: [] }, 'en');

    expect(block).toBe('\n**Extra chances:**\n<@&10> ×3\n');
  });

  test('reste vide sans rôle avantagé, pour ne rien ajouter à l\'annonce', () => {
    expect(buildBonusRolesBlock({ entries: [], clanRoleIds: [] }, 'fr')).toBe('');
  });
});
