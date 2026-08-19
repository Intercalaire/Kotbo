/**
 * Fuseau horaire d'un serveur, cote bot.
 *
 * Le process tourne en UTC : `toLocaleString('fr-FR')` sans option `timeZone`
 * affiche l'heure UTC sous un habillage francais, et `new Date('2026-08-20
 * 21:00')` lit la chaine comme de l'UTC. Une reunion planifiee a 21h a Paris
 * etait donc annoncee a 19h, ou enregistree a 23h selon le chemin emprunte.
 *
 * Tout affichage ou toute lecture de date saisie par un humain passe par ce
 * module. Pour du texte poste sur Discord, prefer `discordTimestamp` : chaque
 * membre voit alors sa propre heure locale, sans dependre du reglage du
 * serveur.
 */

import { DEFAULT_TIMEZONE, normalizeTimezone } from '@kotbo/contracts';
import { getCachedGuild } from './cache.js';
import type { BotLocale } from './i18n.js';

export { DEFAULT_TIMEZONE };

const BCP47: Record<BotLocale, string> = { fr: 'fr-FR', en: 'en-US' };

/** Fuseau configure pour un serveur, ramene au defaut si absent ou invalide. */
export async function resolveGuildTimezone(guildId: string | null | undefined): Promise<string> {
  if (!guildId) return DEFAULT_TIMEZONE;
  const guild = await getCachedGuild(guildId);
  return normalizeTimezone((guild as { timezone?: unknown } | null)?.timezone);
}

/** Date et heure lisibles dans un fuseau donne. */
export function formatInTimezone(
  date: Date,
  timezone: string,
  locale: BotLocale = 'fr',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat(BCP47[locale], { ...options, timeZone: normalizeTimezone(timezone) })
    .format(date);
}

/** Raccourci : resout le fuseau du serveur puis formate. */
export async function formatGuildDateTime(
  guildId: string | null | undefined,
  date: Date,
  locale: BotLocale = 'fr',
  options?: Intl.DateTimeFormatOptions,
): Promise<string> {
  return formatInTimezone(date, await resolveGuildTimezone(guildId), locale, options);
}

/**
 * Horodatage Discord (`<t:1234567890:F>`), rendu par le client de chaque
 * membre dans son propre fuseau. A privilegier partout ou le texte est poste
 * sur Discord plutot que lu dans le dashboard.
 */
export function discordTimestamp(date: Date, style: 'F' | 'f' | 'R' | 'd' | 't' = 'F'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/** Decalage du fuseau, en millisecondes, a l'instant donne. */
function offsetAt(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // `hour12: false` rend minuit « 24 » sur certains runtimes ; laisse tel quel,
  // `Date.UTC` reporte simplement sur le jour suivant, ce qui est correct.
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );

  return asUtc - instant.getTime();
}

/**
 * Convertit une heure murale (celle que l'admin a tapee) en instant reel.
 *
 * Le decalage depend de l'instant qu'on cherche justement a calculer : on part
 * d'une approximation, puis on corrige. La seconde passe suffit sauf sur les
 * heures qui n'existent pas lors du passage a l'heure d'ete, ou l'instant
 * retenu tombe apres le saut.
 */
export function zonedTimeToInstant(wallClockUtcMs: number, timezone: string): Date {
  const zone = normalizeTimezone(timezone);
  const first = new Date(wallClockUtcMs - offsetAt(new Date(wallClockUtcMs), zone));
  return new Date(wallClockUtcMs - offsetAt(first, zone));
}

/** `YYYY-MM-DD HH:mm`, `YYYY-MM-DDTHH:mm`, avec secondes optionnelles. */
const WALL_CLOCK_REGEX = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Lit une date saisie par un humain dans le fuseau du serveur.
 *
 * Une chaine deja horodatee (`…Z`, `+02:00`) designe un instant sans ambiguite
 * et est rendue telle quelle : seules les saisies sans fuseau sont interpretees
 * dans `timezone`.
 */
export function parseDateTimeInTimezone(input: string, timezone: string): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(WALL_CLOCK_REGEX);
  if (match) {
    const wallClock = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      match[4] ? Number(match[4]) : 0,
      match[5] ? Number(match[5]) : 0,
      match[6] ? Number(match[6]) : 0,
    );
    if (Number.isNaN(wallClock)) return null;
    return zonedTimeToInstant(wallClock, timezone);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
