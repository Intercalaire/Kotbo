/**
 * Décision « journaliser ou non » pour un type d'événement, et son cache.
 *
 * Extrait de `sendLogEmbed` parce que le défaut qu'on corrige ici venait
 * précisément de deux chemins qui ne décidaient pas sur la même valeur : au
 * premier passage la variable valait `null` (donc on journalisait), et le cache
 * recevait un marqueur relu ensuite comme un refus. Un log partait, les
 * suivants disparaissaient pendant toute la durée de vie du cache.
 *
 * Ici, froid et chaud passent par la même normalisation : la décision ne peut
 * plus dépendre du fait qu'on vienne de lire la base ou non.
 *
 * L'absence de ligne vaut « activé » : le schéma pose `enabled @default(true)`
 * et le semis du dashboard crée les lignes manquantes avec `enabled: true`.
 * Un serveur qui n'a jamais ouvert la page des logs doit donc être journalisé.
 */

/** Ce que la base rend pour un type d'événement, ou `null` s'il n'y a pas de ligne. */
export interface LigneConfigLog {
  enabled: boolean;
  channelId: string | null;
}

/** Ce que le cache mémorise. L'absence de ligne est une valeur, pas un vide. */
export type EntreeConfigLog =
  | { present: true; enabled: boolean; channelId: string | null }
  | { present: false };

export interface DecisionLog {
  journaliser: boolean;
  /** Salon dédié ; `null` renvoie l'appelant au salon de logs par défaut. */
  channelId: string | null;
}

/** Met la lecture de base et le contenu du cache sous la même forme. */
export function normaliserConfigLog(ligne: LigneConfigLog | null): EntreeConfigLog {
  return ligne
    ? { present: true, enabled: ligne.enabled, channelId: ligne.channelId }
    : { present: false };
}

/** La décision elle-même, sans effet de bord ni dépendance. */
export function deciderConfigLog(entree: EntreeConfigLog): DecisionLog {
  if (!entree.present) return { journaliser: true, channelId: null };
  return { journaliser: entree.enabled, channelId: entree.channelId };
}

export interface ResolutionConfigLog {
  cle: string;
  lireEnBase: () => Promise<LigneConfigLog | null>;
  cacheGet: (cle: string) => Promise<EntreeConfigLog | null>;
  cacheSet: (cle: string, valeur: EntreeConfigLog) => Promise<void>;
}

/**
 * Résout la configuration d'un type d'événement, en passant par le cache.
 *
 * Les dépendances sont injectées : le banc de mesure rejoue une rafale avec un
 * cache en mémoire et compte les décisions, sans toucher ni à Discord ni à la
 * base.
 */
export async function resoudreConfigLog(io: ResolutionConfigLog): Promise<DecisionLog> {
  const memorise = await io.cacheGet(io.cle);
  if (memorise) return deciderConfigLog(memorise);

  const entree = normaliserConfigLog(await io.lireEnBase());
  await io.cacheSet(io.cle, entree);
  return deciderConfigLog(entree);
}
