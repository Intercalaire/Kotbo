/**
 * Classements RP : local (une guilde) et global (inter-serveurs).
 *
 * Le global est un agrégat coûteux, borné par le cache : il n'a pas besoin
 * d'être à la seconde près, contrairement au classement d'un serveur qu'un
 * membre consulte juste après avoir écrit.
 */

import { rankedProgress, resolveRankedTier, streakFlames, type RankedLadderEntry } from '@kotbo/shared';
import prisma, { prismaRead } from '../../../utils/db.js';
import { cache } from '../../../utils/cache.js';
import { getGuildLadder } from './rankedConfigService.js';

const GLOBAL_CACHE_KEY = 'ranked:global_leaderboard';
const GLOBAL_TTL_SECONDS = 300;

export type RankedLeaderboardEntry = {
  rank: number;
  userId: string;
  rp: number;
  tier: RankedLadderEntry;
  streakDays: number;
  flames: number;
  percent: number;
};

export async function getRankedLeaderboard(guildId: string, limit = 10, offset = 0): Promise<RankedLeaderboardEntry[]> {
  const ladder = await getGuildLadder(guildId);

  const members = await prismaRead.rankedMember.findMany({
    where: { guildId, rp: { gt: 0 } },
    orderBy: [{ rp: 'desc' }, { userId: 'asc' }],
    take: Math.min(100, Math.max(1, limit)),
    skip: Math.max(0, offset),
    select: { userId: true, rp: true, streakDays: true },
  });

  return members.map((member, index) => {
    const progress = rankedProgress(member.rp, ladder);
    return {
      rank: offset + index + 1,
      userId: member.userId,
      rp: member.rp,
      tier: progress.current,
      streakDays: member.streakDays,
      flames: streakFlames(member.streakDays),
      percent: progress.percent,
    };
  });
}

/** Classement des séries en cours : le « #1 Streaks » de la carte de profil. */
export async function getStreakLeaderboard(guildId: string, limit = 10) {
  const members = await prismaRead.rankedMember.findMany({
    where: { guildId, streakDays: { gt: 0 } },
    orderBy: [{ streakDays: 'desc' }, { bestStreak: 'desc' }],
    take: Math.min(100, Math.max(1, limit)),
    select: { userId: true, streakDays: true, bestStreak: true, lastActiveDate: true },
  });

  return members.map((member, index) => ({
    rank: index + 1,
    userId: member.userId,
    streakDays: member.streakDays,
    bestStreak: member.bestStreak,
    flames: streakFlames(member.streakDays),
    lastActiveDate: member.lastActiveDate,
  }));
}

export type GlobalLeaderboardEntry = {
  rank: number;
  userId: string;
  rp: number;
  guilds: number;
  tier: RankedLadderEntry;
};

/**
 * Classement global : somme du RP d'un membre sur tous les serveurs qui
 * participent.
 *
 * Double consentement - la guilde via `RankedConfig.globalLeaderboard`, le
 * membre via `RankedMember.globalOptOut`. Un serveur privé ne doit pas exposer
 * l'activité de ses membres dans un classement public, et un membre doit
 * pouvoir s'en retirer sans quitter le classement de son serveur.
 *
 * Le palier est calculé sur l'échelle par défaut : les échelles personnalisées
 * ne sont pas comparables entre serveurs.
 */
export async function getGlobalLeaderboard(limit = 25): Promise<GlobalLeaderboardEntry[]> {
  const cached = await cache.get<GlobalLeaderboardEntry[]>(GLOBAL_CACHE_KEY);
  if (cached) return cached.slice(0, limit);

  const participating = await prismaRead.rankedConfig.findMany({
    where: { enabled: true, globalLeaderboard: true },
    select: { guildId: true },
  });

  if (participating.length === 0) {
    await cache.set(GLOBAL_CACHE_KEY, [], GLOBAL_TTL_SECONDS);
    return [];
  }

  const grouped = await prismaRead.rankedMember.groupBy({
    by: ['userId'],
    where: {
      guildId: { in: participating.map((row) => row.guildId) },
      globalOptOut: false,
      rp: { gt: 0 },
    },
    _sum: { rp: true },
    _count: { guildId: true },
    orderBy: { _sum: { rp: 'desc' } },
    take: 100,
  });

  const entries: GlobalLeaderboardEntry[] = grouped.map((row, index) => {
    const rp = row._sum.rp ?? 0;
    return {
      rank: index + 1,
      userId: row.userId,
      rp,
      guilds: row._count.guildId,
      tier: resolveRankedTier(rp),
    };
  });

  await cache.set(GLOBAL_CACHE_KEY, entries, GLOBAL_TTL_SECONDS);
  return entries.slice(0, limit);
}

/** Position d'un membre dans le classement global, `null` s'il n'y figure pas. */
export async function getGlobalRank(userId: string): Promise<{ rank: number; rp: number } | null> {
  const entries = await getGlobalLeaderboard(100);
  const found = entries.find((entry) => entry.userId === userId);
  return found ? { rank: found.rank, rp: found.rp } : null;
}

export async function invalidateGlobalLeaderboard(): Promise<void> {
  await cache.delete(GLOBAL_CACHE_KEY);
}

/** Retrait / retour d'un membre dans le classement global. */
export async function setGlobalOptOut(guildId: string, userId: string, optOut: boolean): Promise<void> {
  await prisma.rankedMember.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: { globalOptOut: optOut },
    create: { guildId, userId, globalOptOut: optOut },
  });
  await invalidateGlobalLeaderboard();
}

/** Chiffres d'en-tête du dashboard. */
export async function getRankedGuildStats(guildId: string) {
  const [ranked, activeStreaks, aggregate, topTier] = await Promise.all([
    prismaRead.rankedMember.count({ where: { guildId, rp: { gt: 0 } } }),
    prismaRead.rankedMember.count({ where: { guildId, streakDays: { gte: 2 } } }),
    prismaRead.rankedMember.aggregate({
      where: { guildId },
      _sum: { rp: true },
      _max: { rp: true, bestStreak: true },
      _avg: { rp: true },
    }),
    prismaRead.rankedMember.findFirst({
      where: { guildId },
      orderBy: { rp: 'desc' },
      select: { userId: true, rp: true },
    }),
  ]);

  const ladder = await getGuildLadder(guildId);

  return {
    rankedMembers: ranked,
    activeStreaks,
    totalRp: aggregate._sum.rp ?? 0,
    averageRp: Math.round(aggregate._avg.rp ?? 0),
    bestStreak: aggregate._max.bestStreak ?? 0,
    top: topTier ? { userId: topTier.userId, rp: topTier.rp, tier: resolveRankedTier(topTier.rp, ladder) } : null,
  };
}
