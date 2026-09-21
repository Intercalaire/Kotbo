/**
 * Résolution d'un salon de logs.
 *
 * Le défaut que ce module corrige se répétait à onze endroits, toujours sous la
 * même forme :
 *
 *     const ch = guild.channels.cache.get(id);
 *     if (ch?.isTextBased()) { await ch.send(...) }        // sans else
 *
 * Un salon absent du cache — bot redémarré, salon peu actif, cache évincé —
 * faisait disparaître le log sans exception, sans avertissement et sans trace.
 * Le `catch` qui entoure parfois ces blocs ne se déclenchait jamais : un cache
 * manquant ne lève rien, il rend `undefined`.
 *
 * Le motif correct existait déjà dans le dépôt, dans `sendLogEmbed` : un vrai
 * `fetch` en repli. Il est mis ici pour être appelé, pas recopié.
 *
 * Second défaut, sur un serveur dont le salon de logs a été supprimé : sans
 * garde-fou, CHAQUE appel — un par message pendant un raid, un
 * par sanction AutoMod, un par déclenchement du honeypot — repaie un `fetch`
 * REST et une ligne d'avertissement. Le remède est un cache négatif de courte
 * durée, calqué sur `guildReadFailures` dans `cache.ts` : même problème (une
 * configuration cassée réinterrogée à chaque événement), même solution.
 *
 * Pourquoi en mémoire et pas dans Redis : le sharding répartit chaque serveur
 * sur un seul processus, une fois pour toutes. Tous les événements d'un serveur
 * donné retombent donc toujours sur la même table — un cache partagé
 * n'apporterait rien, et ajouterait une dépendance réseau sur un chemin qui est
 * déjà en train d'échouer.
 *
 * Ce repli ne couvre QUE le salon devenu introuvable. Une permission d'écriture
 * retirée ne fait pas disparaître le salon du cache de discord.js — `isSendable()`
 * est purement typologique (`'send' in this`), il ne regarde aucune permission.
 * Le salon est donc rendu normalement, et l'envoi échoue plus tard, chez
 * l'appelant. C'est un autre problème, et il se traite ailleurs.
 *
 * Pourquoi pas `recordAndCheckBurst` (`utils/burstTracker.ts`) : il répond à
 * « le rythme de X dépasse-t-il N sur la fenêtre ? », recalculé à chaque appel,
 * et non à « a-t-on déjà prévenu pour CETTE panne ». Surtout, il n'observe
 * qu'un événement déjà survenu : il n'empêcherait jamais le `fetch`, qui est
 * précisément le coût à supprimer.
 *
 * Le garde-fou est `isSendable()`, pas `isTextBased()`. La différence n'est pas
 * cosmétique : `isTextBased()` vaut `'messages' in this`, et un
 * `PartialGroupDMChannel` a bien un `messages` alors que `send` est exclu de sa
 * classe. Sur le chemin `Client`, `.send()` y lèverait un `TypeError`
 * **synchrone**, qu'aucun `.catch()` de l'appelant ne peut intercepter. Le
 * dépôt emploie déjà `isSendable()` à plus de dix endroits pour cette raison.
 */

import type { Client, Guild, SendableChannels } from 'discord.js';
import { logger } from './logger.js';

function isUsable(channel: unknown): channel is SendableChannels {
  return (
    Boolean(channel) &&
    typeof (channel as { isSendable?: () => boolean }).isSendable === 'function' &&
    (channel as { isSendable: () => boolean }).isSendable()
  );
}

/**
 * Durée pendant laquelle on cesse d'interroger Discord pour un salon dont la
 * dernière résolution a échoué.
 *
 * 60 s, la même valeur que `GUILD_READ_FAILURE_BACKOFF_MS` et que la durée de
 * vie du cache de configuration de serveur — délibérément, pour ne pas
 * introduire un seuil de fraîcheur de plus : un salon reconfiguré est repris au
 * plus tard aussi vite que la configuration elle-même se rafraîchit déjà.
 */
