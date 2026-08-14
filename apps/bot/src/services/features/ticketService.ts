import type { ColorResolvable } from 'discord.js';
import { type Client, type APIInteractionGuildMember, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction, TextChannel, ChannelType, PermissionFlagsBits, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, type Guild, type GuildMember, type ThreadChannel, Message, ComponentType } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { COLORS, COLORS_RAW, successEmbed, errorEmbed, v2 } from '../../utils/embeds.js';
import { resolveEmojiShortcodes } from '../../utils/emojis.js';
import { generateTranscript } from './transcriptService.js';
import { buildMemberCasePanel } from '../moderation/memberCaseService.js';
import { handleTicketTrigger } from './autoResponseService.js';
import { embedToV2 } from '../../utils/patchV2.js';
import { type BotLocale, resolveGuildLocale } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';
import { isModuleEnabled } from '../core/moduleGate.js';

function sanitizeTicketChannelName(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!cleaned) return '';
  return cleaned.slice(0, 100);
}

export function buildTicketChannelName(input: string, fallbackSeed: string): string {
  const sanitizedInput = sanitizeTicketChannelName(input);
  const sanitizedFallback = sanitizeTicketChannelName(fallbackSeed) || 'ticket';
  const baseName = sanitizedInput || sanitizedFallback;
  const prefixedName = baseName.startsWith('ticket-') ? baseName : `ticket-${baseName}`;
  return prefixedName.slice(0, 100);
}

type TicketPanelTypeConfig = {
  id: string;
  label: string;
  description?: string | null;
  emoji?: string | null;
  categoryId?: string | null;
  staffRoleId?: string | null;
  buttonStyle?: 'PRIMARY' | 'SECONDARY' | 'SUCCESS' | 'DANGER';
  mode?: 'CHANNEL' | 'DM' | 'THREAD' | null;
  anonymous?: boolean;
  staffServerRelay?: boolean;
  // Tickets internes : le salon du ticket est créé sur le serveur staff lié
  staffServerChannel?: boolean;
  staffServerCategoryId?: string | null;
  // Tri-etat : `null` signifie « suivre la configuration du serveur ».
  lockUntilClaim?: boolean | null;
  requireApproval?: boolean | null;
  fields?: any[] | null;
};

/** Lit un reglage tri-etat d'un type de ticket : `null` = herite du serveur. */
function inheritedFlag(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeTicketPanelTypes(rawTypes: unknown, fallback: {
  label: string;
  description: string;
  categoryId: string | null;
  staffRoleId: string | null;
  buttonStyle?: TicketPanelTypeConfig['buttonStyle'];
  emoji?: string | null;
}): TicketPanelTypeConfig[] {
  if (Array.isArray(rawTypes) && rawTypes.length > 0) {
    return rawTypes
      .filter(isRecord)
      .map((item, index) => {
        const buttonStyle: TicketPanelTypeConfig['buttonStyle'] = item.buttonStyle === 'SECONDARY' || item.buttonStyle === 'SUCCESS' || item.buttonStyle === 'DANGER'
          ? item.buttonStyle
          : 'PRIMARY';

        const mode = item.mode === 'CHANNEL' || item.mode === 'DM' || item.mode === 'THREAD'
          ? item.mode as 'CHANNEL' | 'DM' | 'THREAD'
          : null;

        return {
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `ticket-type-${index + 1}`,
          label: typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 80) : `Ticket ${index + 1}`,
          description: typeof item.description === 'string' ? item.description.trim().slice(0, 200) : null,
          emoji: typeof item.emoji === 'string' ? item.emoji.trim().slice(0, 16) : null,
          categoryId: typeof item.categoryId === 'string' && item.categoryId.trim() ? item.categoryId.trim() : null,
          staffRoleId: typeof item.staffRoleId === 'string' && item.staffRoleId.trim() ? item.staffRoleId.trim() : null,
          buttonStyle,
          mode,
          anonymous: item.anonymous === true,
          staffServerRelay: item.staffServerRelay === true,
          staffServerChannel: item.staffServerChannel === true,
          staffServerCategoryId: typeof item.staffServerCategoryId === 'string' && item.staffServerCategoryId.trim() ? item.staffServerCategoryId.trim() : null,
          lockUntilClaim: inheritedFlag(item.lockUntilClaim),
          requireApproval: inheritedFlag(item.requireApproval),
          fields: Array.isArray(item.fields) ? item.fields : null,
        };
      })
      .filter((item) => item.label.length > 0);
  }

  return [{
    id: 'legacy',
    label: fallback.label,
    description: fallback.description,
    emoji: fallback.emoji ?? '📩',
    categoryId: fallback.categoryId,
    staffRoleId: fallback.staffRoleId,
    buttonStyle: fallback.buttonStyle ?? 'PRIMARY',
    lockUntilClaim: null,
    requireApproval: null,
    fields: null,
  }];
}

/**
 * Verrouillage jusqu'a la prise en charge et validation prealable se reglent
 * pour tout le serveur, et un type de ticket peut trancher differemment. Le
 * reglage du type ne compte que s'il a ete decide (`true`/`false`) : laisse a
 * « heriter », il rend la main a la configuration du serveur.
 */
export function resolveLockUntilClaim(ticketType: TicketPanelTypeConfig, guildConfig: Record<string, unknown>): boolean {
  if (ticketType.lockUntilClaim !== null && ticketType.lockUntilClaim !== undefined) return ticketType.lockUntilClaim;
  return guildConfig.ticketLockUntilClaim === true;
}

export function resolveRequireApproval(ticketType: TicketPanelTypeConfig, guildConfig: Record<string, unknown>): boolean {
  if (ticketType.requireApproval !== null && ticketType.requireApproval !== undefined) return ticketType.requireApproval;
  return guildConfig.ticketApprovalEnabled === true;
}

function resolveTicketPanelType(guildConfig: Record<string, unknown>, typeId?: string | null): TicketPanelTypeConfig {
  const asText = (value: unknown, fallback: string) => (typeof value === 'string' && value ? value : fallback);
  const asId = (value: unknown) => (typeof value === 'string' ? value : null);

  const ticketTypes = normalizeTicketPanelTypes(guildConfig.ticketTypes, {
    label: asText(guildConfig.ticketEmbedButtonText, 'Ouvrir un ticket'),
    description: asText(guildConfig.ticketEmbedDesc, "Cliquez sur le bouton ci-dessous pour ouvrir un ticket d'assistance."),
    categoryId: asId(guildConfig.ticketCategoryId),
    staffRoleId: asId(guildConfig.ticketStaffRoleId),
    emoji: '📩',
    buttonStyle: 'PRIMARY',
  });

  if (!typeId) {
    return ticketTypes[0];
  }

  return ticketTypes.find((type) => type.id === typeId) ?? ticketTypes[0];
}

function resolveButtonStyle(style?: TicketPanelTypeConfig['buttonStyle']): ButtonStyle {
  switch (style) {
    case 'SECONDARY': return ButtonStyle.Secondary;
    case 'SUCCESS': return ButtonStyle.Success;
    case 'DANGER': return ButtonStyle.Danger;
    default: return ButtonStyle.Primary;
  }
}

/**
 * Rebuilds the welcome message's V2 container with an updated status line.
 * The welcome message is Components V2 only (no embeds), so status updates
 * (claim/close/reopen) must edit the container directly instead of touching
 * a non-existent `.embeds[0]`.
 */
function buildTicketStatusContainer(
  ticket: { id: string; ticketTypeLabel?: string | null },
  bodyText: string,
  color: number,
): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### 🎫 Ticket d'Assistance · ${ticket.ticketTypeLabel || 'Ticket'}`))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyText))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Kotbo · Ticket ID: ${ticket.id}`));
}

export async function renameTicketChannel(
  client: Client,
  ticket: { id: string; guildId: string; channelId: string | null; userId: string; username: string; reason: string; description: string },
  guildConfig: Record<string, unknown>,
  executor: { id: string; username: string },
  newName: string,
): Promise<string> {
  if (!ticket.channelId) {
    throw new Error("Ce ticket n'a pas de salon actif à renommer.");
  }

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error("Le salon du ticket est introuvable ou n'est pas un salon textuel.");
  }

  const finalName = buildTicketChannelName(newName, ticket.username || ticket.userId);
  await channel.setName(finalName, `Ticket renommé par ${executor.username}`);

  await logTicketEvent(client, guildConfig, 'RENAMED', ticket, executor, finalName);

  await channel.send({
    embeds: [successEmbed('Ticket renommé', `Le salon a été renommé en **#${finalName}** par <@${executor.id}>.`)],
  }).catch(() => null);

  return finalName;
}

/**
 * Checks if a member has permission to moderate/manage tickets.
 */
export function canManageTicket(member: GuildMember | APIInteractionGuildMember | null | undefined, guildConfig: Record<string, unknown>, ticketStaffRoleId?: string | null): boolean {
  if (!member) return false;

  const permissionBits = (member as GuildMember | APIInteractionGuildMember).permissions;
  const permissions = typeof permissionBits === 'string'
    ? new PermissionsBitField(BigInt(permissionBits))
    : new PermissionsBitField(permissionBits ?? 0n);
  if (permissions.has(PermissionFlagsBits.Administrator)) return true;

  const guildMemberRoles = (member as GuildMember).roles as { cache?: Map<string, unknown> } | undefined;
  const roleIds = guildMemberRoles?.cache
    ? Array.from(guildMemberRoles.cache.keys())
    : Array.isArray((member as APIInteractionGuildMember).roles)
      ? (member as APIInteractionGuildMember).roles
      : [];

  const moderatorRoleId = typeof guildConfig.moderatorRoleId === 'string' ? guildConfig.moderatorRoleId : null;
  if (moderatorRoleId && roleIds.includes(moderatorRoleId)) return true;
  const configuredStaffRoleId = typeof guildConfig.ticketStaffRoleId === 'string' ? guildConfig.ticketStaffRoleId : null;
  const effectiveTicketStaffRoleId = ticketStaffRoleId || configuredStaffRoleId;
  if (effectiveTicketStaffRoleId && roleIds.includes(effectiveTicketStaffRoleId)) return true;
  return false;
}

// ─── Blacklist d'ouverture ────────────────────────────────────────────────────

export type TicketBlacklistEntry = {
  reason: string | null;
  expiresAt: Date | null;
};

/**
 * Renvoie l'entree de blacklist qui bloque encore ce membre, ou `null`.
 *
 * Une entree arrivee a echeance est supprimee au passage plutot que filtree a
 * chaque lecture : sans cela, la liste affichee au staff se remplirait de
 * sanctions eteintes qu'il faudrait nettoyer a la main.
 */
export async function findActiveTicketBlacklist(guildId: string, userId: string): Promise<TicketBlacklistEntry | null> {
  const entry = await prisma.ticketBlacklist.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { id: true, reason: true, expiresAt: true },
  }).catch(() => null);
  if (!entry) return null;

  if (entry.expiresAt && entry.expiresAt.getTime() <= Date.now()) {
    await prisma.ticketBlacklist.delete({ where: { id: entry.id } }).catch(() => null);
    return null;
  }

  return { reason: entry.reason, expiresAt: entry.expiresAt };
}

/** Message ephemere affiche au membre blacklisté qui tente d'ouvrir un ticket. */
export function ticketBlacklistMessage(entry: TicketBlacklistEntry): string {
  const reasonLine = entry.reason ? `\n**Raison :** ${entry.reason}` : '';
  const untilLine = entry.expiresAt
    ? `\n**Jusqu'au :** <t:${Math.floor(entry.expiresAt.getTime() / 1000)}:F>`
    : '';
  return `⛔ Vous n'êtes pas autorisé à ouvrir un ticket sur ce serveur.${reasonLine}${untilLine}`;
}

/**
 * Repond a l'interaction et renvoie `true` si le membre est blackliste.
 * Regroupe ici pour que les quatre points d'entree d'ouverture (boutons, menu,
 * commande, MP) appliquent exactement la meme regle.
 */
