import { describe, expect, test } from 'bun:test';

import {
  evaluateCommandRestriction,
  normalizeCommandRestrictions,
  readCommandChannels,
  readCommandsEnabled,
  withCommandChannels,
  withCommandsEnabled,
  withGamblingEnabled,
  type CommandRestrictionRule,
} from '../../utils/commandAccess.js';

const roleId = '111111111111111111';
const otherRoleId = '222222222222222222';
const userId = '333333333333333333';
const channelId = '444444444444444444';

const rule = (overrides: Partial<CommandRestrictionRule> = {}): CommandRestrictionRule => ({
  commandName: 'ping',
  enabled: true,
  allowedChannelIds: [],
  blockedChannelIds: [],
  allowedRoleIds: [],
  blockedRoleIds: [],
  allowedUserIds: [],
  blockedUserIds: [],
  ...overrides,
});

describe('normalizeCommandRestrictions', () => {
  test('active la commande par defaut quand le flag est absent', () => {
    const [parsed] = normalizeCommandRestrictions([{ commandName: 'ping' }]);
    expect(parsed?.enabled).toBe(true);
  });

  test('ne coupe la commande que sur un false explicite', () => {
    const [off] = normalizeCommandRestrictions([{ commandName: 'ping', enabled: false }]);
    const [on] = normalizeCommandRestrictions([{ commandName: 'ping', enabled: 'nope' }]);
    expect(off?.enabled).toBe(false);
    expect(on?.enabled).toBe(true);
  });
});

describe('evaluateCommandRestriction', () => {
  test('laisse passer une commande sans regle', () => {
    expect(evaluateCommandRestriction([], 'ping', channelId, [roleId], userId).allowed).toBe(true);
  });

  test('une commande desactivee bloque aussi les privilegies', () => {
    const rules = [rule({ enabled: false })];

    expect(evaluateCommandRestriction(rules, 'ping', channelId, [roleId], userId, false).allowed).toBe(false);
    expect(evaluateCommandRestriction(rules, 'ping', channelId, [roleId], userId, true).allowed).toBe(false);
  });

  test('les privilegies contournent les restrictions de roles', () => {
    const rules = [rule({ allowedRoleIds: [otherRoleId] })];

    expect(evaluateCommandRestriction(rules, 'ping', channelId, [roleId], userId, false).allowed).toBe(false);
    expect(evaluateCommandRestriction(rules, 'ping', channelId, [roleId], userId, true).allowed).toBe(true);
  });

  test('une liste de roles autorises exclut les autres roles', () => {
    const rules = [rule({ allowedRoleIds: [roleId] })];

    expect(evaluateCommandRestriction(rules, 'ping', channelId, [roleId], userId).allowed).toBe(true);
    expect(evaluateCommandRestriction(rules, 'ping', channelId, [otherRoleId], userId).allowed).toBe(false);
  });

  test('un role bloque prime sur un role autorise', () => {
    const rules = [rule({ allowedRoleIds: [roleId], blockedRoleIds: [otherRoleId] })];

    expect(evaluateCommandRestriction(rules, 'ping', channelId, [roleId, otherRoleId], userId).allowed).toBe(false);
  });

  test('les salons autorises limitent la commande a ces salons', () => {
    const rules = [rule({ allowedChannelIds: [channelId] })];

    expect(evaluateCommandRestriction(rules, 'ping', channelId, [roleId], userId).allowed).toBe(true);
    expect(evaluateCommandRestriction(rules, 'ping', '555555555555555555', [roleId], userId).allowed).toBe(false);
  });

  describe('refus hors des salons autorises', () => {
    const elsewhere = '999999999999999999';
    const reason = (allowedChannelIds: string[]) =>
      evaluateCommandRestriction([rule({ allowedChannelIds })], 'ping', elsewhere, [], userId).reason;

    test('nomme le salon autorise', () => {
      expect(reason([channelId])).toBe(`Cette commande n'est autorisée que dans le salon <#${channelId}>.`);
    });

    test('liste les salons autorises', () => {
      expect(reason(['1', '2', '3'])).toBe("Cette commande n'est autorisée que dans les salons <#1>, <#2> et <#3>.");
    });

    test('resume les salons au-dela de dix', () => {
      const ids = Array.from({ length: 12 }, (_, i) => String(i + 1));
      expect(reason(ids)).toEndWith('<#10> et 2 autres.');
    });
  });

  describe('fils', () => {
    const threadId = '555555555555555555';

    test('un fil d\'un salon autorise est autorise', () => {
      const rules = [rule({ allowedChannelIds: [channelId] })];
      expect(evaluateCommandRestriction(rules, 'ping', threadId, [], userId, false, channelId).allowed).toBe(true);
    });

    test('un fil d\'un autre salon reste refuse', () => {
      const rules = [rule({ allowedChannelIds: [channelId] })];
      expect(evaluateCommandRestriction(rules, 'ping', threadId, [], userId, false, '666666666666666666').allowed).toBe(false);
    });

    test('un fil d\'un salon interdit est interdit', () => {
      const rules = [rule({ blockedChannelIds: [channelId] })];
      expect(evaluateCommandRestriction(rules, 'ping', threadId, [], userId, false, channelId).allowed).toBe(false);
    });
  });
});

