/**
 * Calcul des points du Daily Algo - module pur, sans base de données.
 *
 * Deux règles structurent tout ce fichier :
 *
 * 1. **Les points sont toujours des entiers.** L'arrondi se fait à l'unité
 *    supérieure, et il n'a lieu **qu'une seule fois**, tout à la fin du calcul.
 *    Arrondir à chaque étape ferait s'empiler les arrondis et gonflerait les
 *    totaux. La moyenne des critères reste donc à virgule en interne (c'est ce que
 *    `scoreFinal` stocke et affiche en « /5 »), mais aucun *point* ne l'est.
 *
 * 2. **Toute participation sincère rapporte quelque chose.** Une soumission
 *    approuvée touche le plancher de participation même avec les notes les plus
 *    basses. Seuls les hors-sujet (`DISMISSED`) et les dérapages (`REJECTED`)
 *    valent zéro.
 */

// ── Critères de notation ───────────────────────────────────────────────────────

export type DailyAlgoCriteriaScores = {
  correctness: number;
  comments: number;
  compactness: number;
  optimization: number;
  readability: number;
};

/** Note minimale par critère : on ne met pas 0 à quelqu'un qui a essayé. */
export const DAILY_ALGO_CRITERION_MIN = 1;
export const DAILY_ALGO_CRITERION_MAX = 5;

/** Bonus de rapidité des trois premiers à soumettre. */
export const DAILY_ALGO_SPEED_BONUS: Readonly<Record<number, number>> = {
  1: 3,
  2: 2,
  3: 1,
};

export function getSpeedBonus(rank: number | null | undefined): number {
  if (!rank) return 0;
  return DAILY_ALGO_SPEED_BONUS[rank] ?? 0;
}

/**
 * Moyenne brute des cinq critères, en nombre à virgule (ex. 3.5).
 * C'est la valeur affichée « /5 », pas un nombre de points.
 */
export function computeCriteriaAverage(scores: DailyAlgoCriteriaScores): number {
  const total = scores.correctness
    + scores.comments
    + scores.compactness
    + scores.optimization
    + scores.readability;

  return total / 5;
}

/** Arrondit la moyenne au dixième, pour l'affichage et le stockage de `scoreFinal`. */
export function roundCriteriaAverage(average: number): number {
  return Math.round(average * 10) / 10;
}

/** Borne une note de critère dans [1, 5] et la ramène à un entier. */
export function clampCriterionScore(value: number): number {
  if (!Number.isFinite(value)) return DAILY_ALGO_CRITERION_MIN;
  const rounded = Math.round(value);
  if (rounded < DAILY_ALGO_CRITERION_MIN) return DAILY_ALGO_CRITERION_MIN;
  if (rounded > DAILY_ALGO_CRITERION_MAX) return DAILY_ALGO_CRITERION_MAX;
  return rounded;
}

// ── Points d'une soumission ────────────────────────────────────────────────────

export type DailyAlgoPointsInput = {
  /** Notes des cinq critères. */
  scores: DailyAlgoCriteriaScores;
  /** Rang de soumission (1er, 2e, 3e...) ; null si inconnu. */
  speedRank?: number | null;
  /** Plancher garanti pour toute soumission approuvée (réglage du serveur). */
  participationPoints: number;
  /** Multiplicateur figé sur le run (1 en semaine, 1.5 le week-end). */
  pointsMultiplier?: number;
};

/**
 * Total de points d'une soumission approuvée, en entier.
 *
 *     ceil( ( plancher + moyenne_des_critères + bonus_rapidité ) × multiplicateur )
 *
 * Le bonus de rapidité est **toujours** inclus, y compris le jour même. Le rang de
 * soumission est acquis définitivement dès l'envoi, et le total est figé à la
 * notation - qui a lieu le jour même : le neutraliser en attendant la fin de la
 * journée le perdrait pour toujours.
 */
