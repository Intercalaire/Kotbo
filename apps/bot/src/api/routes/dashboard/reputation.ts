import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { json, type AuthClaims, type DashboardAccess } from '../../shared.js';
import { getReputationDashboardData } from '../../../services/community/reputationService.js';
import { getMemberIdentities } from '../../../services/moderation/memberIdentityService.js';

export async function handleReputationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
  _access: DashboardAccess,
): Promise<boolean> {
  const method = req.method;
  if (parts[4] !== 'reputation') return false;

  // GET /api/dashboard/guilds/:guildId/reputation
  if (parts.length === 5 && method === 'GET') {
    try {
      const data = await getReputationDashboardData(guildId);

      // La réputation ne stocke que des identifiants : sans cette résolution, le
      // classement et le flux des votes affichent des suites de chiffres.
      const identities = await getMemberIdentities(client, guildId, [
        ...data.leaderboard.entries.map((entry) => entry.userId),
        ...data.recentVotes.flatMap((vote) => [vote.giverId, vote.receiverId]),
      ]);
      const nameOf = (userId: string) => identities.get(userId)?.displayName ?? null;
      const avatarOf = (userId: string) => identities.get(userId)?.avatarUrl || null;

      json(res, 200, {
        ...data,
        leaderboard: {
          ...data.leaderboard,
          entries: data.leaderboard.entries.map((entry) => ({
            ...entry,
            displayName: nameOf(entry.userId),
            avatarUrl: avatarOf(entry.userId),
          })),
        },
        recentVotes: data.recentVotes.map((vote) => ({
          ...vote,
          giverName: nameOf(vote.giverId),
          giverAvatarUrl: avatarOf(vote.giverId),
          receiverName: nameOf(vote.receiverId),
          receiverAvatarUrl: avatarOf(vote.receiverId),
        })),
      });
    } catch (err) {
      logger.error('ReputationAPI', 'Error fetching reputation data:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des données' });
    }
    return true;
  }

  return false;
}
