import { describe, expect, test } from 'bun:test';
import {
  DUNGEON_FLOORS_MAX,
  DUNGEON_IDLE_TIMEOUT_MINUTES,
  dungeonPayout,
  dungeonReadyAt,
  groupDungeonLoot,
  hasFirstClearReward,
  isDungeonRunExpired,
  normalizeDungeonInput,
  parseDungeonLoot,
} from '../../services/features/rpg/rpgDungeonPolicy.js';

describe('saisie d\'un donjon', () => {
  test('un donjon valide garde ses étages dans l\'ordre, doublons compris', () => {
    const result = normalizeDungeonInput({ name: ' Crypte ', bossNames: ['Liche', 'Roi Gobelin', 'Liche'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('Crypte');
    expect(result.value.bossNames).toEqual(['Liche', 'Roi Gobelin', 'Liche']);
    expect(result.value).toMatchObject({ emoji: '🏰', levelRequired: 1, energyCost: 40, cooldownHours: 24, enabled: true });
  });

  test('un donjon sans étage ou sans nom est refusé', () => {
    expect(normalizeDungeonInput({ name: 'Crypte', bossNames: [] }).ok).toBe(false);
    expect(normalizeDungeonInput({ name: '  ', bossNames: ['Liche'] }).ok).toBe(false);
    expect(normalizeDungeonInput({ name: 'Crypte', bossNames: ['Liche', ' '] }).ok).toBe(false);
    expect(normalizeDungeonInput({ name: 'Crypte' }).ok).toBe(false);
  });

  test('le nombre d\'étages est plafonné', () => {
    const bossNames = Array.from({ length: DUNGEON_FLOORS_MAX + 1 }, () => 'Liche');
    expect(normalizeDungeonInput({ name: 'Crypte', bossNames }).ok).toBe(false);
  });

  test('les nombres sont bornés, et un objet vide devient null', () => {
    const result = normalizeDungeonInput({
      name: 'Crypte',
      bossNames: ['Liche'],
      levelRequired: -5,
      energyCost: '12',
      cooldownHours: 99999,
      completionItemName: '  ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ levelRequired: 1, energyCost: 12, cooldownHours: 720, completionItemName: null });
  });
});

describe('délai entre deux entrées', () => {
  const start = new Date('2026-09-25T10:00:00Z');

  test('sans entrée précédente ou sans délai, le donjon est ouvert', () => {
    expect(dungeonReadyAt(null, 24)).toBeNull();
    expect(dungeonReadyAt(start, 0, start.getTime())).toBeNull();
  });

  test('le délai court depuis l\'entrée précédente', () => {
    const readyAt = dungeonReadyAt(start, 24, start.getTime() + 60 * 60 * 1000);
    expect(readyAt?.toISOString()).toBe('2026-09-26T10:00:00.000Z');
    expect(dungeonReadyAt(start, 24, start.getTime() + 24 * 60 * 60 * 1000)).toBeNull();
  });
});

describe('inactivité pendant une partie', () => {
  const lastAction = new Date('2026-09-25T10:00:00Z');
  const minutes = (count: number) => lastAction.getTime() + count * 60 * 1000;

  test('la partie se joue encore jusqu\'au bout du délai', () => {
    expect(isDungeonRunExpired(lastAction, minutes(DUNGEON_IDLE_TIMEOUT_MINUTES))).toBe(false);
  });

  test('au-delà du délai, la partie est perdue', () => {
    expect(isDungeonRunExpired(lastAction, minutes(DUNGEON_IDLE_TIMEOUT_MINUTES + 1))).toBe(true);
  });
});

describe('butin d\'une partie', () => {
  const run = {
    xpEarned: 300,
    coinsEarned: 120,
    loot: [{ itemName: 'Croc d\'Hydre', emoji: '🐍' }, { itemName: 'Croc d\'Hydre', emoji: '🐍' }],
  };
  const chest = { completionCoins: 500, completionXp: 200, completionItemName: 'Cœur de Dragon' };

  test('une défaite ne verse rien', () => {
    expect(dungeonPayout(run, 'DEFEATED', chest)).toEqual({ coins: 0, xp: 0, items: [] });
  });

  test('une sortie verse le butin des boss, sans le coffre', () => {
    const payout = dungeonPayout(run, 'LEFT', chest);
    expect(payout).toMatchObject({ coins: 120, xp: 300 });
    expect(payout.items.map((item) => item.itemName)).not.toContain('Cœur de Dragon');
  });

  test('le dernier étage ajoute le coffre', () => {
    const payout = dungeonPayout(run, 'COMPLETED', chest);
    expect(payout).toMatchObject({ coins: 620, xp: 500 });
    expect(payout.items.map((item) => item.itemName)).toContain('Cœur de Dragon');
  });

  test('le butin se regroupe par objet', () => {
    expect(groupDungeonLoot(run.loot)).toEqual([{ itemName: 'Croc d\'Hydre', emoji: '🐍', quantity: 2 }]);
  });

  test('un butin mal formé en base est ignoré plutôt que de planter', () => {
    expect(parseDungeonLoot(null)).toEqual([]);
    expect(parseDungeonLoot([{ itemName: 'Os' }, { foo: 1 }, { itemName: '' }, 'x'])).toEqual([{ itemName: 'Os', emoji: null }]);
  });
});

describe('récompenses du coffre et du premier vainqueur', () => {
  test('titres, rôles et prime sont relus, et vides deviennent null', () => {
    const result = normalizeDungeonInput({
      name: 'Crypte',
      bossNames: ['Liche'],
      completionTitleId: ' title-1 ',
      completionRoleId: '',
      firstClearCoins: '250',
      firstClearXp: -10,
      firstClearRoleId: 'role-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      completionTitleId: 'title-1',
      completionRoleId: null,
      firstClearCoins: 250,
      firstClearXp: 0,
      firstClearItemName: null,
      firstClearTitleId: null,
      firstClearRoleId: 'role-1',
    });
  });

  test('une prime ne compte que si elle verse quelque chose', () => {
    const none = { firstClearCoins: 0, firstClearXp: 0, firstClearItemName: null, firstClearTitleId: null, firstClearRoleId: null };
    expect(hasFirstClearReward(none)).toBe(false);
    expect(hasFirstClearReward({ ...none, firstClearRoleId: 'role-1' })).toBe(true);
    expect(hasFirstClearReward({ ...none, firstClearXp: 50 })).toBe(true);
  });
});
