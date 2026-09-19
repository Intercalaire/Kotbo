/** Routes dashboard du module `auto-thread`. */
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { getGuildName, json, pushAudit, readJsonBody } from '../../../shared.js';
import { type ModuleRouteContext } from './_shared.js';

import { jsonFailure } from '../../../shared/failure.js';
export async function handleAutoThreadRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, guildId, method, auditUser, moduleKey } = ctx;

  // GET/PATCH /api/dashboard/guilds/:guildId/auto-thread
  if (moduleKey === 'auto-thread' && parts.length === 5) {
    if (method === 'GET') {
      try {
        const guild = await prisma.guild.findUnique({
          where: { id: guildId },
          select: { autoThreadEnabled: true, autoThreadChannels: true, autoThreadBotsEnabled: true },
        });
        if (!guild) {
          json(res, 404, { error: 'Serveur introuvable' });
          return true;
        }
        json(res, 200, { enabled: guild.autoThreadEnabled, channels: guild.autoThreadChannels, botsEnabled: guild.autoThreadBotsEnabled });
      } catch (err) {
        logger.error('AutoThreadAPI', 'GET auto-thread error:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération de la configuration', 'AutoThreadAPI');
      }
      return true;
    }

    if (method === 'PATCH') {
      try {
        const body = await readJsonBody<{ enabled?: boolean; channels?: string[]; botsEnabled?: boolean }>(req);
        if (!body) {
          json(res, 400, { error: 'Payload settings invalide' });
          return true;
        }

        const data: Record<string, unknown> = {};
        if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
          data.autoThreadEnabled = !!body.enabled;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'channels')) {
          data.autoThreadChannels = body.channels;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'botsEnabled')) {
          data.autoThreadBotsEnabled = !!body.botsEnabled;
        }

        await prisma.guild.update({
          where: { id: guildId },
          data,
        });

        if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
          await prisma.dashboardFeatureConfig.upsert({
            where: { guildId_featureKey: { guildId, featureKey: 'auto_thread' } },
            create: {
              guildId,
              featureKey: 'auto_thread',
              featureName: 'Auto-Thread',
              enabled: !!body.enabled,
              loggingEnabled: true,
              userActivityTracking: true,
              notifyViaDiscordChannel: true,
            },
            update: {
              enabled: !!body.enabled
            }
          });
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Sauvegarde configuration Auto-Thread',
          context: getGuildName(client, guildId),
          module: 'Auto-Thread',
          eventType: 'Manuel',
          details: `Configuration Auto-Thread mise à jour (salons: ${body.channels?.length ?? 0}).`,
          channelId: null
        });

        json(res, 200, { ok: true });
      } catch (err) {
        logger.error('AutoThreadAPI', 'PATCH auto-thread error:', err);
        jsonFailure(res, err, 'Erreur lors de la mise à jour', 'AutoThreadAPI');
      }
      return true;
    }
  }

  return false;
}
