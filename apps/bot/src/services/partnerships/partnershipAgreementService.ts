/**
 * Accords versionnés et portail invité.
 *
 * Une version acceptée ne se modifie jamais. Modifier après coup ce qui a été
 * convenu retire tout arbitre à la discussion sur un engagement non tenu : la
 * seule façon de changer un accord est d'en proposer une nouvelle version, qui
 * rend la précédente `SUPERSEDED` et repart en acceptation.
 *
 * ── Le portail invité ───────────────────────────────────────────────────────
 *
 * La plupart des partenaires n'ont pas Kotbo. Ils reçoivent un lien porteur
 * d'un jeton, qui donne accès au seul dossier visé - jamais aux notes internes,
 * jamais au reste du serveur. Le jeton n'est stocké qu'en empreinte : le lien
 * complet n'est affiché qu'une fois, à la création. Un lien perdu se révoque et
 * se recrée, il ne se retrouve pas.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { PartnershipAgreement } from '@prisma/client';
import prisma from '../../utils/db.js';
import { recordPartnershipEvent, sendPartnershipAlert } from './partnershipEvents.js';

// ─── Versions ────────────────────────────────────────────────────────────────

/**
 * Rédige une nouvelle version. Toujours en brouillon : proposer est un second
 * geste, pour qu'un accord ne parte pas au partenaire en cours d'écriture.
 */
