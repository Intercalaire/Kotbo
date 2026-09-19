/**
 * Mesure des engagements.
 *
 * Un engagement qui ne se vérifie que si quelqu'un y pense n'est pas un
 * engagement, c'est une note. Ce fichier constate, période par période, ce qui
 * a été tenu - et laisse une trace de ce qui le prouve (`evidence`), sans
 * laquelle une rupture contestée n'aurait aucun arbitre.
 *
 * Trois régimes de constat, déclarés dans `PARTNERSHIP_COMMITMENT_META` :
 *   - `AUTOMATIC`   : le bot compte lui-même (publications, arrivées, présence) ;
 *   - `RECIPROCITY` : suppose de voir chez le partenaire, donc le pont Kotbo ou
 *                     un salon observable ; sans cela, l'état reste inchangé
 *                     plutôt que faussement négatif ;
 *   - `DECLARATIVE` : pointé par le staff, et seul le pointage fait foi.
 *
 * Le manquement d'une période ne rompt rien : `failureStreak` compte les échecs
 * consécutifs et la rupture automatique, si elle est activée, n'intervient
 * qu'au-delà de la tolérance configurée. Une suppression accidentelle arrive ;
 * trois fois de suite, non.
 */
import type { PartnershipCommitment, PartnershipCommitmentState } from '@prisma/client';
import { getPartnershipCommitment } from '@kotbo/contracts';
import { kotboEventBus } from '@kotbo/core';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getPartnershipSettings } from './partnershipSettings.js';
import { recordPartnershipEvent, sendPartnershipAlert, shouldFireAlert } from './partnershipEvents.js';

// ─── Périodes ────────────────────────────────────────────────────────────────

export interface PeriodBounds {
  start: Date;
  end: Date;
}

/**
 * Bornes de la période courante d'un engagement.
 *
 * `total` couvre toute la durée du partenariat : l'engagement porte alors sur
 * un cumul, pas sur un rythme.
 */
export function currentPeriod(period: string | null, partnershipStart: Date | null): PeriodBounds {
  const now = new Date();

  switch (period) {
    case 'day': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }
    case 'week': {
      const start = new Date(now);
      // Semaine commençant le lundi : `getDay()` renvoie 0 pour dimanche.
      const offset = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - offset);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start, end };
    }
    default: {
      const start = partnershipStart ?? new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getTime() + 86_400_000);
      return { start, end };
    }
  }
}

// ─── Constat ─────────────────────────────────────────────────────────────────

/**
 * Évalue tous les engagements d'un dossier et met à jour leur état.
 *
 * Renvoie la liste de ceux qui viennent de basculer en manquement, pour que
 * l'appelant décide ce qu'il en fait - alerter, relancer, rompre.
 */
export async function evaluatePartnershipCommitments(partnershipId: string): Promise<PartnershipCommitment[]> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    include: { commitments: true, partner: { include: { contacts: true } } },
  });
  if (!partnership) return [];

  const newlyBreached: PartnershipCommitment[] = [];

  for (const commitment of partnership.commitments) {
    if (commitment.state === 'WAIVED' || commitment.state === 'FULFILLED') continue;

    const meta = getPartnershipCommitment(commitment.kind);
    if (!meta) continue;

    // Un engagement pointé à la main garde ce que le staff en a dit : un
    // constat automatique le contredirait sans rien savoir de plus.
    if (meta.measure === 'DECLARATIVE') {
      if (commitment.manualState && commitment.manualState !== commitment.state) {
        await prisma.partnershipCommitment.update({
          where: { id: commitment.id },
          data: { state: commitment.manualState, lastCheckedAt: new Date() },
        });
      }
      continue;
    }

    const bounds = currentPeriod(commitment.targetPeriod, partnership.startAt);
    const measure = await measureCommitment(commitment, partnership.id, bounds, partnership.partner.contacts);
    if (measure === null) continue; // Non mesurable pour l'instant : on ne conclut pas.

    const expected = commitment.targetCount ?? (meta.quantified ? 1 : 1);
    const fulfilled = measure.achieved >= expected;

    await prisma.partnershipCommitmentPeriod.upsert({
      where: { commitmentId_periodStart: { commitmentId: commitment.id, periodStart: bounds.start } },
      create: {
        commitmentId: commitment.id,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        expected,
        achieved: measure.achieved,
        state: fulfilled ? 'FULFILLED' : 'PENDING',
        evidence: measure.evidence as never,
      },
      update: {
        achieved: measure.achieved,
        state: fulfilled ? 'FULFILLED' : 'PENDING',
        evidence: measure.evidence as never,
      },
    });

    const nextState: PartnershipCommitmentState = fulfilled
      ? 'ON_TRACK'
      : periodAlmostOver(bounds)
        ? 'BREACHED'
        : 'AT_RISK';

    const streak = fulfilled ? 0 : nextState === 'BREACHED' ? commitment.failureStreak + 1 : commitment.failureStreak;

    const updated = await prisma.partnershipCommitment.update({
      where: { id: commitment.id },
      data: { state: nextState, failureStreak: streak, lastCheckedAt: new Date() },
    });

    if (nextState === 'BREACHED' && commitment.state !== 'BREACHED') newlyBreached.push(updated);
  }

  return newlyBreached;
}

