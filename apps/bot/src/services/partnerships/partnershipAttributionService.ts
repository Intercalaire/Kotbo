/**
 * Ce qu'un partenariat rapporte réellement.
 *
 * Compter les arrivées ne suffit pas : un partenaire qui amène trois cents
 * comptes repartis le lendemain coûte plus qu'il ne rapporte, et sans mesure
 * de qualité il apparaîtrait en tête du classement. Chaque arrivée attribuée
 * est donc suivie pendant la fenêtre de rétention (trente jours par défaut) :
 * est-elle restée, a-t-elle parlé, a-t-elle été sanctionnée.
 *
 * Deux voies d'attribution :
 *   - l'invitation Discord dédiée, créée par partenariat (`inviteCode`) ;
 *   - le lien traçable, pour les partenariats qui ne passent pas par Discord.
 *
 * Aucune donnée de contenu n'est conservée : des identifiants, des dates, des
 * compteurs. Ce qui suffit à décider d'un renouvellement, et rien de plus.
 */
import { ChannelType, type Guild } from 'discord.js';
import { kotboEventBus } from '@kotbo/core';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getPartnershipSettings } from './partnershipSettings.js';
import { recordPartnershipEvent } from './partnershipEvents.js';

// ─── Attribution ─────────────────────────────────────────────────────────────

/**
 * Rattache une arrivée au partenariat dont l'invitation a servi.
 *
 * Renvoie l'identifiant du dossier crédité, ou `null` si l'invitation n'est
 * celle d'aucun partenariat - le cas le plus fréquent, et ce n'est pas une
 * anomalie.
 */
