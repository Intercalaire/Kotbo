/**
 * Salon de logs par défaut d'un serveur, et son cache.
 *
 * Extrait de `getGuildLogChannelId` (`advancedLogs.ts`), qui gardait son propre
 * `Map` en mémoire avec son propre TTL, à côté de `utils/cache.ts`.
 * `cache.invalidateGuild` ne purge que les clés préfixées `guild:<id>:` de ses
 * deux magasins (mémoire du processus et Redis) — ce `Map`-là n'en faisait pas
 * partie, et rien d'autre ne le purgeait.
 *
 * Conséquence : un administrateur qui changeait son salon de logs depuis le
 * dashboard voyait le `PATCH /settings` appeler consciencieusement
 * `invalidateGuild`… sans le moindre effet ici. Le bot continuait d'écrire dans
 * l'ancien salon jusqu'à soixante secondes, sans que rien ne le signale.
 *
 * Le remède est celui déjà appliqué à la configuration par type d'événement,
 * dix lignes plus bas dans la même fonction `sendLogEmbed` : sortir la décision
 * dans une fonction pure aux dépendances injectées, et passer par le cache
 * commun — celui que l'invalidation atteint.
 */

/** Ce que la base rend pour un serveur. */
export interface LigneLogChannel {
  logChannelId: string | null;
  /** Faux seulement si la fonctionnalité « logs » est explicitement désactivée. */
  logsEnabled: boolean;
}

/**
 * Ce que le cache retient.
 *
 * L'enveloppe n'est pas une coquetterie : si l'on mettait en cache
 * `string | null` nu, un `cacheGet` rendant `null` serait indiscernable d'une
 * absence de cache. Tous les serveurs **sans** salon de logs — de loin les plus
 * nombreux — repaieraient alors une lecture en base à chaque événement, et le
 * cache ne servirait plus à rien pour eux. Un objet, même portant
 * `channelId: null`, dit « en cache, et la réponse est : aucun salon ».
 */
export interface EntreeLogChannel {
  channelId: string | null;
}

export interface ResolutionLogChannel {
  cle: string;
  lireEnBase: () => Promise<LigneLogChannel>;
  cacheGet: (cle: string) => Promise<EntreeLogChannel | null>;
  cacheSet: (cle: string, valeur: EntreeLogChannel) => Promise<void>;
}

/** Le salon de logs par défaut du serveur, ou `null` s'il n'y en a pas d'utilisable. */
export async function resoudreLogChannel(io: ResolutionLogChannel): Promise<string | null> {
  const memorise = await io.cacheGet(io.cle);
  if (memorise) return memorise.channelId;

  const ligne = await io.lireEnBase();
  const channelId = ligne.logsEnabled ? ligne.logChannelId : null;
  await io.cacheSet(io.cle, { channelId });
  return channelId;
}