async function rejectIfBlacklisted(
  guildId: string,
  userId: string,
  reply: (content: string) => Promise<unknown>,
): Promise<boolean> {
  const entry = await findActiveTicketBlacklist(guildId, userId);
  if (!entry) return false;
  await reply(ticketBlacklistMessage(entry)).catch(() => null);
  return true;
}

// ─── Verrouillage jusqu'a la prise en charge ─────────────────────────────────

/**
 * Ouvre ou ferme l'ecriture dans le salon d'un ticket sans toucher a sa
 * visibilite : l'auteur et le staff continuent de tout voir, personne ne peut
 * ecrire tant que le ticket n'est pas pris en charge.
 */
export async function applyTicketLockState(
  client: Client,
  ticket: { channelId: string | null; threadId: string | null; mode: string; userId: string; staffRoleId: string | null },
  guildConfig: Record<string, unknown>,
  locked: boolean,
): Promise<void> {
  const channelId = ticket.channelId || ticket.threadId;
  if (!channelId) return;

  const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  // Un fil n'a pas d'overwrites propres : Discord expose le verrou directement.
  if (channel.isThread()) {
    await (channel as ThreadChannel).setLocked(locked, locked ? 'Ticket en attente de prise en charge' : 'Ticket pris en charge').catch(() => null);
    return;
  }

  if (!(channel instanceof TextChannel)) return;

  const moderatorRoleId = typeof guildConfig.moderatorRoleId === 'string' ? guildConfig.moderatorRoleId : null;
  const configuredStaffRoleId = typeof guildConfig.ticketStaffRoleId === 'string' ? guildConfig.ticketStaffRoleId : null;
  const targets = [ticket.userId, ticket.staffRoleId, configuredStaffRoleId, moderatorRoleId]
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  // `true` et non `null` au deverrouillage : c'est ce que pose la creation du
  // salon. Rendre le droit a l'heritage laisserait la categorie decider.
  for (const targetId of new Set(targets)) {
    await channel.permissionOverwrites.edit(targetId, { SendMessages: !locked }).catch(() => null);
  }
}

/**
 * Sends the ticket opening embed in the configured channel using V2 components.
 * Buttons or dropdown are embedded directly inside the container.
 */
/**
 * Textes que le bot compose lui-meme quand l'admin n'en a pas ecrit. Exposes
 * plutot qu'ecrits deux fois : la mise en route les depose dans la
 * configuration pour qu'ils soient visibles et modifiables, et l'envoi s'en
 * sert quand le champ est reste vide.
 *
 * Les jetons `{user}`, `{type_label}` et compagnie traversent la traduction
 * tels quels, ils sont remplaces au moment de l'envoi.
 */
export function ticketDefaultTexts(locale: BotLocale) {
  return {
    ticketEmbedTitle: m.ticket_default_panel_title({}, { locale }),
    ticketEmbedDesc: m.ticket_default_panel_desc({}, { locale }),
    ticketEmbedButtonText: m.ticket_default_panel_button({}, { locale }),
    ticketWelcomeTitle: m.ticket_default_welcome_title({ type_label: '{type_label}' }, { locale }),
    ticketWelcomeDesc: m.ticket_default_welcome_desc(
      { user: '{user}', staff_mention: '{staff_mention}', description: '{description}' },
      { locale },
    ),
    ticketWelcomeFooter: m.ticket_default_welcome_footer({ ticket_id: '{ticket_id}' }, { locale }),
    ticketInactivityMessage: m.ticket_default_inactivity({ user: '{user}' }, { locale }),
  };
}

export async function sendTicketSetupEmbed(client: Client, guildId: string): Promise<void> {
  const guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guildConfig || !guildConfig.ticketChannelId) {
    throw new Error("Le salon d'embed des tickets n'est pas configuré.");
  }

  // Repli sur un appel REST : le cache peut ne pas porter un salon cree a
  // l'instant, et l'absence du cache ne veut pas dire que le salon n'existe pas.
  //
  // Tout salon de serveur ou l'on peut ecrire convient, y compris un salon
  // d'annonces : c'est un choix legitime pour un panneau, et la mise en route
  // accepte deja d'en reprendre un.
  const channel = client.channels.cache.get(guildConfig.ticketChannelId)
    ?? await client.channels.fetch(guildConfig.ticketChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error("Le salon d'embed des tickets est introuvable ou n'est pas un salon textuel.");
  }

  const colorHex = guildConfig.ticketEmbedColor || '#5865F2';
  const color = typeof colorHex === 'string' ? parseInt(colorHex.replace('#', ''), 16) : COLORS_RAW.primary;

  // Un texte ecrit par l'admin est republie tel quel, sans traduction : il lui
  // appartient. La langue du serveur ne sert qu'aux textes que le bot compose
  // lui-meme, defauts compris.
  const discordGuild = client.guilds.cache.get(guildId);
  const locale = await resolveGuildLocale(guildId, discordGuild?.preferredLocale ?? null);

  // Un champ vide veut dire « le texte par defaut », compose ici dans la langue
  // du serveur : le figer en base le laisserait dans la langue du jour ou la
  // configuration est nee.
  const defaults = ticketDefaultTexts(locale);
  const panelTitle = guildConfig.ticketEmbedTitle?.trim() || defaults.ticketEmbedTitle;
  const panelDesc = guildConfig.ticketEmbedDesc?.trim() || defaults.ticketEmbedDesc;
  const panelButton = guildConfig.ticketEmbedButtonText?.trim() || defaults.ticketEmbedButtonText;

  const ticketTypes = normalizeTicketPanelTypes(guildConfig.ticketTypes, {
    label: panelButton,
    description: panelDesc,
    categoryId: guildConfig.ticketCategoryId ?? null,
    staffRoleId: guildConfig.ticketStaffRoleId ?? null,
    emoji: '📩',
    buttonStyle: 'PRIMARY',
  });

  const title = resolveEmojiShortcodes(panelTitle);
  let desc = resolveEmojiShortcodes(panelDesc);
  if (ticketTypes.length > 0) {
    desc += `\n\n${m.panel_tickets_types_heading({}, { locale })}\n`;
    ticketTypes.forEach(t => {
      desc += `${t.emoji || '📩'} **${t.label}** - ${t.description}\n`;
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(title.substring(0, 256))
    .setDescription(desc.substring(0, 4000))
    .setColor(color);

  if (guildConfig.ticketEmbedThumbnail) {
    embed.setThumbnail(guildConfig.ticketEmbedThumbnail);
  }
  if (guildConfig.ticketEmbedImage) {
    embed.setImage(guildConfig.ticketEmbedImage);
  }
  if (guildConfig.ticketEmbedFooter) {
    embed.setFooter({ text: resolveEmojiShortcodes(guildConfig.ticketEmbedFooter).substring(0, 2048) });
  } else {
    embed.setFooter({ text: m.panel_tickets_default_footer({}, { locale }) });
  }
  if (guildConfig.ticketEmbedAuthorName) {
    embed.setAuthor({
      name: resolveEmojiShortcodes(guildConfig.ticketEmbedAuthorName).substring(0, 256),
      iconURL: guildConfig.ticketEmbedAuthorIcon || undefined
    });
  }

  const container = embedToV2(embed);

  const embedType = guildConfig.ticketEmbedType || 'BUTTONS';

  if (embedType === 'DROPDOWN') {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket:select_type')
      .setPlaceholder(m.panel_tickets_select_placeholder({}, { locale }))
      .addOptions(
        ticketTypes.map((type) => ({
          label: type.label.slice(0, 80),
          description: type.description?.slice(0, 100) || undefined,
          value: type.id,
          emoji: type.emoji || undefined,
        }))
      );

    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)
    );
  } else {
    const buttons = ticketTypes.map((type) => new ButtonBuilder()
      .setCustomId(`ticket:open_modal:${type.id}`)
      .setLabel(type.label.slice(0, 80))
      .setStyle(resolveButtonStyle(type.buttonStyle))
      .setEmoji(type.emoji || '📩'));

    for (let index = 0; index < buttons.length; index += 5) {
      container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5))
      );
    }
  }

  await channel.send(v2(container));
  logger.success('Ticket', `Embed d'ouverture envoyé avec succès dans #${channel.name} (${guildId})`);
}

function buildTicketWelcomeContainer(
  guildConfig: any,
  ticketType: TicketPanelTypeConfig,
  ticket: any,
  user: any,
  staffMention: string | null,
  reason: string,
  description: string,
  locale: BotLocale
): ContainerBuilder {
  const replaceTemplates = (str: string) => {
    if (!str) return '';
    return str
      .replace(/{user}/g, `<@${user.id}>`)
      .replace(/{username}/g, user.username)
      .replace(/{staff_mention}/g, staffMention || '')
      .replace(/{type_label}/g, ticketType.label || 'Ticket')
      .replace(/{ticket_id}/g, ticket.id)
      .replace(/{reason}/g, reason)
      .replace(/{description}/g, description);
  };

  // Les jetons `{user}`, `{type_label}` et compagnie traversent la traduction
  // tels quels : `replaceTemplates` les remplace juste apres.
  const defaults = ticketDefaultTexts(locale);
  const title = replaceTemplates(guildConfig.ticketWelcomeTitle?.trim() || defaults.ticketWelcomeTitle);
  const desc = replaceTemplates(guildConfig.ticketWelcomeDesc?.trim() || defaults.ticketWelcomeDesc);
  const footerText = replaceTemplates(guildConfig.ticketWelcomeFooter?.trim() || defaults.ticketWelcomeFooter);
  
  const welcomeColorHex = guildConfig.ticketWelcomeColor || '#5865F2';
  const color = typeof welcomeColorHex === 'string' ? parseInt(welcomeColorHex.replace('#', ''), 16) : COLORS_RAW.primary;

  const embed = new EmbedBuilder()
    .setTitle(title.substring(0, 256))
    .setDescription(desc.substring(0, 4000))
    .setColor(color);

  if (footerText) {
    embed.setFooter({ text: footerText.substring(0, 2048) });
  }

  if (guildConfig.ticketWelcomeThumbnail) {
    embed.setThumbnail(guildConfig.ticketWelcomeThumbnail);
  }

  if (guildConfig.ticketWelcomeImage) {
    embed.setImage(guildConfig.ticketWelcomeImage);
  }

  return embedToV2(embed);
}

