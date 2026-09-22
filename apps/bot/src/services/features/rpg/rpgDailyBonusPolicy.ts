/**
 * Bonus de première victoire du jour.
 *
 * Donne une raison de revenir chaque jour sans rien stocker de plus : le journal des combats
 * dit déjà si le joueur a gagné depuis le début de la journée.
 */

import { formatWallClockInTimezone, toWallClockUtcMs, zonedTimeToInstant } from '@kotbo/contracts';

/** Majoration de l'XP et des pièces de la première victoire du jour. */
export const FIRST_WIN_BONUS = 0.5;

/**
 * Instant où a commencé, dans le fuseau du serveur, la journée qui contient `now`.
 *
 * La journée suit le fuseau du serveur et non l'UTC : sinon, pour un serveur français, le
 * bonus reviendrait à 1 h ou 2 h du matin selon la saison.
 */
export function zonedDayStartOf(now: Date, timezone: string): Date {
  const [year, month, day] = formatWallClockInTimezone(now, timezone).slice(0, 10).split('-').map(Number);
  const wallClock = toWallClockUtcMs(year, (month ?? 1) - 1, day ?? 1);
  if (wallClock === null) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return zonedTimeToInstant(wallClock, timezone);
}

/** Récompenses majorées du bonus, arrondies comme le reste du butin. */
export function applyFirstWinBonus(xp: number, coins: number): { xp: number; coins: number } {
  return { xp: Math.round(xp * (1 + FIRST_WIN_BONUS)), coins: Math.round(coins * (1 + FIRST_WIN_BONUS)) };
}
