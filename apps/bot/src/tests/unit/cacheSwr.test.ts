/**
 * `cache.swr` : servir vite, recharger derrière.
 *
 * Le défaut corrigé ici : `cache.wrap` mettait la requête de rechargement sur
 * le chemin critique d'un appelant sur N. Pour les gardes traversées par chaque
 * interaction Discord, cet appelant-là dépassait la fenêtre d'accusé de
 * réception de 3 s et récoltait un 10062.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';

const prismaMock = {};
const silentLogger = {
  info: () => {}, warn: () => {}, error: () => {}, success: () => {}, debug: () => {},
};

for (const extension of ['ts', 'js']) {
  // Sans Redis, `cache` retombe sur son seul cache mémoire : l'expiration suit
  // alors exactement le TTL passé à `set`, ce qui rend le test déterministe.
  mock.module(path.resolve(import.meta.dir, `../../infra/redis.${extension}`), () => ({
    getRedis: () => null,
  }));
  mock.module(path.resolve(import.meta.dir, `../../utils/db.${extension}`), () => ({
    default: prismaMock, prisma: prismaMock, prismaRead: prismaMock,
  }));
  mock.module(path.resolve(import.meta.dir, `../../utils/logger.${extension}`), () => ({
    logger: silentLogger, default: silentLogger,
  }));
}

const { cache } = await import('../../utils/cache.js');

let key: string;
let counter: number;

/** Un chargeur qui numérote ses appels, pour distinguer valeur fraîche et périmée. */
function countingLoader() {
  return async () => {
    counter += 1;
    return { n: counter };
  };
}

beforeEach(async () => {
  key = `test:swr:${Math.random().toString(36).slice(2)}`;
  counter = 0;
  await cache.delete(key);
});

describe('cache.swr', () => {
  test('charge en bloquant quand la clé est froide', async () => {
    const value = await cache.swr(key, 60, countingLoader());

    expect(value).toEqual({ n: 1 });
    expect(counter).toBe(1);
  });

  test('sert la valeur fraîche sans rappeler le chargeur', async () => {
    await cache.swr(key, 60, countingLoader());
    const second = await cache.swr(key, 60, countingLoader());

    expect(second).toEqual({ n: 1 });
    expect(counter).toBe(1);
  });

  test('rend la valeur périmée tout de suite et recharge derrière', async () => {
    await cache.swr(key, 60, countingLoader());

    // `freshTtl` à 0 rend immédiatement périmée toute valeur déjà stockée.
    let released: () => void = () => {};
    const blocked = new Promise<void>((resolve) => { released = resolve; });
    const slowLoader = async () => {
      await blocked;
      counter += 1;
      return { n: counter };
    };

    // Le chargeur est encore bloqué : l'appel doit malgré tout avoir répondu.
    const served = await cache.swr(key, 0, slowLoader);
    expect(served).toEqual({ n: 1 });
    expect(counter).toBe(1);

    released();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Le rechargement de fond a bien eu lieu, et sa valeur est en cache.
    expect(counter).toBe(2);
    expect(await cache.swr(key, 60, countingLoader())).toEqual({ n: 2 });
  });

  test("une invalidation par cache.delete force un rechargement bloquant", async () => {
    await cache.swr(key, 60, countingLoader());
    await cache.delete(key);

    const value = await cache.swr(key, 60, countingLoader());

    expect(value).toEqual({ n: 2 });
    expect(counter).toBe(2);
  });

  test('une valeur nue laissée par wrap sous la même clé est rechargée', async () => {
    await cache.set(key, { n: 99 }, 60);

    const value = await cache.swr(key, 60, countingLoader());

    expect(value).toEqual({ n: 1 });
  });
});
