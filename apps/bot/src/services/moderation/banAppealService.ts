// ============================================================================
// APPELS DE BANNISSEMENT (modèle appeals.gg)
// Page publique → OAuth Discord → vérif du ban réel → formulaire d'appel →
// review dashboard + embed staff Discord synchronisés → unban/DM automatiques.
// ============================================================================

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type ModalSubmitInteraction,
} from 'discord.js';
import prisma from '../../utils/db.js';
import { Prisma , BanAppealStatus } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { INVITE_SOURCE, recordBotInvite } from '../analytics/inviteService.js';

const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'http://localhost:5173').replace(/\/+$/, '');

export type AppealDecision = 'ACCEPTED' | 'DENIED' | 'DENIED_PERMANENT';

export type AppealConfigInput = {
  enabled?: boolean;
  formId?: string | null;
  staffChannelId?: string | null;
  inviteChannelId?: string | null;
  cooldownDays?: number;
  welcomeText?: string | null;
  acceptMessage?: string | null;
  denyMessage?: string | null;
  notifyOnBanDM?: boolean;
  appealVerification?: boolean;
  appealSaveIp?: boolean;
  appealSaveDevice?: boolean;
  appealVerificationLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
};

const DEFAULT_ACCEPT_MESSAGE =
  'Bonne nouvelle ! Ta demande de débannissement sur **{server}** a été acceptée. Tu peux revenir avec cette invitation : {invite}';
const DEFAULT_DENY_MESSAGE =
  'Ta demande de débannissement sur **{server}** a été refusée.\nRaison : {reason}';

// ============================================================================
// CONFIGURATION
// ============================================================================

export async function getAppealConfig(guildId: string) {
  return prisma.banAppealConfig.findUnique({
    where: { guildId },
    include: { form: { select: { id: true, name: true, structure: true, theme: true, customCss: true } } },
  });
}

export async function upsertAppealConfig(guildId: string, data: AppealConfigInput) {
  return prisma.banAppealConfig.upsert({
    where: { guildId },
    create: { guildId, ...data },
    update: data,
  });
}

/**
 * Crée le formulaire d'appel par défaut (modifiable ensuite dans le builder)
 * et le lie à la config si aucun formulaire n'est configuré.
 */
export async function ensureDefaultAppealForm(guildId: string): Promise<string> {
  const existing = await getAppealConfig(guildId);
  if (existing?.formId) return existing.formId;

  const form = await prisma.customForm.create({
    data: {
      guildId,
      name: "Demande de débannissement",
      description: "Formulaire d'appel pour les membres bannis définitivement.",
      requiresDiscordAuth: true,
      structure: {
        title: 'Demande de débannissement',
        description: 'Réponds honnêtement : les réponses copiées-collées ou vides sont refusées.',
        fields: [
          { id: 'appeal_why_banned', type: 'paragraph', label: 'Pourquoi as-tu été banni, selon toi ?', required: true, sectionIndex: 0 },
          { id: 'appeal_why_unban', type: 'paragraph', label: 'Pourquoi devrions-nous te débannir ?', required: true, sectionIndex: 0 },
          { id: 'appeal_changed', type: 'paragraph', label: 'Qu\'est-ce qui a changé / que feras-tu différemment ?', required: true, sectionIndex: 0 },
          { id: 'appeal_extra', type: 'paragraph', label: 'Informations complémentaires (optionnel)', required: false, sectionIndex: 0 },
        ],
      } as unknown as Prisma.InputJsonValue,
    },
  });

  await upsertAppealConfig(guildId, { formId: form.id });
  return form.id;
}

// ============================================================================
// ÉLIGIBILITÉ
// ============================================================================

async function fetchGuild(client: Client, guildId: string): Promise<Guild | null> {
  return client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
}

export async function fetchBanInfo(client: Client, guildId: string, userId: string) {
  const guild = await fetchGuild(client, guildId);
  if (!guild) return { banned: false as const, reason: null };
  const ban = await guild.bans.fetch(userId).catch(() => null);
  return ban ? { banned: true as const, reason: ban.reason ?? null } : { banned: false as const, reason: null };
}

export type AppealEligibility =
  | { eligible: true; banReason: string | null }
  | { eligible: false; blockedBy: 'not_banned' | 'blacklisted' | 'active_appeal' | 'cooldown'; cooldownEndsAt?: string };

