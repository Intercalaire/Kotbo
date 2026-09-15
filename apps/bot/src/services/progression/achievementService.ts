import {
  RANK_CARD_ACHIEVEMENTS,
  rankCardAchievementsFromMetrics,
  type RankCardAchievementMetric,
  type RankCardAchievementMetrics,
} from '@kotbo/shared';
import prisma, { prismaRead } from '../../utils/db.js';
import { cache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

// Un renouvellement Stripe peut arriver quelques jours après la fin de période
// (relances de paiement, webhook en retard) : sans marge, chaque retard
// remettait l'ancienneté du payeur à zéro.
const SUPPORTER_GRACE_MS = 7 * DAY_MS;

const PAYING_STATUSES = ['active', 'past_due'];
const FIRST_PLACE_MIN_MEMBERS = 10;
const FIRST_PLACE_MAX_GUILDS = 25;

const EVALUATION_TTL_SECONDS = 60;
const RENDER_TTL_SECONDS = 60;

export type AchievementState = {
  unlocked: Array<{ id: string; unlockedAt: string | null }>;
  metrics: RankCardAchievementMetrics;
};

function evaluationKey(userId: string): string {
  return `user:${userId}:achievements`;
}

function renderKey(userId: string): string {
  return `user:${userId}:achievements_render`;
}

async function isKotboStaff(userId: string): Promise<boolean> {
  if (process.env.DISCORD_CLIENT_OWNER_ID && userId === process.env.DISCORD_CLIENT_OWNER_ID) return true;
  const admin = await prisma.globalAdmin.findUnique({ where: { userId }, select: { userId: true } });
  return Boolean(admin);
}

/**
 * Crée l'ancienneté d'un payeur dont l'abonnement précède ce suivi. Le point de
 * départ est le consentement de paiement le plus ancien, seule trace durable
 * de la souscription ; à défaut, l'ancienneté démarre maintenant.
 */
async function backfillSupporter(userId: string) {
  const guilds = await prismaRead.guild.findMany({
    where: {
      billingOwnerId: userId,
      stripeSubscriptionStatus: { in: PAYING_STATUSES },
      stripeCurrentPeriodEnd: { not: null },
    },
    select: { id: true, stripeCurrentPeriodEnd: true },
  });
  if (guilds.length === 0) return null;

  const consent = await prismaRead.billingConsent.findFirst({
    where: { discordUserId: userId, kind: 'SUBSCRIPTION', guildId: { in: guilds.map((guild) => guild.id) } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const coveredUntil = new Date(Math.max(...guilds.map((guild) => guild.stripeCurrentPeriodEnd!.getTime())));

  return prisma.rankCardSupporter.upsert({
    where: { userId },
    update: {},
    create: { userId, streakStartedAt: consent?.createdAt ?? new Date(), coveredUntil },
  });
}

async function supporterMonths(userId: string): Promise<number> {
  const row = await prisma.rankCardSupporter.findUnique({ where: { userId } }) ?? await backfillSupporter(userId);
  if (!row) return 0;
  const end = Math.min(Date.now(), row.coveredUntil.getTime());
  return Math.max(0, Math.floor((end - row.streakStartedAt.getTime()) / MONTH_MS));
}

async function firstPlaces(userId: string): Promise<number> {
  const rows = await prismaRead.memberLevel.findMany({
    where: { userId, xp: { gt: 0 } },
    select: { guildId: true, xp: true },
    orderBy: { xp: 'desc' },
    take: FIRST_PLACE_MAX_GUILDS,
  });

  for (const row of rows) {
    const ahead = await prismaRead.memberLevel.count({ where: { guildId: row.guildId, xp: { gt: row.xp } } });
    if (ahead > 0) continue;
    const members = await prismaRead.memberLevel.count({ where: { guildId: row.guildId } });
    if (members >= FIRST_PLACE_MIN_MEMBERS) return 1;
  }
  return 0;
}

const METRIC_READERS: Record<RankCardAchievementMetric, (userId: string) => Promise<number>> = {
  staff: async (userId) => (await isKotboStaff(userId) ? 1 : 0),
  supporterMonths,
  giftsOffered: (userId) => prismaRead.billingGift.count({
    where: { purchasedById: userId, paidAt: { not: null }, source: { not: 'ADMIN' } },
  }),
  maxLevel: async (userId) => {
    const result = await prismaRead.memberLevel.aggregate({ where: { userId }, _max: { level: true } });
    return result._max.level ?? 0;
  },
  firstPlaces,
  reputation: async (userId) => {
    const result = await prismaRead.reputationVote.aggregate({ where: { receiverId: userId }, _sum: { value: true } });
    return Math.max(0, result._sum.value ?? 0);
  },
  starboard: (userId) => prismaRead.starboardEntry.count({ where: { authorId: userId, postedAt: { not: null } } }),
  questsClaimed: (userId) => prismaRead.questProgress.count({ where: { userId, status: 'CLAIMED' } }),
};

/**
 * Évaluation complète : lit toutes les métriques, enregistre les succès
 * nouvellement atteints et renvoie l'état pour le dashboard.
 *
 * Réservée au dashboard. `/rank` passe par `getRenderableAchievements`, qui
 * ne relit que les succès déjà enregistrés : un succès se choisit depuis le
 * dashboard, il y est donc forcément évalué avant de pouvoir apparaître.
 */
export async function evaluateAchievements(userId: string): Promise<AchievementState> {
  const cached = await cache.get<AchievementState>(evaluationKey(userId));
  if (cached) return cached;

  const persisted = await prisma.userAchievement.findMany({
    where: { userId },
    select: { achievementId: true, unlockedAt: true },
  });
  const persistedAt = new Map(persisted.map((row) => [row.achievementId, row.unlockedAt]));

  const metrics = {} as RankCardAchievementMetrics;
  const metricNames = Object.keys(METRIC_READERS) as RankCardAchievementMetric[];

  await Promise.all(metricNames.map(async (metric) => {
    const tiers = RANK_CARD_ACHIEVEMENTS.filter((achievement) => achievement.metric === metric);
    // Tous les paliers déjà acquis : relire la métrique ne changerait rien.
    if (tiers.every((achievement) => !achievement.revocable && persistedAt.has(achievement.id))) {
      metrics[metric] = Math.max(...tiers.map((achievement) => achievement.threshold));
      return;
    }
    try {
      metrics[metric] = await METRIC_READERS[metric](userId);
    } catch (error) {
      logger.warn('Achievements', `Métrique ${metric} illisible pour ${userId}:`, error);
      metrics[metric] = 0;
    }
  }));

  const reached = rankCardAchievementsFromMetrics(metrics);
  const toPersist = reached.filter((achievement) => !achievement.revocable && !persistedAt.has(achievement.id));

  if (toPersist.length > 0) {
    const now = new Date();
    await prisma.userAchievement.createMany({
      data: toPersist.map((achievement) => ({ userId, achievementId: achievement.id, unlockedAt: now })),
      skipDuplicates: true,
    });
    for (const achievement of toPersist) persistedAt.set(achievement.id, now);
    await cache.delete(renderKey(userId));
  }

  const reachedIds = new Set(reached.map((achievement) => achievement.id));
  const unlocked = RANK_CARD_ACHIEVEMENTS
    .filter((achievement) => achievement.revocable ? reachedIds.has(achievement.id) : persistedAt.has(achievement.id))
    .map((achievement) => ({
      id: achievement.id,
      unlockedAt: persistedAt.get(achievement.id)?.toISOString() ?? null,
    }));

  const state = { unlocked, metrics };
  await cache.set(evaluationKey(userId), state, EVALUATION_TTL_SECONDS);
  return state;
}

/** Succès utilisables pour dessiner la carte : enregistrés, plus le statut staff courant. */
export async function getRenderableAchievements(userId: string): Promise<Set<string>> {
  const cached = await cache.get<string[]>(renderKey(userId));
  if (cached) return new Set(cached);

  try {
    const [persisted, staff] = await Promise.all([
      prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
      isKotboStaff(userId),
    ]);
    const ids = persisted.map((row) => row.achievementId);
    if (staff) ids.push('kotbo_staff');
    await cache.set(renderKey(userId), ids, RENDER_TTL_SECONDS);
    return new Set(ids);
  } catch (error) {
    logger.warn('Achievements', `Succès illisibles pour ${userId}:`, error);
    return new Set();
  }
}

/**
 * Prolonge l'ancienneté d'un payeur jusqu'à `coveredUntil`. Appelée à chaque
 * synchronisation d'un abonnement payé : idempotente, un rejeu ne fait que
 * réécrire la même échéance.
 */
export async function recordSupporterCoverage(userId: string, coveredUntil: Date): Promise<void> {
  const now = new Date();
  const existing = await prisma.rankCardSupporter.findUnique({ where: { userId } }) ?? await backfillSupporter(userId);
  const lapsed = !existing || existing.coveredUntil.getTime() + SUPPORTER_GRACE_MS < now.getTime();
  // Un payeur de plusieurs serveurs reste couvert par l'échéance la plus lointaine.
  const nextCoveredUntil = existing && existing.coveredUntil > coveredUntil ? existing.coveredUntil : coveredUntil;

  await prisma.rankCardSupporter.upsert({
    where: { userId },
    update: { coveredUntil: nextCoveredUntil, ...(lapsed ? { streakStartedAt: now } : {}) },
    create: { userId, streakStartedAt: now, coveredUntil },
  });
  await cache.delete(evaluationKey(userId));
}
