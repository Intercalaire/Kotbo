/**
 * Conversion de l'activité en RP.
 *
 * Le RP est greffé sur le pipeline d'XP existant : il ne recompte pas les
 * messages, il convertit l'XP *réellement accordée* par `addXp`. Toutes les
 * garanties déjà en place (cooldown, salons et rôles exclus, plafond quotidien
 * d'XP) s'appliquent donc au RP sans être réimplémentées - et un serveur qui
 * ajuste sa config d'XP voit son RP suivre.
 */

import { streakMultiplier, type StreakConfig } from './streaks.js';

export type RpSource = 'text' | 'voice' | 'reaction' | 'event' | 'manual' | 'decay' | 'season';

export type RpMultipliers = {
  /** Bonus de série, issu de `streakMultiplier`. */
  streak: number;
  /** Multiplicateur d'un événement serveur en cours (Message Rush, ...). */
  event: number;
};

export const NEUTRAL_MULTIPLIERS: RpMultipliers = { streak: 1, event: 1 };

/**
 * RP bruts correspondant à une quantité d'XP accordée.
 *
 * Le plancher à 1 évite qu'un taux de conversion bas (0.1) ne rende tout gain
 * texte nul par troncature : un membre qui gagne de l'XP doit voir son RP
 * bouger, sans quoi le classement paraît cassé.
 */
export function rpFromXp(xpGranted: number, rpPerXp: number): number {
  if (!Number.isFinite(xpGranted) || xpGranted <= 0) return 0;
  const rate = Number.isFinite(rpPerXp) ? Math.max(0, rpPerXp) : 0;
  if (rate === 0) return 0;
  return Math.max(1, Math.floor(xpGranted * rate));
}

/** Applique les multiplicateurs à un gain de base, arrondi à l'entier inférieur. */
export function applyRpMultipliers(baseRp: number, multipliers: RpMultipliers = NEUTRAL_MULTIPLIERS): number {
  if (!Number.isFinite(baseRp) || baseRp <= 0) return 0;
  const streak = Number.isFinite(multipliers.streak) ? Math.max(0, multipliers.streak) : 1;
  const event = Number.isFinite(multipliers.event) ? Math.max(0, multipliers.event) : 1;
  return Math.max(0, Math.floor(baseRp * streak * event));
}

/**
 * Chaîne complète d'un gain d'activité : XP accordée -> RP -> bonus.
 *
 * Regroupée ici pour que le bot et le simulateur du dashboard annoncent
 * exactement le même chiffre.
 */
export function computeRpGain(input: {
  xpGranted: number;
  rpPerXp: number;
  streakDays: number;
  eventMultiplier?: number;
  streakConfig?: StreakConfig;
}): { baseRp: number; finalRp: number; streakMult: number; eventMult: number } {
  const baseRp = rpFromXp(input.xpGranted, input.rpPerXp);
  const streakMult = streakMultiplier(input.streakDays, input.streakConfig);
  const eventMult = Number.isFinite(input.eventMultiplier) ? Math.max(0, input.eventMultiplier as number) : 1;
  const finalRp = applyRpMultipliers(baseRp, { streak: streakMult, event: eventMult });
  return { baseRp, finalRp, streakMult, eventMult };
}

/**
 * Part d'un gain qui tient encore sous le plafond de RP quotidien.
 *
 * Même sens de lecture que `grantedWithinDailyCap` côté XP : l'appelant
 * incrémente d'abord le compteur, puis demande ici ce qui était accordable. Ce
 * qui rend le plafond sûr quand deux messages arrivent en même temps.
 */
export function grantedWithinDailyRpCap(consumedTotal: number, amount: number, cap: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(cap) || cap <= 0) return amount;
  const overflow = consumedTotal - cap;
  if (overflow <= 0) return amount;
  return Math.max(0, amount - overflow);
}

export const RANKED_EVENT_TYPES = ['MESSAGE_RUSH', 'REACTION_STORM', 'VOCAL_TIME', 'CUSTOM'] as const;
export type RankedEventType = (typeof RANKED_EVENT_TYPES)[number];

/**
 * Un événement s'applique-t-il à cette source de RP ?
 *
 * Un « Message Rush » ne doit pas doubler le RP vocal : sinon l'événement
 * annoncé comme une course au message récompense surtout ceux qui restent
 * connectés en vocal sans rien faire.
 */
export function eventAppliesToSource(type: RankedEventType, source: RpSource): boolean {
  switch (type) {
    case 'MESSAGE_RUSH':
      return source === 'text';
    case 'REACTION_STORM':
      return source === 'reaction';
    case 'VOCAL_TIME':
      return source === 'voice';
    case 'CUSTOM':
      return source === 'text' || source === 'voice' || source === 'reaction';
    default:
      return false;
  }
}
