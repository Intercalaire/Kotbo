/**
 * Motifs cron à cinq champs, résolus à la minute.
 *
 * Le déclencheur « Planification » ne s'abonne à aucun événement Discord : un
 * balayage passe chaque minute et demande à chaque workflow planifié si son
 * motif tombe maintenant. C'est ce que répond `cronMatches`.
 *
 * La grammaire couverte est celle que produit l'éditeur - `*`, une valeur, une
 * liste, un intervalle, un pas - et rien de plus. Les extensions non standard
 * (`@daily`, `L`, `#`) sont refusées plutôt que mal interprétées : un motif
 * accepté mais compris de travers ferait partir une automatisation au mauvais
 * moment, ce qui est pire qu'un refus à l'enregistrement.
 */

/** minute, heure, jour du mois, mois, jour de la semaine. */
const FIELD_RANGES: [min: number, max: number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

/**
 * Valeurs autorisées par un champ, ou `null` si le champ est invalide.
 *
 * `*` est distingué d'une énumération complète : la règle du jour de la
 * semaine en dépend, `* * * * 1` et `* * * 1-31 1` ne se comportant pas
 * pareil dans un cron.
 */
function parseField(raw: string, min: number, max: number): { values: Set<number>; wildcard: boolean } | null {
  const field = raw.trim();
  if (field === '') return null;

  const values = new Set<number>();
  let wildcard = false;

  for (const part of field.split(',')) {
    const [spec, stepRaw, ...extra] = part.split('/');
    if (extra.length > 0) return null;

    let step = 1;
    if (stepRaw !== undefined) {
      if (!/^\d+$/.test(stepRaw)) return null;
      step = Number(stepRaw);
      if (step < 1) return null;
    }

    let from: number;
    let to: number;

    if (spec === '*') {
      from = min;
      to = max;
      if (stepRaw === undefined) wildcard = true;
    } else if (/^\d+$/.test(spec)) {
      from = Number(spec);
      // `5/2` n'a de sens qu'en partant de 5 et en allant jusqu'au bout.
      to = stepRaw === undefined ? from : max;
    } else {
      const range = spec.match(/^(\d+)-(\d+)$/);
      if (!range) return null;
      from = Number(range[1]);
      to = Number(range[2]);
    }

    if (from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }

  return values.size > 0 ? { values, wildcard } : null;
}

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  dayOfMonthWildcard: boolean;
  dayOfWeekWildcard: boolean;
}

export function parseCron(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const parsed = fields.map((field, index) => parseField(field, FIELD_RANGES[index][0], FIELD_RANGES[index][1]));
  if (parsed.some((field) => field === null)) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parsed as NonNullable<(typeof parsed)[number]>[];

  // 7 et 0 désignent tous deux le dimanche.
  const daysOfWeek = new Set([...dayOfWeek.values].map((day) => (day === 7 ? 0 : day)));

  return {
    minutes: minute.values,
    hours: hour.values,
    daysOfMonth: dayOfMonth.values,
    months: month.values,
    daysOfWeek,
    dayOfMonthWildcard: dayOfMonth.wildcard,
    dayOfWeekWildcard: dayOfWeek.wildcard,
  };
}

export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== null;
}

/**
 * Le motif tombe-t-il sur cette minute ?
 *
 * Quand le jour du mois et le jour de la semaine sont tous deux restreints,
 * la règle historique de cron veut qu'ils soient combinés par un OU et non
 * par un ET : `0 0 1 * 1` se lit « le 1er du mois, et aussi tous les lundis ».
 * S'en écarter ferait manquer des déclenchements attendus.
 */
export function cronMatches(expression: string, date: Date): boolean {
  const cron = parseCron(expression);
  if (!cron) return false;

  if (!cron.minutes.has(date.getMinutes())) return false;
  if (!cron.hours.has(date.getHours())) return false;
  if (!cron.months.has(date.getMonth() + 1)) return false;

  const dayOfMonthMatches = cron.daysOfMonth.has(date.getDate());
  const dayOfWeekMatches = cron.daysOfWeek.has(date.getDay());

  if (cron.dayOfMonthWildcard && cron.dayOfWeekWildcard) return true;
  if (cron.dayOfMonthWildcard) return dayOfWeekMatches;
  if (cron.dayOfWeekWildcard) return dayOfMonthMatches;
  return dayOfMonthMatches || dayOfWeekMatches;
}

// ============================================================================
// COMPOSITION DEPUIS L'ÉDITEUR
// ============================================================================

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface SchedulePreset {
  frequency: ScheduleFrequency;
  /** Minute de l'heure, pour la fréquence horaire comme pour les autres. */
  minute: number;
  hour: number;
  /** 0 = dimanche. Utilisé par la fréquence hebdomadaire. */
  weekday: number;
  /** Jour du mois, utilisé par la fréquence mensuelle. */
  day: number;
}

export const DEFAULT_SCHEDULE: SchedulePreset = {
  frequency: 'daily',
  minute: 0,
  hour: 9,
  weekday: 1,
  day: 1,
};

export function scheduleToCron(preset: SchedulePreset): string {
  const minute = clamp(preset.minute, 0, 59);
  const hour = clamp(preset.hour, 0, 23);

  switch (preset.frequency) {
    case 'hourly': return `${minute} * * * *`;
    case 'weekly': return `${minute} ${hour} * * ${clamp(preset.weekday, 0, 6)}`;
    case 'monthly': return `${minute} ${hour} ${clamp(preset.day, 1, 31)} * *`;
    default: return `${minute} ${hour} * * *`;
  }
}

/**
 * Relit un motif vers les réglages de l'éditeur.
 *
 * Renvoie `null` pour tout ce que les quatre fréquences ne savent pas
 * exprimer : l'éditeur bascule alors sur la saisie brute plutôt que d'afficher
 * des réglages qui ne correspondent pas au motif enregistré.
 */
export function cronToSchedule(expression: string): SchedulePreset | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, day, month, weekday] = fields;
  if (month !== '*') return null;
  if (!/^\d+$/.test(minute)) return null;

  const base = { ...DEFAULT_SCHEDULE, minute: Number(minute) };
  if (base.minute > 59) return null;

  if (hour === '*' && day === '*' && weekday === '*') {
    return { ...base, frequency: 'hourly' };
  }

  if (!/^\d+$/.test(hour) || Number(hour) > 23) return null;
  const withHour = { ...base, hour: Number(hour) };

  if (day === '*' && weekday === '*') return { ...withHour, frequency: 'daily' };
  if (day === '*' && /^[0-6]$/.test(weekday)) return { ...withHour, frequency: 'weekly', weekday: Number(weekday) };
  if (weekday === '*' && /^\d+$/.test(day) && Number(day) >= 1 && Number(day) <= 31) {
    return { ...withHour, frequency: 'monthly', day: Number(day) };
  }

  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
