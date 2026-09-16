import { describe, expect, test } from 'bun:test';
import {
  ACTION_LIBRARY,
  availableActions,
  compileRecipe,
  decompileGraph,
  getNodeDef,
  hasBlockingIssue,
  validateGraph,
  type Recipe,
} from '@kotbo/shared';
import {
  MEMBER_NOTE_MAX_LENGTH,
  appendAutomaticNoteLine,
  formatAutomaticNoteLine,
} from '../../services/features/workflow/memberNote.js';

const DAY = new Date('2026-09-17T10:00:00Z');

describe('note automatique du membre', () => {
  test('crée la note quand le membre n\'en a pas', () => {
    const line = formatAutomaticNoteLine('Spam détecté', DAY);
    expect(appendAutomaticNoteLine(null, line)).toBe('[Auto 2026-09-17] Spam détecté');
  });

  test('ajoute en fin de note sans toucher au texte du staff', () => {
    const line = formatAutomaticNoteLine('Spam détecté', DAY);
    expect(appendAutomaticNoteLine('Surveillé depuis mars.', line)).toBe(`Surveillé depuis mars.\n${line}`);
  });

  test('retire les lignes automatiques les plus anciennes pour tenir dans le plafond', () => {
    const staff = 'Note du staff.';
    const old = formatAutomaticNoteLine('a'.repeat(400), new Date('2026-01-01T00:00:00Z'));
    const recent = formatAutomaticNoteLine('b'.repeat(400), new Date('2026-02-01T00:00:00Z'));
    const added = formatAutomaticNoteLine('c'.repeat(300), DAY);

    const note = appendAutomaticNoteLine([staff, old, recent].join('\n'), added);
    expect(note).toBe([staff, recent, added].join('\n'));
    expect(note!.length).toBeLessThanOrEqual(MEMBER_NOTE_MAX_LENGTH);
  });

  test('refuse plutôt que d\'effacer une note écrite par le staff', () => {
    const staff = 'x'.repeat(900);
    const added = formatAutomaticNoteLine('y'.repeat(200), DAY);
    expect(appendAutomaticNoteLine(staff, added)).toBeNull();
  });

  test('une ligne qui imite la marque sans la date n\'est pas prise pour automatique', () => {
    const fake = `[Auto] ${'z'.repeat(900)}`;
    const added = formatAutomaticNoteLine('y'.repeat(200), DAY);
    expect(appendAutomaticNoteLine(fake, added)).toBeNull();
  });
});

describe('actions de la bibliothèque', () => {
  /**
   * L'éditeur simple compile chaque champ vers le port du même nom : un champ
   * sans port correspondant serait perdu en silence à l'enregistrement.
   */
  test('chaque champ correspond à un port du nœud moteur', () => {
    for (const action of ACTION_LIBRARY) {
      const def = getNodeDef(action.type);
      expect(def?.category).toBe('action');

      const ports = new Set(def!.inputs.map((port) => port.id));
      const config = new Set((def!.config ?? []).map((field) => field.key));
      for (const field of action.fields) {
        expect(field.option ? config.has(field.key) : ports.has(field.key)).toBe(true);
      }
    }
  });

  test('les actions sur un membre ne sont proposées qu\'avec un membre', () => {
    const onSchedule = availableActions('OnSchedule').map((action) => action.type);
    expect(onSchedule).toContain('SendLogMessage');
    expect(onSchedule).not.toContain('GiveCoins');
    expect(onSchedule).not.toContain('AddTemporaryRole');
    expect(onSchedule).not.toContain('AddMemberNote');

    const onJoin = availableActions('OnMemberJoin').map((action) => action.type);
    expect(onJoin).toEqual(expect.arrayContaining(['GiveCoins', 'RemoveCoins', 'GiveXp', 'AddTemporaryRole', 'AddMemberNote']));
  });

  test('répondre à un message n\'est proposé qu\'avec un message', () => {
    expect(availableActions('OnMemberJoin').map((action) => action.type)).not.toContain('ReplyToMessage');
    expect(availableActions('OnMessageSend').map((action) => action.type)).toContain('ReplyToMessage');
  });

  test('une recette utilisant toutes les nouvelles actions se compile et se relit', () => {
    const recipe: Recipe = {
      trigger: { type: 'OnMessageSend' },
      steps: [
        {
          id: 'reply', kind: 'action', action: 'ReplyToMessage',
          values: {
            text: { from: 'text', template: 'Merci {member.displayName} !' },
            message: { from: 'context', path: 'message' },
          },
        },
        {
          id: 'temp', kind: 'action', action: 'AddTemporaryRole',
          values: {
            role: { from: 'role', roleId: '42' },
            member: { from: 'context', path: 'member' },
            minutes: { from: 'number', value: 90 },
          },
        },
        {
          id: 'coins', kind: 'action', action: 'GiveCoins',
          values: { amount: { from: 'number', value: 25 }, member: { from: 'context', path: 'member' } },
        },
        {
          id: 'debit', kind: 'action', action: 'RemoveCoins',
          values: { amount: { from: 'number', value: 5 }, member: { from: 'context', path: 'member' } },
        },
        {
          id: 'xp', kind: 'action', action: 'GiveXp',
          values: { amount: { from: 'number', value: 100 }, member: { from: 'context', path: 'member' } },
        },
        {
          id: 'note', kind: 'action', action: 'AddMemberNote',
          values: { text: { from: 'text', template: 'A écrit dans {channel.name}' }, member: { from: 'context', path: 'member' } },
        },
        {
          id: 'log', kind: 'action', action: 'SendLogMessage',
          values: { text: { from: 'text', template: '{member.tag} a été récompensé' } },
        },
      ],
    };

    const graph = compileRecipe(recipe);
    expect(hasBlockingIssue(validateGraph(graph))).toBe(false);
    expect(decompileGraph(graph)).toEqual(recipe);
  });
});
