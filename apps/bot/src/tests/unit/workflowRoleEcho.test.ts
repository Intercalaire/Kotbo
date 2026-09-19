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
 * L'écho est donc redépêché à la profondeur de l'automatisation qui l'a posé,
 * pour que la borne s'arme sans couper les enchaînements légitimes, ou tu
 * quand il vient du balayage des rôles temporaires.
 */

import { describe, expect, test } from 'bun:test';
import {
  expectBotRoleChange,
  roleChangesToDispatch,
  takeBotRoleEcho,
} from '../../services/features/workflow/roleEcho';

describe('anti-écho des rôles posés par le bot', () => {
  test('un rôle ajouté par le bot est reconnu une fois, pas celui posé à la main', () => {
    expectBotRoleChange('g', 'u1', 'r-muet', 'added', 1, 0);

    // Un AUTRE rôle sur le même membre n'est pas un écho.
    expect(takeBotRoleEcho('g', 'u1', 'r-vip', 'added', 10)).toBeUndefined();
    // Le RETRAIT du même rôle n'est pas l'écho d'un ajout.
    expect(takeBotRoleEcho('g', 'u1', 'r-muet', 'removed', 10)).toBeUndefined();
    // L'écho attendu, consommé une seule fois, avec sa profondeur.
    expect(takeBotRoleEcho('g', 'u1', 'r-muet', 'added', 10)).toBe(1);
    expect(takeBotRoleEcho('g', 'u1', 'r-muet', 'added', 20)).toBeUndefined();
  });

  test('un rôle annoncé expire, et s\'oublie après un échec', () => {
    expectBotRoleChange('g', 'u2', 'r-a', 'removed', 1, 0);
    expect(takeBotRoleEcho('g', 'u2', 'r-a', 'removed', 60_000)).toBeUndefined();

    const forget = expectBotRoleChange('g', 'u3', 'r-b', 'added', 1, 0);
    forget();
    expect(takeBotRoleEcho('g', 'u3', 'r-b', 'added', 10)).toBeUndefined();
  });

  test('l\'annonce ne vaut que pour SON serveur et SON membre', () => {
    expectBotRoleChange('g1', 'u1', 'r', 'added', 1, 0);
    expect(takeBotRoleEcho('g2', 'u1', 'r', 'added', 10)).toBeUndefined();
    expect(takeBotRoleEcho('g1', 'u9', 'r', 'added', 10)).toBeUndefined();
    expect(takeBotRoleEcho('g1', 'u1', 'r', 'added', 10)).toBe(1);
  });
});

describe('ce que la mise à jour d\'un membre doit dépêcher', () => {
  test('LE SCÉNARIO DE BOUCLE : le rôle posé par le bot repart à sa profondeur, pas de zéro', () => {
    // CASSE SI: roleChangesToDispatch dépêche l'écho sans sa profondeur.
    expectBotRoleChange('g', 'u1', 'r-muet', 'added', 2, 0);

    const changes = roleChangesToDispatch('g', 'u1', ['r-muet'], [], 10);

    expect(changes).toEqual([{ roleId: 'r-muet', kind: 'added', echoDepth: 2 }]);
  });

  test('un écho annoncé sans profondeur est tu', () => {
    expectBotRoleChange('g', 'u1', 'r-temp', 'removed', null, 0);

    expect(roleChangesToDispatch('g', 'u1', [], ['r-temp'], 10)).toEqual([]);
  });

  test('un rôle posé à la main est dépêché sans profondeur', () => {
    const changes = roleChangesToDispatch('g', 'u1', ['r-vip'], [], 10);

    expect(changes).toEqual([{ roleId: 'r-vip', kind: 'added' }]);
  });

  test('sur une mise à jour mixte, seul l\'écho porte une profondeur', () => {
    // Le bot a retiré « Nouveau » ; dans la même mise à jour, un modérateur a
    // posé « Vétéran » à la main.
    expectBotRoleChange('g', 'u1', 'r-nouveau', 'removed', 1, 0);

    const changes = roleChangesToDispatch('g', 'u1', ['r-veteran'], ['r-nouveau'], 10);

    expect(changes).toEqual([
      { roleId: 'r-veteran', kind: 'added' },
      { roleId: 'r-nouveau', kind: 'removed', echoDepth: 1 },
    ]);
  });

  test('l\'ordre est conservé : les ajouts puis les retraits, comme avant', () => {
    const changes = roleChangesToDispatch('g', 'u1', ['r-a', 'r-b'], ['r-c'], 10);

    expect(changes).toEqual([
      { roleId: 'r-a', kind: 'added' },
      { roleId: 'r-b', kind: 'added' },
      { roleId: 'r-c', kind: 'removed' },
    ]);
  });

  test('une annonce n\'est consommée qu\'une fois : le second changement identique repart de zéro', () => {
    // Un modérateur qui repose le même rôle juste après le bot déclenche comme
    // n'importe quel geste humain : l'anti-écho couvre UNE réponse.
    expectBotRoleChange('g', 'u1', 'r-muet', 'added', 1, 0);

    expect(roleChangesToDispatch('g', 'u1', ['r-muet'], [], 10)).toEqual([
      { roleId: 'r-muet', kind: 'added', echoDepth: 1 },
    ]);
    expect(roleChangesToDispatch('g', 'u1', ['r-muet'], [], 20)).toEqual([
      { roleId: 'r-muet', kind: 'added' },
    ]);
  });
});