const UNRESOLVABLE_BACKOFF_MS = 60_000;

/**
 * `label:channelId` -> instant du dernier échec.
 *
 * La clé porte l'appelant, et pas seulement le salon : rien n'empêche un
 * administrateur de diriger les tickets, l'AutoMod et le honeypot vers le même
 * salon. Avec une clé réduite au salon, le premier service à échouer poserait
 * le repli et les dix autres se tairaient pendant une minute **sans un seul
 * avertissement à leur nom** — exactement ce que `label` est censé garantir.
 * Le prix est d'au plus un `fetch` par appelant et par fenêtre au lieu d'un
 * seul ; la rafale, elle, reste supprimée.
 */
const unresolvableSince = new Map<string, number>();

/**
 * Le salon de logs, ou `null` — mais jamais en silence.
 *
 * `label` nomme l'appelant : il devient le tag de l'avertissement, comme partout
 * ailleurs dans le dépôt. Sans lui, un administrateur qui lit les journaux du
 * bot saurait qu'un log s'est perdu, mais pas lequel.
 *
 * Aucun avertissement quand `channelId` est vide : ce n'est pas une panne, c'est
 * une absence de configuration. Avertir là remplirait les journaux de tous les
 * serveurs qui n'ont jamais voulu de salon de logs, et noierait les vraies
 * pertes.
 */
export async function resolveLogChannel(
  source: Guild | Client,
  channelId: string | null | undefined,
  label: string,
  now: number = Date.now(),
): Promise<SendableChannels | null> {
  if (!channelId) return null;

  const channels = 'channels' in source ? source.channels : null;
  if (!channels) return null;

  // Le cache natif est consulté en premier, avant même de regarder le repli : si
  // le salon redevient visible par un événement de passerelle pendant la fenêtre,
  // il est repris tout de suite, sans attendre l'expiration.
  const cached = channels.cache.get(channelId);
  if (isUsable(cached)) {
    unresolvableSince.delete(`${label}:${channelId}`);
    return cached;
  }

  const cleRepli = `${label}:${channelId}`;
  const failedAt = unresolvableSince.get(cleRepli);
  if (failedAt !== undefined && now - failedAt < UNRESOLVABLE_BACKOFF_MS) {
    // Panne déjà signalée récemment : ni nouveau `fetch`, ni nouvel avertissement.
    return null;
  }

  const fetched = await channels.fetch(channelId).catch(() => null);
  if (isUsable(fetched)) {
    // Nettoyage de la table, pas une regle de comportement : une entree ne peut
    // etre que perimee a ce stade (une entree fraiche aurait court-circuite le
    // `fetch` juste au-dessus), donc la retirer ne change aucune decision. Sans
    // cette ligne, la table garderait indefiniment un marqueur pour chaque
    // salon un jour tombe en panne. Aucun test ne peut donc la garder : c'est
    // voulu, et c'est pour ca qu'elle est commentee plutot que testee.
    unresolvableSince.delete(cleRepli);
    return fetched;
  }

  // Le point de tout ce module : une perte de log laisse une trace — mais une
  // seule par fenêtre, pas une par événement.
  unresolvableSince.set(cleRepli, now);
  logger.warn(label, `Salon de logs ${channelId} introuvable ou non textuel, le log n'a pas été envoyé.`);
  return null;
}

/**
 * Oublie la panne mémorisée pour un salon, ou pour tous.
 *
 * Réservé aux tests : `unresolvableSince` est un état de module, donc partagé
 * entre les fichiers de test d'un même processus. Sans remise à zéro, un
 * fichier qui arme le repli sur un identifiant ferait échouer, pour une raison
 * sans rapport, le fichier suivant qui emploie le même. `burstTracker.test.ts`
 * résout déjà le même piège de la même façon.
 */
export function resetLogChannelBackoff(): void {
  unresolvableSince.clear();
}
