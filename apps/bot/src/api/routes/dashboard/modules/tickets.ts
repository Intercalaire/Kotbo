/** Routes dashboard du module `tickets`. */
import { cache } from '../../../../utils/cache.js';
import prisma from '../../../../utils/db.js';
import { COLORS, successEmbed } from '../../../../utils/embeds.js';
import { errorMessage, errorStack } from '../../../../utils/errors.js';
import { resolveGuildLocale } from '../../../../utils/i18n.js';
import { logger } from '../../../../utils/logger.js';
import * as m from '../../../../lib/paraglide/messages.js';
import { extractMediaUrls, getGuildName, json, parseDiscordMarkdown, pushAudit, readJsonBody } from '../../../shared.js';
import { type ProvisionedEntry, acquireProvisionLock, missingProvisionPermissions, provisionCooldown, provisionCooldownMessage, releaseProvisionLock, startProvisionCooldown } from '../../../../services/core/channelProvisioningService.js';
import { Prisma } from '@prisma/client';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, type ColorResolvable, EmbedBuilder, type OverwriteResolvable, PermissionFlagsBits, TextChannel } from 'discord.js';
import { type ModuleRouteContext, msgEmbedsMap } from './_shared.js';
import { clampCommentTimeout } from '../../../../services/features/ticketSatisfactionService.js';

