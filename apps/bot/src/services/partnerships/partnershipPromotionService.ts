/**
 * Publicités partenaires : publication, rotation, vitrine, et contrôle que
 * l'autre tient sa part.
 *
 * Le module ne poste que ce qu'un membre du staff a validé - le contenu vient
 * d'un partenaire, donc d'une source non fiable. Il est nettoyé ici avant tout
 * envoi : mentions neutralisées, images en `https` seulement, longueurs
 * bornées. Un partenaire ne doit pas pouvoir faire mentionner `@everyone` par
 * le bot du serveur qui l'héberge.
 *
 * ── Ce que « vérifier la réciprocité » veut dire ────────────────────────────
 *
 * Trois situations, par ordre de fiabilité décroissante :
 *   - les deux serveurs ont Kotbo et un pont confirmé : on lit l'état du
 *     dossier d'en face, c'est direct et sûr ;
 *   - le bot est présent sur le serveur partenaire (invité pour cela) : il
 *     regarde le salon convenu ;
 *   - ni l'un ni l'autre : le contrôle est marqué injoignable, et n'est jamais
 *     compté comme un manquement. Accuser faute d'avoir pu regarder serait la
 *     pire des mesures.
 */
import { ChannelType, EmbedBuilder, type Client, type TextChannel } from 'discord.js';
import type { PartnershipPromotion } from '@prisma/client';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getClient } from '../../utils/client.js';
import { getPartnershipSettings } from './partnershipSettings.js';
import { recordPartnershipEvent } from './partnershipEvents.js';
import { bumpDailyMetric } from './partnershipAttributionService.js';

/** Aucune mention ne survit à un contenu partenaire. */
const NO_MENTIONS = { parse: [] as never[] };

/**
 * Espace de largeur nulle (U+200B), inséré dans les mentions pour les casser.
 *
 * Nommé plutôt qu'écrit en clair : un caractère invisible en dur dans une
 * chaîne est invisible en revue de code, c'est-à-dire exactement ce qu'on ne
 * veut pas dans le traitement d'un contenu venu d'un tiers.
 */
const ZERO_WIDTH = String.fromCharCode(0x200b);

// ─── Publication ─────────────────────────────────────────────────────────────

/**
 * Publie une publicité dans le salon prévu.
 *
 * `replacePrevious` supprime la publication précédente avant d'en poster une
 * nouvelle : sans cela, un partenaire republié chaque semaine finit par occuper
 * la moitié du salon.
 */
export async function publishPromotion(promotionId: string, client?: Client): Promise<boolean> {
  const promotion = await prisma.partnershipPromotion.findUnique({
    where: { id: promotionId },
    include: {
      partnership: { include: { partner: true } },
      posts: { where: { deletedAt: null }, orderBy: { postedAt: 'desc' }, take: 5 },
    },
  });
  if (!promotion?.partnership.guildId) return false;
  if (!promotion.active) return false;

  // Un dossier qui n'est plus vivant ne publie plus, quelle que soit la
  // programmation restée en base.
  if (!['ACTIVE', 'RENEWAL'].includes(promotion.partnership.stage)) return false;

  const discord = client ?? getClient();
  const guild = await discord.guilds.fetch(promotion.partnership.guildId).catch(() => null);
  if (!guild) return false;

  const settings = await getPartnershipSettings(guild.id);
  const channelId = promotion.channelId ?? settings.adsChannelId;
  if (!channelId) return false;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    logger.warn('Partenariats : salon de publicite introuvable', { promotionId, channelId });
    return false;
  }

  if (promotion.replacePrevious) {
    for (const post of promotion.posts) {
      await channel.messages
        .delete(post.messageId)
        .then(async () => {
          await prisma.partnershipPromotionPost.update({
            where: { id: post.id },
            data: { deletedAt: new Date(), deletedBy: 'bot_rotation' },
          });
        })
        .catch(() => null);
    }
  }

  const message = await channel
    .send({
      embeds: [buildPromotionEmbed(promotion, promotion.partnership.partner)],
      allowedMentions: NO_MENTIONS,
    })
    .catch((error) => {
      logger.warn('Partenariats : publicite non publiee', { promotionId, error });
      return null;
    });
  if (!message) return false;

  const next = promotion.repeatHours > 0 ? new Date(Date.now() + promotion.repeatHours * 3_600_000) : null;

  await prisma.$transaction([
    prisma.partnershipPromotionPost.create({
      data: {
        promotionId: promotion.id,
        guildId: guild.id,
        channelId: channel.id,
        messageId: message.id,
      },
    }),
    prisma.partnershipPromotion.update({
      where: { id: promotion.id },
      data: { lastPostedAt: new Date(), nextPostAt: next, postCount: { increment: 1 } },
    }),
  ]);

  await bumpDailyMetric(promotion.partnershipId, { adPosts: 1 });
  await recordPartnershipEvent({
    partnershipId: promotion.partnershipId,
    kind: 'ad_published',
    summary: `Publicité publiée dans #${channel.name}.`,
    payload: { messageId: message.id, channelId: channel.id },
  });

  return true;
}

