import {
  DEFAULT_RANK_CARD_CUSTOMIZATION,
  normalizeRankCardCustomization,
  type RankCardCustomization,
} from '@kotbo/shared';
import prisma from '../../utils/db.js';
import { cache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { getRenderableAchievements } from './achievementService.js';

// TTL court : l'ecriture rafraichit le cache du processus qui enregistre, mais
// un autre shard garde sa copie L1 jusqu'a expiration. Une minute borne le
// decalage entre l'enregistrement sur le dashboard et le prochain `/rank`.
const CACHE_TTL_SECONDS = 60;

// Versionnee : Redis garde les entrees au-dela d'un redeploiement, et une
// ancienne forme sans `badges` ferait planter le rendu jusqu'a expiration.
function cacheKey(userId: string): string {
  return `user:${userId}:rank_card:v2`;
}

/**
 * La préférence est volontairement hors guilde : la même carte suit
 * l'utilisateur sur tous les serveurs où il lance `/rank`.
 *
 * Les éléments réservés sont revérifiés à la lecture et pas seulement à
 * l'enregistrement : un administrateur retiré ne doit pas garder sa couronne.
 *
 * Lève en cas d'échec, sans rien mettre en cache : une carte dégradée écrite
 * dans le cache serait relue par le dashboard, puis réenregistrée par-dessus la
 * vraie préférence au prochain clic sur « Enregistrer ».
 */
export async function readRankCardCustomization(userId: string): Promise<RankCardCustomization> {
  const key = cacheKey(userId);
  const cached = await cache.get<RankCardCustomization>(key);
  if (cached) return cached;

  const preference = await prisma.rankCardPreference.findUnique({ where: { userId } });
  const customization = preference
    ? normalizeRankCardCustomization(
      {
        backgroundId: preference.backgroundId,
        fontId: preference.fontId,
        emojis: preference.emojis,
        frameId: preference.frameId,
        patternId: preference.patternId,
        barStyleId: preference.barStyleId,
        titleId: preference.titleId,
        badges: preference.badges,
      },
      await getRenderableAchievements(userId),
    )
    : DEFAULT_RANK_CARD_CUSTOMIZATION;

  await cache.set(key, customization, CACHE_TTL_SECONDS);
  return customization;
}

export async function invalidateRankCardCustomization(userId: string): Promise<void> {
  await cache.delete(cacheKey(userId));
}

/** Variante tolérante pour le rendu : un `/rank` par défaut vaut mieux qu'un `/rank` cassé. */
export async function getRankCardCustomization(userId: string): Promise<RankCardCustomization> {
  try {
    return await readRankCardCustomization(userId);
  } catch (error) {
    logger.warn('RankCard', `Lecture de la personnalisation impossible pour ${userId}:`, error);
    return DEFAULT_RANK_CARD_CUSTOMIZATION;
  }
}

/**
 * Enregistrement partiel : un champ absent du corps garde sa valeur en base.
 *
 * Sans cela, un onglet de dashboard ouvert avant une mise à jour effacerait les
 * réglages qu'il ne connaît pas encore, puisqu'il n'en envoie aucune valeur.
 * `null` reste une valeur transmise, et retire bien le titre.
 */
export async function saveRankCardCustomization(
  userId: string,
  raw: unknown,
  unlocked: ReadonlySet<string>,
): Promise<RankCardCustomization> {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const stored = await prisma.rankCardPreference.findUnique({ where: { userId } });
  const previous = stored
    ? {
      backgroundId: stored.backgroundId,
      fontId: stored.fontId,
      emojis: stored.emojis,
      frameId: stored.frameId,
      patternId: stored.patternId,
      barStyleId: stored.barStyleId,
      titleId: stored.titleId,
      badges: stored.badges,
    }
    : {};

  const customization = normalizeRankCardCustomization({ ...previous, ...body }, unlocked);

  const columns = {
    backgroundId: customization.backgroundId,
    fontId: customization.fontId,
    emojis: customization.emojis,
    frameId: customization.frameId,
    patternId: customization.patternId,
    barStyleId: customization.barStyleId,
    titleId: customization.titleId,
    badges: customization.badges,
  };

  await prisma.rankCardPreference.upsert({
    where: { userId },
    update: columns,
    create: { userId, ...columns },
  });

  await cache.set(cacheKey(userId), customization, CACHE_TTL_SECONDS);
  return customization;
}