async function showTicketOpeningModal(
  client: Client,
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  ticketType: TicketPanelTypeConfig,
  guildConfig: any
): Promise<void> {
  const isFormEnabled = (ticketType as any).formEnabled !== undefined
    ? (ticketType as any).formEnabled
    : (guildConfig.ticketFormEnabled !== undefined ? guildConfig.ticketFormEnabled : true);

  if (isFormEnabled === false) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const reason = ticketType.label || 'Ticket';
    const description = 'Aucune description fournie (formulaire désactivé).';
    await executeTicketCreation(client, interaction, ticketType, reason, description);
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal:ticket:open:${ticketType.id}`)
    .setTitle((ticketType.label || guildConfig.ticketEmbedTitle || 'Ouvrir un ticket').substring(0, 45));

  const customFields = ((ticketType as any).formCustomFields ?? guildConfig.ticketFormCustomFields) as any[];

  if (Array.isArray(customFields) && customFields.length > 0) {
    const fieldsToUse = customFields.slice(0, 5);
    const rows = fieldsToUse.map((f: any) => {
      const input = new TextInputBuilder()
        .setCustomId(f.id)
        .setLabel(f.label.substring(0, 45))
        .setStyle(f.style === 'PARAGRAPH' ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(f.required !== false);

      if (f.placeholder) {
        input.setPlaceholder(f.placeholder.substring(0, 100));
      }
      if (typeof f.maxLength === 'number') {
        input.setMaxLength(f.maxLength);
      }
      if (typeof f.minLength === 'number') {
        input.setMinLength(f.minLength);
      }
      return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    });
    modal.addComponents(...rows);
  } else {
    // Rétrocompatibilité avec les champs par défaut du type
    const fieldsToUse = Array.isArray((ticketType as any).fields) && (ticketType as any).fields.length > 0
      ? (ticketType as any).fields.slice(0, 5)
      : null;

    if (fieldsToUse) {
      const rows = fieldsToUse.map((f: any) => {
        const input = new TextInputBuilder()
          .setCustomId(f.id)
          .setLabel(f.label.substring(0, 45))
          .setStyle(f.style === 'PARAGRAPH' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(f.required !== false);

        if (f.placeholder) {
          input.setPlaceholder(f.placeholder.substring(0, 100));
        }
        if (typeof f.max_length === 'number') {
          input.setMaxLength(f.max_length);
        }
        if (typeof f.min_length === 'number') {
          input.setMinLength(f.min_length);
        }
        return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      });
      modal.addComponents(...rows);
    } else {
      const isSalon = ticketType.label.toLowerCase().includes('salon');

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Sujet / Raison de la demande')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex : Problème avec mon grade, Plainte, etc.')
        .setRequired(true)
        .setMaxLength(100);

      if (isSalon) {
        reasonInput.setValue('Demande de salon');
      }

      const descInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description détaillée')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Détaillez au maximum votre demande afin de faciliter le traitement par notre staff...')
        .setRequired(true)
        .setMaxLength(1000);

      if (isSalon) {
        descInput.setValue('Créé le pour moi');
      }

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(descInput)
      );
    }
  }

  await interaction.showModal(modal);
}

/**
 * Handles select menu interactions for ticket type selection
 */
export async function handleTicketSelectMenu(client: Client, customId: string, interaction: StringSelectMenuInteraction): Promise<void> {
  const { guildId, user, member, guild } = interaction;
  if (!guildId || !guild || !member) return;

  if (customId !== 'ticket:select_type') return;

  const guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guildConfig) {
    await interaction.reply({ content: '❌ Configuration du serveur introuvable.', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const typeId = interaction.values[0];
  const ticketType = resolveTicketPanelType(guildConfig, typeId);

  const isBlacklisted = await rejectIfBlacklisted(guildId, user.id, (content) =>
    interaction.reply({ content, flags: [MessageFlags.Ephemeral] }));
  if (isBlacklisted) return;

  // Vérifier si un ticket est déjà ouvert (ou en attente de validation)
  const existing = await prisma.ticket.findFirst({
    where: {
      guildId,
      userId: user.id,
      status: { in: ['PENDING', 'OPEN', 'CLAIMED'] }
    }
  });

  if (existing && existing.status === 'PENDING') {
    await interaction.reply({
      content: '⏳ Votre précédente demande de ticket attend encore la validation du staff.',
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }

  if (existing && existing.channelId) {
    // client.channels.fetch : le ticket peut vivre sur le serveur staff lié
    const ch = await client.channels.fetch(existing.channelId).catch(() => null);
    if (ch) {
      const ticketRef = existing.staffServerGuildId
        ? `https://discord.com/channels/${existing.staffServerGuildId}/${existing.channelId}`
        : `<#${existing.channelId}>`;
      await interaction.reply({
        content: `⚠️ Vous avez déjà un ticket d'ouvert : ${ticketRef}. Merci de l'utiliser !`,
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }
  }

  await showTicketOpeningModal(client, interaction, ticketType, guildConfig);
}

/**
 * Handles all button interactions starting with "ticket:"
 */
