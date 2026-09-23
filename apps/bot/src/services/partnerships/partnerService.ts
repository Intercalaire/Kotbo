/**
 * Fiches partenaires et interlocuteurs.
 *
 * La fiche survit aux dossiers : un même partenaire enchaîne souvent un
 * échange de pubs, puis un événement, puis un sponsor. Ressaisir son nom, son
 * invitation et ses contacts à chaque fois garantissait trois versions
 * divergentes de la même communauté au bout d'un an.
 *
 * Deux choses sont tenues automatiquement ici et ne se saisissent pas :
 * `trustScore`, déduit de l'historique des dossiers, et l'état de l'invitation,
 * vérifié périodiquement - une invitation morte est la première chose qu'on
 * veut voir avant de relancer quelqu'un.
 */
import type { Partner, Prisma } from '@prisma/client';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getClient } from '../../utils/client.js';
import type { PartnershipActor } from './partnershipService.js';

export interface CreatePartnerInput {
  guildId: string | null;
  kind?: string;
  displayName: string;
  shortName?: string | null;
  description?: string | null;
  tags?: string[];
  locale?: string | null;
  timezone?: string | null;
  partnerGuildId?: string | null;
  inviteUrl?: string | null;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  accentColor?: string | null;
  memberCount?: number | null;
  externalAudience?: number | null;
  links?: { label: string; url: string }[];
}

const ALLOWED_KINDS = new Set(['SERVER', 'PERSON', 'ORGANIZATION']);

export async function createPartner(input: CreatePartnerInput, actor: PartnershipActor): Promise<Partner> {
  const kind = input.kind && ALLOWED_KINDS.has(input.kind) ? input.kind : 'SERVER';

  return prisma.partner.create({
    data: {
      scope: input.guildId ? 'GUILD' : 'PLATFORM',
      guildId: input.guildId,
      kind,
      displayName: input.displayName.slice(0, 120),
      shortName: input.shortName?.slice(0, 40) ?? null,
      description: input.description?.slice(0, 4000) ?? null,
      tags: normalizeTags(input.tags),
      locale: input.locale ?? null,
      timezone: input.timezone ?? null,
      partnerGuildId: normalizeSnowflake(input.partnerGuildId),
      inviteUrl: normalizeHttps(input.inviteUrl),
      iconUrl: normalizeHttps(input.iconUrl),
      bannerUrl: normalizeHttps(input.bannerUrl),
      accentColor: normalizeColor(input.accentColor),
      memberCount: input.memberCount ?? null,
      memberCountAt: input.memberCount != null ? new Date() : null,
      externalAudience: input.externalAudience ?? null,
      links: normalizeLinks(input.links),
      createdByUserId: actor.userId,
    },
  });
}

export async function updatePartner(
  partnerId: string,
  input: Partial<CreatePartnerInput>,
): Promise<Partner> {
  const data: Prisma.PartnerUpdateInput = {};

  if (input.displayName !== undefined) data.displayName = input.displayName.slice(0, 120);
  if (input.shortName !== undefined) data.shortName = input.shortName?.slice(0, 40) ?? null;
  if (input.description !== undefined) data.description = input.description?.slice(0, 4000) ?? null;
  if (input.tags !== undefined) data.tags = normalizeTags(input.tags);
  if (input.locale !== undefined) data.locale = input.locale;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.kind !== undefined && ALLOWED_KINDS.has(input.kind)) data.kind = input.kind;
  if (input.partnerGuildId !== undefined) data.partnerGuildId = normalizeSnowflake(input.partnerGuildId);
  if (input.inviteUrl !== undefined) {
    data.inviteUrl = normalizeHttps(input.inviteUrl);
    // Une invitation qui change n'a pas encore été vérifiée : l'état précédent
    // ne dit plus rien de la nouvelle.
    data.inviteState = null;
    data.inviteCheckedAt = null;
  }
  if (input.iconUrl !== undefined) data.iconUrl = normalizeHttps(input.iconUrl);
  if (input.bannerUrl !== undefined) data.bannerUrl = normalizeHttps(input.bannerUrl);
  if (input.accentColor !== undefined) data.accentColor = normalizeColor(input.accentColor);
  if (input.memberCount !== undefined) {
    data.memberCount = input.memberCount;
    data.memberCountAt = new Date();
  }
  if (input.externalAudience !== undefined) data.externalAudience = input.externalAudience;
  if (input.links !== undefined) data.links = normalizeLinks(input.links) ?? undefined;

  return prisma.partner.update({ where: { id: partnerId }, data });
}

/**
 * Bloque une fiche. Le blocage n'efface rien et n'annule aucun dossier en
 * cours : il empêche seulement d'en ouvrir un nouveau. Rompre un partenariat
 * actif reste une décision distincte, qui demande son propre motif.
 */
export async function setPartnerBlocked(
  partnerId: string,
  blocked: boolean,
  reason: string | null,
): Promise<Partner> {
  return prisma.partner.update({
    where: { id: partnerId },
    data: {
      blocked,
      blockedReason: blocked ? (reason?.slice(0, 500) ?? null) : null,
      blockedAt: blocked ? new Date() : null,
    },
  });
}

