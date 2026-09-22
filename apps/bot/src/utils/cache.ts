import type { DashboardSettings, Guild } from '@prisma/client';
import { getRedis } from '../infra/redis.js';
import { logger } from './logger.js';
import prisma from './db.js';

interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const memoryCache = new Map<string, MemoryCacheEntry<unknown>>();

/**
 * Calculs en cours, indexés par clé de cache. Vidé dans le `finally` de chaque
 * promesse : une erreur du chargeur ne doit pas condamner la clé, sinon un
 * incident passager de la base gèlerait durablement une lecture pourtant
 * redevenue possible.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Valeur horodatée écrite par `cache.swr`. Le marqueur `__swr` permet de
 * distinguer une enveloppe d'une valeur nue laissée par `wrap` ou `set` sur la
 * même clé : dans ce cas on recharge, plutôt que de servir n'importe quoi.
 */
interface SwrEnvelope<T> {
  __swr: 1;
  v: T;
  t: number;
}

function isSwrEnvelope<T>(value: unknown): value is SwrEnvelope<T> {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { __swr?: unknown }).__swr === 1
    && typeof (value as { t?: unknown }).t === 'number'
  );
}
const parsedMaxEntries = Number.parseInt(process.env.MEMORY_CACHE_MAX_ENTRIES ?? '10000', 10);
const MEMORY_CACHE_MAX_ENTRIES = Number.isFinite(parsedMaxEntries) && parsedMaxEntries > 0
  ? parsedMaxEntries
  : 10_000;

function setMemoryCache<T>(key: string, value: T, expiresAt: number): void {
  // Map conserve l'ordre d'insertion : réinsérer une clé existante permet une
  // éviction approximativement LRU, sans minuterie ni parcours sur chaque hit.
  memoryCache.delete(key);

  if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [cachedKey, entry] of memoryCache) {
      if (entry.expiresAt <= now) memoryCache.delete(cachedKey);
    }
  }

  while (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    memoryCache.delete(oldestKey);
  }

  memoryCache.set(key, { value, expiresAt });
}

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    // 1. Check in-memory L1 cache first
    const cached = memoryCache.get(key);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.value as T;
      }
      memoryCache.delete(key);
    }

    // 2. Fallback to Redis L2 cache
    try {
      const redis = getRedis();
      if (redis) {
        const val = await redis.get(key);
        if (val) {
          const parsed = JSON.parse(val) as T;
          // Store in L1 memory cache for 5 seconds to buffer consecutive checks
          setMemoryCache(key, parsed, Date.now() + 5000);
          return parsed;
        }
        return null;
      }
    } catch (err) {
      logger.error('Cache', `Redis GET error for key ${key}`, err);
    }

    return null;
  },

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    // Store in L1 memory cache
    setMemoryCache(key, value, Date.now() + ttlSeconds * 1000);

    // Store in Redis L2 cache
    try {
      const redis = getRedis();
      if (redis) {
        await redis.setex(key, ttlSeconds, JSON.stringify(value));
      }
    } catch (err) {
      logger.error('Cache', `Redis SETEX error for key ${key}`, err);
    }
  },

  async delete(key: string): Promise<void> {
    // Clear L1 memory cache
    memoryCache.delete(key);
    // Une lecture déjà lancée porte l'état d'avant l'écriture qui invalide :
    // la laisser en vol la ferait réécrire par-dessus l'invalidation.
    inFlight.delete(key);

    // Clear Redis L2 cache
    try {
      const redis = getRedis();
      if (redis) {
        await redis.del(key);
      }
    } catch (err) {
      logger.error('Cache', `Redis DEL error for key ${key}`, err);
    }
  },

  /**
   * Lit la clé, ou la calcule puis la mémorise.
   *
   * L'intérêt n'est pas l'économie de lignes : c'est la déduplication. Le
   * schéma `get` puis `set` recopié sur chaque site laisse passer toutes les
   * requêtes concurrentes qui arrivent pendant le calcul, puisqu'aucune n'a
   * encore rien écrit. Sur une clé chaude — la configuration d'un serveur
   * actif, relue à chaque message — l'expiration du TTL déclenche donc une
   * rafale de requêtes identiques vers Postgres, exactement au moment où le
   * cache est censé le protéger. On conserve ici la promesse en cours pour que
   * les appels simultanés s'y rattachent au lieu d'ouvrir leur propre requête.
   */
  async wrap<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = (async () => {
      const value = await loader();
      if (value !== null && value !== undefined) {
        await this.set(key, value, ttlSeconds);
      }
      return value;
    })().finally(() => {
      inFlight.delete(key);
    });

    inFlight.set(key, promise as Promise<unknown>);
    return promise;
  },

  /**
   * Comme `wrap`, mais ne fait jamais attendre un appelant sur une clé déjà
   * chargée une fois : passé `freshTtlSeconds`, la valeur périmée part
   * immédiatement et le rechargement se fait derrière.
   *
   * Motivation : `wrap` met la requête de rechargement sur le chemin critique
   * d'un appelant sur N. Pour les gardes traversées par chaque interaction
   * Discord, cet appelant-là dépassait la fenêtre d'accusé de réception de 3 s
   * et récoltait un 10062, alors que la valeur servie juste avant convenait.
   *
   * L'enveloppe est stockée SOUS LA MÊME CLÉ que la valeur nue : les
   * invalidations existantes (`cache.delete(key)`) continuent donc de mordre.
   */
  async swr<T>(
    key: string,
    freshTtlSeconds: number,
    loader: () => Promise<T>,
    staleTtlSeconds?: number,
  ): Promise<T> {
    const staleTtl = staleTtlSeconds ?? Math.max(freshTtlSeconds * 10, freshTtlSeconds + 60);

    const refresh = (): Promise<T> => {
      const pending = inFlight.get(key);
      if (pending) return pending as Promise<T>;

      const promise = (async () => {
        const value = await loader();
        if (value !== null && value !== undefined) {
          await this.set(key, { __swr: 1, v: value, t: Date.now() }, staleTtl);
        }
        return value;
      })().finally(() => {
        inFlight.delete(key);
      });

      inFlight.set(key, promise as Promise<unknown>);
      return promise;
    };

    const stored = await this.get<SwrEnvelope<T>>(key);
    if (isSwrEnvelope<T>(stored)) {
      if (Date.now() - stored.t < freshTtlSeconds * 1000) return stored.v;

      // Périmée mais exploitable : on rend la main tout de suite. L'erreur d'un
      // rechargement de fond ne doit pas remonter en rejet non géré.
      refresh().catch((err) => {
        logger.warn('Cache', `Rechargement en arrière-plan impossible pour ${key}:`, err);
      });
      return stored.v;
    }

    return refresh();
  },

  async invalidateGuild(guildId: string): Promise<void> {
    const prefix = `guild:${guildId}:`;

    for (const key of memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        memoryCache.delete(key);
      }
    }

    for (const key of inFlight.keys()) {
      if (key.startsWith(prefix)) {
        inFlight.delete(key);
      }
    }

    try {
      const redis = getRedis();
      if (redis) {
        let cursor = '0';
        const keysToDelete: string[] = [];
        do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
          cursor = nextCursor;
          keysToDelete.push(...keys);
        } while (cursor !== '0');

        if (keysToDelete.length > 0) {
          const pipeline = redis.pipeline();
          for (let i = 0; i < keysToDelete.length; i += 1000) {
            pipeline.del(...keysToDelete.slice(i, i + 1000));
          }
          await pipeline.exec();
        }
      }
    } catch (err) {
      logger.error('Cache', `Redis pattern delete error for prefix ${prefix}`, err);
    }
  }
};