export async function handleTicketButton(client: Client, customId: string, interaction: ButtonInteraction): Promise<void> {
  const { guildId, user, member, guild } = interaction;
  if (!guildId || !guild || !member) return;

  const guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guildConfig) {
    await interaction.reply({ content: '❌ Configuration du serveur introuvable.', flags: [MessageFlags.Ephemeral] });
    return;
  }

  // 1. Clic sur "Ouvrir un ticket" -> Afficher le modal
  if (customId === 'ticket:open_modal' || customId.startsWith('ticket:open_modal:')) {
    const typeId = customId.startsWith('ticket:open_modal:') ? customId.split(':')[2] : null;
    const ticketType = resolveTicketPanelType(guildConfig, typeId);

    const isBlacklisted = await rejectIfBlacklisted(guildId, user.id, (content) =>
      interaction.reply({ content, flags: [MessageFlags.Ephemeral] }));
    if (isBlacklisted) return;

    // Vérifier si un ticket est déjà ouvert (ou en attente de validation)
    const existing = await prisma.ticket.findFirst({
      where: {
        guildId,
        userId: user.id,
        status: { in: ['PENDING', 'OPEN', 'CLAIMED'] }
      }
    });

    if (existing && existing.status === 'PENDING') {
      await interaction.reply({
        content: '⏳ Votre précédente demande de ticket attend encore la validation du staff.',
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    if (existing && existing.channelId) {
      // client.channels.fetch : le ticket peut vivre sur le serveur staff lié
      const ch = await client.channels.fetch(existing.channelId).catch(() => null);
      if (ch) {
        const ticketRef = existing.staffServerGuildId
          ? `https://discord.com/channels/${existing.staffServerGuildId}/${existing.channelId}`
          : `<#${existing.channelId}>`;
        await interaction.reply({
          content: `⚠️ Vous avez déjà un ticket d'ouvert : ${ticketRef}. Merci de l'utiliser !`,
          flags: [MessageFlags.Ephemeral]
        });
        return;
      }
    }

    await showTicketOpeningModal(client, interaction, ticketType, guildConfig);
    return;
  }

  // Autres boutons requièrent de décoder l'ID
  const parts = customId.split(':');
  const action = parts[1];
  const ticketId = parts[2];

  if (!action || !ticketId) return;

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    await interaction.reply({ content: '❌ Ticket introuvable en base de données.', flags: [MessageFlags.Ephemeral] });
    return;
  }

  // Helper to fetch staff level
  async function getStaffLevel(guildId: string, userId: string): Promise<number> {
    const staff = await prisma.staffMember.findUnique({
      where: { guildId_userId: { guildId, userId } }
    });
    if (!staff) return 0;
    const role = await prisma.staffRole.findFirst({
      where: { guildId, name: staff.grade, enabled: true }
    });
    return role ? role.level : 0;
  }

  // 2. Action: Claim
  if (action === 'claim') {
    if (!canManageTicket(member as GuildMember, guildConfig, ticket.staffRoleId)) {
      await interaction.reply({ content: '❌ Seuls les membres du personnel peuvent prendre en charge un ticket.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    const allowOverclaim = guildConfig.ticketAllowOverclaim ?? true;
    const overclaimPermission = guildConfig.ticketOverclaimPermission || 'ANY';

    if (ticket.status === 'CLAIMED') {
      if (!allowOverclaim || overclaimPermission === 'NONE') {
        await interaction.reply({ content: `⚠️ Ce ticket est déjà pris en charge par <@${ticket.claimedById}>. La sur-revendication est désactivée.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      if (ticket.claimedById === user.id) {
        await interaction.reply({ content: `⚠️ Vous prenez déjà en charge ce ticket.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      if (overclaimPermission === 'SUPERIOR_OR_EQUAL') {
        const claimantIsAdmin = (member as GuildMember).permissions.has(PermissionFlagsBits.Administrator);
        if (!claimantIsAdmin) {
          const claimantLevel = await getStaffLevel(guildId, user.id);
          const currentLevel = ticket.claimedById ? await getStaffLevel(guildId, ticket.claimedById) : 0;

          if (claimantLevel < currentLevel) {
            await interaction.reply({
              content: `❌ Vous ne pouvez pas sur-revendiquer ce ticket car le grade de l'intervenant actuel est supérieur au vôtre.`,
              flags: [MessageFlags.Ephemeral]
            });
            return;
          }
        }
      }
    }

    await interaction.deferUpdate();

    // Mettre à jour en base de données
    const _updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: 'CLAIMED',
        claimedById: user.id,
        claimedByName: user.username
      }
    });

    // Le verrou d'attente tombe a la prise en charge : c'est tout son objet.
    if (ticket.lockUntilClaim) {
      await applyTicketLockState(client, ticket, guildConfig, false);
      await prisma.ticket.update({ where: { id: ticketId }, data: { lockUntilClaim: false } });
    }

    // Mettre à jour le container V2 du message de bienvenue (Components V2 uniquement, pas d'embeds)
    const ticketChannel = interaction.channel as TextChannel;
    if (ticketChannel) {
      try {
        const bodyText = `Ce ticket est actuellement pris en charge par <@${user.id}>.\n\n**Auteur :** <@${ticket.userId}>\n**Raison :** ${ticket.reason}\n**Description :** ${ticket.description}`;
        const updatedContainer = buildTicketStatusContainer(ticket, bodyText, COLORS_RAW.warning);

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

        await interaction.message.edit({
          components: [updatedContainer, row],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { users: [user.id, ticket.userId] },
        });
      } catch (err) {
        logger.error('Ticket', 'Error updating welcome message container:', err);
      }

      await ticketChannel.send({
        embeds: [successEmbed('Pris en charge', `Ce ticket est désormais pris en charge par <@${user.id}>.`)],
        allowedMentions: { users: [user.id] },
      });
    }

    // Logger
    await logTicketEvent(client, guildConfig, 'CLAIMED', ticket, user);
    return;
  }

  // 2 bis. Validation préalable : accepter la demande et créer le ticket
  if (action === 'approve') {
    if (!canManageTicket(member as GuildMember, guildConfig, ticket.staffRoleId)) {
      await interaction.reply({ content: '❌ Seuls les membres du personnel peuvent valider une demande de ticket.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    if (ticket.status !== 'PENDING') {
      await interaction.reply({ content: '⚠️ Cette demande a déjà été traitée.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const ticketType = resolveTicketPanelType(guildConfig, ticket.ticketTypeId);
    const opener = await client.users.fetch(ticket.userId).catch(() => null);
    const locale = await resolveGuildLocale(guildId, guild.preferredLocale);

    try {
      const result = await createTicketWorkspace(client, {
        guild,
        user: { id: ticket.userId, username: opener?.username ?? ticket.username },
        ticketType,
        guildConfig,
        reason: ticket.reason,
        description: ticket.description,
        locale,
        existingTicketId: ticket.id,
      });

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { reviewedById: user.id, reviewedByName: user.username, reviewedAt: new Date() },
      });

      await updateTicketReviewCard(client, ticket, 'APPROVED', user, null);

      // Le membre n'est pas forcement encore devant Discord : le MP le ramene
      // vers son ticket sans qu'il ait a surveiller la liste des salons.
      if (opener) {
        await opener.send({
          embeds: [successEmbed('Demande de ticket acceptée', `Votre demande sur **${guild.name}** a été validée par <@${user.id}>.\n\n${result.userMessage}`)],
          allowedMentions: { parse: [] },
        }).catch(() => null);
      }

      await interaction.editReply({ content: `✅ Demande validée. ${result.userMessage}` });
    } catch (err) {
      logger.error('Ticket', 'Error approving ticket request:', err);
      const message = err instanceof Error && err.message.startsWith('❌')
        ? err.message
        : "❌ Impossible de créer le ticket. Vérifiez la configuration du module.";
      await interaction.editReply({ content: message });
    }
    return;
  }

  // 2 ter. Validation préalable : refuser la demande (motif saisi dans un modal)
  if (action === 'reject') {
    if (!canManageTicket(member as GuildMember, guildConfig, ticket.staffRoleId)) {
      await interaction.reply({ content: '❌ Seuls les membres du personnel peuvent refuser une demande de ticket.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    if (ticket.status !== 'PENDING') {
      await interaction.reply({ content: '⚠️ Cette demande a déjà été traitée.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`modal:ticket:reject:${ticket.id}`)
      .setTitle('Refuser la demande')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Motif communiqué au membre')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Ex : demande déjà traitée, informations insuffisantes...')
            .setRequired(false)
            .setMaxLength(500),
        ),
      );

    await interaction.showModal(modal);
    return;
  }

  // 3. Action: Info / Casier de la personne
  if (action === 'info') {
    if (!canManageTicket(member as GuildMember, guildConfig, ticket.staffRoleId)) {
      await interaction.reply({ content: '❌ Permissions insuffisantes.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      const panel = await buildMemberCasePanel(guild, ticket.userId, 'resume', 0);
      await interaction.editReply({
        components: panel.components,
        files: panel.files,
        flags: [MessageFlags.IsComponentsV2],
      });
    } catch (err) {
      logger.error('Ticket', 'Error building member profile card for ticket:', err);
      await interaction.editReply({ content: "❌ Impossible de générer la fiche de l'utilisateur." });
    }
    return;
  }

  // 4. Action: Fermer
  if (action === 'close') {
    // Le créateur ou le staff peut fermer
    const isOpener = ticket.userId === user.id;
    const isStaff = canManageTicket(member as GuildMember, guildConfig, ticket.staffRoleId);

    if (!isOpener && !isStaff) {
      await interaction.reply({ content: "❌ Vous n'avez pas la permission de fermer ce ticket.", flags: [MessageFlags.Ephemeral] });
      return;
    }

    if (ticket.status === 'CLOSED') {
      await interaction.reply({ content: '⚠️ Le ticket est déjà fermé.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    await interaction.deferUpdate();
    await closeTicket(client, ticketId, user.id, user.username);
    return;
  }

  // 5. Action: Réouvrir
  if (action === 'reopen') {
    if (!canManageTicket(member as GuildMember, guildConfig, ticket.staffRoleId)) {
      await interaction.reply({ content: '❌ Seuls les membres du personnel peuvent réouvrir un ticket.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    await interaction.deferUpdate();

    // Mettre à jour en BDD
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: 'OPEN',
        closedById: null,
        closedByName: null,
        closedAt: null
      }
    });

    const ticketChannel = interaction.channel as TextChannel;
    if (ticketChannel) {
      // Rename channel
      await renameChannelToOpen(client, ticketChannel.id).catch(() => null);

      // Restaurer les permissions de l'opener
      try {
        await ticketChannel.permissionOverwrites.edit(ticket.userId, {
          ViewChannel: true,
          // Un ticket clos sans avoir jamais été pris en charge repart
          // verrouillé : la réouverture ne doit pas contourner l'attente.
          SendMessages: !ticket.lockUntilClaim,
          ReadMessageHistory: true
        });
      } catch (err) {
        logger.error('Ticket', 'Error restoring opener permissions:', err);
      }

      if (ticket.lockUntilClaim) {
        await applyTicketLockState(client, ticket, guildConfig, true);
      }

      // Restaurer le container V2 du message de bienvenue (ré-active les boutons désactivés à la fermeture)
      try {
        const welcomeMessage = await findTicketWelcomeMessage(ticketChannel, ticketId);
        if (welcomeMessage) {
          const bodyText = `Ce ticket a été réouvert par <@${user.id}>.\n\n**Auteur :** <@${ticket.userId}>\n**Raison :** ${ticket.reason}\n**Description :** ${ticket.description}`;
          const updatedContainer = buildTicketStatusContainer(ticket, bodyText, COLORS_RAW.primary);

          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`ticket:claim:${ticketId}`).setLabel('Prendre en charge').setStyle(ButtonStyle.Primary).setEmoji('🛠️'),
            new ButtonBuilder().setCustomId(`ticket:info:${ticketId}`).setLabel('Infos Membre').setStyle(ButtonStyle.Secondary).setEmoji('🔍'),
            new ButtonBuilder().setCustomId(`ticket:close:${ticketId}`).setLabel('Fermer').setStyle(ButtonStyle.Danger).setEmoji('🔒')
          );

          await welcomeMessage.edit({
            components: [updatedContainer, row],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [user.id, ticket.userId] },
          }).catch(() => null);
        }
      } catch (err) {
        logger.error('Ticket', 'Error restoring welcome message container on reopen:', err);
      }

      // Supprimer le message d'interaction précédent ou juste en envoyer un nouveau
      await ticketChannel.send({
        embeds: [successEmbed('Ticket Réouvert', `Le ticket a été réouvert par <@${user.id}>. Le créateur a de nouveau accès au salon.`)],
        allowedMentions: { users: [user.id, ticket.userId] },
      });
    }

    // Logger
    await logTicketEvent(client, guildConfig, 'REOPENED', ticket, user);
    return;
  }

  // 6. Action: Supprimer (avec transcription obligatoire !)
  if (action === 'delete') {
    if (!canManageTicket(member as GuildMember, guildConfig, ticket.staffRoleId)) {
      await interaction.reply({ content: '❌ Seuls les membres du personnel peuvent supprimer un ticket.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    const ticketChannel = interaction.channel as TextChannel;
    if (!ticketChannel) return;

    await interaction.reply({ content: '⏳ Transcription en cours et suppression imminente du salon...' });

    try {
      // 1. Générer la transcription
      const transcriptData = await generateTranscript(ticketChannel);

      // 2. Enregistrer la transcription et fermer le ticket en BDD
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          channelId: null, // Plus de salon actif
          status: 'CLOSED',
          transcriptId: transcriptData.id
        }
      });

      // 3. Logger l'événement avec le lien de transcription
      const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';
      const publicLink = `${dashboardUrl}/transcripts/${transcriptData.id}`;
      
      await logTicketEvent(client, guildConfig, 'DELETED', ticket, user, publicLink);

      // 4. Envoyer en MP aux personnes concernées (créateur, staff claim, staff close, staff delete) sans doublons
      const usersToDm = new Set<string>();
      if (ticket.userId) usersToDm.add(ticket.userId);
      if (ticket.claimedById) usersToDm.add(ticket.claimedById);
      if (ticket.closedById) usersToDm.add(ticket.closedById);
      if (user.id) usersToDm.add(user.id);
      
      const dmEmbed = new EmbedBuilder()
        .setTitle('📄 Transcription de ticket')
        .setDescription(`Le ticket d'assistance **${ticket.reason}** du serveur **${guild.name}** a été supprimé.\n\nVoici le lien pour consulter la transcription complète :`)
        .addFields([{ name: "Lien d'accès", value: `🌐 [Consulter le transcript](${publicLink})` }])
        .setColor(COLORS.primary as ColorResolvable)
        .setTimestamp();
        
      for (const dmUserId of usersToDm) {
        try {
          const dmUser = await client.users.fetch(dmUserId);
          if (dmUser) await dmUser.send({ embeds: [dmEmbed], allowedMentions: { parse: [] } });
        } catch (err) {
          // Ignorer si les MPs sont bloqués
        }
      }

      // 5. Supprimer le salon Discord après 3 secondes
      setTimeout(async () => {
        try {
          await ticketChannel.delete(`Ticket supprimé par ${user.username} (Transcript ID: ${transcriptData.id})`);
        } catch (delErr) {
          logger.error('Ticket', 'Error deleting ticket channel:', delErr);
        }
      }, 3000);

    } catch (err) {
      logger.error('Ticket', 'Error deleting ticket and generating transcript:', err);
      await interaction.followUp({ content: '❌ Une erreur est survenue lors de la transcription. Suppression annulée.', flags: [MessageFlags.Ephemeral] });
    }
    return;
  }
}

type TicketWorkspaceParams = {
  guild: Guild;
  user: { id: string; username: string };
  ticketType: TicketPanelTypeConfig;
  guildConfig: any;
  reason: string;
  description: string;
  locale: BotLocale;
  /**
   * Demande deja enregistree (validation prealable) : la ligne existe en base
   * au statut PENDING et doit etre completee, pas dupliquee.
   */
  existingTicketId?: string | null;
};

type TicketWorkspaceResult = {
  ticketId: string;
  /** Message de confirmation destine a l'auteur du ticket. */
  userMessage: string;
};

/**
 * Cree le salon, le fil ou la conversation MP d'un ticket puis y depose le
 * message d'accueil.
 *
 * Separee de `executeTicketCreation` parce qu'elle sert aussi a la validation
 * prealable : une demande acceptee des heures plus tard n'a plus d'interaction
 * a repondre, seulement un ticket a materialiser. Elle leve donc une erreur
 * porteuse d'un message lisible au lieu de repondre elle-meme.
 */
async function createTicketWorkspace(
  client: Client,
  params: TicketWorkspaceParams,
): Promise<TicketWorkspaceResult> {
  const { guild, user, ticketType, guildConfig, reason, description, locale, existingTicketId } = params;
  const guildId = guild.id;

  const ticketMode = ticketType.mode || guildConfig.ticketMode || 'CHANNEL';
  const isAnonymous = ticketType.anonymous === true && ticketMode === 'DM';
  const useStaffServerRelay = ticketType.staffServerRelay === true;
  // Un ticket MP n'a pas de salon a verrouiller : le reglage ne s'y applique pas.
  const lockUntilClaim = ticketMode !== 'DM' && resolveLockUntilClaim(ticketType, guildConfig);

  /** Complete la demande deja validee, ou ouvre une ligne neuve. */
  const persistTicket = async (data: Record<string, unknown>) => {
    if (existingTicketId) {
      return prisma.ticket.update({
        where: { id: existingTicketId },
        data: { ...data, rejectionReason: null },
      });
    }
    return prisma.ticket.create({ data: data as never });
  };

  const ticketStaffRoleId = ticketType.staffRoleId || guildConfig.ticketStaffRoleId || null;
  const staffMention = ticketStaffRoleId ? `<@&${ticketStaffRoleId}>` : null;

  if (ticketMode === 'DM') {
    // ─── Mode DM : ticket via messages privés ───────────────────────
    let relayChannel: TextChannel | null = null;
    let staffServerGuildId: string | null = null;

    if (useStaffServerRelay) {
      const staffLink = await prisma.staffServerLink.findFirst({
        where: { mainGuildId: guildId, enabled: true },
      });
      if (staffLink) {
        staffServerGuildId = staffLink.staffGuildId;
        const staffGuild = client.guilds.cache.get(staffLink.staffGuildId);
        const logChannelId = staffLink.staffLogChannelId;
        if (logChannelId && staffGuild) {
          const ch = staffGuild.channels.cache.get(logChannelId);
          if (ch instanceof TextChannel) relayChannel = ch;
        }
        if (!relayChannel && staffGuild) {
          const fallback = staffGuild.channels.cache.find(
            (c) => c instanceof TextChannel && c.name.includes('ticket'),
          );
          if (fallback instanceof TextChannel) relayChannel = fallback;
        }
      }
    }

    if (!relayChannel) {
      const relayChannelId = (guildConfig as any).ticketDmRelayChannelId || guildConfig.ticketLogChannelId;
      const fetched = relayChannelId ? await client.channels.fetch(relayChannelId).catch(() => null) : null;
      if (fetched instanceof TextChannel) relayChannel = fetched;
    }

    if (!relayChannel) {
      throw new Error('❌ Aucun salon de relais configuré pour le mode MP. Contactez un administrateur.');
    }

    const displayName = isAnonymous ? 'Membre Anonyme' : user.username;

    const ticket = await persistTicket({
      guildId,
      mode: 'DM',
      ticketTypeId: ticketType.id,
      ticketTypeLabel: ticketType.label,
      staffRoleId: ticketStaffRoleId,
      categoryId: null,
      userId: user.id,
      username: user.username,
      reason,
      description,
      status: 'OPEN',
      isAnonymous,
      staffServerGuildId,
    });

    const threadName = isAnonymous
      ? `🎫 Anonyme - ${reason}`.slice(0, 100)
      : `🎫 ${user.username} - ${reason}`.slice(0, 100);

    const thread = await relayChannel.threads.create({
      name: threadName,
      autoArchiveDuration: 10080,
      reason: `Ticket DM de ${displayName}`
    });

    await prisma.ticket.update({ where: { id: ticket.id }, data: { threadId: thread.id } });

    const creatorLine = isAnonymous
      ? '**Créateur :** Anonyme (identité masquée)'
      : `**Créateur :** <@${user.id}> (${user.username})`;

    const welcomeColorHex = guildConfig.ticketWelcomeColor || '#5865F2';
    const color = typeof welcomeColorHex === 'string' ? parseInt(welcomeColorHex.replace('#', ''), 16) : COLORS_RAW.primary;

    const staffEmbed = new EmbedBuilder()
      .setTitle(`🎫 Nouveau Ticket MP · ${ticketType.label}`)
      .setDescription(`${creatorLine}\n**Raison :** ${reason}\n\n**Description :**\n${description}\n\n> Les messages envoyés ici seront relayés en MP à l'utilisateur.`)
      .setColor(color)
      .setTimestamp()
      .setFooter({ text: `Kotbo · Ticket ID: ${ticket.id}` });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('Prendre en charge').setStyle(ButtonStyle.Primary).setEmoji('🛠️'),
      new ButtonBuilder().setCustomId(`ticket:info:${ticket.id}`).setLabel('Infos Membre').setStyle(ButtonStyle.Secondary).setEmoji('🔍'),
      new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Fermer').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    );

    if (staffMention) await thread.send({ content: staffMention, allowedMentions: { roles: ticketStaffRoleId ? [ticketStaffRoleId] : [] } });
    await thread.send({ embeds: [staffEmbed], components: [row] });

    const dmEmbed = new EmbedBuilder()
      .setTitle(`🎫 Ticket ouvert · ${guild.name}`)
      .setDescription(`Votre ticket d'assistance a bien été créé !\nLe personnel va prendre en charge votre demande. **Répondez directement ici** pour communiquer avec le staff.\n\n**Raison :** ${reason}\n**Description :** ${description}`)
      .setColor(color)
      .setTimestamp()
      .setFooter({ text: `Kotbo · Ticket ID: ${ticket.id}` });

    try {
      const dmUser = await client.users.fetch(user.id);
      await dmUser.send({ embeds: [dmEmbed], allowedMentions: { parse: [] } });
    } catch {
      await thread.send({ embeds: [errorEmbed('MP bloqués', `<@${user.id}> a ses messages privés désactivés. Le ticket ne pourra pas fonctionner en mode MP.`)], allowedMentions: { parse: [] } });
    }

    await logTicketEvent(client, guildConfig, 'OPENED', ticket, user);
    await handleTicketTrigger(guildId, user.id, ticketType.id, reason, description, client, ticket.id);

    client.users.fetch(user.id).then(dmUser => {
      if (dmUser) setupInteractiveTicketQuestions(client, dmUser, user.id, ticketType, guildConfig).catch(console.error);
    }).catch(console.error);

    return {
      ticketId: ticket.id,
      userMessage: '✅ Votre ticket a été créé ! Consultez vos messages privés pour communiquer avec le staff.',
    };

  } else if (ticketMode === 'THREAD') {
    // ─── Mode Thread : ticket dans un fil de discussion ─────────────
    const parentChannelId = guildConfig.ticketChannelId || guildConfig.ticketLogChannelId;
    const parentChannel = parentChannelId ? await client.channels.fetch(parentChannelId).catch(() => null) : null;

    if (!parentChannel || !(parentChannel instanceof TextChannel)) {
      throw new Error('❌ Aucun salon configuré pour le mode Thread. Contactez un administrateur.');
    }

    const ticket = await persistTicket({
      guildId,
      mode: 'THREAD',
      ticketTypeId: ticketType.id,
      ticketTypeLabel: ticketType.label,
      staffRoleId: ticketStaffRoleId,
      categoryId: null,
      userId: user.id,
      username: user.username,
      reason,
      description,
      status: 'OPEN',
      lockUntilClaim,
    });

    const thread = await parentChannel.threads.create({
      name: `🎫 ${user.username} - ${reason}`.slice(0, 100),
      autoArchiveDuration: 10080,
      type: ChannelType.PrivateThread,
      reason: `Ticket Thread de ${user.username}`
    });

    await thread.members.add(user.id).catch(() => null);

    await prisma.ticket.update({ where: { id: ticket.id }, data: { threadId: thread.id, channelId: thread.id } });

    const welcomeContainer = buildTicketWelcomeContainer(
      guildConfig,
      ticketType,
      ticket,
      user,
      staffMention,
      reason,
      description,
      locale
    );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('Prendre en charge').setStyle(ButtonStyle.Primary).setEmoji('🛠️'),
      new ButtonBuilder().setCustomId(`ticket:info:${ticket.id}`).setLabel('Infos Membre').setStyle(ButtonStyle.Secondary).setEmoji('🔍'),
      new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Fermer').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    );

    await thread.send({
      components: [welcomeContainer, row],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [user.id], roles: ticketStaffRoleId ? [ticketStaffRoleId] : [] },
    });

    // Le verrou vient apres l'accueil : un fil verrouille n'accepte plus que
    // les messages des moderateurs.
    if (lockUntilClaim) {
      await thread.send({ embeds: [buildTicketLockNoticeEmbed(staffMention)], allowedMentions: { parse: [] } }).catch(() => null);
      await thread.setLocked(true, 'Ticket en attente de prise en charge').catch(() => null);
    }

    await logTicketEvent(client, guildConfig, 'OPENED', ticket, user);
    await handleTicketTrigger(guildId, user.id, ticketType.id, reason, description, client, ticket.id);

    if (!lockUntilClaim) {
      setupInteractiveTicketQuestions(client, thread, user.id, ticketType, guildConfig).catch(console.error);
    }

    return {
      ticketId: ticket.id,
      userMessage: lockUntilClaim
        ? `✅ Votre ticket a été créé : <#${thread.id}>. Il reste verrouillé jusqu'à sa prise en charge par un membre du staff.`
        : `✅ Votre ticket a été créé : <#${thread.id}>.`,
    };

  } else {
    // ─── Mode CHANNEL (défaut) : créer un salon texte ───────────────

    // Tickets internes : le salon est créé sur le serveur staff lié (si configuré)
    let targetGuild = guild;
    let onStaffServer = false;
    let staffLinkForTicket: { staffGuildId: string; simpleStaffRoleId: string | null } | null = null;

    if (ticketType.staffServerChannel) {
      const staffLink = await prisma.staffServerLink.findFirst({
        where: { mainGuildId: guildId, enabled: true },
        select: { staffGuildId: true, simpleStaffRoleId: true },
      });
      const staffGuild = staffLink ? client.guilds.cache.get(staffLink.staffGuildId) : null;
      if (staffGuild) {
        targetGuild = staffGuild;
        onStaffServer = true;
        staffLinkForTicket = staffLink;
      } else {
        logger.warn('Ticket', `Ticket interne demandé mais serveur staff introuvable pour ${guildId} - repli sur le serveur principal.`);
      }
    }

    const ticketCategoryId = onStaffServer
      ? (ticketType.staffServerCategoryId || null)
      : (ticketType.categoryId || guildConfig.ticketCategoryId || null);
    const ticketCategory = ticketCategoryId
      ? targetGuild.channels.cache.get(ticketCategoryId)
      : null;

    const cleanedUsername = user.username.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'membre';
    const channelName = `ticket-${cleanedUsername}`;

    // Verrouille, le salon reste visible pour l'auteur comme pour le staff :
    // seule l'ecriture est refusee, et il faut la refuser explicitement car
    // `SendMessages` non precise s'herite de la categorie.
    const participantOverwrite = (id: string) => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        ...(lockUntilClaim ? [] : [PermissionFlagsBits.SendMessages]),
      ],
      ...(lockUntilClaim ? { deny: [PermissionFlagsBits.SendMessages] } : {}),
    });

    const permissionOverwrites: any[] = [
      {
        id: targetGuild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      participantOverwrite(user.id),
    ];

    // Sur le serveur staff, les rôles du serveur principal n'existent pas : n'ajouter un
    // overwrite de rôle que s'il existe réellement sur la guilde cible.
    const staffRoleForOverwrite = ticketStaffRoleId && targetGuild.roles.cache.has(ticketStaffRoleId)
      ? ticketStaffRoleId
      : (onStaffServer && staffLinkForTicket?.simpleStaffRoleId && targetGuild.roles.cache.has(staffLinkForTicket.simpleStaffRoleId)
        ? staffLinkForTicket.simpleStaffRoleId
        : null);

    if (staffRoleForOverwrite) {
      permissionOverwrites.push(participantOverwrite(staffRoleForOverwrite));
    }

    if (guildConfig.moderatorRoleId && targetGuild.roles.cache.has(guildConfig.moderatorRoleId)) {
      permissionOverwrites.push(participantOverwrite(guildConfig.moderatorRoleId));
    }

    const ticketChannel = await targetGuild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: ticketCategory && ticketCategory.type === ChannelType.GuildCategory ? ticketCategory.id : undefined,
      topic: `Ticket de ${user.username} - Raison : ${reason}`,
      permissionOverwrites
    });

    const ticket = await persistTicket({
      guildId,
      channelId: ticketChannel.id,
      mode: 'CHANNEL',
      ticketTypeId: ticketType.id,
      ticketTypeLabel: ticketType.label,
      staffRoleId: staffRoleForOverwrite,
      categoryId: ticketCategoryId,
      userId: user.id,
      username: user.username,
      reason,
      description,
      status: 'OPEN',
      staffServerGuildId: onStaffServer ? targetGuild.id : null,
      lockUntilClaim,
    });

    const welcomeContainer = buildTicketWelcomeContainer(
      guildConfig,
      ticketType,
      ticket,
      user,
      staffMention,
      reason,
      description,
      locale
    );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('Prendre en charge').setStyle(ButtonStyle.Primary).setEmoji('🛠️'),
      new ButtonBuilder().setCustomId(`ticket:info:${ticket.id}`).setLabel('Infos Membre').setStyle(ButtonStyle.Secondary).setEmoji('🔍'),
      new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Fermer').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    );

    await ticketChannel.send({
      components: [welcomeContainer, row],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [user.id], roles: staffRoleForOverwrite ? [staffRoleForOverwrite] : [] },
    });

    if (lockUntilClaim) {
      await ticketChannel.send({ embeds: [buildTicketLockNoticeEmbed(staffMention)], allowedMentions: { parse: [] } }).catch(() => null);
    }

    await logTicketEvent(client, guildConfig, 'OPENED', ticket, user);
    await handleTicketTrigger(guildId, user.id, ticketType.id, reason, description, client, ticket.id);

    // Les questions interactives attendent des reponses de l'auteur : les
    // poser dans un salon verrouille ne ferait qu'accumuler des expirations.
    if (!lockUntilClaim) {
      setupInteractiveTicketQuestions(client, ticketChannel, user.id, ticketType, guildConfig).catch(console.error);
    }

    // <#id> ne résout pas entre serveurs : URL complète quand le ticket vit sur le serveur staff
    const channelRef = onStaffServer
      ? `https://discord.com/channels/${targetGuild.id}/${ticketChannel.id}`
      : `<#${ticketChannel.id}>`;

    return {
      ticketId: ticket.id,
      userMessage: lockUntilClaim
        ? `✅ Votre ticket a été créé : ${channelRef}. Il reste verrouillé jusqu'à sa prise en charge par un membre du staff.`
        : `✅ Votre ticket a été créé avec succès : ${channelRef}.`,
    };
  }
}

/** Encart depose dans un ticket verrouille pour expliquer l'absence d'ecriture. */
function buildTicketLockNoticeEmbed(staffMention: string | null): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🔒 Ticket verrouillé')
    .setDescription(
      `Ce ticket est visible mais **verrouillé** : personne ne peut y écrire tant qu'un membre du staff${staffMention ? ` (${staffMention})` : ''} ne l'a pas pris en charge.\n\n` +
      'Le salon s\'ouvrira automatiquement dès la prise en charge.',
    )
    .setColor(COLORS.warning as ColorResolvable)
    .setTimestamp();
}

/**
 * Enregistre une demande de ticket en attente et depose sa carte de validation
 * dans le salon prevu. Aucun salon de ticket n'est cree a ce stade.
 */
async function createPendingTicketRequest(
  client: Client,
  params: Omit<TicketWorkspaceParams, 'existingTicketId'>,
): Promise<TicketWorkspaceResult> {
  const { guild, user, ticketType, guildConfig, reason, description } = params;

  const reviewChannelId = guildConfig.ticketApprovalChannelId || guildConfig.ticketLogChannelId;
  const reviewChannel = reviewChannelId
    ? await client.channels.fetch(reviewChannelId).catch(() => null)
    : null;

  if (!reviewChannel || !(reviewChannel instanceof TextChannel)) {
    throw new Error("❌ Aucun salon de validation configuré pour les demandes de ticket. Contactez un administrateur.");
  }

  const ticketMode = ticketType.mode || guildConfig.ticketMode || 'CHANNEL';
  const ticketStaffRoleId = ticketType.staffRoleId || guildConfig.ticketStaffRoleId || null;

  const ticket = await prisma.ticket.create({
    data: {
      guildId: guild.id,
      mode: ticketMode,
      ticketTypeId: ticketType.id,
      ticketTypeLabel: ticketType.label,
      staffRoleId: ticketStaffRoleId,
      categoryId: null,
      userId: user.id,
      username: user.username,
      reason,
      description,
      status: 'PENDING',
      lockUntilClaim: ticketMode !== 'DM' && resolveLockUntilClaim(ticketType, guildConfig),
      reviewChannelId: reviewChannel.id,
    },
  });

  const message = await reviewChannel.send({
    content: ticketStaffRoleId ? `<@&${ticketStaffRoleId}>` : undefined,
    embeds: [buildTicketReviewEmbed(ticket)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`ticket:approve:${ticket.id}`).setLabel('Valider').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId(`ticket:reject:${ticket.id}`).setLabel('Refuser').setStyle(ButtonStyle.Danger).setEmoji('⛔'),
        new ButtonBuilder().setCustomId(`ticket:info:${ticket.id}`).setLabel('Infos Membre').setStyle(ButtonStyle.Secondary).setEmoji('🔍'),
      ),
    ],
    allowedMentions: { roles: ticketStaffRoleId ? [ticketStaffRoleId] : [] },
  });

  await prisma.ticket.update({ where: { id: ticket.id }, data: { reviewMessageId: message.id } });

  return {
    ticketId: ticket.id,
    userMessage: "📬 Votre demande a été transmise au staff. Le ticket sera ouvert dès qu'un membre du personnel l'aura validée.",
  };
}

/**
 * Fige la carte de validation apres decision : boutons retires et verdict
 * affiche, pour qu'aucun autre membre du staff ne rejoue la meme demande.
 */
async function updateTicketReviewCard(
  client: Client,
  ticket: { id: string; reviewChannelId: string | null; reviewMessageId: string | null; userId: string; username: string; reason: string; description: string; ticketTypeLabel: string | null },
  decision: 'APPROVED' | 'REJECTED',
  reviewer: { id: string; username: string },
  rejectionReason: string | null,
): Promise<void> {
  if (!ticket.reviewChannelId || !ticket.reviewMessageId) return;

  try {
    const channel = client.channels.cache.get(ticket.reviewChannelId)
      ?? await client.channels.fetch(ticket.reviewChannelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const message = await channel.messages.fetch(ticket.reviewMessageId).catch(() => null);
    if (!message) return;

    const embed = buildTicketReviewEmbed(ticket)
      .setTitle(decision === 'APPROVED' ? '✅ Demande de ticket validée' : '⛔ Demande de ticket refusée')
      .setColor((decision === 'APPROVED' ? COLORS.success : COLORS.danger) as ColorResolvable)
      .addFields([
        { name: decision === 'APPROVED' ? 'Validée par' : 'Refusée par', value: `<@${reviewer.id}>`, inline: true },
        ...(rejectionReason ? [{ name: 'Motif', value: rejectionReason.slice(0, 1024) }] : []),
      ]);

    await message.edit({ content: null, embeds: [embed], components: [], allowedMentions: { parse: [] } });
  } catch (err) {
    logger.error('Ticket', 'Error updating ticket review card:', err);
  }
}

/** Carte de decision affichee au staff pour une demande en attente. */
function buildTicketReviewEmbed(ticket: {
  id: string;
  userId: string;
  username: string;
  reason: string;
  description: string;
  ticketTypeLabel: string | null;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🕒 Demande de ticket en attente')
    .setDescription(`<@${ticket.userId}> (${ticket.username}) demande l'ouverture d'un ticket.`)
    .setColor(COLORS.warning as ColorResolvable)
    .addFields([
      { name: 'Type', value: ticket.ticketTypeLabel || 'Ticket standard', inline: true },
      { name: 'Raison', value: ticket.reason.slice(0, 1024) || '-', inline: true },
      { name: 'Description', value: ticket.description.slice(0, 1024) || '-' },
    ])
    .setTimestamp()
    .setFooter({ text: `Kotbo · Ticket ID: ${ticket.id}` });
}

/**
 * Point d'entree de l'ouverture depuis le panneau : refuse les membres
 * blacklistes, passe par la validation prealable quand elle est active, et
 * repond a l'interaction dans tous les cas.
 */
export async function executeTicketCreation(
  client: Client,
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
  ticketType: TicketPanelTypeConfig,
  reason: string,
  description: string
): Promise<string | null> {
  const { guildId, user, guild } = interaction;
  if (!guildId || !guild) return null;

  const guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guildConfig) {
    await interaction.editReply({ content: '❌ Configuration du serveur introuvable.' });
    return null;
  }

  // Dernier filet : le formulaire a pu etre ouvert avant la mise en blacklist.
  const blacklisted = await findActiveTicketBlacklist(guildId, user.id);
  if (blacklisted) {
    await interaction.editReply({ content: ticketBlacklistMessage(blacklisted) });
    return null;
  }

  // Langue du serveur et non celle de la personne qui clique : le message
  // d'accueil est lu dans le salon par tous ceux qui y ont acces.
  const locale = await resolveGuildLocale(guildId, guild.preferredLocale);

  try {
    const params = { guild, user, ticketType, guildConfig, reason, description, locale };
    const result = resolveRequireApproval(ticketType, guildConfig)
      ? await createPendingTicketRequest(client, params)
      : await createTicketWorkspace(client, params);

    await interaction.editReply({ content: result.userMessage });
    return result.ticketId;
  } catch (err) {
    logger.error('Ticket', 'Error creating ticket:', err);
    // Les messages leves par la creation sont ecrits pour l'auteur du ticket :
    // les afficher tels quels evite un « erreur inconnue » quand la cause est
    // une configuration incomplete.
    const message = err instanceof Error && err.message.startsWith('❌')
      ? err.message
      : "❌ Une erreur est survenue lors de l'ouverture du ticket. Veuillez contacter un administrateur.";
    await interaction.editReply({ content: message });
    return null;
  }
}

export async function handleTicketModalSubmit(client: Client, customId: string, interaction: ModalSubmitInteraction): Promise<void> {
  // ─── DM direct ticket (from /ticket open in DM) ──────────
  if (customId.startsWith('modal:ticket:open:dm_direct:')) {
    const targetGuildId = customId.split(':')[4];
    return handleDmDirectTicket(client, interaction, targetGuildId);
  }

  const { guildId, guild } = interaction;
  if (!guildId || !guild) return;

  const guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guildConfig) {
    await interaction.reply({ content: '❌ Configuration du serveur introuvable.', flags: [MessageFlags.Ephemeral] });
    return;
  }

  // ─── Refus d'une demande en attente de validation ──────────
  if (customId.startsWith('modal:ticket:reject:')) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const ticketId = customId.split(':')[3];
    const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, guildId } });
    if (!ticket) {
      await interaction.editReply({ content: '❌ Demande introuvable.' });
      return;
    }
    if (ticket.status !== 'PENDING') {
      await interaction.editReply({ content: '⚠️ Cette demande a déjà été traitée.' });
      return;
    }

    const rejectionReason = interaction.fields.getTextInputValue('reason')?.trim() || null;

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'REJECTED',
        rejectionReason,
        reviewedById: interaction.user.id,
        reviewedByName: interaction.user.username,
        reviewedAt: new Date(),
      },
    });

    await updateTicketReviewCard(client, ticket, 'REJECTED', interaction.user, rejectionReason);

    const opener = await client.users.fetch(ticket.userId).catch(() => null);
    if (opener) {
      await opener.send({
        embeds: [errorEmbed(
          'Demande de ticket refusée',
          `Votre demande sur **${guild.name}** a été refusée.${rejectionReason ? `\n\n**Motif :** ${rejectionReason}` : ''}`,
        )],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }

    await interaction.editReply({ content: '⛔ Demande refusée. Le membre a été prévenu en message privé.' });
    return;
  }

  if (customId === 'modal:ticket:open' || customId.startsWith('modal:ticket:open:')) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const typeId = customId.startsWith('modal:ticket:open:') ? customId.split(':')[3] : null;
    const ticketType = resolveTicketPanelType(guildConfig, typeId);

    let reason = '';
    let description = '';

    const customFields = ((ticketType as any).formCustomFields ?? guildConfig.ticketFormCustomFields) as any[];

    if (Array.isArray(customFields) && customFields.length > 0) {
      const answers: string[] = [];
      const fieldsToUse = customFields.slice(0, 5);
      fieldsToUse.forEach((f: any) => {
        try {
          const val = interaction.fields.getTextInputValue(f.id);
          answers.push(`**${f.label}** :\n${val || '_Non renseigné_'}`);
          if (!reason && val) {
            reason = val.substring(0, 100);
          }
        } catch {}
      });
      description = answers.join('\n\n');
      if (!reason) {
        reason = ticketType.label || 'Ticket';
      }
    } else {
      // Rétrocompatibilité avec les champs par défaut du type
      const fieldsToUse = Array.isArray((ticketType as any).fields) && (ticketType as any).fields.length > 0
        ? (ticketType as any).fields.slice(0, 5)
        : null;

      if (fieldsToUse) {
        const answers: string[] = [];
        for (const f of fieldsToUse) {
          try {
            const val = interaction.fields.getTextInputValue(f.id);
            answers.push(`**${f.label}** :\n${val || '_Non renseigné_'}`);
            if (!reason && val) {
              reason = val.substring(0, 100);
            }
          } catch {}
        }
        description = answers.join('\n\n');
        if (!reason) {
          reason = ticketType.label || 'Ticket';
        }
      } else {
        reason = interaction.fields.getTextInputValue('reason') || 'Ticket';
        description = interaction.fields.getTextInputValue('description') || 'Aucune description fournie.';
      }
    }

    await executeTicketCreation(client, interaction, ticketType, reason, description);
    return;
  }

}

