/**
 * Décroissance du RP en cas d'inactivité.
 *
 * Le decay ne porte **que** sur le RP : l'XP de `MemberLevel` n'est jamais
 * entamée. Retirer de l'XP ferait redescendre le niveau, donc retirerait des
 * rôles de récompense déjà attribués et rejouerait les annonces de montée à la
 * remontée. Le RP, lui, est fait pour redescendre.
 */

import { rankedDaysBetween } from './streaks.js';

export type DecayConfig = {
  enabled: boolean;
  /** Jours d'inactivité tolérés avant la première perte. */
  graceDays: number;
  /** Perte forfaitaire par jour au-delà du délai de grâce. */
  rpPerDay: number;
  /** Perte proportionnelle par jour (0.02 = 2 % du RP courant). */
  percentPerDay: number;
  /** RP sous lequel le decay s'arrête (plancher d'un palier protégé). */
  floorRp: number;
};

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  enabled: true,
  graceDays: 3,
  rpPerDay: 25,
  percentPerDay: 0,
  floorRp: 0,
};

export type DecayOutcome = {
  /** RP après application. Jamais sous `floorRp`, jamais sous 0. */
  newRp: number;
  /** RP effectivement retirés. */
  lost: number;
  /** Jours de decay réellement facturés. */
  daysApplied: number;
};

const MAX_DECAY_DAYS = 365;

/**
 * Applique `daysInactive` jours d'inactivité à un capital de RP.
 *
 * La perte est calculée jour par jour et non en une multiplication : avec une
 * part proportionnelle, cumuler dix jours d'un coup donnerait un résultat
 * différent de dix passages du cron quotidien, et un membre serait pénalisé
 * selon la ponctualité du bot plutôt que selon son absence.
 */
export function computeRankedDecay(rp: number, daysInactive: number, config: DecayConfig): DecayOutcome {
  const startRp = Math.max(0, Number.isFinite(rp) ? Math.floor(rp) : 0);
  const floor = Math.max(0, Math.floor(config.floorRp ?? 0));

  if (!config.enabled) return { newRp: startRp, lost: 0, daysApplied: 0 };

  const graceDays = Math.max(0, Math.floor(config.graceDays ?? 0));
  const days = Math.min(MAX_DECAY_DAYS, Math.floor(daysInactive) - graceDays);
  if (days <= 0 || startRp <= floor) return { newRp: startRp, lost: 0, daysApplied: 0 };

  const flat = Math.max(0, Math.floor(config.rpPerDay ?? 0));
  const rate = Math.min(1, Math.max(0, config.percentPerDay ?? 0));
  if (flat === 0 && rate === 0) return { newRp: startRp, lost: 0, daysApplied: 0 };

  let current = startRp;
  let daysApplied = 0;

  for (let day = 0; day < days; day++) {
    const dailyLoss = flat + Math.floor(current * rate);
    if (dailyLoss <= 0) break;
    current = Math.max(floor, current - dailyLoss);
    daysApplied++;
    if (current <= floor) break;
  }

  return { newRp: current, lost: startRp - current, daysApplied };
}

/**
 * Variante « depuis la dernière facturation », celle qu'utilise le cron.
 *
 * `lastDecayDate` empêche la double facturation : un cron rejoué deux fois dans
 * la même journée, ou un bot redémarré en boucle, ne doit pas retirer deux fois
 * la perte du jour. `lastActiveDate` reste la référence de l'inactivité.
 */
export function computeScheduledDecay(
  input: {
    rp: number;
    lastActiveDate: string | null | undefined;
    lastDecayDate: string | null | undefined;
    today: string;
  },
  config: DecayConfig,
): DecayOutcome {
  const inactiveDays = rankedDaysBetween(input.lastActiveDate, input.today);
  if (inactiveDays === null) return { newRp: Math.max(0, Math.floor(input.rp)), lost: 0, daysApplied: 0 };

  const alreadyBilled = rankedDaysBetween(input.lastDecayDate, input.today);
  // Déjà facturé aujourd'hui : rien à faire.
  if (alreadyBilled !== null && alreadyBilled <= 0) {
    return { newRp: Math.max(0, Math.floor(input.rp)), lost: 0, daysApplied: 0 };
  }

  const graceDays = Math.max(0, Math.floor(config.graceDays ?? 0));
  // Jours de decay dus depuis la dernière facturation. Sans facturation connue,
  // on ne rattrape pas tout l'historique : un serveur qui active le decay
  // aujourd'hui ne doit pas amputer d'un coup ses membres absents depuis un an.
  const billable = alreadyBilled === null
    ? Math.min(1, Math.max(0, inactiveDays - graceDays))
    : Math.min(alreadyBilled, Math.max(0, inactiveDays - graceDays));

  if (billable <= 0) return { newRp: Math.max(0, Math.floor(input.rp)), lost: 0, daysApplied: 0 };

  return computeRankedDecay(input.rp, billable + graceDays, config);
}