export async function attributeJoinToPartnership(params: {
  guildId: string;
  userId: string;
  inviteCode: string;
}): Promise<string | null> {
  const partnership = await prisma.partnership.findFirst({
    where: {
      guildId: params.guildId,
      inviteCode: params.inviteCode,
      stage: { in: ['ACTIVE', 'RENEWAL'] },
    },
    select: { id: true, referredJoins: true },
  });
  if (!partnership) return null;

  // `upsert` et non `create` : un membre qui part et revient par la même
  // invitation ne doit pas produire deux lignes, sans quoi la rétention
  // deviendrait supérieure à cent pour cent.
  await prisma.partnershipReferral.upsert({
    where: { partnershipId_userId: { partnershipId: partnership.id, userId: params.userId } },
    create: {
      partnershipId: partnership.id,
      userId: params.userId,
      guildId: params.guildId,
      attribution: 'invite',
    },
    update: { leftAt: null, joinedAt: new Date() },
  });

  await prisma.partnership.update({
    where: { id: partnership.id },
    data: { referredJoins: { increment: 1 }, referredActive: { increment: 1 } },
  });

  await bumpDailyMetric(partnership.id, { joins: 1 });

  // Diffuse pour les workflows : « quand un membre arrive par un partenaire »
  // est le declencheur qui permet de lui souhaiter la bienvenue autrement, ou
  // de lui donner un role dedie.
  const partner = await prisma.partner.findFirst({
    where: { partnerships: { some: { id: partnership.id } } },
    select: { id: true, displayName: true },
  });
  try {
    kotboEventBus.publish('partnership:referral', {
      guildId: params.guildId,
      userId: params.userId,
      partnershipId: partnership.id,
      partnerId: partner?.id ?? '',
      partnerName: partner?.displayName ?? 'Partenaire',
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.warn('Partenariats : arrivee non publiee sur le bus', { partnershipId: partnership.id, error });
  }

  return partnership.id;
}

/** Note un départ. Le membre reste attribué : il a bien été apporté. */
export async function recordReferralLeave(guildId: string, userId: string): Promise<void> {
  const referrals = await prisma.partnershipReferral.findMany({
    where: { guildId, userId, leftAt: null },
    select: { id: true, partnershipId: true },
  });
  if (referrals.length === 0) return;

  await prisma.partnershipReferral.updateMany({
    where: { id: { in: referrals.map((referral) => referral.id) } },
    data: { leftAt: new Date(), retained: false },
  });

  for (const referral of referrals) {
    await prisma.partnership.update({
      where: { id: referral.partnershipId },
      data: {
        referredLeaves: { increment: 1 },
        referredActive: { decrement: 1 },
      },
    });
    await bumpDailyMetric(referral.partnershipId, { leaves: 1 });
  }
}

/**
 * Note l'activité d'un membre attribué, tant qu'il est dans sa fenêtre de
 * mesure. Passée la fenêtre, on arrête de compter : la qualité d'un partenariat
 * se juge sur ce qu'il apporte, pas sur ce que les gens deviennent un an après.
 */
export async function recordReferralActivity(params: {
  guildId: string;
  userId: string;
  messages?: number;
  voiceMinutes?: number;
  level?: number;
}): Promise<void> {
  const settings = await getPartnershipSettings(params.guildId);
  if (!settings.trackReferredActivity) return;

  const cutoff = new Date(Date.now() - settings.retentionWindowDays * 86_400_000);
  const referrals = await prisma.partnershipReferral.findMany({
    where: { guildId: params.guildId, userId: params.userId, joinedAt: { gte: cutoff } },
    select: { id: true, partnershipId: true, levelReached: true },
  });

  for (const referral of referrals) {
    await prisma.partnershipReferral.update({
      where: { id: referral.id },
      data: {
        messageCount: params.messages ? { increment: params.messages } : undefined,
        voiceMinutes: params.voiceMinutes ? { increment: params.voiceMinutes } : undefined,
        levelReached:
          params.level !== undefined && params.level > referral.levelReached ? params.level : undefined,
      },
    });
    if (params.messages) await bumpDailyMetric(referral.partnershipId, { messages: params.messages });
  }
}

/** Note une sanction reçue par un membre attribué. Pèse sur le score du dossier. */
export async function recordReferralSanction(guildId: string, userId: string): Promise<void> {
  await prisma.partnershipReferral.updateMany({
    where: { guildId, userId },
    data: { sanctionCount: { increment: 1 } },
  });
}

// ─── Invitation dédiée ───────────────────────────────────────────────────────

/**
 * Crée l'invitation propre au partenariat, celle sur laquelle repose toute
 * l'attribution.
 *
 * Sans limite d'usage ni d'expiration, volontairement : une invitation
 * partenaire qui expire fait disparaître la mesure au moment où le partenariat
 * commence à produire. Elle est révoquée à la fin du dossier.
 */
export async function ensurePartnershipInvite(
  guild: Guild,
  partnershipId: string,
): Promise<string | null> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    include: { partner: { select: { displayName: true } } },
  });
  if (!partnership) return null;

  if (partnership.inviteCode) {
    const existing = await guild.invites.fetch({ code: partnership.inviteCode }).catch(() => null);
    if (existing) return partnership.inviteCode;
  }

  const settings = await getPartnershipSettings(guild.id);
  if (!settings.trackInvites) return null;

  const channel =
    guild.channels.cache.find(
      (candidate) => candidate.type === ChannelType.GuildText && candidate.id === settings.showcaseChannelId,
    ) ?? guild.systemChannel ?? guild.channels.cache.find((candidate) => candidate.type === ChannelType.GuildText);

  if (!channel || channel.type !== ChannelType.GuildText) {
    logger.warn('Partenariats : aucun salon pour creer l\'invitation dediee', { guildId: guild.id, partnershipId });
    return null;
  }

  const invite = await guild.invites
    .create(channel.id, {
      maxAge: 0,
      maxUses: 0,
      unique: true,
      reason: `Partenariat : ${partnership.partner.displayName}`,
    })
    .catch((error) => {
      logger.warn('Partenariats : invitation dediee non creee', { guildId: guild.id, partnershipId, error });
      return null;
    });
  if (!invite) return null;

  await prisma.partnership.update({ where: { id: partnershipId }, data: { inviteCode: invite.code } });
  await prisma.guildInvite.upsert({
    where: { code: invite.code },
    create: {
      guildId: guild.id,
      code: invite.code,
      sourceLabel: `Partenariat-${partnership.partner.displayName}`.slice(0, 60),
      uses: 0,
    },
    update: { sourceLabel: `Partenariat-${partnership.partner.displayName}`.slice(0, 60) },
  });

  await recordPartnershipEvent({
    partnershipId,
    kind: 'invite_created',
    summary: `Invitation dédiée créée (${invite.code}).`,
    payload: { code: invite.code, channelId: channel.id },
  });

  return invite.code;
}

