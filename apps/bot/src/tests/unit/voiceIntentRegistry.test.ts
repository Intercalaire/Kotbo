/**
 * Le log d'un départ ou d'un déplacement vocal annonçait « Action réalisée
 * par » **la personne qui venait de subir l'action**. `advancedLogs.ts` passait
 * `safeTag(member, userId)` comme auteur, c'est-à-dire le membre dont l'état
 * vocal avait changé — jamais qui l'avait changé.
 *
 * Le journal d'audit de Discord ne peut pas réparer ça : `MemberMove` et
 * `MemberDisconnect` n'ont aucun `target_id`. Pour tout ce que Kotbo provoque
 * lui-même, en revanche, le code sait déjà qui a demandé l'action — ce registre
 * le lui fait dire.
 *
 * Module pur, aucun `mock.module`, aucune base : le temps est injecté, jamais
 * lu. Donc pas de préfixe `zz-`.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  annoncerIntentionVocale,
  prendreIntentionVocale,
  reinitialiserIntentionsVocales,
} from '../../services/moderation/voiceIntentRegistry.js';

const GUILDE = 'guilde-1';
const MEMBRE = 'membre-1';

beforeEach(() => reinitialiserIntentionsVocales());

describe("registre d'intention vocale", () => {
  test("une annonce n'est rendue qu'au bon serveur, au bon membre et au bon genre", () => {
    annoncerIntentionVocale(GUILDE, MEMBRE, 'move', { libelle: 'Kotbo (salon vocal temporaire)' }, 0);

    // Une déconnexion n'est pas un déplacement : confondre les deux
    // attribuerait à un départ l'auteur d'un déplacement sans rapport.
    expect(prendreIntentionVocale(GUILDE, MEMBRE, 'disconnect', 10)).toBeUndefined();
    expect(prendreIntentionVocale('guilde-2', MEMBRE, 'move', 10)).toBeUndefined();
    expect(prendreIntentionVocale(GUILDE, 'membre-2', 'move', 10)).toBeUndefined();

    expect(prendreIntentionVocale(GUILDE, MEMBRE, 'move', 10)).toEqual({ libelle: 'Kotbo (salon vocal temporaire)' });
    // Consommée : un second événement vocal ne doit pas hériter du même auteur.
    expect(prendreIntentionVocale(GUILDE, MEMBRE, 'move', 20)).toBeUndefined();
  });

  test('deux déplacements rapprochés du même membre sont appariés dans leur ordre', () => {
    // Le point dur. Un emplacement unique — le modèle de `roleEcho` — écraserait
    // la première annonce, et le log du premier déplacement porterait le nom de
    // l'auteur du second.
    annoncerIntentionVocale(GUILDE, MEMBRE, 'move', { libelle: 'Kotbo (salon vocal temporaire)' }, 0);
    annoncerIntentionVocale(GUILDE, MEMBRE, 'move', { libelle: 'Alice#0001 (panneau)' }, 1_000);

    expect(prendreIntentionVocale(GUILDE, MEMBRE, 'move', 1_500)).toEqual({ libelle: 'Kotbo (salon vocal temporaire)' });
    expect(prendreIntentionVocale(GUILDE, MEMBRE, 'move', 1_600)).toEqual({ libelle: 'Alice#0001 (panneau)' });
  });

  test('une annonce périmée est ignorée, y compris en tête de file', () => {
    // À 11 s, la première a dépassé les dix secondes de durée de vie. Sans le
    // saut, elle serait rendue pour un événement auquel elle n'appartient pas.
    annoncerIntentionVocale(GUILDE, MEMBRE, 'disconnect', { libelle: 'Kotbo (captcha vocal)' }, 0);
    annoncerIntentionVocale(GUILDE, MEMBRE, 'disconnect', { libelle: 'Bob#0002 (panneau)' }, 5_000);

    expect(prendreIntentionVocale(GUILDE, MEMBRE, 'disconnect', 11_000)).toEqual({ libelle: 'Bob#0002 (panneau)' });
  });

  test('un appel Discord qui échoue oublie précisément son annonce', () => {
    // L'appel qui échoue ne produit aucun changement d'état vocal. Laisser son
    // annonce traîner la ferait attribuer au premier déplacement sans rapport
    // survenu dans les dix secondes.
    annoncerIntentionVocale(GUILDE, MEMBRE, 'move', { libelle: 'première, réussie' }, 0);
    const oublierSeconde = annoncerIntentionVocale(GUILDE, MEMBRE, 'move', { libelle: 'seconde, échouée' }, 0);

    oublierSeconde();

    expect(prendreIntentionVocale(GUILDE, MEMBRE, 'move', 10)).toEqual({ libelle: 'première, réussie' });
    expect(prendreIntentionVocale(GUILDE, MEMBRE, 'move', 10)).toBeUndefined();
  });

  test("rien d'annoncé : aucun auteur, jamais le membre lui-même", () => {
    // Le cas d'un modérateur qui déplace à la main depuis Discord. On ne sait
    // pas, et `undefined` doit rester `undefined` : c'est ce qui fait que
    // l'appelant n'affiche aucun pied de page plutôt qu'un faux.
    expect(prendreIntentionVocale(GUILDE, MEMBRE, 'move', 0)).toBeUndefined();
    expect(prendreIntentionVocale(GUILDE, MEMBRE, 'disconnect', 0)).toBeUndefined();
  });
});