// ─── Interlocuteurs ──────────────────────────────────────────────────────────

export interface ContactInput {
  userId?: string | null;
  displayName: string;
  role?: string;
  primary?: boolean;
  externalContact?: string | null;
  notes?: string | null;
  representative?: boolean;
}

/**
 * Ajoute un interlocuteur. Un seul principal par fiche : désigner un second
 * dégrade le premier, plutôt que de laisser deux « principaux » que rien ne
 * départage.
 */
export async function addPartnerContact(partnerId: string, input: ContactInput) {
  const contact = await prisma.partnerContact.create({
    data: {
      partnerId,
      userId: normalizeSnowflake(input.userId),
      displayName: input.displayName.slice(0, 100),
      role: input.role?.slice(0, 40) ?? 'manager',
      primary: input.primary ?? false,
      externalContact: input.externalContact?.slice(0, 200) ?? null,
      notes: input.notes?.slice(0, 2000) ?? null,
      representative: input.representative ?? true,
    },
  });

  if (contact.primary) await demoteOtherPrimaries(partnerId, contact.id);
  return contact;
}

export async function updatePartnerContact(contactId: string, input: Partial<ContactInput>) {
  const data: Prisma.PartnerContactUpdateInput = {};
  if (input.userId !== undefined) data.userId = normalizeSnowflake(input.userId);
  if (input.displayName !== undefined) data.displayName = input.displayName.slice(0, 100);
  if (input.role !== undefined) data.role = input.role.slice(0, 40);
  if (input.primary !== undefined) data.primary = input.primary;
  if (input.externalContact !== undefined) data.externalContact = input.externalContact?.slice(0, 200) ?? null;
  if (input.notes !== undefined) data.notes = input.notes?.slice(0, 2000) ?? null;
  if (input.representative !== undefined) data.representative = input.representative;

  const contact = await prisma.partnerContact.update({ where: { id: contactId }, data });
  if (contact.primary) await demoteOtherPrimaries(contact.partnerId, contact.id);
  return contact;
}

export async function removePartnerContact(contactId: string): Promise<void> {
  await prisma.partnerContact.delete({ where: { id: contactId } });
}

async function demoteOtherPrimaries(partnerId: string, keepId: string): Promise<void> {
  await prisma.partnerContact.updateMany({
    where: { partnerId, id: { not: keepId }, primary: true },
    data: { primary: false },
  });
}

/**
 * Appelée à chaque message sur les serveurs où le module tourne. L'engagement
 * « représentant présent » ne regarde que les 30 derniers jours : une écriture
 * par membre toutes les `CONTACT_PRESENCE_INTERVAL_MS` suffit largement.
 */
const CONTACT_PRESENCE_INTERVAL_MS = 10 * 60 * 1000;
const CONTACT_PRESENCE_MAX_TRACKED = 50_000;
const lastContactPresenceWrite = new Map<string, number>();

/**
 * Note le passage d'un représentant sur le serveur. Alimente l'engagement
 * « représentant présent », qui sans cela ne pourrait se constater qu'à la
 * main.
 */
export async function touchContactPresence(userId: string): Promise<void> {
  const now = Date.now();
  const last = lastContactPresenceWrite.get(userId);
  if (last !== undefined && now - last < CONTACT_PRESENCE_INTERVAL_MS) return;
  if (lastContactPresenceWrite.size >= CONTACT_PRESENCE_MAX_TRACKED) lastContactPresenceWrite.clear();
  lastContactPresenceWrite.set(userId, now);

  await prisma.partnerContact.updateMany({
    where: { userId },
    data: { lastSeenAt: new Date() },
  });
}

// ─── Vérification des invitations ────────────────────────────────────────────

const INVITE_CODE_PATTERN = /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/([a-zA-Z0-9-]{2,32})/i;

/**
 * Vérifie qu'une invitation partenaire mène toujours quelque part, et en
 * profite pour rafraîchir l'effectif annoncé.
 *
 * Une invitation morte ne bloque rien : elle est signalée. Le partenaire peut
 * très bien être toujours actif et avoir simplement renouvelé son lien.
 */
export async function refreshPartnerInvite(partnerId: string): Promise<'valid' | 'expired' | 'unknown'> {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (!partner?.inviteUrl) return 'unknown';

  const code = INVITE_CODE_PATTERN.exec(partner.inviteUrl)?.[1];
  if (!code) {
    await prisma.partner.update({
      where: { id: partnerId },
      data: { inviteState: 'unknown', inviteCheckedAt: new Date() },
    });
    return 'unknown';
  }

  const invite = await getClient()
    .fetchInvite(code)
    .catch(() => null);

  const state = invite ? 'valid' : 'expired';
  await prisma.partner.update({
    where: { id: partnerId },
    data: {
      inviteState: state,
      inviteCheckedAt: new Date(),
      ...(invite?.guild?.id ? { partnerGuildId: invite.guild.id } : {}),
      ...(invite?.memberCount ? { memberCount: invite.memberCount, memberCountAt: new Date() } : {}),
    },
  });

  if (!invite) {
    logger.info('Partenariats : invitation partenaire expiree', { partnerId, code });
  }
  return state;
}

