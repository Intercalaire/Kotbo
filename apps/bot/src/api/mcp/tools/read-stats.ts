/** Outils MCP - read stats (permission READ_STATS). */
import prisma from '../../../utils/db.js';
import { z } from 'zod';
import { type McpToolContext, ok } from '../toolkit.js';

export function registerReadStatsTools(ctx: McpToolContext) {
  const { server, guildId, client, shouldRegister, guard, toolMeta } = ctx;

  if (shouldRegister('READ_STATS')) {
    server.registerTool(
      'get_guild_stats',
      {
        description: 'Récupère les statistiques du serveur Discord (membres, messages, sanctions) sur une période donnée.',
        inputSchema: { period_days: z.number().int().min(1).max(90).default(30).describe('Nombre de jours à analyser (1-90)') },
        _meta: toolMeta,
      },
      guard('READ_STATS', async ({ period_days }) => {
        const since = new Date();
        since.setDate(since.getDate() - period_days);
        const sinceKey = since.toISOString().slice(0, 10);

        const stats = await prisma.guildDailyStat.findMany({
          where: { guildId, dateKey: { gte: sinceKey } },
          orderBy: { dateKey: 'asc' },
        });

        const discordGuild = client.guilds.cache.get(guildId);

        const totals = stats.reduce(
          (acc: { messages: number; voiceMinutes: number; joins: number; leaves: number; sanctions: number }, s) => ({
            messages: acc.messages + s.messagesCount,
            voiceMinutes: acc.voiceMinutes + s.voiceMinutes,
            joins: acc.joins + s.membersJoined,
            leaves: acc.leaves + s.membersLeft,
            sanctions: acc.sanctions + s.sanctionsCount,
          }),
          { messages: 0, voiceMinutes: 0, joins: 0, leaves: 0, sanctions: 0 }
        );

        return ok({
          guildId,
          currentMemberCount: discordGuild?.memberCount ?? null,
          period: { from: sinceKey, days: period_days },
          totals,
          trend: stats.map((s) => ({
            date: s.dateKey,
            messages: s.messagesCount,
            voiceMinutes: s.voiceMinutes,
            joins: s.membersJoined,
            leaves: s.membersLeft,
            sanctions: s.sanctionsCount,
          })),
        });
      })
    );
  }
}
