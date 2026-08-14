import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { rankedTierByKey } from '@kotbo/shared';
import { logger } from '../../../utils/logger.js';
import { json, type AuthClaims, type DashboardAccess } from '../../shared.js';
import {
  getSeasonsDashboardData,
  createSeason,
  startSeason,
  endSeason,
  getSeasonLeaderboard,
} from '../../../services/progression/seasonService.js';
import { getRankedSeasonStandings } from '../../../services/progression/ranked/rankedSeasonService.js';
import { getRankedLeaderboard } from '../../../services/progression/ranked/rankedLeaderboardService.js';
import { getGuildLadder } from '../../../services/progression/ranked/rankedConfigService.js';
import { getMemberIdentities } from '../../../services/moderation/memberIdentityService.js';

/** Le classement archivé ne stocke que des identifiants : il faut les nommer. */
async function withSeasonIdentities<T extends { userId: string }>(
  client: Client,
  guildId: string,
  rows: T[],
): Promise<Array<T & { displayName: string | null; avatarUrl: string | null }>> {
  const identities = await getMemberIdentities(client, guildId, rows.map((row) => row.userId))
    .catch(() => new Map());
  return rows.map((row) => ({
    ...row,
    displayName: identities.get(row.userId)?.displayName ?? null,
    avatarUrl: identities.get(row.userId)?.avatarUrl || null,
  }));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

export async function handleSeasonRoutes(
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
  if (parts[4] !== 'seasons') return false;

  // GET /api/dashboard/guilds/:guildId/seasons
  if (parts.length === 5 && method === 'GET') {
    try {
      const data = await getSeasonsDashboardData(guildId);
      // Le classement d'XP ne montre qu'une moitié de la saison : le RP a le
      // sien, remis à zéro à la clôture, et la page l'ignorait complètement.
      const rankedLeaderboard = await getRankedLeaderboard(guildId, 20).catch(() => []);

      json(res, 200, {
        ...data,
        // Les pseudos manquaient aux deux classements : `MemberLevel` comme
        // `RankedMember` ne stockent que des identifiants.
        activeLeaderboard: await withSeasonIdentities(client, guildId, data.activeLeaderboard),
        activeRankedLeaderboard: await withSeasonIdentities(client, guildId, rankedLeaderboard),
      });
    } catch (err) {
      logger.error('SeasonsAPI', 'Error fetching seasons:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des saisons' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/seasons
  if (parts.length === 5 && method === 'POST') {
    try {
      const body = await parseBody(req) as { name: string; startDate: string; endDate: string; rewards?: any; topRoleId?: string };
      const season = await createSeason(guildId, {
        name: body.name,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        rewards: body.rewards,
        topRoleId: body.topRoleId,
      });
      json(res, 201, season);
    } catch (err) {
      logger.error('SeasonsAPI', 'Error creating season:', err);
      json(res, 500, { error: 'Erreur lors de la création' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/seasons/:seasonId/start
  if (parts.length === 7 && parts[6] === 'start' && method === 'POST') {
    try {
      const success = await startSeason(guildId, parts[5]);
      json(res, success ? 200 : 400, success ? { ok: true } : { error: 'Impossible de démarrer la saison' });
    } catch (err) {
      logger.error('SeasonsAPI', 'Error starting season:', err);
      json(res, 500, { error: 'Erreur lors du démarrage' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/seasons/:seasonId/end
  if (parts.length === 7 && parts[6] === 'end' && method === 'POST') {
    try {
      const success = await endSeason(client, guildId, parts[5]);
      json(res, success ? 200 : 400, success ? { ok: true } : { error: 'Impossible de terminer la saison' });
    } catch (err) {
      logger.error('SeasonsAPI', 'Error ending season:', err);
      json(res, 500, { error: 'Erreur lors de la fin de saison' });
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/seasons/:seasonId/leaderboard
  if (parts.length === 7 && parts[6] === 'leaderboard' && method === 'GET') {
    try {
      const leaderboard = await getSeasonLeaderboard(guildId, parts[5]);
      // Le RP est archivé par la clôture (`RankedSeasonEntry`) mais n'était
      // jamais renvoyé : la page des saisons ne montrait que le classement
      // d'XP, comme si le prestige n'avait pas eu de saison.
      const rankedStandings = await getRankedSeasonStandings(guildId, parts[5])
        .catch(() => [] as Awaited<ReturnType<typeof getRankedSeasonStandings>>);
      const ladder = await getGuildLadder(guildId).catch(() => null);

      json(res, 200, {
        leaderboard,
        rankedStandings: await withSeasonIdentities(client, guildId, rankedStandings.map((entry) => ({
          ...entry,
          tier: ladder ? rankedTierByKey(entry.tierKey, ladder) : null,
        }))),
      });
    } catch (err) {
      logger.error('SeasonsAPI', 'Error fetching leaderboard:', err);
      json(res, 500, { error: 'Erreur lors de la récupération du classement' });
    }
    return true;
  }

  return false;
}
