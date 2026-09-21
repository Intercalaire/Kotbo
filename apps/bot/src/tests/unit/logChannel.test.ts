/**
 * Le résolveur de salon de logs.
 *
 * Ces cas ne peuvent pas rougir sur l'ancien code : `utils/logChannel.ts` n'y
 * existe pas, ce fichier n'y compile donc pas. Ils ne prouvent PAS la
 * correction du défaut — c'est le rôle de `logTicketEventRepli.test.ts`. Ils
 * verrouillent le contrat pour la suite : un repli qui disparaîtrait, un
 * avertissement qui se tairait, ou un avertissement qui se mettrait à crier sur
 * un serveur simplement pas configuré.
 *
 * Aucun `mock.module` ici : `logger` est un objet exporté, on remplace sa
 * méthode `warn` le temps du cas et on la remet après. Rien ne fuit vers les
 * autres fichiers de test, donc pas de préfixe `zz-`.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Client } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { resetLogChannelBackoff, resolveLogChannel } from '../../utils/logChannel.js';

const SALON = 'salon-de-logs';

type Salon = NonNullable<Awaited<ReturnType<typeof resolveLogChannel>>>;

/** Le résolveur ne demande qu'une chose à un salon : savoir dire s'il accepte un envoi. */
function salon(envoyable: boolean): Salon {
  return { id: SALON, isSendable: () => envoyable } as unknown as Salon;
}

/**
 * Une source dont les deux chemins sont observés séparément. `fetch` est un
 * mock : c'est lui qui dit si le repli a été emprunté, et combien de fois.
 */
function source(options: { enCache?: unknown; recuperable?: unknown; fetchCasse?: boolean } = {}) {
  const cache = new Map<string, unknown>();
  if (options.enCache !== undefined) cache.set(SALON, options.enCache);

  const fetch = mock(async () => {
    if (options.fetchCasse) throw new Error('Unknown Channel');
    return options.recuperable ?? null;
  });

  return { fetch, client: { channels: { cache, fetch } } as unknown as Client };
}

const warnOrigine = logger.warn;
let avertissements: string[] = [];

beforeEach(() => {
  // `unresolvableSince` est un etat de module : sans remise a zero, l'echec
  // d'un cas armerait le repli pour les suivants, qui emploient le meme
  // identifiant de salon.
  resetLogChannelBackoff();
  avertissements = [];
  logger.warn = (tag: string, ...args: unknown[]) => {
    avertissements.push(`${tag} ${args.map((a) => String(a)).join(' ')}`);
  };
});

afterEach(() => {
  logger.warn = warnOrigine;
});

