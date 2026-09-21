/**
 * Les règles de regroupement des logs.
 *
 * Ce qui est gardé ici, cas par cas : deux salons vocaux ne se mélangent pas
 * quand on sépare par objet ; ils tiennent dans une seule carte **mais restent
 * triés dedans** quand on préfère ce mode ; une rafale dépasse le plafond en
 * créant une carte suivante, jamais en tronquant ; et l'ordre suit toujours la
 * première apparition, pas l'ordre des identifiants.
 *
 * Module pur : ni Discord, ni base, ni horloge — le temps est porté par les
 * événements. Pas de `mock.module`, donc pas de préfixe `zz-`.
 */
import { describe, expect, test } from 'bun:test';
import {
  BUDGET_CARACTERES,
  grouperLogs,
  MAX_LIGNES_ABSOLU,
  type EvenementAGrouper,
  type ReglesDeRegroupement,
} from '../../utils/logGrouping.js';

function evenement(surcharges: Partial<EvenementAGrouper> & { survenuA: number }): EvenementAGrouper {
  return {
    type: 'voice_join',
    objetId: 'salon-A',
    acteurId: 'membre-1',
    ligne: 'une ligne',
    ...surcharges,
  };
}

const PAR_SALON: ReglesDeRegroupement = { separerPar: ['objet'], sectionnerPar: [], maxParCarte: 10 };
const TOUT_ENSEMBLE_MAIS_TRIE: ReglesDeRegroupement = { separerPar: [], sectionnerPar: ['objet'], maxParCarte: 10 };

/** Raccourci de lecture : la forme d'une carte, sans le détail des lignes. */
function apercu(cartes: ReturnType<typeof grouperLogs>) {
  return cartes.map((carte) => ({
    suite: carte.suite,
    total: carte.total,
    sections: carte.sections.map((section) => ({ valeur: section.valeur, lignes: section.lignes.length })),
  }));
}

describe('séparer les cartes', () => {
  test('deux salons vocaux donnent deux cartes', () => {
    const cartes = grouperLogs([
      evenement({ survenuA: 100, objetId: 'salon-A' }),
      evenement({ survenuA: 200, objetId: 'salon-B' }),
      evenement({ survenuA: 300, objetId: 'salon-A' }),
    ], PAR_SALON);

    expect(cartes).toHaveLength(2);
    expect(cartes[0].total).toBe(2);
    expect(cartes[1].total).toBe(1);
  });

  test("l'ordre des cartes suit la première apparition, pas l'identifiant", () => {
    // `salon-Z` bouge en premier : il passe devant `salon-A`. Un tri par
    // identifiant inverserait les deux et ferait mentir la lecture.
    const cartes = grouperLogs([
      evenement({ survenuA: 100, objetId: 'salon-Z', ligne: 'Z en premier' }),
      evenement({ survenuA: 200, objetId: 'salon-A', ligne: 'A ensuite' }),
    ], PAR_SALON);

    expect(cartes[0].sections[0].lignes[0].ligne).toBe('Z en premier');
    expect(cartes[1].sections[0].lignes[0].ligne).toBe('A ensuite');
  });

  test('un salon dont l’identifiant vaut « null » ne rejoint pas les événements sans salon', () => {
    const cartes = grouperLogs([
      evenement({ survenuA: 100, objetId: null }),
      evenement({ survenuA: 200, objetId: 'null' }),
    ], PAR_SALON);

    expect(cartes).toHaveLength(2);
  });

  test('sans axe de séparation, tout tient dans une carte', () => {
    const cartes = grouperLogs([
      evenement({ survenuA: 100, objetId: 'salon-A' }),
      evenement({ survenuA: 200, objetId: 'salon-B' }),
    ], { separerPar: [], sectionnerPar: [], maxParCarte: 10 });

    expect(cartes).toHaveLength(1);
    expect(cartes[0].total).toBe(2);
  });
});

describe('trier à l’intérieur d’une carte', () => {
  test('une seule carte pour les deux salons, mais séparés dedans, premier arrivé en haut', () => {
    // Le mode demandé : peu importe le salon vocal, une seule carte — et
    // pourtant une séparation visible entre le haut et le bas, le salon qui a
    // eu les premières interactions au-dessus.
    const cartes = grouperLogs([
      evenement({ survenuA: 100, objetId: 'salon-A', ligne: 'A1' }),
      evenement({ survenuA: 150, objetId: 'salon-B', ligne: 'B1' }),
      evenement({ survenuA: 200, objetId: 'salon-A', ligne: 'A2' }),
      evenement({ survenuA: 250, objetId: 'salon-B', ligne: 'B2' }),
    ], TOUT_ENSEMBLE_MAIS_TRIE);

    expect(apercu(cartes)).toEqual([{
      suite: 1,
      total: 4,
      sections: [{ valeur: 'salon-A', lignes: 2 }, { valeur: 'salon-B', lignes: 2 }],
    }]);
    expect(cartes[0].sections[0].lignes.map((l) => l.ligne)).toEqual(['A1', 'A2']);
  });

  test('sectionner par un axe qui a déjà séparé ne produit pas de section vide', () => {
    // Sans ce garde-fou, chaque carte porterait un en-tête de section unique et
    // redondant, qui répète ce que la carte dit déjà.
    const cartes = grouperLogs([
      evenement({ survenuA: 100, objetId: 'salon-A' }),
      evenement({ survenuA: 200, objetId: 'salon-B' }),
    ], { separerPar: ['objet'], sectionnerPar: ['objet'], maxParCarte: 10 });

    expect(cartes).toHaveLength(2);
    for (const carte of cartes) {
      expect(carte.sections).toHaveLength(1);
      // `axe: null` dit « pas de découpage », là où `axe: 'objet', valeur: null`
      // dirait « la section des événements sans salon ».
      expect(carte.sections[0].axe).toBeNull();
      expect(carte.sections[0].valeur).toBeNull();
    }
  });
});

