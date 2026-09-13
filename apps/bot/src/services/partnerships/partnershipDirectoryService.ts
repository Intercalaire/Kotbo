/**
 * Annuaire inter-serveurs et mise en relation.
 *
 * Deux serveurs qui utilisent Kotbo se cherchent aujourd'hui sur des serveurs
 * de publicité tiers, au hasard des messages. L'annuaire leur permet de se
 * trouver par thème, taille et langue, et d'échanger une proposition qui
 * arrive directement dans le dashboard de l'autre.
 *
 * ── Ce qui est publié, et ce qui ne l'est jamais ────────────────────────────
 *
 * Le référencement est strictement volontaire (`directoryOptIn`), et la fiche
 * ne contient que ce que le serveur a saisi pour elle. L'effectif est publié
 * par tranche et non en valeur exacte : l'annuaire sert à trouver un partenaire
 * compatible, pas à constituer un fichier des communautés Discord. Aucune
 * donnée de membre n'y figure.
 *
 * ── Pourquoi les suggestions sont conservées ────────────────────────────────
 *
 * Recalculer à l'affichage reproposerait indéfiniment un serveur que le staff a
 * déjà écarté, et perdrait la raison du rapprochement - sans laquelle une
 * suggestion n'inspire pas confiance.
 */
import { ChannelType, type Guild } from 'discord.js';
import type { PartnershipDirectoryListing, PartnershipProposal } from '@prisma/client';
import { isPartnershipType } from '@kotbo/contracts';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { INVITE_SOURCE, recordBotInvite } from '../analytics/inviteService.js';
import { getPartnershipSettings } from './partnershipSettings.js';
import { sendPartnershipAlert } from './partnershipEvents.js';

/** Tranches d'effectif publiées. Volontairement larges. */
export const SIZE_BUCKETS = ['<100', '100-1k', '1k-10k', '10k+'] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

export function bucketForSize(memberCount: number | null | undefined): SizeBucket | null {
  if (!memberCount || memberCount <= 0) return null;
  if (memberCount < 100) return '<100';
  if (memberCount < 1_000) return '100-1k';
  if (memberCount < 10_000) return '1k-10k';
  return '10k+';
}

// ─── Vitrine ─────────────────────────────────────────────────────────────────

export interface ListingInput {
  displayName?: string;
  headline?: string | null;
  description?: string | null;
  tags?: string[];
  locale?: string;
  memberCount?: number | null;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  inviteUrl?: string | null;
  seekingTypes?: string[];
  minPartnerSize?: number;
  openToProposals?: boolean;
  published?: boolean;
}

/**
 * Crée ou met à jour la vitrine. Publier exige que le module ait été autorisé
 * à référencer le serveur : la case de la page annuaire et le réglage sont
 * deux gestes distincts, et le second commande le premier.
 */
export async function upsertListing(
  guildId: string,
  input: ListingInput,
): Promise<PartnershipDirectoryListing> {
  const settings = await getPartnershipSettings(guildId);
  const published = input.published === true && settings.directoryOptIn;

  const data = {
    displayName: (input.displayName ?? 'Serveur').slice(0, 100),
    headline: input.headline?.slice(0, 150) ?? null,
    description: input.description?.slice(0, 2000) ?? null,
    tags: (input.tags ?? []).map((tag) => tag.trim().toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 12),
    locale: (input.locale ?? 'fr').slice(0, 10),
    sizeBucket: bucketForSize(input.memberCount),
    iconUrl: httpsOnly(input.iconUrl),
    bannerUrl: httpsOnly(input.bannerUrl),
    inviteUrl: input.inviteUrl?.slice(0, 300) ?? null,
    seekingTypes: (input.seekingTypes ?? []).filter((type) => isPartnershipType(type)).slice(0, 10),
    minPartnerSize: Math.max(0, input.minPartnerSize ?? 0),
    openToProposals: input.openToProposals ?? true,
    published,
    lastPublishedAt: published ? new Date() : null,
  };

  return prisma.partnershipDirectoryListing.upsert({
    where: { guildId },
    create: { guildId, ...data },
    update: data,
  });
}

/**
 * Recherche dans l'annuaire. Le serveur qui cherche n'apparaît jamais dans ses
 * propres résultats, et les serveurs avec qui un dossier est déjà ouvert non
 * plus - les reproposer serait du bruit.
 */
