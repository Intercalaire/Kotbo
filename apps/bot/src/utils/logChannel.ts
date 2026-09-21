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
): Promise<SendableChannels | null> {
  if (!channelId) return null;

  const channels = 'channels' in source ? source.channels : null;
  if (!channels) return null;

  const cached = channels.cache.get(channelId);
  if (isUsable(cached)) return cached;

  const fetched = await channels.fetch(channelId).catch(() => null);
  if (isUsable(fetched)) return fetched;

  // Le point de tout ce module : une perte de log laisse une trace.
  logger.warn(label, `Salon de logs ${channelId} introuvable ou non textuel, le log n'a pas été envoyé.`);
  return null;
}
