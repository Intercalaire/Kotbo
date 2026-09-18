/**
 * zz-workflowSanctionModuleGate.test.ts
 *
 * Les actions de workflow qui manipulent un module désactivable doivent
 * refuser quand ce module est éteint. `GiveCoins` et `GiveXp` le font déjà
 * (`effects.ts`, module `economy` et `leveling`). Les trois sanctions ne le
 * faisaient pas : un workflow pouvait exclure, expulser ou bannir un membre
 * alors que l'interface affiche « Sanctions : désactivé ».
 *
 * Préfixe `zz-` : ce fichier remplace `services/core/moduleGate` pour tout le
 * process (`mock.module` est global, même avec --isolate). Chargé en dernier,
 * il ne peut plus fausser les suites suivantes — même convention et même raison
 * que `zz-moduleGate.test.ts`, qu'il faisait justement rougir avant ce renommage.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

let moduleActif = true;

mock.module('../../services/core/moduleGate.js', () => ({
  isModuleEnabled: async (_guildId: string, _key: string) => moduleActif,
}));

const { createWorkflowEffects } = await import('../../services/features/workflow/effects');

/**
 * Une guilde réduite à ce que la garde consulte : son identifiant. Tout le
 * reste (résolution du membre, permissions) vient APRÈS, ce dont ces tests
 * tirent justement leur preuve.
 */
function guildeMinimale() {
  return { id: 'guilde-1' } as never;
}

const ACTIONS: Array<{ type: string; action: string }> = [
  { type: 'TimeoutMember', action: 'Exclure temporairement' },
  { type: 'KickMember', action: 'Expulser' },
  { type: 'BanMember', action: 'Bannir' },
];

beforeEach(() => {
  moduleActif = true;
});

describe('les sanctions d\'un workflow respectent le module Sanctions', () => {
  for (const { type, action } of ACTIONS) {
    test(`« ${action} » refuse quand le module Sanctions est désactivé`, async () => {
      // CASSE SI: la garde `isModuleEnabled(guild.id, 'sanctions')` est retirée
      // de ce case dans effects.ts.
      moduleActif = false;
      const effects = createWorkflowEffects(guildeMinimale());

      let jete: unknown;
      try {
        await effects.runAction(type as never, { member: { kind: 'Member', id: 'u1' } } as never, {});
      } catch (error) {
        jete = error;
      }

      expect(jete).toBeDefined();
      expect(String((jete as Error).message)).toContain('Sanctions');
      expect(String((jete as Error).message)).toContain(action);
    });

    test(`« ${action} » va PLUS LOIN quand le module est activé`, async () => {
      // Le témoin qui empêche le test précédent de passer pour une mauvaise
      // raison : sans lui, une action qui échouerait de toute façon sur cette
      // guilde réduite ferait croire que la garde a joué. Module activé, le
      // refus doit être d'une AUTRE nature — la garde n'est plus ce qui arrête.
      moduleActif = true;
      const effects = createWorkflowEffects(guildeMinimale());

      let jete: unknown;
      try {
        await effects.runAction(type as never, { member: { kind: 'Member', id: 'u1' } } as never, {});
      } catch (error) {
        jete = error;
      }

      const message = jete === undefined ? '' : String((jete as Error).message);
      expect(message).not.toContain('module Sanctions est désactivé');
    });
  }
});
