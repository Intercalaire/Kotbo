/**
 * Nommé zz-* volontairement : bun exécute les fichiers par ordre alphabétique et
 * mock.module est global au process. Ce fichier mocke utils/logger, ce qui
 * casserait logger.test.ts s'il s'exécutait avant lui.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';
import { completeModuleMock } from '../helpers/moduleMock.js';

const moduleMocks: Array<[string, () => Record<string, unknown>]> = [
  ['../../utils/db', () => ({ default: {}, prisma: {}, prismaRead: {} })],
  // Mock COMPLET : `mock.module` est global au process, un mock partiel ferait
  // disparaitre initRedis & co. pour les fichiers de test charges ensuite.
  ['../../infra/redis', () => completeModuleMock(
    path.resolve(import.meta.dir, '../../infra/redis.ts'),
    { getRedis: () => null }, // pas de Redis : L1 mémoire uniquement
  )],
  ['../../utils/logger', () => ({
    logger: {
      info: mock(() => undefined), warn: mock(() => undefined),
      error: mock(() => undefined), debug: mock(() => undefined), success: mock(() => undefined),
    },
  })],
];

for (const [relativePath, factory] of moduleMocks) {
  mock.module(path.resolve(import.meta.dir, `${relativePath}.ts`), factory);
  mock.module(path.resolve(import.meta.dir, `${relativePath}.js`), factory);
}

const { cache } = await import('../../utils/cache.js');

const guildId = '987654321098765432';

/** Doit rester identique à la clé construite dans routes/dashboard/analytics.ts */
const advancedKey = (g: string, section: string) => `guild:${g}:analytics:advanced:${section}`;

describe('invalidateGuild couvre le cache des analytics avancées', () => {
  beforeEach(async () => {
    await cache.invalidateGuild(guildId);
  });

  test('purge le payload words quand la config du serveur change', async () => {
    // Reproduit le bug : les stats de mots étaient servies avec enabled:false
    // pendant 5 min après activation, car la clé échappait à l'invalidation.
    await cache.set(advancedKey(guildId, 'words'), { enabled: false, topWords: [] }, 300);
    expect(await cache.get<unknown>(advancedKey(guildId, 'words'))).toEqual({ enabled: false, topWords: [] });

    await cache.invalidateGuild(guildId);

    expect(await cache.get(advancedKey(guildId, 'words'))).toBeNull();
  });

  test('purge toutes les sections et la config du bot en une fois', async () => {
    await cache.set(advancedKey(guildId, 'words'), { enabled: false }, 300);
    await cache.set(advancedKey(guildId, 'moderation'), { cleanableBans: 0 }, 300);
    await cache.set(`guild:${guildId}:config`, { wordStatsEnabled: false }, 60);

    await cache.invalidateGuild(guildId);

    expect(await cache.get(advancedKey(guildId, 'words'))).toBeNull();
    expect(await cache.get(advancedKey(guildId, 'moderation'))).toBeNull();
    expect(await cache.get(`guild:${guildId}:config`)).toBeNull();
  });

  test("n'affecte pas les autres serveurs", async () => {
    const otherGuild = '111111111111111111';
    await cache.set(advancedKey(otherGuild, 'words'), { enabled: true }, 300);

    await cache.invalidateGuild(guildId);

    expect(await cache.get<unknown>(advancedKey(otherGuild, 'words'))).toEqual({ enabled: true });
    await cache.invalidateGuild(otherGuild);
  });

  test('une clé hors préfixe guild: échapperait à la purge (garde anti-régression)', async () => {
    // Forme de l'ancienne clé buguée - documentée pour éviter d'y revenir.
    const legacyKey = `analytics:advanced:${guildId}:words`;
    await cache.set(legacyKey, { enabled: false }, 300);

    await cache.invalidateGuild(guildId);

    expect(await cache.get(legacyKey)).not.toBeNull();
    await cache.delete(legacyKey);
  });
});
