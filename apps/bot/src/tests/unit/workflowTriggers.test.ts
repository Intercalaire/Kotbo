import { describe, expect, test } from 'bun:test';
import {
  availableConditions,
  compileRecipe,
  contextTokens,
  decompileGraph,
  hasBlockingIssue,
  validateGraph,
  getNodeDef,
  NODE_CATALOG,
  readTriggerChannelFilter,
  TRIGGER_GROUP_LABELS,
  TRIGGER_LIBRARY,
  type Recipe,
} from '@kotbo/shared';
import { RUN_INFO_KEY, runWorkflow, type WorkflowEffects } from '../../services/features/workflow/engine';
import { matchesTriggerChannelFilter } from '../../services/features/workflow/channelFilter';
import { matchesTriggerRoleFilter } from '../../services/features/workflow/roleFilter';
import { isMessageEdit } from '../../services/features/workflow/messageEdit';
import { expectBotNickname, isBotNicknameEcho } from '../../services/features/workflow/nicknameEcho';
import type { MemberValue } from '../../services/features/workflow/values';
import { ticketGuildChannelId } from '../../services/features/ticketGuildChannel';

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

describe('filtre de rôles du déclencheur', () => {
  const filtered = (roleIds: unknown, type = 'OnRoleAdded') => compileRecipe({
    trigger: { type, config: { roleIds } },
    steps: [],
  });

  test('sans rôle retenu, tous les rôles passent', () => {
    expect(matchesTriggerRoleFilter(filtered([]), { roleId: 'vip' })).toBe(true);
    expect(matchesTriggerRoleFilter(compileRecipe({ trigger: { type: 'OnRoleAdded' }, steps: [] }), { roleId: 'vip' })).toBe(true);
  });

  test('seuls les rôles retenus passent', () => {
    expect(matchesTriggerRoleFilter(filtered(['vip']), { roleId: 'vip' })).toBe(true);
    expect(matchesTriggerRoleFilter(filtered(['vip']), { roleId: 'membre' })).toBe(false);
    expect(matchesTriggerRoleFilter(filtered(['vip'], 'OnRoleRemoved'), { roleId: 'membre' })).toBe(false);
  });

  test('un événement sans rôle ne passe pas un filtre posé', () => {
    expect(matchesTriggerRoleFilter(filtered(['vip']), {})).toBe(false);
  });

  test('une valeur restée d\'un autre déclencheur ne filtre rien', () => {
    expect(matchesTriggerRoleFilter(filtered(['vip'], 'OnMemberJoin'), {})).toBe(true);
  });

  test('le filtre survit à l\'enregistrement et à la réouverture', () => {
    const recipe: Recipe = { trigger: { type: 'OnRoleAdded', config: { roleIds: ['vip'] } }, steps: [] };
    expect(decompileGraph(compileRecipe(recipe))).toEqual(recipe);
  });
});

describe('nouveaux déclencheurs', () => {
  test('chaque déclencheur de l\'éditeur simple existe dans le catalogue, avec un groupe nommé', () => {
    for (const trigger of TRIGGER_LIBRARY) {
      expect(getNodeDef(trigger.type)?.category).toBe('trigger');
      expect(TRIGGER_GROUP_LABELS[trigger.group]).toBeTruthy();
    }
  });

  test('chaque déclencheur du catalogue est proposé dans l\'éditeur simple', () => {
    const listed = new Set(TRIGGER_LIBRARY.map((trigger) => trigger.type));
    const missing = NODE_CATALOG.filter((node) => node.category === 'trigger' && !listed.has(node.type));
    expect(missing.map((node) => node.type)).toEqual([]);
  });

  test('les déclencheurs liés à un salon proposent le filtre, pas ceux de structure', () => {
    const filterable = (type: string) => getNodeDef(type)?.config?.some((field) => field.key === 'channelIds') ?? false;
    expect(filterable('OnMessageDelete')).toBe(true);
    expect(filterable('OnAutoModTriggered')).toBe(true);
    expect(filterable('OnChannelCreated')).toBe(false);
    expect(filterable('OnSanctionRevoked')).toBe(false);
    expect(filterable('OnMessageEdit')).toBe(true);
    expect(filterable('OnVoiceMove')).toBe(true);
    expect(filterable('OnThreadCreated')).toBe(true);
    expect(filterable('OnMemberInvited')).toBe(false);
    expect(filterable('OnNicknameChanged')).toBe(false);
    expect(filterable('OnMemberBoost')).toBe(false);
  });

  test('un salon supprimé garde son nom utilisable dans un texte', async () => {
    const calls: { type: string; inputs: Record<string, unknown> }[] = [];
    const effects: WorkflowEffects = {
      ...makeEffects().effects,
      runAction: async (type, inputs) => {
        calls.push({ type, inputs });
        return {};
      },
    };

    const recipe: Recipe = {
      trigger: { type: 'OnChannelDeleted' },
      steps: [{
        id: 'log', kind: 'action', action: 'SendLogMessage',
        values: { text: { from: 'text', template: 'Salon supprimé : {channel.name}' } },
      }],
    };

    const graph = compileRecipe(recipe);
    expect(hasBlockingIssue(validateGraph(graph))).toBe(false);
    expect(decompileGraph(graph)).toEqual(recipe);

    const result = await runWorkflow({
      graph,
      effects,
      triggerOutputs: { channel: { kind: 'Channel', id: 'c1', name: 'annonces', categoryName: null } },
    });
    expect(result.status).toBe('COMPLETED');
    expect(calls[0]?.inputs.text).toBe('Salon supprimé : annonces');
  });
});

