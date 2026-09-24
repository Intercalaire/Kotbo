/**
 * Série de récompenses journalières.
 *
 * Chaque jour réclamé d'affilée majore un peu plus la récompense, jusqu'à un plafond : revenir
 * tous les jours rapporte davantage, sans qu'une très longue série fasse exploser l'économie.
 */

/** Majoration gagnée par jour de série au-delà du premier. */
export const DAILY_STREAK_STEP = 0.1;

/** Majoration maximale : +100 %, atteinte au onzième jour d'affilée. */
export const DAILY_STREAK_MAX_BONUS = 1;

/**
 * Marge laissée après la fin de la recharge pour réclamer sans perdre sa série. Sans elle, un
 * joueur qui réclame à 20 h puis le lendemain à 21 h perdrait tout pour une heure de retard.
 */
export const DAILY_STREAK_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Série atteinte par la réclamation faite à `now`.
 *
 * La série continue si la réclamation précédente date de moins d'une recharge plus la marge,
 * et repart à 1 sinon (ou si le joueur n'a jamais réclamé).
 */
export function nextDailyStreak(lastDaily: Date | null, previousStreak: number, now: Date, cooldownMs: number): number {
  if (!lastDaily) return 1;
  const elapsed = now.getTime() - lastDaily.getTime();
  if (elapsed > cooldownMs + DAILY_STREAK_GRACE_MS) return 1;
  return Math.max(0, previousStreak) + 1;
}

/** Majoration de la série, entre 0 (premier jour) et `DAILY_STREAK_MAX_BONUS`. */
export function dailyStreakBonus(streak: number): number {
  if (streak <= 1) return 0;
  return Math.min(DAILY_STREAK_MAX_BONUS, Math.round((streak - 1) * DAILY_STREAK_STEP * 100) / 100);
}

/** Récompense majorée de la série, arrondie à l'unité inférieure comme le tirage de base. */
export function applyDailyStreak(baseReward: number, streak: number): number {
  return Math.floor(baseReward * (1 + dailyStreakBonus(streak)));
}