/**
 * Creates a DM ticket from /ticket open in DMs.
 */
async function handleDmDirectTicket(
  client: Client,
  interaction: ModalSubmitInteraction,
  targetGuildId: string,
): Promise<void> {
  const user = interaction.user;

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const guildConfig = await prisma.guild.findUnique({ where: { id: targetGuildId } });
  if (!guildConfig) {
    await interaction.editReply({ content: '❌ Ce serveur n\'est pas configuré.' });
    return;
  }

  const guild = client.guilds.cache.get(targetGuildId);
  if (!guild) {
    await interaction.editReply({ content: '❌ Le bot n\'est pas présent sur ce serveur.' });
    return;
  }

  const blacklisted = await findActiveTicketBlacklist(targetGuildId, user.id);
  if (blacklisted) {
    await interaction.editReply({ content: ticketBlacklistMessage(blacklisted) });
    return;
  }

  const existingTicket = await prisma.ticket.findFirst({
    where: { guildId: targetGuildId, userId: user.id, status: { in: ['PENDING', 'OPEN', 'CLAIMED'] } },
  });
  if (existingTicket) {
    await interaction.editReply({
      content: existingTicket.status === 'PENDING'
        ? `⏳ Votre demande de ticket sur **${guild.name}** attend encore la validation du staff.`
        : `⚠️ Vous avez déjà un ticket ouvert sur **${guild.name}**.`,
    });
    return;
  }

  const reason = interaction.fields.getTextInputValue('reason');
  const description = interaction.fields.getTextInputValue('description');

  const ticketStaffRoleId = guildConfig.ticketStaffRoleId || null;
  const staffMention = ticketStaffRoleId ? `<@&${ticketStaffRoleId}>` : null;

  let relayChannel: TextChannel | null = null;
  let staffServerGuildId: string | null = null;

  const staffLink = await prisma.staffServerLink.findFirst({
    where: { mainGuildId: targetGuildId, enabled: true },
  });
  if (staffLink) {
    staffServerGuildId = staffLink.staffGuildId;
    const staffGuild = client.guilds.cache.get(staffLink.staffGuildId);
    if (staffLink.staffLogChannelId && staffGuild) {
      const ch = staffGuild.channels.cache.get(staffLink.staffLogChannelId);
      if (ch instanceof TextChannel) relayChannel = ch;
    }
  }

  if (!relayChannel) {
    const relayChannelId = (guildConfig as any).ticketDmRelayChannelId || guildConfig.ticketLogChannelId;
    if (relayChannelId) {
      const fetched = await client.channels.fetch(relayChannelId).catch(() => null);
      if (fetched instanceof TextChannel) relayChannel = fetched;
    }
  }

  if (!relayChannel) {
    await interaction.editReply({ content: '❌ Aucun salon de relais configuré sur ce serveur.' });
    return;
  }

  const ticket = await prisma.ticket.create({
    data: {
      guildId: targetGuildId,
      mode: 'DM',
      ticketTypeId: null,
      ticketTypeLabel: 'MP Direct',
      staffRoleId: ticketStaffRoleId,
      categoryId: null,
      userId: user.id,
      username: user.username,
      reason,
      description,
      status: 'OPEN',
      staffServerGuildId,
    },
  });

  const thread = await relayChannel.threads.create({
    name: `🎫 ${user.username} - ${reason}`.slice(0, 100),
    autoArchiveDuration: 10080,
    reason: `Ticket DM direct de ${user.username}`,
  });

  await prisma.ticket.update({ where: { id: ticket.id }, data: { threadId: thread.id } });

  const staffEmbed = new EmbedBuilder()
    .setTitle(`🎫 Nouveau Ticket MP · MP Direct`)
    .setDescription(
      `**Créateur :** <@${user.id}> (${user.username})\n` +
      `**Raison :** ${reason}\n\n` +
      `**Description :**\n${description}\n\n` +
      `> Les messages envoyés ici seront relayés en MP à l'utilisateur.`,
    )
    .setColor(COLORS.primary as any)
    .setTimestamp()
    .setFooter({ text: `Kotbo · Ticket ID: ${ticket.id}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('Prendre en charge').setStyle(ButtonStyle.Primary).setEmoji('🛠️'),
    new ButtonBuilder().setCustomId(`ticket:info:${ticket.id}`).setLabel('Infos Membre').setStyle(ButtonStyle.Secondary).setEmoji('🔍'),
    new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Fermer').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
  );

  if (staffMention) await thread.send({ content: staffMention, allowedMentions: { roles: ticketStaffRoleId ? [ticketStaffRoleId] : [] } });
  await thread.send({ embeds: [staffEmbed], components: [row] });

  const dmEmbed = new EmbedBuilder()
    .setTitle(`🎫 Ticket ouvert · ${guild.name}`)
    .setDescription(
      `Votre ticket d'assistance a bien été créé !\n` +
      `Le personnel va prendre en charge votre demande. **Répondez directement ici** pour communiquer avec le staff.\n\n` +
      `**Raison :** ${reason}\n**Description :** ${description}`,
    )
    .setColor(COLORS.primary as any)
    .setTimestamp()
    .setFooter({ text: `Kotbo · Ticket ID: ${ticket.id}` });

  try {
    await user.send({ embeds: [dmEmbed], allowedMentions: { parse: [] } });
  } catch {
    await thread.send({
      embeds: [errorEmbed('MP bloqués', `<@${user.id}> a ses messages privés désactivés.`)],
      allowedMentions: { parse: [] },
    });
  }

  await logTicketEvent(client, guildConfig, 'OPENED', ticket, user);
  await handleTicketTrigger(targetGuildId, user.id, null, reason, description, client, ticket.id);
  await interaction.editReply({ content: `✅ Votre ticket a été créé sur **${guild.name}** ! Consultez vos messages privés.` });
}

/**
 * Relays a DM message from a ticket creator to the staff thread.
 */
export async function relayDmToThread(client: Client, message: Message): Promise<void> {
  if (message.author.bot || message.guild) return;

  const ticket = await prisma.ticket.findFirst({
    where: {
      userId: message.author.id,
      mode: 'DM',
      status: { in: ['OPEN', 'CLAIMED'] },
      threadId: { not: null }
    },
    orderBy: { createdAt: 'desc' }
  });
  if (!ticket || !ticket.threadId) return;

  try {
    const thread = await client.channels.fetch(ticket.threadId).catch(() => null);
    if (!thread || !thread.isThread()) return;

    const authorName = ticket.isAnonymous ? 'Membre Anonyme' : message.author.username;
    const authorIcon = ticket.isAnonymous ? undefined : message.author.displayAvatarURL();

    const relayEmbed = new EmbedBuilder()
      .setAuthor({ name: authorName, ...(authorIcon ? { iconURL: authorIcon } : {}) })
      .setDescription(message.content || '*Pièce jointe*')
      .setColor(COLORS.primary as any)
      .setTimestamp();

    const files = message.attachments.map(a => a.url);
    await (thread as ThreadChannel).send({ embeds: [relayEmbed], files, allowedMentions: { parse: [] } });

    await message.react('✅').catch(() => null);
  } catch (err) {
    logger.error('Ticket', 'Error relaying DM to thread:', err);
  }
}

/**
 * Relays a staff thread message to the DM ticket creator.
 */
export async function relayThreadToDm(client: Client, message: Message): Promise<void> {
  if (message.author.bot || !message.channel.isThread()) return;

  const ticket = await prisma.ticket.findFirst({
    where: {
      threadId: message.channel.id,
      mode: 'DM',
      status: { in: ['OPEN', 'CLAIMED'] }
    }
  });
  if (!ticket) return;

  try {
    const dmUser = await client.users.fetch(ticket.userId);
    if (!dmUser) return;

    const _guildConfig = await prisma.guild.findUnique({ where: { id: ticket.guildId } });
    const guildName = client.guilds.cache.get(ticket.guildId)?.name || 'Serveur';

    const relayEmbed = new EmbedBuilder()
      .setAuthor({ name: `${message.author.username} · ${guildName}`, iconURL: message.author.displayAvatarURL() })
      .setDescription(message.content || '*Pièce jointe*')
      .setColor(COLORS.primary as ColorResolvable)
      .setTimestamp()
      .setFooter({ text: `Ticket: ${ticket.reason}` });

    const files = message.attachments.map(a => a.url);
    await dmUser.send({ embeds: [relayEmbed], files, allowedMentions: { parse: [] } });
  } catch (err) {
    logger.error('Ticket', 'Error relaying thread to DM:', err);
  }
}

/**
 * Logs ticket events in the designated logs channel.
 */
async function logTicketEvent(
  client: Client,
  guildConfig: Record<string, unknown>,
  action: 'OPENED' | 'CLAIMED' | 'CLOSED' | 'REOPENED' | 'DELETED' | 'RENAMED',
  ticket: Record<string, unknown>,
  executor: { id: string; username?: string; tag?: string },
  transcriptLink?: string
): Promise<void> {
  const logChannelId = typeof guildConfig.ticketLogChannelId === 'string' ? guildConfig.ticketLogChannelId : null;
  if (!logChannelId) return;

  const logChannel = client.channels.cache.get(logChannelId);
  if (!logChannel || !(logChannel instanceof TextChannel)) return;

  const embed = new EmbedBuilder()
    .setTimestamp()
    .setFooter({ text: `Kotbo · Ticket ID: ${ticket.id}` });

  switch (action) {
    case 'OPENED':
      embed
        .setTitle('🎫 Nouveau Ticket Créé')
        .setDescription(`Le ticket <#${ticket.channelId}> a été ouvert.`)
        .setColor(COLORS.success as ColorResolvable)
        .addFields([
          { name: 'Type', value: String(ticket.ticketTypeLabel ?? ticket.ticketTypeId ?? 'Ticket standard'), inline: true },
          { name: 'Créateur', value: `<@${ticket.userId}> (${ticket.username})`, inline: true },
          { name: 'Raison', value: String(ticket.reason ?? '-'), inline: true },
          { name: 'Description', value: String(ticket.description ?? '-') }
        ]);
      break;

    case 'CLAIMED':
      embed
        .setTitle('🛠️ Ticket Pris en Charge')
        .setDescription(`Le ticket <#${ticket.channelId}> a été pris en charge par <@${executor.id}>.`)
        .setColor(COLORS.warning as ColorResolvable)
        .addFields([
          { name: 'Créateur', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Staff', value: `<@${executor.id}>`, inline: true }
        ]);
      break;

    case 'CLOSED':
      embed
        .setTitle('🔒 Ticket Fermé')
        .setDescription(`Le ticket <#${ticket.channelId}> a été fermé par <@${executor.id}>.`)
        .setColor(COLORS.danger as ColorResolvable)
        .addFields([
          { name: 'Créateur', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Fermé par', value: `<@${executor.id}>`, inline: true }
        ]);
      break;

    case 'REOPENED':
      embed
        .setTitle('🔓 Ticket Réouvert')
        .setDescription(`Le ticket <#${ticket.channelId}> a été réouvert par <@${executor.id}>.`)
        .setColor(COLORS.primary as ColorResolvable)
        .addFields([
          { name: 'Créateur', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Réouvert par', value: `<@${executor.id}>`, inline: true }
        ]);
      break;

    case 'DELETED':
      embed
        .setTitle('🗑️ Ticket Supprimé')
        .setDescription(`Le ticket ouvert par **${ticket.username}** a été définitivement supprimé par <@${executor.id}>.`)
        .setColor(0x000000)
        .addFields([
          { name: 'Créateur', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Supprimé par', value: `<@${executor.id}>`, inline: true }
        ]);

      if (transcriptLink) {
        embed.addFields([{ name: 'Transcription publique', value: `🌐 [Consulter le transcript](${transcriptLink})` }]);
      }
      break;

    case 'RENAMED':
      embed
        .setTitle('✏️ Ticket Renommé')
        .setDescription(`Le ticket <#${ticket.channelId}> a été renommé en **#${transcriptLink || 'inconnu'}** par <@${executor.id}>.`)
        .setColor(COLORS.primary as ColorResolvable)
        .addFields([
          { name: 'Créateur', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Renommé par', value: `<@${executor.id}>`, inline: true }
        ]);
      break;
  }

  try {
    await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    logger.error('Ticket', 'Error sending to ticket log channel:', err);
  }
}

/**
 * Finds the initial welcome message of a ticket.
 */
export async function findTicketWelcomeMessage(
  channel: TextChannel | ThreadChannel,
  ticketId: string
): Promise<Message | null> {
  try {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return null;
    const marker = `Ticket ID: ${ticketId}`;

    return messages.find(msg => {
      if (!msg.author.bot) return false;

      for (const component of msg.components as unknown[]) {
        const c = component as { type: ComponentType; content?: string; components?: { type: ComponentType; content?: string }[] };
        if (c.type === ComponentType.TextDisplay && c.content?.includes(marker)) return true;
        if (c.type === ComponentType.Container && c.components) {
          for (const nested of c.components) {
            if (nested.type === ComponentType.TextDisplay && nested.content?.includes(marker)) return true;
          }
        }
      }
      return false;
    }) || null;
  } catch (err) {
    logger.error('Ticket', `Error finding welcome message for ticket ${ticketId}:`, err);
    return null;
  }
}

export async function closeTicket(
  client: Client,
  ticketId: string,
  closedByUserId: string,
  closedByUsername: string
): Promise<any> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId }
  });
  if (!ticket || ticket.status === 'CLOSED') return ticket || null;

  const guildConfig = await prisma.guild.findUnique({
    where: { id: ticket.guildId }
  });
  if (!guildConfig) return null;

  // Mettre à jour en BDD
  const updatedTicket = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: 'CLOSED',
      closedById: closedByUserId,
      closedByName: closedByUsername,
      closedAt: new Date()
    }
  });

  const channelId = ticket.channelId || ticket.threadId;
  if (channelId) {
    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
    if (channel && (channel instanceof TextChannel || channel.isThread())) {
      const ticketChannel = channel as TextChannel;
      // Rename channel
      await renameChannelToClosed(client, ticketChannel.id).catch(() => null);

      // Retirer les permissions d'écriture et lecture de l'opener
      try {
        if (ticketChannel.permissionOverwrites && typeof ticketChannel.permissionOverwrites.edit === 'function') {
          await ticketChannel.permissionOverwrites.edit(ticket.userId, {
            ViewChannel: false,
            SendMessages: false
          });
        }
      } catch (err) {
        logger.error('Ticket', 'Error removing opener permissions from closed channel:', err);
      }

      // Mettre à jour le container V2 du message de bienvenue s'il existe
      try {
        const welcomeMessage = await findTicketWelcomeMessage(ticketChannel, ticketId);
        if (welcomeMessage) {
          const bodyText = `Ce ticket a été fermé par <@${closedByUserId}>.\n\n**Auteur :** <@${ticket.userId}>\n**Raison :** ${ticket.reason}\n**Description :** ${ticket.description}`;
          const updatedContainer = buildTicketStatusContainer(ticket, bodyText, COLORS_RAW.danger);

          // Disable all button components carried over from the original message
          const disabledRows = welcomeMessage.components
            .filter((component: any) => component.type === ComponentType.ActionRow)
            .map((actionRow: any) => {
              const newRow = new ActionRowBuilder<ButtonBuilder>();
              for (const comp of actionRow.components) {
                if (comp.type === ComponentType.Button) {
                  newRow.addComponents(ButtonBuilder.from(comp as any).setDisabled(true));
                }
              }
              return newRow;
            })
            .filter((row: ActionRowBuilder<ButtonBuilder>) => row.components.length > 0);

          await welcomeMessage.edit({
            components: [updatedContainer, ...disabledRows],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [closedByUserId, ticket.userId] },
          }).catch(() => null);
        }
      } catch (err) {
        logger.error('Ticket', 'Error updating welcome message container on close:', err);
      }

      const closeEmbed = new EmbedBuilder()
        .setTitle('🔒 Ticket Fermé')
        .setDescription(`Le ticket a été fermé par <@${closedByUserId}>.\n\nLes membres du personnel peuvent maintenant exporter la transcription ou supprimer définitivement le salon.`)
        .setColor(COLORS.danger as ColorResolvable)
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`ticket:reopen:${ticketId}`).setLabel('Réouvrir').setStyle(ButtonStyle.Success).setEmoji('🔓'),
        new ButtonBuilder().setCustomId(`ticket:delete:${ticketId}`).setLabel('Supprimer').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
      );

      await ticketChannel.send({ embeds: [closeEmbed], components: [row], allowedMentions: { users: [closedByUserId] } }).catch(() => null);
    }
  }

  // Logger
  await logTicketEvent(client, guildConfig, 'CLOSED', updatedTicket, { id: closedByUserId, username: closedByUsername });

  // Satisfaction survey
  try {
    const { sendSatisfactionSurvey } = await import('./ticketSatisfactionService.js');
    await sendSatisfactionSurvey(client, ticket.guildId, ticketId, ticket.userId, ticket.claimedById ?? undefined);
  } catch (err) {
    logger.error('Ticket', 'Erreur envoi sondage satisfaction:', err);
  }

  return updatedTicket;
}