describe('déclencheurs d\'invitation, d\'édition, de vocal, de fil, de surnom et de boost', () => {
  const edit = (overrides: Partial<Parameters<typeof isMessageEdit>[0]>) => isMessageEdit({
    guildId: 'g',
    channelId: 'c',
    authorId: 'u',
    messageId: 'm',
    oldContent: 'avant',
    newContent: 'après',
    editedTimestamp: 1_000_000,
    timestamp: 1_000_500,
    ...overrides,
  });

  test('une modification récente du texte est une édition', () => {
    expect(edit({})).toBe(true);
    expect(edit({ oldContent: null })).toBe(true);
  });

  test('un aperçu de lien ou un épinglage n\'est pas une édition', () => {
    expect(edit({ oldContent: 'même', newContent: 'même' })).toBe(false);
    expect(edit({ editedTimestamp: null })).toBe(false);
    expect(edit({ editedTimestamp: undefined })).toBe(false);
    expect(edit({ oldContent: null, editedTimestamp: 1_000_500 - 3_600_000 })).toBe(false);
  });

  test('une mise à jour sans auteur ou sans texte est ignorée', () => {
    expect(edit({ authorId: null })).toBe(false);
    expect(edit({ newContent: null })).toBe(false);
  });

  test('un surnom posé par le bot est ignoré une fois, pas celui du membre', () => {
    expectBotNickname('g', 'u1', 'Alice [VIP]', 0);
    expect(isBotNicknameEcho('g', 'u1', 'Autre', 10)).toBe(false);
    expect(isBotNicknameEcho('g', 'u1', 'Alice [VIP]', 10)).toBe(true);
    expect(isBotNicknameEcho('g', 'u1', 'Alice [VIP]', 20)).toBe(false);
  });

  test('un surnom annoncé expire ou s\'oublie après un échec', () => {
    expectBotNickname('g', 'u2', null, 0);
    expect(isBotNicknameEcho('g', 'u2', '', 60_000)).toBe(false);

    const forget = expectBotNickname('g', 'u3', 'Bob', 0);
    forget();
    expect(isBotNicknameEcho('g', 'u3', 'Bob', 10)).toBe(false);
  });

  test('chaque déclencheur expose ses valeurs dans les textes', () => {
    const paths = (type: string) => contextTokens(type).map((token) => token.path);
    expect(paths('OnMemberInvited')).toEqual(expect.arrayContaining(['inviter.displayName', 'inviteCode', 'run.memberToday']));
    expect(paths('OnMessageEdit')).toEqual(expect.arrayContaining(['message.content', 'oldContent', 'channel.name']));
    expect(paths('OnVoiceMove')).toEqual(expect.arrayContaining(['channel.name', 'fromChannel.name', 'minutes']));
    expect(paths('OnThreadCreated')).toEqual(expect.arrayContaining(['thread.name', 'member.displayName', 'channel.name']));
    expect(paths('OnNicknameChanged')).toEqual(expect.arrayContaining(['oldNickname', 'newNickname']));
    expect(paths('OnMemberBoost')).toEqual(expect.arrayContaining(['member.displayName', 'boostCount']));
  });

  test('le code d\'invitation n\'est proposé qu\'au déclencheur qui le fournit', () => {
    expect(availableConditions('OnMemberInvited').map((condition) => condition.key)).toContain('invite.code');
    expect(availableConditions('OnMemberJoin').map((condition) => condition.key)).not.toContain('invite.code');
  });

  const invited: Recipe = {
    trigger: { type: 'OnMemberInvited' },
    steps: [{
      id: 'c', kind: 'condition', match: 'all',
      tests: [{ id: 't', condition: 'invite.code', value: { from: 'text', template: 'partenaire' } }],
      then: [{
        id: 'log', kind: 'action', action: 'SendLogMessage',
        values: { text: { from: 'text', template: '{member.displayName} invité par [{inviter.displayName}]' } },
      }],
      otherwise: [],
    }],
  };

  test('une condition sur le code d\'invitation survit à la réouverture', () => {
    const graph = compileRecipe(invited);
    expect(hasBlockingIssue(validateGraph(graph))).toBe(false);
    const withoutTestId = (recipe: Recipe | null) => JSON.parse(JSON.stringify(recipe), (_key, value) => (
      value && typeof value === 'object' && 'condition' in value ? { ...value, id: 'ID' } : value
    ));
    expect(withoutTestId(decompileGraph(graph))).toEqual(withoutTestId(invited));
  });

  test('un auteur d\'invitation parti laisse un texte vide sans faire échouer', async () => {
    const calls: { type: string; inputs: Record<string, unknown> }[] = [];
    const effects: WorkflowEffects = {
      ...makeEffects().effects,
      runAction: async (type, inputs) => {
        calls.push({ type, inputs });
        return {};
      },
    };
    const member: MemberValue = {
      kind: 'Member', id: 'u1', tag: 'alice', displayName: 'Alice', isBot: false,
      roleIds: [], accountCreatedAt: null, joinedAt: null,
    };

    const run = (inviteCode: string) => runWorkflow({
      graph: compileRecipe(invited),
      effects,
      triggerOutputs: { member, inviter: null, inviteCode },
    });

    expect((await run('autre')).status).toBe('COMPLETED');
    expect(calls).toEqual([]);

    expect((await run('partenaire')).status).toBe('COMPLETED');
    expect(calls[0]?.inputs.text).toBe('Alice invité par []');
  });
});

