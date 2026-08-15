/** Routes dashboard du module `command-access`. */
import { normalizeCommandRestrictions } from '../../../../utils/commandAccess.js';
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { getGuildName, json, pushAudit, readJsonBody, resolveFeatureAccessMap } from '../../../shared.js';
import { type ModuleRouteContext } from './_shared.js';

export async function handleCommandAccessRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, user, guildId, access, method, auditUser, moduleKey } = ctx;

  // PUT /api/dashboard/guilds/:guildId/command-access
  if (moduleKey === 'command-access' && parts.length === 5 && method === 'PUT') {
    try {
      const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      const member = discordGuild ? await discordGuild.members.fetch(user.userId).catch(() => null) : null;
      const roleIds = member?.roles.cache.map((role) => role.id) ?? [];
      const featureAccess = await resolveFeatureAccessMap(client, guildId, access, user.userId, roleIds);

      if (!featureAccess.commands?.canConfigure && !access.canManageSettings) {
        json(res, 403, { error: 'Accès refusé. Permissions insuffisantes.' });
        return true;
      }

      const body = await readJsonBody<{ commandRestrictions?: unknown }>(req);
      if (!body) {
        json(res, 400, { error: 'Payload de restrictions invalide' });
        return true;
      }

      const commandRestrictions = normalizeCommandRestrictions(body.commandRestrictions);

      await prisma.dashboardSettings.update({
        where: { guildId },
        data: { commandRestrictions }
      });

      await pushAudit(guildId, {
        user: auditUser,
        action: 'Sauvegarde restrictions commandes',
        context: getGuildName(client, guildId),
        module: 'Dashboard',
        eventType: 'Manuel',
        details: `${commandRestrictions.length} règle(s) de commande enregistrée(s).`,
        channelId: null
      });

      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('CommandAccessAPI', 'Error updating command restrictions:', err);
      json(res, 500, { error: 'Erreur lors de la mise à jour des restrictions' });
    }
    return true;
  }

  return false;
}