describe('les plafonds', () => {
  test('au-delà du maximum, une carte suivante — jamais une troncature', () => {
    const cartes = grouperLogs(
      Array.from({ length: 7 }, (_, i) => evenement({ survenuA: 100 + i, ligne: `ligne ${i}` })),
      { separerPar: [], sectionnerPar: [], maxParCarte: 3 },
    );

    expect(cartes.map((c) => ({ suite: c.suite, total: c.total })))
      .toEqual([{ suite: 1, total: 3 }, { suite: 2, total: 3 }, { suite: 3, total: 1 }]);
    // Rien n'a disparu : les sept lignes sont là, dans l'ordre.
    expect(cartes.flatMap((c) => c.sections.flatMap((s) => s.lignes.map((l) => l.ligne))))
      .toEqual(['ligne 0', 'ligne 1', 'ligne 2', 'ligne 3', 'ligne 4', 'ligne 5', 'ligne 6']);
  });

  test('un réglage plus haut que ce que Discord accepte est ramené à la limite', () => {
    const cartes = grouperLogs(
      Array.from({ length: MAX_LIGNES_ABSOLU + 5 }, (_, i) => evenement({ survenuA: 100 + i })),
      { separerPar: [], sectionnerPar: [], maxParCarte: 999 },
    );

    expect(cartes[0].total).toBe(MAX_LIGNES_ABSOLU);
    expect(cartes[1].total).toBe(5);
  });

  test('le débordement se compte par groupe, pas globalement', () => {
    // Deux salons, trois événements chacun, plafond à 2 : chaque salon déborde
    // pour son propre compte. Un compteur global mélangerait les deux.
    const cartes = grouperLogs([
      evenement({ survenuA: 100, objetId: 'salon-A' }),
      evenement({ survenuA: 110, objetId: 'salon-B' }),
      evenement({ survenuA: 120, objetId: 'salon-A' }),
      evenement({ survenuA: 130, objetId: 'salon-B' }),
      evenement({ survenuA: 140, objetId: 'salon-A' }),
      evenement({ survenuA: 150, objetId: 'salon-B' }),
    ], { separerPar: ['objet'], sectionnerPar: [], maxParCarte: 2 });

    expect(cartes.map((c) => ({ cle: c.cle, suite: c.suite, total: c.total }))).toEqual([
      { cle: 'objet=v:salon-A', suite: 1, total: 2 },
      { cle: 'objet=v:salon-A', suite: 2, total: 1 },
      { cle: 'objet=v:salon-B', suite: 1, total: 2 },
      { cle: 'objet=v:salon-B', suite: 2, total: 1 },
    ]);
  });

  test('le budget de caractères déborde aussi, même sous le plafond de lignes', () => {
    const longue = 'x'.repeat(BUDGET_CARACTERES / 2);
    const cartes = grouperLogs([
      evenement({ survenuA: 100, ligne: longue }),
      evenement({ survenuA: 200, ligne: longue }),
      evenement({ survenuA: 300, ligne: longue }),
    ], { separerPar: [], sectionnerPar: [], maxParCarte: 10 });

    expect(cartes).toHaveLength(2);
    expect(cartes[0].total).toBe(2);
  });

  test('une ligne à elle seule plus longue que le budget est tout de même publiée', () => {
    // Sinon elle ne le serait jamais : la carte resterait vide, la boucle
    // avancerait, et le log disparaîtrait en silence.
    const cartes = grouperLogs(
      [evenement({ survenuA: 100, ligne: 'y'.repeat(BUDGET_CARACTERES * 2) })],
      { separerPar: [], sectionnerPar: [], maxParCarte: 10 },
    );

    expect(cartes).toHaveLength(1);
    expect(cartes[0].total).toBe(1);
  });

  test('une fenêtre glissante close la carte, sans couper deux événements voisins', () => {
    // Des tranches fixes (`survenuA / fenetreMs`) sépareraient 999 et 1001 alors
    // que deux millisecondes les séparent. La fenêtre part du premier événement
    // de la carte.
    const cartes = grouperLogs([
      evenement({ survenuA: 999, ligne: 'juste avant la frontière' }),
      evenement({ survenuA: 1001, ligne: 'juste après' }),
      evenement({ survenuA: 3000, ligne: 'bien plus tard' }),
    ], { separerPar: [], sectionnerPar: [], maxParCarte: 10, fenetreMs: 1000 });

    expect(cartes).toHaveLength(2);
    expect(cartes[0].total).toBe(2);
    expect(cartes[1].sections[0].lignes[0].ligne).toBe('bien plus tard');
  });
});

describe('compatibilité', () => {
  test('maxParCarte à 1 reproduit exactement le comportement d’avant : une carte par événement', () => {
    const cartes = grouperLogs([
      evenement({ survenuA: 100 }),
      evenement({ survenuA: 200 }),
      evenement({ survenuA: 300 }),
    ], { separerPar: [], sectionnerPar: [], maxParCarte: 1 });

    expect(cartes).toHaveLength(3);
    expect(cartes.every((c) => c.total === 1)).toBeTrue();
  });

  test('une rafale vide ne produit aucune carte', () => {
    expect(grouperLogs([], PAR_SALON)).toEqual([]);
  });
});