describe('resolveLogChannel', () => {
  test('rend le salon du cache sans toucher au réseau', async () => {
    const attendu = salon(true);
    const { client, fetch } = source({ enCache: attendu });

    expect(await resolveLogChannel(client, SALON, 'Test')).toBe(attendu);
    // Le cache reste le chemin normal : le repli ne doit pas doubler chaque log
    // d'un appel à l'API Discord.
    expect(fetch).not.toHaveBeenCalled();
    expect(avertissements).toEqual([]);
  });

  test('récupère le salon absent du cache, avec exactement un fetch', async () => {
    const attendu = salon(true);
    const { client, fetch } = source({ recuperable: attendu });

    expect(await resolveLogChannel(client, SALON, 'Test')).toBe(attendu);
    // « Exactement un » et pas « au moins un » : un résolveur qui réessaie en
    // boucle transformerait une panne de log en rafale de requêtes Discord.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(avertissements).toEqual([]);
  });

  test("introuvable partout : null, et un avertissement qui nomme l'appelant", async () => {
    const { client } = source();

    expect(await resolveLogChannel(client, SALON, 'Ticket')).toBeNull();

    // Tout le point du module : une perte de log laisse une trace lisible.
    // Sans le tag, un administrateur saurait qu'un log s'est perdu mais pas
    // lequel.
    expect(avertissements).toHaveLength(1);
    expect(avertissements[0]).toContain('Ticket');
    expect(avertissements[0]).toContain(SALON);
  });

  test('un fetch qui lève est traité comme une absence, pas comme un crash', async () => {
    // `channels.fetch` lève sur un salon supprimé ou sur une permission retirée.
    // Une exception ici remonterait dans un handler d'événement Discord.
    const { client } = source({ fetchCasse: true });

    expect(await resolveLogChannel(client, SALON, 'AutoModService')).toBeNull();
    expect(avertissements).toHaveLength(1);
    expect(avertissements[0]).toContain('AutoModService');
  });

  test('un salon trouvé mais incapable de recevoir un message est refusé', async () => {
    // Salon vocal ou catégorie laissé dans la configuration : il existe, donc
    // le fetch réussit, mais on ne peut rien y écrire. Le garde-fou est
    // `isSendable()` et non `isTextBased()` : un `PartialGroupDMChannel` passe
    // le second et n'a pourtant pas de `send`, ce qui lèverait un TypeError
    // synchrone qu'aucun `.catch()` de l'appelant n'intercepterait.
    const vocal = salon(false);
    const { client } = source({ enCache: vocal, recuperable: vocal });

    expect(await resolveLogChannel(client, SALON, 'ClansSecurity')).toBeNull();
    expect(avertissements).toHaveLength(1);
  });

  test('sans identifiant configuré : null, et surtout aucun avertissement', async () => {
    // Ce n'est pas une panne, c'est une absence de configuration. Avertir ici
    // remplirait les journaux de tous les serveurs qui n'ont jamais voulu de
    // salon de logs, et noierait les vraies pertes.
    const { client, fetch } = source();

    expect(await resolveLogChannel(client, null, 'ClansSecurity')).toBeNull();
    expect(await resolveLogChannel(client, undefined, 'ClansSecurity')).toBeNull();
    expect(await resolveLogChannel(client, '', 'ClansSecurity')).toBeNull();

    expect(avertissements).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  test("cinquante résolutions d'un salon introuvable ne coûtent qu'un seul fetch", async () => {
    // Le cas qui motive le repli : sur un chemin chaud — une sanction par
    // message pendant un raid, le salon piège du honeypot — un salon supprimé
    // faisait payer un aller-retour REST et une ligne de journal par événement.
    const { client, fetch } = source();

    for (let i = 0; i < 50; i += 1) {
      expect(await resolveLogChannel(client, SALON, 'Test', 1_000 + i)).toBeNull();
    }

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(avertissements).toHaveLength(1);
  });

  test("le repli tient jusqu'à son expiration, pas une milliseconde de plus", async () => {
    const { client, fetch } = source();

    expect(await resolveLogChannel(client, SALON, 'Test', 0)).toBeNull();
    expect(await resolveLogChannel(client, SALON, 'Test', 59_999)).toBeNull();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(avertissements).toHaveLength(1);
  });

  test("le salon corrigé est repris à l'expiration, et un nouvel échec ré-avertit", async () => {
    // Le risque d'un cache négatif est de transformer un correctif en nouvelle
    // panne silencieuse : un salon recréé doit être repris, et une panne qui
    // revient doit à nouveau se voir. Ce n'est pas un « déjà averti » à vie.
    const bon = salon(true);
    const { client, fetch } = source();

    expect(await resolveLogChannel(client, SALON, 'Test', 0)).toBeNull();
    expect(avertissements).toHaveLength(1);

    fetch.mockImplementation(async () => bon);
    expect(await resolveLogChannel(client, SALON, 'Test', 60_000)).toBe(bon);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(avertissements).toHaveLength(1);

    fetch.mockImplementation(async () => null);
    expect(await resolveLogChannel(client, SALON, 'Test', 130_000)).toBeNull();
    expect(avertissements).toHaveLength(2);
  });
  test('le repli est pose par appelant, pas par salon', async () => {
    // Rien n'empeche un administrateur de diriger les tickets, l'AutoMod et le
    // honeypot vers le meme salon. Avec un repli indexe sur le seul salon, le
    // premier service a echouer ferait taire tous les autres pendant une
    // minute — sans un seul avertissement a leur nom, alors que c'est
    // exactement ce que l'etiquette est censee garantir.
    const { client, fetch } = source();

    expect(await resolveLogChannel(client, SALON, 'AutoModService', 0)).toBeNull();
    expect(await resolveLogChannel(client, SALON, 'Ticket', 1)).toBeNull();

    expect(avertissements).toHaveLength(2);
    expect(avertissements[0]).toContain('AutoModService');
    expect(avertissements[1]).toContain('Ticket');
    expect(fetch).toHaveBeenCalledTimes(2);

    // Et chacun garde son propre repli : le second appelant ne repaie pas.
    expect(await resolveLogChannel(client, SALON, 'Ticket', 2)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("un salon qui reapparait dans le cache est repris sans attendre l'expiration", async () => {
    // La garantie que le module annonce : le cache natif est consulte AVANT le
    // repli, donc un evenement de passerelle qui remet le salon en cache le
    // rend utilisable tout de suite. Sans ce cas, un refactor qui inverserait
    // les deux verifications casserait la garantie sans faire rougir un test.
    const bon = salon(true);
    const { client, fetch } = source();

    expect(await resolveLogChannel(client, SALON, 'Test', 0)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    // Le salon revient dans le cache a t+30s, bien avant l'expiration du repli.
    (client.channels.cache as Map<string, unknown>).set(SALON, bon);

    expect(await resolveLogChannel(client, SALON, 'Test', 30_000)).toBe(bon);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(avertissements).toHaveLength(1);
  });
});