/** La période touche à sa fin : ce qui n'est pas fait ne le sera pas. */
function periodAlmostOver(bounds: PeriodBounds): boolean {
  const total = bounds.end.getTime() - bounds.start.getTime();
  const elapsed = Date.now() - bounds.start.getTime();
  return total > 0 && elapsed / total >= 0.9;
}

interface CommitmentMeasure {
  achieved: number;
  evidence: Record<string, unknown>;
}

/**
 * Compte ce qui a été fait sur la période. `null` signifie « pas mesurable
 * ici » : l'état reste alors inchangé, ce qui vaut mieux qu'un manquement
 * prononcé faute d'information.
 */
async function measureCommitment(
  commitment: PartnershipCommitment,
  partnershipId: string,
  bounds: PeriodBounds,
  contacts: { userId: string | null; representative: boolean; lastSeenAt: Date | null }[],
): Promise<CommitmentMeasure | null> {
  switch (commitment.kind) {
    case 'PROMO_POST':
    case 'CONTENT_RELAY': {
      // L'engagement de notre côté se mesure sur nos propres publications ;
      // celui du partenaire, sur les contrôles de réciprocité.
      if (commitment.party === 'PARTNER') return measureReciprocity(partnershipId, bounds);

      const posts = await prisma.partnershipPromotionPost.count({
        where: {
          promotion: { partnershipId },
          postedAt: { gte: bounds.start, lt: bounds.end },
        },
      });
      return { achieved: posts, evidence: { source: 'promotion_posts', from: bounds.start, to: bounds.end } };
    }

    case 'KEEP_AD_VISIBLE':
      return measureReciprocity(partnershipId, bounds);

    case 'MEMBERS_BROUGHT': {
      const joins = await prisma.partnershipReferral.count({
        where: { partnershipId, joinedAt: { gte: bounds.start, lt: bounds.end } },
      });
      return { achieved: joins, evidence: { source: 'referrals', from: bounds.start, to: bounds.end } };
    }

    case 'REPRESENTATIVE_PRESENT': {
      const representatives = contacts.filter((contact) => contact.representative && contact.userId);
      if (representatives.length === 0) {
        return { achieved: 0, evidence: { source: 'contacts', reason: 'aucun représentant déclaré' } };
      }
      // Vu dans le mois : un représentant n'a pas à écrire tous les jours, il
      // a à rester joignable.
      const cutoff = Date.now() - 30 * 86_400_000;
      const present = representatives.filter(
        (contact) => contact.lastSeenAt && contact.lastSeenAt.getTime() >= cutoff,
      ).length;
      return { achieved: present, evidence: { source: 'presence', present, total: representatives.length } };
    }

    case 'ROLE_GRANTED':
    case 'CHANNEL_ACCESS': {
      const granted = await prisma.partnershipBenefitGrant.count({
        where: { benefit: { partnershipId }, revokedAt: null },
      });
      return { achieved: granted, evidence: { source: 'benefit_grants' } };
    }

    case 'PAYMENT': {
      const received = await prisma.partnershipPayment.count({
        where: { partnershipId, status: 'RECEIVED', settledAt: { gte: bounds.start, lt: bounds.end } },
      });
      return { achieved: received, evidence: { source: 'payments', from: bounds.start, to: bounds.end } };
    }

    default:
      return null;
  }
}

/**
 * Dernier contrôle de réciprocité de la période. Un contrôle injoignable
 * (`UNREACHABLE`) ne compte ni pour ni contre : il dit seulement que le bot
 * n'a pas pu regarder.
 */
async function measureReciprocity(partnershipId: string, bounds: PeriodBounds): Promise<CommitmentMeasure | null> {
  const checks = await prisma.partnershipReciprocityCheck.findMany({
    where: { partnershipId, checkedAt: { gte: bounds.start, lt: bounds.end } },
    orderBy: { checkedAt: 'desc' },
    take: 10,
  });
  const usable = checks.filter((check) => check.result !== 'UNREACHABLE');
  if (usable.length === 0) return null;

  const ok = usable[0].result === 'OK';
  return {
    achieved: ok ? 1 : 0,
    evidence: { source: 'reciprocity', lastResult: usable[0].result, checkedAt: usable[0].checkedAt },
  };
}

// ─── Conséquences ────────────────────────────────────────────────────────────

