/**
 * Séries d'activité (« streaks ») et bonus de RP associé.
 *
 * Une série se compte en jours UTC : c'est le même référentiel que le plafond
 * quotidien d'XP (`MemberLevel.dailyXpDate`), pour qu'un membre n'ait pas deux
 * « minuits » différents selon la mécanique qui le regarde.
 */

export const DAY_MS = 86_400_000;

/** Jour UTC au format `YYYY-MM-DD`, la clé stockée en base. */
export function rankedDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Nombre de jours entre deux clés de jour. Renvoie `null` si l'une des deux
 * n'est pas une clé lisible : l'appelant traite alors le cas comme un premier
 * jour, plutôt que de propager un NaN dans un compteur de série.
 */
export function rankedDaysBetween(from: string | null | undefined, to: string): number | null {
  if (!from) return null;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / DAY_MS);
}

export type StreakConfig = {
  /** Jours d'absence tolérés sans casser la série, si le membre a des gels. */
  graceDays: number;
  /** Bonus de RP par jour de série, à partir du 2e jour. */
  bonusPerDay: number;
  /** Plafond du bonus cumulé (0.5 = +50 % au maximum). */
  maxBonus: number;
};

export const DEFAULT_STREAK_CONFIG: StreakConfig = {
  graceDays: 1,
  bonusPerDay: 0.05,
  maxBonus: 0.5,
};

export type StreakState = {
  streakDays: number;
  bestStreak: number;
  lastActiveDate: string | null;
  /** Jokers restants, consommés par un jour manqué. */
  freezes: number;
};

export type StreakUpdate = {
  streakDays: number;
  bestStreak: number;
  lastActiveDate: string;
  freezes: number;
  /** La série a-t-elle avancé d'un cran lors de cet appel ? */
  extended: boolean;
  /** La série est-elle repartie de 1 après une absence trop longue ? */
  broken: boolean;
  /** Nombre de gels dépensés pour survivre à l'absence. */
  freezesSpent: number;
};

/**
 * Fait avancer une série pour une activité constatée le jour `today`.
 *
 * Idempotente dans la journée : une deuxième activité le même jour ne rallonge
 * pas la série. C'est indispensable ici, la fonction étant appelée à chaque
 * message et non une fois par jour.
 */
export function computeStreakUpdate(
  state: StreakState,
  today: string,
  config: StreakConfig = DEFAULT_STREAK_CONFIG,
): StreakUpdate {
  const current = Math.max(0, Math.floor(state.streakDays || 0));
  const best = Math.max(0, Math.floor(state.bestStreak || 0));
  const freezes = Math.max(0, Math.floor(state.freezes || 0));
  const graceDays = Math.max(0, Math.floor(config.graceDays ?? 0));

  const gap = rankedDaysBetween(state.lastActiveDate, today);

  // Même jour : rien ne bouge. Un `gap` négatif (horloge revenue en arrière,
  // reprise de sauvegarde) est traité pareil, pour ne pas récompenser un
  // décalage de date par un cran de série gratuit.
  if (gap !== null && gap <= 0) {
    return {
      streakDays: Math.max(current, 1),
      bestStreak: Math.max(best, current, 1),
      lastActiveDate: state.lastActiveDate ?? today,
      freezes,
      extended: false,
      broken: false,
      freezesSpent: 0,
    };
  }

  // Première activité connue : la série démarre à 1.
  if (gap === null) {
    return {
      streakDays: 1,
      bestStreak: Math.max(best, 1),
      lastActiveDate: today,
      freezes,
      extended: true,
      broken: false,
      freezesSpent: 0,
    };
  }

  const missedDays = gap - 1;

  if (missedDays === 0) {
    const streakDays = current + 1;
    return {
      streakDays,
      bestStreak: Math.max(best, streakDays),
      lastActiveDate: today,
      freezes,
      extended: true,
      broken: false,
      freezesSpent: 0,
    };
  }

  // Absence rattrapable : un gel est dépensé par jour manqué. Le membre garde
  // sa série mais paie ses jokers, ce qui borne l'abus (on ne peut pas
  // disparaître une semaine sur deux indéfiniment).
  if (missedDays <= graceDays && freezes >= missedDays) {
    const streakDays = current + 1;
    return {
      streakDays,
      bestStreak: Math.max(best, streakDays),
      lastActiveDate: today,
      freezes: freezes - missedDays,
      extended: true,
      broken: false,
      freezesSpent: missedDays,
    };
  }

  return {
    streakDays: 1,
    bestStreak: Math.max(best, current),
    lastActiveDate: today,
    freezes,
    extended: true,
    broken: current > 1,
    freezesSpent: 0,
  };
}

/**
 * Multiplicateur de RP porté par la série. Le premier jour ne donne rien : le
 * bonus récompense la régularité, pas le simple fait d'être présent.
 */
export function streakMultiplier(streakDays: number, config: StreakConfig = DEFAULT_STREAK_CONFIG): number {
  const days = Math.max(0, Math.floor(streakDays || 0));
  if (days <= 1) return 1;
  const bonusPerDay = Math.max(0, config.bonusPerDay ?? 0);
  const maxBonus = Math.max(0, config.maxBonus ?? 0);
  return 1 + Math.min(maxBonus, bonusPerDay * (days - 1));
}

/**
 * Palier visuel de la série (nombre de flammes affichées), de 0 à 5.
 * Purement cosmétique : le RP, lui, suit `streakMultiplier`.
 */
export function streakFlames(streakDays: number): number {
  const days = Math.max(0, Math.floor(streakDays || 0));
  if (days >= 100) return 5;
  if (days >= 30) return 4;
  if (days >= 14) return 3;
  if (days >= 7) return 2;
  if (days >= 3) return 1;
  return 0;
}

/**
 * Une série est-elle encore vivante au jour `today` ?
 *
 * Sert à l'affichage : la rupture n'est constatée en base qu'au prochain gain
 * de RP, donc une carte de rang consultée après trois jours d'absence doit
 * montrer la série éteinte sans attendre cette écriture.
 */
export function isStreakAlive(
  lastActiveDate: string | null | undefined,
  today: string,
  config: StreakConfig = DEFAULT_STREAK_CONFIG,
): boolean {
  const gap = rankedDaysBetween(lastActiveDate, today);
  if (gap === null) return false;
  return gap <= 1 + Math.max(0, Math.floor(config.graceDays ?? 0));
}
