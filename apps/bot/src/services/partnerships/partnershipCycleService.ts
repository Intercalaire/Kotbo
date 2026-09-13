/**
 * Balayages périodiques du module Partenariats.
 *
 * Un balayage par serveur actif plutôt qu'une tâche planifiée par dossier : la
 * liste des dossiers change à chaque enregistrement, et un balayage reprend
 * tout seul après un redémarrage. Le coût est borné par le nombre de serveurs
 * ayant le module allumé, pas par le nombre de partenariats.
 *
 * Trois rythmes :
 *   - horaire  : publications dues, contrôles de réciprocité, engagements ;
 *   - quotidien: échéances, renouvellements, rétention, matchmaking, archivage ;
 *   - hebdo    : bilan périodique envoyé au staff.
 */
import type { Client } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getPartnershipSettings, listActivePartnershipGuildIds } from './partnershipSettings.js';
import { recordPartnershipEvent, sendPartnershipAlert, shouldFireAlert } from './partnershipEvents.js';
import { changePartnershipStage } from './partnershipService.js';
import { evaluatePartnershipCommitments, handleBreachedCommitments } from './partnershipCommitmentService.js';
import { runPromotionCycle, runReciprocityCycle } from './partnershipPromotionService.js';
import { runPaymentCycle, formatAmount } from './partnershipFinanceService.js';
import {
  closeRetentionWindows,
  recomputeHealthScore,
  getPartnershipReport,
} from './partnershipAttributionService.js';
import { computeMatches, expireProposals, refreshReliability } from './partnershipDirectoryService.js';
import { refreshPartnerInvite } from './partnerService.js';

// ─── Horaire ─────────────────────────────────────────────────────────────────

/**
 * Publications dues, contrôles de réciprocité, constat des engagements.
 *
 * L'ordre compte : on publie d'abord, on contrôle ensuite, on constate en
 * dernier. Constater avant de publier reprocherait au partenaire une période
 * que le bot n'a pas encore honorée de son côté.
 */
export async function runHourlyPartnershipCycle(client: Client): Promise<void> {
  const published = await runPromotionCycle(client);
  const guildIds = await listActivePartnershipGuildIds();

  let checked = 0;
  let breaches = 0;

  for (const guildId of guildIds) {
    checked += await runReciprocityCycle(client, guildId).catch(() => 0);

    const partnerships = await prisma.partnership.findMany({
      where: { guildId, stage: { in: ['ACTIVE', 'RENEWAL'] } },
      select: { id: true },
      take: 200,
    });

    for (const partnership of partnerships) {
      const failed = await evaluatePartnershipCommitments(partnership.id).catch((error) => {
        logger.warn('Partenariats : evaluation des engagements en echec', { partnershipId: partnership.id, error });
        return [];
      });

      if (failed.length === 0) continue;
      breaches += failed.length;

      await handleBreachedCommitments(partnership.id, failed, async (reason) => {
        await changePartnershipStage({
          partnershipId: partnership.id,
          stage: 'BREACHED',
          reason,
          actor: { userId: 'bot', label: 'Kotbo', source: 'bot' },
        });
      });
    }
  }

  logger.debug('Partenariats', `Cycle horaire : ${published} publication(s), ${checked} controle(s), ${breaches} manquement(s)`);
}

// ─── Quotidien ───────────────────────────────────────────────────────────────

/**
 * Échéances, renouvellements, rétention, entretien des fiches.
 *
 * Tout ce qui se compte en jours passe ici : le faire à l'heure produirait
 * vingt-quatre fois le même travail pour le même résultat.
 */
export async function runDailyPartnershipCycle(client: Client): Promise<void> {
  const guildIds = await listActivePartnershipGuildIds();
  await expireProposals();

  for (const guildId of guildIds) {
    const settings = await getPartnershipSettings(guildId);

    await runPaymentCycle(guildId).catch((error) => {
      logger.warn('Partenariats : cycle des echeances en echec', { guildId, error });
    });

    await closeRetentionWindows(guildId).catch(() => 0);
    await flagRenewals(guildId, settings.renewalNoticeDays);
    await archiveFinished(guildId, settings.autoArchiveAfterDays);
    await refreshReliability(guildId).catch(() => null);

    if (settings.matchmakingEnabled) await computeMatches(guildId).catch(() => 0);

    // Santé des dossiers vivants, et fraîcheur des invitations partenaires.
    const partnerships = await prisma.partnership.findMany({
      where: { guildId, stage: { in: ['ACTIVE', 'RENEWAL'] } },
      select: { id: true, partnerId: true },
      take: 200,
    });
    for (const partnership of partnerships) {
      await recomputeHealthScore(partnership.id).catch(() => 50);
      await refreshPartnerInvite(partnership.partnerId).catch(() => 'unknown');
    }
  }

  logger.debug('Partenariats', `Cycle quotidien termine sur ${guildIds.length} serveur(s)`);
  void client;
}

/**
 * Bascule en renouvellement les dossiers qui approchent de leur terme, et
 * prévient. Un dossier qui expire sans que personne ne l'ait vu venir est la
 * façon la plus banale de perdre un partenaire.
 */