export async function getAppealEligibility(client: Client, guildId: string, userId: string): Promise<AppealEligibility> {
  const blacklisted = await prisma.banAppealBlacklist.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (blacklisted) return { eligible: false, blockedBy: 'blacklisted' };

  const lastAppeal = await prisma.banAppeal.findFirst({
    where: { guildId, userId },
    orderBy: { createdAt: 'desc' },
  });

  if (lastAppeal && (lastAppeal.status === 'PENDING' || lastAppeal.status === 'NEEDS_INFO')) {
    return { eligible: false, blockedBy: 'active_appeal' };
  }

  if (lastAppeal?.status === 'DENIED_PERMANENT') {
    return { eligible: false, blockedBy: 'blacklisted' };
  }

  if (lastAppeal?.status === 'DENIED' && lastAppeal.decidedAt) {
    const config = await getAppealConfig(guildId);
    const cooldownDays = config?.cooldownDays ?? 30;
    const endsAt = new Date(lastAppeal.decidedAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
    if (endsAt > new Date()) {
      return { eligible: false, blockedBy: 'cooldown', cooldownEndsAt: endsAt.toISOString() };
    }
  }

  const ban = await fetchBanInfo(client, guildId, userId);
  if (!ban.banned) return { eligible: false, blockedBy: 'not_banned' };

  return { eligible: true, banReason: ban.reason };
}

// ============================================================================
// SOUMISSION
// ============================================================================

export async function submitAppeal(
  client: Client,
  guildId: string,
  user: { id: string; tag?: string; avatar?: string | null },
  data: Record<string, unknown>
) {
  const eligibility = await getAppealEligibility(client, guildId, user.id);
  if (!eligibility.eligible) {
    return { ok: false as const, blockedBy: eligibility.blockedBy };
  }

  const config = await getAppealConfig(guildId);

  const appeal = await prisma.banAppeal.create({
    data: {
      guildId,
      userId: user.id,
      userTag: user.tag ?? null,
      avatar: user.avatar ?? null,
      data: data as Prisma.InputJsonValue,
      formId: config?.formId ?? null,
      banReason: eligibility.banReason,
      status: 'PENDING',
    },
  });

  await postStaffEmbed(client, appeal, config).catch(err =>
    logger.error('BanAppeal', `Failed to post staff embed for appeal ${appeal.id}:`, err)
  );

  return { ok: true as const, appeal };
}

// ============================================================================
// EMBED STAFF + BOUTONS
// ============================================================================

const STATUS_META: Record<string, { label: string; color: number; emoji: string }> = {
  PENDING: { label: 'En attente', color: 0xf59e0b, emoji: '⏳' },
  NEEDS_INFO: { label: "En attente d'infos du membre", color: 0x3b82f6, emoji: '💬' },
  ACCEPTED: { label: 'Accepté', color: 0x22c55e, emoji: '✅' },
  DENIED: { label: 'Refusé', color: 0xef4444, emoji: '❌' },
  DENIED_PERMANENT: { label: 'Refusé définitivement', color: 0x7f1d1d, emoji: '⛔' },
};

type AppealRecord = {
  id: string;
  guildId: string;
  userId: string;
  userTag: string | null;
  data: unknown;
  status: string;
  banReason: string | null;
  infoRequest: string | null;
  infoResponse: string | null;
  decidedByTag: string | null;
  decisionReason: string | null;
  staffChannelId: string | null;
  staffMessageId: string | null;
  createdAt: Date;
  messages?: any;
};

function buildAppealEmbed(appeal: AppealRecord): EmbedBuilder {
  const meta = STATUS_META[appeal.status] ?? STATUS_META.PENDING;
  const answers = (appeal.data ?? {}) as Record<string, unknown>;

  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} Demande de débannissement - ${appeal.userTag || appeal.userId}`)
    .setColor(meta.color)
    .setDescription(
      [
        `**Membre :** <@${appeal.userId}> (\`${appeal.userId}\`)`,
        `**Raison du ban :** ${appeal.banReason || '_Non renseignée_'}`,
        `**Statut :** ${meta.label}`,
      ].join('\n')
    )
    .setTimestamp(appeal.createdAt)
    .setFooter({ text: `Appel ID: ${appeal.id}` });

  let fieldCount = 0;
  for (const [key, value] of Object.entries(answers)) {
    if (fieldCount >= 20) break;
    const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    if (!text.trim()) continue;
    embed.addFields({
      name: key.replace(/^appeal_/, '').replace(/_/g, ' ').slice(0, 250) || 'Réponse',
      value: text.slice(0, 1000),
    });
    fieldCount++;
  }

  if (appeal.infoRequest) {
    embed.addFields({ name: '💬 Infos demandées', value: appeal.infoRequest.slice(0, 1000) });
  }
  if (appeal.infoResponse) {
    embed.addFields({ name: '↩️ Réponse du membre', value: appeal.infoResponse.slice(0, 1000) });
  }
  if (appeal.decisionReason) {
    embed.addFields({ name: '📝 Décision', value: `${appeal.decisionReason.slice(0, 900)}\n- ${appeal.decidedByTag || 'staff'}` });
  }

  return embed;
}