/**
 * Durée pendant laquelle on cesse d'interroger la base pour un serveur dont la
 * ligne est illisible. Sans ce garde-fou, une seule ligne corrompue (ex. chunk
 * TOAST manquant) est réinterrogée à chaque message, sur chaque module.
 */
const GUILD_READ_FAILURE_BACKOFF_MS = 60_000;
const guildReadFailures = new Map<string, number>();

/**
 * Retrieves the cached Guild configuration, or queries the database and caches it.
 *
 * Une lecture qui échoue ne remonte pas : les appelants sont des écouteurs
 * d'événements Discord, et propager l'erreur ferait tomber le shard entier
 * pour un seul serveur en défaut. On renvoie `null`, ce que tous les appelants
 * traitent déjà comme « configuration absente, module inactif ».
 */
export async function getCachedGuild(guildId: string) {
  const cacheKey = `guild:${guildId}:config`;

  return cache.wrap<Guild | null>(cacheKey, 60, async () => {
    const failedAt = guildReadFailures.get(guildId);
    if (failedAt && Date.now() - failedAt < GUILD_READ_FAILURE_BACKOFF_MS) {
      return null;
    }

    try {
      const guild = await prisma.guild.findUnique({
        where: { id: guildId },
      });
      guildReadFailures.delete(guildId);
      return guild;
    } catch (err) {
      guildReadFailures.set(guildId, Date.now());
      logger.error('Cache', `Lecture de la configuration du serveur ${guildId} impossible (nouvelle tentative dans ${GUILD_READ_FAILURE_BACKOFF_MS / 1000}s)`, err);
      return null;
    }
  });
}

/**
 * Retrieves cached DashboardSettings, or queries the database and caches it.
 */
export async function getCachedDashboardSettings(guildId: string) {
  const cacheKey = `guild:${guildId}:dashboard_settings`;

  // `swr` et non `wrap` : cette lecture est sur le chemin de chaque commande
  // Discord, via la garde des restrictions de commandes. Rien n'invalide cette
  // clé à l'écriture, donc le TTL reste la voie de propagation ; le SWR n'y
  // ajoute qu'une seule requête servie périmée, puisque le rechargement part au
  // même instant.
  return cache.swr<DashboardSettings | null>(cacheKey, 60, () =>
    prisma.dashboardSettings.findUnique({ where: { guildId } }),
  );
}