export function computeSubmissionPoints(input: DailyAlgoPointsInput): number {
  const participation = Math.max(0, input.participationPoints);
  const average = computeCriteriaAverage(input.scores);
  const speedBonus = getSpeedBonus(input.speedRank);
  const multiplier = normalizeMultiplier(input.pointsMultiplier);

  const raw = (participation + average + speedBonus) * multiplier;

  return Math.max(0, Math.ceil(raw));
}

/** Un multiplicateur absent, nul ou aberrant vaut 1. */
export function normalizeMultiplier(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 1;
  return value;
}

/**
 * Multiplicateur à figer sur un run au moment du tirage.
 * Le week-end est déterminé dans le fuseau du serveur, pas en UTC.
 */
export function resolveRunMultiplier(params: {
  date: Date;
  timeZone: string;
  weekendMultiplier: number;
}): number {
  if (!isWeekend(params.date, params.timeZone)) return 1;
  return normalizeMultiplier(params.weekendMultiplier);
}

// ── Conversion vers les points de clan ─────────────────────────────────────────

/**
 * Convertit un total hebdomadaire de points Daily Algo en points de clan.
 * 1 pour 1 par défaut ; le taux permet d'ajuster depuis le panel sans toucher au
 * code. Le résultat repasse par un arrondi supérieur pour rester entier même
 * avec un taux fractionnaire (0.5 par exemple).
 */
export function convertToClanPoints(points: number, rate: number | null | undefined): number {
  if (points <= 0) return 0;
  const effectiveRate = typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 1;
  return Math.ceil(points * effectiveRate);
}

