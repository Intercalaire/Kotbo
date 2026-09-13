/**
 * Volet financier des partenariats.
 *
 * Strictement déclaratif : Kotbo n'encaisse rien pour le compte d'un serveur et
 * ne s'interface avec aucun prestataire de paiement ici. Il tient le carnet -
 * qui doit quoi, quand - et rappelle les échéances. C'est la différence entre
 * un sponsor suivi et un sponsor qu'on oublie de relancer.
 *
 * Les montants sont en centimes, dans la devise du serveur. Jamais de nombre à
 * virgule flottante pour de l'argent : `0.1 + 0.2` ne fait pas `0.3`, et une
 * addition d'échéances finirait par diverger du total affiché.
 */
import type { PartnershipPayment, PartnershipPaymentStatus } from '@prisma/client';
import prisma from '../../utils/db.js';
import { getPartnershipSettings } from './partnershipSettings.js';
import { recordPartnershipEvent, sendPartnershipAlert, shouldFireAlert, clearAlertState } from './partnershipEvents.js';
import { bumpDailyMetric } from './partnershipAttributionService.js';

export interface PaymentInput {
  direction?: 'GRANTED' | 'RECEIVED';
  label?: string | null;
  amountCents: number;
  currency?: string;
  dueAt: Date;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
}

export async function addPayment(
  partnershipId: string,
  input: PaymentInput,
  actorUserId: string,
): Promise<PartnershipPayment> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    select: { guildId: true },
  });
  const settings = partnership?.guildId ? await getPartnershipSettings(partnership.guildId) : null;

  const payment = await prisma.partnershipPayment.create({
    data: {
      partnershipId,
      direction: input.direction ?? 'RECEIVED',
      label: input.label?.slice(0, 200) ?? null,
      amountCents: Math.round(input.amountCents),
      currency: (input.currency ?? settings?.currency ?? 'EUR').slice(0, 3).toUpperCase(),
      dueAt: input.dueAt,
      method: input.method?.slice(0, 60) ?? null,
      reference: input.reference?.slice(0, 100) ?? null,
      note: input.note?.slice(0, 1000) ?? null,
      recordedByUserId: actorUserId,
    },
  });

  await recordPartnershipEvent({
    partnershipId,
    kind: 'payment_scheduled',
    summary: `Échéance ajoutée : ${formatAmount(payment.amountCents, payment.currency)} pour le ${payment.dueAt.toLocaleDateString('fr-FR')}.`,
    actorUserId,
    source: 'dashboard',
  });

  return payment;
}

/**
 * Marque une échéance réglée. L'alerte de retard est oubliée du même coup,
 * pour qu'elle puisse resonner si une échéance suivante dérape.
 */
export async function settlePayment(
  paymentId: string,
  actorUserId: string,
  options?: { method?: string; reference?: string; settledAt?: Date },
): Promise<PartnershipPayment> {
  const payment = await prisma.partnershipPayment.update({
    where: { id: paymentId },
    data: {
      status: 'RECEIVED',
      settledAt: options?.settledAt ?? new Date(),
      method: options?.method?.slice(0, 60),
      reference: options?.reference?.slice(0, 100),
    },
  });

  await clearAlertState(`payment:${paymentId}`);
  await bumpDailyMetric(payment.partnershipId, {
    amountCents: payment.direction === 'RECEIVED' ? payment.amountCents : -payment.amountCents,
  });

  await recordPartnershipEvent({
    partnershipId: payment.partnershipId,
    kind: 'payment_settled',
    summary: `Versement enregistré : ${formatAmount(payment.amountCents, payment.currency)}.`,
    actorUserId,
    source: 'dashboard',
  });

  return payment;
}

export async function setPaymentStatus(
  paymentId: string,
  status: PartnershipPaymentStatus,
  actorUserId: string,
): Promise<PartnershipPayment> {
  const payment = await prisma.partnershipPayment.update({ where: { id: paymentId }, data: { status } });

  await recordPartnershipEvent({
    partnershipId: payment.partnershipId,
    kind: 'payment_status',
    summary: `Échéance ${formatAmount(payment.amountCents, payment.currency)} : ${status}.`,
    actorUserId,
    source: 'dashboard',
  });

  return payment;
}

