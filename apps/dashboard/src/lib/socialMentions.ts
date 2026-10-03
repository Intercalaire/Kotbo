/**
 * Mention d'un suivi social (YouTube, Twitch, GitHub, Hugging Face).
 *
 * Le ping est envoyé tel quel par le bot, donc seules `@everyone`, `@here` et
 * un rôle existant peuvent fonctionner. La clé manipulée dans l'UI reste l'ID
 * du rôle (lisible dans la liste), la conversion en mention Discord se fait à
 * l'enregistrement.
 */

export type SelectOption = { id: string; name: string };

export function buildMentionOptions(roles: ReadonlyArray<{ id: string; name: string }>): SelectOption[] {
  return [
    { id: 'everyone', name: '@everyone' },
    { id: 'here', name: '@here' },
    ...roles.map((r) => ({ id: r.id, name: '@' + r.name })),
  ];
}

/** Mention stockée en base -> clé du sélecteur (vide si la valeur est inexploitable). */
export function mentionToKey(mention?: string | null): string {
  const raw = (mention || '').trim();
  if (!raw) return '';
  if (raw === '@everyone') return 'everyone';
  if (raw === '@here') return 'here';
  const tagged = raw.match(/^<@&(\d{5,})>$/);
  if (tagged) return tagged[1];
  // Ancien format : certains suivis ne stockaient que l'ID brut du rôle.
  if (/^\d{5,}$/.test(raw)) return raw;
  return '';
}

/** Clé du sélecteur -> mention envoyée à l'API. */
export function keyToMention(key?: string | null): string | null {
  const raw = (key || '').trim();
  if (!raw) return null;
  if (raw === 'everyone') return '@everyone';
  if (raw === 'here') return '@here';
  return `<@&${raw}>`;
}

/** Ajoute la clé de sélection aux suivis renvoyés par l'API. */
export function withMentionKey<T extends { mention?: string | null }>(list: T[] | undefined | null) {
  return (list || []).map((f) => ({ ...f, mentionKey: mentionToKey(f.mention) }));
}