describe('déclencheurs de ticket', () => {
  test('chaque déclencheur expose ses valeurs et propose le filtre de salons', () => {
    const paths = (type: string) => contextTokens(type).map((token) => token.path);
    expect(paths('OnTicketClosed')).toEqual(expect.arrayContaining([
      'member.displayName', 'closedBy.displayName', 'staff.displayName', 'channel.name', 'subject', 'ticketType', 'minutes',
    ]));
    expect(paths('OnTicketRated')).toEqual(expect.arrayContaining(['member.displayName', 'staff.displayName', 'rating', 'ticketType']));

    const filterable = (type: string) => getNodeDef(type)?.config?.some((field) => field.key === 'channelIds') ?? false;
    expect(filterable('OnTicketClosed')).toBe(true);
    expect(filterable('OnTicketRated')).toBe(true);
    expect(filterable('OnTicketCreated')).toBe(true);
    expect(paths('OnTicketCreated')).toContain('ticketType');
  });

  test('la note n\'est proposée qu\'à l\'avis, le type de ticket aux trois', () => {
    const keys = (type: string) => availableConditions(type).map((condition) => condition.key);
    expect(keys('OnTicketRated')).toEqual(expect.arrayContaining(['ticket.rating', 'ticket.type']));
    expect(keys('OnTicketClosed')).toContain('ticket.type');
    expect(keys('OnTicketClosed')).not.toContain('ticket.rating');
    expect(keys('OnTicketCreated')).toContain('ticket.type');
    expect(keys('OnTicketCreated')).not.toContain('ticket.rating');
  });

  const badReview: Recipe = {
    trigger: { type: 'OnTicketRated' },
    steps: [{
      id: 'c', kind: 'condition', match: 'all',
      tests: [{ id: 't', condition: 'ticket.rating', operator: 'lte', value: { from: 'number', value: 2 } }],
      then: [{
        id: 'log', kind: 'action', action: 'SendLogMessage',
        values: { text: { from: 'text', template: '{rating}/5 pour [{staff.displayName}] sur {subject}' } },
      }],
      otherwise: [],
    }],
  };

  test('une condition sur la note survit à la réouverture et filtre à l\'exécution', async () => {
    const graph = compileRecipe(badReview);
    expect(hasBlockingIssue(validateGraph(graph))).toBe(false);
    const withoutTestId = (recipe: Recipe | null) => JSON.parse(JSON.stringify(recipe), (_key, value) => (
      value && typeof value === 'object' && 'condition' in value ? { ...value, id: 'ID' } : value
    ));
    expect(withoutTestId(decompileGraph(graph))).toEqual(withoutTestId(badReview));

    const calls: { type: string; inputs: Record<string, unknown> }[] = [];
    const effects: WorkflowEffects = {
      ...makeEffects().effects,
      runAction: async (type, inputs) => {
        calls.push({ type, inputs });
        return {};
      },
    };
    const run = (rating: number) => runWorkflow({
      graph,
      effects,
      triggerOutputs: { member, staff: null, channel: null, rating, subject: 'Remboursement', ticketType: 'Support' },
    });

    expect((await run(4)).status).toBe('COMPLETED');
    expect(calls).toEqual([]);

    expect((await run(1)).status).toBe('COMPLETED');
    expect(calls[0]?.inputs.text).toBe('1/5 pour [] sur Remboursement');
  });

  test('le salon annoncé est celui du serveur du ticket', () => {
    const base = { mode: 'CHANNEL', staffServerGuildId: null, channelId: 'c1', threadId: null };
    expect(ticketGuildChannelId(base)).toBe('c1');
    expect(ticketGuildChannelId({ ...base, mode: 'THREAD', channelId: null, threadId: 't1' })).toBe('t1');
    expect(ticketGuildChannelId({ ...base, mode: 'DM', channelId: null, threadId: 't1' })).toBeNull();
    expect(ticketGuildChannelId({ ...base, staffServerGuildId: 'staff' })).toBeNull();
  });
});

