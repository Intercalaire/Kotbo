import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { json, readJsonBody, type AuthClaims, type DashboardAccess } from '../../shared.js';
import { decideAdminLockRequest, isAdminLockBypassed, type AdminLockDecision } from '../../../services/moderation/adminLockService.js';
import { getOrCreateAutoModConfig } from '../../../services/moderation/autoModService.js';

import { jsonFailure } from '../../shared/failure.js';
/**
 * Routes de gestion des demandes Admin Permission Lock.
 * Base: /api/dashboard/guilds/:guildId/admin-lock
 */
export async function handleAdminLockRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  _url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
  access: DashboardAccess
): Promise<boolean> {
  const method = req.method;

  if (parts[4] !== 'admin-lock') {
    return false;
  }

  if (!access.canModerateContent) {
    json(res, 403, { error: 'Accès modérateur requis pour consulter Admin Permission Lock' });
    return true;
  }

  // GET /admin-lock - Liste (filtre ?status=)
  if (parts.length === 5 && method === 'GET') {
    try {
      const status = _url.searchParams.get('status') || undefined;
      const requests = await prisma.adminPermissionRequest.findMany({
        where: { guildId, ...(status ? { status: status as never } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      json(res, 200, { requests });
    } catch (err) {
      logger.error('AdminLockAPI', 'Error listing requests:', err);
      jsonFailure(res, err, 'Erreur lors de la récupération des demandes', 'AdminLockAPI');
    }
    return true;
  }

  // Routes avec :requestId
  if (parts[5]) {
    const requestId = parts[5];

    // GET /admin-lock/:id - Détail
    if (parts.length === 6 && method === 'GET') {
      try {
        const request = await prisma.adminPermissionRequest.findFirst({ where: { id: requestId, guildId } });
        if (!request) {
          json(res, 404, { error: 'Demande introuvable' });
          return true;
        }
        json(res, 200, { request });
      } catch (err) {
        logger.error('AdminLockAPI', 'Error getting request detail:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération de la demande', 'AdminLockAPI');
      }
      return true;
    }

    // POST /admin-lock/:id/decide - { decision: APPROVED|REJECTED, reason? }
    if (parts.length === 7 && parts[6] === 'decide' && method === 'POST') {
      try {
        // Un compte admin compromis avec un simple accès dashboard (canManageSettings)
        // ne doit jamais pouvoir approuver sa propre demande : seul le owner ou un
        // membre d'un rôle "sécurité" configuré peut décider, pas l'accès générique.
        const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
        if (!guild) {
          json(res, 404, { error: 'Serveur Discord introuvable' });
          return true;
        }
        const config = await getOrCreateAutoModConfig(guildId);
        if (!isAdminLockBypassed(guild, user.userId, config.adminLockSecurityRoleIds)) {
          json(res, 403, { error: 'Seul le propriétaire du serveur ou un rôle sécurité peut traiter cette demande.' });
          return true;
        }

        const body = await readJsonBody<{ decision: AdminLockDecision; reason?: string }>(req);
        if (!body?.decision || !['APPROVED', 'REJECTED'].includes(body.decision)) {
          json(res, 400, { error: 'Décision invalide' });
          return true;
        }

        const result = await decideAdminLockRequest(client, {
          requestId,
          guildId,
          decision: body.decision,
          staffUserId: user.userId,
          staffTag: user.username,
          reason: body.reason?.trim() || undefined,
        });

        if (!result.ok) {
          json(res, 409, { error: result.error });
          return true;
        }
        json(res, 200, { request: result.request });
      } catch (err) {
        logger.error('AdminLockAPI', 'Error deciding request:', err);
        jsonFailure(res, err, 'Erreur lors de la décision', 'AdminLockAPI');
      }
      return true;
    }
  }

  return false;
}
