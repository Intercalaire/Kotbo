import { describe, expect, test } from 'bun:test';
import {
  availableConditions,
  compileRecipe,
  contextTokens,
  decompileGraph,
  hasBlockingIssue,
  validateGraph,
  readTriggerChannelFilter,
  type Recipe,
} from '@kotbo/shared';
import { RUN_INFO_KEY, runWorkflow, type WorkflowEffects } from '../../services/features/workflow/engine';
import { matchesTriggerChannelFilter } from '../../services/features/workflow/channelFilter';
import type { MemberValue } from '../../services/features/workflow/values';

function makeEffects() {
  const calls: string[] = [];
  const effects: WorkflowEffects = {
    getRole: async () => null,
    getChannel: async (channelId) => (channelId ? { kind: 'Channel', id: channelId, name: 'salon', categoryName: null } : null),
    getMember: async () => null,
    getGuildInfo: async () => ({ name: 'Serveur test', memberCount: 42 }),
    runAction: async (type) => {
      calls.push(type);
      return {};
    },
  };
  return { effects, calls };
}

const member: MemberValue = {
  kind: 'Member',
  id: 'u1',
  tag: 'Alice#0001',
  displayName: 'Alice',
  isBot: false,
  roleIds: [],
  accountCreatedAt: null,
  joinedAt: null,
};

const limited: Recipe = {
  trigger: { type: 'OnMemberJoin' },
  steps: [{
    id: 'c', kind: 'condition', match: 'all',
    tests: [{ id: 't', condition: 'member.runsToday', operator: 'lte', value: { from: 'number', value: 3 } }],
    then: [{
      id: 'a', kind: 'action', action: 'SendMessage',
      values: {
        text: { from: 'text', template: 'Récompense n°{run.memberToday}' },
        channel: { from: 'channel', channelId: '1' },
      },
    }],
    otherwise: [],
  }],
};

describe('limite de déclenchements par membre', () => {
  test('la condition se compile et se relit à l\'identique', () => {
    const graph = compileRecipe(limited);
    expect(hasBlockingIssue(validateGraph(graph))).toBe(false);

    const read = decompileGraph(graph);
    expect(read?.steps[0]).toMatchObject({
      kind: 'condition',
      tests: [{ condition: 'member.runsToday', operator: 'lte', value: { from: 'number', value: 3 } }],
    });
  });

  test('n\'est proposée qu\'aux déclencheurs qui fournissent un membre', () => {
    expect(availableConditions('OnMemberJoin').map((c) => c.key)).toContain('member.runsToday');
    expect(availableConditions('OnSchedule').map((c) => c.key)).not.toContain('member.runsToday');
    expect(contextTokens('OnSchedule').map((t) => t.path)).not.toContain('run.memberToday');
  });

  test('laisse passer tant que le compteur reste sous la limite', async () => {
    const { effects, calls } = makeEffects();
    const result = await runWorkflow({
      graph: compileRecipe(limited),
      effects,
      triggerOutputs: { member, [RUN_INFO_KEY]: { memberToday: 3, memberThisHour: 1 } },
    });
    expect(result.status).toBe('COMPLETED');
    expect(calls).toEqual(['SendMessage']);
  });

  test('bloque au-delà de la limite', async () => {
    const { effects, calls } = makeEffects();
    const result = await runWorkflow({
      graph: compileRecipe(limited),
      effects,
      triggerOutputs: { member, [RUN_INFO_KEY]: { memberToday: 4, memberThisHour: 1 } },
    });
    expect(result.status).toBe('COMPLETED');
    expect(calls).toEqual([]);
  });

  test('sans compteur transmis, le nœud vaut zéro plutôt que de faire échouer l\'exécution', async () => {
    const { effects, calls } = makeEffects();
    const result = await runWorkflow({ graph: compileRecipe(limited), effects, triggerOutputs: { member } });
    expect(result.status).toBe('COMPLETED');
    expect(calls).toEqual(['SendMessage']);
  });
});

describe('filtre de salons du déclencheur', () => {
  /** Catégorie `cat` > salon `general` > fil `thread` ; `other` hors catégorie. */
  const guild = {
    channels: {
      cache: new Map<string, { parentId: string | null }>([
        ['cat', { parentId: null }],
        ['general', { parentId: 'cat' }],
        ['thread', { parentId: 'general' }],
        ['other', { parentId: null }],
      ]),
    },
  };

  const filtered = (channelIds: unknown, type = 'OnMessageSend') => compileRecipe({
    trigger: { type, config: { channelIds } },
    steps: [],
  });

  test('sans salon choisi, tout passe', () => {
    expect(matchesTriggerChannelFilter(guild, filtered([]), { channelId: 'other' })).toBe(true);
    expect(matchesTriggerChannelFilter(guild, compileRecipe({ trigger: { type: 'OnMessageSend' }, steps: [] }), { channelId: 'other' })).toBe(true);
  });

  test('un salon retenu couvre ses fils, une catégorie ses salons', () => {
    expect(matchesTriggerChannelFilter(guild, filtered(['general']), { channelId: 'general' })).toBe(true);
    expect(matchesTriggerChannelFilter(guild, filtered(['general']), { channelId: 'thread' })).toBe(true);
    expect(matchesTriggerChannelFilter(guild, filtered(['cat']), { channelId: 'thread' })).toBe(true);
    expect(matchesTriggerChannelFilter(guild, filtered(['general']), { channelId: 'other' })).toBe(false);
  });

  test('un événement sans salon ne passe pas un filtre posé', () => {
    expect(matchesTriggerChannelFilter(guild, filtered(['general']), {})).toBe(false);
  });

  test('une valeur restée d\'un autre déclencheur ne filtre rien', () => {
    expect(readTriggerChannelFilter(filtered(['general'], 'OnMemberJoin'))).toEqual([]);
  });

  test('ignore les entrées qui ne sont pas des identifiants', () => {
    expect(readTriggerChannelFilter(filtered(['general', 42, '', null]))).toEqual(['general']);
  });

  test('le filtre survit à l\'enregistrement et à la réouverture', () => {
    const recipe: Recipe = { trigger: { type: 'OnReactionAdd', config: { channelIds: ['general'] } }, steps: [] };
    expect(decompileGraph(compileRecipe(recipe))).toEqual(recipe);
  });
});
