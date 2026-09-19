import { formatWallClockInTimezone } from '@kotbo/contracts';
import prisma, { prismaRead } from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { resolveGuildTimezone } from '../../utils/timezone.js';

export const REP_DAILY_VOTE_LIMIT = 3;

export interface ReputationProfile {
  userId: string;
  totalRep: number;
  rank: number;
  votesGivenToday: number;
  canVote: boolean;
}

export interface ReputationLeaderboard {
  entries: Array<{ userId: string; totalRep: number; rank: number }>;
  totalVoters: number;
}

async function currentRepDay(guildId: string): Promise<string> {
  return formatWallClockInTimezone(new Date(), await resolveGuildTimezone(guildId)).slice(0, 10);
}

export async function getVotesGivenToday(guildId: string, userId: string): Promise<number> {
  const day = await currentRepDay(guildId);
  return prismaRead.reputationVote.count({
    where: { guildId, giverId: userId, day },
  });
}

export async function giveRep(
  guildId: string,
  giverId: string,
  receiverId: string,
  reason?: string,
  options: { receiverIsBot?: boolean } = {},
): Promise<{ success: boolean; error?: string; newTotal?: number }> {
  if (giverId === receiverId) {
    return { success: false, error: 'Vous ne pouvez pas vous donner de la réputation.' };
  }
  if (options.receiverIsBot) {
    return { success: false, error: 'Les bots ne peuvent pas recevoir de réputation.' };
  }

  const day = await currentRepDay(guildId);
  const limitReached = { success: false, error: `Vous avez atteint la limite de ${REP_DAILY_VOTE_LIMIT} votes par jour.` };

  // Lectures sur le primaire : un réplica en retard laisserait passer un double clic.
  const votesToday = await prisma.reputationVote.count({ where: { guildId, giverId, day } });
  if (votesToday >= REP_DAILY_VOTE_LIMIT) return limitReached;

  let voteId: string;
  try {
    const vote = await prisma.reputationVote.create({
      data: { guildId, giverId, receiverId, value: 1, reason, day },
      select: { id: true },
    });
    voteId = vote.id;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return { success: false, error: 'Vous avez déjà donné un +rep à cette personne aujourd\'hui.' };
    }
    throw err;
  }

  // L'index unique ne couvre que le couple donneur/receveur : des votes simultanés
  // vers des membres différents peuvent dépasser la limite, on annule alors celui-ci.
  const votesAfter = await prisma.reputationVote.count({ where: { guildId, giverId, day } });
  if (votesAfter > REP_DAILY_VOTE_LIMIT) {
    await prisma.reputationVote.delete({ where: { id: voteId } }).catch(() => null);
    return limitReached;
  }

  const newTotal = await prisma.reputationVote.aggregate({
    where: { guildId, receiverId },
    _sum: { value: true },
  });

  logger.debug('Reputation', `${giverId} → +rep → ${receiverId} (guild: ${guildId})`);

  return { success: true, newTotal: newTotal._sum.value ?? 0 };
}

export async function getReputation(guildId: string, userId: string): Promise<ReputationProfile> {
  const [totalAgg, votesToday, allReps] = await Promise.all([
    prismaRead.reputationVote.aggregate({
      where: { guildId, receiverId: userId },
      _sum: { value: true },
    }),
    getVotesGivenToday(guildId, userId),
    prismaRead.reputationVote.groupBy({
      by: ['receiverId'],
      where: { guildId },
      _sum: { value: true },
      orderBy: { _sum: { value: 'desc' } },
    }),
  ]);

  const totalRep = totalAgg._sum.value ?? 0;
  const rankIndex = allReps.findIndex((r) => r.receiverId === userId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : allReps.length + 1;

  return {
    userId,
    totalRep,
    rank,
    votesGivenToday: votesToday,
    canVote: votesToday < REP_DAILY_VOTE_LIMIT,
  };
}

export async function getReputationLeaderboard(guildId: string, limit = 15): Promise<ReputationLeaderboard> {
  const reps = await prismaRead.reputationVote.groupBy({
    by: ['receiverId'],
    where: { guildId },
    _sum: { value: true },
    orderBy: { _sum: { value: 'desc' } },
    take: limit,
  });

  const totalVoters = await prismaRead.reputationVote.groupBy({
    by: ['giverId'],
    where: { guildId },
  });

  return {
    entries: reps.map((r, i) => ({
      userId: r.receiverId,
      totalRep: r._sum.value ?? 0,
      rank: i + 1,
    })),
    totalVoters: totalVoters.length,
  };
}

export async function getReputationDashboardData(guildId: string) {
  const [leaderboard, recentVotes, totalVotes] = await Promise.all([
    getReputationLeaderboard(guildId, 20),
    prismaRead.reputationVote.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { giverId: true, receiverId: true, reason: true, createdAt: true },
    }),
    prismaRead.reputationVote.count({ where: { guildId } }),
  ]);

  return { leaderboard, recentVotes, totalVotes };
}