export async function removePayment(paymentId: string): Promise<void> {
  await prisma.partnershipPayment.delete({ where: { id: paymentId } });
}

/**
 * Balaye les échéances d'un serveur : bascule les statuts, prévient avant la
 * date, alerte après.
 *
 * Deux alertes distinctes, parce qu'elles n'appellent pas la même action :
 * « ça arrive » se prépare, « c'est en retard » se relance. La mémoire des
 * alertes évite qu'elles se répètent à chaque passage.
 */
export async function runPaymentCycle(guildId: string): Promise<{ due: number; late: number }> {
  const settings = await getPartnershipSettings(guildId);
  if (!settings.enabled || !settings.financeEnabled) return { due: 0, late: 0 };

  const now = new Date();
  const soon = new Date(now.getTime() + settings.paymentReminderDays * 86_400_000);

  const upcoming = await prisma.partnershipPayment.findMany({
    where: {
      status: { in: ['SCHEDULED', 'DUE'] },
      dueAt: { lte: soon },
      partnership: { guildId, stage: { in: ['ACTIVE', 'RENEWAL', 'PAUSED'] } },
    },
    include: { partnership: { include: { partner: { select: { displayName: true } } } } },
    take: 200,
  });

  let due = 0;
  let late = 0;

  for (const payment of upcoming) {
    const isLate = payment.dueAt.getTime() < now.getTime();

    if (isLate && payment.status !== 'LATE') {
      await prisma.partnershipPayment.update({ where: { id: payment.id }, data: { status: 'LATE' } });
    } else if (!isLate && payment.status === 'SCHEDULED') {
      await prisma.partnershipPayment.update({ where: { id: payment.id }, data: { status: 'DUE' } });
    }

    if (!(await shouldFireAlert(`payment:${payment.id}`, isLate ? 72 : 24 * 7))) continue;

    await sendPartnershipAlert({
      guildId,
      title: isLate ? 'Échéance en retard' : 'Échéance proche',
      description: `${payment.partnership.partner.displayName} : ${formatAmount(payment.amountCents, payment.currency)} ${
        payment.direction === 'RECEIVED' ? 'à recevoir' : 'à verser'
      } le ${payment.dueAt.toLocaleDateString('fr-FR')}.`,
      tone: isLate ? 'danger' : 'warning',
      ownerUserId: payment.partnership.ownerUserId,
      link: `/partnerships/${payment.partnershipId}`,
    });

    await prisma.partnershipPayment.update({
      where: { id: payment.id },
      data: { reminderSentAt: new Date() },
    });

    if (isLate) late += 1;
    else due += 1;
  }

  return { due, late };
}

/**
 * Récapitulatif financier d'un serveur : ce qui est entré, ce qui est sorti,
 * ce qui est promis et ce qui traîne.
 */
export async function getFinanceSummary(guildId: string) {
  const payments = await prisma.partnershipPayment.findMany({
    where: { partnership: { guildId } },
    include: { partnership: { select: { id: true, partnerId: true } } },
  });

  const settled = payments.filter((payment) => payment.status === 'RECEIVED');
  const pending = payments.filter((payment) => ['SCHEDULED', 'DUE'].includes(payment.status));
  const late = payments.filter((payment) => payment.status === 'LATE');

  const sum = (rows: PartnershipPayment[], direction: 'RECEIVED' | 'GRANTED') =>
    rows
      .filter((payment) => payment.direction === direction)
      .reduce((total, payment) => total + payment.amountCents, 0);

  return {
    receivedCents: sum(settled, 'RECEIVED'),
    paidCents: sum(settled, 'GRANTED'),
    pendingInCents: sum(pending, 'RECEIVED'),
    pendingOutCents: sum(pending, 'GRANTED'),
    lateCents: sum(late, 'RECEIVED') + sum(late, 'GRANTED'),
    lateCount: late.length,
    currency: payments[0]?.currency ?? 'EUR',
  };
}

/** Montant lisible. Les centimes ne sortent jamais tels quels vers un humain. */
export function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}
