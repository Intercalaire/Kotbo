import { describe, expect, test } from 'bun:test';
import {
  CLAN_TOWER_DEFAULTS,
  applyClanTowerBonus,
  clanTowerAttemptIndex,
  clanTowerAttemptKey,
  clanTowerAwards,
  clanTowerBonus,
  clanTowerMilestonesValid,
  nextClanTowerAttempt,
  normalizeClanTowerSettings,
  rankClanTower,
} from '../../services/features/rpg/rpgClanTowerPolicy.js';
import type { TowerCoreStats } from '../../services/features/rpg/rpgTowerPolicy.js';
import { applyClanConquests, applyTowerAction, createTowerState, type TowerRules } from '../../services/features/rpg/rpgTowerEngine.js';
import { newTowerRoom, normalizeTowerLayout, type TowerLayout } from '../../services/features/rpg/rpgTowerMap.js';

const HOUR = 60 * 60 * 1000;
const start = new Date('2026-10-03T16:00:00Z');
const end = new Date(start.getTime() + 48 * HOUR);

describe('réglages de la Tour de clan', () => {
  test('les valeurs hors bornes sont ramenées, les absentes gardent leur repli', () => {
    const settings = normalizeClanTowerSettings({ weekday: 9, hour: -3, durationHours: 500, pointsPerFloor: 'x', podiumPoints: [10], announceChannelId: 'pas-un-id' });
    expect(settings.weekday).toBe(6);
    expect(settings.hour).toBe(0);
    expect(settings.durationHours).toBe(96);
    expect(settings.pointsPerFloor).toBe(CLAN_TOWER_DEFAULTS.pointsPerFloor);
    expect(settings.podiumPoints).toEqual([10, 0, 0]);
    expect(settings.announceChannelId).toBeNull();
  });

  test('un nom vide reprend le nom par défaut', () => {
    expect(normalizeClanTowerSettings({ name: '   ' }).name).toBe(CLAN_TOWER_DEFAULTS.name);
  });
});

describe('paliers collectifs', () => {
  test('chaque palier franchi ajoute son bonus aux précédents', () => {
    expect(clanTowerBonus(0, [10, 25, 50])).toEqual({ reached: 0, potions: 0, healthPercent: 0, attackPercent: 0, next: 10 });
    expect(clanTowerBonus(27, [10, 25, 50])).toEqual({ reached: 2, potions: 1, healthPercent: 10, attackPercent: 0, next: 50 });
    expect(clanTowerBonus(80, [10, 25, 50])).toMatchObject({ reached: 3, attackPercent: 10, next: null });
  });

  test('le bonus renforce les stats d\'entrée', () => {
    const stats = applyClanTowerBonus({ attack: 20, maxHealth: 150, speed: 10 }, clanTowerBonus(60, [10, 25, 50]));
    expect(stats).toEqual({ attack: 22, maxHealth: 165, speed: 10 });
  });

  test('des paliers qui ne croissent pas sont refusés en bloc', () => {
    expect(normalizeClanTowerSettings({ milestones: [30, 20, 50] }).milestones).toEqual(CLAN_TOWER_DEFAULTS.milestones);
    expect(normalizeClanTowerSettings({ milestones: [5, 15, 40] }).milestones).toEqual([5, 15, 40]);
    expect(clanTowerMilestonesValid([10, 10, 20])).toBe(false);
    expect(clanTowerMilestonesValid([10, 20])).toBe(false);
  });
});

describe('tentatives', () => {
  test('une tentative par tranche de vingt-quatre heures depuis l\'ouverture', () => {
    expect(clanTowerAttemptIndex(start, new Date(start.getTime() + 2 * HOUR))).toBe(0);
    expect(clanTowerAttemptIndex(start, new Date(start.getTime() + 25 * HOUR))).toBe(1);
    expect(clanTowerAttemptKey('evt', start, new Date(start.getTime() + 25 * HOUR))).toBe('clan:evt:1');
  });

  test('la prochaine tentative n\'existe pas si l\'événement ferme avant', () => {
    expect(nextClanTowerAttempt(start, end, new Date(start.getTime() + HOUR))?.getTime()).toBe(start.getTime() + 24 * HOUR);
    expect(nextClanTowerAttempt(start, end, new Date(start.getTime() + 30 * HOUR))).toBeNull();
  });
});

