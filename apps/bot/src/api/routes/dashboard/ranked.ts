/**
 * Routes du module Ranked (classement compétitif RP).
 *
 * Base : `/api/dashboard/guilds/:guildId/ranked`
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { Client, PermissionFlagsBits } from 'discord.js';
import { DEFAULT_LADDER_CURVE, DEFAULT_RANKED_LADDER, generateRankedLadder, normalizeRankedLadder } from '@kotbo/shared';
import { logger } from '../../../utils/logger.js';
import { json, getGuildName, pushAudit, type AuthClaims, type DashboardAccess } from '../../shared.js';
import { getMemberIdentities } from '../../../services/moderation/memberIdentityService.js';
import {
  acquireProvisionLock,
  ensureTextChannel,
  missingProvisionPermissions,
  provisionCooldown,
  provisionCooldownMessage,
  releaseProvisionLock,
  startProvisionCooldown,
} from '../../../services/core/channelProvisioningService.js';
import { resolveGuildLocale } from '../../../utils/i18n.js';
import * as m from '../../../lib/paraglide/messages.js';
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
  deleteTierRoles,
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
  getRankedLeaderboardPage,
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

/**
 * Complète des lignes de classement avec de quoi les afficher.
 *
 * `RankedMember` ne connaît que des identifiants : sans cette résolution, le
 * dashboard alignait des suites de chiffres à la place des pseudos.
 */
async function withIdentities<T extends { userId: string }>(
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
        leaderboard: await withIdentities(client, guildId, leaderboard),
        streaks: await withIdentities(client, guildId, streaks),
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

    // GET /ranked/leaderboard?page=&search= (ou limit/offset, historique)
    if (parts.length === 6 && section === 'leaderboard' && method === 'GET') {
      const search = (url.searchParams.get('search') ?? '').trim();
      const page = url.searchParams.get('page');

      // L'ancienne forme limit/offset reste servie : le classement du bot et
      // les widgets s'en servent, et rien n'oblige à les migrer d'un bloc.
      if (page === null && !search && url.searchParams.has('limit')) {
        const limit = Number(url.searchParams.get('limit') ?? 25);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const rows = await getRankedLeaderboard(guildId, limit, offset);
        json(res, 200, { leaderboard: await withIdentities(client, guildId, rows) });
        return true;
      }

      const result = await getRankedLeaderboardPage(guildId, { page: Number(page) || 1, search });
      json(res, 200, { ...result, rows: await withIdentities(client, guildId, result.rows) });
      return true;
    }

    // GET /ranked/global
    if (parts.length === 6 && section === 'global' && method === 'GET') {
      const rows = await getGlobalLeaderboard(Number(url.searchParams.get('limit') ?? 25));
      // Les identités viennent de cette guilde : un membre du classement global
      // qui n'en fait pas partie reste un identifiant, ce que le dashboard sait
      // afficher.
      json(res, 200, { leaderboard: await withIdentities(client, guildId, rows) });
      return true;
    }

    // GET /ranked/members/:userId
    if (parts.length === 7 && section === 'members' && method === 'GET') {
      const [profile, history] = await Promise.all([
        getRankedProfile(guildId, parts[6]),
        getRankedHistory(guildId, parts[6]),
      ]);
      const [identified] = await withIdentities(client, guildId, [{ userId: parts[6] }]);
      json(res, 200, { profile: { ...profile, ...identified }, history });
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

    // POST /ranked/announce-channel - crée le salon d'annonce des paliers.
    if (parts.length === 6 && section === 'announce-channel' && method === 'POST') {
      const discordGuild = client.guilds.cache.get(guildId)
        || await client.guilds.fetch(guildId).catch(() => null);
      if (!discordGuild) {
        json(res, 404, { error: 'Serveur introuvable' });
        return true;
      }

      const lockKey = `${guildId}:rankedAnnounceChannel`;
      if (!acquireProvisionLock(lockKey)) {
        json(res, 429, { error: 'Une création est déjà en cours' });
        return true;
      }

      try {
        const cooldown = await provisionCooldown(lockKey);
        if (cooldown) {
          json(res, 429, { error: provisionCooldownMessage(cooldown, 'Le salon a déjà été créé') });
          return true;
        }

        const missing = await missingProvisionPermissions(discordGuild, [PermissionFlagsBits.ManageChannels]);
        if (missing.length > 0) {
          json(res, 400, { error: `Le bot n'a pas les permissions nécessaires : ${missing.join(', ')}.` });
          return true;
        }

        // Nom dans la langue du serveur : le salon est lu par ses membres, pas
        // par l'admin qui clique depuis le dashboard.
        const locale = await resolveGuildLocale(guildId, discordGuild.preferredLocale);
        const config = await getOrCreateRankedConfig(guildId);
        const botId = discordGuild.members.me?.id;

        const { channel, entry } = await ensureTextChannel(discordGuild, {
          key: 'rankedAnnounceChannel',
          existingId: config.announceChannelId,
          name: m.setup_channel_ranked({}, { locale }),
          permissionOverwrites: [
            {
              id: discordGuild.roles.everyone.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
              deny: [PermissionFlagsBits.SendMessages],
            },
            ...(botId
              ? [{
                  id: botId,
                  allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.EmbedLinks,
                  ],
                }]
              : []),
          ],
          reason: m.setup_reason_ranked({ user: `${_user.username ?? 'Utilisateur'} (${_user.userId})` }, { locale }),
        });

        // Écrit tout de suite : un salon créé que la page n'enregistrerait pas
        // resterait sur le serveur sans que rien n'y renvoie.
        if (entry.created) {
          await updateRankedConfig(guildId, { announceChannelId: channel.id });
          await startProvisionCooldown(lockKey, _user.username ?? 'Utilisateur');
          await pushAudit(guildId, {
            user: `${_user.username ?? 'Utilisateur'} (${_user.userId})`,
            action: "Création du salon d'annonce du prestige",
            context: getGuildName(client, guildId),
            module: 'Prestige',
            eventType: 'Manuel',
            details: `Salon créé : #${channel.name}`,
            channelId: channel.id,
          });
        }

        json(res, 200, { channelId: channel.id, name: channel.name, created: entry.created });
      } finally {
        releaseProvisionLock(lockKey);
      }
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

    // DELETE /ranked/tier-roles - supprime de Discord les rôles de palier et
    // leurs associations. Geste destructif : le dashboard le fait confirmer.
    if (parts.length === 6 && section === 'tier-roles' && method === 'DELETE') {
      const result = await deleteTierRoles(guildId, client, {
        reason: `Rôles de palier supprimés depuis le dashboard par ${_user.username ?? 'un administrateur'}`,
      });

      if (result.deleted > 0 || result.cleared > 0) {
        await pushAudit(guildId, {
          user: `${_user.username ?? 'Utilisateur'} (${_user.userId})`,
          action: 'Suppression des rôles de palier du prestige',
          context: getGuildName(client, guildId),
          module: 'Prestige',
          eventType: 'Manuel',
          details: `${result.deleted} rôles supprimés, ${result.cleared} associations orphelines retirées, ${result.failed} en échec`,
          channelId: null,
        });
      }

      json(res, result.error ? 400 : 200, {
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