export async function renameChannelToClosed(client: Client, channelId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel && channel instanceof TextChannel) {
    const currentName = channel.name;
    const newName = currentName.startsWith('ticket-') ? currentName.replace(/^ticket-/, 'fermer-') : `fermer-${currentName}`;
    if (newName !== currentName) {
      await channel.setName(newName, 'Ticket fermé').catch((err) => 
        logger.error('Ticket', `Error renaming channel ${channelId} to closed:`, err)
      );
    }
  }
}

export async function renameChannelToOpen(client: Client, channelId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel && channel instanceof TextChannel) {
    const currentName = channel.name;
    const newName = currentName.startsWith('fermer-') ? currentName.replace(/^fermer-/, 'ticket-') : `ticket-${currentName}`;
    if (newName !== currentName) {
      await channel.setName(newName, 'Ticket réouvert').catch((err) => 
        logger.error('Ticket', `Error renaming channel ${channelId} to open:`, err)
      );
    }
  }
}

/**
 * Checks open tickets for inactivity and sends automated warnings if configured.
 */
export async function checkTicketInactivity(client: Client): Promise<void> {
  try {
    const guilds = await prisma.guild.findMany({
      where: { ticketInactivityEnabled: true },
      select: {
        id: true,
        ticketInactivityHours: true,
        ticketInactivityMessage: true,
      },
    });

    for (const guildConfig of guilds) {
      // La relance d'inactivité continuerait de tomber dans des tickets d'un
      // serveur qui a éteint le module.
      if (!(await isModuleEnabled(guildConfig.id, 'tickets'))) continue;

      const activeTickets = await prisma.ticket.findMany({
        where: {
          guildId: guildConfig.id,
          status: { in: ['OPEN', 'CLAIMED'] },
          channelId: { not: null },
          inactivityAlertSent: false,
        },
      });

      const inactivityTimeMs = guildConfig.ticketInactivityHours * 60 * 60 * 1000;

      // Resolue une fois par serveur, et avec la langue declaree du serveur
      // Discord : sans elle, la cascade saute a son repli qui est l'anglais, et
      // un serveur francais reste en detection automatique recevrait une
      // relance anglaise au milieu de messages francais.
      const discordGuild = client.guilds.cache.get(guildConfig.id);
      const locale = await resolveGuildLocale(guildConfig.id, discordGuild?.preferredLocale ?? null);

      for (const ticket of activeTickets) {
        if (!ticket.channelId) continue;

        const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
        if (!channel || !(channel instanceof TextChannel)) continue;

        const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
        const lastMessage = messages?.first();

        let lastActivityTimestamp = ticket.createdAt.getTime();
        let shouldAlert = false;

        if (lastMessage) {
          // Si le dernier message a été envoyé par le créateur, on n'alerte pas
          if (lastMessage.author.id === ticket.userId) {
            continue;
          }
          lastActivityTimestamp = lastMessage.createdTimestamp;
        }

        if (Date.now() - lastActivityTimestamp > inactivityTimeMs) {
          shouldAlert = true;
        }

        if (shouldAlert) {
          // Formater le message d'inactivité
          const userMention = `<@${ticket.userId}>`;
          const rawMessage = guildConfig.ticketInactivityMessage?.trim()
            || ticketDefaultTexts(locale).ticketInactivityMessage;
          const formattedMessage = rawMessage.replace(/{user}/g, userMention);

          await channel.send({ content: formattedMessage }).catch(() => null);

          await prisma.ticket.update({
            where: { id: ticket.id },
            data: { inactivityAlertSent: true },
          });

          logger.info('Ticket', `Alerte d'inactivité envoyée dans le ticket ${ticket.id} (${ticket.channelId})`);
        }
      }
    }
  } catch (err) {
    logger.error('Ticket', "Erreur lors de la vérification de l'inactivité des tickets:", err);
  }
}

