/**
 * Garde d execution des modules.
 *
 * Le defaut corrige ici : la page Modules ecrivait bien `enabled: false`, mais
 * rien ne relisait cette valeur au moment d executer la fonctionnalite. Les cas
 * ci-dessous verrouillent le comportement attendu - priorite des sources,
 * cascade des dependances, invalidation apres bascule.
 *
 * Prefixe `zz-` : ce fichier remplace `utils/db`, `utils/cache` et deux
 * services pour tout le process (`mock.module` est global). Charge en dernier,
 * il ne peut plus fausser les suites suivantes.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';
import { completeModuleMock } from '../helpers/moduleMock.js';

interface FeatureRow { guildId: string; featureKey: string; enabled: boolean }

let guildRow: Record<string, unknown> | null = null;
let featureRows: FeatureRow[] = [];
let levelConfigRow: { enabled: boolean } | null = null;
let rankedConfigRow: { enabled: boolean } | null = null;
let banAppealConfigRow: { enabled: boolean } | null = null;

const mockDb = {
  guild: {
    findUnique: mock(async () => guildRow),
    update: mock(async () => guildRow),
  },
  dashboardFeatureConfig: {
    findMany: mock(async () => featureRows),
    upsert: mock(async ({ where, create, update }: any) => {
      const key = where.guildId_featureKey.featureKey;
      const existing = featureRows.find((row) => row.featureKey === key);
      if (existing) existing.enabled = update.enabled;
      else featureRows.push({ guildId: create.guildId, featureKey: key, enabled: create.enabled });
      return { ...create, ...update };
    }),
  },
  levelConfig: {
    findUnique: mock(async () => levelConfigRow),
    upsert: mock(async ({ create, update }: any) => {
      levelConfigRow = { enabled: update?.enabled ?? create.enabled };
      return levelConfigRow;
    }),
  },
  rankedConfig: {
    findUnique: mock(async () => rankedConfigRow),
    upsert: mock(async ({ create, update }: any) => {
      rankedConfigRow = { enabled: update?.enabled ?? create.enabled };
      return rankedConfigRow;
    }),
  },
  banAppealConfig: {
    findUnique: mock(async () => banAppealConfigRow),
    upsert: mock(async ({ create, update }: any) => {
      banAppealConfigRow = { enabled: update?.enabled ?? create.enabled };
      return banAppealConfigRow;
    }),
  },
};

// Cache en memoire : la garde s appuie dessus, et c est precisement son
// invalidation apres bascule que l on veut verifier.
const cacheValues = new Map<string, unknown>();
const mockCache = {
  cache: {
    get: mock(async (key: string) => cacheValues.get(key) ?? null),
    set: mock(async (key: string, value: unknown) => { cacheValues.set(key, value); }),
    delete: mock(async (key: string) => { cacheValues.delete(key); }),
    invalidateGuild: mock(async () => undefined),
  },
  getCachedGuild: mock(async () => guildRow),
  getCachedDashboardSettings: mock(async () => null),
};

const silentLogger = {
  info: () => {}, warn: () => {}, error: () => {}, success: () => {}, debug: () => {},
};

for (const suffix of ['../../utils/db.ts', '../../utils/db.js']) {
  mock.module(path.resolve(import.meta.dir, suffix), () => ({
    default: mockDb, prisma: mockDb, prismaRead: mockDb,
  }));
}
for (const suffix of ['../../utils/logger.ts', '../../utils/logger.js']) {
  mock.module(path.resolve(import.meta.dir, suffix), () => ({ logger: silentLogger, default: silentLogger }));
}
for (const suffix of ['../../utils/cache.ts', '../../utils/cache.js']) {
  mock.module(path.resolve(import.meta.dir, suffix), () => mockCache);
}
// Mocks COMPLETS : ces deux services exportent bien davantage que ce que la
// bascule appelle, et un mock partiel supprimerait le reste pour tout le
// process.
const levelingServicePath = path.resolve(import.meta.dir, '../../services/progression/levelingService.ts');
const mockLevelingService = () => completeModuleMock(levelingServicePath, {
  invalidateLevelConfigCache: mock(async () => undefined),
});
for (const suffix of ['../../services/progression/levelingService.ts', '../../services/progression/levelingService.js']) {
  mock.module(path.resolve(import.meta.dir, suffix), mockLevelingService);
}

const moduleStatsPath = path.resolve(import.meta.dir, '../../services/analytics/moduleStatsService.ts');
const mockModuleStats = () => completeModuleMock(moduleStatsPath, {
  setModuleActivation: mock(async () => undefined),
});
for (const suffix of ['../../services/analytics/moduleStatsService.ts', '../../services/analytics/moduleStatsService.js']) {
  mock.module(path.resolve(import.meta.dir, suffix), mockModuleStats);
}

const { getModuleStates, isModuleEnabled, invalidateModuleStates, filterGuildsWithModule } =
  await import('../../services/core/moduleGate.js');
const { setDashboardModuleStatus, CoreModuleError } =
  await import('../../services/core/moduleActivationService.js');

const GUILD = 'guild-1';

/** Dernier `prisma.guild.update()` recu, tel que la bascule l a construit. */
function lastGuildUpdate(): { data: Record<string, boolean> } {
  const calls = mockDb.guild.update.mock.calls as unknown as Array<[{ data: Record<string, boolean> }]>;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  guildRow = { id: GUILD };
  featureRows = [];
  levelConfigRow = null;
  rankedConfigRow = null;
  banAppealConfigRow = null;
  cacheValues.clear();
});

