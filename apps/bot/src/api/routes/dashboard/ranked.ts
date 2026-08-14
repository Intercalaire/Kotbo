/**
 * Routes du module Ranked (classement compétitif RP).
 *
 * Base : `/api/dashboard/guilds/:guildId/ranked`
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { DEFAULT_LADDER_CURVE, DEFAULT_RANKED_LADDER, generateRankedLadder, normalizeRankedLadder } from '@kotbo/shared';
import { logger } from '../../../utils/logger.js';
import { json, type AuthClaims, type DashboardAccess } from '../../shared.js';
import {
  getGuildLadder,
  getOrCreateRankedConfig,
  getTierRoles,
  removeTierRole,
  setTierRole,
  updateRankedConfig,
  type RankedConfigPatch,
} from '../../../services/progression/ranked/rankedConfigService.js';
import {
  computeLadderImpact,
  getTierRoleSyncStatus,
  provisionTierRoles,
  resyncRankedTiers,
  startTierRoleSync,
  stopTierRoleSync,
} from '../../../services/progression/ranked/rankedTierRoleService.js';
import {
  adjustMemberRp,
  getRankedHistory,
  getRankedProfile,
} from '../../../services/progression/ranked/rankedService.js';
import {
  getGlobalLeaderboard,
  getRankedGuildStats,
  getRankedLeaderboard,
  getStreakLeaderboard,
} from '../../../services/progression/ranked/rankedLeaderboardService.js';
import {
  cancelRankedEvent,
  createRankedEvent,
  isRankedEventType,
  listRankedEvents,
} from '../../../services/progression/ranked/rankedEventService.js';
import { previewGuildDecay, runGuildDecay } from '../../../services/progression/ranked/rankedDecayService.js';

const LOG_TAG = 'RankedAPI';

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

export async function handleRankedRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  _user: AuthClaims,
  guildId: string,
  _access: DashboardAccess,
): Promise<boolean> {
  if (parts[4] !== 'ranked') return false;
  const method = req.method;
  const section = parts[5];

  try {
    // GET /ranked - vue d'ensemble (config, échelle, stats, classements, événements)
    if (parts.length === 5 && method === 'GET') {
      const [config, ladder, tierRoles, stats, leaderboard, streaks, events] = await Promise.all([
        getOrCreateRankedConfig(guildId),
        getGuildLadder(guildId),
        getTierRoles(guildId),
        getRankedGuildStats(guildId),
        getRankedLeaderboard(guildId, 25),
        getStreakLeaderboard(guildId, 10),
        listRankedEvents(guildId, 15),
      ]);

      json(res, 200, {
        config,
        ladder,
        defaultLadder: DEFAULT_RANKED_LADDER,
        defaultLadderCurve: DEFAULT_LADDER_CURVE,
        tierRoles,
        tierRoleSync: getTierRoleSyncStatus(guildId),
        stats,
        leaderboard,
        streaks,
        events,
      });
      return true;
    }

    // PATCH /ranked/config
    if (parts.length === 6 && section === 'config' && method === 'PATCH') {
      const body = await parseBody(req);
      // La validation vit dans le service (`sanitizeRankedConfigPatch`) : elle
      // borne aussi les commandes Discord et le MCP, pas seulement cette route.
      const previousLadder = await getGuildLadder(guildId);
      const config = await updateRankedConfig(guildId, body as RankedConfigPatch);
      const ladder = await getGuildLadder(guildId);

      // Une échelle qui bouge redistribue les paliers : la colonne `tierKey`
      // est réalignée tout de suite, sinon un membre inactif garderait une clé
      // absente de la nouvelle échelle jusqu'à son prochain gain de RP. Les
      // rôles, eux, attendent une demande explicite (`tier-roles/sync`) : en
      // déplacer des milliers ne doit pas être l'effet de bord d'un curseur.
      const ladderChanged = JSON.stringify(previousLadder) !== JSON.stringify(ladder);
      const retiered = ladderChanged ? await resyncRankedTiers(guildId, ladder) : 0;

      json(res, 200, { config, ladder, retiered });
      return true;
    }

    // POST /ranked/ladder/impact - répartition des membres sur une échelle
    // proposée, avant enregistrement. Le corps porte soit une échelle complète,
    // soit une courbe ; sans corps, l'échelle enregistrée sert de référence.
    if (parts.length === 7 && section === 'ladder' && parts[6] === 'impact' && method === 'POST') {
      const body = await parseBody(req) as { ladder?: unknown; curve?: unknown };
      const ladder = body.ladder
        ? normalizeRankedLadder(body.ladder)
        : body.curve
          ? generateRankedLadder(body.curve)
          : await getGuildLadder(guildId);

      json(res, 200, { ladder, ...await computeLadderImpact(guildId, ladder) });
      return true;
    }

    // GET /ranked/leaderboard?limit=&offset=
    if (parts.length === 6 && section === 'leaderboard' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const leaderboard = await getRankedLeaderboard(guildId, limit, offset);
      json(res, 200, { leaderboard });
      return true;
    }

    // GET /ranked/global
    if (parts.length === 6 && section === 'global' && method === 'GET') {
      const leaderboard = await getGlobalLeaderboard(Number(url.searchParams.get('limit') ?? 25));
      json(res, 200, { leaderboard });
      return true;
    }

    // GET /ranked/members/:userId
    if (parts.length === 7 && section === 'members' && method === 'GET') {
      const [profile, history] = await Promise.all([
        getRankedProfile(guildId, parts[6]),
        getRankedHistory(guildId, parts[6]),
      ]);
      json(res, 200, { profile, history });
      return true;
    }

    // POST /ranked/members/:userId/adjust
    if (parts.length === 8 && section === 'members' && parts[7] === 'adjust' && method === 'POST') {
      const body = await parseBody(req) as { delta?: number; reason?: string };
      const delta = Math.trunc(Number(body.delta));
      if (!Number.isFinite(delta) || delta === 0) {
        json(res, 400, { error: 'delta doit être un entier non nul' });
        return true;
      }

      const result = await adjustMemberRp(guildId, parts[6], delta, client, body.reason);
      json(res, 200, { result });
      return true;
    }

    // POST /ranked/tier-roles/provision - crée sur Discord les rôles manquants
    // de l'échelle et les associe à leur palier.
    if (parts.length === 7 && section === 'tier-roles' && parts[6] === 'provision' && method === 'POST') {
      const result = await provisionTierRoles(guildId, client, {
        reason: `Rôles de palier créés depuis le dashboard par ${_user.username ?? 'un administrateur'}`,
      });
      json(res, result.error && result.created === 0 ? 400 : 200, {
        ...result,
        tierRoles: await getTierRoles(guildId),
      });
      return true;
    }

    // GET/POST /ranked/tier-roles/sync - attribution rétroactive des rôles.
    // `{ stop: true }` interrompt la passe en cours.
    if (parts.length === 7 && section === 'tier-roles' && parts[6] === 'sync') {
      if (method === 'GET') {
        json(res, 200, getTierRoleSyncStatus(guildId));
        return true;
      }

      if (method === 'POST') {
        const body = await parseBody(req) as { stop?: boolean };
        if (body.stop) {
          stopTierRoleSync(guildId);
          json(res, 200, getTierRoleSyncStatus(guildId));
          return true;
        }

        const started = await startTierRoleSync(guildId, client);
        json(res, 200, { ...started, ...getTierRoleSyncStatus(guildId) });
        return true;
      }
    }

    // PUT /ranked/tier-roles/:tierKey - corps { roleId } ; DELETE pour dissocier
    if (parts.length === 7 && section === 'tier-roles') {
      const ladder = await getGuildLadder(guildId);
      const tierKey = parts[6];
      if (!ladder.some((tier) => tier.key === tierKey)) {
        json(res, 404, { error: 'Palier inconnu' });
        return true;
      }

      if (method === 'PUT') {
        const body = await parseBody(req) as { roleId?: string };
        if (!body.roleId) {
          json(res, 400, { error: 'roleId manquant' });
          return true;
        }
        const mapping = await setTierRole(guildId, tierKey, body.roleId);
        json(res, 200, { mapping });
        return true;
      }

      if (method === 'DELETE') {
        const removed = await removeTierRole(guildId, tierKey);
        json(res, removed ? 200 : 404, removed ? { ok: true } : { error: 'Aucune association à retirer' });
        return true;
      }
    }

    // GET/POST /ranked/events
    if (parts.length === 6 && section === 'events') {
      if (method === 'GET') {
        json(res, 200, { events: await listRankedEvents(guildId, 50) });
        return true;
      }

      if (method === 'POST') {
        const body = await parseBody(req) as {
          type?: string;
          name?: string;
          multiplier?: number;
          startsAt?: string;
          durationMinutes?: number;
          announceChannelId?: string;
        };

        if (!isRankedEventType(body.type)) {
          json(res, 400, { error: "Type d'événement invalide" });
          return true;
        }

        const durationMinutes = Math.max(5, Math.min(1440, Number(body.durationMinutes) || 60));
        const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
        if (Number.isNaN(startsAt.getTime())) {
          json(res, 400, { error: 'startsAt invalide' });
          return true;
        }

        const event = await createRankedEvent(guildId, {
          type: body.type,
          name: body.name ?? body.type,
          multiplier: Number(body.multiplier) || 2,
          startsAt,
          endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
          announceChannelId: body.announceChannelId ?? null,
        });

        json(res, 201, { event });
        return true;
      }
    }

    // DELETE /ranked/events/:eventId
    if (parts.length === 7 && section === 'events' && method === 'DELETE') {
      const cancelled = await cancelRankedEvent(guildId, parts[6]);
      json(res, cancelled ? 200 : 404, cancelled ? { ok: true } : { error: 'Événement introuvable ou déjà terminé' });
      return true;
    }

    // GET /ranked/decay/preview - simulation sans écriture
    if (parts.length === 7 && section === 'decay' && parts[6] === 'preview' && method === 'GET') {
      json(res, 200, await previewGuildDecay(guildId));
      return true;
    }

    // POST /ranked/decay/run - passage manuel, hors cron
    if (parts.length === 7 && section === 'decay' && parts[6] === 'run' && method === 'POST') {
      json(res, 200, await runGuildDecay(guildId, client));
      return true;
    }
  } catch (err) {
    logger.error(LOG_TAG, `Erreur sur ${method} ${url.pathname}:`, err);
    json(res, 500, { error: 'Erreur du module de classement' });
    return true;
  }

  return false;
}