function buildAppealButtons(appealId: string, status: string): ActionRowBuilder<ButtonBuilder>[] {
  const decided = status === 'ACCEPTED' || status === 'DENIED' || status === 'DENIED_PERMANENT';
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`appeal:accept:${appealId}`).setLabel('Accepter').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(decided),
    new ButtonBuilder().setCustomId(`appeal:deny:${appealId}`).setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(decided),
    new ButtonBuilder().setCustomId(`appeal:permdeny:${appealId}`).setLabel('Refus définitif').setEmoji('⛔').setStyle(ButtonStyle.Danger).setDisabled(decided),
    new ButtonBuilder().setCustomId(`appeal:info:${appealId}`).setLabel("Plus d'infos").setEmoji('💬').setStyle(ButtonStyle.Secondary).setDisabled(decided),
    new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(`${DASHBOARD_URL}/appeals`)
  );
  return [row];
}

// Le salon staff peut vivre sur un serveur staff dédié lié (StaffServerLink),
// pas seulement sur le serveur principal : on résout via le cache global des
// salons du client plutôt que via guild.channels (limité à un seul serveur).
async function fetchStaffChannel(client: Client, channelId: string) {
  return client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
}

async function postStaffEmbed(client: Client, appeal: AppealRecord, config: { staffChannelId?: string | null } | null) {
  if (!config?.staffChannelId) return;
  const channel = await fetchStaffChannel(client, config.staffChannelId);
  if (!channel?.isSendable()) return;

  const message = await channel.send({
    embeds: [buildAppealEmbed(appeal)],
    components: buildAppealButtons(appeal.id, appeal.status),
  });

  await prisma.banAppeal.update({
    where: { id: appeal.id },
    data: { staffChannelId: channel.id, staffMessageId: message.id },
  });
}