/**
 * Contenu affiché. Tout vient du partenaire : les mentions sont neutralisées
 * dans le texte lui-même, et pas seulement par `allowedMentions`, pour que le
 * rendu ne laisse pas croire à une mention réelle.
 */
function buildPromotionEmbed(
  promotion: PartnershipPromotion,
  partner: { displayName: string; iconUrl: string | null; accentColor: string | null; inviteUrl: string | null },
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(defuse(promotion.title ?? partner.displayName).slice(0, 256))
    .setColor(parseColor(partner.accentColor))
    .setTimestamp(new Date());

  const description = defuse(promotion.content ?? '').slice(0, 4000);
  const invite = promotion.inviteUrl ?? partner.inviteUrl;
  embed.setDescription(invite ? `${description}\n\n${invite}`.trim().slice(0, 4096) : description || ZERO_WIDTH);

  if (promotion.imageUrl?.startsWith('https://')) embed.setImage(promotion.imageUrl);
  if (partner.iconUrl?.startsWith('https://')) embed.setThumbnail(partner.iconUrl);

  embed.setFooter({ text: `Partenaire : ${partner.displayName}`.slice(0, 2048) });
  return embed;
}

/**
 * Neutralise les mentions de masse et les mentions de rôles dans un texte
 * fourni par un tiers. Le caractère invisible inséré casse la mention côté
 * Discord tout en laissant le texte lisible.
 *
 * Exportée pour être testée : c'est la seule barrière entre un texte écrit par
 * un partenaire et un `@everyone` posté par le bot du serveur qui l'héberge.
 */
export function defuse(text: string): string {
  return text
    .replace(/@(everyone|here)/gi, `@${ZERO_WIDTH}$1`)
    .replace(/<@&(\d+)>/g, `@${ZERO_WIDTH}rôle`)
    .replace(/<@!?(\d+)>/g, `@${ZERO_WIDTH}membre`);
}

function parseColor(value: string | null): number {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) return 0x5865f2;
  return Number.parseInt(value.slice(1), 16);
}

// ─── Rotation ────────────────────────────────────────────────────────────────

/**
 * Publie ce qui est dû. Un balayage plutôt qu'une tâche par publicité : la
 * liste change à chaque enregistrement, et un balayage reprend tout seul après
 * un redémarrage.
 */
export async function runPromotionCycle(client: Client): Promise<number> {
  const due = await prisma.partnershipPromotion.findMany({
    where: {
      active: true,
      autoPublish: true,
      OR: [{ nextPostAt: null }, { nextPostAt: { lte: new Date() } }],
      partnership: { stage: { in: ['ACTIVE', 'RENEWAL'] } },
    },
    select: { id: true, partnership: { select: { guildId: true } } },
    take: 100,
  });

  let published = 0;
  for (const promotion of due) {
    if (!promotion.partnership.guildId) continue;
    const settings = await getPartnershipSettings(promotion.partnership.guildId);
    if (!settings.enabled || !settings.autoPublishAds) continue;

    if (await publishPromotion(promotion.id, client)) published += 1;
  }
  return published;
}

// ─── Vitrine ─────────────────────────────────────────────────────────────────

/**
 * Tient à jour le message de vitrine d'un partenariat : un message par
 * partenaire, édité plutôt que republié.
 *
 * Republier ferait remonter l'annuaire entier à chaque modification et
 * noierait le salon. L'identifiant du message est conservé sur le dossier ;
 * s'il a disparu, un nouveau est publié.
 */
export async function refreshShowcase(partnershipId: string, client?: Client): Promise<void> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    include: { partner: true },
  });
  if (!partnership?.guildId) return;

  const settings = await getPartnershipSettings(partnership.guildId);
  if (!settings.showcaseChannelId) return;

  const discord = client ?? getClient();
  const guild = await discord.guilds.fetch(partnership.guildId).catch(() => null);
  if (!guild) return;

  const channel = await guild.channels.fetch(settings.showcaseChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const live = ['ACTIVE', 'RENEWAL'].includes(partnership.stage);

  if (!live) {
    if (partnership.showcaseMessageId) {
      await channel.messages.delete(partnership.showcaseMessageId).catch(() => null);
      await prisma.partnership.update({ where: { id: partnershipId }, data: { showcaseMessageId: null } });
    }
    return;
  }

  const embed = buildShowcaseEmbed(partnership.partner);

  if (partnership.showcaseMessageId) {
    const existing = await channel.messages.fetch(partnership.showcaseMessageId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds: [embed], allowedMentions: NO_MENTIONS }).catch(() => null);
      return;
    }
  }

  const message = await channel.send({ embeds: [embed], allowedMentions: NO_MENTIONS }).catch(() => null);
  if (message) {
    await prisma.partnership.update({ where: { id: partnershipId }, data: { showcaseMessageId: message.id } });
  }
}

