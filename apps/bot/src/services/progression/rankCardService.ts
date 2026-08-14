import {
  DEFAULT_RANK_CARD_CUSTOMIZATION,
  normalizeRankCardCustomization,
  type RankCardCustomization,
} from '@kotbo/shared';
import prisma from '../../utils/db.js';
import { cache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';

// TTL court : l'ecriture rafraichit le cache du processus qui enregistre, mais
// un autre shard garde sa copie L1 jusqu'a expiration. Une minute borne le
// decalage entre l'enregistrement sur le dashboard et le prochain `/rank`.
const CACHE_TTL_SECONDS = 60;

function cacheKey(userId: string): string {
  return `user:${userId}:rank_card`;
}

/**
 * La préférence est volontairement hors guilde : la même carte suit
 * l'utilisateur sur tous les serveurs où il lance `/rank`.
 */
export async function getRankCardCustomization(userId: string): Promise<RankCardCustomization> {
  const key = cacheKey(userId);
  const cached = await cache.get<RankCardCustomization>(key);
  if (cached) return cached;

  try {
    const preference = await prisma.rankCardPreference.findUnique({ where: { userId } });
    const customization = preference
      ? normalizeRankCardCustomization({
        backgroundId: preference.backgroundId,
        fontId: preference.fontId,
        emojis: preference.emojis,
      })
      : DEFAULT_RANK_CARD_CUSTOMIZATION;

    await cache.set(key, customization, CACHE_TTL_SECONDS);
    return customization;
  } catch (error) {
    logger.warn('RankCard', `Lecture de la personnalisation impossible pour ${userId}:`, error);
    return DEFAULT_RANK_CARD_CUSTOMIZATION;
  }
}

export async function saveRankCardCustomization(userId: string, raw: unknown): Promise<RankCardCustomization> {
  const customization = normalizeRankCardCustomization(raw);

  const columns = {
    backgroundId: customization.backgroundId,
    fontId: customization.fontId,
    emojis: customization.emojis,
  };

  await prisma.rankCardPreference.upsert({
    where: { userId },
    update: columns,
    create: { userId, ...columns },
  });

  await cache.set(cacheKey(userId), customization, CACHE_TTL_SECONDS);
  return customization;
}
