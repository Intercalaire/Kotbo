import { IncomingMessage, ServerResponse } from 'node:http';
import { ChannelType, Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import {
  json,
  readJsonBody,
  type AuthClaims,
} from '../../shared.js';
import { createDirectLink, removeLink, updateLinkConfig } from '../../../services/features/channelLinkService.js';
import { isLinkGuestGuild } from '../../../services/features/channelLinkGuestService.js';

export async function handleChannelLinkRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
): Promise<boolean> {
  const method = req.method;

  if (parts[4] !== 'channel-links') return false;

  // GET /api/dashboard/guilds/:guildId/channel-links
  if (parts.length === 5 && method === 'GET') {
    try {
      const links = await prisma.channelLink.findMany({
        where: {
          OR: [{ sourceGuildId: guildId }, { targetGuildId: guildId }],
        },
        orderBy: { createdAt: 'desc' },
      });

      const enriched = links.map((l) => {
        const isSource = l.sourceGuildId === guildId;
        const remoteGuildId = isSource ? l.targetGuildId : l.sourceGuildId;
        const remoteGuild = client.guilds.cache.get(remoteGuildId);
        const localChannelId = isSource ? l.sourceChannelId : l.targetChannelId;
        const remoteChannelId = isSource ? l.targetChannelId : l.sourceChannelId;
        const localChannel = client.guilds.cache.get(guildId)?.channels.cache.get(localChannelId);
        const remoteChannel = remoteGuild?.channels.cache.get(remoteChannelId);

        return {
          ...l,
          isSource,
          localChannelId,
          localChannelName: localChannel?.name ?? localChannelId,
          remoteGuildId,
          remoteGuildName: remoteGuild?.name ?? remoteGuildId,
          remoteGuildIcon: remoteGuild?.iconURL() ?? null,
          remoteChannelId,
          remoteChannelName: remoteChannel?.name ?? remoteChannelId,
          // Le serveur d'en face n'a pas de clé : il ne voit que ce pont, et
          // Kotbo n'y collecte rien. À afficher pour lever le doute des
          // communautés qui acceptent un lien sans vouloir « du bot ».
          remoteIsLinkOnly: isLinkGuestGuild(remoteGuildId),
          // `true` quand ce lien inscrit en base la correspondance entre un
          // message et sa copie - nécessaire aux éditions, suppressions et
          // réactions, inutile autrement.
          storesMessageMap: l.relayEdits || l.relayDeletes || l.relayReactions,
        };
      });

      json(res, 200, enriched);
    } catch (err) {
      logger.error('ChannelLinkAPI', 'Erreur GET channel-links', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/channel-links/other-guilds
  if (parts.length === 6 && parts[5] === 'other-guilds' && method === 'GET') {
    try {
      const otherGuilds: { id: string; name: string; icon: string | null; channels: { id: string; name: string }[] }[] = [];

      for (const guild of client.guilds.cache.values()) {
        let member;
        try {
          member = await guild.members.fetch(user.userId);
        } catch {
          continue;
        }

        if (!member.permissions.has('Administrator') && !member.permissions.has('ManageGuild')) continue;

        const channels = guild.channels.cache
          .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
          .map((c) => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

        otherGuilds.push({
          id: guild.id,
          name: guild.name,
          icon: guild.iconURL({ size: 64 }) ?? null,
          channels,
        });
      }

      json(res, 200, otherGuilds);
    } catch (err) {
      logger.error('ChannelLinkAPI', 'Erreur GET other-guilds', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/channel-links/direct
  if (parts.length === 6 && parts[5] === 'direct' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const sourceChannelId = typeof body?.sourceChannelId === 'string' ? body.sourceChannelId : null;
      const targetGuildId = typeof body?.targetGuildId === 'string' ? body.targetGuildId : null;
      const targetChannelId = typeof body?.targetChannelId === 'string' ? body.targetChannelId : null;
      if (!sourceChannelId || !targetGuildId || !targetChannelId) {
        json(res, 400, { error: 'sourceChannelId, targetGuildId et targetChannelId requis' });
        return true;
      }

      const targetGuild = client.guilds.cache.get(targetGuildId);
      if (!targetGuild) {
        json(res, 400, { error: 'Le bot n\'est pas présent sur le serveur cible.' });
        return true;
      }

      let targetMember;
      try {
        targetMember = await targetGuild.members.fetch(user.userId);
      } catch {
        targetMember = null;
      }
      if (!targetMember || (!targetMember.permissions.has('Administrator') && !targetMember.permissions.has('ManageGuild'))) {
        json(res, 403, { error: 'Vous devez être admin du serveur cible.' });
        return true;
      }

      const result = await createDirectLink({
        sourceGuildId: guildId,
        sourceChannelId,
        targetGuildId,
        targetChannelId,
        createdByUserId: user.userId,
        direction: body?.direction === 'UNIDIRECTIONAL' ? 'UNIDIRECTIONAL' : 'BIDIRECTIONAL',
        relayMode: body?.relayMode === 'EMBED' ? 'EMBED' : 'WEBHOOK',
        client,
      });

      if ('error' in result) {
        json(res, 400, { error: result.error });
        return true;
      }

      let serverInviteUrl: string | null = null;
      let topicUpdated = false;
      if (body?.createServerInvite) {
        try {
          const sourceGuild = client.guilds.cache.get(guildId);
          const sourceChannel = sourceGuild?.channels.cache.get(sourceChannelId);
          if (sourceChannel && 'createInvite' in sourceChannel && typeof sourceChannel.createInvite === 'function') {
            const discordInvite = await sourceChannel.createInvite({
              maxAge: 0,
              maxUses: 0,
              reason: 'Kotbo Link: Invitation pour la description du salon lié',
            });
            serverInviteUrl = discordInvite.url;

            const targetGuild = client.guilds.cache.get(targetGuildId);
            const targetChannel = targetGuild?.channels.cache.get(targetChannelId);
            if (targetChannel && 'setTopic' in targetChannel && typeof targetChannel.setTopic === 'function') {
              try {
                const currentTopic = (targetChannel as any).topic ?? '';
                const inviteTag = `🔗 ${discordInvite.url}`;
                const cleanTopic = currentTopic.replace(/\n?🔗 https:\/\/discord\.gg\/\S+/g, '').trim();
                const newTopic = cleanTopic ? `${cleanTopic}\n${inviteTag}` : inviteTag;
                await targetChannel.setTopic(newTopic);
                topicUpdated = true;
              } catch (topicErr) {
                logger.warn('ChannelLinkAPI', 'Impossible de modifier le topic du salon cible', topicErr);
              }
            }
          }
        } catch (err) {
          logger.warn('ChannelLinkAPI', 'Impossible de créer l\'invitation Discord', err);
        }
      }

      json(res, 201, { ...result, serverInviteUrl, topicUpdated });
    } catch (err) {
      logger.error('ChannelLinkAPI', 'Erreur POST direct link', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/channel-links/invites
  if (parts.length === 6 && parts[5] === 'invites' && method === 'GET') {
    try {
      const invites = await prisma.channelLinkInvite.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      json(res, 200, invites);
    } catch (err) {
      logger.error('ChannelLinkAPI', 'Erreur GET invites', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/channel-links/invites
  if (parts.length === 6 && parts[5] === 'invites' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!body?.channelId) {
        json(res, 400, { error: 'channelId requis' });
        return true;
      }

      const { randomBytes } = await import('node:crypto');
      const code = randomBytes(6).toString('hex').toUpperCase();

      const invite = await prisma.channelLinkInvite.create({
        data: {
          code,
          guildId,
          channelId: String(body?.channelId ?? ''),
          direction: body?.direction === 'UNIDIRECTIONAL' ? 'UNIDIRECTIONAL' : 'BIDIRECTIONAL',
          relayMode: body?.relayMode === 'EMBED' ? 'EMBED' : 'WEBHOOK',
          relayText: typeof body?.relayText === 'boolean' ? body.relayText : true,
          relayImages: typeof body?.relayImages === 'boolean' ? body.relayImages : true,
          relayEmbeds: typeof body?.relayEmbeds === 'boolean' ? body.relayEmbeds : false,
          relayReactions: typeof body?.relayReactions === 'boolean' ? body.relayReactions : false,
          relayEdits: typeof body?.relayEdits === 'boolean' ? body.relayEdits : true,
          relayDeletes: typeof body?.relayDeletes === 'boolean' ? body.relayDeletes : true,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          createdByUserId: user.userId,
        },
      });

      let serverInviteUrl: string | null = null;
      if (body.createServerInvite) {
        try {
          const guild = client.guilds.cache.get(guildId);
          const channel = guild?.channels.cache.get(String(body?.channelId ?? ''));
          if (channel && 'createInvite' in channel && typeof channel.createInvite === 'function') {
            const discordInvite = await channel.createInvite({
              maxAge: 24 * 60 * 60,
              maxUses: 5,
              reason: 'Kotbo Link: Invitation pour lier le salon',
            });
            serverInviteUrl = discordInvite.url;
          }
        } catch (err) {
          logger.warn('ChannelLinkAPI', 'Impossible de créer l\'invitation Discord', err);
        }
      }

      json(res, 201, { ...invite, serverInviteUrl });
    } catch (err) {
      logger.error('ChannelLinkAPI', 'Erreur POST invite', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // PATCH /api/dashboard/guilds/:guildId/channel-links/:linkId
  if (parts.length === 6 && parts[5] !== 'invites' && parts[5] !== 'other-guilds' && parts[5] !== 'direct' && method === 'PATCH') {
    try {
      const linkId = parts[5];
      const body = await readJsonBody(req);

      const link = await prisma.channelLink.findUnique({ where: { id: linkId } });
      if (!link || (link.sourceGuildId !== guildId && link.targetGuildId !== guildId)) {
        json(res, 404, { error: 'Lien introuvable' });
        return true;
      }

      const allowedFields = ['relayText', 'relayImages', 'relayEmbeds', 'relayReactions', 'relayEdits', 'relayDeletes', 'relayThreads', 'relayPolls', 'sourceRelayMode', 'targetRelayMode', 'direction', 'enabled', 'updateTopic'];
      const updateData: Record<string, any> = {};
      for (const field of allowedFields) {
        if (body?.[field] !== undefined) updateData[field] = body[field];
      }

      // Passe par le service : lui seul sait invalider le cache des liens,
      // rouvrir ou refermer la garde des serveurs en liaison seule et purger les
      // correspondances de messages devenues inutiles.
      const updated = await updateLinkConfig(linkId, updateData);
      if (!updated) {
        json(res, 404, { error: 'Lien introuvable' });
        return true;
      }

      json(res, 200, updated);
    } catch (err) {
      logger.error('ChannelLinkAPI', 'Erreur PATCH channel-link', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/channel-links/:linkId/invite
  if (parts.length === 7 && parts[6] === 'invite' && method === 'POST') {
    try {
      const linkId = parts[5];
      const link = await prisma.channelLink.findUnique({ where: { id: linkId } });
      if (!link || (link.sourceGuildId !== guildId && link.targetGuildId !== guildId)) {
        json(res, 404, { error: 'Lien introuvable' });
        return true;
      }

      const isSource = link.sourceGuildId === guildId;
      const localChannelId = isSource ? link.sourceChannelId : link.targetChannelId;
      const remoteGuildId = isSource ? link.targetGuildId : link.sourceGuildId;
      const remoteChannelId = isSource ? link.targetChannelId : link.sourceChannelId;

      const localGuild = client.guilds.cache.get(guildId);
      const localChannel = localGuild?.channels.cache.get(localChannelId);

      if (!localChannel || !('createInvite' in localChannel) || typeof localChannel.createInvite !== 'function') {
        json(res, 400, { error: 'Impossible de créer une invitation sur ce salon.' });
        return true;
      }

      const discordInvite = await localChannel.createInvite({
        maxAge: 0,
        maxUses: 0,
        reason: 'Kotbo Link: Invitation pour la description du salon lié',
      });

      const remoteGuild = client.guilds.cache.get(remoteGuildId);
      const remoteChannel = remoteGuild?.channels.cache.get(remoteChannelId);
      let topicUpdated = false;

      if (remoteChannel && 'setTopic' in remoteChannel && typeof remoteChannel.setTopic === 'function') {
        try {
          const currentTopic = (remoteChannel as any).topic ?? '';
          const inviteTag = `🔗 ${discordInvite.url}`;
          const cleanTopic = currentTopic.replace(/\n?🔗 https:\/\/discord\.gg\/\S+/g, '').trim();
          const newTopic = cleanTopic ? `${cleanTopic}\n${inviteTag}` : inviteTag;
          await remoteChannel.setTopic(newTopic);
          topicUpdated = true;
        } catch (err) {
          logger.warn('ChannelLinkAPI', 'Impossible de modifier le topic du salon distant', err);
        }
      }

      json(res, 201, { inviteUrl: discordInvite.url, topicUpdated });
    } catch (err) {
      logger.error('ChannelLinkAPI', 'Erreur POST invite pour link', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  // DELETE /api/dashboard/guilds/:guildId/channel-links/:linkId
  if (parts.length === 6 && parts[5] !== 'invites' && parts[5] !== 'other-guilds' && parts[5] !== 'direct' && method === 'DELETE') {
    try {
      const linkId = parts[5];
      const link = await prisma.channelLink.findUnique({ where: { id: linkId } });
      if (!link || (link.sourceGuildId !== guildId && link.targetGuildId !== guildId)) {
        json(res, 404, { error: 'Lien introuvable' });
        return true;
      }

      await removeLink(linkId, client);
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('ChannelLinkAPI', 'Erreur DELETE channel-link', err);
      json(res, 500, { error: 'Erreur serveur' });
    }
    return true;
  }

  return false;
}