// ── Fuseau horaire, jours et semaines ISO ─────────────────────────────────────

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Décompose un instant en date/heure civile dans un fuseau donné.
 * Retombe sur l'UTC si le fuseau est invalide, plutôt que de jeter.
 */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  let formatted: Intl.DateTimeFormatPart[];

  try {
    formatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = formatted.find((entry) => entry.type === type);
    return part ? Number(part.value) : 0;
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Clé de journée « YYYY-MM-DD » dans le fuseau du serveur. */
export function getZonedDateKey(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  return formatDateKey(parts.year, parts.month, parts.day);
}

export function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Jour de la semaine ISO (1 = lundi ... 7 = dimanche) dans le fuseau donné. */
export function getZonedIsoWeekday(date: Date, timeZone: string): number {
  const { year, month, day } = getZonedParts(date, timeZone);
  return isoWeekdayFromCalendarDate(year, month, day);
}

function isoWeekdayFromCalendarDate(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

/** Samedi ou dimanche dans le fuseau du serveur. */
export function isWeekend(date: Date, timeZone: string): boolean {
  const weekday = getZonedIsoWeekday(date, timeZone);
  return weekday === 6 || weekday === 7;
}

/**
 * Clé de semaine ISO « YYYY-Www » (ex. « 2026-W31 »), calculée dans le fuseau
 * du serveur. L'année ISO peut différer de l'année civile fin décembre / début
 * janvier : c'est voulu, c'est la définition de la norme.
 */
export function getWeekKey(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return weekKeyFromCalendarDate(year, month, day);
}

function weekKeyFromCalendarDate(year: number, month: number, day: number): string {
  // On se place sur le jeudi de la semaine ISO : son année civile est, par
  // définition, l'année ISO de la semaine entière.
  const thursday = new Date(Date.UTC(year, month - 1, day));
  const weekday = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);

  const isoYear = thursday.getUTCFullYear();
  const firstDayOfIsoYear = Date.UTC(isoYear, 0, 1);
  const dayOfYear = Math.floor((thursday.getTime() - firstDayOfIsoYear) / 86_400_000) + 1;
  const weekNumber = Math.ceil(dayOfYear / 7);

  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}

export function isValidWeekKey(weekKey: string): boolean {
  return /^\d{4}-W\d{2}$/.test(weekKey);
}

/**
 * Clés de journée du lundi et du dimanche d'une semaine ISO.
 *
 * Les clés de journée sont des chaînes « YYYY-MM-DD » triables : c'est ce qui
 * permet de filtrer les runs d'une semaine par simple comparaison de chaînes,
 * sans arithmétique d'instants.
 */
export function getWeekDateKeys(weekKey: string): { firstDateKey: string; lastDateKey: string } {
  const monday = getIsoWeekMondayUtc(weekKey);
  const sunday = new Date(monday.getTime());
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  return {
    firstDateKey: formatDateKey(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
    lastDateKey: formatDateKey(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate()),
  };
}

/** Date calendaire (en UTC nu) du lundi d'une semaine ISO. */
function getIsoWeekMondayUtc(weekKey: string): Date {
  const [yearPart, weekPart] = weekKey.split('-W');
  const isoYear = Number(yearPart);
  const weekNumber = Number(weekPart);

  // Le 4 janvier appartient toujours à la semaine 1 de son année ISO.
  const fourthOfJanuary = new Date(Date.UTC(isoYear, 0, 4));
  const weekdayOfFourth = fourthOfJanuary.getUTCDay() || 7;

  const firstMonday = new Date(Date.UTC(isoYear, 0, 4 - (weekdayOfFourth - 1)));
  firstMonday.setUTCDate(firstMonday.getUTCDate() + (weekNumber - 1) * 7);

  return firstMonday;
}

/**
 * Bornes d'une semaine ISO, en instants réels : lundi 00:00 et dimanche 23:59:59
 * dans le fuseau du serveur. Utilisé pour l'affichage et le stockage
 * (`DailyAlgoWeek.startsAt` / `endsAt`) ; les requêtes passent par les clés de
 * journée, plus simples et immunisées aux changements d'heure.
 */
export function getWeekBounds(weekKey: string, timeZone: string): { startsAt: Date; endsAt: Date } {
  const monday = getIsoWeekMondayUtc(weekKey);
  const sunday = new Date(monday.getTime());
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  return {
    startsAt: zonedCivilTimeToInstant(
      { year: monday.getUTCFullYear(), month: monday.getUTCMonth() + 1, day: monday.getUTCDate(), hour: 0, minute: 0, second: 0 },
      timeZone,
    ),
    endsAt: zonedCivilTimeToInstant(
      { year: sunday.getUTCFullYear(), month: sunday.getUTCMonth() + 1, day: sunday.getUTCDate(), hour: 23, minute: 59, second: 59 },
      timeZone,
    ),
  };
}

/**
 * Instant correspondant à une date/heure civile exprimée dans un fuseau.
 *
 * Deux passes : la première estime le décalage, la seconde le corrige si l'on a
 * atterri de l'autre côté d'un changement d'heure. C'est la méthode habituelle
 * pour éviter d'embarquer une bibliothèque de fuseaux.
 */
function zonedCivilTimeToInstant(parts: ZonedParts, timeZone: string): Date {
  const naiveUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  const firstOffset = getTimeZoneOffsetMs(new Date(naiveUtc), timeZone);
  const firstGuess = naiveUtc - firstOffset;

  const secondOffset = getTimeZoneOffsetMs(new Date(firstGuess), timeZone);
  if (secondOffset === firstOffset) return new Date(firstGuess);

  return new Date(naiveUtc - secondOffset);
}

/** Décalage du fuseau (en millisecondes) à un instant donné. */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  // On compare à la seconde près : les millisecondes ne sont pas dans les parts.
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Semaine ISO précédant celle fournie. */
export function getPreviousWeekKey(weekKey: string): string {
  const monday = getIsoWeekMondayUtc(weekKey);
  monday.setUTCDate(monday.getUTCDate() - 7);

  return weekKeyFromCalendarDate(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

/** Libellé lisible d'une semaine, ex. « du 27 juillet au 2 août 2026 ». */
export function formatWeekRangeLabel(weekKey: string, locale = 'fr-FR'): string {
  const { firstDateKey, lastDateKey } = getWeekDateKeys(weekKey);
  const [startYear, startMonth, startDay] = firstDateKey.split('-').map(Number);
  const [endYear, endMonth, endDay] = lastDateKey.split('-').map(Number);

  const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

  const startLabel = start.toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const endLabel = end.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  return `du ${startLabel} au ${endLabel}`;
}