async function setupInteractiveTicketQuestions(
  client: Client,
  channel: any,
  userId: string,
  ticketType: any,
  guildConfig: any
): Promise<void> {
  const customFields = ((ticketType as any).formCustomFields ?? guildConfig.ticketFormCustomFields) as any[];
  if (!Array.isArray(customFields)) return;

  const postFields = customFields.filter((f: any) => f.style === 'SELECT' || f.style === 'RADIO' || f.style === 'FILE');
  if (postFields.length === 0) return;

  for (const f of postFields) {
    try {
      if (f.style === 'SELECT') {
        const choices = Array.isArray(f.choices) ? f.choices : [];
        if (choices.length === 0) continue;

        const select = new StringSelectMenuBuilder()
          .setCustomId(`ticket:question:select:${f.id}`)
          .setPlaceholder(f.placeholder || 'Sélectionnez une option...')
          .addOptions(choices.map((c: string) => ({ label: c.substring(0, 100), value: c })));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
        const msg = await channel.send({
          content: `<@${userId}> ❓ **${f.label}**`,
          components: [row]
        });

        const filter = (i: any) => i.customId === `ticket:question:select:${f.id}` && i.user.id === userId;
        const collected = await msg.awaitMessageComponent({ filter, time: 300000 }).catch(() => null);

        if (collected && collected.isStringSelectMenu()) {
          const value = collected.values[0];
          await collected.update({
            content: `✅ **${f.label}** : **${value}**`,
            components: []
          });
        } else {
          await msg.edit({
            content: `❌ **${f.label}** (Pas de réponse)`,
            components: []
          }).catch(() => null);
        }
      } else if (f.style === 'RADIO') {
        const choices = Array.isArray(f.choices) ? f.choices : [];
        if (choices.length === 0) continue;

        const buttons = choices.slice(0, 5).map((c: string, idx: number) => {
          return new ButtonBuilder()
            .setCustomId(`ticket:question:radio:${f.id}:${idx}`)
            .setLabel(c.substring(0, 80))
            .setStyle(ButtonStyle.Secondary);
        });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
        const msg = await channel.send({
          content: `<@${userId}> ❓ **${f.label}**`,
          components: [row]
        });

        const filter = (i: any) => i.customId.startsWith(`ticket:question:radio:${f.id}:`) && i.user.id === userId;
        const collected = await msg.awaitMessageComponent({ filter, time: 300000 }).catch(() => null);

        if (collected && collected.isButton()) {
          const clickedLabel = choices[parseInt(collected.customId.split(':')[4])];
          await collected.update({
            content: `✅ **${f.label}** : **${clickedLabel}**`,
            components: []
          });
        } else {
          await msg.edit({
            content: `❌ **${f.label}** (Pas de réponse)`,
            components: []
          }).catch(() => null);
        }
      } else if (f.style === 'FILE') {
        const msg = await channel.send({
          content: `<@${userId}> 📎 **${f.label}** : Veuillez glisser-déposer votre fichier ou image dans ce salon.`
        });

        const filter = (candidate: Message) => candidate.author.id === userId && candidate.attachments.size > 0;
        const collected = await channel.awaitMessages({ filter, max: 1, time: 300000 }).catch(() => null);

        if (collected && collected.first()) {
          const firstMsg = collected.first()!;
          const attachment = firstMsg.attachments.first()!;
          await msg.edit({
            content: `✅ **${f.label}** : Fichier joint reçu [${attachment.name}](${attachment.url})`
          });
        } else {
          await msg.edit({
            content: `❌ **${f.label}** (Pas de fichier reçu)`
          }).catch(() => null);
        }
      }
    } catch (err) {
      logger.error('Ticket', 'Error rendering interactive question:', err);
    }
  }
}