/** Révoque l'invitation dédiée. Les arrivées déjà attribuées restent acquises. */
export async function revokePartnershipInvite(guild: Guild, partnershipId: string): Promise<void> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    select: { inviteCode: true },
  });
  if (!partnership?.inviteCode) return;

  await guild.invites.delete(partnership.inviteCode, 'Partenariat terminé').catch(() => null);
  await prisma.guildInvite.updateMany({ where: { code: partnership.inviteCode }, data: { isDeleted: true } });
}

// ─── Liens traçables ─────────────────────────────────────────────────────────

/**
 * Enregistre un clic sur un lien traçable et renvoie la destination.
 *
 * Le comptage des visiteurs distincts repose sur une empreinte fournie par
 * l'appelant, jamais sur une adresse IP conservée : l'unicité approximative
 * suffit à mesurer un partenariat, et conserver des adresses ne se justifierait
 * pas.
 */
export async function registerLinkClick(slug: string, visitorHash?: string | null): Promise<string | null> {
  const link = await prisma.partnershipTrackedLink.findUnique({ where: { slug } });
  if (!link || !link.active) return null;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return null;

  await prisma.partnershipTrackedLink.update({
    where: { id: link.id },
    data: {
      clickCount: { increment: 1 },
      uniqueCount: visitorHash ? { increment: 1 } : undefined,
    },
  });
  await bumpDailyMetric(link.partnershipId, { clicks: 1 });

  return link.targetUrl;
}

// ─── Agrégats ────────────────────────────────────────────────────────────────

type MetricDelta = Partial<{
  joins: number;
  leaves: number;
  retained: number;
  messages: number;
  clicks: number;
  adPosts: number;
  amountCents: number;
}>;

/**
 * Incrémente le relevé du jour. Une ligne par dossier et par jour : les vues de
 * tendance n'ont alors qu'une plage d'index à lire, au lieu de reparcourir les
 * arrivées une à une.
 */
export async function bumpDailyMetric(partnershipId: string, delta: MetricDelta): Promise<void> {
  const dateKey = todayKey();

  await prisma.partnershipMetricDaily
    .upsert({
      where: { partnershipId_dateKey: { partnershipId, dateKey } },
      create: {
        partnershipId,
        dateKey,
        joins: delta.joins ?? 0,
        leaves: delta.leaves ?? 0,
        retained: delta.retained ?? 0,
        messages: delta.messages ?? 0,
        clicks: delta.clicks ?? 0,
        adPosts: delta.adPosts ?? 0,
        amountCents: delta.amountCents ?? 0,
      },
      update: {
        joins: delta.joins ? { increment: delta.joins } : undefined,
        leaves: delta.leaves ? { increment: delta.leaves } : undefined,
        retained: delta.retained ? { increment: delta.retained } : undefined,
        messages: delta.messages ? { increment: delta.messages } : undefined,
        clicks: delta.clicks ? { increment: delta.clicks } : undefined,
        adPosts: delta.adPosts ? { increment: delta.adPosts } : undefined,
        amountCents: delta.amountCents ? { increment: delta.amountCents } : undefined,
      },
    })
    .catch((error) => {
      logger.warn('Partenariats : releve quotidien non ecrit', { partnershipId, error });
    });
}

/**
 * Journée au format `YYYY-MM-DD`, dans le fuseau de Paris.
 *
 * Le process tourne en UTC. Sans fuseau de référence explicite, la frontière du
 * jour se déplacerait deux fois par an et les relevés d'hiver ne seraient pas
 * comparables à ceux d'été.
 */
function todayKey(): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ─── Rétention et score ──────────────────────────────────────────────────────

/**
 * Clôt la fenêtre de rétention des arrivées arrivées à échéance.
 *
 * Balayé une fois par jour. Une arrivée encore présente au terme de sa fenêtre
 * est comptée comme retenue, et ce chiffre ne bouge plus : c'est ce qui rend
 * deux partenariats comparables même s'ils n'ont pas le même âge.
 */
