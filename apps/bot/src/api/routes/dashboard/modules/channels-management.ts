/** Routes dashboard du module `channels-management`. */
import { updateGuildStats } from '../../../../events/stats.js';
import { readStatsConfig } from '../../../../services/analytics/statsConfig.js';
import { cache } from '../../../../utils/cache.js';
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { getGuildName, json, pushAudit, readJsonBody } from '../../../shared.js';
import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { type ModuleRouteContext } from './_shared.js';

export async function handleChannelsManagementRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, guildId, method, auditUser, moduleKey } = ctx;

  // POST /api/dashboard/guilds/:guildId/channels-management/rescan-stats
  if (moduleKey === 'channels-management' && parts.length === 6 && parts[5] === 'rescan-stats' && method === 'POST') {
    try {
      const body = await readJsonBody<{ force?: boolean; forcer?: boolean }>(req);
      const force = !!(body?.force || body?.forcer);

      const { startHistoricalScraping } = await import('../../../../services/analytics/messageScraperService.js');
      await startHistoricalScraping(client, guildId, force);

      json(res, 200, { ok: true, message: 'Scraping historique lancé avec succès.' });
    } catch (err) {
      logger.error('ChannelsManagementAPI', 'POST rescan-stats error:', err);
      json(res, 500, { error: 'Erreur lors du lancement du scraping' });
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/channels-management/temp-voice/channels
  if (moduleKey === 'channels-management' && parts.length === 7 && parts[5] === 'temp-voice' && parts[6] === 'channels' && method === 'GET') {
    try {
      const dbChannels = await prisma.tempVoiceChannel.findMany({
        where: { guildId }
      });

      const discordGuild = client.guilds.cache.get(guildId);
      const activeChannels = [];

      for (const dbChan of dbChannels) {
        const channel = discordGuild?.channels.cache.get(dbChan.id);
        if (channel && channel.type === ChannelType.GuildVoice) {
          const creatorMember = discordGuild ? await discordGuild.members.fetch(dbChan.creatorId).catch(() => null) : null;
          activeChannels.push({
            id: dbChan.id,
            name: channel.name,
            creatorId: dbChan.creatorId,
            creatorName: creatorMember?.displayName || 'Inconnu',
            creatorAvatar: creatorMember?.user.displayAvatarURL() || null,
            membersCount: channel.members.size,
            roleId: dbChan.roleId,
            createdAt: dbChan.createdAt
          });
        } else {
          // Clean up stale database entry
          await prisma.tempVoiceChannel.delete({ where: { id: dbChan.id } }).catch(() => null);
        }
      }

      json(res, 200, activeChannels);
    } catch (err) {
      logger.error('ChannelsManagementAPI', 'GET active channels error:', err);
      json(res, 500, { error: 'Erreur lors du chargement des salons actifs.' });
    }
    return true;
  }

  // PATCH /api/dashboard/guilds/:guildId/channels-management/temp-voice/channels/:channelId
  if (moduleKey === 'channels-management' && parts.length === 8 && parts[5] === 'temp-voice' && parts[6] === 'channels' && method === 'PATCH') {
    const channelId = parts[7];
    try {
      const body = await readJsonBody<{ name?: string; roleId?: string | null; action?: 'DELETE' }>(req);
      const discordGuild = client.guilds.cache.get(guildId);
      const channel = discordGuild?.channels.cache.get(channelId);

      if (!channel || channel.type !== ChannelType.GuildVoice) {
        json(res, 404, { error: 'Salon introuvable.' });
        return true;
      }

      const dbChan = await prisma.tempVoiceChannel.findUnique({
        where: { id: channelId }
      });

      if (!dbChan) {
        json(res, 404, { error: 'Salon non enregistré.' });
        return true;
      }

      // 1. Action Delete
      if (body?.action === 'DELETE') {
        // Disconnect members
        for (const [_, member] of channel.members) {
          await member.voice.disconnect('Salon temporaire fermé via le dashboard.').catch(() => null);
        }
        await channel.delete('Fermé par le dashboard.').catch(() => null);
        await prisma.tempVoiceChannel.delete({ where: { id: channelId } }).catch(() => null);

        // Also clean up from local memory cache
        const { tempChannels } = await import('../../../../events/tempVoice.js');
        tempChannels.delete(channelId);

        await pushAudit(guildId, {
          user: auditUser,
          action: `Fermeture forcée du salon temporaire ${channel.name}`,
          context: getGuildName(client, guildId),
          module: 'Gestion des salons',
          eventType: 'Manuel',
          details: `Salon temporaire ${channel.name} (${channelId}) supprimé par l'administrateur.`,
          channelId: null
        });

        json(res, 200, { ok: true, message: 'Salon fermé avec succès.' });
        return true;
      }

      // 2. Action Update (Rename/Reserve)
      const data: Record<string, unknown> = {};

      if (body?.name !== undefined && body.name.trim() !== '') {
        const newName = body.name.trim();
        await channel.setName(newName).catch(() => null);
        await pushAudit(guildId, {
          user: auditUser,
          action: `Renommer salon temporaire ${channel.name} -> ${newName}`,
          context: getGuildName(client, guildId),
          module: 'Gestion des salons',
          eventType: 'Manuel',
          details: `Renommé de ${channel.name} à ${newName}.`,
          channelId: null
        });
      }

      if (body?.roleId !== undefined) {
        const newRoleId = body.roleId; // string | null

        if (newRoleId) {
          // Deny everyone connect
          await channel.permissionOverwrites.edit(guildId, {
            Connect: false
          }).catch(() => null);

          // Allow creator
          await channel.permissionOverwrites.edit(dbChan.creatorId, {
            Connect: true,
            ViewChannel: true,
            Speak: true
          }).catch(() => null);

          // Allow role
          await channel.permissionOverwrites.edit(newRoleId, {
            Connect: true,
            ViewChannel: true,
            Speak: true
          }).catch(() => null);

          data.roleId = newRoleId;
        } else {
          // Clear role connect restriction, revert back to general connect permission for everyone
          await channel.permissionOverwrites.edit(guildId, {
            Connect: true
          }).catch(() => null);

          data.roleId = null;
        }

        await prisma.tempVoiceChannel.update({
          where: { id: channelId },
          data
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: newRoleId ? `Réservation du salon ${channel.name} pour le rôle ID ${newRoleId}` : `Libération de la réservation du salon ${channel.name}`,
          context: getGuildName(client, guildId),
          module: 'Gestion des salons',
          eventType: 'Manuel',
          details: newRoleId ? `Accès restreint au rôle ${newRoleId}.` : `Salon ouvert à tous.`,
          channelId: null
        });
      }

      json(res, 200, { ok: true, message: 'Salon mis à jour avec succès.' });
    } catch (err) {
      logger.error('ChannelsManagementAPI', 'PATCH active channel error:', err);
      json(res, 500, { error: 'Erreur lors du mise à jour du salon.' });
    }
    return true;
  }

  // GET/PATCH /api/dashboard/guilds/:guildId/channels-management
  if (moduleKey === 'channels-management' && parts.length === 5) {
    if (method === 'GET') {
      try {
        const guild = await prisma.guild.findUnique({
          where: { id: guildId },
          select: {
            autoThreadEnabled: true,
            autoThreadChannels: true,
            autoThreadBotsEnabled: true,
            statsEnabled: true,
            statsConfig: true,
            tempVoiceEnabled: true,
            tempVoiceChannelId: true,
            tempVoiceCategoryId: true,
            tempVoiceNameTemplate: true,
            tempVoiceRequiredRoleId: true,
            tempVoiceGenerators: true,
            honeypotEnabled: true,
            honeypotChannelId: true,
            honeypotSanction: true,
            honeypotReinvite: true,
            verificationEnabled: true,
            verificationMode: true,
            verificationAction: true,
            verificationChannelId: true,
            verificationFallbackChannelId: true,
            verificationRoleId: true,
            verificationLogChannelId: true,
            verificationEmbedTitle: true,
            verificationEmbedDesc: true,
            verificationEmbedColor: true,
            verificationOnJoin: true,
            verificationSaveIp: true,
            verificationSaveDevice: true,
            verificationLevelCommand: true,
            verificationLevelJoin: true,
            verificationWarnThreshold: true,
            verificationWarnAutoMode: true,
            verificationWarnReason: true,
            warnWeightingEnabled: true,
            warnDecayDays: true,
            wordStatsEnabled: true,
            banHygieneEnabled: true,
          },
        });
        if (!guild) {
          json(res, 404, { error: 'Serveur introuvable' });
          return true;
        }
        json(res, 200, {
          autoThreadEnabled: guild.autoThreadEnabled,
          autoThreadChannels: guild.autoThreadChannels,
          autoThreadBotsEnabled: guild.autoThreadBotsEnabled,
          statsEnabled: guild.statsEnabled,
          statsConfig: guild.statsConfig,
          tempVoiceEnabled: guild.tempVoiceEnabled,
          tempVoiceChannelId: guild.tempVoiceChannelId,
          tempVoiceCategoryId: guild.tempVoiceCategoryId,
          tempVoiceNameTemplate: guild.tempVoiceNameTemplate,
          tempVoiceRequiredRoleId: guild.tempVoiceRequiredRoleId,
          tempVoiceGenerators: guild.tempVoiceGenerators,
          honeypotEnabled: guild.honeypotEnabled,
          honeypotChannelId: guild.honeypotChannelId,
          honeypotSanction: guild.honeypotSanction,
          honeypotReinvite: guild.honeypotReinvite,
          verificationEnabled: guild.verificationEnabled,
          verificationMode: guild.verificationMode,
          verificationAction: guild.verificationAction,
          verificationChannelId: guild.verificationChannelId,
          verificationFallbackChannelId: guild.verificationFallbackChannelId,
          verificationRoleId: guild.verificationRoleId,
          verificationLogChannelId: guild.verificationLogChannelId,
          verificationEmbedTitle: guild.verificationEmbedTitle,
          verificationEmbedDesc: guild.verificationEmbedDesc,
           verificationEmbedColor: guild.verificationEmbedColor,
          verificationOnJoin: guild.verificationOnJoin,
          verificationSaveIp: guild.verificationSaveIp,
          verificationSaveDevice: guild.verificationSaveDevice,
          verificationLevelCommand: guild.verificationLevelCommand,
          verificationLevelJoin: guild.verificationLevelJoin,
          verificationWarnThreshold: guild.verificationWarnThreshold,
          verificationWarnAutoMode: guild.verificationWarnAutoMode,
          verificationWarnReason: guild.verificationWarnReason,
          warnWeightingEnabled: guild.warnWeightingEnabled,
          warnDecayDays: guild.warnDecayDays,
          wordStatsEnabled: guild.wordStatsEnabled,
          banHygieneEnabled: guild.banHygieneEnabled,
        });
      } catch (err) {
        logger.error('ChannelsManagementAPI', 'GET config error:', err);
        json(res, 500, { error: 'Erreur lors de la récupération de la configuration' });
      }
      return true;
    }

    if (method === 'PATCH') {
      try {
        const body = await readJsonBody<{
          autoThreadEnabled?: boolean;
          autoThreadChannels?: string[];
          autoThreadBotsEnabled?: boolean;
          statsEnabled?: boolean;
          statsConfig?: unknown;
          tempVoiceEnabled?: boolean;
          tempVoiceChannelId?: string | null;
          tempVoiceCategoryId?: string | null;
          tempVoiceNameTemplate?: string;
          tempVoiceRequiredRoleId?: string | null;
          tempVoiceGenerators?: Array<{ channelId?: string; categoryId?: string; nameTemplate?: string; requiredRoleId?: string | null }>;
          honeypotEnabled?: boolean;
          /** Demande au dashboard de creer le salon piege automatiquement. */
          createHoneypotChannel?: boolean;
          honeypotChannelId?: string | null;
          honeypotSanction?: string;
          honeypotReinvite?: boolean;
          verificationEnabled?: boolean;
          verificationMode?: string;
          verificationAction?: string;
          verificationChannelId?: string | null;
          verificationFallbackChannelId?: string | null;
          verificationRoleId?: string | null;
          verificationLogChannelId?: string | null;
          verificationEmbedTitle?: string;
          verificationEmbedDesc?: string;
          verificationEmbedColor?: string;
          verificationOnJoin?: boolean;
          verificationSaveIp?: boolean;
          verificationSaveDevice?: boolean;
          verificationLevelCommand?: string;
          verificationLevelJoin?: string;
          verificationWarnThreshold?: number | null;
          verificationWarnAutoMode?: string;
          verificationWarnReason?: string;
          warnWeightingEnabled?: boolean;
          warnDecayDays?: number | null;
          wordStatsEnabled?: boolean;
          banHygieneEnabled?: boolean;
        }>(req);

        if (!body) {
          json(res, 400, { error: 'Payload invalide' });
          return true;
        }

        const data: Record<string, unknown> = {};
        if (Object.prototype.hasOwnProperty.call(body, 'autoThreadEnabled')) {
          data.autoThreadEnabled = !!body.autoThreadEnabled;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'autoThreadChannels')) {
          data.autoThreadChannels = body.autoThreadChannels;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'autoThreadBotsEnabled')) {
          data.autoThreadBotsEnabled = !!body.autoThreadBotsEnabled;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'statsEnabled')) {
          data.statsEnabled = !!body.statsEnabled;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'statsConfig')) {
          data.statsConfig = body.statsConfig;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'tempVoiceEnabled')) {
          data.tempVoiceEnabled = !!body.tempVoiceEnabled;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'tempVoiceChannelId')) {
          data.tempVoiceChannelId = body.tempVoiceChannelId;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'tempVoiceCategoryId')) {
          data.tempVoiceCategoryId = body.tempVoiceCategoryId;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'tempVoiceNameTemplate')) {
          data.tempVoiceNameTemplate = body.tempVoiceNameTemplate;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'tempVoiceRequiredRoleId')) {
          data.tempVoiceRequiredRoleId = body.tempVoiceRequiredRoleId;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'tempVoiceGenerators')) {
          data.tempVoiceGenerators = body.tempVoiceGenerators;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'honeypotEnabled')) {
          data.honeypotEnabled = !!body.honeypotEnabled;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'honeypotChannelId')) {
          data.honeypotChannelId = body.honeypotChannelId;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'honeypotSanction')) {
          if (['WARN', 'KICK', 'TIMEOUT', 'BAN', 'SOFTBAN'].includes(body.honeypotSanction as string)) {
            data.honeypotSanction = body.honeypotSanction;
          } else {
            json(res, 400, { error: 'Type de sanction honeypot invalide' });
            return true;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'honeypotReinvite')) {
          data.honeypotReinvite = !!body.honeypotReinvite;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationEnabled')) {
          data.verificationEnabled = !!body.verificationEnabled;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationMode')) {
          if (['DM', 'EMBED'].includes(body.verificationMode as string)) {
            data.verificationMode = body.verificationMode;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationAction')) {
          if (['AUTO_LINK', 'NOTIFY_STAFF'].includes(body.verificationAction as string)) {
            data.verificationAction = body.verificationAction;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationChannelId')) {
          data.verificationChannelId = body.verificationChannelId;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationFallbackChannelId')) {
          data.verificationFallbackChannelId = body.verificationFallbackChannelId;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationRoleId')) {
          data.verificationRoleId = body.verificationRoleId;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationLogChannelId')) {
          data.verificationLogChannelId = body.verificationLogChannelId;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationEmbedTitle')) {
          data.verificationEmbedTitle = (body.verificationEmbedTitle || '').slice(0, 256);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationEmbedDesc')) {
          data.verificationEmbedDesc = (body.verificationEmbedDesc || '').slice(0, 2048);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationEmbedColor')) {
          data.verificationEmbedColor = body.verificationEmbedColor;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationOnJoin')) {
          data.verificationOnJoin = !!body.verificationOnJoin;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationSaveIp')) {
          data.verificationSaveIp = !!body.verificationSaveIp;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationSaveDevice')) {
          data.verificationSaveDevice = !!body.verificationSaveDevice;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationLevelCommand')) {
          if (['LOW', 'MEDIUM', 'HIGH'].includes(body.verificationLevelCommand as string)) {
            data.verificationLevelCommand = body.verificationLevelCommand;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationLevelJoin')) {
          if (['LOW', 'MEDIUM', 'HIGH'].includes(body.verificationLevelJoin as string)) {
            data.verificationLevelJoin = body.verificationLevelJoin;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationWarnThreshold')) {
          // null or 0 = disabled, positive integer = threshold
          if (body.verificationWarnThreshold === null || body.verificationWarnThreshold === 0) {
            data.verificationWarnThreshold = null;
          } else if (typeof body.verificationWarnThreshold === 'number' && body.verificationWarnThreshold > 0) {
            data.verificationWarnThreshold = Math.floor(body.verificationWarnThreshold);
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationWarnAutoMode')) {
          if (['FULL_AUTO', 'NOTIFY_STAFF'].includes(body.verificationWarnAutoMode as string)) {
            data.verificationWarnAutoMode = body.verificationWarnAutoMode;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'verificationWarnReason')) {
          data.verificationWarnReason = (body.verificationWarnReason || '').slice(0, 512);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'warnWeightingEnabled')) {
          data.warnWeightingEnabled = !!body.warnWeightingEnabled;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'warnDecayDays')) {
          // null ou 0 = pas de décroissance, entier positif = fenêtre en jours
          if (body.warnDecayDays === null || body.warnDecayDays === 0) {
            data.warnDecayDays = null;
          } else if (typeof body.warnDecayDays === 'number' && body.warnDecayDays > 0) {
            data.warnDecayDays = Math.floor(body.warnDecayDays);
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'wordStatsEnabled')) {
          data.wordStatsEnabled = !!body.wordStatsEnabled;
        }
        // Capturé avant l'update : sert à détecter la bascule off → on plus bas.
        const wordStatsWasEnabled = Object.prototype.hasOwnProperty.call(body, 'wordStatsEnabled')
          ? (await prisma.guild.findUnique({ where: { id: guildId }, select: { wordStatsEnabled: true } }))?.wordStatsEnabled ?? false
          : null;
        if (Object.prototype.hasOwnProperty.call(body, 'banHygieneEnabled')) {
          data.banHygieneEnabled = !!body.banHygieneEnabled;
        }

        const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);

        if (discordGuild) {
          if (body.tempVoiceEnabled) {
            if (!body.tempVoiceCategoryId) {
              const existing = discordGuild.channels.cache.find(
                c => c.type === ChannelType.GuildCategory && c.name === '🔊 Salons Vocaux'
              );
              const cat = existing || await discordGuild.channels.create({
                name: '🔊 Salons Vocaux',
                type: ChannelType.GuildCategory,
              }).catch(() => null);
              if (cat) data.tempVoiceCategoryId = cat.id;
            }
            if (!body.tempVoiceChannelId) {
              const parentId = (data.tempVoiceCategoryId as string | undefined) || body.tempVoiceCategoryId || undefined;
              const newVoice = await discordGuild.channels.create({
                name: '➕ Créer un salon',
                type: ChannelType.GuildVoice,
                parent: parentId,
              }).catch(() => null);
              if (newVoice) {
                data.tempVoiceChannelId = newVoice.id;
              }
            }

            // Auto-create channels for additional generators
            if (Array.isArray(body.tempVoiceGenerators)) {
              const resolvedGenerators = [];
              for (const gen of body.tempVoiceGenerators) {
                const resolved = { ...gen };

                if (!resolved.categoryId) {
                  const cat = await discordGuild.channels.create({
                    name: '🔊 Salons Vocaux',
                    type: ChannelType.GuildCategory,
                  }).catch(() => null);
                  if (cat) resolved.categoryId = cat.id;
                }

                if (!resolved.channelId) {
                  const newVoice = await discordGuild.channels.create({
                    name: '➕ Créer un salon',
                    type: ChannelType.GuildVoice,
                    parent: resolved.categoryId || undefined,
                  }).catch(() => null);
                  if (newVoice) resolved.channelId = newVoice.id;
                }

                if (resolved.channelId) {
                  resolvedGenerators.push(resolved);
                }
              }
              data.tempVoiceGenerators = resolvedGenerators;
            }
          }

          if (body.honeypotEnabled && body.createHoneypotChannel) {
            const newHoneypot = await discordGuild.channels.create({
              name: 'ne-rien-envoyer-ici',
              type: ChannelType.GuildText,
              permissionOverwrites: [
                {
                  id: discordGuild.roles.everyone.id,
                  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
              ],
            }).catch(() => null);
            if (newHoneypot) {
              data.honeypotChannelId = newHoneypot.id;

              const honeyEmbed = new EmbedBuilder()
                .setTitle('⚠️ SALON PROTECTEUR - NE PAS ÉCRIRE ⚠️')
                .setDescription(
                  '### 🛡️ Honeypot de Sécurité\n\n' +
                  "Ce salon sert d'appât pour intercepter les bots de spam et les comptes compromis.\n\n" +
                  '> 🛑 **RÈGLE CRUCIALE** : Ne postez **absolument aucun** message dans ce salon sous peine de **BANNISSEMENT DÉFINITIF ET IMMÉDIAT** de ce serveur Discord.\n\n' +
                  '*Si vous êtes un utilisateur légitime, ignorez ou masquez simplement ce salon.*'
                )
                .setColor(0xEE5555)
                .setTimestamp()
                .setFooter({ text: 'Système de protection Kotbo' });

              await newHoneypot.send({ embeds: [honeyEmbed], allowedMentions: { parse: [] } }).catch(() => null);
            }
          }

          if (body.statsEnabled && body.statsConfig) {
            const sc = readStatsConfig(body.statsConfig);

            const needsMember = sc.memberChannelId === '' || sc.memberChannelId === null;
            const needsBot = sc.botChannelId === '' || sc.botChannelId === null;
            const needsRole = sc.roleChannelId === '' || sc.roleChannelId === null;
            const needsChannel = sc.channelChannelId === '' || sc.channelChannelId === null;
            const needsCategory = sc.categoryChannelId === '' || sc.categoryChannelId === null;
            const needsActivity = sc.activityChannelId === '' || sc.activityChannelId === null;
            const needsCustomStats = Array.isArray(sc.customStats) && sc.customStats.some((c) => c.enabled && !c.channelId);

            if (needsMember || needsBot || needsRole || needsChannel || needsCategory || needsActivity || needsCustomStats || !sc.categoryId) {
              let statsCatId: string | undefined = sc.categoryId || undefined;
              
              if (!statsCatId) {
                const existingStatsCat = discordGuild.channels.cache.find(
                  c => c.type === ChannelType.GuildCategory && c.name === '📊 Statistiques'
                );
                if (existingStatsCat) {
                  statsCatId = existingStatsCat.id;
                } else {
                  const newCat = await discordGuild.channels.create({
                    name: '📊 Statistiques',
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                      {
                        id: discordGuild.roles.everyone.id,
                        deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages],
                      },
                    ],
                  }).catch(() => null);
                  if (newCat) statsCatId = newCat.id;
                }
              }

              const createStatChannel = async (defaultName: string, asCategory = false): Promise<string | undefined> => {
                if (asCategory) {
                  const ch = await discordGuild.channels.create({
                    name: defaultName,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                      {
                        id: discordGuild.roles.everyone.id,
                        deny: [PermissionFlagsBits.SendMessages],
                      },
                    ],
                  }).catch(() => null);
                  return ch?.id;
                }
                const ch = await discordGuild.channels.create({
                  name: defaultName,
                  type: ChannelType.GuildVoice,
                  parent: statsCatId,
                  permissionOverwrites: [
                    {
                      id: discordGuild.roles.everyone.id,
                      deny: [PermissionFlagsBits.Connect],
                    },
                  ],
                }).catch(() => null);
                return ch?.id;
              };

              const newSc = { ...sc };
              if (statsCatId) {
                newSc.categoryId = statsCatId;
              }

              if (needsMember) {
                const tpl = sc.memberTemplate || '👤 Membres : {count}';
                newSc.memberChannelId = await createStatChannel(tpl.replace('{count}', '…')) ?? sc.memberChannelId;
              }
              if (needsBot) {
                const tpl = sc.botTemplate || '🤖 Bots : {count}';
                newSc.botChannelId = await createStatChannel(tpl.replace('{count}', '…')) ?? sc.botChannelId;
              }
              if (needsRole) {
                const tpl = sc.roleTemplate || '👑 Staff : {count}';
                newSc.roleChannelId = await createStatChannel(tpl.replace('{count}', '…')) ?? sc.roleChannelId;
              }
              if (needsChannel) {
                const tpl = sc.channelTemplate || '💬 Salons : {count}';
                newSc.channelChannelId = await createStatChannel(tpl.replace('{count}', '…')) ?? sc.channelChannelId;
              }
              if (needsCategory) {
                const tpl = sc.categoryTemplate || '📁 Catégories : {count}';
                newSc.categoryChannelId = await createStatChannel(tpl.replace('{count}', '…')) ?? sc.categoryChannelId;
              }
              if (needsActivity) {
                const tpl = sc.activityTemplate || '📈 Actifs 24h : {count}';
                newSc.activityChannelId = await createStatChannel(tpl.replace('{count}', '…')) ?? sc.activityChannelId;
              }

              if (Array.isArray(sc.customStats)) {
                const updatedCustomStats = [];
                for (const custom of sc.customStats) {
                  const item = { ...custom };
                  if (item.enabled && !item.channelId) {
                    const tpl = item.template || 'Stat : {count}';
                    let initialName = tpl.replace('{count}', '…');
                    if (item.type === 'goal' && item.goalTarget) {
                      initialName = initialName.replace('{goal}', item.goalTarget.toString());
                    }
                    item.channelId = await createStatChannel(initialName, item.channelType === 'category') ?? '';
                  }
                  updatedCustomStats.push(item);
                }
                newSc.customStats = updatedCustomStats;
              }

              data.statsConfig = newSc;
            }
          }
        }

        await prisma.guild.update({
          where: { id: guildId },
          data,
        });

        // Purge les caches préfixés guild:<id>: - config du bot (getCachedGuild)
        // et payloads d'analytics avancées, qui embarquent les toggles (ex.
        // wordStatsEnabled). Sans ça, le dashboard continue d'afficher l'ancien
        // état pendant toute la durée du TTL.
        await cache.invalidateGuild(guildId);

        // Activation des stats de mots : indexer les messages déjà journalisés
        // plutôt que d'attendre que le tracker live accumule des données.
        if (wordStatsWasEnabled === false && data.wordStatsEnabled === true) {
          void (async () => {
            const { startWordStatsBackfill, backfillMessageMentions } = await import('../../../../services/analytics/wordStatsBackfillService.js');
            await backfillMessageMentions(guildId).catch((err) =>
              logger.error('ChannelsManagementAPI', `Backfill des mentions échoué pour ${guildId}:`, err),
            );
            await startWordStatsBackfill(guildId);
          })().catch((err) =>
            logger.error('ChannelsManagementAPI', `Lancement du backfill des stats de mots échoué pour ${guildId}:`, err),
          );
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Sauvegarde configuration Gestion des salons',
          context: getGuildName(client, guildId),
          module: 'Gestion des salons',
          eventType: 'Manuel',
          details: 'Configuration de la gestion des salons mise à jour.',
          channelId: null
        });

        if (body.statsEnabled) {
          updateGuildStats(client, guildId).catch((err) => 
            logger.error('ChannelsManagementAPI', `Erreur lors de la mise à jour des stats pour la guilde ${guildId} :`, err)
          );
        }

        if (Object.prototype.hasOwnProperty.call(body, 'autoThreadEnabled')) {
          await prisma.dashboardFeatureConfig.upsert({
            where: { guildId_featureKey: { guildId, featureKey: 'auto_thread' } },
            create: {
              guildId,
              featureKey: 'auto_thread',
              featureName: 'Gestion des salons',
              enabled: !!body.autoThreadEnabled,
              loggingEnabled: true,
              userActivityTracking: true,
              notifyViaDiscordChannel: true,
            },
            update: {
              enabled: !!body.autoThreadEnabled
            }
          });
        }

        json(res, 200, {
          ok: true,
          resolved: {
            tempVoiceChannelId: data.tempVoiceChannelId,
            tempVoiceCategoryId: data.tempVoiceCategoryId,
            tempVoiceGenerators: data.tempVoiceGenerators,
            honeypotChannelId: data.honeypotChannelId,
            honeypotSanction: data.honeypotSanction,
            honeypotReinvite: data.honeypotReinvite,
            statsConfig: data.statsConfig,
          }
        });
      } catch (err) {
        logger.error('ChannelsManagementAPI', 'PATCH config error:', err);
        json(res, 500, { error: 'Erreur lors de la mise à jour' });
      }
      return true;
    }
  }

  return false;
}
