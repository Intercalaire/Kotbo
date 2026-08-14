import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { json, readJsonBody, getGuildName, safePushAudit, type AuthClaims, type DashboardAccess } from '../../shared.js';
import {
  GHOST_STATUSES,
  PRUNABLE_STATUSES,
  GhostPruneValidationError,
  executeGhostPrune,
  getGhostConfig,
  getGhostDistribution,
  getGhostPruneRuns,
  listGhostMembers,
  previewGhostPrune,
  recomputeGhostStatuses,
  sanitizeGhostConfigPatch,
  upsertGhostConfig,
  type GhostStatus,
} from '../../../services/analytics/ghostMembersService.js';

function parseStatus(raw: string | null): GhostStatus | undefined {
  if (!raw) return undefined;
  return GHOST_STATUSES.includes(raw as GhostStatus) ? (raw as GhostStatus) : undefined;
}

function parseTargetStatuses(raw: unknown): GhostStatus[] {
  if (!Array.isArray(raw)) return ['INACTIVE'];
  const statuses = raw.filter((s): s is GhostStatus =>
    typeof s === 'string' && PRUNABLE_STATUSES.includes(s as GhostStatus));
  return statuses.length > 0 ? statuses : ['INACTIVE'];
}

export async function handleGhostMembersRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
  _access: DashboardAccess,
): Promise<boolean> {
  if (parts[4] !== 'ghost-members') return false;

  const method = req.method;
  const sub = parts[5];
  const auditUser = `${user.username ?? 'Inconnu'} (${user.userId})`;

  const audit = (action: string, details: string) => safePushAudit(guildId, {
    user: auditUser,
    action,
    context: getGuildName(client, guildId),
    module: 'Ghost Members',
    eventType: 'Manuel',
    details,
    channelId: null,
  }, action);

  // GET /ghost-members - répartition de la communauté + configuration
  if (!sub && method === 'GET') {
    try {
      const [distribution, config] = await Promise.all([
        getGhostDistribution(guildId),
        getGhostConfig(guildId),
      ]);
      json(res, 200, { distribution, config });
    } catch (err) {
      logger.error('GhostMembersAPI', 'Erreur GET répartition:', err);
      json(res, 500, { error: 'Erreur lors du calcul de la répartition' });
    }
    return true;
  }

  // GET /ghost-members/members?status=&page=&pageSize=&search=&onlyPrunable=
  if (sub === 'members' && method === 'GET') {
    try {
      const result = await listGhostMembers(client, guildId, {
        status: parseStatus(url.searchParams.get('status')),
        search: url.searchParams.get('search') ?? undefined,
        onlyPrunable: url.searchParams.get('onlyPrunable') === 'true',
        page: Number(url.searchParams.get('page')) || 1,
        pageSize: Number(url.searchParams.get('pageSize')) || 50,
      });
      json(res, 200, result);
    } catch (err) {
      logger.error('GhostMembersAPI', 'Erreur GET membres:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des membres' });
    }
    return true;
  }

  // PATCH /ghost-members/config - seuils et garde-fous
  if (sub === 'config' && method === 'PATCH') {
    try {
      const body = await readJsonBody<Record<string, unknown>>(req);
      if (!body) {
        json(res, 400, { error: 'Corps de requête manquant' });
        return true;
      }
      const patch = sanitizeGhostConfigPatch(body);
      if (Object.keys(patch).length === 0) {
        json(res, 400, { error: 'Aucun champ valide à mettre à jour' });
        return true;
      }
      const config = await upsertGhostConfig(guildId, patch);
      await audit(
        'Mise à jour Ghost Members',
        `Seuils: inactif ${config.inactiveDays}j, spectateur ${config.spectatorWindowDays}j, grâce ${config.gracePeriodDays}j.`,
      );
      json(res, 200, { config });
    } catch (err) {
      logger.error('GhostMembersAPI', 'Erreur PATCH config:', err);
      json(res, 500, { error: 'Erreur lors de la mise à jour de la configuration' });
    }
    return true;
  }

  // POST /ghost-members/recompute - reclassement complet du serveur
  if (sub === 'recompute' && method === 'POST') {
    try {
      const counts = await recomputeGhostStatuses(guildId);
      await audit(
        'Recalcul Ghost Members',
        `Actifs: ${counts.ACTIVE}, spectateurs: ${counts.SPECTATOR}, inactifs: ${counts.INACTIVE}, récents: ${counts.NEW}.`,
      );
      json(res, 200, { counts });
    } catch (err) {
      logger.error('GhostMembersAPI', 'Erreur recompute:', err);
      json(res, 500, { error: 'Erreur lors du recalcul des statuts' });
    }
    return true;
  }

  // POST /ghost-members/prune/preview - étape 1 : prévisualisation
  if (sub === 'prune' && parts[6] === 'preview' && method === 'POST') {
    try {
      const body = await readJsonBody<{ statuses?: unknown }>(req);
      const preview = await previewGhostPrune(client, guildId, {
        statuses: parseTargetStatuses(body?.statuses),
      });
      json(res, 200, preview);
    } catch (err) {
      logger.error('GhostMembersAPI', 'Erreur prévisualisation prunage:', err);
      json(res, 500, { error: 'Erreur lors de la prévisualisation' });
    }
    return true;
  }

  // POST /ghost-members/prune - étape 2 : expulsion confirmée
  if (sub === 'prune' && !parts[6] && method === 'POST') {
    try {
      const body = await readJsonBody<{
        statuses?: unknown;
        userIds?: unknown;
        confirmCount?: unknown;
        reason?: unknown;
      }>(req);

      if (!body || !Array.isArray(body.userIds)) {
        json(res, 400, { error: 'Liste de membres manquante' });
        return true;
      }

      const result = await executeGhostPrune(
        client,
        guildId,
        {
          statuses: parseTargetStatuses(body.statuses),
          userIds: body.userIds.filter((id): id is string => typeof id === 'string'),
          confirmCount: typeof body.confirmCount === 'number' ? body.confirmCount : -1,
          reason: typeof body.reason === 'string' ? body.reason : undefined,
        },
        { userId: user.userId, username: auditUser },
      );

      await audit(
        'Prunage Ghost Members',
        `${result.successCount} membre(s) expulsé(s), ${result.failureCount} échec(s) sur ${result.totalTargeted} ciblé(s).`,
      );
      json(res, 200, result);
    } catch (err) {
      if (err instanceof GhostPruneValidationError) {
        json(res, 400, { error: err.message });
        return true;
      }
      logger.error('GhostMembersAPI', 'Erreur exécution prunage:', err);
      json(res, 500, { error: 'Erreur lors du prunage' });
    }
    return true;
  }

  // GET /ghost-members/runs - historique des prunages
  if (sub === 'runs' && method === 'GET') {
    try {
      const runs = await getGhostPruneRuns(guildId, Number(url.searchParams.get('take')) || 20);
      json(res, 200, { runs });
    } catch (err) {
      logger.error('GhostMembersAPI', 'Erreur GET historique:', err);
      json(res, 500, { error: 'Erreur lors de la récupération de l\'historique' });
    }
    return true;
  }

  return false;
}