afterEach(async () => {
  await invalidateModuleStates(GUILD);
});

describe('isModuleEnabled', () => {
  test('respecte la ligne DashboardFeatureConfig avant tout le reste', async () => {
    // La colonne historique dit « actif », la ligne dit « inactif » : c est la
    // ligne qui gagne, sinon la bascule du dashboard resterait sans effet.
    guildRow = { id: GUILD, funEnabled: true };
    featureRows = [{ guildId: GUILD, featureKey: 'fun', enabled: false }];

    expect(await isModuleEnabled(GUILD, 'fun')).toBeFalse();
  });

  test('retombe sur la colonne historique quand aucune ligne n existe', async () => {
    guildRow = { id: GUILD, codePoliceEnabled: true };

    // `codepolice` est a `defaultEnabled: false` dans le registre : sans la
    // lecture de la colonne, un serveur qui l utilisait depuis des mois le
    // verrait s eteindre a la premiere lecture.
    expect(await isModuleEnabled(GUILD, 'codepolice')).toBeTrue();
  });

  test('les clans suivent la colonne historique du serveur', async () => {
    // Regression : sans `legacyField`, tous les serveurs qui faisaient tourner
    // des clans les ont vus s eteindre a la livraison de la garde, points
    // toujours en base mais page fermee par le 403 de la route.
    guildRow = { id: GUILD, clansEnabled: true };
    levelConfigRow = { enabled: true };

    expect(await isModuleEnabled(GUILD, 'clans')).toBeTrue();
  });

  test('les modules a table dediee suivent leur propre etat', async () => {
    guildRow = { id: GUILD };
    levelConfigRow = { enabled: true };
    rankedConfigRow = { enabled: true };
    banAppealConfigRow = { enabled: true };

    expect(await isModuleEnabled(GUILD, 'prestige')).toBeTrue();
    expect(await isModuleEnabled(GUILD, 'ban_appeals')).toBeTrue();
  });

  test('retombe sur le defaut du registre sans ligne ni colonne', async () => {
    guildRow = { id: GUILD };

    expect(await isModuleEnabled(GUILD, 'tickets')).toBeTrue();
    expect(await isModuleEnabled(GUILD, 'nickname_moderation')).toBeFalse();
  });

  test('accepte les cles historiques', async () => {
    featureRows = [{ guildId: GUILD, featureKey: 'daily_algo', enabled: false }];

    expect(await isModuleEnabled(GUILD, 'dailyalgo')).toBeFalse();
    expect(await isModuleEnabled(GUILD, 'daily_algo')).toBeFalse();
  });

  test('une ligne sous un alias est repliee sur la cle canonique', async () => {
    featureRows = [{ guildId: GUILD, featureKey: 'traduction', enabled: false }];

    expect(await isModuleEnabled(GUILD, 'translation')).toBeFalse();
  });

  test('un module du coeur reste actif meme si la base dit le contraire', async () => {
    featureRows = [{ guildId: GUILD, featureKey: 'activity', enabled: false }];

    expect(await isModuleEnabled(GUILD, 'activity')).toBeTrue();
  });

  test('un module inconnu du registre passe', async () => {
    expect(await isModuleEnabled(GUILD, 'module-jamais-declare')).toBeTrue();
  });

  test('sans serveur (message prive), la garde laisse passer', async () => {
    expect(await isModuleEnabled(null, 'tickets')).toBeTrue();
  });

  test('un dependant est eteint quand son prerequis l est', async () => {
    featureRows = [
      { guildId: GUILD, featureKey: 'leveling', enabled: false },
      // Etat incoherent volontaire : c est ce que produit une ecriture directe
      // en base ou un import. La cascade de lecture doit le rattraper.
      { guildId: GUILD, featureKey: 'seasons', enabled: true },
    ];

    expect(await isModuleEnabled(GUILD, 'seasons')).toBeFalse();
  });

  test('la lecture en echec retombe sur les defauts plutot que de tout eteindre', async () => {
    mockDb.guild.findUnique.mockImplementationOnce(async () => { throw new Error('base injoignable'); });

    const states = await getModuleStates(GUILD);
    expect(states.tickets).toBeTrue();
    expect(states.activity).toBeTrue();
  });
});