export async function searchDirectory(params: {
  guildId: string;
  query?: string;
  tags?: string[];
  locale?: string;
  sizeBucket?: string;
  type?: string;
  take?: number;
}) {
  const existing = await prisma.partnership.findMany({
    where: { guildId: params.guildId, stage: { notIn: ['ENDED', 'BREACHED', 'REJECTED', 'ARCHIVED'] } },
    select: { partner: { select: { partnerGuildId: true } } },
  });
  const excluded = new Set(
    existing.map((row) => row.partner.partnerGuildId).filter((id): id is string => Boolean(id)),
  );
  excluded.add(params.guildId);

  return prisma.partnershipDirectoryListing.findMany({
    where: {
      published: true,
      guildId: { notIn: Array.from(excluded) },
      ...(params.locale ? { locale: params.locale } : {}),
      ...(params.sizeBucket ? { sizeBucket: params.sizeBucket } : {}),
      ...(params.tags?.length ? { tags: { hasSome: params.tags } } : {}),
      ...(params.type ? { seekingTypes: { has: params.type } } : {}),
      ...(params.query
        ? {
            OR: [
              { displayName: { contains: params.query, mode: 'insensitive' as const } },
              { headline: { contains: params.query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ reliabilityScore: 'desc' }, { lastPublishedAt: 'desc' }],
    take: Math.min(params.take ?? 30, 100),
  });
}

/**
 * Ce que le serveur peut dire de lui-meme sans que personne ne le saisisse.
 *
 * La vitrine demande un nom, une presentation, une icone, une banniere et un
 * effectif : Discord les connait tous. Les faire recopier a la main garantissait
 * une fiche perimee au premier changement de nom.
 */
export interface ListingSuggestion {
  displayName: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  memberCount: number;
  locale: string;
  /** Deduite des salons et du nom : des pistes de themes, pas une verite. */
  tags: string[];
}

/** Correspondances nom de salon vers theme, volontairement courtes et lisibles. */
const TAG_HINTS: { pattern: RegExp; tag: string }[] = [
  { pattern: /\b(gaming|jeux?|game|minecraft|fortnite|valorant|lol)\b/i, tag: 'gaming' },
  { pattern: /\b(dev|code|programmation|tech|informatique)\b/i, tag: 'tech' },
  { pattern: /\b(art|dessin|creation|design)\b/i, tag: 'creation' },
  { pattern: /\b(musique|music|radio)\b/i, tag: 'musique' },
  { pattern: /\b(entraide|aide|support|question)\b/i, tag: 'entraide' },
  { pattern: /\b(etude|school|ecole|revision|bac)\b/i, tag: 'etudes' },
  { pattern: /\b(anime|manga|otaku)\b/i, tag: 'anime' },
  { pattern: /\b(esport|tournoi|competition|ranked)\b/i, tag: 'esport' },
];

/**
 * Propose une fiche a partir du serveur Discord lui-meme.
 *
 * Ne touche pas a la vitrine enregistree : c'est le formulaire qui decide
 * d'accepter ou non ce qui est propose. Les themes sont devines a partir des
 * noms de salons - une piste a corriger, jamais une classification.
 */
export function suggestListingFromGuild(guild: Guild): ListingSuggestion {
  const haystack = [
    guild.name,
    guild.description ?? '',
    ...guild.channels.cache.map((channel) => ('name' in channel ? channel.name : '')),
  ].join(' ');

  const tags: string[] = [];
  for (const hint of TAG_HINTS) {
    if (hint.pattern.test(haystack) && !tags.includes(hint.tag)) tags.push(hint.tag);
  }

  return {
    displayName: guild.name,
    description: guild.description ?? null,
    iconUrl: guild.iconURL({ size: 256, extension: 'png' }) ?? null,
    bannerUrl: guild.bannerURL({ size: 1024, extension: 'png' }) ?? null,
    memberCount: guild.memberCount,
    // `preferredLocale` vaut `fr-FR` ou `en-US` : la vitrine ne garde que la langue.
    locale: (guild.preferredLocale ?? 'fr').split('-')[0],
    tags: tags.slice(0, 6),
  };
}

/**
 * Cree, ou retrouve, l'invitation publiee sur la vitrine.
 *
 * Sans limite d'usage ni d'expiration : une invitation d'annuaire qui expire
 * transforme une fiche en impasse, et c'est le genre de panne que personne ne
 * remarque avant des semaines.
 *
 * Le salon vise est, dans l'ordre : le salon systeme du serveur, sinon les
 * regles, sinon le premier salon textuel ou le bot peut creer une invitation.
 * On evite ainsi de faire atterrir des inconnus dans un salon de travail.
 */
export async function ensureShowcaseInvite(guild: Guild): Promise<string | null> {
  const listing = await prisma.partnershipDirectoryListing.findUnique({
    where: { guildId: guild.id },
    select: { inviteUrl: true },
  });

  // Une invitation deja enregistree et toujours valide est reutilisee : en
  // recreer une a chaque clic emplirait la liste des invitations du serveur.
  const existingCode = listing?.inviteUrl?.split('/').pop();
  if (existingCode) {
    const alive = await guild.invites.fetch({ code: existingCode }).catch(() => null);
    if (alive) return listing?.inviteUrl ?? null;
  }

  const channel =
    guild.systemChannel
    ?? guild.rulesChannel
    ?? guild.channels.cache.find(
      (candidate) =>
        candidate.type === ChannelType.GuildText
        && candidate.permissionsFor(guild.members.me ?? guild.client.user.id)?.has('CreateInstantInvite') === true,
    );

  if (!channel || channel.type !== ChannelType.GuildText) {
    logger.warn("Partenariats : aucun salon pour créer l'invitation de vitrine", { guildId: guild.id });
    return null;
  }

  const invite = await guild.invites
    .create(channel.id, {
      maxAge: 0,
      maxUses: 0,
      unique: false,
      reason: "Invitation publiée sur l'annuaire des partenaires",
    })
    .catch((error) => {
      logger.warn('Partenariats : invitation de vitrine non creee', { guildId: guild.id, error });
      return null;
    });
  if (!invite) return null;

  await recordBotInvite(invite, INVITE_SOURCE.partnership());

  const url = `https://discord.gg/${invite.code}`;
  await prisma.partnershipDirectoryListing.updateMany({ where: { guildId: guild.id }, data: { inviteUrl: url } });
  return url;
}

// ─── Mise en relation ────────────────────────────────────────────────────────

/**
 * Calcule les rapprochements possibles pour un serveur.
 *
 * Le score additionne quatre proximités : thèmes partagés (le plus lourd -
 * c'est ce qui fait qu'un partenariat intéresse les membres), écart de taille,
 * langue et types recherchés réciproques. Un partenaire dix fois plus gros
 * n'est pas une bonne nouvelle : l'échange y est déséquilibré et il cesse vite.
 */
export async function computeMatches(guildId: string): Promise<number> {
  const settings = await getPartnershipSettings(guildId);
  if (!settings.enabled || !settings.matchmakingEnabled || !settings.directoryOptIn) return 0;

  const mine = await prisma.partnershipDirectoryListing.findUnique({ where: { guildId } });
  if (!mine?.published) return 0;

  const candidates = await searchDirectory({ guildId, take: 100 });
  const mySizeIndex = SIZE_BUCKETS.indexOf((mine.sizeBucket ?? '') as SizeBucket);

  let written = 0;
  for (const candidate of candidates) {
    if (!candidate.openToProposals) continue;

    const sharedTags = candidate.tags.filter((tag) => mine.tags.includes(tag));
    const candidateSizeIndex = SIZE_BUCKETS.indexOf((candidate.sizeBucket ?? '') as SizeBucket);
    const sizeGap = mySizeIndex >= 0 && candidateSizeIndex >= 0 ? Math.abs(mySizeIndex - candidateSizeIndex) : 2;

    const wantedByThem = candidate.seekingTypes.filter((type) => mine.seekingTypes.includes(type));

    let score = 0;
    score += Math.min(40, sharedTags.length * 15);
    score += sizeGap === 0 ? 25 : sizeGap === 1 ? 15 : 0;
    score += candidate.locale === mine.locale ? 15 : 0;
    score += Math.min(20, wantedByThem.length * 10);

    // En dessous, le rapprochement ne repose sur rien de solide : mieux vaut
    // ne rien proposer que de proposer au hasard.
    if (score < 30) continue;

    await prisma.partnershipMatchSuggestion.upsert({
      where: { guildId_suggestedGuildId: { guildId, suggestedGuildId: candidate.guildId } },
      create: {
        guildId,
        suggestedGuildId: candidate.guildId,
        score,
        reasons: { sharedTags, sizeGap, sameLocale: candidate.locale === mine.locale, wantedByThem } as never,
      },
      update: {
        score,
        reasons: { sharedTags, sizeGap, sameLocale: candidate.locale === mine.locale, wantedByThem } as never,
        computedAt: new Date(),
      },
    });
    written += 1;
  }

  return written;
}

export async function listMatches(guildId: string) {
  const suggestions = await prisma.partnershipMatchSuggestion.findMany({
    where: { guildId, dismissed: false },
    orderBy: { score: 'desc' },
    take: 30,
  });

  const listings = await prisma.partnershipDirectoryListing.findMany({
    where: { guildId: { in: suggestions.map((suggestion) => suggestion.suggestedGuildId) }, published: true },
  });
  const byGuild = new Map(listings.map((listing) => [listing.guildId, listing]));

  // Une suggestion dont la vitrine a été dépubliée n'a plus rien à montrer.
  return suggestions
    .map((suggestion) => ({ suggestion, listing: byGuild.get(suggestion.suggestedGuildId) }))
    .filter((row) => row.listing);
}

export async function dismissMatch(guildId: string, suggestedGuildId: string, actorUserId: string): Promise<void> {
  await prisma.partnershipMatchSuggestion.updateMany({
    where: { guildId, suggestedGuildId },
    data: { dismissed: true, dismissedAt: new Date(), dismissedByUserId: actorUserId },
  });
}

// ─── Propositions ────────────────────────────────────────────────────────────

/**
 * Envoie une proposition à un autre serveur.
 *
 * Trois garde-fous, parce qu'une place de marché sans garde-fou devient un
 * canal de démarchage : le destinataire doit accepter les propositions, une
 * seule proposition en attente par couple de serveurs, et une expiration à
 * trente jours.
 */
export async function sendProposal(params: {
  fromGuildId: string;
  toGuildId: string;
  type: string;
  message?: string;
  actorUserId: string;
}): Promise<PartnershipProposal> {
  if (params.fromGuildId === params.toGuildId) throw new Error('Un serveur ne se propose pas de partenariat.');
  if (!isPartnershipType(params.type)) throw new Error(`Type inconnu : ${params.type}`);

  const target = await prisma.partnershipDirectoryListing.findUnique({ where: { guildId: params.toGuildId } });
  if (!target?.published || !target.openToProposals) {
    throw new Error("Ce serveur n'accepte pas les propositions.");
  }

  const targetSettings = await getPartnershipSettings(params.toGuildId);
  if (!targetSettings.directoryAcceptProposals) {
    throw new Error("Ce serveur n'accepte pas les propositions.");
  }

  const pending = await prisma.partnershipProposal.findFirst({
    where: { fromGuildId: params.fromGuildId, toGuildId: params.toGuildId, status: { in: ['SENT', 'SEEN'] } },
  });
  if (pending) throw new Error('Une proposition est déjà en attente auprès de ce serveur.');

  const proposal = await prisma.partnershipProposal.create({
    data: {
      fromGuildId: params.fromGuildId,
      toGuildId: params.toGuildId,
      type: params.type,
      message: params.message?.slice(0, 1000) ?? null,
      sentByUserId: params.actorUserId,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  const sender = await prisma.partnershipDirectoryListing.findUnique({
    where: { guildId: params.fromGuildId },
    select: { displayName: true, sizeBucket: true, tags: true },
  });

  await sendPartnershipAlert({
    guildId: params.toGuildId,
    title: 'Proposition de partenariat reçue',
    description: `${sender?.displayName ?? 'Un serveur'} propose un partenariat de type ${params.type}.`,
    tone: 'info',
    fields: [
      ...(sender?.sizeBucket ? [{ name: 'Taille', value: sender.sizeBucket }] : []),
      ...(sender?.tags.length ? [{ name: 'Thèmes', value: sender.tags.join(', ') }] : []),
      ...(params.message ? [{ name: 'Message', value: params.message.slice(0, 1000) }] : []),
    ],
    link: '/partnerships/directory',
  });

  return proposal;
}

export async function markProposalSeen(proposalId: string): Promise<void> {
  await prisma.partnershipProposal.updateMany({
    where: { id: proposalId, status: 'SENT' },
    data: { status: 'SEEN', seenAt: new Date() },
  });
}

/**
 * Répond à une proposition. Une acceptation ouvre un dossier **de chaque
 * côté** : chacun garde le sien, avec ses notes et son responsable, et le pont
 * relie les deux. Un dossier partagé unique aurait obligé à arbitrer qui écrit
 * quoi et aurait fait fuiter les notes internes d'une équipe vers l'autre.
 */
export async function respondToProposal(
  proposalId: string,
  accept: boolean,
  actor: { userId: string; note?: string },
): Promise<PartnershipProposal> {
  const proposal = await prisma.partnershipProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new Error('Proposition introuvable.');
  if (proposal.status !== 'SENT' && proposal.status !== 'SEEN') {
    throw new Error('Cette proposition a déjà reçu une réponse.');
  }
  if (proposal.expiresAt.getTime() < Date.now()) {
    await prisma.partnershipProposal.update({ where: { id: proposalId }, data: { status: 'EXPIRED' } });
    throw new Error('Cette proposition a expiré.');
  }

  if (!accept) {
    return prisma.partnershipProposal.update({
      where: { id: proposalId },
      data: {
        status: 'DECLINED',
        respondedAt: new Date(),
        responseNote: actor.note?.slice(0, 500) ?? null,
      },
    });
  }

  const [fromListing, toListing] = await Promise.all([
    prisma.partnershipDirectoryListing.findUnique({ where: { guildId: proposal.fromGuildId } }),
    prisma.partnershipDirectoryListing.findUnique({ where: { guildId: proposal.toGuildId } }),
  ]);

  const { createPartner } = await import('./partnerService.js');
  const { createPartnership } = await import('./partnershipService.js');

  const theirPartner = await createPartner(
    {
      guildId: proposal.toGuildId,
      kind: 'SERVER',
      displayName: fromListing?.displayName ?? 'Partenaire',
      description: fromListing?.description ?? null,
      partnerGuildId: proposal.fromGuildId,
      inviteUrl: fromListing?.inviteUrl ?? null,
      iconUrl: fromListing?.iconUrl ?? null,
      tags: fromListing?.tags ?? [],
    },
    { userId: actor.userId, source: 'dashboard' },
  );

  const ourPartner = await createPartner(
    {
      guildId: proposal.fromGuildId,
      kind: 'SERVER',
      displayName: toListing?.displayName ?? 'Partenaire',
      description: toListing?.description ?? null,
      partnerGuildId: proposal.toGuildId,
      inviteUrl: toListing?.inviteUrl ?? null,
      iconUrl: toListing?.iconUrl ?? null,
      tags: toListing?.tags ?? [],
    },
    { userId: actor.userId, source: 'dashboard' },
  );

  const theirPartnership = await createPartnership(
    { guildId: proposal.toGuildId, partnerId: theirPartner.id, type: proposal.type },
    { userId: actor.userId, source: 'dashboard' },
  );
  const ourPartnership = await createPartnership(
    { guildId: proposal.fromGuildId, partnerId: ourPartner.id, type: proposal.type },
    { userId: proposal.sentByUserId ?? actor.userId, source: 'dashboard' },
  );

  await prisma.partnershipBridge.create({
    data: {
      localPartnershipId: ourPartnership.id,
      remotePartnershipId: theirPartnership.id,
      localGuildId: proposal.fromGuildId,
      remoteGuildId: proposal.toGuildId,
      confirmed: true,
      confirmedAt: new Date(),
      syncedFields: ['stage', 'agreement'],
    },
  });

  const updated = await prisma.partnershipProposal.update({
    where: { id: proposalId },
    data: {
      status: 'ACCEPTED',
      respondedAt: new Date(),
      responseNote: actor.note?.slice(0, 500) ?? null,
      fromPartnershipId: ourPartnership.id,
      toPartnershipId: theirPartnership.id,
    },
  });

  await sendPartnershipAlert({
    guildId: proposal.fromGuildId,
    title: 'Proposition acceptée',
    description: `${toListing?.displayName ?? 'Le serveur contacté'} a accepté votre proposition. Un dossier a été ouvert.`,
    tone: 'success',
    link: `/partnerships/${ourPartnership.id}`,
  });

  return updated;
}

export async function withdrawProposal(proposalId: string): Promise<void> {
  await prisma.partnershipProposal.updateMany({
    where: { id: proposalId, status: { in: ['SENT', 'SEEN'] } },
    data: { status: 'WITHDRAWN', respondedAt: new Date() },
  });
}

/** Propositions périmées, balayées une fois par jour. */
export async function expireProposals(): Promise<number> {
  const result = await prisma.partnershipProposal.updateMany({
    where: { status: { in: ['SENT', 'SEEN'] }, expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}

/**
 * Met à jour la fiabilité affichée sur la vitrine, à partir des dossiers menés
 * à leur terme. Jamais saisie : une réputation qu'on écrit soi-même ne vaut
 * rien.
 */
export async function refreshReliability(guildId: string): Promise<void> {
  const [ended, breached] = await Promise.all([
    prisma.partnership.count({ where: { guildId, stage: 'ENDED' } }),
    prisma.partnership.count({ where: { guildId, stage: 'BREACHED' } }),
  ]);
  const done = ended + breached;
  const score = done === 0 ? 50 : Math.min(100, Math.max(0, Math.round((ended / done) * 100)));

  await prisma.partnershipDirectoryListing.updateMany({
    where: { guildId },
    data: { reliabilityScore: score, partnershipsDone: done },
  });
}

function httpsOnly(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^https:\/\//i.test(trimmed) ? trimmed.slice(0, 500) : null;
}
