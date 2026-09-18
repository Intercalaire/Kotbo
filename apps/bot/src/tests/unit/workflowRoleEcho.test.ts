/**
 * workflowRoleEcho.test.ts
 *
 * Les rôles posés ou retirés par l'action « Donner un rôle » / « Retirer un
 * rôle » reviennent par la passerelle Discord, donc HORS de la profondeur de
 * cascade (`MAX_CASCADE_DEPTH`, workflowService.ts) : celle-ci ne s'arme que
 * sur les événements republiés depuis l'exécution elle-même.
 *
 * Sans garde, deux automatisations banales bouclent sans fin :
 *   W1 « quand le rôle Muet est AJOUTÉ  → le retirer »
 *   W2 « quand le rôle Muet est RETIRÉ  → l'ajouter »
 * chaque tour repartant de profondeur 0.
 *
 * Le dépôt a déjà résolu exactement ce problème pour les surnoms
 * (`nicknameEcho.ts`, dont l'en-tête nomme la cause : « par la passerelle et
 * donc hors de la profondeur de cascade »). Ces tests étendent le même motif
 * aux rôles.
 */

import { describe, expect, test } from 'bun:test';
import {
  expectBotRoleChange,
  isBotRoleEcho,
  roleChangesToDispatch,
} from '../../services/features/workflow/roleEcho';

describe('anti-écho des rôles posés par le bot', () => {
  test('un rôle ajouté par le bot est ignoré une fois, pas celui posé à la main', () => {
    expectBotRoleChange('g', 'u1', 'r-muet', 'added', 0);

    // Un AUTRE rôle sur le même membre n'est pas un écho.
    expect(isBotRoleEcho('g', 'u1', 'r-vip', 'added', 10)).toBe(false);
    // Le RETRAIT du même rôle n'est pas l'écho d'un ajout.
    expect(isBotRoleEcho('g', 'u1', 'r-muet', 'removed', 10)).toBe(false);
    // L'écho attendu, consommé une seule fois.
    expect(isBotRoleEcho('g', 'u1', 'r-muet', 'added', 10)).toBe(true);
    expect(isBotRoleEcho('g', 'u1', 'r-muet', 'added', 20)).toBe(false);
  });

  test('un rôle annoncé expire, et s\'oublie après un échec', () => {
    expectBotRoleChange('g', 'u2', 'r-a', 'removed', 0);
    expect(isBotRoleEcho('g', 'u2', 'r-a', 'removed', 60_000)).toBe(false);

    const oublier = expectBotRoleChange('g', 'u3', 'r-b', 'added', 0);
    oublier();
    expect(isBotRoleEcho('g', 'u3', 'r-b', 'added', 10)).toBe(false);
  });

  test('l\'annonce ne vaut que pour SON serveur et SON membre', () => {
    expectBotRoleChange('g1', 'u1', 'r', 'added', 0);
    expect(isBotRoleEcho('g2', 'u1', 'r', 'added', 10)).toBe(false);
    expect(isBotRoleEcho('g1', 'u9', 'r', 'added', 10)).toBe(false);
    expect(isBotRoleEcho('g1', 'u1', 'r', 'added', 10)).toBe(true);
  });
});

describe('ce que la mise à jour d\'un membre doit dépêcher', () => {
  test('LE SCÉNARIO DE BOUCLE : le rôle que le bot vient de poser n\'est pas redépêché', () => {
    // CASSE SI: roleChangesToDispatch dépêche sans consulter l'anti-écho.
    expectBotRoleChange('g', 'u1', 'r-muet', 'added', 0);

    const aDepecher = roleChangesToDispatch('g', 'u1', ['r-muet'], [], 10);

    expect(aDepecher).toEqual([]);
  });

  test('un rôle posé à la main est bien dépêché', () => {
    const aDepecher = roleChangesToDispatch('g', 'u1', ['r-vip'], [], 10);

    expect(aDepecher).toEqual([{ roleId: 'r-vip', kind: 'added' }]);
  });

  test('sur une mise à jour mixte, seul l\'écho est retiré', () => {
    // Le bot a retiré « Nouveau » ; dans la même mise à jour, un modérateur a
    // posé « Vétéran » à la main. Un seul des deux est un écho.
    expectBotRoleChange('g', 'u1', 'r-nouveau', 'removed', 0);

    const aDepecher = roleChangesToDispatch('g', 'u1', ['r-veteran'], ['r-nouveau'], 10);

    expect(aDepecher).toEqual([{ roleId: 'r-veteran', kind: 'added' }]);
  });

  test('l\'ordre est conservé : les ajouts puis les retraits, comme avant', () => {
    const aDepecher = roleChangesToDispatch('g', 'u1', ['r-a', 'r-b'], ['r-c'], 10);

    expect(aDepecher).toEqual([
      { roleId: 'r-a', kind: 'added' },
      { roleId: 'r-b', kind: 'added' },
      { roleId: 'r-c', kind: 'removed' },
    ]);
  });

  test('une annonce n\'est consommée qu\'une fois : le second changement identique passe', () => {
    // Un modérateur qui repose le même rôle juste après le bot doit bien
    // déclencher : l'anti-écho couvre UNE réponse, pas une fenêtre de silence.
    expectBotRoleChange('g', 'u1', 'r-muet', 'added', 0);

    expect(roleChangesToDispatch('g', 'u1', ['r-muet'], [], 10)).toEqual([]);
    expect(roleChangesToDispatch('g', 'u1', ['r-muet'], [], 20)).toEqual([
      { roleId: 'r-muet', kind: 'added' },
    ]);
  });
});