export async function refreshStaffEmbed(client: Client, appeal: AppealRecord) {
  if (!appeal.staffChannelId || !appeal.staffMessageId) return;
  try {
    const channel = await fetchStaffChannel(client, appeal.staffChannelId);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(appeal.staffMessageId).catch(() => null);
    if (!message) return;
    await message.edit({
      embeds: [buildAppealEmbed(appeal)],
      components: buildAppealButtons(appeal.id, appeal.status),
    });
  } catch (err) {
    logger.warn('BanAppeal', `Could not refresh staff embed for appeal ${appeal.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================================
// DÉCISION
// ============================================================================

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => vars[key] ?? `{${key}}`);
}

export async function createReturnInvite(client: Client, guildId: string, inviteChannelId?: string | null): Promise<string | null> {
  const guild = await fetchGuild(client, guildId);
  if (!guild) return null;

  const me = guild.members.me;
  const candidates = [
    inviteChannelId ? guild.channels.cache.get(inviteChannelId) : null,
    guild.rulesChannel,
    guild.systemChannel,
    ...guild.channels.cache
      .filter(c => c.isTextBased() && !c.isThread() && !!me && c.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite))
      .values(),
  ];

  for (const channel of candidates) {
    if (!channel || channel.isThread() || !('createInvite' in channel)) continue;
    const invite = await channel
      .createInvite({ maxAge: 7 * 24 * 60 * 60, maxUses: 1, unique: true, reason: 'Appel de bannissement accepté' })
      .catch(() => null);
    if (invite) {
      await recordBotInvite(invite, INVITE_SOURCE.banAppeal());
      return invite.url;
    }
  }
  return null;
}

export async function sendMemberDM(client: Client, userId: string, content: string): Promise<boolean> {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ content });
    return true;
  } catch {
    return false;
  }
}

/**
 * Envoie au membre le lien public de l'appel de bannissement par DM, si la
 * configuration l'active. À appeler AVANT d'exécuter le ban Discord (une fois
 * banni, l'utilisateur peut ne plus partager de serveur avec le bot et le DM
 * échouera silencieusement selon ses réglages de confidentialité).
 */
export async function sendBanAppealNotificationDM(client: Client, guildId: string, userId: string): Promise<boolean> {
  const config = await getAppealConfig(guildId);
  if (!config?.enabled || !config?.notifyOnBanDM) return false;

  const guild = await fetchGuild(client, guildId);
  const serverName = guild?.name || 'ce serveur';
  const link = `${DASHBOARD_URL}/appeal/${guildId}`;

  return sendMemberDM(
    client,
    userId,
    `Tu as été banni définitivement de **${serverName}**.\n\nSi tu penses qu'il s'agit d'une erreur, tu peux soumettre une demande de débannissement ici : ${link}`
  );
}

export async function decideAppeal(
  client: Client,
  params: {
    appealId: string;
    guildId: string;
    decision: AppealDecision;
    staffUserId: string;
    staffTag?: string;
    reason?: string;
  }
) {
  const appeal = await prisma.banAppeal.findFirst({
    where: { id: params.appealId, guildId: params.guildId },
  });
  if (!appeal) return { ok: false as const, error: 'Appel introuvable' };
  if (appeal.status === 'ACCEPTED' || appeal.status === 'DENIED' || appeal.status === 'DENIED_PERMANENT') {
    return { ok: false as const, error: 'Cet appel a déjà été tranché' };
  }

  const config = await getAppealConfig(params.guildId);
  const guild = await fetchGuild(client, params.guildId);
  const serverName = guild?.name || 'ce serveur';

  let dmDelivered = false;

  if (params.decision === 'ACCEPTED') {
    if (config?.appealVerification) {
      // 1. Résoudre les sanctions BAN actives correspondantes
      await prisma.sanction.updateMany({
        where: { guildId: params.guildId, targetUserId: appeal.userId, type: 'BAN', status: 'ACTIVE' },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolutionNote: `Appel de bannissement accepté par ${params.staffTag || params.staffUserId} (En attente de vérification OAuth)`,
        },
      }).catch(err => logger.warn('BanAppeal', 'Could not resolve linked sanctions:', err));

      // 2. Créer la session de vérification et envoyer le lien par DM
      const { createVerificationSession, buildVerificationUrl } = await import('./securityVerificationService.js');
      const token = await createVerificationSession(
        params.guildId,
        appeal.userId,
        (config as any).appealVerificationLevel || 'HIGH',
        appeal.id
      );
      const verifyUrl = buildVerificationUrl(DASHBOARD_URL, params.guildId, token);
      const message = `Bonne nouvelle ! Ta demande de débannissement sur **${serverName}** a été acceptée par le staff.\n\nPour pouvoir rejoindre le serveur, tu dois d'abord authentifier ton compte en complétant la vérification de sécurité en cliquant sur ce lien : ${verifyUrl}`;
      dmDelivered = await sendMemberDM(client, appeal.userId, message);
    } else {
      // 1. Unban via l'API Discord
      if (guild) {
        await guild.members
          .unban(appeal.userId, `Appel accepté par ${params.staffTag || params.staffUserId}`)
          .catch(err => logger.warn('BanAppeal', `Unban failed for ${appeal.userId}: ${err instanceof Error ? err.message : String(err)}`));
      }

      // 2. Résoudre les sanctions BAN actives correspondantes
      await prisma.sanction.updateMany({
        where: { guildId: params.guildId, targetUserId: appeal.userId, type: 'BAN', status: 'ACTIVE' },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolutionNote: `Appel de bannissement accepté par ${params.staffTag || params.staffUserId}`,
        },
      }).catch(err => logger.warn('BanAppeal', 'Could not resolve linked sanctions:', err));

      // 3. Invitation fraîche + DM
      const inviteUrl = await createReturnInvite(client, params.guildId, config?.inviteChannelId);
      const message = renderTemplate(config?.acceptMessage || DEFAULT_ACCEPT_MESSAGE, {
        server: serverName,
        invite: inviteUrl || '(invitation indisponible - contacte un membre du staff)',
        reason: params.reason || '',
      });
      dmDelivered = await sendMemberDM(client, appeal.userId, message);
    }
  } else {
    if (params.decision === 'DENIED_PERMANENT') {
      await prisma.banAppealBlacklist.upsert({
        where: { guildId_userId: { guildId: params.guildId, userId: appeal.userId } },
        create: {
          guildId: params.guildId,
          userId: appeal.userId,
          reason: params.reason || 'Refus définitif de l\'appel',
          addedByUserId: params.staffUserId,
          addedByTag: params.staffTag ?? null,
        },
        update: { reason: params.reason || 'Refus définitif de l\'appel' },
      });
    }

    const denyBase = renderTemplate(config?.denyMessage || DEFAULT_DENY_MESSAGE, {
      server: serverName,
      reason: params.reason || 'Non communiquée',
      invite: '',
    });
    const cooldownDays = config?.cooldownDays ?? 30;
    const suffix =
      params.decision === 'DENIED_PERMANENT'
        ? '\n\n⛔ Cette décision est définitive : aucun nouvel appel ne sera accepté.'
        : `\n\nTu pourras soumettre un nouvel appel dans ${cooldownDays} jours : ${DASHBOARD_URL}/appeal/${params.guildId}`;
    dmDelivered = await sendMemberDM(client, appeal.userId, denyBase + suffix);
  }

  const updated = await prisma.banAppeal.update({
    where: { id: appeal.id },
    data: {
      status: params.decision,
      decidedByUserId: params.staffUserId,
      decidedByTag: params.staffTag ?? null,
      decisionReason: params.reason ?? null,
      decidedAt: new Date(),
      dmDelivered,
    },
  });

  await refreshStaffEmbed(client, updated);
  return { ok: true as const, appeal: updated };
}

