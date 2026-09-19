/**
 * Les actions de workflow rattachées à un module désactivable refusent quand ce
 * module est éteint, comme `GiveCoins` et `GiveXp` le font déjà.
 *
 * Préfixe `zz-` : ce fichier remplace `services/core/moduleGate` pour tout le
 * process (`mock.module` est global). Chargé en dernier, il ne peut plus
 * fausser les suites suivantes.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';
import { completeModuleMock } from '../helpers/moduleMock.js';

let moduleActif = true;

const moduleGatePath = path.resolve(import.meta.dir, '../../services/core/moduleGate.ts');
for (const suffix of ['../../services/core/moduleGate.ts', '../../services/core/moduleGate.js']) {
  mock.module(path.resolve(import.meta.dir, suffix), () => completeModuleMock(moduleGatePath, {
    isModuleEnabled: async () => moduleActif,
  }));
}

const { createWorkflowEffects } = await import('../../services/features/workflow/effects');

// Aucun membre trouvable : une fois la garde franchie, l'action s'arrête
// sur `resolveMember` avec une erreur reconnaissable.
function guildeSansMembre() {
  return {
    id: 'guilde-1',
    members: { cache: new Map(), fetch: async () => { throw new Error('introuvable'); } },
  } as never;
}

const ACTIONS = [
  { type: 'TimeoutMember', action: 'Exclure temporairement', module: 'Sanctions' },
  { type: 'KickMember', action: 'Expulser', module: 'Sanctions' },
  { type: 'BanMember', action: 'Bannir', module: 'Sanctions' },
  { type: 'CreateTicket', action: 'Ouvrir un ticket', module: 'Tickets' },
];

async function lancer(type: string): Promise<string> {
  const effects = createWorkflowEffects(guildeSansMembre());
  try {
    await effects.runAction(type as never, { member: { kind: 'Member', id: 'u1', tag: 'u1#0' } } as never, {});
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`${type} n'a rien levé`);
}

beforeEach(() => {
  moduleActif = true;
});

describe('les actions de workflow respectent l\'activation de leur module', () => {
  for (const { type, action, module } of ACTIONS) {
    test(`« ${action} » refuse quand le module ${module} est désactivé`, async () => {
      moduleActif = false;
      expect(await lancer(type)).toBe(`${action} : le module ${module} est désactivé`);
    });

    test(`« ${action} » passe la garde quand le module ${module} est activé`, async () => {
      expect(await lancer(type)).toBe('Membre : u1#0 est introuvable sur le serveur');
    });
  }
});