/**
 * Ce qu'une invitation Discord dit du serveur qu'elle ouvre.
 *
 * Sert a remplir une fiche partenaire a partir du seul lien, plutot que de
 * faire recopier a la main un nom, une description et un effectif qui seront
 * faux le mois suivant. Rien n'est ecrit ici : la fonction propose, le
 * formulaire dispose.
 */
export interface InviteLookup {
  code: string;
  guildId: string | null;
  displayName: string | null;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  memberCount: number | null;
  /** Membres connectes au moment de la lecture. Donne une idee de l'activite. */
  onlineCount: number | null;
  /** Salon d'arrivee, quand l'invitation en designe un. */
  channelName: string | null;
  /** Invitation permanente : une invitation qui expire rendra la fiche caduque. */
  permanent: boolean;
}

/**
 * Resout une invitation sans rien enregistrer.
 *
 * Accepte une URL complete ou un code nu : les gens collent l'un ou l'autre
 * sans y penser, et refuser le second n'apporterait rien.
 */
export async function lookupInvite(raw: string): Promise<InviteLookup | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const code = INVITE_CODE_PATTERN.exec(trimmed)?.[1]
    ?? (/^[a-zA-Z0-9-]{2,32}$/.test(trimmed) ? trimmed : null);
  if (!code) return null;

  // `withCounts` demande a Discord les effectifs : sans lui, `memberCount` est
  // absent et la fiche se remplirait sans le seul chiffre qui interesse.
  const invite = await getClient()
    .fetchInvite(code)
    .catch(() => null);
  if (!invite) return null;

  const guild = invite.guild;
  return {
    code: invite.code,
    guildId: guild?.id ?? null,
    displayName: guild?.name ?? null,
    description: guild && 'description' in guild ? (guild.description ?? null) : null,
    iconUrl: guild && 'iconURL' in guild ? (guild.iconURL({ size: 256, extension: 'png' }) ?? null) : null,
    bannerUrl: guild && 'bannerURL' in guild ? (guild.bannerURL({ size: 1024, extension: 'png' }) ?? null) : null,
    memberCount: invite.memberCount ?? null,
    onlineCount: invite.presenceCount ?? null,
    channelName: invite.channel && 'name' in invite.channel ? invite.channel.name : null,
    permanent: invite.maxAge === 0,
  };
}

// ─── Confiance ───────────────────────────────────────────────────────────────

/**
 * Recalcule le score de confiance d'un partenaire à partir de son historique.
 *
 * Un score et non un simple compteur, pour que « trois partenariats menés à
 * terme » et « un partenariat rompu pour non-respect » ne se lisent pas de la
 * même façon. Les dossiers en cours ne comptent pas : ils n'ont encore rien
 * prouvé.
 */
export async function recomputeTrustScore(partnerId: string): Promise<number> {
  const partnerships = await prisma.partnership.findMany({
    where: { partnerId, stage: { in: ['ENDED', 'BREACHED', 'ACTIVE', 'RENEWAL'] } },
    select: { stage: true, healthScore: true },
  });

  const reports = await prisma.partnerReputationReport.count({
    where: { partnerId, withdrawnAt: null },
  });

  let score = 50;
  for (const partnership of partnerships) {
    if (partnership.stage === 'ENDED') score += 10;
    else if (partnership.stage === 'BREACHED') score -= 25;
    else score += Math.round((partnership.healthScore - 50) / 10);
  }
  score -= reports * 10;

  const bounded = Math.min(100, Math.max(0, score));
  await prisma.partner.update({ where: { id: partnerId }, data: { trustScore: bounded } });
  return bounded;
}

// ─── Normalisation ───────────────────────────────────────────────────────────

function normalizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().slice(0, 30);
    if (tag) seen.add(tag);
  }
  return Array.from(seen).slice(0, 12);
}

/** Les identifiants Discord sont des entiers de 17 à 20 chiffres, rien d'autre. */
function normalizeSnowflake(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{17,20}$/.test(trimmed) ? trimmed : null;
}

/**
 * Seul `https` est retenu. Ces URL finissent dans des embeds publiés et dans
 * le dashboard : accepter `javascript:` ou `data:` reviendrait à laisser un
 * partenaire choisir ce que le navigateur du staff exécute.
 */
function normalizeHttps(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) return null;
  return trimmed.slice(0, 500);
}

function normalizeColor(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeLinks(
  links: { label: string; url: string }[] | undefined,
): Prisma.InputJsonValue | undefined {
  if (!Array.isArray(links)) return undefined;

  const cleaned = links
    .map((link) => ({ label: String(link.label ?? '').trim().slice(0, 40), url: normalizeHttps(link.url) }))
    .filter((link): link is { label: string; url: string } => Boolean(link.label && link.url))
    .slice(0, 10);

  return cleaned as unknown as Prisma.InputJsonValue;
}
