/**
 * Le salon de logs par défaut et son cache.
 *
 * Le défaut corrigé : `getGuildLogChannelId` gardait son propre `Map` en
 * mémoire, avec son propre TTL, à côté de `utils/cache.ts`.
 * `cache.invalidateGuild` ne purge que les clés préfixées `guild:<id>:` de ses
 * deux magasins — ce `Map`-là n'en faisait pas partie, et rien d'autre ne le
 * purgeait. Un administrateur qui changeait son salon depuis le dashboard
 * voyait le `PATCH /settings` appeler `invalidateGuild` sans le moindre effet
 * ici : le bot écrivait dans l'ancien salon jusqu'à soixante secondes.
 *
 * Aucun `mock.module` : la résolution est une fonction pure aux dépendances
 * injectées, on lui passe un faux cache. Rien ne fuit vers les autres fichiers
 * de test, donc pas de préfixe `zz-`.
 */
import { describe, expect, test } from 'bun:test';
import {
  resoudreLogChannel,
  type EntreeLogChannel,
  type LigneLogChannel,
} from '../../events/logChannelConfig.js';

function cacheFeint() {
  const valeurs = new Map<string, EntreeLogChannel>();
  return {
    valeurs,
    cacheGet: async (cle: string): Promise<EntreeLogChannel | null> => valeurs.get(cle) ?? null,
    cacheSet: async (cle: string, valeur: EntreeLogChannel): Promise<void> => {
      valeurs.set(cle, valeur);
    },
  };
}

describe('resoudreLogChannel', () => {
  test('après invalidation, la lecture suivante voit le nouveau salon', async () => {
    // Le cas qui motive tout le correctif.
    const cache = cacheFeint();
    const cle = 'guild:g1:log_channel';
    let ligne: LigneLogChannel = { logChannelId: 'ancien-salon', logsEnabled: true };
    const io = { cle, lireEnBase: async () => ligne, ...cache };

    expect(await resoudreLogChannel(io)).toBe('ancien-salon');

    // Ce que fait le PATCH du dashboard : il écrit en base, puis appelle
    // `cache.invalidateGuild`, qui efface toute clé préfixée `guild:<id>:`.
    // C'est précisément ce que l'ancien `Map` privé ne voyait jamais passer.
    ligne = { logChannelId: 'nouveau-salon', logsEnabled: true };
    cache.valeurs.delete(cle);

    expect(await resoudreLogChannel(io)).toBe('nouveau-salon');
  });

  test('la base n\'est interrogée qu\'une fois tant que le cache tient', async () => {
    // Témoin qui compte autant que le reste : sans lui, un correctif qui
    // supprimerait purement et simplement le cache passerait le test précédent.
    const cache = cacheFeint();
    let lectures = 0;
    const io = {
      cle: 'guild:g2:log_channel',
      lireEnBase: async () => {
        lectures += 1;
        return { logChannelId: 'salon', logsEnabled: true } satisfies LigneLogChannel;
      },
      ...cache,
    };

    await resoudreLogChannel(io);
    await resoudreLogChannel(io);

    expect(lectures).toBe(1);
  });

  test('un serveur sans salon configuré ne repaie pas une lecture par événement', async () => {
    // Le piège de l'enveloppe : si l'on mettait `null` nu en cache, un
    // `cacheGet` rendant `null` serait indiscernable d'une absence de cache, et
    // TOUS les serveurs sans salon de logs — les plus nombreux — liraient la
    // base à chaque événement.
    const cache = cacheFeint();
    let lectures = 0;
    const io = {
      cle: 'guild:g3:log_channel',
      lireEnBase: async () => {
        lectures += 1;
        return { logChannelId: null, logsEnabled: true } satisfies LigneLogChannel;
      },
      ...cache,
    };

    expect(await resoudreLogChannel(io)).toBeNull();
    expect(await resoudreLogChannel(io)).toBeNull();

    expect(lectures).toBe(1);
  });

  test('la fonctionnalité désactivée coupe le salon, même s\'il est renseigné', async () => {
    const cache = cacheFeint();
    const io = {
      cle: 'guild:g4:log_channel',
      lireEnBase: async () => ({ logChannelId: 'salon', logsEnabled: false }) satisfies LigneLogChannel,
      ...cache,
    };

    expect(await resoudreLogChannel(io)).toBeNull();
  });
});
