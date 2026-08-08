import { IncomingMessage, ServerResponse } from 'node:http';
import { Client, ChannelType } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import {
  json,
  readJsonBody,
  type AuthClaims,
} from '../../shared.js';
import {
  fullSyncStaffRoles,
  autoSetupRoleMappings,
  createStaffServerLink,
  removeStaffServerLink,
  invalidateStaffLinkCache,
} from '../../../services/staff/staffServerService.js';
import { reconcileStaffGuildActivation } from '../../../utils/activation.js';

export async function handleStaffServerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
): Promise<boolean> {
  const method = req.method;

  if (parts[4] !== 'staff-server') return false;

  // GET /api/dashboard/guilds/:guildId/staff-server
  if (parts.length === 5 && method === 'GET') {
    try {
      const links = await prisma.staffServerLink.findMany({
        where: {
          OR: [{ mainGuildId: guildId }, { staffGuildId: guildId }],
        },
        include: {
          roleMappings: {
            include: { staffRole: true },
          },
          hierarchy: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const enriched = links.map((l) => {
        const isMain = l.mainGuildId === guildId;
        const otherGuildId = isMain ? l.staffGuildId : l.mainGuildId;
        const otherGuild = client.guilds.cache.get(otherGuildId);
        const mainGuild = client.guilds.cache.get(l.mainGuildId);
        const staffGuild = client.guilds.cache.get(l.staffGuildId);

        return {
          ...l,
          isMain,
          otherGuildId,
          otherGuildName: otherGuild?.name ?? otherGuildId,
          otherGuildIcon: otherGuild?.iconURL() ?? null,
          mainGuildName: mainGuild?.name ?? l.mainGuildId,
          staffGuildName: staffGuild?.name ?? l.staffGuildId,
          roleMappings: l.roleMappings.map((m) => {
            const mainRole = mainGuild?.roles.cache.get(m.mainDiscordRoleId ?? '');
            const staffRole = staffGuild?.roles.cache.get(m.staffDiscordRoleId ?? '');
            return {
              ...m,
              mainRoleName: mainRole?.name ?? m.mainDiscordRoleId,
              mainRoleColor: mainRole?.hexColor ?? null,
              staffRoleName: staffRole?.name ?? m.staffDiscordRoleId,
              staffRoleColor: staffRole?.hexColor ?? null,
            };
          }),
        };
      });

      json(res, 200, enriched);
    } catch (err) {
      logger.error('StaffServerAPI', 'Erreur GET staff-server', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/staff-server
  if (parts.length === 5 && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const staffGuildId = typeof body?.staffGuildId === 'string' ? body.staffGuildId : null;
      const syncMode = body?.syncMode;
      if (!staffGuildId || (syncMode !== 'BIDIRECTIONAL' && syncMode !== 'MAIN_TO_STAFF' && syncMode !== 'STAFF_TO_MAIN')) {
        json(res, 400, { error: 'staffGuildId et syncMode requis' });
        return true;
      }

      const optionalId = (value: unknown) => (typeof value === 'string' ? value : undefined);

      const staffGuild = client.guilds.cache.get(staffGuildId);
      if (!staffGuild) {
        json(res, 400, { error: 'Le bot n\'est pas présent sur le serveur staff.' });
        return true;
      }

      const linkResult = await createStaffServerLink({
        mainGuildId: guildId,
        staffGuildId,
        syncMode,
        hierarchyId: optionalId(body?.hierarchyId),
        simpleStaffRoleId: optionalId(body?.simpleStaffRoleId),
        mainLogChannelId: optionalId(body?.mainLogChannelId),
        staffLogChannelId: optionalId(body?.staffLogChannelId),
        createdByUserId: user.userId,
      });

      if ('error' in linkResult) {
        json(res, 400, { error: linkResult.error });
        return true;
      }

      const link = linkResult;
      const roleSetup = await autoSetupRoleMappings(link, client);
      const syncResult = await fullSyncStaffRoles(link.id, client);

      const updatedLink = await prisma.staffServerLink.findUnique({
        where: { id: link.id },
        include: { roleMappings: true, hierarchy: true },
      });

      json(res, 201, {
        ...updatedLink,
        autoSetup: roleSetup,
        initialSync: syncResult,
      });
    } catch (err) {
      logger.error('StaffServerAPI', 'Erreur POST staff-server', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/staff-server/channels - salons du
  // serveur staff lié (mainGuildId = guildId), pour les sélecteurs de salon
  // cross-serveur (ex: notifications staff qui doivent vivre sur le serveur
  // staff dédié plutôt que sur le serveur communautaire).
  if (parts.length === 6 && parts[5] === 'channels' && method === 'GET') {
    try {
      const link = await prisma.staffServerLink.findFirst({
        where: { mainGuildId: guildId, enabled: true },
      });
      if (!link) {
        json(res, 200, { staffGuildId: null, staffGuildName: null, channels: [], voiceChannels: [], categories: [] });
        return true;
      }

      let staffGuild = client.guilds.cache.get(link.staffGuildId) ?? null;
      if (!staffGuild) {
        staffGuild = await client.guilds.fetch(link.staffGuildId).catch(() => null);
      }
      if (staffGuild && staffGuild.channels.cache.size === 0) {
        await staffGuild.channels.fetch().catch(() => null);
      }

      const allChannels = staffGuild ? Array.from(staffGuild.channels.cache.values()) : [];
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'fr');

      const channels = allChannels
        .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
        .map((c) => ({ id: c.id, name: c.name }))
        .sort(byName);
      const voiceChannels = allChannels
        .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
        .map((c) => ({ id: c.id, name: c.name }))
        .sort(byName);
      const categories = allChannels
        .filter((c) => c.type === ChannelType.GuildCategory)
        .map((c) => ({ id: c.id, name: c.name }))
        .sort(byName);

      json(res, 200, {
        staffGuildId: link.staffGuildId,
        staffGuildName: staffGuild?.name ?? link.staffGuildId,
        channels,
        voiceChannels,
        categories,
      });
    } catch (err) {
      logger.error('StaffServerAPI', 'Erreur GET staff-server/channels', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // PATCH /api/dashboard/guilds/:guildId/staff-server/:linkId
  if (parts.length === 6 && method === 'PATCH' && parts[5] !== 'mappings') {
    try {
      const linkId = parts[5];
      const body = await readJsonBody(req);

      const link = await prisma.staffServerLink.findUnique({ where: { id: linkId } });
      if (!link || (link.mainGuildId !== guildId && link.staffGuildId !== guildId)) {
        json(res, 404, { error: 'Lien introuvable' });
        return true;
      }

      const allowedFields = [
        'syncMode', 'simpleStaffRoleId', 'mainLogChannelId', 'staffLogChannelId', 'enabled',
        'modlogMirrorChannelId', 'sanctionReportChannelId', 'recruitmentAlertChannelId',
        'recruitmentOnStaffServer', 'staffRecruitmentCategoryId',
        'onboardingInviteEnabled', 'onboardingInviteChannelId', 'offboardingAlertChannelId',
      ];
      const updateData: Record<string, any> = {};
      for (const field of allowedFields) {
        if (body?.[field] !== undefined) updateData[field] = body[field];
      }

      const updated = await prisma.staffServerLink.update({
        where: { id: linkId },
        data: updateData,
        include: { roleMappings: true, hierarchy: true },
      });

      await invalidateStaffLinkCache(updated);

      if ('enabled' in updateData) {
        await reconcileStaffGuildActivation(updated.staffGuildId);
      }

      json(res, 200, updated);
    } catch (err) {
      logger.error('StaffServerAPI', 'Erreur PATCH staff-server', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // DELETE /api/dashboard/guilds/:guildId/staff-server/:linkId
  if (parts.length === 6 && method === 'DELETE' && parts[5] !== 'mappings') {
    try {
      const linkId = parts[5];
      const link = await prisma.staffServerLink.findUnique({ where: { id: linkId } });
      if (!link || (link.mainGuildId !== guildId && link.staffGuildId !== guildId)) {
        json(res, 404, { error: 'Lien introuvable' });
        return true;
      }

      await removeStaffServerLink(linkId);
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('StaffServerAPI', 'Erreur DELETE staff-server', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/staff-server/:linkId/mappings
  if (parts.length === 7 && parts[6] === 'mappings' && method === 'POST') {
    try {
      const linkId = parts[5];
      const body = await readJsonBody(req);

      const mapping = await prisma.staffServerRoleMapping.create({
        data: {
          staffServerLinkId: linkId,
          staffRoleId: typeof body?.staffRoleId === 'string' ? body.staffRoleId : null,
          mainDiscordRoleId: typeof body?.mainDiscordRoleId === 'string' ? body.mainDiscordRoleId : null,
          staffDiscordRoleId: typeof body?.staffDiscordRoleId === 'string' ? body.staffDiscordRoleId : null,
        },
      });

      json(res, 201, mapping);
    } catch (err) {
      logger.error('StaffServerAPI', 'Erreur POST mapping', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // DELETE /api/dashboard/guilds/:guildId/staff-server/:linkId/mappings/:mappingId
  if (parts.length === 8 && parts[6] === 'mappings' && method === 'DELETE') {
    try {
      const mappingId = parts[7];
      await prisma.staffServerRoleMapping.delete({ where: { id: mappingId } });
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('StaffServerAPI', 'Erreur DELETE mapping', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/staff-server/:linkId/sync
  if (parts.length === 7 && parts[6] === 'sync' && method === 'POST') {
    try {
      const linkId = parts[5];
      const result = await fullSyncStaffRoles(linkId, client);
      json(res, 200, result);
    } catch (err) {
      logger.error('StaffServerAPI', 'Erreur sync', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  return false;
}
