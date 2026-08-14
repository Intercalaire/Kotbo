/**
 * Verrou de collecte analytique.
 *
 * `Guild.analyticsEnabled` n'est pas un filtre d'affichage : quand il vaut
 * false, plus rien n'est écrit. Le contrôle est posé au plus près de l'écriture
 * - dans `analyticsService`, `wordStatsService`, `ghostActivityTracker` et
 * `moduleStatsService` - plutôt qu'à l'entrée des modules, pour qu'un futur
 * appelant ne puisse pas contourner l'interrupteur en oubliant de le tester.
 *
 * Ce que la désactivation coupe : compteurs de messages, minutes vocales,
 * réactions, threads, réponses, arrivées/départs, statistiques par membre,
 * fréquence des mots, signaux « membres fantômes » et compteurs d'usage par
 * module. Ce qu'elle ne touche pas : les fonctionnalités elles-mêmes
 * (modération, tickets, niveaux…), qui gardent leurs propres réglages.
 */

import { getCachedGuild } from '../../utils/cache.js';

/**
 * `true` tant que le serveur n'a pas explicitement coupé la collecte.
 *
 * En cas de configuration illisible, `getCachedGuild` renvoie `null` : on
 * refuse alors d'écrire. Une lecture en échec ne doit pas se traduire par une
 * collecte par défaut - c'est le sens qu'attend un serveur qui a désactivé le
 * module.
 */
export async function isAnalyticsCollectionEnabled(guildId: string): Promise<boolean> {
  const guild = await getCachedGuild(guildId);
  if (!guild) return false;
  return guild.analyticsEnabled !== false;
}