export async function handleTicketsRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, url, client, user, guildId, access, method, auditUser, moduleKey } = ctx;

  // Tickets routes
  if (moduleKey === 'tickets') {
    const isStaff = access.level === 'admin' || access.level === 'moderator';
    if (!isStaff) {
      json(res, 403, { error: 'Accès refusé. Réservé au staff.' });
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/tickets/config
    if (parts.length === 6 && parts[5] === 'config' && method === 'GET') {
      try {
        const guildConfig = await prisma.guild.findUnique({
          where: { id: guildId },
          select: {
            ticketCategoryId: true,
            ticketLogChannelId: true,
            ticketStaffRoleId: true,
            ticketChannelId: true,
            ticketEmbedTitle: true,
            ticketEmbedDesc: true,
            ticketEmbedButtonText: true,
            ticketEmbedColor: true,
            ticketEmbedType: true,
            ticketMode: true,
            ticketDmRelayChannelId: true,
            ticketTypes: true,
            ticketFormEnabled: true,
            ticketFormCustomFields: true,
            ticketEmbedThumbnail: true,
            ticketEmbedImage: true,
            ticketEmbedFooter: true,
            ticketEmbedAuthorName: true,
            ticketEmbedAuthorIcon: true,
            ticketWelcomeTitle: true,
            ticketWelcomeDesc: true,
            ticketWelcomeColor: true,
            ticketWelcomeThumbnail: true,
            ticketWelcomeImage: true,
            ticketWelcomeFooter: true,
            ticketAllowOverclaim: true,
            ticketOverclaimPermission: true,
            ticketInactivityEnabled: true,
            ticketInactivityHours: true,
            ticketInactivityMessage: true,
            ticketSatisfactionCommentEnabled: true,
            ticketSatisfactionCommentQuestion: true,
            ticketSatisfactionCommentTimeout: true,
          }
        });
        json(res, 200, guildConfig || {});
      } catch (err) {
        logger.error('TicketsAPI', 'Error getting ticket config:', err);
        json(res, 500, { error: 'Erreur configuration' });
      }
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/tickets/transcripts?q=&from=&to=&limit=&offset=
    if (parts.length === 6 && parts[5] === 'transcripts' && method === 'GET') {
      try {
        const q = url.searchParams.get('q')?.trim() || '';
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
        const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
        const includeTotal = url.searchParams.get('includeTotal') !== 'false';

        const where: Record<string, unknown> = { guildId };
        if (q) {
          where.OR = [
            { channelName: { contains: q, mode: 'insensitive' } },
            { channelId: { contains: q } },
            { id: { contains: q } },
          ];
        }
        if (from || to) {
          const createdAt: Record<string, Date> = {};
          if (from) { const d = new Date(from); if (!isNaN(d.getTime())) createdAt.gte = d; }
          if (to) { const d = new Date(to); if (!isNaN(d.getTime())) createdAt.lte = d; }
          if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;
        }

        const [transcripts, total] = await Promise.all([
          prisma.transcript.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: offset,
            take: limit,
            select: {
              id: true,
              guildId: true,
              channelId: true,
              channelName: true,
              startMessageId: true,
              endMessageId: true,
              startTime: true,
              endTime: true,
              createdAt: true
            }
          }),
          includeTotal ? prisma.transcript.count({ where }) : Promise.resolve(null),
        ]);
        json(res, 200, { transcripts, total, limit, offset });
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error listing transcripts: ${(err as Error).message}`);
        json(res, 500, { error: 'Erreur lors de la récupération des transcriptions' });
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/tickets/transcripts/:transcriptId
    if (parts.length === 7 && parts[5] === 'transcripts' && method === 'DELETE') {
      if (access.level !== 'admin') {
        json(res, 403, { error: 'Seuls les administrateurs peuvent supprimer des transcriptions.' });
        return true;
      }
      const transcriptId = parts[6];
      if (!/^[a-zA-Z0-9_-]+$/.test(transcriptId)) {
        json(res, 400, { error: 'ID de transcription invalide' });
        return true;
      }
      try {
        const transcript = await prisma.transcript.findUnique({
          where: { id: transcriptId },
          select: { id: true, guildId: true },
        });
        if (!transcript || transcript.guildId !== guildId) {
          json(res, 404, { error: 'Transcription introuvable' });
          return true;
        }
        await prisma.transcript.delete({ where: { id: transcriptId } });
        json(res, 200, { ok: true });
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error deleting transcript: ${(err as Error).message}`);
        json(res, 500, { error: 'Erreur lors de la suppression de la transcription' });
      }
      return true;
    }

    // Une transcription s'ouvre uniquement par la page /transcripts/:id du
    // dashboard, qui verifie les droits via /api/public/transcripts/:id/access
    // avant de charger le HTML signe dans son iframe. Le second point d'entree
    // qui vivait ici (.../tickets/transcripts/:id/signed-url) distribuait le
    // meme lien signe sans passer par cette page : il a ete retire.

    // PATCH /api/dashboard/guilds/:guildId/tickets/config
    if (parts.length === 6 && parts[5] === 'config' && method === 'PATCH') {
      if (access.level !== 'admin') {
        json(res, 403, { error: 'Seuls les administrateurs peuvent modifier la configuration.' });
        return true;
      }

      interface TicketConfigInput {
        ticketCategoryId?: string | null;
        ticketLogChannelId?: string | null;
        ticketStaffRoleId?: string | null;
        ticketChannelId?: string | null;
        ticketEmbedTitle?: string | null;
        ticketEmbedDesc?: string | null;
        ticketEmbedButtonText?: string | null;
        ticketEmbedColor?: string | null;
        ticketEmbedType?: string | null;
        ticketMode?: string | null;
        ticketDmRelayChannelId?: string | null;
        ticketFormEnabled?: boolean | null;
        ticketFormCustomFields?: Record<string, unknown> | unknown[] | null;
        ticketEmbedThumbnail?: string | null;
        ticketEmbedImage?: string | null;
        ticketEmbedFooter?: string | null;
        ticketEmbedAuthorName?: string | null;
        ticketEmbedAuthorIcon?: string | null;
        ticketWelcomeTitle?: string | null;
        ticketWelcomeDesc?: string | null;
        ticketWelcomeColor?: string | null;
        ticketWelcomeThumbnail?: string | null;
        ticketWelcomeImage?: string | null;
        ticketWelcomeFooter?: string | null;
        /** Types de tickets proposes a l'ouverture, valides plus bas champ par champ. */
        ticketTypes?: unknown;
        ticketAllowOverclaim?: unknown;
        ticketInactivityEnabled?: unknown;
        ticketInactivityHours?: unknown;
        ticketInactivityMessage?: unknown;
        ticketSatisfactionCommentEnabled?: unknown;
        ticketSatisfactionCommentQuestion?: unknown;
        ticketSatisfactionCommentTimeout?: unknown;
        ticketOverclaimPermission?: unknown;
      }

      try {
        const body = (await readJsonBody<TicketConfigInput>(req)) ?? {};
        const updated = await prisma.guild.update({
          where: { id: guildId },
          data: {
            ticketCategoryId: body.ticketCategoryId || null,
            ticketLogChannelId: body.ticketLogChannelId || null,
            ticketStaffRoleId: body.ticketStaffRoleId || null,
            ticketChannelId: body.ticketChannelId || null,
            // Un champ vide est conserve tel quel : c'est ainsi que le bot sait
            // qu'il doit composer le texte par defaut dans la langue du serveur.
            // Y reecrire un texte francais le figerait a chaque enregistrement.
            ticketEmbedTitle: body.ticketEmbedTitle ?? '',
            ticketEmbedDesc: body.ticketEmbedDesc ?? '',
            ticketEmbedButtonText: body.ticketEmbedButtonText ?? '',
            ticketEmbedColor: body.ticketEmbedColor || '#5865F2',
            ticketEmbedType: body.ticketEmbedType === 'DROPDOWN' ? 'DROPDOWN' : 'BUTTONS',
            ticketMode: body.ticketMode === 'DM' || body.ticketMode === 'THREAD' ? body.ticketMode : 'CHANNEL',
            ticketDmRelayChannelId: body.ticketDmRelayChannelId || null,
            ticketFormEnabled: body.ticketFormEnabled ?? true,
            ticketFormCustomFields: (body.ticketFormCustomFields ?? null) as Prisma.InputJsonValue,
            ticketEmbedThumbnail: body.ticketEmbedThumbnail || null,
            ticketEmbedImage: body.ticketEmbedImage || null,
            ticketEmbedFooter: body.ticketEmbedFooter || null,
            ticketEmbedAuthorName: body.ticketEmbedAuthorName || null,
            ticketEmbedAuthorIcon: body.ticketEmbedAuthorIcon || null,
            ticketWelcomeTitle: body.ticketWelcomeTitle ?? '',
            ticketWelcomeDesc: body.ticketWelcomeDesc ?? '',
            ticketWelcomeColor: body.ticketWelcomeColor || "#5865F2",
            ticketWelcomeThumbnail: body.ticketWelcomeThumbnail || null,
            ticketWelcomeImage: body.ticketWelcomeImage || null,
            ticketWelcomeFooter: body.ticketWelcomeFooter ?? '',
            ...(body.ticketTypes !== undefined
              ? {
                  ticketTypes: Array.isArray(body.ticketTypes)
                    ? body.ticketTypes
                        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
                        .map((item, index: number) => ({
                          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `ticket-type-${index + 1}`,
                          label: typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 80) : `Ticket ${index + 1}`,
                          description: typeof item.description === 'string' ? item.description.trim().slice(0, 200) : null,
                          emoji: typeof item.emoji === 'string' ? item.emoji.trim().slice(0, 16) : null,
                          categoryId: typeof item.categoryId === 'string' && item.categoryId.trim() ? item.categoryId.trim() : null,
                          staffRoleId: typeof item.staffRoleId === 'string' && item.staffRoleId.trim() ? item.staffRoleId.trim() : null,
                          buttonStyle: item.buttonStyle === 'SECONDARY' || item.buttonStyle === 'SUCCESS' || item.buttonStyle === 'DANGER'
                            ? item.buttonStyle
                            : 'PRIMARY',
                          mode: item.mode === 'CHANNEL' || item.mode === 'DM' || item.mode === 'THREAD' ? item.mode : null,
                          anonymous: item.anonymous === true,
                          staffServerRelay: item.staffServerRelay === true,
                          staffServerChannel: item.staffServerChannel === true,
                          staffServerCategoryId: typeof item.staffServerCategoryId === 'string' && item.staffServerCategoryId.trim() ? item.staffServerCategoryId.trim() : null,
                          formEnabled: item.formEnabled !== false,
                          fields: Array.isArray(item.fields) ? item.fields : null,
                          formCustomFields: Array.isArray(item.formCustomFields) ? item.formCustomFields : null,
                        })) as unknown as Prisma.InputJsonValue
                    : Prisma.JsonNull,
                }
              : {}),
            ticketAllowOverclaim: typeof body.ticketAllowOverclaim === 'boolean' ? body.ticketAllowOverclaim : true,
            ticketOverclaimPermission: typeof body.ticketOverclaimPermission === 'string' ? body.ticketOverclaimPermission : 'ANY',
            ticketInactivityEnabled: typeof body.ticketInactivityEnabled === 'boolean' ? body.ticketInactivityEnabled : false,
            ticketInactivityHours: body.ticketInactivityHours !== undefined ? Number(body.ticketInactivityHours) : 24,
            ticketInactivityMessage: body.ticketInactivityMessage !== undefined ? String(body.ticketInactivityMessage) : '',
            ticketSatisfactionCommentEnabled: typeof body.ticketSatisfactionCommentEnabled === 'boolean' ? body.ticketSatisfactionCommentEnabled : true,
            // Vide = le bot pose sa question par defaut, comme pour les textes d'embed.
            ticketSatisfactionCommentQuestion: typeof body.ticketSatisfactionCommentQuestion === 'string' ? body.ticketSatisfactionCommentQuestion.trim().slice(0, 200) : '',
            ticketSatisfactionCommentTimeout: clampCommentTimeout(body.ticketSatisfactionCommentTimeout),
          }
        });

        json(res, 200, { success: true, config: updated });
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error updating ticket config: ${errorMessage(err)}`);
        json(res, 500, { error: 'Erreur lors de la mise à jour de la configuration' });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/tickets/config/send-embed
    if (parts.length === 7 && parts[5] === 'config' && parts[6] === 'send-embed' && method === 'POST') {
      if (access.level !== 'admin') {
        json(res, 403, { error: 'Seuls les administrateurs peuvent envoyer le panel.' });
        return true;
      }

      try {
        const { sendTicketSetupEmbed } = await import('../../../../services/features/ticketService.js');
        await sendTicketSetupEmbed(client, guildId);
        json(res, 200, { success: true });
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error sending ticket setup embed: ${errorMessage(err)}`);
        json(res, 500, { error: errorMessage(err) || "Erreur lors de l'envoi de l'embed" });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/tickets/config/setup
    if (parts.length === 7 && parts[5] === 'config' && parts[6] === 'setup' && method === 'POST') {
      if (access.level !== 'admin') {
        json(res, 403, { error: 'Seuls les administrateurs peuvent mettre le module en route.' });
        return true;
      }

      const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      if (!discordGuild) {
        json(res, 404, { error: 'Serveur Discord introuvable.' });
        return true;
      }

      const lockKey = `tickets:${guildId}`;
      if (!acquireProvisionLock(lockKey)) {
        json(res, 409, { error: 'Une mise en route est déjà en cours sur ce serveur.' });
        return true;
      }

      const items: ProvisionedEntry[] = [];
      const data: Prisma.GuildUpdateInput = {};
      // Ecrits au fil de l'eau : si une creation echoue en cours de route, la
      // tentative suivante reprend ce qui existe deja au lieu de le dupliquer.
      const persist = async () => {
        if (Object.keys(data).length > 0) {
          await prisma.guild.update({ where: { id: guildId }, data });
        }
      };

      try {
        const cooldown = await provisionCooldown(lockKey);
        if (cooldown) {
          json(res, 429, { error: provisionCooldownMessage(cooldown, 'La mise en route a déjà été lancée') });
          return true;
        }

        const missing = await missingProvisionPermissions(discordGuild, [PermissionFlagsBits.ManageChannels]);
        if (missing.length > 0) {
          json(res, 400, { error: `Le bot n'a pas les permissions nécessaires : ${missing.join(', ')}.` });
          return true;
        }

        // Les salons crees portent le nom dans la langue du serveur : ils sont
        // lus par ses membres, pas par l'admin qui clique depuis le dashboard.
        // Le motif inscrit au journal d'audit Discord la suit pour la meme
        // raison, c'est le serveur qui le relit.
        const locale = await resolveGuildLocale(guildId, discordGuild.preferredLocale);
        const reason = m.setup_reason_tickets({ user: auditUser }, { locale });

        const { provisionTicketChannels } = await import('../../../../services/features/ticketProvisioning.js');
        const outcome = await provisionTicketChannels(discordGuild, { locale, reason, items, data, persist });

        // Seulement sur un salon qu'on vient de creer : le renvoyer dans un
        // salon existant y empilerait un second panel.
        let panelSent = false;
        if (outcome.panelCreated) {
          const { sendTicketSetupEmbed } = await import('../../../../services/features/ticketService.js');
          await sendTicketSetupEmbed(client, guildId);
          panelSent = true;
        }

        // Arme apres l'envoi du panel : un echec a cette etape doit pouvoir
        // etre repris tout de suite, la reprise par identifiant garantissant
        // qu'aucun salon ne sera cree une seconde fois.
        if (items.some(item => item.created)) {
          // Le pseudo seul : l'identifiant Discord alourdit un message d'interface,
          // et le journal d'audit le porte deja pour qui veut remonter la trace.
          await startProvisionCooldown(lockKey, user.username ?? 'Utilisateur');
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Mise en route tickets',
          context: getGuildName(client, guildId),
          module: 'Tickets',
          eventType: 'Manuel',
          details: `Créés : ${items.filter(i => i.created).map(i => i.name).join(', ') || 'aucun'}. Repris : ${items.filter(i => !i.created).map(i => i.name).join(', ') || 'aucun'}.`,
          channelId: outcome.panelChannelId,
        });

        await cache.invalidateGuild(guildId);
        json(res, 200, { success: true, items, panelSent });
      } catch (err: unknown) {
        await persist().catch(() => null);
        logger.error('TicketsAPI', `Error provisioning ticket module: ${errorMessage(err)}`, errorStack(err));
        json(res, 500, { error: `Mise en route interrompue : ${errorMessage(err)}`, items });
      } finally {
        releaseProvisionLock(lockKey);
      }
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/tickets
    if (parts.length === 5 && method === 'GET') {
      try {
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '75', 10) || 75, 1), 200);
        const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
        const requestedStatus = url.searchParams.get('status');
        const status = requestedStatus === 'OPEN' || requestedStatus === 'CLAIMED' || requestedStatus === 'CLOSED'
          ? requestedStatus
          : null;

        const avatarFromCache = (discordId: string, size = 64): string | null => {
          try {
            const cachedUser = client.users.cache.get(discordId);
            if (cachedUser) return cachedUser.displayAvatarURL({ size: size as 64 | 128 });
            // La liste doit rester une lecture locale et rapide. Une URL
            // d'avatar par défaut est déterministe à partir du snowflake, sans
            // déclencher un appel REST Discord par ligne.
            return `https://cdn.discordapp.com/embed/avatars/${(BigInt(discordId) >> 22n) % 6n}.png`;
          } catch {
            return null;
          }
        };

        const [ticketRows, guildConfig] = await Promise.all([
          prisma.ticket.findMany({
            where: { guildId, ...(status ? { status } : {}) },
            orderBy: { createdAt: 'desc' },
            skip: offset,
            // Une ligne supplémentaire permet de signaler la page suivante
            // sans imposer un COUNT(*) à chaque affichage.
            take: limit + 1,
            select: {
              id: true,
              userId: true,
              username: true,
              reason: true,
              status: true,
              claimedById: true,
              claimedByName: true,
              transcriptId: true,
              createdAt: true,
            },
          }),
          prisma.guild.findUnique({
            where: { id: guildId },
            select: {
              ticketCategoryId: true,
              ticketLogChannelId: true,
              ticketStaffRoleId: true,
              ticketChannelId: true,
              ticketEmbedTitle: true,
              ticketEmbedDesc: true,
              ticketEmbedButtonText: true,
              ticketEmbedColor: true,
              ticketEmbedType: true,
              ticketMode: true,
              ticketDmRelayChannelId: true,
              ticketTypes: true,
              ticketFormEnabled: true,
              ticketFormCustomFields: true,
              ticketEmbedThumbnail: true,
              ticketEmbedImage: true,
              ticketEmbedFooter: true,
              ticketEmbedAuthorName: true,
              ticketEmbedAuthorIcon: true,
              ticketWelcomeTitle: true,
              ticketWelcomeDesc: true,
              ticketWelcomeColor: true,
              ticketWelcomeThumbnail: true,
              ticketWelcomeImage: true,
              ticketWelcomeFooter: true,
              ticketAllowOverclaim: true,
              ticketOverclaimPermission: true,
              ticketInactivityEnabled: true,
              ticketInactivityHours: true,
              ticketInactivityMessage: true,
              ticketSatisfactionCommentEnabled: true,
              ticketSatisfactionCommentQuestion: true,
              ticketSatisfactionCommentTimeout: true,
            }
          }),
        ]);

        const hasMore = ticketRows.length > limit;
        const tickets = hasMore ? ticketRows.slice(0, limit) : ticketRows;
        const enrichedTickets = tickets.map((t) => {
          const userAvatar = avatarFromCache(t.userId);
          const claimedByAvatar = t.claimedById ? avatarFromCache(t.claimedById) : null;
          return { ...t, userAvatar, claimedByAvatar };
        });

        json(res, 200, {
          tickets: enrichedTickets,
          config: guildConfig || {},
          pagination: {
            limit,
            offset,
            hasMore,
            nextOffset: hasMore ? offset + limit : null,
          },
        });
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error listing tickets: ${errorMessage(err)}`);
        json(res, 500, { error: 'Erreur lors de la récupération des tickets' });
      }
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/tickets/:ticketId
    if (parts.length === 6 && method === 'GET') {
      const ticketId = parts[5];
      try {
        const ticket = await prisma.ticket.findFirst({
          where: { id: ticketId, guildId }
        });

        if (!ticket) {
          json(res, 404, { error: 'Ticket introuvable' });
          return true;
        }

        let channelName: string | null = null;
        let messages: unknown[] = [];
        if (ticket.channelId) {
          const discordChannel = client.channels.cache.get(ticket.channelId);
          if (discordChannel && discordChannel instanceof TextChannel) {
            channelName = discordChannel.name;
            try {
              const fetched = await discordChannel.messages.fetch({ limit: 50 });
              const guild = discordChannel.guild;
              messages = fetched.map(m => ({
                id: m.id,
                authorId: m.author.id,
                authorName: m.member?.displayName || m.author.displayName || m.author.username,
                authorAvatar: m.author.displayAvatarURL(),
                isStaff: m.author.bot,
                content: m.content,
                htmlContent: parseDiscordMarkdown(m.content, guild),
                mediaUrls: extractMediaUrls(m.content),
                stickers: m.stickers ? m.stickers.map(s => ({ id: s.id, name: s.name, url: s.url })) : [],
                attachments: m.attachments.map(a => ({ url: a.url, contentType: a.contentType })),
                embeds: msgEmbedsMap(m.embeds, guild),
                createdAt: m.createdAt.toISOString()
              }));
              messages.reverse();
            } catch { /* ignored */ }
          }
        }

        const fetchAvatarDetail = async (discordId: string, size = 128): Promise<string | null> => {
          try {
            const u = client.users.cache.get(discordId) || await client.users.fetch(discordId);
            return u.displayAvatarURL({ size: size as 64 | 128 });
          } catch {
            return `https://cdn.discordapp.com/embed/avatars/${(BigInt(discordId) >> 22n) % 6n}.png`;
          }
        };
        const [userAvatar, claimedByAvatar] = await Promise.all([
          fetchAvatarDetail(ticket.userId, 128),
          ticket.claimedById ? fetchAvatarDetail(ticket.claimedById) : Promise.resolve(null),
        ]);

        json(res, 200, { ticket: { ...ticket, channelName, userAvatar, claimedByAvatar }, messages });
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error reading ticket details: ${errorStack(err)}`);
        json(res, 500, { error: `Erreur lors de la récupération du ticket: ${errorStack(err)}` });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/tickets/:ticketId/message
    if (parts.length === 7 && parts[6] === 'message' && method === 'POST') {
      const ticketId = parts[5];
      try {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket || !ticket.channelId) {
          json(res, 404, { error: 'Ticket introuvable ou salon inactif' });
          return true;
        }

        const body = await readJsonBody<{ content: string }>(req);
        if (!body?.content) {
          json(res, 400, { error: 'Contenu du message requis' });
          return true;
        }

        const discordChannel = client.channels.cache.get(ticket.channelId);
        if (!discordChannel || !(discordChannel instanceof TextChannel)) {
          json(res, 400, { error: 'Salon Discord introuvable' });
          return true;
        }

        const sent = await discordChannel.send(`💬 **[Kotbo Dashboard - ${user.username}]** ${body.content}`);
        
        json(res, 200, {
          success: true,
          message: {
            id: sent.id,
            author: {
              id: client.user?.id || 'bot',
              username: 'Kotbo',
              displayName: 'Kotbo',
              avatar: client.user?.displayAvatarURL() || '',
              bot: true
            },
            content: sent.content,
            createdAt: sent.createdAt.toISOString()
          }
        });
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error sending message to ticket: ${errorMessage(err)}`);
        json(res, 500, { error: "Erreur lors de l'envoi du message" });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/tickets/:ticketId/claim
    if (parts.length === 7 && parts[6] === 'claim' && method === 'POST') {
      const ticketId = parts[5];
      try {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
          json(res, 404, { error: 'Ticket introuvable' });
          return true;
        }

        const guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });
        if (!guildConfig) {
          json(res, 404, { error: 'Serveur introuvable' });
          return true;
        }

        const allowOverclaim = guildConfig.ticketAllowOverclaim ?? true;
        const overclaimPermission = guildConfig.ticketOverclaimPermission || 'ANY';

        if (ticket.status === 'CLAIMED') {
          if (!allowOverclaim || overclaimPermission === 'NONE') {
            json(res, 400, { error: `Ce ticket est déjà pris en charge par ${ticket.claimedByName || ticket.claimedById}.` });
            return true;
          }

          if (ticket.claimedById === user.userId) {
            json(res, 400, { error: 'Vous prenez déjà en charge ce ticket.' });
            return true;
          }

          if (overclaimPermission === 'SUPERIOR_OR_EQUAL') {
            const isDashboardAdmin = access.level === 'admin';
            if (!isDashboardAdmin) {
              const getStaffLevelLocal = async (uid: string) => {
                const staff = await prisma.staffMember.findUnique({
                  where: { guildId_userId: { guildId, userId: uid } }
                });
                if (!staff) return 0;
                const role = await prisma.staffRole.findFirst({
                  where: { guildId, name: staff.grade, enabled: true }
                });
                return role ? role.level : 0;
              };

              const claimantLevel = await getStaffLevelLocal(user.userId);
              const currentLevel = ticket.claimedById ? await getStaffLevelLocal(ticket.claimedById) : 0;

              if (claimantLevel < currentLevel) {
                json(res, 403, { error: 'Votre grade est insuffisant pour sur-revendiquer ce ticket.' });
                return true;
              }
            }
          }
        }

        const updated = await prisma.ticket.update({
          where: { id: ticketId },
          data: {
            status: 'CLAIMED',
            claimedById: user.userId,
            claimedByName: user.username
          }
        });

        if (ticket.channelId) {
          const ch = client.channels.cache.get(ticket.channelId);
          if (ch && ch instanceof TextChannel) {
            try {
              const welcomeMsg = (await ch.messages.fetch({ limit: 50 })).find(m => m.author.id === client.user?.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith('🎫'));
              if (welcomeMsg) {
                const oldEmbed = welcomeMsg.embeds[0];
                if (oldEmbed) {
                  const updatedEmbed = EmbedBuilder.from(oldEmbed)
                    .setColor(COLORS.warning as ColorResolvable)
                    .setDescription(`Ce ticket est actuellement pris en charge par **${user.username}**.\n\n**Auteur :** <@${ticket.userId}>\n**Raison :** ${ticket.reason}\n**Description :** ${ticket.description}`)
                    .setFields([
                      { name: 'Statut', value: `🛠️ Pris en charge par <@${user.userId}>`, inline: true }
                    ]);

                  const componentsList: ButtonBuilder[] = [];
                  if (allowOverclaim && overclaimPermission !== 'NONE') {
                    componentsList.push(
                      new ButtonBuilder().setCustomId(`ticket:claim:${ticketId}`).setLabel('Sur-revendiquer').setStyle(ButtonStyle.Primary).setEmoji('🛠️')
                    );
                  }
                  componentsList.push(
                    new ButtonBuilder().setCustomId(`ticket:info:${ticketId}`).setLabel('Infos Membre').setStyle(ButtonStyle.Secondary).setEmoji('🔍'),
                    new ButtonBuilder().setCustomId(`ticket:close:${ticketId}`).setLabel('Fermer').setStyle(ButtonStyle.Danger).setEmoji('🔒')
                  );

                  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(componentsList);
                  await welcomeMsg.edit({ embeds: [updatedEmbed], components: [row] }).catch(() => null);
                }
              }
            } catch (welcomeErr) {
              logger.error('TicketsAPI', `Error updating welcome embed from dashboard API: ${welcomeErr}`);
            }

            await ch.send({
              embeds: [successEmbed('Pris en charge', `Ce ticket a été revendiqué depuis le Dashboard Kotbo par **${user.username}**.`)]
            }).catch(() => null);
          }
        }

        json(res, 200, updated);
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error claiming ticket: ${errorMessage(err)}`);
        json(res, 500, { error: 'Erreur lors de la prise en charge du ticket' });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/tickets/:ticketId/close
    if (parts.length === 7 && parts[6] === 'close' && method === 'POST') {
      const ticketId = parts[5];
      try {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
          json(res, 404, { error: 'Ticket introuvable' });
          return true;
        }

        const { closeTicket } = await import('../../../../services/features/ticketService.js');
        const updated = await closeTicket(client, ticketId, user.userId, user.username ?? user.userId);

        json(res, 200, updated);
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error closing ticket: ${errorMessage(err)}`);
        json(res, 500, { error: 'Erreur' });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/tickets/:ticketId/reopen
    if (parts.length === 7 && parts[6] === 'reopen' && method === 'POST') {
      const ticketId = parts[5];
      try {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
          json(res, 404, { error: 'Ticket introuvable' });
          return true;
        }

        const updated = await prisma.ticket.update({
          where: { id: ticketId },
          data: {
            status: 'OPEN',
            closedById: null,
            closedByName: null,
            closedAt: null
          }
        });

        if (ticket.channelId) {
          const ch = client.channels.cache.get(ticket.channelId);
          if (ch && ch instanceof TextChannel) {
            await ch.permissionOverwrites.edit(ticket.userId, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true
            }).catch(() => {});

            const { renameChannelToOpen } = await import('../../../../services/features/ticketService.js');
            await renameChannelToOpen(client, ticket.channelId).catch(() => {});

            await ch.send({
              embeds: [successEmbed('Ticket Réouvert', `Le ticket a été réouvert depuis le Dashboard Kotbo par **${user.username}**.`)]
            }).catch(() => null);
          }
        }

        json(res, 200, updated);
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error reopening ticket: ${errorMessage(err)}`);
        json(res, 500, { error: 'Erreur' });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/tickets/:ticketId/rename
    if (parts.length === 7 && parts[6] === 'rename' && method === 'POST') {
      const ticketId = parts[5];
      try {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
          json(res, 404, { error: 'Ticket introuvable' });
          return true;
        }

        const body = await readJsonBody<{ name?: string }>(req);
        const requestedName = body?.name?.trim();
        if (!requestedName) {
          json(res, 400, { error: 'Le nouveau nom est requis' });
          return true;
        }

        const guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });
        if (!guildConfig) {
          json(res, 404, { error: 'Serveur introuvable' });
          return true;
        }

        const { renameTicketChannel } = await import('../../../../services/features/ticketService.js');
        const finalName = await renameTicketChannel(
          client,
          ticket,
          guildConfig!,
          { id: user.userId, username: user.username || 'Utilisateur' },
          requestedName,
        );

        json(res, 200, { success: true, channelName: finalName });
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error renaming ticket: ${errorMessage(err)}`);
        json(res, 500, { error: 'Erreur lors du renommage du ticket' });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/tickets/:ticketId/restore
    if (parts.length === 7 && parts[6] === 'restore' && method === 'POST') {
      const ticketId = parts[5];
      try {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
          json(res, 404, { error: 'Ticket introuvable' });
          return true;
        }
        if (ticket.status !== 'CLOSED') {
          json(res, 400, { error: 'Seul un ticket fermé peut être restauré.' });
          return true;
        }
        if (!ticket.transcriptId) {
          json(res, 400, { error: "Ce ticket n'a pas de transcription associée." });
          return true;
        }

        // Restore limits: 1st = instant, 2nd = after 1 day, 3rd = after 1 week, then blocked
        const restoreCount = ticket.restoreCount ?? 0;
        const lastRestoredAt = ticket.lastRestoredAt;
        if (restoreCount >= 3) {
          json(res, 429, { error: 'Ce ticket a atteint la limite maximale de restaurations (3).' });
          return true;
        }
        if (restoreCount === 1 && lastRestoredAt) {
          const oneDayMs = 24 * 60 * 60 * 1000;
          const elapsed = Date.now() - new Date(lastRestoredAt).getTime();
          if (elapsed < oneDayMs) {
            const remaining = Math.ceil((oneDayMs - elapsed) / (60 * 60 * 1000));
            json(res, 429, { error: `Deuxième restauration disponible dans ${remaining}h. Délai : 24h après la première restauration.` });
            return true;
          }
        }
        if (restoreCount === 2 && lastRestoredAt) {
          const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
          const elapsed = Date.now() - new Date(lastRestoredAt).getTime();
          if (elapsed < oneWeekMs) {
            const remainingDays = Math.ceil((oneWeekMs - elapsed) / (24 * 60 * 60 * 1000));
            json(res, 429, { error: `Troisième restauration disponible dans ${remainingDays}j. Délai : 7 jours après la deuxième restauration.` });
            return true;
          }
        }

        const transcript = await prisma.transcript.findUnique({ where: { id: ticket.transcriptId } });
        if (!transcript) {
          json(res, 404, { error: 'Transcription introuvable.' });
          return true;
        }

        const guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });
        if (!guildConfig) {
          json(res, 404, { error: 'Serveur introuvable' });
          return true;
        }

        const discordGuild = client.guilds.cache.get(guildId);
        if (!discordGuild) {
          json(res, 404, { error: 'Serveur Discord introuvable.' });
          return true;
        }

        const categoryId = ticket.categoryId || guildConfig.ticketCategoryId || null;
        const ticketCategory = categoryId ? discordGuild.channels.cache.get(categoryId) : null;
        const staffRoleId = ticket.staffRoleId || guildConfig.ticketStaffRoleId || null;

        const cleanedUsername = ticket.username.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'membre';
        const channelName = `ticket-${cleanedUsername}`;

        const permissionOverwrites: OverwriteResolvable[] = [
          { id: discordGuild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: ticket.userId, allow: [
            PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles
          ]}
        ];
        if (staffRoleId) {
          permissionOverwrites.push({ id: staffRoleId, allow: [
            PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles
          ]});
        }
        if (guildConfig.moderatorRoleId) {
          permissionOverwrites.push({ id: guildConfig.moderatorRoleId, allow: [
            PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles
          ]});
        }

        const ticketChannel = await discordGuild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: ticketCategory && ticketCategory.type === ChannelType.GuildCategory ? ticketCategory.id : undefined,
          topic: `Ticket restauré de ${ticket.username} - Raison : ${ticket.reason}`,
          permissionOverwrites
        });

        // Parse transcript and replay messages via webhook
        const { parseTranscriptHtml } = await import('../../../../services/features/transcriptService.js');
        const parsedMessages = parseTranscriptHtml(transcript.html);

        if (parsedMessages.length > 0) {
          const webhook = await ticketChannel.createWebhook({ name: 'Kotbo Restore' });

          const headerEmbed = new EmbedBuilder()
            .setTitle('📜 Historique restauré')
            .setDescription(`Ce ticket a été restauré depuis une transcription par **${user.username || 'Staff'}** (<@${user.userId}>).\nLes messages ci-dessous sont une restitution de la conversation d'origine.`)
            .setColor(COLORS.primary as ColorResolvable)
            .setTimestamp();
          await ticketChannel.send({ embeds: [headerEmbed], allowedMentions: { parse: [] } });

          for (const msg of parsedMessages) {
            if (!msg.content && !msg.username && msg.embeds.length === 0 && msg.imageUrls.length === 0) continue;
            // Discord webhook username must be 1-80 chars, avoid "clyde"
            let webhookName = msg.username.slice(0, 80) || 'Utilisateur';
            if (/clyde/i.test(webhookName)) webhookName = webhookName.replace(/clyde/gi, 'C|yde');

            // Build embeds from parsed transcript data
            const discordEmbeds: EmbedBuilder[] = [];
            for (const e of msg.embeds) {
              const eb = new EmbedBuilder();
              if (e.color) {
                try { eb.setColor(e.color as ColorResolvable); } catch { /* ignored */ }
              }
              if (e.authorName) {
                eb.setAuthor({ name: e.authorName, iconURL: e.authorIconUrl || undefined, url: e.authorUrl || undefined });
              }
              if (e.title) eb.setTitle(e.title.slice(0, 256));
              if (e.url) eb.setURL(e.url);
              if (e.description) eb.setDescription(e.description.slice(0, 4096));
              if (e.fields.length > 0) {
                eb.addFields(e.fields.slice(0, 25).map(f => ({
                  name: f.name.slice(0, 256) || '​',
                  value: f.value.slice(0, 1024) || '​',
                  inline: f.inline
                })));
              }
              if (e.thumbnailUrl) eb.setThumbnail(e.thumbnailUrl);
              if (e.imageUrl) eb.setImage(e.imageUrl);
              if (e.footerText) {
                eb.setFooter({ text: e.footerText.slice(0, 2048), iconURL: e.footerIconUrl || undefined });
              }
              discordEmbeds.push(eb);
            }

            // Add standalone image attachments as embeds
            for (const imgUrl of msg.imageUrls) {
              if (discordEmbeds.length >= 10) break;
              discordEmbeds.push(new EmbedBuilder().setImage(imgUrl));
            }

            try {
              await webhook.send({
                content: msg.content ? msg.content.slice(0, 2000) : (discordEmbeds.length === 0 ? '*(message sans contenu texte)*' : undefined),
                username: `${webhookName} (historique)`,
                avatarURL: msg.avatarUrl || undefined,
                embeds: discordEmbeds.length > 0 ? discordEmbeds.slice(0, 10) : undefined,
                allowedMentions: { parse: [] },
              });
            } catch (sendErr) {
              logger.warn('TicketsAPI', `Failed to replay message from ${msg.username}: ${errorMessage(sendErr)}`);
            }
          }

          await webhook.delete('Restore terminé').catch(() => {});
        }

        // Send separator + welcome back embed
        const restoreEmbed = new EmbedBuilder()
          .setTitle('🔄 Ticket Restauré')
          .setDescription(`Ce ticket a été réouvert par **${user.username || "Staff"}** (<@${user.userId}>) depuis le Dashboard.\n\n**Raison d'origine :** ${ticket.reason}\n**Description :** ${ticket.description || "Aucune"}`)
          .setColor(COLORS.primary as ColorResolvable)
          .setTimestamp()
          .setFooter({ text: `Kotbo · Ticket ID: ${ticket.id}` });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('Prendre en charge').setStyle(ButtonStyle.Primary).setEmoji('🛠️'),
          new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Fermer').setStyle(ButtonStyle.Danger).setEmoji('🔒')
        );
        await ticketChannel.send({ embeds: [restoreEmbed], components: [row], allowedMentions: { parse: [] } });

        await prisma.ticket.update({
          where: { id: ticketId },
          data: {
            channelId: ticketChannel.id,
            status: 'OPEN',
            restoreCount: restoreCount + 1,
            lastRestoredAt: new Date(),
            claimedById: null,
            claimedByName: null,
            closedById: null,
            closedByName: null,
            closedAt: null,
          }
        });

        if (guildConfig.ticketLogChannelId) {
          const logCh = client.channels.cache.get(guildConfig.ticketLogChannelId);
          if (logCh && logCh instanceof TextChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('🔄 Ticket Restauré')
              .setDescription(`Le ticket de **${ticket.username}** a été restauré depuis le Dashboard par **${user.username}**.`)
              .setColor(COLORS.primary as ColorResolvable)
              .addFields([
                { name: 'Créateur', value: `<@${ticket.userId}>`, inline: true },
                { name: 'Restauré par', value: `<@${user.userId}>`, inline: true },
                { name: 'Nouveau salon', value: `<#${ticketChannel.id}>`, inline: true },
              ])
              .setTimestamp()
              .setFooter({ text: `Kotbo · Ticket ID: ${ticket.id}` });
            await logCh.send({ embeds: [logEmbed], allowedMentions: { parse: [] } }).catch(() => {});
          }
        }

        json(res, 200, { success: true, channelId: ticketChannel.id });
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error restoring ticket: ${errorStack(err)}`);
        json(res, 500, { error: `Erreur lors de la restauration: ${errorMessage(err)}` });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/tickets/:ticketId/delete
    if (parts.length === 7 && parts[6] === 'delete' && method === 'POST') {
      const ticketId = parts[5];
      try {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
          json(res, 404, { error: 'Ticket introuvable' });
          return true;
        }

        if (!ticket.channelId) {
          json(res, 200, { success: true });
          return true;
        }

        const ch = client.channels.cache.get(ticket.channelId);
        if (ch && ch instanceof TextChannel) {
          const { generateTranscript } = await import('../../../../services/features/transcriptService.js');
          const transcriptData = await generateTranscript(ch);
          
          await prisma.ticket.update({
            where: { id: ticketId },
            data: {
              channelId: null,
              status: 'CLOSED',
              transcriptId: transcriptData.id
            }
          });

          const guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });
          const { getDashboardUrl } = await import('../../../shared.js');
          const dashboardUrl = getDashboardUrl();
          const publicLink = `${dashboardUrl}/transcripts/${transcriptData.id}`;
          
          const usersToDm = new Set<string>();
          if (ticket.userId) usersToDm.add(ticket.userId);
          if (ticket.claimedById) usersToDm.add(ticket.claimedById);
          if (ticket.closedById) usersToDm.add(ticket.closedById);
          if (user.userId) usersToDm.add(user.userId);
          
           const serverName = getGuildName(client, guildId);
           const dmEmbed = new EmbedBuilder()
            .setTitle('📄 Transcription de ticket')
            .setDescription(`Le ticket d'assistance **${ticket.reason}** du serveur **${serverName}** a été supprimé.\n\nVoici le lien pour consulter la transcription complète :`)
            .addFields([{ name: "Lien d'accès", value: `🌐 [Consulter le transcript](${publicLink})` }])
            .setColor('#5865F2')
            .setTimestamp()
            .setFooter({ text: `Serveur : ${serverName}` });
            
          for (const dmUserId of usersToDm) {
            try {
              const dmUser = await client.users.fetch(dmUserId);
              if (dmUser) await dmUser.send({ embeds: [dmEmbed], allowedMentions: { parse: [] } });
            } catch { /* ignored */ }
          }

          if (guildConfig && guildConfig.ticketLogChannelId) {
            const logCh = client.channels.cache.get(guildConfig.ticketLogChannelId);
            if (logCh && logCh instanceof TextChannel) {
              const logEmbed = new EmbedBuilder()
                .setTitle('🗑️ Ticket Supprimé')
                .setDescription(`Le ticket ouvert par **${ticket.username}** a été définitivement supprimé par **${user.username}** depuis le Dashboard.`)
                .setColor(0x000000)
                .addFields([
                  { name: 'Créateur', value: `<@${ticket.userId}>`, inline: true },
                  { name: 'Supprimé par', value: `<@${user.userId}>`, inline: true },
                  { name: 'Transcription publique', value: `🌐 [Consulter le transcript](${publicLink})` }
                ])
                .setTimestamp()
                .setFooter({ text: `Kotbo · Ticket ID: ${ticket.id}` });
              await logCh.send({ embeds: [logEmbed], allowedMentions: { parse: [] } }).catch(() => {});
            }
          }

          setTimeout(async () => {
            await ch.delete(`Ticket supprimé depuis le Dashboard par ${user.username}`).catch(() => {});
          }, 1000);

          json(res, 200, { success: true, transcriptId: transcriptData.id });
        } else {
          await prisma.ticket.update({
            where: { id: ticketId },
            data: { channelId: null }
          });
          json(res, 200, { success: true });
        }
      } catch (err: unknown) {
        logger.error('TicketsAPI', `Error deleting ticket: ${errorMessage(err)}`);
        json(res, 500, { error: 'Erreur lors de la suppression' });
      }
      return true;
    }
  }

  return false;
}