export async function requestAppealInfo(
  client: Client,
  params: { appealId: string; guildId: string; question: string; staffUserId: string; staffTag?: string }
) {
  const appeal = await (prisma.banAppeal as any).findFirst({
    where: { id: params.appealId, guildId: params.guildId },
  });
  if (!appeal) return { ok: false as const, error: 'Appel introuvable' };
  if (appeal.status !== 'PENDING' && appeal.status !== 'NEEDS_INFO') {
    return { ok: false as const, error: 'Cet appel a déjà été tranché' };
  }

  const currentMessages = Array.isArray((appeal as any).messages) ? ((appeal as any).messages as any[]) : [];
  const newMessages = [
    ...currentMessages,
    {
      author: 'staff',
      authorTag: params.staffTag || 'staff',
      authorId: params.staffUserId,
      content: params.question,
      createdAt: new Date().toISOString(),
    },
  ];

  const updated = await (prisma.banAppeal as any).update({
    where: { id: appeal.id },
    data: {
      status: 'NEEDS_INFO',
      infoRequest: params.question,
      infoResponse: null,
      infoRequestedAt: new Date(),
      messages: newMessages as any,
    },
  });

  const guild = await fetchGuild(client, params.guildId);
  await sendMemberDM(
    client,
    appeal.userId,
    `Le staff de **${guild?.name || 'ce serveur'}** a besoin de plus d'informations sur ta demande de débannissement :\n> ${params.question}\n\nRéponds ici : ${DASHBOARD_URL}/appeal/${params.guildId}`
  );

  await refreshStaffEmbed(client, updated);
  return { ok: true as const, appeal: updated };
}

export async function submitAppealInfoResponse(client: Client, guildId: string, userId: string, response: string) {
  const appeal = await (prisma.banAppeal as any).findFirst({
    where: { guildId, userId, status: 'NEEDS_INFO' },
    orderBy: { createdAt: 'desc' },
  });
  if (!appeal) return { ok: false as const, error: "Aucune demande d'informations en attente" };

  const currentMessages = Array.isArray((appeal as any).messages) ? ((appeal as any).messages as any[]) : [];
  const newMessages = [
    ...currentMessages,
    {
      author: 'user',
      content: response.slice(0, 2000),
      createdAt: new Date().toISOString(),
    },
  ];

  const updated = await (prisma.banAppeal as any).update({
    where: { id: appeal.id },
    data: {
      status: 'PENDING',
      infoResponse: response.slice(0, 2000),
      messages: newMessages as any,
    },
  });

  await refreshStaffEmbed(client, updated);
  return { ok: true as const, appeal: updated };
}

