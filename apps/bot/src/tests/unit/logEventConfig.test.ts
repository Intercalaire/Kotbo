/**
 * Décision « journaliser ou non » pour un type d'événement.
 *
 * Le défaut corrigé ici : le chemin FROID et le chemin CHAUD ne décidaient pas
 * sur la même valeur.
 *
 *   config = await prisma...findUnique(...);              // null : aucune ligne
 *   await cache.set(key, config ?? { disabledDummy: true }, 60);
 *   if (config && ('disabledDummy' in config || !config.enabled)) return;
 *
 * Au premier passage `config` vaut `null`, la garde est sautée, le log part.
 * Mais le cache vient de recevoir `{ disabledDummy: true }` : tous les
 * événements suivants du même type sont jetés pendant 60 secondes. Puis ça
 * recommence. Un log par minute au maximum, sans la moindre trace.
 *
 * Le `??` écrivait dans le cache, pas dans la variable qui décidait.
 *
 * L'absence de ligne signifie « activé » : le schéma pose `enabled @default(true)`
 * et le semis du dashboard crée les lignes manquantes avec `enabled: true`.
 */

import { describe, expect, test } from 'bun:test';
import { resoudreConfigLog, type LigneConfigLog } from '../../events/logEventConfig';

/** Un cache réduit à ce que la résolution utilise, avec compteur de lectures. */
function cacheFeint() {
  const valeurs = new Map<string, unknown>();
  let lectures = 0;
  let ecritures = 0;
  return {
    valeurs,
    get lectures() { return lectures; },
    get ecritures() { return ecritures; },
    async get<T>(cle: string): Promise<T | null> {
      lectures += 1;
      return (valeurs.get(cle) as T) ?? null;
    },
    async set(cle: string, valeur: unknown): Promise<void> {
      ecritures += 1;
      valeurs.set(cle, valeur);
    },
  };
}

/** Rejoue N événements du même type, comme le ferait une rafale réelle. */
async function rafale(nombre: number, ligne: LigneConfigLog | null) {
  const cache = cacheFeint();
  let requetes = 0;
  const resultats: Array<{ journaliser: boolean; channelId: string | null }> = [];

  for (let i = 0; i < nombre; i += 1) {
    resultats.push(await resoudreConfigLog({
      cle: 'guild:g1:log_event_config:member_join',
      lireEnBase: async () => { requetes += 1; return ligne; },
      cacheGet: (cle) => cache.get(cle),
      cacheSet: (cle, valeur) => cache.set(cle, valeur),
    }));
  }

  return { resultats, requetes, journalises: resultats.filter(r => r.journaliser).length };
}

describe('décision de journalisation, chemin froid et chemin chaud', () => {
  test('RAFALE SANS LIGNE EN BASE : les 50 événements sont journalisés, pas seulement le premier', async () => {
    // CASSE SI: le marqueur mémorisé pour « aucune ligne » est relu comme un refus.
    //
    // C'est le scénario 1 du banc de mesure. Avant le correctif : 1 sur 50.
    const { journalises } = await rafale(50, null);

    expect(journalises).toBe(50);
  });

  test('le chemin chaud décide comme le chemin froid', async () => {
    // Les deux passages doivent rendre exactement la même décision : c'est
    // l'invariant que le défaut violait.
    const { resultats } = await rafale(2, null);

    expect(resultats[0]).toEqual(resultats[1]!);
  });

  test('la base n\'est interrogée qu\'une fois pour toute la rafale', async () => {
    // Témoin de performance : le cache doit encore servir à quelque chose.
    // Un correctif qui se contenterait de ne plus rien mémoriser ferait passer
    // le premier test sans rien garder.
    const { requetes } = await rafale(50, null);

    expect(requetes).toBe(1);
  });

  test('une ligne désactivée coupe bien la journalisation, froid comme chaud', async () => {
    // Témoin : la garde doit savoir dire non. Sans lui, un correctif qui
    // journaliserait tout, tout le temps, passerait les tests précédents.
    const { journalises } = await rafale(10, { enabled: false, channelId: null });

    expect(journalises).toBe(0);
  });

  test('une ligne activée journalise et retient son salon dédié', async () => {
    const { resultats, journalises } = await rafale(10, { enabled: true, channelId: '123' });

    expect(journalises).toBe(10);
    expect(resultats.every(r => r.channelId === '123')).toBe(true);
  });

  test('sans ligne, aucun salon dédié n\'est imposé', async () => {
    // L'appelant retombe alors sur le salon de logs par défaut du serveur.
    const { resultats } = await rafale(3, null);

    expect(resultats.every(r => r.channelId === null)).toBe(true);
  });
});