describe('salons partages entre commandes', () => {
  const commands = ['rpg', 'raid'];
  const other = '777777777777777777';

  test('cree une regle pour chaque commande qui n\'en a pas', () => {
    const rules = withCommandChannels([], commands, [channelId]);
    expect(rules.map((r) => [r.commandName, r.allowedChannelIds])).toEqual([['rpg', [channelId]], ['raid', [channelId]]]);
  });

  test('garde les roles et salons interdits deja regles', () => {
    const rules = withCommandChannels([rule({ commandName: 'rpg', allowedRoleIds: [roleId], blockedChannelIds: [other] })], commands, [channelId]);
    const rpg = rules.find((r) => r.commandName === 'rpg');
    expect(rpg?.allowedRoleIds).toEqual([roleId]);
    expect(rpg?.blockedChannelIds).toEqual([other]);
    expect(rpg?.allowedChannelIds).toEqual([channelId]);
  });

  test('ne touche pas aux autres commandes', () => {
    const ping = rule({ allowedChannelIds: [other] });
    expect(withCommandChannels([ping], commands, [channelId])).toContainEqual(ping);
  });

  test('vider la liste retire une regle devenue vide mais garde les autres reglages', () => {
    const rules = withCommandChannels(
      [rule({ commandName: 'rpg', allowedChannelIds: [channelId] }), rule({ commandName: 'raid', allowedChannelIds: [channelId], allowedRoleIds: [roleId] })],
      commands,
      [],
    );
    expect(rules.map((r) => r.commandName)).toEqual(['raid']);
    expect(rules[0]?.allowedChannelIds).toEqual([]);
  });

  test('signale des listes differentes d\'une commande a l\'autre', () => {
    const read = readCommandChannels([rule({ commandName: 'rpg', allowedChannelIds: [channelId] })], commands);
    expect(read).toEqual({ channelIds: [channelId], diverged: true });
  });

  test('des listes identiques ne divergent pas', () => {
    const rules = withCommandChannels([], commands, [channelId, other]);
    expect(readCommandChannels(rules, commands)).toEqual({ channelIds: [channelId, other], diverged: false });
  });
});

describe('activation de plusieurs commandes', () => {
  test('couper une commande sans règle en crée une, désactivée', () => {
    const rules = withCommandsEnabled([], { dice: false });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ commandName: 'dice', enabled: false });
  });

  test('rallumer une commande garde ses salons et rôles', () => {
    const rules = withCommandsEnabled([rule({ commandName: 'dice', enabled: false, allowedRoleIds: [roleId] })], { dice: true });
    expect(rules[0]).toMatchObject({ commandName: 'dice', enabled: true, allowedRoleIds: [roleId] });
  });

  test('une règle revenue à neutre est retirée', () => {
    expect(withCommandsEnabled([rule({ commandName: 'dice', enabled: false })], { dice: true })).toHaveLength(0);
  });

  test('les autres commandes ne bougent pas', () => {
    const other = rule({ commandName: 'rpg', allowedChannelIds: [channelId] });
    expect(withCommandsEnabled([other], { dice: false })).toContainEqual(other);
  });
});

describe('jeux d\'argent', () => {
  test('le menu /games reste ouvert tant qu\'un jeu l\'est', () => {
    const rules = withGamblingEnabled([], { dice: false, roulette: false });
    expect(readCommandsEnabled(rules, ['dice', 'roulette', 'rps', 'guess', 'games'])).toEqual({
      dice: false, roulette: false, rps: true, guess: true, games: true,
    });
  });

  test('couper le dernier jeu coupe aussi /games, en rallumer un le rouvre', () => {
    const closed = withGamblingEnabled([], { dice: false, roulette: false, rps: false, guess: false });
    expect(readCommandsEnabled(closed, ['games'])).toEqual({ games: false });
    const reopened = withGamblingEnabled(closed, { rps: true });
    expect(readCommandsEnabled(reopened, ['games', 'rps', 'dice'])).toEqual({ games: true, rps: true, dice: false });
  });

  test('un /games coupé à la main reste coupé quand un jeu change', () => {
    const rules = withGamblingEnabled([rule({ commandName: 'games', enabled: false })], { dice: false });
    expect(readCommandsEnabled(rules, ['games', 'dice', 'rps'])).toEqual({ games: false, dice: false, rps: true });
  });

  test('un jeu absent du réglage garde son état', () => {
    const closed = withGamblingEnabled([], { dice: false });
    expect(readCommandsEnabled(withGamblingEnabled(closed, { roulette: false }), ['dice'])).toEqual({ dice: false });
  });
});