describe('classement et points', () => {
  const at = (hours: number) => new Date(start.getTime() + hours * HOUR);
  const conquests = [
    { clanId: 'A', floor: 1, userId: 'a1', conqueredAt: at(1) },
    { clanId: 'A', floor: 2, userId: 'a1', conqueredAt: at(2) },
    { clanId: 'A', floor: 3, userId: 'a2', conqueredAt: at(5) },
    { clanId: 'B', floor: 1, userId: 'b1', conqueredAt: at(1) },
    { clanId: 'B', floor: 2, userId: 'b1', conqueredAt: at(1) },
    { clanId: 'B', floor: 3, userId: 'b2', conqueredAt: at(3) },
    { clanId: 'C', floor: 1, userId: 'c1', conqueredAt: at(4) },
  ];

  test('l\'étage le plus haut d\'abord, puis le premier arrivé', () => {
    const standings = rankClanTower(conquests);
    expect(standings.map((standing) => [standing.clanId, standing.floors, standing.rank])).toEqual([['B', 3, 1], ['A', 3, 2], ['C', 1, 3]]);
    expect(standings[1].climbers).toEqual([{ userId: 'a1', floors: 2 }, { userId: 'a2', floors: 1 }]);
  });

  test('chaque conquérant touche ses étages, le podium va au clan', () => {
    const awards = clanTowerAwards(rankClanTower(conquests), { pointsPerFloor: 10, podiumPoints: [150, 100, 50] });
    const a = awards.find((award) => award.clanId === 'A')!;
    expect(a.climbers).toEqual([{ userId: 'a1', floors: 2, points: 20 }, { userId: 'a2', floors: 1, points: 10 }]);
    expect(a.podium).toBe(100);
    expect(a.total).toBe(130);
    expect(awards.find((award) => award.clanId === 'C')!.total).toBe(60);
  });

  test('aucune conquête, aucun classement', () => {
    expect(rankClanTower([])).toEqual([]);
  });
});

describe('salles conquises par le clan', () => {
  const RULES: TowerRules = { floorGrowthPercent: 8, bossEvery: 10, blessingEvery: 5, maxBlessings: 6, shardsPerFloor: 0 };
  const FOES = { monsters: [{ name: 'Rat', emoji: '' }], bosses: [{ name: 'Roi Rat', emoji: '' }], byName: {} };
  const BASE: TowerCoreStats = {
    attack: 20, defense: 10, speed: 10, maxHealth: 150,
    critChance: 0, armorPiercing: 0, damageReduction: 0, lifesteal: 0, thorns: 0,
  };

  function layout(rooms: ReturnType<typeof newTowerRoom>[], width = 3, height = 3): TowerLayout {
    const result = normalizeTowerLayout({ name: '', width, height, fog: false, modifier: 'NONE', rooms });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  test('un gardien conquis laisse monter sans combat', () => {
    const floor = layout([newTowerRoom(0, 2, 'START'), newTowerRoom(0, 0, 'BOSS')]);
    const state = createTowerState({ base: BASE, skills: [], potions: 1, seed: 3, rules: RULES, layout: floor });
    applyClanConquests(state, ['0-0']);
    const door = state.moves.findIndex((move) => move.type === 'BOSS');
    const step = applyTowerAction(state, 1, { type: 'door', index: door }, RULES, FOES, [floor]);
    expect(step.state.encounter).toBeNull();
    expect(step.floor).toBe(2);
    expect(step.state.floorsCleared).toBe(1);
    expect(step.state.notice).toMatchObject({ k: 'exit', exit: 'BOSS', conquered: true });
  });

  test('une élite conquise se traverse, et sa clé compte déjà', () => {
    const floor = layout([
      newTowerRoom(0, 0, 'START'),
      newTowerRoom(1, 0, 'ELITE', { key: true }),
      newTowerRoom(2, 0, 'STAIRS'),
    ]);
    const state = createTowerState({ base: BASE, skills: [], potions: 1, seed: 3, rules: RULES, layout: floor });
    applyClanConquests(state, ['1-0', 'inconnue']);
    expect(state.map!.conquered).toEqual(['1-0']);
    expect(state.map!.cleared).toContain('1-0');
    expect(state.moves.find((move) => move.roomId === '1-0')?.cleared).toBe(true);
    let step = applyTowerAction(state, 1, { type: 'door', index: state.moves.findIndex((move) => move.type === 'ELITE') }, RULES, FOES, [floor]);
    expect(step.state.encounter).toBeNull();
    step = applyTowerAction(step.state, step.floor, { type: 'door', index: step.state.moves.findIndex((move) => move.type === 'STAIRS') }, RULES, FOES, [floor]);
    expect(step.floor).toBe(2);
  });
});
