import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { json, readJsonBody, safePushAudit, getGuildName, type AuthClaims, type DashboardAccess } from '../../shared.js';
import {
  getRaidProtectionConfig,
  upsertRaidProtectionConfig,
  activateRaidMode,
  deactivateRaidMode,
  enableJoinLock,
  disableJoinLock,
  enableDmLock,
  disableDmLock,
} from '../../../services/moderation/raidProtectionService.js';
import { enableInviteEmergency, disableInviteEmergency, approveInviteRequest, rejectInviteRequest } from '../../../services/moderation/inviteGuardService.js';
import { handleReportDecision, getReportStats } from '../../../services/moderation/reportService.js';

// Champs de configuration modifiables depuis le dashboard
const PATCHABLE_FIELDS = [
  'captchaEnabled', 'captchaChannelId', 'captchaUnverifiedRoleId', 'captchaVerifiedRoleId', 'captchaTimeoutMinutes',
  'captchaMaxAttempts', 'captchaFailAction', 'captchaLogChannelId',
  'captchaMode', 'captchaVoiceChannelId', 'captchaVoiceQueueLimit', 'captchaVoiceLocale',
  'antiRaidEnabled', 'antiRaidJoinThreshold', 'antiRaidJoinWindowSec', 'antiRaidAction',
  'antiRaidAlertChannelId', 'antiRaidAutoDisableMinutes',
  'joinLockKick', 'joinLockMessage',
  'reportsEnabled', 'reportsChannelId', 'reportsCooldownSec', 'reportsAnonymous',
  'tagRoleEnabled', 'tagRoleId',
  'scamFilterEnabled', 'scamFilterAction', 'scamFilterTimeoutMin', 'scamFilterCustomDomains',
  'scamFilterWhitelist', 'scamFilterAlertChannelId', 'scamImageFilterEnabled',
  'inviteGuardEnabled', 'inviteRequireUnitary', 'inviteValidationEnabled',
  'inviteSpamThreshold', 'inviteSpamWindowSec', 'inviteAlertChannelId', 'inviteBypassRoleIds',
] as const;

