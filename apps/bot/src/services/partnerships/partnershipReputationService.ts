/**
 * Signalements, liste de blocage et réputation partagée entre serveurs.
 *
 * ── Pourquoi rien n'est automatique ─────────────────────────────────────────
 *
 * Un signal qui refuserait un partenariat tout seul deviendrait une arme :
 * deux serveurs en conflit se bloqueraient mutuellement le lendemain, et la
 * première communauté à comprendre le mécanisme s'en servirait contre ses
 * concurrents. Le réseau **informe**, il ne décide jamais. Le staff qui
 * consulte voit combien de signalements, de quelle nature, sur quelle période -
 * et tranche.
 *
 * ── Pourquoi l'agrégat est anonyme ──────────────────────────────────────────
 *
 * `PartnerReputationSignal` ne porte aucun identifiant de serveur signaleur.
 * Afficher qui a signalé reviendrait à désigner un accusateur à une communauté
 * mécontente : plus personne ne signalerait. Le nombre de serveurs distincts
 * est en revanche publié, parce que trois signalements venus de trois serveurs
 * ne disent pas la même chose que trois signalements du même.
 *
 * ── Les deux verrous du partage ─────────────────────────────────────────────
 *
 * Contribuer (`reputationShare`) et consulter (`reputationConsume`) sont deux
 * réglages distincts, tous deux éteints par défaut. Et seuls les signalements
 * graves (gravité 2 ou 3) remontent au réseau : un désaccord de calendrier
 * reste une affaire locale.
 */
import type { PartnerReputationReport } from '@prisma/client';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getPartnershipSettings } from './partnershipSettings.js';
import { recomputeTrustScore } from './partnerService.js';

/** Motifs de signalement. Fermé : une liste libre rendrait l'agrégat illisible. */
export const REPUTATION_REASONS = [
  'unmet_commitment',
  'deleted_ad',
  'ghosting',
  'scam',
  'harassment',
  'raid',
  'other',
] as const;
export type ReputationReason = (typeof REPUTATION_REASONS)[number];

export const REPUTATION_REASON_LABELS: Record<ReputationReason, string> = {
  unmet_commitment: 'Engagements non tenus',
  deleted_ad: 'Publicité supprimée sans prévenir',
  ghosting: 'Disparition en cours de partenariat',
  scam: 'Escroquerie ou promesse non honorée',
  harassment: 'Comportement hostile envers nos membres',
  raid: 'Raid ou attaque organisée',
  other: 'Autre',
};

/** Gravité à partir de laquelle un signalement peut remonter au réseau. */
const NETWORK_SEVERITY_FLOOR = 2;

export interface ReportInput {
  reporterGuildId: string;
  partnerId: string;
  reason: string;
  detail?: string | null;
  severity?: number;
  reportedByUserId: string;
}

/**
 * Enregistre un signalement local, et ne le partage que si le serveur a activé
 * la contribution et que la gravité le justifie.
 */
export async function reportPartner(input: ReportInput): Promise<PartnerReputationReport> {
  if (!REPUTATION_REASONS.includes(input.reason as ReputationReason)) {
    throw new Error(`Motif de signalement inconnu : ${input.reason}`);
  }

  const partner = await prisma.partner.findUnique({
    where: { id: input.partnerId },
    select: { partnerGuildId: true, guildId: true },
  });
  if (!partner) throw new Error('Fiche partenaire introuvable.');
  if (partner.guildId !== input.reporterGuildId) {
    throw new Error("Cette fiche n'appartient pas à ce serveur.");
  }

  const settings = await getPartnershipSettings(input.reporterGuildId);
  const severity = Math.min(3, Math.max(1, input.severity ?? 1));
  const shared = settings.reputationShare && severity >= NETWORK_SEVERITY_FLOOR && Boolean(partner.partnerGuildId);

  const report = await prisma.partnerReputationReport.create({
    data: {
      reporterGuildId: input.reporterGuildId,
      partnerId: input.partnerId,
      subjectGuildId: partner.partnerGuildId,
      reason: input.reason,
      detail: input.detail?.slice(0, 2000) ?? null,
      severity,
      shared,
      reportedByUserId: input.reportedByUserId,
    },
  });

  await recomputeTrustScore(input.partnerId);
  if (shared && partner.partnerGuildId) await recomputeNetworkSignal(partner.partnerGuildId);

  return report;
}

/** Retire un signalement. Un litige résolu doit pouvoir s'effacer. */
export async function withdrawReport(reportId: string): Promise<void> {
  const report = await prisma.partnerReputationReport.update({
    where: { id: reportId },
    data: { withdrawnAt: new Date() },
  });

  await recomputeTrustScore(report.partnerId);
  if (report.subjectGuildId) await recomputeNetworkSignal(report.subjectGuildId);
}

/**
 * Recalcule l'agrégat réseau d'un serveur visé.
 *
 * Recalculé entièrement plutôt qu'incrémenté : un retrait de signalement doit
 * faire baisser le compteur, et un compteur incrémental ne sait pas défaire ce
 * qu'il ne se rappelle pas.
 */