async function flagRenewals(guildId: string, noticeDays: number): Promise<void> {
  const horizon = new Date(Date.now() + noticeDays * 86_400_000);

  const ending = await prisma.partnership.findMany({
    where: { guildId, stage: 'ACTIVE', endAt: { not: null, lte: horizon } },
    include: { partner: { select: { displayName: true } } },
    take: 100,
  });

  for (const partnership of ending) {
    await changePartnershipStage({
      partnershipId: partnership.id,
      stage: 'RENEWAL',
      actor: { userId: 'bot', label: 'Kotbo', source: 'bot' },
    }).catch(() => null);

    if (!(await shouldFireAlert(`renewal:${partnership.id}`, 24 * 7))) continue;

    await sendPartnershipAlert({
      guildId,
      title: 'Partenariat à renouveler',
      description: `${partnership.partner.displayName} arrive à échéance le ${partnership.endAt?.toLocaleDateString('fr-FR')}.`,
      tone: 'warning',
      fields: partnership.autoRenew
        ? [{ name: 'Reconduction', value: `Tacite, ${partnership.renewDays ?? 0} jours` }]
        : undefined,
      ownerUserId: partnership.ownerUserId,
      link: `/partnerships/${partnership.id}`,
    });
  }

  // Reconduction tacite : on repousse l'échéance et on revient en actif.
  const renewable = await prisma.partnership.findMany({
    where: { guildId, stage: 'RENEWAL', autoRenew: true, endAt: { not: null, lte: new Date() } },
    select: { id: true, endAt: true, renewDays: true },
    take: 100,
  });

  for (const partnership of renewable) {
    const days = partnership.renewDays ?? 30;
    await prisma.partnership.update({
      where: { id: partnership.id },
      data: { endAt: new Date(Date.now() + days * 86_400_000) },
    });
    await changePartnershipStage({
      partnershipId: partnership.id,
      stage: 'ACTIVE',
      actor: { userId: 'bot', label: 'Kotbo', source: 'bot' },
    }).catch(() => null);

    await recordPartnershipEvent({
      partnershipId: partnership.id,
      kind: 'renewed',
      summary: `Reconduit tacitement pour ${days} jours.`,
    });
  }
}

/** Sort des vues courantes les dossiers terminés depuis assez longtemps. */
async function archiveFinished(guildId: string, afterDays: number): Promise<void> {
  if (afterDays <= 0) return;

  const cutoff = new Date(Date.now() - afterDays * 86_400_000);
  const finished = await prisma.partnership.findMany({
    where: { guildId, stage: { in: ['ENDED', 'BREACHED', 'REJECTED'] }, endedAt: { lte: cutoff } },
    select: { id: true },
    take: 100,
  });

  for (const partnership of finished) {
    await changePartnershipStage({
      partnershipId: partnership.id,
      stage: 'ARCHIVED',
      actor: { userId: 'bot', label: 'Kotbo', source: 'bot' },
    }).catch(() => null);
  }
}

// ─── Bilan périodique ────────────────────────────────────────────────────────

/**
 * Récapitulatif envoyé au salon du digest : ce que les partenariats ont
 * rapporté, ce qui tient, ce qui dérape, ce qui arrive à échéance.
 *
 * Un bilan plutôt qu'une alerte de plus : il se lit à froid, et c'est le seul
 * format qui permet de comparer les partenaires entre eux.
 */
export async function runPartnershipDigest(client: Client, frequency: 'weekly' | 'monthly'): Promise<void> {
  const guildIds = await listActivePartnershipGuildIds();

  for (const guildId of guildIds) {
    const settings = await getPartnershipSettings(guildId);
    if (settings.digestFrequency !== frequency) continue;

    const channelId = settings.digestChannelId ?? settings.staffChannelId;
    if (!channelId) continue;

    const partnerships = await prisma.partnership.findMany({
      where: { guildId, stage: { in: ['ACTIVE', 'RENEWAL'] } },
      include: { partner: { select: { displayName: true } } },
      take: 50,
    });
    if (partnerships.length === 0) continue;

    const rows: string[] = [];
    let totalJoins = 0;

    for (const partnership of partnerships) {
      const report = await getPartnershipReport(partnership.id);
      if (!report) continue;

      totalJoins += report.joins;
      rows.push(
        `**${partnership.partner.displayName}** — ${report.joins} arrivée(s), ` +
          `${report.retentionRate ?? '—'}% retenus, santé ${partnership.healthScore}/100` +
          (partnership.endAt ? `, échéance le ${partnership.endAt.toLocaleDateString('fr-FR')}` : ''),
      );
    }

    const payments = settings.financeEnabled
      ? await prisma.partnershipPayment.findMany({
          where: { partnership: { guildId }, status: { in: ['DUE', 'LATE'] } },
          take: 10,
        })
      : [];

    const description = [
      `${partnerships.length} partenariat(s) actif(s), ${totalJoins} arrivée(s) attribuée(s) au total.`,
      '',
      ...rows.slice(0, 20),
      ...(payments.length > 0
        ? [
            '',
            `**Échéances en attente :** ${payments
              .map((payment) => formatAmount(payment.amountCents, payment.currency))
              .join(', ')}`,
          ]
        : []),
    ].join('\n');

    await sendPartnershipAlert({
      guildId,
      title: frequency === 'weekly' ? 'Bilan hebdomadaire des partenariats' : 'Bilan mensuel des partenariats',
      description: description.slice(0, 4000),
      tone: 'info',
      link: '/partnerships',
      client,
    });
  }
}