export async function closeRetentionWindows(guildId: string): Promise<number> {
  const settings = await getPartnershipSettings(guildId);
  const cutoff = new Date(Date.now() - settings.retentionWindowDays * 86_400_000);

  const due = await prisma.partnershipReferral.findMany({
    where: { guildId, retained: false, leftAt: null, joinedAt: { lte: cutoff } },
    select: { id: true, partnershipId: true },
    take: 1000,
  });
  if (due.length === 0) return 0;

  await prisma.partnershipReferral.updateMany({
    where: { id: { in: due.map((referral) => referral.id) } },
    data: { retained: true },
  });

  for (const referral of due) await bumpDailyMetric(referral.partnershipId, { retained: 1 });
  return due.length;
}

/**
 * Recalcule la santé d'un dossier, de 0 à 100.
 *
 * Quatre termes, pondérés : les engagements tenus (le plus lourd - c'est la
 * promesse), la rétention des membres apportés, leur activité, et les sanctions
 * qu'ils ont reçues (en négatif). Un dossier sans mesure possible reste à 50 :
 * l'absence de données n'est ni une bonne ni une mauvaise nouvelle.
 */
export async function recomputeHealthScore(partnershipId: string): Promise<number> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    include: { commitments: true },
  });
  if (!partnership) return 50;

  const referrals = await prisma.partnershipReferral.findMany({
    where: { partnershipId },
    select: { retained: true, leftAt: true, messageCount: true, sanctionCount: true },
  });

  let score = 50;

  const measured = partnership.commitments.filter((commitment) =>
    ['ON_TRACK', 'FULFILLED', 'AT_RISK', 'BREACHED'].includes(commitment.state),
  );
  if (measured.length > 0) {
    const kept = measured.filter((commitment) =>
      ['ON_TRACK', 'FULFILLED'].includes(commitment.state),
    ).length;
    // 0 engagement tenu → -30 ; tous tenus → +30.
    score += Math.round((kept / measured.length) * 60) - 30;
  }

  if (referrals.length >= 5) {
    const retained = referrals.filter((referral) => referral.retained).length;
    score += Math.round((retained / referrals.length) * 30) - 10;

    const active = referrals.filter((referral) => referral.messageCount > 0).length;
    score += Math.round((active / referrals.length) * 20) - 5;

    const sanctioned = referrals.filter((referral) => referral.sanctionCount > 0).length;
    score -= Math.round((sanctioned / referrals.length) * 30);
  }

  const bounded = Math.min(100, Math.max(0, score));
  await prisma.partnership.update({
    where: { id: partnershipId },
    data: { healthScore: bounded, healthComputedAt: new Date() },
  });
  return bounded;
}

/** Bilan d'un dossier, tel que la fiche et le digest l'affichent. */
export async function getPartnershipReport(partnershipId: string) {
  const [partnership, referrals, metrics, promotions] = await Promise.all([
    prisma.partnership.findUnique({
      where: { id: partnershipId },
      include: { partner: { select: { displayName: true, trustScore: true } } },
    }),
    prisma.partnershipReferral.findMany({
      where: { partnershipId },
      select: { retained: true, leftAt: true, messageCount: true, voiceMinutes: true, sanctionCount: true },
    }),
    prisma.partnershipMetricDaily.findMany({
      where: { partnershipId },
      orderBy: { dateKey: 'desc' },
      take: 90,
    }),
    prisma.partnershipPromotion.findMany({
      where: { partnershipId },
      select: { postCount: true, direction: true },
    }),
  ]);
  if (!partnership) return null;

  const stillHere = referrals.filter((referral) => !referral.leftAt).length;
  const retained = referrals.filter((referral) => referral.retained).length;

  return {
    partnership,
    joins: referrals.length,
    stillHere,
    retained,
    retentionRate: referrals.length > 0 ? Math.round((retained / referrals.length) * 100) : null,
    activeRate:
      referrals.length > 0
        ? Math.round((referrals.filter((referral) => referral.messageCount > 0).length / referrals.length) * 100)
        : null,
    sanctions: referrals.reduce((total, referral) => total + referral.sanctionCount, 0),
    messages: referrals.reduce((total, referral) => total + referral.messageCount, 0),
    voiceMinutes: referrals.reduce((total, referral) => total + referral.voiceMinutes, 0),
    adsPublished: promotions.reduce((total, promotion) => total + promotion.postCount, 0),
    daily: metrics.reverse(),
  };
}
