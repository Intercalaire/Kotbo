import { m } from './i18n';

/**
 * Familles de notifications du dashboard, pour que chacun choisisse ce qu'il
 * recoit. Une notification n'a pas de champ « categorie » en base : sa famille
 * se lit sur la page vers laquelle elle mene, ce qui suffit a trier ce que
 * le bot envoie aujourd'hui et ne demande aucune migration.
 *
 * Le choix filtre la cloche, son compteur, le son et les notifications de
 * bureau. Il ne change rien aux messages prives Discord envoyes par le bot.
 */
export type NotificationCategory = 'staff' | 'planning' | 'moderation' | 'tickets' | 'partnerships' | 'general';

export const NOTIFICATION_CATEGORIES: { key: NotificationCategory; label: () => string }[] = [
  { key: 'staff', label: () => m.notif_cat_staff() },
  { key: 'planning', label: () => m.notif_cat_planning() },
  { key: 'moderation', label: () => m.notif_cat_moderation() },
  { key: 'tickets', label: () => m.notif_cat_tickets() },
  { key: 'partnerships', label: () => m.notif_cat_partnerships() },
  { key: 'general', label: () => m.notif_cat_general() },
];

const BY_PATH: [RegExp, NotificationCategory][] = [
  [/^\/(?:procedures|staff-management|recruitment|tutoring|evaluations|profile)\b/, 'staff'],
  [/^\/(?:planning|absences|meetings)\b/, 'planning'],
  [/^\/(?:security|sanctions|appeals|admin-lock)\b/, 'moderation'],
  [/^\/(?:tickets|transcripts)/, 'tickets'],
  [/^\/partner/, 'partnerships'],
];

export function categoryOf(link?: string | null): NotificationCategory {
  if (!link) return 'general';
  const path = link.startsWith('/') ? link : (() => {
    try {
      return new URL(link).pathname;
    } catch {
      return '';
    }
  })();
  return BY_PATH.find(([pattern]) => pattern.test(path))?.[1] ?? 'general';
}
