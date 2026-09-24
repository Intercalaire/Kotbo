/**
 * Série de récompenses journalières.
 *
 * Chaque jour réclamé d'affilée majore un peu plus la récompense, jusqu'à un plafond : revenir
 * tous les jours rapporte davantage, sans qu'une très longue série fasse exploser l'économie.
 */

/**
 * Barème de la série : de gros paliers les premiers jours pour accrocher le joueur, puis de
 * petits gains qui récompensent la constance sans faire exploser l'économie.
 */
export const DAILY_STREAK_EARLY_STEP = 0.1;
/** Nombre de jours (après le premier) qui rapportent le gros palier : jours 2 à 6. */
export const DAILY_STREAK_EARLY_DAYS = 5;
export const DAILY_STREAK_LATE_STEP = 0.01;

/** Majoration maximale : +100 %. */
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

/**
 * Majoration de la série, entre 0 (premier jour) et `DAILY_STREAK_MAX_BONUS` : +10 % par jour
 * du 2ᵉ au 6ᵉ jour (+50 %), puis +1 % par jour, jusqu'au plafond.
 */
export function dailyStreakBonus(streak: number): number {
  if (streak <= 1) return 0;
  const days = streak - 1;
  const early = Math.min(days, DAILY_STREAK_EARLY_DAYS);
  const late = days - early;
  const bonus = early * DAILY_STREAK_EARLY_STEP + late * DAILY_STREAK_LATE_STEP;
  return Math.min(DAILY_STREAK_MAX_BONUS, Math.round(bonus * 100) / 100);
}

/** Récompense majorée de la série, arrondie à l'unité inférieure comme le tirage de base. */
export function applyDailyStreak(baseReward: number, streak: number): number {
  return Math.floor(baseReward * (1 + dailyStreakBonus(streak)));
}
