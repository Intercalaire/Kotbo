/**
 * Rattachement des écouteurs à leur module.
 *
 * Les écouteurs d'événements sont enregistrés une fois pour toutes au démarrage
 * alors que l'état d'un module est propre à chaque serveur : on ne peut donc pas
 * décider à l'enregistrement, il faut décider à chaque événement. Poser la
 * question dans chacun des vingt écouteurs aurait garanti l'oubli — c'est
 * exactement ce qui s'était produit avec l'état lui-même, lu à cinq endroits sur
 * une trentaine de modules.
 *
 * Deux enveloppes couvrent les deux façons dont un module s'abonne :
 * `scopeClientToModule` pour `client.on(...)`, `subscribeForModule` pour le bus
 * interne. Dans les deux cas, l'écouteur n'est jamais appelé si son module est
 * éteint sur le serveur d'où vient l'événement.
 */
import type { Client } from 'discord.js';
import { kotboEventBus, type KotboEventMap, type KotboEventName } from '@kotbo/core';
import { logger } from '../../utils/logger.js';
import { resolveEventGuildId } from '../../utils/eventGuild.js';
import { isModuleEnabled } from './moduleGate.js';

type Listener = (...args: unknown[]) => unknown;

/**
 * Renvoie une vue du client dont `on`/`once` filtrent par module.
 *
 * Le reste du client passe inchangé : les fonctions d'enregistrement font
 * souvent bien plus que s'abonner (elles lisent le cache des guildes, envoient
 * des messages, démarrent des boucles) et doivent continuer de fonctionner.
 * Ces traitements-là, qui ne naissent pas d'un événement, portent leur propre
 * garde là où ils s'exécutent.
 */
export function scopeClientToModule(client: Client, moduleKey: string): Client {
  const gate = (listener: Listener): Listener => {
    return (...args: unknown[]) => {
      const guildId = resolveEventGuildId(args);
      if (!guildId) return listener(...args);

      // L'écouteur d'origine peut être synchrone ; la vérification, elle, ne
      // l'est jamais. On rend donc la main tout de suite et on poursuit dans la
      // promesse : discord.js ignore la valeur de retour de ses écouteurs.
      void isModuleEnabled(guildId, moduleKey)
        .then((enabled) => {
          if (enabled) return listener(...args);
          return undefined;
        })
        .catch((err) => logger.error('ModuleScope', `Écouteur ${moduleKey} en échec :`, err));

      return undefined;
    };
  };

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'on' || prop === 'once') {
        return (event: string, listener: Listener) => {
          (target[prop as 'on' | 'once'] as (e: string, l: Listener) => unknown)(event, gate(listener));
          return receiver;
        };
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as Client;
}

/**
 * Abonnement au bus interne restreint à un module.
 *
 * Un payload sans `guildId` (événement global) passe : il n'y a pas de serveur
 * dont on pourrait lire l'état.
 */
export function subscribeForModule<E extends KotboEventName>(
  moduleKey: string,
  event: E,
  handler: (payload: KotboEventMap[E]) => void | Promise<void>,
  /**
   * Nom d'abonné passé au bus, qui s'en sert pour tracer les erreurs. Distinct
   * de la clé du module : plusieurs abonnés (`autothread`, `sticky`) peuvent
   * appartenir au même module et doivent rester distinguables dans les logs.
   */
  busModuleName?: string,
): void {
  kotboEventBus.subscribe(event, async (payload) => {
    const guildId = (payload as { guildId?: string | null }).guildId;
    if (guildId && !(await isModuleEnabled(guildId, moduleKey))) return;
    await handler(payload);
  }, busModuleName ?? moduleKey);
}