// ============================================================================
// LECTURE (dashboard)
// ============================================================================

export async function getAppeals(guildId: string, status?: BanAppealStatus) {
  return prisma.banAppeal.findMany({
    where: { guildId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function getAppealDetail(appealId: string, guildId: string) {
  const appeal = await prisma.banAppeal.findFirst({ where: { id: appealId, guildId } });
  if (!appeal) return null;

  const sanctions = await prisma.sanction.findMany({
    where: { guildId, targetUserId: appeal.userId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, type: true, status: true, reason: true, createdAt: true, moderatorTag: true },
  });

  const previousAppeals = await prisma.banAppeal.findMany({
    where: { guildId, userId: appeal.userId, id: { not: appealId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, createdAt: true, decidedAt: true, decisionReason: true },
  });

  return { appeal, sanctions, previousAppeals };
}

// ============================================================================
// INTERACTIONS DISCORD (boutons + modals du salon staff)
// ============================================================================

function hasDecisionPermission(interaction: ButtonInteraction | ModalSubmitInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers) ?? false;
}

export async function handleAppealButton(client: Client, customId: string, interaction: ButtonInteraction) {
  const [, action, appealId] = customId.split(':');
  if (!appealId) return;

  if (!hasDecisionPermission(interaction)) {
    await interaction.reply({
      content: '❌ Tu dois avoir la permission **Bannir des membres** pour traiter un appel.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const titles: Record<string, string> = {
    accept: "Accepter l'appel",
    deny: "Refuser l'appel",
    permdeny: 'Refus définitif (blacklist)',
    info: "Demander plus d'infos",
  };
  const title = titles[action];
  if (!title) return;

  const input = new TextInputBuilder()
    .setCustomId('appeal_input')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000);

  if (action === 'info') {
    input.setLabel('Question à poser au membre').setRequired(true).setPlaceholder('Ex: Peux-tu préciser ce qui s\'est passé le soir du ban ?');
  } else if (action === 'accept') {
    input.setLabel('Note (optionnelle)').setRequired(false).setPlaceholder('Visible par le membre dans le DM de verdict.');
  } else {
    input.setLabel('Raison du refus').setRequired(true).setPlaceholder('Communiquée au membre par DM.');
  }

  const modal = new ModalBuilder()
    .setCustomId(`appeal_modal:${action}:${appealId}`)
    .setTitle(title.slice(0, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

  await interaction.showModal(modal);
}

export async function handleAppealModalSubmit(client: Client, customId: string, interaction: ModalSubmitInteraction) {
  const [, action, appealId] = customId.split(':');
  if (!appealId || !interaction.guildId) return;

  if (!hasDecisionPermission(interaction)) {
    await interaction.reply({ content: '❌ Permission insuffisante.', flags: [MessageFlags.Ephemeral] });
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const text = interaction.fields.getTextInputValue('appeal_input') || undefined;

  let result: { ok: boolean; error?: string };
  if (action === 'info') {
    result = await requestAppealInfo(client, {
      appealId,
      guildId: interaction.guildId,
      question: text || '',
      staffUserId: interaction.user.id,
      staffTag: interaction.user.tag,
    });
  } else {
    const decision: AppealDecision = action === 'accept' ? 'ACCEPTED' : action === 'permdeny' ? 'DENIED_PERMANENT' : 'DENIED';
    result = await decideAppeal(client, {
      appealId,
      guildId: interaction.guildId,
      decision,
      staffUserId: interaction.user.id,
      staffTag: interaction.user.tag,
      reason: text,
    });
  }

  if (!result.ok) {
    await interaction.editReply({ content: `❌ ${result.error || 'Action impossible'}` });
    return;
  }

  const confirmations: Record<string, string> = {
    accept: '✅ Appel accepté : le membre a été débanni et prévenu par DM.',
    deny: '❌ Appel refusé, le membre a été prévenu par DM.',
    permdeny: '⛔ Appel refusé définitivement : le membre ne pourra plus faire appel.',
    info: '💬 Demande d\'informations envoyée au membre.',
  };
  await interaction.editReply({ content: confirmations[action] || '✅ Fait.' });
}
