/**
 * Fuseau horaire d'un serveur.
 *
 * Le bot tourne en UTC (image `oven/bun:1-alpine`, sans `TZ`) : toute date
 * formatee sans `timeZone` explicite sort en UTC, et toute chaine sans fuseau
 * passee a `new Date()` est lue comme de l'UTC. Les deux erreurs decalent d'une
 * a deux heures selon la saison, dans des sens opposes.
 *
 * La liste proposee est celle de l'environnement (`Intl.supportedValuesOf`),
 * pas une liste figee : elle suit les mises a jour de la base IANA sans qu'on
 * ait a toucher au code.
 */

export const DEFAULT_TIMEZONE = 'Europe/Paris';

/**
 * `supportedValuesOf` n'existe pas partout (Safari < 17, runtimes anciens). Le
 * repli garde le selecteur utilisable au lieu de le vider entierement.
 */
const FALLBACK_TIMEZONES: readonly string[] = [
  'UTC',
  'Europe/Paris',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Brussels',
  'Europe/Madrid',
  'Europe/Berlin',
  'Europe/Zurich',
  'America/Montreal',
  'America/New_York',
  'Africa/Casablanca',
  'Indian/Reunion',
];

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[];
};

/** Tous les identifiants IANA connus du runtime, tries. */
export function listSupportedTimezones(): string[] {
  const supportedValuesOf = (Intl as IntlWithSupportedValues).supportedValuesOf;
  if (typeof supportedValuesOf !== 'function') return [...FALLBACK_TIMEZONES];

  try {
    const zones = supportedValuesOf('timeZone');
    // `UTC` est absent de la liste IANA sur certains runtimes alors que
    // `Intl.DateTimeFormat` l'accepte : sans cet ajout, le seul choix neutre
    // proposable disparait du selecteur.
    const withUtc = zones.includes('UTC') ? zones : ['UTC', ...zones];
    return [...withUtc].sort((a, b) => a.localeCompare(b));
  } catch {
    return [...FALLBACK_TIMEZONES];
  }
}

/**
 * Verifie qu'un identifiant est utilisable par `Intl`. C'est la seule
 * validation fiable : la liste supportee varie d'un runtime a l'autre, et les
 * alias historiques (`Europe/Kiev`) restent acceptes sans y figurer.
 */
export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Fuseau stocke, ramene au defaut s'il est vide ou devenu invalide. */
export function normalizeTimezone(value: unknown): string {
  return isValidTimezone(value) ? value : DEFAULT_TIMEZONE;
}