describe('filterGuildsWithModule', () => {
  test('ne garde que les serveurs ou le module tourne', async () => {
    guildRow = { id: GUILD };
    featureRows = [{ guildId: GUILD, featureKey: 'tickets', enabled: false }];
    await invalidateModuleStates(GUILD);

    // Un seul serveur en base ici : le second retombe sur les defauts, donc actif.
    const kept = await filterGuildsWithModule([GUILD], 'tickets');
    expect(kept).toEqual([]);
  });
});

describe('setDashboardModuleStatus', () => {
  test('miroite les colonnes Guild declarees par le registre', async () => {
    await setDashboardModuleStatus(GUILD, 'fun', false);

    expect(mockDb.guild.update).toHaveBeenCalled();
    const call = lastGuildUpdate();
    expect(call.data).toEqual({ funEnabled: false });
  });

  test('ecrit les deux colonnes des sanctions ensemble', async () => {
    await setDashboardModuleStatus(GUILD, 'sanctions', false);

    const call = lastGuildUpdate();
    expect(call.data).toEqual({ sanctionSyncEnabled: false, sanctionReportEnabled: false });
  });

  test('normalise la cle historique avant d ecrire', async () => {
    const result = await setDashboardModuleStatus(GUILD, 'dailyalgo', false);

    expect(result.moduleKey).toBe('daily_algo');
    expect(featureRows.some((row) => row.featureKey === 'daily_algo')).toBeTrue();
    expect(featureRows.some((row) => row.featureKey === 'dailyalgo')).toBeFalse();
  });

  test('desactive les dependants actifs en cascade', async () => {
    featureRows = [
      { guildId: GUILD, featureKey: 'leveling', enabled: true },
      { guildId: GUILD, featureKey: 'seasons', enabled: true },
      { guildId: GUILD, featureKey: 'clans', enabled: true },
    ];

    const result = await setDashboardModuleStatus(GUILD, 'leveling', false);

    expect(result.disabledDependents).toContain('seasons');
    expect(result.disabledDependents).toContain('clans');
    expect(featureRows.find((row) => row.featureKey === 'seasons')?.enabled).toBeFalse();
  });

  test('ne rallume pas un dependant que l admin avait deja eteint', async () => {
    featureRows = [
      { guildId: GUILD, featureKey: 'leveling', enabled: true },
      { guildId: GUILD, featureKey: 'seasons', enabled: false },
    ];

    const result = await setDashboardModuleStatus(GUILD, 'leveling', false);

    expect(result.disabledDependents).not.toContain('seasons');
  });

  test('active les prerequis manquants avec le module demande', async () => {
    featureRows = [{ guildId: GUILD, featureKey: 'economy', enabled: false }];

    const result = await setDashboardModuleStatus(GUILD, 'marketplace', true);

    expect(result.enabledRequirements).toContain('economy');
    expect(featureRows.find((row) => row.featureKey === 'economy')?.enabled).toBeTrue();
  });

  test('refuse d eteindre un module du coeur', async () => {
    await expect(setDashboardModuleStatus(GUILD, 'activity', false)).rejects.toThrow(CoreModuleError);
  });

  test('invalide le cache pour que la bascule prenne effet tout de suite', async () => {
    featureRows = [{ guildId: GUILD, featureKey: 'tickets', enabled: true }];
    expect(await isModuleEnabled(GUILD, 'tickets')).toBeTrue();

    await setDashboardModuleStatus(GUILD, 'tickets', false);

    expect(await isModuleEnabled(GUILD, 'tickets')).toBeFalse();
  });
});
