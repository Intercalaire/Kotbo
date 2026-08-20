/**
 * Fuseau horaire d'un serveur, cote bot.
 *
 * Le process tourne en UTC : `toLocaleString('fr-FR')` sans option `timeZone`
 * affiche l'heure UTC sous un habillage francais, et `new Date('2026-08-20
 * 21:00')` lit la chaine comme de l'UTC. Une reunion planifiee a 21h a Paris
 * etait donc annoncee a 19h, ou enregistree a 23h selon le chemin emprunte.
 *
 * Tout affichage ou toute lecture de date saisie par un humain passe par ce
 * module. Pour du texte lu uniquement sur Discord, un horodatage `<t:…>` reste
 * preferable : chaque membre y voit sa propre heure locale, sans dependre du
 * reglage du serveur. Ce module sert les cas ou ce n'est pas possible - inbox
 * du dashboard, journal d'audit, choix d'autocompletion.
 */

import {
  DEFAULT_TIMEZONE,
  normalizeTimezone,
  parseDateTimeInTimezone,
  toWallClockUtcMs,
  zonedTimeToInstant,
} from '@kotbo/contracts';
import type { BotLocale } from './i18n.js';

export { DEFAULT_TIMEZONE, parseDateTimeInTimezone, toWallClockUtcMs, zonedTimeToInstant };

const BCP47: Record<BotLocale, string> = { fr: 'fr-FR', en: 'en-US' };

/**
 * Fuseau configure pour un serveur, ramene au defaut si absent ou invalide.
 *
 * `utils/cache` est importe a la demande : il tire Redis et Prisma, dont les
 * fonctions pures de ce module - celles que couvrent les tests unitaires, et
 * celles qu'utilise le parseur de `/transcript` - n'ont pas besoin. Un import
 * statique ferait echouer ces tests au chargement, `utils/db` exigeant
 * `DATABASE_URL`.
 *
 * La lecture du champ est volontairement non typee : le cache peut rendre une
 * entree ecrite avant le deploiement, donc sans la colonne, que le type Prisma
 * decrit pourtant comme toujours presente.
 */
export async function resolveGuildTimezone(guildId: string | null | undefined): Promise<string> {
  if (!guildId) return DEFAULT_TIMEZONE;
  const { getCachedGuild } = await import('./cache.js');
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