function buildShowcaseEmbed(partner: {
  displayName: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  accentColor: string | null;
  inviteUrl: string | null;
  memberCount: number | null;
  tags: string[];
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(defuse(partner.displayName).slice(0, 256))
    .setColor(parseColor(partner.accentColor))
    .setDescription(defuse(partner.description ?? '').slice(0, 2000) || ZERO_WIDTH);

  if (partner.iconUrl?.startsWith('https://')) embed.setThumbnail(partner.iconUrl);
  if (partner.bannerUrl?.startsWith('https://')) embed.setImage(partner.bannerUrl);

  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (partner.memberCount) {
    fields.push({ name: 'Membres', value: partner.memberCount.toLocaleString('fr-FR'), inline: true });
  }
  if (partner.tags.length > 0) {
    fields.push({ name: 'Thèmes', value: partner.tags.slice(0, 6).join(', '), inline: true });
  }
  if (partner.inviteUrl) {
    fields.push({ name: 'Rejoindre', value: partner.inviteUrl, inline: false });
  }
  if (fields.length > 0) embed.addFields(fields);

  return embed;
}

// ─── Réciprocité ─────────────────────────────────────────────────────────────

/**
 * Vérifie que notre publicité est toujours en place chez le partenaire.
 *
 * Le résultat `UNREACHABLE` n'est pas un échec du partenaire mais du contrôle :
 * il est enregistré comme tel et ne compte jamais dans un manquement.
 */
export async function checkReciprocity(partnershipId: string, client?: Client): Promise<void> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    include: {
      partner: { select: { partnerGuildId: true, displayName: true } },
      promotions: { where: { direction: 'RECEIVED', active: true } },
      bridgeAsLocal: { where: { confirmed: true } },
    },
  });
  if (!partnership?.guildId) return;

  const guildId = partnership.guildId;
  const outbound = partnership.promotions[0] ?? null;
  const discord = client ?? getClient();

  // Voie 1 : le pont. L'autre dossier dit lui-même où en est sa publication.
  const bridge = partnership.bridgeAsLocal[0];
  if (bridge) {
    const remote = await prisma.partnershipPromotion.findFirst({
      where: { partnershipId: bridge.remotePartnershipId, direction: 'GRANTED', active: true },
      include: { posts: { where: { deletedAt: null }, orderBy: { postedAt: 'desc' }, take: 1 } },
    });

    const post = remote?.posts[0];
    await saveCheck(partnershipId, post ? 'OK' : 'MISSING', 'bridge', {
      remoteChannelId: post?.channelId ?? null,
      remoteMessageId: post?.messageId ?? null,
      detail: post ? null : 'Aucune publication active côté partenaire.',
    });
    return;
  }

  // Voie 2 : le bot est sur le serveur partenaire et peut regarder le salon.
  const remoteChannelId = outbound?.remoteChannelId ?? null;
  if (partnership.partner.partnerGuildId && remoteChannelId) {
    const remoteGuild = await discord.guilds.fetch(partnership.partner.partnerGuildId).catch(() => null);
    const channel = remoteGuild
      ? ((await remoteGuild.channels.fetch(remoteChannelId).catch(() => null)) as TextChannel | null)
      : null;

    if (channel && channel.type === ChannelType.GuildText) {
      const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      const found = messages?.some((message) => mentionsUs(message.content, message.embeds, guildId));

      await saveCheck(partnershipId, found ? 'OK' : 'MISSING', 'observed', {
        remoteChannelId,
        remoteMessageId: null,
        detail: found ? null : 'Publicité non retrouvée dans les 50 derniers messages.',
      });
      return;
    }
  }

  await saveCheck(partnershipId, 'UNREACHABLE', 'bridge', {
    remoteChannelId,
    remoteMessageId: null,
    detail: "Ni pont confirmé ni salon observable : contrôle impossible.",
  });
}

/**
 * Notre publicité est-elle dans ce message ? On cherche une invitation vers
 * notre serveur, pas un nom - un nom se change, une invitation se vérifie.
 */
