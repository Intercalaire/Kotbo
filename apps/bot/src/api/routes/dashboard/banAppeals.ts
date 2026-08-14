import type { BanAppealStatus } from '@prisma/client';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { json, readJsonBody, type AuthClaims, type DashboardAccess } from '../../shared.js';
import { setDashboardModuleStatus } from '../../../services/core/moduleActivationService.js';
import {
  decideAppeal,
  ensureDefaultAppealForm,
  getAppealConfig,
  getAppealDetail,
  getAppeals,
  requestAppealInfo,
  upsertAppealConfig,
  type AppealDecision,
} from '../../../services/moderation/banAppealService.js';

interface AppealConfigBody {
  enabled?: boolean;
  formId?: string | null;
  staffChannelId?: string | null;
  inviteChannelId?: string | null;
  cooldownDays?: number;
  welcomeText?: string | null;
  acceptMessage?: string | null;
  denyMessage?: string | null;
  notifyOnBanDM?: boolean;
  createDefaultForm?: boolean;
  appealVerification?: boolean;
  appealSaveIp?: boolean;
  appealSaveDevice?: boolean;
  appealVerificationLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}

/**
 * Routes de gestion des appels de bannissement.
 * Base: /api/dashboard/guilds/:guildId/appeals
 */
export async function handleBanAppealRoutes(
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

  if (parts[4] !== 'appeals') {
    return false;
  }

  // Décider d'un appel = modération de contenu au minimum
  if (!access.canModerateContent) {
    json(res, 403, { error: 'Accès modérateur requis pour gérer les appels de bannissement' });
    return true;
  }

  // GET /appeals - Liste (filtre ?status=)
  if (parts.length === 5 && method === 'GET') {
    try {
      const status = (_url.searchParams.get('status') as BanAppealStatus | null) ?? undefined;
      const appeals = await getAppeals(guildId, status);
      json(res, 200, { appeals });
    } catch (err) {
      logger.error('BanAppealsAPI', 'Error listing appeals:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des appels' });
    }
    return true;
  }

  // GET /appeals/config
  if (parts.length === 6 && parts[5] === 'config' && method === 'GET') {
    try {
      const config = await getAppealConfig(guildId);
      json(res, 200, { config });
    } catch (err) {
      logger.error('BanAppealsAPI', 'Error getting appeal config:', err);
      json(res, 500, { error: 'Erreur lors de la récupération de la configuration' });
    }
    return true;
  }

  // PUT /appeals/config
  if (parts.length === 6 && parts[5] === 'config' && method === 'PUT') {
    if (!access.canManageSettings) {
      json(res, 403, { error: 'Accès administrateur requis pour configurer les appels' });
      return true;
    }
    try {
      const body = await readJsonBody<AppealConfigBody>(req);
      if (!body) {
        json(res, 400, { error: 'Le corps de la requête est vide' });
        return true;
      }

      const { createDefaultForm, ...data } = body;

      if (data.cooldownDays !== undefined) {
        data.cooldownDays = Math.max(0, Math.min(365, Math.round(Number(data.cooldownDays) || 0)));
      }

      // Vérifie que le formulaire lié appartient bien à la guilde
      if (data.formId) {
        const form = await prisma.customForm.findFirst({ where: { id: data.formId, guildId }, select: { id: true } });
        if (!form) {
          json(res, 400, { error: 'Formulaire introuvable sur ce serveur' });
          return true;
        }
      }

      // L'interrupteur de la page est celui du module : le laisser écrire la
      // seule table laisserait la ligne du registre dire l'inverse, et c'est
      // elle que lit la garde. La bascule écrit les deux.
      const { enabled, ...settings } = data;
      await upsertAppealConfig(guildId, settings);

      if (enabled !== undefined) {
        const current = await getAppealConfig(guildId);
        if (current?.enabled !== enabled) {
          await setDashboardModuleStatus(guildId, 'ban_appeals', enabled);
        }
      }

      if (createDefaultForm) {
        await ensureDefaultAppealForm(guildId);
      }

      const config = await getAppealConfig(guildId);
      json(res, 200, { config });
    } catch (err) {
      logger.error('BanAppealsAPI', 'Error updating appeal config:', err);
      json(res, 500, { error: 'Erreur lors de la mise à jour de la configuration' });
    }
    return true;
  }

  // GET /appeals/blacklist
  if (parts.length === 6 && parts[5] === 'blacklist' && method === 'GET') {
    try {
      const entries = await prisma.banAppealBlacklist.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
      });
      json(res, 200, { entries });
    } catch (err) {
      logger.error('BanAppealsAPI', 'Error listing appeal blacklist:', err);
      json(res, 500, { error: 'Erreur lors de la récupération de la blacklist' });
    }
    return true;
  }

  // DELETE /appeals/blacklist/:userId
  if (parts.length === 7 && parts[5] === 'blacklist' && parts[6] && method === 'DELETE') {
    try {
      await prisma.banAppealBlacklist.deleteMany({ where: { guildId, userId: parts[6] } });
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('BanAppealsAPI', 'Error removing appeal blacklist entry:', err);
      json(res, 500, { error: 'Erreur lors de la suppression de la blacklist' });
    }
    return true;
  }

  // Routes avec :appealId
  if (parts[5]) {
    const appealId = parts[5];

    // GET /appeals/:id - Détail (réponses + historique sanctions + appels précédents)
    if (parts.length === 6 && method === 'GET') {
      try {
        const detail = await getAppealDetail(appealId, guildId);
        if (!detail) {
          json(res, 404, { error: 'Appel introuvable' });
          return true;
        }
        json(res, 200, detail);
      } catch (err) {
        logger.error('BanAppealsAPI', 'Error getting appeal detail:', err);
        json(res, 500, { error: 'Erreur lors de la récupération de l\'appel' });
      }
      return true;
    }

    // POST /appeals/:id/decide - { decision: ACCEPTED|DENIED|DENIED_PERMANENT, reason? }
    if (parts.length === 7 && parts[6] === 'decide' && method === 'POST') {
      try {
        const body = await readJsonBody<{ decision: AppealDecision; reason?: string }>(req);
        if (!body?.decision || !['ACCEPTED', 'DENIED', 'DENIED_PERMANENT'].includes(body.decision)) {
          json(res, 400, { error: 'Décision invalide' });
          return true;
        }
        if (body.decision !== 'ACCEPTED' && !body.reason?.trim()) {
          json(res, 400, { error: 'Une raison est requise pour un refus' });
          return true;
        }

        const result = await decideAppeal(client, {
          appealId,
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
        json(res, 200, { appeal: result.appeal });
      } catch (err) {
        logger.error('BanAppealsAPI', 'Error deciding appeal:', err);
        json(res, 500, { error: 'Erreur lors de la décision' });
      }
      return true;
    }

    // POST /appeals/:id/request-info - { question }
    if (parts.length === 7 && parts[6] === 'request-info' && method === 'POST') {
      try {
        const body = await readJsonBody<{ question: string }>(req);
        if (!body?.question?.trim()) {
          json(res, 400, { error: 'La question est requise' });
          return true;
        }

        const result = await requestAppealInfo(client, {
          appealId,
          guildId,
          question: body.question.trim().slice(0, 1000),
          staffUserId: user.userId,
          staffTag: user.username,
        });

        if (!result.ok) {
          json(res, 409, { error: result.error });
          return true;
        }
        json(res, 200, { appeal: result.appeal });
      } catch (err) {
        logger.error('BanAppealsAPI', 'Error requesting appeal info:', err);
        json(res, 500, { error: 'Erreur lors de la demande d\'informations' });
      }
      return true;
    }
  }

  return false;
}