export async function handleRaidProtectionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  _url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
  _access: DashboardAccess
): Promise<boolean> {
  if (parts[4] !== 'raid-protection') return false;
  const method = req.method;
  const sub = parts[5];
  const auditUser = `${user.username ?? 'Utilisateur'} (${user.userId})`;

  // GET /raid-protection - config + compteurs
  if (!sub && method === 'GET') {
    try {
      const [config, reportStats, pendingInvites, scamImageCount] = await Promise.all([
        getRaidProtectionConfig(guildId),
        getReportStats(guildId),
        prisma.inviteApprovalRequest.count({ where: { guildId, status: 'PENDING' } }),
        prisma.scamImageHash.count({ where: { OR: [{ guildId }, { guildId: null }] } }),
      ]);
      json(res, 200, { config, reportStats, pendingInvites, scamImageCount });
    } catch (err) {
      logger.error('RaidProtectionAPI', 'Erreur GET config:', err);
      json(res, 500, { error: 'Erreur lors de la récupération de la configuration' });
    }
    return true;
  }

  // PATCH /raid-protection - mise à jour de la config
  if (!sub && method === 'PATCH') {
    try {
      const body = await readJsonBody<Record<string, unknown>>(req);
      if (!body) {
        json(res, 400, { error: 'Corps de requête manquant' });
        return true;
      }
      const data: Record<string, unknown> = {};
      for (const field of PATCHABLE_FIELDS) {
        if (field in body) data[field] = body[field];
      }
      const config = await upsertRaidProtectionConfig(guildId, data);
      await safePushAudit(guildId, {
        user: auditUser,
        action: 'Mise à jour de la configuration de protection anti-raid',
        context: getGuildName(client, guildId),
        module: 'RaidProtection',
        eventType: 'Manuel',
        details: '',
        channelId: null,
      }, 'RaidProtectionAPI');
      json(res, 200, { config });
    } catch (err) {
      logger.error('RaidProtectionAPI', 'Erreur PATCH config:', err);
      json(res, 500, { error: 'Erreur lors de la mise à jour de la configuration' });
    }
    return true;
  }

  // POST /raid-protection/raidmode { active }
  if (sub === 'raidmode' && method === 'POST') {
    try {
      const body = await readJsonBody<{ active?: boolean }>(req);
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        json(res, 404, { error: 'Serveur introuvable' });
        return true;
      }
      const config = (await getRaidProtectionConfig(guildId)) ?? (await upsertRaidProtectionConfig(guildId, {}));
      if (body?.active) {
        await activateRaidMode(guild, config, true, user.userId);
        await safePushAudit(guildId, {
        user: auditUser,
        action: 'Mode raid activé manuellement',
        context: getGuildName(client, guildId),
        module: 'RaidProtection',
        eventType: 'Manuel',
        details: '',
        channelId: null,
      }, 'RaidProtectionAPI');
      } else {
        await deactivateRaidMode(guild, config);
        await safePushAudit(guildId, {
        user: auditUser,
        action: 'Mode raid désactivé',
        context: getGuildName(client, guildId),
        module: 'RaidProtection',
        eventType: 'Manuel',
        details: '',
        channelId: null,
      }, 'RaidProtectionAPI');
      }
      json(res, 200, { config: await getRaidProtectionConfig(guildId) });
    } catch (err) {
      logger.error('RaidProtectionAPI', 'Erreur raidmode:', err);
      json(res, 500, { error: 'Erreur lors du changement de mode raid' });
    }
    return true;
  }

  // POST /raid-protection/joinlock | dmlock { active, hours? }
  if ((sub === 'joinlock' || sub === 'dmlock') && method === 'POST') {
    try {
      const body = await readJsonBody<{ active?: boolean; hours?: number }>(req);
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        json(res, 404, { error: 'Serveur introuvable' });
        return true;
      }
      const until = body?.hours ? new Date(Date.now() + body.hours * 60 * 60 * 1000) : null;
      if (sub === 'joinlock') {
        if (body?.active) await enableJoinLock(guild, until);
        else await disableJoinLock(guild);
      } else {
        if (body?.active) await enableDmLock(guild, until);
        else await disableDmLock(guild);
      }
      await safePushAudit(guildId, {
        user: auditUser,
        action: `${sub === 'joinlock' ? 'Join lock' : 'DM lock'} ${body?.active ? 'activé' : 'désactivé'}`,
        context: getGuildName(client, guildId),
        module: 'RaidProtection',
        eventType: 'Manuel',
        details: '',
        channelId: null,
      }, 'RaidProtectionAPI');
      json(res, 200, { config: await getRaidProtectionConfig(guildId) });
    } catch (err) {
      logger.error('RaidProtectionAPI', `Erreur ${sub}:`, err);
      json(res, 500, { error: 'Erreur lors du changement de verrou' });
    }
    return true;
  }

  // POST /raid-protection/invite-emergency { active }
  if (sub === 'invite-emergency' && method === 'POST') {
    try {
      const body = await readJsonBody<{ active?: boolean }>(req);
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        json(res, 404, { error: 'Serveur introuvable' });
        return true;
      }
      let deleted = 0;
      if (body?.active) deleted = await enableInviteEmergency(guild);
      else await disableInviteEmergency(guild);
      await safePushAudit(guildId, {
        user: auditUser,
        action: `Mode urgence invitations ${body?.active ? `activé (${deleted} supprimées)` : 'désactivé'}`,
        context: getGuildName(client, guildId),
        module: 'RaidProtection',
        eventType: 'Manuel',
        details: '',
        channelId: null,
      }, 'RaidProtectionAPI');
      json(res, 200, { config: await getRaidProtectionConfig(guildId), deleted });
    } catch (err) {
      logger.error('RaidProtectionAPI', 'Erreur invite-emergency:', err);
      json(res, 500, { error: 'Erreur lors du changement du mode urgence' });
    }
    return true;
  }

  // GET /raid-protection/reports?status=PENDING
  if (sub === 'reports' && !parts[6] && method === 'GET') {
    try {
      const status = _url.searchParams.get('status') ?? undefined;
      const reports = await prisma.memberReport.findMany({
        where: { guildId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      json(res, 200, { reports });
    } catch (err) {
      logger.error('RaidProtectionAPI', 'Erreur GET reports:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des signalements' });
    }
    return true;
  }

  // POST /raid-protection/reports/:id/decision { resolved }
  if (sub === 'reports' && parts[6] && parts[7] === 'decision' && method === 'POST') {
    try {
      const body = await readJsonBody<{ resolved?: boolean }>(req);
      const report = await handleReportDecision(parts[6], user.userId, Boolean(body?.resolved));
      if (!report) {
        json(res, 404, { error: 'Signalement introuvable ou déjà traité' });
        return true;
      }
      json(res, 200, { report });
    } catch (err) {
      logger.error('RaidProtectionAPI', 'Erreur decision report:', err);
      json(res, 500, { error: 'Erreur lors du traitement du signalement' });
    }
    return true;
  }

  // GET /raid-protection/invite-requests
  if (sub === 'invite-requests' && !parts[6] && method === 'GET') {
    try {
      const requests = await prisma.inviteApprovalRequest.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      json(res, 200, { requests });
    } catch (err) {
      logger.error('RaidProtectionAPI', 'Erreur GET invite-requests:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des demandes' });
    }
    return true;
  }

  // POST /raid-protection/invite-requests/:id/decision { approved }
  if (sub === 'invite-requests' && parts[6] && parts[7] === 'decision' && method === 'POST') {
    try {
      const body = await readJsonBody<{ approved?: boolean }>(req);
      const request = body?.approved
        ? await approveInviteRequest(client, parts[6], user.userId)
        : await rejectInviteRequest(client, parts[6], user.userId);
      if (!request) {
        json(res, 404, { error: 'Demande introuvable ou déjà traitée' });
        return true;
      }
      json(res, 200, { request });
    } catch (err) {
      logger.error('RaidProtectionAPI', 'Erreur decision invite:', err);
      json(res, 500, { error: 'Erreur lors du traitement de la demande' });
    }
    return true;
  }

  // GET /raid-protection/scam-images
  if (sub === 'scam-images' && !parts[6] && method === 'GET') {
    try {
      const images = await prisma.scamImageHash.findMany({
        where: { OR: [{ guildId }, { guildId: null }] },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      json(res, 200, { images });
    } catch (err) {
      logger.error('RaidProtectionAPI', 'Erreur GET scam-images:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des images' });
    }
    return true;
  }

  // DELETE /raid-protection/scam-images/:id
  if (sub === 'scam-images' && parts[6] && method === 'DELETE') {
    try {
      // On ne peut supprimer que les hash de SA guilde (pas les globaux)
      const deleted = await prisma.scamImageHash.deleteMany({ where: { id: parts[6], guildId } });
      if (deleted.count === 0) {
        json(res, 404, { error: 'Hash introuvable (ou global, non supprimable)' });
        return true;
      }
      await safePushAudit(guildId, {
        user: auditUser,
        action: 'Hash d\'image scam supprimé',
        context: getGuildName(client, guildId),
        module: 'RaidProtection',
        eventType: 'Manuel',
        details: '',
        channelId: null,
      }, 'RaidProtectionAPI');
      json(res, 200, { success: true });
    } catch (err) {
      logger.error('RaidProtectionAPI', 'Erreur DELETE scam-image:', err);
      json(res, 500, { error: 'Erreur lors de la suppression' });
    }
    return true;
  }

  return false;
}