describe('déclencheurs de sanction', () => {
  const withoutTestId = (recipe: Recipe | null) => JSON.parse(JSON.stringify(recipe), (_key, value) => (
    value && typeof value === 'object' && 'condition' in value ? { ...value, id: 'ID' } : value
  ));

  test('la sanction expose le modérateur, la durée et le type traduit', () => {
    const paths = contextTokens('OnSanctionApplied').map((token) => token.path);
    expect(paths).toEqual(expect.arrayContaining(['moderator.displayName', 'minutes', 'typeLabel', 'reason']));
  });

  test('les conditions sur le type passent par des booléens propres à chaque déclencheur', () => {
    const keys = (type: string) => availableConditions(type).map((condition) => condition.key);
    expect(keys('OnSanctionApplied')).toEqual(expect.arrayContaining([
      'sanction.isWarn', 'sanction.isTimeout', 'sanction.isKick', 'sanction.isBan', 'sanction.isSoftban',
    ]));
    expect(keys('OnSanctionApplied')).not.toContain('sanction.isUnban');
    expect(keys('OnSanctionRevoked')).toEqual(expect.arrayContaining(['sanction.isUnban', 'sanction.isUntimeout']));
    expect(keys('OnSanctionRevoked')).not.toContain('sanction.isBan');
  });

  test('l\'ancienne condition sur le code n\'est plus proposée mais reste relisible', () => {
    expect(availableConditions('OnSanctionApplied').map((condition) => condition.key)).not.toContain('sanction.is');

    const legacy: Recipe = {
      trigger: { type: 'OnSanctionApplied' },
      steps: [{
        id: 'c', kind: 'condition', match: 'all',
        tests: [{ id: 't', condition: 'sanction.is', value: { from: 'text', template: 'BAN' } }],
        then: [{
          id: 'log', kind: 'action', action: 'SendLogMessage',
          values: { text: { from: 'text', template: '{typeLabel} pour {member.displayName}' } },
        }],
        otherwise: [],
      }],
    };
    expect(withoutTestId(decompileGraph(compileRecipe(legacy)))).toEqual(withoutTestId(legacy));
  });

  test('« la sanction est un bannissement » survit à la réouverture et filtre à l\'exécution', async () => {
    const recipe: Recipe = {
      trigger: { type: 'OnSanctionApplied' },
      steps: [{
        id: 'c', kind: 'condition', match: 'all',
        tests: [
          { id: 't1', condition: 'sanction.isBan' },
          { id: 't2', condition: 'sanction.isKick', negate: true },
        ],
        then: [{
          id: 'log', kind: 'action', action: 'SendLogMessage',
          values: { text: { from: 'text', template: '{typeLabel} ({minutes} min) par [{moderator.displayName}]' } },
        }],
        otherwise: [],
      }],
    };
    const graph = compileRecipe(recipe);
    expect(hasBlockingIssue(validateGraph(graph))).toBe(false);
    expect(withoutTestId(decompileGraph(graph))).toEqual(withoutTestId(recipe));

    const calls: { type: string; inputs: Record<string, unknown> }[] = [];
    const effects: WorkflowEffects = {
      ...makeEffects().effects,
      runAction: async (type, inputs) => {
        calls.push({ type, inputs });
        return {};
      },
    };
    const flags = { isWarn: false, isTimeout: false, isKick: false, isBan: false, isSoftban: false };
    const run = (outputs: Record<string, unknown>) => runWorkflow({
      graph,
      effects,
      triggerOutputs: { member, moderator: null, reason: 'Spam', minutes: 0, ...flags, ...outputs },
    });

    expect((await run({ type: 'KICK', typeLabel: 'Expulsion', isKick: true })).status).toBe('COMPLETED');
    expect(calls).toEqual([]);

    expect((await run({ type: 'TEMP_BAN', typeLabel: 'Bannissement temporaire', isBan: true, minutes: 1440 })).status).toBe('COMPLETED');
    expect(calls[0]?.inputs.text).toBe('Bannissement temporaire (1440 min) par []');
  });
});