export async function recomputeNetworkSignal(subjectGuildId: string): Promise<void> {
  const reports = await prisma.partnerReputationReport.findMany({
    where: { subjectGuildId, shared: true, withdrawnAt: null },
    select: { reporterGuildId: true, reason: true, severity: true, createdAt: true },
  });

  if (reports.length === 0) {
    await prisma.partnerReputationSignal.deleteMany({ where: { subjectGuildId } });
    return;
  }

  const reasonBreakdown: Record<string, number> = {};
  for (const report of reports) {
    reasonBreakdown[report.reason] = (reasonBreakdown[report.reason] ?? 0) + 1;
  }

  const reporters = new Set(reports.map((report) => report.reporterGuildId));
  const dates = reports.map((report) => report.createdAt.getTime());

  await prisma.partnerReputationSignal.upsert({
    where: { subjectGuildId },
    create: {
      subjectGuildId,
      reportCount: reports.length,
      reporterCount: reporters.size,
      severityScore: reports.reduce((total, report) => total + report.severity, 0),
      reasonBreakdown: reasonBreakdown as never,
      firstReportedAt: new Date(Math.min(...dates)),
      lastReportedAt: new Date(Math.max(...dates)),
    },
    update: {
      reportCount: reports.length,
      reporterCount: reporters.size,
      severityScore: reports.reduce((total, report) => total + report.severity, 0),
      reasonBreakdown: reasonBreakdown as never,
      firstReportedAt: new Date(Math.min(...dates)),
      lastReportedAt: new Date(Math.max(...dates)),
    },
  });
}

/**
 * Ce que le réseau dit d'un serveur, pour le staff qui s'apprête à décider.
 *
 * Renvoie `null` si le serveur consultant n'a pas activé la consultation :
 * consulter sans contribuer reste possible, mais il faut l'avoir voulu.
 */
export async function lookupNetworkSignal(consultingGuildId: string, subjectGuildId: string) {
  const settings = await getPartnershipSettings(consultingGuildId);
  if (!settings.reputationConsume) return null;

  const signal = await prisma.partnerReputationSignal.findUnique({ where: { subjectGuildId } });
  if (!signal) return null;

  return {
    reportCount: signal.reportCount,
    reporterCount: signal.reporterCount,
    severityScore: signal.severityScore,
    reasonBreakdown: signal.reasonBreakdown as Record<string, number> | null,
    firstReportedAt: signal.firstReportedAt,
    lastReportedAt: signal.lastReportedAt,
    // Rappelé à chaque lecture, pour que l'interface ne puisse pas le présenter
    // comme un verdict.
    advisory: "Élément d'appréciation : le réseau informe, il ne décide pas.",
  };
}

/** Signalements émis par un serveur, pour qu'il puisse les relire et les retirer. */
export async function listOwnReports(guildId: string) {
  return prisma.partnerReputationReport.findMany({
    where: { reporterGuildId: guildId, withdrawnAt: null },
    include: { partner: { select: { id: true, displayName: true, partnerGuildId: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

// ─── Liste de blocage ────────────────────────────────────────────────────────

export async function blockSubject(params: {
  guildId: string;
  subjectType: 'guild' | 'user' | 'name';
  subjectRef: string;
  reason?: string;
  sourcePartnershipId?: string;
  actorUserId: string;
}): Promise<void> {
  await prisma.partnerBlocklistEntry.upsert({
    where: {
      guildId_subjectType_subjectRef: {
        guildId: params.guildId,
        subjectType: params.subjectType,
        subjectRef: params.subjectRef.slice(0, 120),
      },
    },
    create: {
      guildId: params.guildId,
      subjectType: params.subjectType,
      subjectRef: params.subjectRef.slice(0, 120),
      reason: params.reason?.slice(0, 500) ?? null,
      sourcePartnershipId: params.sourcePartnershipId ?? null,
      createdByUserId: params.actorUserId,
    },
    update: { reason: params.reason?.slice(0, 500) ?? null },
  });
}

export async function unblockSubject(entryId: string): Promise<void> {
  await prisma.partnerBlocklistEntry.delete({ where: { id: entryId } }).catch(() => {
    logger.info('Partenariats : entree de blocage deja supprimee', { entryId });
  });
}

export async function listBlocklist(guildId: string) {
  return prisma.partnerBlocklistEntry.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' }, take: 200 });
}

/**
 * Appelé à la rupture d'un partenariat pour non-respect : propose le blocage
 * plutôt que de l'imposer. Rompre et ne plus jamais travailler avec quelqu'un
 * sont deux décisions différentes, et la seconde appartient au staff.
 */
export async function suggestBlockAfterBreach(partnershipId: string): Promise<{
  subjectType: 'guild' | 'name';
  subjectRef: string;
  label: string;
} | null> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    include: { partner: { select: { displayName: true, partnerGuildId: true } } },
  });
  if (!partnership || partnership.stage !== 'BREACHED') return null;

  return partnership.partner.partnerGuildId
    ? { subjectType: 'guild', subjectRef: partnership.partner.partnerGuildId, label: partnership.partner.displayName }
    : { subjectType: 'name', subjectRef: partnership.partner.displayName, label: partnership.partner.displayName };
}
