import { IncomingMessage, ServerResponse } from 'node:http';
import { Client, ActivityType, PresenceStatusData } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { fetchExternal } from '../../../utils/http.js';
import {
  json,
  readJsonBody,
  resolveDashboardAccess,
  pushAudit,
  type AuthClaims,
} from '../../shared.js';

const _STATUS_MAP: Record<string, PresenceStatusData> = {
  ONLINE: 'online',
  IDLE: 'idle',
  DND: 'dnd',
  INVISIBLE: 'invisible',
};

const _ACTIVITY_MAP: Record<string, ActivityType> = {
  PLAYING: ActivityType.Playing,
  STREAMING: ActivityType.Streaming,
  LISTENING: ActivityType.Listening,
  WATCHING: ActivityType.Watching,
  COMPETING: ActivityType.Competing,
};

export async function handleCustomBotRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims
): Promise<boolean> {
  const method = req.method;

  if (parts[4] !== 'custom-bot') {
    return false;
  }

  const guildId = parts[3];

  const access = await resolveDashboardAccess(client, guildId, user.userId);
  if (!access.canManageSettings) {
    json(res, 403, { error: 'Accès refusé - droits administrateur requis' });
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/custom-bot
  if (parts.length === 5 && method === 'GET') {
    try {
      let config = await prisma.customBotConfig.findUnique({
        where: { guildId },
      });

      if (!config) {
        config = await prisma.customBotConfig.create({
          data: { guildId },
        });
      }

      json(res, 200, {
        config: {
          ...config,
          botToken: config.botToken ? '••••' + config.botToken.slice(-6) : null,
          botClientSecret: config.botClientSecret ? '••••' + config.botClientSecret.slice(-4) : null,
        },
      });
    } catch (err) {
      logger.error('CustomBot', 'GET config error:', err);
      json(res, 500, { error: 'Erreur lors de la récupération de la config' });
    }
    return true;
  }

  // PATCH /api/dashboard/guilds/:guildId/custom-bot
  if (parts.length === 5 && method === 'PATCH') {
    try {
      const body = await readJsonBody(req);
      if (!body) { json(res, 400, { error: 'Body JSON requis' }); return true; }

      const allowedFields = [
        'enabled', 'botToken', 'botClientId', 'botClientSecret',
        'botName', 'botAvatarUrl', 'botBannerUrl', 'botBio',
        'botStatus', 'activityType', 'activityText', 'activityUrl',
        'customDashboardUrl',
      ] as const;

      const updateData: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          if (field === 'enabled') {
            updateData[field] = Boolean(body[field]);
          } else if (field === 'botBio' && typeof body[field] === 'string') {
            updateData[field] = body[field].slice(0, 190);
          } else {
            updateData[field] = body[field] === '' ? null : body[field];
          }
        }
      }

      // Validate enums
      if (
        updateData.botStatus != null
        && (typeof updateData.botStatus !== 'string'
          || !['ONLINE', 'IDLE', 'DND', 'INVISIBLE'].includes(updateData.botStatus))
      ) {
        json(res, 400, { error: 'Statut invalide' });
        return true;
      }
      if (
        updateData.activityType != null
        && (typeof updateData.activityType !== 'string'
          || !['NONE', 'PLAYING', 'STREAMING', 'LISTENING', 'WATCHING', 'COMPETING'].includes(updateData.activityType))
      ) {
        json(res, 400, { error: 'Type d\'activité invalide' });
        return true;
      }

      const config = await prisma.customBotConfig.upsert({
        where: { guildId },
        update: updateData,
        create: { guildId, ...updateData },
      });

      pushAudit(guildId, {
        user: user.username || user.userId,
        action: 'Mise à jour Custom Bot',
        context: 'Custom Bot',
        module: 'Custom Bot',
        eventType: 'Configuration',
        details: 'Mise à jour de la configuration du bot personnalisé.',
        channelId: null,
      });

      json(res, 200, {
        config: {
          ...config,
          botToken: config.botToken ? '••••' + config.botToken.slice(-6) : null,
          botClientSecret: config.botClientSecret ? '••••' + config.botClientSecret.slice(-4) : null,
        },
      });
    } catch (err) {
      logger.error('CustomBot', 'PATCH config error:', err);
      json(res, 500, { error: 'Erreur lors de la mise à jour' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/custom-bot/validate - Test token validity
  if (parts.length === 6 && parts[5] === 'validate' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const token = body?.botToken;

      if (!token) {
        json(res, 400, { error: 'Token requis' });
        return true;
      }

      const response = await fetchExternal('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${token}` },
      });

      if (!response.ok) {
        json(res, 200, { valid: false, error: 'Token invalide ou expiré' });
        return true;
      }

      const botUser = await response.json() as { id: string; username: string; avatar: string | null; discriminator: string };
      json(res, 200, {
        valid: true,
        bot: {
          id: botUser.id,
          username: botUser.username,
          avatar: botUser.avatar
            ? `https://cdn.discordapp.com/avatars/${botUser.id}/${botUser.avatar}.png`
            : null,
        },
      });
    } catch (err) {
      logger.error('CustomBot', 'Token validation error:', err);
      json(res, 200, { valid: false, error: 'Erreur de validation' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/custom-bot/start - Request bot start
  if (parts.length === 6 && parts[5] === 'start' && method === 'POST') {
    try {
      const config = await prisma.customBotConfig.findUnique({ where: { guildId } });
      if (!config?.botToken || !config.enabled) {
        json(res, 400, { error: 'Le bot personnalisé n\'est pas configuré ou est désactivé.' });
        return true;
      }

      // Signal the launcher to start this custom bot via IPC
      if (client.shard) {
        client.shard.send({
          type: 'custom-bot-start',
          guildId,
          config: {
            botToken: config.botToken,
            botStatus: config.botStatus,
            activityType: config.activityType,
            activityText: config.activityText,
            activityUrl: config.activityUrl,
            botName: config.botName,
          },
        });
      }

      await prisma.customBotConfig.update({
        where: { guildId },
        data: { isRunning: true, lastStartedAt: new Date(), lastError: null },
      });

      pushAudit(guildId, {
        user: user.username || user.userId,
        action: 'Démarrage Custom Bot',
        context: 'Custom Bot',
        module: 'Custom Bot',
        eventType: 'Système',
        details: 'Démarrage du bot personnalisé demandé.',
        channelId: null,
      });
      json(res, 200, { ok: true, message: 'Démarrage en cours...' });
    } catch (err) {
      logger.error('CustomBot', 'Start error:', err);
      json(res, 500, { error: 'Erreur lors du démarrage' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/custom-bot/stop - Request bot stop
  if (parts.length === 6 && parts[5] === 'stop' && method === 'POST') {
    try {
      if (client.shard) {
        client.shard.send({ type: 'custom-bot-stop', guildId });
      }

      await prisma.customBotConfig.update({
        where: { guildId },
        data: { isRunning: false },
      });

      pushAudit(guildId, {
        user: user.username || user.userId,
        action: 'Arrêt Custom Bot',
        context: 'Custom Bot',
        module: 'Custom Bot',
        eventType: 'Système',
        details: 'Arrêt du bot personnalisé demandé.',
        channelId: null,
      });
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('CustomBot', 'Stop error:', err);
      json(res, 500, { error: 'Erreur lors de l\'arrêt' });
    }
    return true;
  }

  return false;
}