function mentionsUs(content: string, embeds: { description?: string | null }[], guildId: string): boolean {
  const haystack = [content, ...embeds.map((embed) => embed.description ?? '')].join(' ');
  return haystack.includes(guildId) || /discord\.gg\/[a-zA-Z0-9-]{2,32}/.test(haystack);
}

async function saveCheck(
  partnershipId: string,
  result: 'OK' | 'MISSING' | 'ALTERED' | 'UNREACHABLE',
  method: 'bridge' | 'observed' | 'manual',
  extra: { remoteChannelId: string | null; remoteMessageId: string | null; detail: string | null },
): Promise<void> {
  await prisma.partnershipReciprocityCheck.create({
    data: {
      partnershipId,
      result,
      method,
      remoteChannelId: extra.remoteChannelId,
      remoteMessageId: extra.remoteMessageId,
      detail: extra.detail,
    },
  });

  if (result === 'MISSING') {
    await recordPartnershipEvent({
      partnershipId,
      kind: 'reciprocity_missing',
      summary: "Notre publicité n'a pas été retrouvée chez le partenaire.",
      payload: { method },
    });
  }
}

/** Balayage périodique des contrôles dus, serveur par serveur. */
export async function runReciprocityCycle(client: Client, guildId: string): Promise<number> {
  const settings = await getPartnershipSettings(guildId);
  if (!settings.enabled || !settings.reciprocityChecks) return 0;

  const cutoff = new Date(Date.now() - settings.reciprocityIntervalHours * 3_600_000);

  const partnerships = await prisma.partnership.findMany({
    where: {
      guildId,
      stage: { in: ['ACTIVE', 'RENEWAL'] },
      OR: [{ checks: { none: {} } }, { checks: { every: { checkedAt: { lte: cutoff } } } }],
    },
    select: { id: true },
    take: 50,
  });

  for (const partnership of partnerships) {
    await checkReciprocity(partnership.id, client).catch((error) => {
      logger.warn('Partenariats : controle de reciprocite en echec', { partnershipId: partnership.id, error });
    });
  }
  return partnerships.length;
}

// ─── Suppression détectée ────────────────────────────────────────────────────

/**
 * Note qu'une publication a disparu.
 *
 * Appelé depuis la surveillance des suppressions de messages : c'est le seul
 * moyen de distinguer « le bot a fait tourner la publicité » d'un retrait par
 * un modérateur, et donc de ne pas reprocher au partenaire ce que nous avons
 * nous-mêmes supprimé.
 */
export async function markPromotionPostDeleted(messageId: string, deletedBy: string): Promise<void> {
  const post = await prisma.partnershipPromotionPost.findFirst({
    where: { messageId, deletedAt: null },
    select: { id: true, promotionId: true },
  });
  if (!post) return;

  await prisma.partnershipPromotionPost.update({
    where: { id: post.id },
    data: { deletedAt: new Date(), deletedBy },
  });

  const promotion = await prisma.partnershipPromotion.findUnique({
    where: { id: post.promotionId },
    select: { partnershipId: true },
  });
  if (!promotion) return;

  await recordPartnershipEvent({
    partnershipId: promotion.partnershipId,
    kind: 'ad_deleted',
    summary: `Publication de publicité supprimée (${deletedBy}).`,
    payload: { messageId, deletedBy },
  });
}

/** Publicité créée ou remplacée depuis le dashboard ou une commande. */
export async function upsertPromotion(
  partnershipId: string,
  input: {
    id?: string;
    direction?: 'GRANTED' | 'RECEIVED';
    title?: string | null;
    content?: string | null;
    imageUrl?: string | null;
    inviteUrl?: string | null;
    channelId?: string | null;
    remoteChannelId?: string | null;
    autoPublish?: boolean;
    repeatHours?: number;
    replacePrevious?: boolean;
    active?: boolean;
  },
) {
  const data = {
    direction: input.direction ?? 'GRANTED',
    title: input.title?.slice(0, 200) ?? null,
    content: input.content?.slice(0, 4000) ?? null,
    imageUrl: httpsOnly(input.imageUrl),
    inviteUrl: httpsOnly(input.inviteUrl),
    channelId: input.channelId ?? null,
    remoteChannelId: input.remoteChannelId ?? null,
    autoPublish: input.autoPublish ?? false,
    repeatHours: Math.max(0, Math.min(24 * 30, input.repeatHours ?? 0)),
    replacePrevious: input.replacePrevious ?? true,
    active: input.active ?? true,
  };

  if (input.id) return prisma.partnershipPromotion.update({ where: { id: input.id }, data });
  return prisma.partnershipPromotion.create({ data: { ...data, partnershipId } });
}

function httpsOnly(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^https:\/\//i.test(trimmed) ? trimmed.slice(0, 500) : null;
}