export async function draftAgreement(
  partnershipId: string,
  body: string,
  actorUserId: string,
): Promise<PartnershipAgreement> {
  const last = await prisma.partnershipAgreement.findFirst({
    where: { partnershipId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const commitments = await prisma.partnershipCommitment.findMany({
    where: { partnershipId },
    select: { party: true, kind: true, label: true, targetCount: true, targetPeriod: true },
  });

  const agreement = await prisma.partnershipAgreement.create({
    data: {
      partnershipId,
      version: (last?.version ?? 0) + 1,
      state: 'DRAFT',
      body: body.slice(0, 20_000),
      commitmentsSnapshot: commitments as never,
      proposedByUserId: actorUserId,
    },
  });

  await recordPartnershipEvent({
    partnershipId,
    kind: 'agreement_drafted',
    summary: `Version ${agreement.version} de l'accord rédigée.`,
    actorUserId,
    source: 'dashboard',
  });

  return agreement;
}

/**
 * Propose la version au partenaire. Les versions antérieures encore en
 * circulation deviennent caduques : deux versions proposées en même temps
 * produiraient deux accords acceptables et contradictoires.
 */
export async function proposeAgreement(agreementId: string, actorUserId: string): Promise<PartnershipAgreement> {
  const agreement = await prisma.partnershipAgreement.findUnique({ where: { id: agreementId } });
  if (!agreement) throw new Error('Version introuvable.');
  if (agreement.state === 'ACCEPTED') throw new Error('Cette version est déjà acceptée.');

  await prisma.partnershipAgreement.updateMany({
    where: {
      partnershipId: agreement.partnershipId,
      id: { not: agreementId },
      state: { in: ['DRAFT', 'PROPOSED'] },
    },
    data: { state: 'SUPERSEDED' },
  });

  const updated = await prisma.partnershipAgreement.update({
    where: { id: agreementId },
    data: { state: 'PROPOSED', proposedAt: new Date(), proposedByUserId: actorUserId },
  });

  await recordPartnershipEvent({
    partnershipId: agreement.partnershipId,
    kind: 'agreement_proposed',
    summary: `Version ${agreement.version} proposée au partenaire.`,
    actorUserId,
    source: 'dashboard',
  });

  return updated;
}

export type AgreementSide = 'us' | 'partner';

/**
 * Enregistre l'acceptation d'une partie. Quand les deux ont accepté, la version
 * devient l'accord de référence et le dossier peut être activé - c'est
 * `assertActivable` qui le vérifie au moment de l'activation.
 */
export async function acceptAgreement(
  agreementId: string,
  side: AgreementSide,
  ref: string,
): Promise<PartnershipAgreement> {
  const agreement = await prisma.partnershipAgreement.findUnique({ where: { id: agreementId } });
  if (!agreement) throw new Error('Version introuvable.');
  if (agreement.state === 'SUPERSEDED' || agreement.state === 'WITHDRAWN') {
    throw new Error("Cette version n'est plus d'actualité.");
  }

  const data =
    side === 'us'
      ? { acceptedByUs: true, acceptedByUsAt: new Date(), acceptedByUsUserId: ref }
      : { acceptedByPartner: true, acceptedByPartnerAt: new Date(), acceptedByPartnerRef: ref };

  const updated = await prisma.partnershipAgreement.update({
    where: { id: agreementId },
    data: {
      ...data,
      state:
        (side === 'us' ? true : agreement.acceptedByUs) && (side === 'partner' ? true : agreement.acceptedByPartner)
          ? 'ACCEPTED'
          : agreement.state,
    },
  });

  await recordPartnershipEvent({
    partnershipId: agreement.partnershipId,
    kind: 'agreement_accepted',
    summary: `Accord version ${agreement.version} accepté par ${side === 'us' ? 'notre équipe' : 'le partenaire'}.`,
    actorUserId: side === 'us' ? ref : null,
    source: side === 'us' ? 'dashboard' : 'guest_portal',
  });

  if (updated.state === 'ACCEPTED') {
    const partnership = await prisma.partnership.findUnique({
      where: { id: agreement.partnershipId },
      include: { partner: { select: { displayName: true } } },
    });
    if (partnership?.guildId) {
      await sendPartnershipAlert({
        guildId: partnership.guildId,
        title: 'Accord accepté des deux côtés',
        description: `${partnership.partner.displayName} : la version ${agreement.version} est signée. Le dossier peut être activé.`,
        tone: 'success',
        ownerUserId: partnership.ownerUserId,
        link: `/partnerships/${partnership.id}`,
      });
    }
  }

  return updated;
}

export async function withdrawAgreement(agreementId: string, actorUserId: string): Promise<void> {
  const agreement = await prisma.partnershipAgreement.update({
    where: { id: agreementId },
    data: { state: 'WITHDRAWN', withdrawnAt: new Date() },
  });

  await recordPartnershipEvent({
    partnershipId: agreement.partnershipId,
    kind: 'agreement_withdrawn',
    summary: `Version ${agreement.version} retirée.`,
    actorUserId,
    source: 'dashboard',
  });
}

/** L'accord qui fait foi : la dernière version acceptée par les deux parties. */
export async function getActiveAgreement(partnershipId: string): Promise<PartnershipAgreement | null> {
  return prisma.partnershipAgreement.findFirst({
    where: { partnershipId, state: 'ACCEPTED', acceptedByUs: true, acceptedByPartner: true },
    orderBy: { version: 'desc' },
  });
}

// ─── Portail invité ──────────────────────────────────────────────────────────

export interface GuestLink {
  /** Jeton en clair. Affiché une fois, jamais stocké tel quel. */
  token: string;
  expiresAt: Date;
  id: string;
}

/**
 * Crée un accès invité. `sign` autorise l'acceptation de l'accord, `view` ne
 * permet que la lecture.
 *
 * Trente jours par défaut : assez pour une négociation, assez court pour qu'un
 * lien oublié dans une conversation ne reste pas valable un an.
 */
export async function createGuestAccess(
  partnershipId: string,
  options: { capability?: 'view' | 'sign'; label?: string; days?: number; actorUserId: string },
): Promise<GuestLink> {
  const token = randomBytes(32).toString('base64url');
  const days = Math.min(180, Math.max(1, options.days ?? 30));
  const expiresAt = new Date(Date.now() + days * 86_400_000);

  const access = await prisma.partnershipGuestAccess.create({
    data: {
      partnershipId,
      tokenHash: hashToken(token),
      label: options.label?.slice(0, 100) ?? null,
      capability: options.capability ?? 'view',
      expiresAt,
      createdByUserId: options.actorUserId,
    },
  });

  await recordPartnershipEvent({
    partnershipId,
    kind: 'guest_access_created',
    summary: `Accès invité créé (${access.capability}), valable ${days} jours.`,
    actorUserId: options.actorUserId,
    source: 'dashboard',
  });

  return { token, expiresAt, id: access.id };
}

/**
 * Résout un jeton. Renvoie `null` pour tout ce qui n'est pas un accès valide -
 * inconnu, révoqué ou expiré - sans distinguer les cas : dire lequel
 * renseignerait qui essaie des jetons au hasard.
 */
export async function resolveGuestAccess(token: string) {
  const access = await prisma.partnershipGuestAccess.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      partnership: {
        include: {
          partner: { select: { displayName: true, iconUrl: true } },
          agreements: { where: { state: { in: ['PROPOSED', 'ACCEPTED'] } }, orderBy: { version: 'desc' }, take: 1 },
          commitments: true,
          documents: { where: { sharedWithPartner: true } },
        },
      },
    },
  });

  if (!access) return null;
  if (access.revokedAt) return null;
  if (access.expiresAt.getTime() < Date.now()) return null;

  await prisma.partnershipGuestAccess.update({
    where: { id: access.id },
    data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
  });

  return access;
}

export async function revokeGuestAccess(accessId: string): Promise<void> {
  await prisma.partnershipGuestAccess.update({
    where: { id: accessId },
    data: { revokedAt: new Date() },
  });
}

/**
 * SHA-256 nu, sans sel : le jeton fait 32 octets aléatoires, il n'y a rien à
 * deviner par force brute ni par dictionnaire. Un sel par jeton empêcherait la
 * recherche par empreinte, qui est précisément ce dont la résolution a besoin.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
