import { describe, expect, test, mock, beforeEach } from 'bun:test';
import path from 'node:path';

/**
 * Filtre d'entrée d'un concours : rôles, ancienneté et niveau. Un membre écarté
 * à tort ne peut plus jouer du tout, et un membre laissé passer à tort fausse
 * un tirage déjà clos quand on s'en aperçoit. Les deux erreurs se voient sur ce
 * seul chemin, parcouru à chaque clic sur « Rejoindre ».
 */

let memberLevelRow: { level: number } | null = null;
const findUnique = mock((_args?: unknown) => Promise.resolve(memberLevelRow));
const mockDb = {
  memberLevel: { findUnique },
  giveawayConfig: { findUnique: mock(() => Promise.resolve(null)) },
};

const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const {
  bonusWeightFor,
  checkParticipation,
  evaluateParticipation,
  hasParticipationRules,
  normalizeBonusEntries,
  normalizeThreshold,
} = await import('../../services/features/giveawayConfigService');
const { defaultAppearance } = await import('../../services/features/giveawayAppearance');

const baseConfig = {
  guildId: '1',
  locale: 'fr' as const,
  managerRoleIds: [],
  requiredRoleIds: [],
  blockedRoleIds: [],
  minAccountAgeDays: 0,
  minMemberAgeDays: 0,
  minLevel: 0,
  blockLinkedAccounts: false,
  bonusEntries: [],
  clanBonusEnabled: true,
  clanBonusWeight: 2,
  showBonusRoles: true,
  ...defaultAppearance('fr'),
};

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

const participant = (overrides: Partial<{ roleIds: string[]; accountCreatedAt: Date | null; joinedAt: Date | null }> = {}) => ({
  userId: '42',
  roleIds: [] as string[],
  accountCreatedAt: daysAgo(400),
  joinedAt: daysAgo(200),
  ...overrides,
});

beforeEach(() => {
  memberLevelRow = null;
  findUnique.mockClear();
});

describe('evaluateParticipation', () => {
  test('exclut un rôle bloqué même s\'il porte aussi un rôle requis', () => {
    const config = { ...baseConfig, requiredRoleIds: ['10'], blockedRoleIds: ['20'] };
    const check = evaluateParticipation(['10', '20'], config);

    expect(check.allowed).toBe(false);
    expect(check.allowed === false && check.reason).toBe(config.deniedBlockedTemplate);
  });

  test('laisse passer tout le serveur quand aucun rôle n\'est exigé', () => {
    expect(evaluateParticipation([], baseConfig).allowed).toBe(true);
  });

  test('refuse un membre sans rôle requis', () => {
    const check = evaluateParticipation(['30'], { ...baseConfig, requiredRoleIds: ['10'] });
    expect(check.allowed).toBe(false);
  });
});

describe('checkParticipation', () => {
  test('refuse un compte Discord plus récent que le seuil', async () => {
    const config = { ...baseConfig, minAccountAgeDays: 30 };
    const check = await checkParticipation('1', participant({ accountCreatedAt: daysAgo(3) }), config);

    expect(check.allowed).toBe(false);
    expect(check.allowed === false && check.reason).toContain('30');
  });

  test('laisse passer quand Discord ne transmet pas la date d\'arrivée', async () => {
    // Refuser sur une donnée absente priverait de concours un membre éligible.
    const config = { ...baseConfig, minMemberAgeDays: 30 };
    expect((await checkParticipation('1', participant({ joinedAt: null }), config)).allowed).toBe(true);
  });

  test('compare le niveau du membre au minimum exigé', async () => {
    const config = { ...baseConfig, minLevel: 5 };

    memberLevelRow = { level: 4 };
    expect((await checkParticipation('1', participant(), config)).allowed).toBe(false);

    memberLevelRow = { level: 5 };
    expect((await checkParticipation('1', participant(), config)).allowed).toBe(true);
  });

  test('ne consulte pas les niveaux quand aucun minimum n\'est exigé', async () => {
    await checkParticipation('1', participant(), baseConfig);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('hasParticipationRules', () => {
  test('reste faux tant que rien n\'est configuré', () => {
    expect(hasParticipationRules(baseConfig)).toBe(false);
    expect(hasParticipationRules({ ...baseConfig, minLevel: 1 })).toBe(true);
    expect(hasParticipationRules({ ...baseConfig, blockedRoleIds: ['10'] })).toBe(true);
  });
});

describe('normalizeBonusEntries', () => {
  test('ignore les poids neutres, les rôles invalides et les doublons', () => {
    const entries = normalizeBonusEntries([
      { roleId: '123456789012345678', weight: 3 },
      { roleId: '123456789012345678', weight: 4 },
      { roleId: 'pas-un-role', weight: 5 },
      { roleId: '223456789012345678', weight: 1 },
    ]);

    expect(entries).toEqual([{ roleId: '123456789012345678', weight: 4 }]);
  });

  test('borne un poids démesuré', () => {
    expect(normalizeBonusEntries([{ roleId: '123456789012345678', weight: 9999 }]))
      .toEqual([{ roleId: '123456789012345678', weight: 10 }]);
  });
});

describe('bonusWeightFor', () => {
  test('retient le meilleur rôle au lieu de cumuler', () => {
    const entries = [{ roleId: '1', weight: 2 }, { roleId: '2', weight: 5 }];
    expect(bonusWeightFor(['1', '2'], entries)).toBe(5);
  });

  test('vaut une chance pour un membre sans rôle avantagé', () => {
    expect(bonusWeightFor(['9'], [{ roleId: '1', weight: 3 }])).toBe(1);
  });
});

describe('normalizeThreshold', () => {
  test('borne la saisie et refuse ce qui n\'est pas un nombre', () => {
    expect(normalizeThreshold(12.7, 100)).toBe(12);
    expect(normalizeThreshold(-5, 100)).toBe(0);
    expect(normalizeThreshold(500, 100)).toBe(100);
    expect(normalizeThreshold('beaucoup', 100)).toBe(0);
  });
});