/**
 * Traite les manquements constatés : alerte, et rupture automatique si le
 * serveur l'a demandée et que la tolérance est dépassée.
 *
 * La rupture automatique est éteinte par défaut, et ce fichier ne la décide
 * jamais seul : il appelle le rapporteur fourni par l'appelant, qui sait, lui,
 * passer par `changePartnershipStage`.
 */
export async function handleBreachedCommitments(
  partnershipId: string,
  breached: PartnershipCommitment[],
  breakPartnership: (reason: string) => Promise<void>,
): Promise<void> {
  if (breached.length === 0) return;

  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    include: { partner: { select: { displayName: true } } },
  });
  if (!partnership?.guildId) return;

  const settings = await getPartnershipSettings(partnership.guildId);

  for (const commitment of breached) {
    await recordPartnershipEvent({
      partnershipId,
      kind: 'commitment_failed',
      summary: `Engagement non tenu : ${commitment.label ?? commitment.kind}.`,
      payload: { commitmentId: commitment.id, kind: commitment.kind, streak: commitment.failureStreak },
    });

    try {
      kotboEventBus.publish('partnership:commitment-failed', {
        guildId: partnership.guildId,
        partnershipId,
        partnerName: partnership.partner.displayName,
        commitmentId: commitment.id,
        kind: commitment.kind,
        label: commitment.label,
        failureStreak: commitment.failureStreak,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.warn('Partenariats : manquement non publie sur le bus', { commitmentId: commitment.id, error });
    }
  }

  if (await shouldFireAlert(`breach:${partnershipId}`, 24)) {
    await sendPartnershipAlert({
      guildId: partnership.guildId,
      title: 'Engagement non tenu',
      description: `${partnership.partner.displayName} : ${breached.length} engagement(s) en manquement.`,
      tone: 'warning',
      fields: breached.slice(0, 5).map((commitment) => ({
        name: commitment.label ?? commitment.kind,
        value: `${commitment.failureStreak} période(s) consécutive(s) manquée(s)`,
      })),
      ownerUserId: partnership.ownerUserId,
      link: `/partnerships/${partnershipId}`,
    });
  }

  if (!settings.autoBreachOnFailure) return;

  const persistent = breached.filter((commitment) => commitment.failureStreak > settings.reciprocityGraceCount);
  if (persistent.length === 0) return;

  const reason = `Rupture automatique : ${persistent
    .map((commitment) => commitment.label ?? commitment.kind)
    .join(', ')} non tenu(s) sur ${settings.reciprocityGraceCount + 1} périodes.`;

  await breakPartnership(reason).catch((error) => {
    logger.error('Partenariats : rupture automatique impossible', { partnershipId, error });
  });
}

// ─── Saisie ──────────────────────────────────────────────────────────────────

export interface CommitmentInput {
  party?: 'US' | 'PARTNER' | 'BOTH';
  kind: string;
  label?: string | null;
  targetCount?: number | null;
  targetPeriod?: string | null;
  targetRef?: string | null;
}

export async function addCommitment(partnershipId: string, input: CommitmentInput) {
  const meta = getPartnershipCommitment(input.kind);
  if (!meta) throw new Error(`Engagement inconnu : ${input.kind}`);

  return prisma.partnershipCommitment.create({
    data: {
      partnershipId,
      party: input.party ?? 'PARTNER',
      kind: input.kind,
      label: input.label?.slice(0, 200) ?? meta.label,
      targetCount: meta.quantified ? (input.targetCount ?? 1) : null,
      targetPeriod: meta.quantified ? (input.targetPeriod ?? 'month') : null,
      targetRef: input.targetRef ?? null,
    },
  });
}

/** Pointage manuel. Écrase le constat automatique tant qu'il n'est pas levé. */
export async function setCommitmentManualState(
  commitmentId: string,
  state: PartnershipCommitmentState | null,
  actorUserId: string,
  note?: string,
) {
  const commitment = await prisma.partnershipCommitment.update({
    where: { id: commitmentId },
    data: {
      manualState: state,
      manualByUserId: state ? actorUserId : null,
      manualAt: state ? new Date() : null,
      manualNote: note?.slice(0, 500) ?? null,
      ...(state ? { state, failureStreak: state === 'BREACHED' ? 1 : 0 } : {}),
    },
  });

  await recordPartnershipEvent({
    partnershipId: commitment.partnershipId,
    kind: 'commitment_pointed',
    summary: state
      ? `Engagement « ${commitment.label ?? commitment.kind} » pointé : ${state}.`
      : `Pointage retiré de « ${commitment.label ?? commitment.kind} ».`,
    actorUserId,
    source: 'dashboard',
  });

  return commitment;
}

export async function removeCommitment(commitmentId: string): Promise<void> {
  await prisma.partnershipCommitment.delete({ where: { id: commitmentId } });
}
