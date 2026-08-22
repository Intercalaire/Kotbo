/**
 * Dette de points de clan.
 *
 * Un membre peut engager plus de points qu'il n'en possède (paris à crédit).
 * Le manque devient une dette, prélevée sur ses gains futurs avant tout crédit
 * au classement.
 *
 * La dette appartient à la couche clans, pas au module qui l'a creusée : c'est
 * ce qui permet à un gain de progression, de boost ou du Daily Algo de la
 * rembourser sans que les clans aient à connaître les paris.
 */
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { applyDebtRepayment, BET_DEBT_CEILING } from '@kotbo/shared';

export type ClanDebtSource = 'BET';

export async function getClanPointDebt(guildId: string, userId: string): Promise<number> {
  const row = await prisma.clanPointDebt.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { amount: true },
  });
  return row?.amount ?? 0;
}

/** Creuse ou aggrave une dette. Retourne le total dû après opération. */
export async function openClanPointDebt(params: {
  guildId: string;
  userId: string;
  amount: number;
  source?: ClanDebtSource;
}): Promise<number> {
  const amount = Math.floor(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) return getClanPointDebt(params.guildId, params.userId);

  const row = await prisma.clanPointDebt.upsert({
    where: { guildId_userId: { guildId: params.guildId, userId: params.userId } },
    update: { amount: { increment: amount } },
    create: { guildId: params.guildId, userId: params.userId, amount, source: params.source ?? 'BET' },
  });

  // Le plafond est vérifié à l'ouverture du pari, mais deux acceptations
  // simultanées peuvent le franchir ensemble : on borne ici aussi, sans quoi la
  // colonne finirait par déborder l'entier 32 bits de Postgres.
  if (row.amount > BET_DEBT_CEILING) {
    const bounded = await prisma.clanPointDebt.update({
      where: { guildId_userId: { guildId: params.guildId, userId: params.userId } },
      data: { amount: BET_DEBT_CEILING },
    });
    logger.warn('ClanDebt', `Dette de ${params.userId} bornée au plafond sur ${params.guildId}.`);
    return bounded.amount;
  }

  return row.amount;
}

/**
 * Efface une part de dette sans contrepartie en points (annulation d'un pari).
 * La ligne disparaît dès qu'elle retombe à zéro : une dette nulle qui traîne
 * ferait payer une lecture inutile à chaque gain de points du membre.
 */
export async function cancelClanPointDebt(guildId: string, userId: string, amount: number): Promise<number> {
  const toCancel = Math.floor(amount);
  if (!Number.isFinite(toCancel) || toCancel <= 0) return getClanPointDebt(guildId, userId);

  const existing = await prisma.clanPointDebt.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { amount: true },
  });
  if (!existing) return 0;

  const remaining = Math.max(0, existing.amount - toCancel);
  if (remaining === 0) {
    await prisma.clanPointDebt.delete({ where: { guildId_userId: { guildId, userId } } }).catch(() => undefined);
    return 0;
  }

  const updated = await prisma.clanPointDebt.update({
    where: { guildId_userId: { guildId, userId } },
    data: { amount: remaining },
  });
  return updated.amount;
}

/**
 * Prélève sur un gain de quoi rembourser la dette, et retourne ce qu'il reste à
 * créditer.
 *
 * Appelé par `creditClanContribution` sur chaque crédit positif : c'est le seul
 * point de passage commun à toutes les origines de points, donc le seul endroit
 * où le remboursement ne peut pas être oublié par un module.
 */
export async function settleDebtFromGain(
  guildId: string,
  userId: string,
  gain: number,
): Promise<{ credited: number; repaid: number }> {
  if (gain <= 0) return { credited: gain, repaid: 0 };

  const debt = await prisma.clanPointDebt.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { amount: true },
  });
  if (!debt || debt.amount <= 0) return { credited: gain, repaid: 0 };

  const plan = applyDebtRepayment(gain, debt.amount);
  if (plan.repaid <= 0) return { credited: gain, repaid: 0 };

  if (plan.remainingDebt === 0) {
    await prisma.clanPointDebt.delete({ where: { guildId_userId: { guildId, userId } } }).catch(() => undefined);
  } else {
    await prisma.clanPointDebt.update({
      where: { guildId_userId: { guildId, userId } },
      data: { amount: plan.remainingDebt },
    });
  }

  logger.info(
    'ClanDebt',
    `${plan.repaid} point(s) de ${userId} affecté(s) au remboursement de sa dette sur ${guildId} (reste ${plan.remainingDebt}).`,
  );

  return { credited: plan.credited, repaid: plan.repaid };
}
