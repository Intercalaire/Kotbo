import { describe, expect, test } from 'bun:test';
import { simulateTowerRuns } from '../../services/features/rpg/rpgTowerSim.js';
import {
  TOWER_BASE_STATS,
  TowerRng,
  applyWeeklyCap,
  computeTowerEntryStats,
  floorShards,
  normalizeTowerReward,
  normalizeTowerSettings,
  normalizeTowerUpgrades,
  parseTowerUpgrades,
  rollBlessingChoices,
  rollMerchantOffers,
  defaultTowerMerchant,
  rollDoors,
  settleShards,
  TOWER_DODGE_CAP,
  TOWER_GROWTH_KNEE,
  towerDailySeed,
  towerSkill,
  towerSkillPrice,
  towerSkillTier,
  towerDayKey,
  towerDodgeChance,
  towerFloorGrowth,
  towerFoeShape,
  towerMonsterStats,
  towerUpgradeBonus,
  towerUpgradeCost,
  towerWeekStart,
  type TowerCoreStats,
  type TowerEntryInput,
} from '../../services/features/rpg/rpgTowerPolicy.js';
import {
  TowerActionRefused,
  applyTowerAction,
  createTowerState,
  type TowerRules,
  type TowerState,
} from '../../services/features/rpg/rpgTowerEngine.js';
import {
  defaultTowerLayout,
  floorLayout,
  normalizeTowerFloors,
  normalizeTowerLayout,
  exitRoom,
  isExitRoom,
  newTowerRoom,
  roomNeighbors,
  shortestPathToExit,
  visibleRooms,
} from '../../services/features/rpg/rpgTowerMap.js';
import { floorSeed, generateTowerLayout, towerFloorLayout } from '../../services/features/rpg/rpgTowerGen.js';
import { renderTowerImage } from '../../services/features/rpg/rpgTowerRender.js';

const RULES: TowerRules = { floorGrowthPercent: 8, bossEvery: 10, blessingEvery: 5, maxBlessings: 6, shardsPerFloor: 2 };
const FOES = { monsters: [{ name: 'Rat', emoji: '🐀' }], bosses: [{ name: 'Roi Rat', emoji: '👑' }], byName: {} };

function entry(main: number, overrides: Partial<TowerEntryInput> = {}): TowerEntryInput {
  return {
    mode: 'COMPRESSED',
    inheritCapPercent: 80,
    titleCapPercent: 30,
    main: { attack: main, defense: main, speed: main, maxHealth: main },
    title: { attack: 0, defense: 0, speed: 0, maxHealth: 0, critPercent: 0 },
    classModifiers: { attack: 1, defense: 1, speed: 1, maxHealth: 1 },
    classPassive: {},
    ...overrides,
  };
}

const STRONG: TowerCoreStats = {
  attack: 500, defense: 200, speed: 50, maxHealth: 5000,
  critChance: 0, armorPiercing: 0, damageReduction: 0, lifesteal: 0, thorns: 0,
};

describe('statistiques d\'entrée', () => {
  test('un joueur à un million de stats ne part qu\'avec un avantage borné', () => {
    const beginner = computeTowerEntryStats(entry(20));
    const veteran = computeTowerEntryStats(entry(1_000_000));
    expect(veteran.attack / beginner.attack).toBeLessThan(2);
    // Plafond d'héritage du fixture : 80 %.
    expect(veteran.attack).toBe(Math.round(TOWER_BASE_STATS.attack * 1.8));
  });

  test('la compression suit les ordres de grandeur, pas la valeur brute', () => {
    const a = computeTowerEntryStats(entry(200, { inheritCapPercent: 300 })).attack;
    const b = computeTowerEntryStats(entry(2_000, { inheritCapPercent: 300 })).attack;
    const c = computeTowerEntryStats(entry(20_000, { inheritCapPercent: 300 })).attack;
    expect(Math.abs((b - a) - (c - b))).toBeLessThanOrEqual(1);
  });

  test('le mode RESET ignore les stats du RPG mais garde le titre', () => {
    const title = { attack: 2_000, defense: 0, speed: 0, maxHealth: 0, critPercent: 10 };
    const reset = computeTowerEntryStats(entry(1_000_000, { mode: 'RESET', title }));
    const bare = computeTowerEntryStats(entry(0, { mode: 'RESET' }));
    expect(bare.attack).toBe(TOWER_BASE_STATS.attack);
    expect(reset.attack).toBeGreaterThan(bare.attack);
    expect(reset.attack).toBeLessThanOrEqual(Math.round(TOWER_BASE_STATS.attack * 1.3));
    expect(reset.critChance).toBeCloseTo(0.15);
  });

  test('la classe garde son profil et son passif', () => {
    const mage = computeTowerEntryStats(entry(0, {
      mode: 'RESET',
      classModifiers: { attack: 1.35, defense: 0.8, speed: 1, maxHealth: 0.85 },
      classPassive: { armorPiercing: 0.3 },
    }));
    expect(mage.attack).toBe(27);
    expect(mage.armorPiercing).toBe(0.3);
  });
});

describe('compétences dans la Tour', () => {
  test('une compétence du RPG est affaiblie : dégâts bonus divisés, vol de vie et soins plafonnés, recharge plus longue', () => {
    const drain = towerSkill({ id: 'd', name: 'Drain', emoji: '', cooldownTurns: 2, effect: { damageMultiplier: 2, lifesteal: 0.7 } });
    expect(drain.effect.damageMultiplier).toBe(1.5);
    expect(drain.effect.lifesteal).toBe(0.15);
    expect(drain.cooldownTurns).toBe(3);
    const guard = towerSkill({ id: 'g', name: 'Garde', emoji: '', cooldownTurns: 4, effect: { damageMultiplier: 0, defenseMultiplier: 2, healPercent: 0.3 } });
    expect(guard.effect.damageMultiplier).toBe(0);
    expect(guard.effect.defenseMultiplier).toBe(1.5);
    expect(guard.effect.healPercent).toBe(0.12);
    expect(guard.cooldownTurns).toBe(5);
  });
});

describe('étages', () => {
  test('un étage de boss ne propose que le boss', () => {
    expect(rollDoors(10, 10, new TowerRng(1))).toEqual(['BOSS']);
  });

  test('le premier étage ouvre sur un combat et trois portes distinctes', () => {
    for (let seed = 0; seed < 50; seed++) {
      const doors = rollDoors(1, 10, new TowerRng(seed));
      expect(doors[0]).toBe('COMBAT');
      expect(new Set(doors).size).toBe(3);
    }
  });

  test('les monstres ne dépendent que de l\'étage', () => {
    const first = towerMonsterStats(1, 8, 'COMBAT');
    const tenth = towerMonsterStats(10, 8, 'COMBAT');
    expect(tenth.attack / first.attack).toBeCloseTo(Math.pow(1.08, 9), 1);
    expect(towerMonsterStats(10, 8, 'BOSS').health).toBeGreaterThan(tenth.health);
  });

  test('le générateur est reproductible', () => {
    const a = new TowerRng(42);
    const b = new TowerRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
});

describe('éclats', () => {
  test('un boss et les dizaines valent plus', () => {
    expect(floorShards(3, 2, false)).toBe(2);
    expect(floorShards(12, 2, false)).toBe(4);
    expect(floorShards(10, 2, true)).toBe(8);
  });

  test('la mort retient une part, l\'abandon garde tout', () => {
    expect(settleShards(100, 'LEFT', 50)).toBe(100);
    expect(settleShards(101, 'DEAD', 50)).toBe(50);
    expect(settleShards(100, 'LEFT', 50, 80)).toBe(80);
    expect(settleShards(100, 'LEFT', 50, 80, true)).toBe(100);
  });

  test('le plafond hebdomadaire', () => {
    expect(applyWeeklyCap(50, 0, 0)).toBe(50);
    expect(applyWeeklyCap(50, 80, 100)).toBe(20);
    expect(applyWeeklyCap(50, 120, 100)).toBe(0);
  });

  test('la semaine commence le lundi', () => {
    expect(towerWeekStart(new Date('2026-10-04T15:00:00Z')).toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(towerWeekStart(new Date('2026-09-28T00:00:00Z')).toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });
});

describe('réglages et récompenses', () => {
  test('les réglages sont bornés', () => {
    const result = normalizeTowerSettings({ floorGrowthPercent: 500, deathShardPercent: -3, entryMode: 'X' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.floorGrowthPercent).toBe(30);
    expect(result.value.deathShardPercent).toBe(0);
    expect(result.value.entryMode).toBe('COMPRESSED');
    expect(result.value.upgrades.map((upgrade) => upgrade.id)).toEqual(['potion', 'vigor']);
    expect(result.value.merchant.healPercent).toBe(40);
  });

  test('les améliorations se règlent et gardent les niveaux sous leur identifiant', () => {
    const upgrades = normalizeTowerUpgrades([
      { id: 'vigor', effect: 'HEALTH', perLevel: 10, maxLevel: 2, baseCost: 30, costGrowthPercent: 50 },
      { id: 'might', effect: 'ATTACK', perLevel: 500, maxLevel: 3, baseCost: 10 },
    ]);
    expect(upgrades.ok).toBe(true);
    if (!upgrades.ok) return;
    expect(upgrades.value[1].perLevel).toBe(100);
    const levels = parseTowerUpgrades({ vigor: 7, potion: 3 }, upgrades.value);
    expect(levels).toEqual({ vigor: 2, might: 0 });
    expect(towerUpgradeCost(upgrades.value[0], 2)).toBe(Math.round(30 * 1.5 * 1.5));
    const bonus = towerUpgradeBonus(upgrades.value, levels);
    expect(bonus.maxHealth).toBeCloseTo(0.2);
    const boosted = computeTowerEntryStats(entry(0, { mode: 'RESET', upgradeBonus: bonus }));
    expect(boosted.maxHealth).toBe(Math.round(TOWER_BASE_STATS.maxHealth * 1.2));
  });

  test('deux améliorations au même identifiant sont refusées', () => {
    expect(normalizeTowerUpgrades([
      { id: 'a', effect: 'GOLD', perLevel: 5, maxLevel: 1, baseCost: 1 },
      { id: 'a', effect: 'CRIT', perLevel: 5, maxLevel: 1, baseCost: 1 },
    ]).ok).toBe(false);
  });

  test('le marchand suit ses réglages de prix', () => {
    const settings = normalizeTowerSettings({ merchant: { potionPrice: 10, potionPricePerFloor: 1, offers: ['POTION'] } });
    expect(settings.ok).toBe(true);
    if (!settings.ok) return;
    const offers = rollMerchantOffers(5, new TowerRng(1), settings.value.merchant.offers, 200, settings.value.merchant);
    expect(offers).toEqual([{ kind: 'POTION', price: 30, sold: false }]);
  });

  test('une récompense vide ou un titre répétable sont refusés', () => {
    expect(normalizeTowerReward({ kind: 'SHOP', name: 'Rien' }).ok).toBe(false);
    expect(normalizeTowerReward({ kind: 'SHOP', name: 'Titre', titleId: 't1', repeatable: true }).ok).toBe(false);
    expect(normalizeTowerReward({ kind: 'MILESTONE', name: 'Palier', floor: 20, shards: 50 }).ok).toBe(true);
  });

  test('un palier peut ne donner que des points de clan, de l\'XP ou un objet', () => {
    const clan = normalizeTowerReward({ kind: 'MILESTONE', name: 'Bannière', floor: 10, clanPoints: 25, titleId: 't1' });
    expect(clan.ok).toBe(true);
    if (clan.ok) {
      expect(clan.value.clanPoints).toBe(25);
      expect(clan.value.titleId).toBe('t1');
    }
    expect(normalizeTowerReward({ kind: 'MILESTONE', name: 'Savoir', floor: 5, xp: 100 }).ok).toBe(true);
    expect(normalizeTowerReward({ kind: 'SHOP', name: 'Coffre', price: 50, itemName: ' Potion ' }).ok).toBe(true);
    expect(normalizeTowerReward({ kind: 'MILESTONE', name: 'Rien', floor: 5, clanPoints: -4 }).ok).toBe(false);
  });

  test('les bénédictions respectent le plafond de variétés', () => {
    const owned = { might: 1, bulwark: 1 };
    const choices = rollBlessingChoices(owned, 2, new TowerRng(7));
    expect(choices.every((id) => id in owned)).toBe(true);
  });
});

describe('moteur d\'ascension', () => {
  function start(base: TowerCoreStats = STRONG): TowerState {
    return createTowerState({
      base,
      skills: [{ id: 'fireball', name: 'Boule de Feu', emoji: '🔥', cooldownTurns: 3, effect: { damageMultiplier: 2.3 } }],
      potions: 1,
      seed: 1234,
      rules: RULES,
    });
  }

  function enterCombat(state: TowerState) {
    return applyTowerAction(state, 1, { type: 'door', index: 0 }, RULES, FOES);
  }

  test('une ascension commence devant trois portes', () => {
    const state = start();
    expect(state.phase).toBe('DOORS');
    expect(state.doors).toHaveLength(3);
    expect(state.hp).toBe(STRONG.maxHealth);
  });

  test('gagner un combat fait monter d\'un étage et rapporte des éclats', () => {
    let step = enterCombat(start());
    expect(step.state.phase).toBe('COMBAT');
    for (let i = 0; i < 50 && step.state.phase === 'COMBAT'; i++) {
      step = applyTowerAction(step.state, step.floor, { type: 'attack' }, RULES, FOES);
    }
    expect(step.floor).toBe(2);
    expect(step.state.shards).toBeGreaterThan(0);
    expect(step.state.kills).toBe(1);
    expect(['DOORS', 'LOOT']).toContain(step.state.phase);
  });

  test('une compétence en recharge est refusée', () => {
    const inCombat = enterCombat(start({ ...STRONG, attack: 1 }));
    const cast = applyTowerAction(inCombat.state, 1, { type: 'skill', id: 'fireball' }, RULES, FOES);
    expect(cast.state.encounter?.cooldowns.fireball).toBeGreaterThan(0);
    expect(() => applyTowerAction(cast.state, 1, { type: 'skill', id: 'fireball' }, RULES, FOES)).toThrow(TowerActionRefused);
  });

  test('l\'état d\'entrée n\'est jamais modifié', () => {
    const state = start();
    const snapshot = JSON.stringify(state);
    enterCombat(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  test('une potion à PV pleins est refusée hors combat', () => {
    expect(() => applyTowerAction(start(), 1, { type: 'potion' }, RULES, FOES)).toThrow(TowerActionRefused);
  });

  test('tomber à zéro PV met fin à l\'ascension', () => {
    let step = enterCombat(start({ ...STRONG, attack: 1, defense: 0, maxHealth: 5 }));
    for (let i = 0; i < 50 && !step.dead; i++) {
      step = applyTowerAction(step.state, step.floor, { type: 'defend' }, RULES, FOES);
    }
    expect(step.dead).toBe(true);
    expect(step.state.hp).toBe(0);
  });

  test('une action hors de sa phase est refusée', () => {
    expect(() => applyTowerAction(start(), 1, { type: 'attack' }, RULES, FOES)).toThrow(TowerActionRefused);
    expect(() => applyTowerAction(start(), 1, { type: 'door', index: 7 }, RULES, FOES)).toThrow(TowerActionRefused);
  });

  test('un monstre tué par les épines de son dernier coup n\'empêche pas la mort', () => {
    const fighting = enterCombat(start({ ...STRONG, speed: 1, defense: 0, maxHealth: 10, thorns: 0.5 })).state;
    fighting.hp = 1;
    fighting.encounter!.health = 1;
    const step = applyTowerAction(fighting, 1, { type: 'defend' }, RULES, FOES);
    expect(step.dead).toBe(true);
    expect(step.state.hp).toBe(0);
  });

  test('une potion à PV pleins est refusée en combat aussi', () => {
    expect(() => applyTowerAction(enterCombat(start()).state, 1, { type: 'potion' }, RULES, FOES)).toThrow(TowerActionRefused);
  });

  test('fuir coûte une part de l\'or et rouvre des portes au même étage', () => {
    const fighting = enterCombat(start({ ...STRONG, speed: 1 })).state;
    fighting.gold = 100;
    const step = applyTowerAction(fighting, 1, { type: 'flee' }, RULES, FOES);
    expect(step.dead).toBe(false);
    expect(step.floor).toBe(1);
    expect(step.state.phase).toBe('DOORS');
    expect(step.state.gold).toBe(75);
    expect(step.state.notice).toEqual({ k: 'fled', gold: 25 });
  });

  test('on ne fuit pas un boss', () => {
    const fighting = enterCombat(start()).state;
    fighting.encounter!.kind = 'BOSS';
    expect(() => applyTowerAction(fighting, 1, { type: 'flee' }, RULES, FOES)).toThrow(TowerActionRefused);
  });

  test('une élite annonce un coup puissant, que la garde pare', () => {
    let state = enterCombat(start({ ...STRONG, attack: 1, speed: 1 })).state;
    state.encounter!.kind = 'ELITE';
    state.encounter!.health = 1_000_000;
    for (let i = 0; i < 5; i++) state = applyTowerAction(state, 1, { type: 'attack' }, RULES, FOES).state;
    expect(state.encounter?.charging).toBe(true);
    const parried = applyTowerAction(state, 1, { type: 'defend' }, RULES, FOES).state;
    const hit = parried.encounter!.log.find((entry) => entry.k === 'monster' && entry.heavy);
    expect(hit).toMatchObject({ heavy: true, parried: true });
    expect(parried.encounter?.charging).toBe(false);
  });

  test('un boss sous 30 % de PV entre en rage', () => {
    const fighting = enterCombat(start({ ...STRONG, attack: 1, speed: 1 })).state;
    fighting.encounter!.kind = 'BOSS';
    fighting.encounter!.health = Math.floor(fighting.encounter!.maxHealth * 0.3);
    const step = applyTowerAction(fighting, 1, { type: 'defend' }, RULES, FOES);
    expect(step.state.encounter?.enraged).toBe(true);
    expect(step.state.encounter?.log.some((entry) => entry.k === 'enrage')).toBe(true);
  });

  test('défendre soigne et renforce l\'attaque suivante', () => {
    const fighting = enterCombat(start({ ...STRONG, speed: 1 })).state;
    fighting.hp = 100;
    const step = applyTowerAction(fighting, 1, { type: 'defend' }, RULES, FOES);
    expect(step.state.encounter?.riposte).toBe(true);
    expect(step.state.encounter?.log[0]).toEqual({ k: 'defend', hp: Math.floor(STRONG.maxHealth * 0.05) });
  });

  test('les règles sont figées à l\'entrée', () => {
    const state = start();
    expect(state.rules).toEqual(RULES);
    state.hp = 1000;
    const live = { ...RULES, merchant: { ...defaultTowerMerchant(), potionHealPercent: 100 } };
    const step = applyTowerAction(state, 1, { type: 'potion' }, live, FOES);
    expect(step.state.hp).toBe(1000 + Math.floor(STRONG.maxHealth * 0.35));
  });

  test('le marchand renouvelle son équipement une seule fois', () => {
    const state = start();
    state.phase = 'MERCHANT';
    state.merchant = rollMerchantOffers(1, new TowerRng(3), ['GEAR']);
    state.gold = 1000;
    const step = applyTowerAction(state, 1, { type: 'reroll' }, RULES, FOES);
    expect(step.state.merchantRerolled).toBe(true);
    expect(step.state.gold).toBeLessThan(1000);
    expect(() => applyTowerAction(step.state, 1, { type: 'reroll' }, RULES, FOES)).toThrow(TowerActionRefused);
  });
});

describe('vitesse et croissance', () => {
  test('l\'esquive vient de l\'écart de vitesse et reste plafonnée', () => {
    expect(towerDodgeChance(10, 10)).toBe(0);
    expect(towerDodgeChance(8, 10)).toBe(0);
    expect(towerDodgeChance(15, 10)).toBeCloseTo(TOWER_DODGE_CAP / 4);
    expect(towerDodgeChance(30, 10)).toBeCloseTo(TOWER_DODGE_CAP);
    expect(towerDodgeChance(100, 10)).toBe(TOWER_DODGE_CAP);
  });

  test('la croissance des monstres ralentit après le coude', () => {
    const knee = towerFloorGrowth(TOWER_GROWTH_KNEE, 8);
    expect(knee).toBeCloseTo(Math.pow(1.08, TOWER_GROWTH_KNEE - 1));
    expect(towerFloorGrowth(TOWER_GROWTH_KNEE + 1, 8) / knee).toBeCloseTo(1.04);
  });
});

describe('carte de la Tour', () => {
  const room = (x: number, y: number, type: string, extra: Record<string, unknown> = {}) => ({ x, y, type, ...extra });
  const SMALL = {
    width: 4,
    height: 4,
    rooms: [room(0, 0, 'START'), room(1, 0, 'CHEST', { chest: 'GOLD' }), room(2, 0, 'BOSS')],
  };

  test('la carte d\'exemple est valide', () => {
    const result = normalizeTowerLayout(defaultTowerLayout());
    expect(result.ok).toBe(true);
    if (result.ok) expect(shortestPathToExit(result.value)).toBe(5);
  });

  test('une carte sans boss, avec deux départs ou une salle isolée est refusée', () => {
    expect(normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'MONSTER')] }).ok).toBe(false);
    expect(normalizeTowerLayout({ ...SMALL, rooms: [...SMALL.rooms, room(0, 3, 'START')] }).ok).toBe(false);
    expect(normalizeTowerLayout({ ...SMALL, rooms: [...SMALL.rooms, room(0, 3, 'MONSTER')] }).ok).toBe(false);
  });

  test('un étage a exactement un gardien, celui qui le ferme', () => {
    expect(normalizeTowerLayout({ ...SMALL, rooms: [...SMALL.rooms, room(0, 2, 'BOSS'), room(0, 1, 'EMPTY')] }).ok).toBe(false);
  });

  test('le boss occupe 2×2 : il ne peut ni déborder ni chevaucher', () => {
    expect(normalizeTowerLayout({ ...SMALL, rooms: [room(0, 0, 'START'), room(3, 0, 'BOSS')] }).ok).toBe(false);
    expect(normalizeTowerLayout({ ...SMALL, rooms: [...SMALL.rooms, room(3, 1, 'MONSTER')] }).ok).toBe(false);
  });

  test('les voisins d\'une grande salle sont comptés une fois', () => {
    const result = normalizeTowerLayout(SMALL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(roomNeighbors(result.value, '1-0').map((entry) => entry.room.type).sort()).toEqual(['BOSS', 'START']);
    expect(roomNeighbors(result.value, '2-0').map((entry) => entry.room.id)).toEqual(['1-0']);
  });

  test('une carte est un étage : on la parcourt, et son gardien fait monter à l\'étage suivant', () => {
    const first = normalizeTowerLayout({ ...SMALL, name: 'Caserne' });
    const second = normalizeTowerLayout({ width: 4, height: 4, name: 'Crypte', rooms: [room(0, 0, 'START'), room(1, 0, 'BOSS')] });
    if (!first.ok) throw new Error(first.error);
    if (!second.ok) throw new Error(second.error);
    const floors = [first.value, second.value];
    let step = {
      state: createTowerState({ base: STRONG, skills: [], potions: 1, seed: 99, rules: RULES, layout: first.value }),
      floor: 1,
      dead: false,
    };
    expect(step.state.moves.map((move) => [move.type, move.direction])).toEqual([['CHEST', 'E']]);

    step = applyTowerAction(step.state, step.floor, { type: 'door', index: 0 }, RULES, FOES, floors);
    expect(step.floor).toBe(1);
    expect(step.state.map?.depth).toBe(2);
    // Les éclats tombent à l'étage gravi, pas à chaque salle.
    expect(step.state.shards).toBe(0);
    expect(step.state.gold).toBeGreaterThan(0);
    expect(step.state.map?.cleared).toContain('1-0');

    const back = step.state.moves.findIndex((move) => move.type === 'START');
    const returned = applyTowerAction(step.state, step.floor, { type: 'door', index: back }, RULES, FOES, floors);
    expect(returned.floor).toBe(1);
    expect(returned.state.map?.pos).toBe('0-0');

    const boss = step.state.moves.findIndex((move) => move.type === 'BOSS');
    step = applyTowerAction(step.state, step.floor, { type: 'door', index: boss }, RULES, FOES, floors);
    expect(step.state.encounter?.kind).toBe('BOSS');
    for (let i = 0; i < 50 && step.state.phase === 'COMBAT'; i++) {
      step = applyTowerAction(step.state, step.floor, { type: 'attack' }, RULES, FOES, floors);
    }
    expect(step.floor).toBe(2);
    expect(step.state.floorsCleared).toBe(1);
    // Le gardien compte à part des monstres, pour les quêtes de la Tour.
    expect(step.state.bossKills).toBe(1);
    expect(step.state.kills).toBeGreaterThan(1);
    expect(step.state.map?.layout.name).toBe('Crypte');
    expect(step.state.map?.pos).toBe('0-0');
    expect(step.state.map?.cleared).toEqual(['0-0']);
    expect(step.state.notice).toMatchObject({ k: 'victory', climbed: { floor: 2, name: 'Crypte' } });
    expect(step.state.safeLeave).toBe(true);
  });

  test('après le dernier étage dessiné, la montée reprend au premier', () => {
    const a = { ...defaultTowerLayout(), name: 'A' };
    const b = { ...defaultTowerLayout(), name: 'B' };
    expect(floorLayout([a, b], 1)?.name).toBe('A');
    expect(floorLayout([a, b], 2)?.name).toBe('B');
    expect(floorLayout([a, b], 3)?.name).toBe('A');
    expect(floorLayout([], 3)).toBeNull();
  });

  test('un étage invalide est signalé par son numéro', () => {
    const result = normalizeTowerFloors([defaultTowerLayout(), { width: 4, height: 4, rooms: [room(0, 0, 'START')] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.startsWith('Étage 2')).toBe(true);
  });

  test('sur carte, une bénédiction tombe tous les N étages gravis', () => {
    const layout = normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'BOSS')] });
    if (!layout.ok) throw new Error(layout.error);
    const rules = { ...RULES, blessingEvery: 1 };
    let step = {
      state: createTowerState({ base: STRONG, skills: [], potions: 1, seed: 7, rules, layout: layout.value }),
      floor: 1,
      dead: false,
    };
    step = applyTowerAction(step.state, step.floor, { type: 'door', index: 0 }, rules, FOES, [layout.value]);
    for (let i = 0; i < 50 && step.state.phase === 'COMBAT'; i++) {
      step = applyTowerAction(step.state, step.floor, { type: 'attack' }, rules, FOES, [layout.value]);
    }
    expect(step.floor).toBe(2);
    expect(step.state.blessingDue || step.state.phase === 'BLESSING').toBe(true);
  });

  test('le palier sûr s\'efface dès le pas suivant', () => {
    const layout = normalizeTowerLayout(SMALL);
    if (!layout.ok) throw new Error(layout.error);
    const state = createTowerState({ base: STRONG, skills: [], potions: 1, seed: 99, rules: RULES, layout: layout.value });
    state.safeLeave = true;
    const step = applyTowerAction(state, 1, { type: 'door', index: 0 }, RULES, FOES, [layout.value]);
    expect(step.state.safeLeave).toBe(false);
  });

  test('une salle peut imposer sa créature', () => {
    const layout = normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'MONSTER', { foe: 'Liche' }), room(2, 0, 'BOSS')] });
    if (!layout.ok) throw new Error(layout.error);
    const state = createTowerState({ base: STRONG, skills: [], potions: 1, seed: 5, rules: RULES, layout: layout.value });
    const foes = { ...FOES, byName: { Liche: { name: 'Liche', emoji: '🧙' } } };
    const step = applyTowerAction(state, 1, { type: 'door', index: 0 }, RULES, foes);
    expect(step.state.encounter?.name).toBe('Liche');
  });

  test('la puissance d\'une salle multiplie la force de son adversaire, bornée', () => {
    const fight = (powerPercent: number, powerReward = false) => {
      const layout = normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'MONSTER', { powerPercent, powerReward }), room(2, 0, 'BOSS')] });
      if (!layout.ok) throw new Error(layout.error);
      const state = createTowerState({ base: STRONG, skills: [], potions: 1, seed: 5, rules: RULES, layout: layout.value });
      return { room: layout.value.rooms[1], foe: applyTowerAction(state, 1, { type: 'door', index: 0 }, RULES, FOES).state.encounter! };
    };
    const normal = fight(100);
    const doubled = fight(200);
    expect(doubled.foe.maxHealth).toBeGreaterThan(normal.foe.maxHealth * 1.9);
    expect(doubled.foe.attack).toBeGreaterThan(normal.foe.attack);
    expect(doubled.foe.speed).toBe(normal.foe.speed);
    expect(fight(999).room.powerPercent).toBe(300);
    // Les récompenses ne suivent que si la salle le demande.
    expect(doubled.foe.bounty).toBe(1);
    expect(fight(200, true).foe.bounty).toBe(2);
    expect(normal.foe.power).toBeUndefined();
  });
});

describe('rendu de la tour', () => {
  const isPng = (buffer: Buffer | null) => buffer !== null && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  test('l\'étage en cours se dessine dans la tour, avec son échelle', async () => {
    const layout = { ...defaultTowerLayout(), name: 'Caserne' };
    const image = await renderTowerImage({
      kind: 'map',
      title: 'Étage 3 · Caserne',
      layout,
      pos: '3-8',
      cleared: ['3-8', '3-7'],
      targets: ['3-6'],
      ladder: [
        { label: 'Étage 5', status: 'next' },
        { label: 'Étage 4', status: 'next' },
        { label: 'Étage 3 · Caserne', status: 'current' },
        { label: 'Étage 2', status: 'done' },
        { label: 'Étage 1', status: 'done' },
      ],
    });
    expect(isPng(image)).toBe(true);
  });

  test('en portes aléatoires, la tour se voit de face, même au premier étage', async () => {
    for (const floor of [1, 10, 250]) {
      const image = await renderTowerImage({ kind: 'shaft', title: 'La Tour', floor, bossEvery: 10, floorLabel: (value) => `Étage ${value}` });
      expect(isPng(image)).toBe(true);
    }
  });
});

describe('profondeur de la Tour', () => {
  function start(base: TowerCoreStats = STRONG): TowerState {
    return createTowerState({ base, skills: [], potions: 1, seed: 4321, rules: RULES });
  }

  test('les étages générés sont valides, reliés et reproductibles', () => {
    for (let seed = 0; seed < 60; seed++) {
      const layout = generateTowerLayout(floorSeed(seed, seed + 1));
      const checked = normalizeTowerLayout(layout);
      expect(checked.ok).toBe(true);
      expect(layout.fog).toBe(true);
      expect(layout.rooms.filter((room) => room.type === 'START')).toHaveLength(1);
      expect(exitRoom(layout)).not.toBeNull();
    }
    expect(generateTowerLayout(42)).toEqual(generateTowerLayout(42));
  });

  test('le brouillard des étages générés se règle', () => {
    expect(towerFloorLayout([], 1, 'GENERATE', 5, false).fog).toBe(false);
    expect(towerFloorLayout([], 1, 'GENERATE', 5).fog).toBe(true);
  });

  test('un étage généré plafonne ses salles de récompense', () => {
    for (let seed = 0; seed < 80; seed++) {
      const rooms = generateTowerLayout(floorSeed(seed, 3)).rooms;
      const count = (type: string) => rooms.filter((room) => room.type === type).length;
      expect(count('SHRINE')).toBeLessThanOrEqual(1);
      expect(count('CHEST')).toBeLessThanOrEqual(2);
      expect(count('MERCHANT')).toBeLessThanOrEqual(1);
      expect(count('CAMPFIRE')).toBeLessThanOrEqual(1);
      // Deux élites au plus, et deux de plus quand elles gardent les clés d'un escalier.
      expect(count('ELITE')).toBeLessThanOrEqual(4);
      expect(rooms.filter((room) => isExitRoom(room.type))).toHaveLength(1);
    }
  });

  test('des champions apparaissent en hauteur, jamais en bas, sans changer la forme de l\'étage', () => {
    const champions = (floor: number) => {
      let count = 0;
      for (let seed = 0; seed < 80; seed++) {
        count += generateTowerLayout(floorSeed(seed, floor), true, floor).rooms.filter((room) => room.powerPercent !== 100).length;
      }
      return count;
    };
    expect(champions(1)).toBe(0);
    expect(champions(30)).toBeGreaterThan(0);
    const low = generateTowerLayout(123, true, 1).rooms.map((room) => `${room.id}:${room.type}`);
    const high = generateTowerLayout(123, true, 30).rooms.map((room) => `${room.id}:${room.type}`);
    expect(high).toEqual(low);
    const champion = generateTowerLayout(123, true, 30).rooms.find((room) => room.powerPercent !== 100);
    if (champion) {
      expect(champion.type).toBe('ELITE');
      expect(champion.powerPercent).toBe(150);
      expect(champion.powerReward).toBe(true);
    }
  });

  test('une ascension sur carte ne monte d\'étage qu\'au gardien', () => {
    const layout = generateTowerLayout(7);
    let step = { state: createTowerState({ base: STRONG, skills: [], potions: 1, seed: 7, rules: RULES, layout }), floor: 1, dead: false };
    // Cinq pas dans des salles non gardiennes : l'étage ne bouge pas.
    for (let i = 0; i < 5; i++) {
      const move = step.state.moves.findIndex((candidate) => !isExitRoom(candidate.type));
      if (step.state.phase !== 'DOORS' || move < 0) break;
      step = applyTowerAction(step.state, step.floor, { type: 'door', index: move }, RULES, FOES);
      for (let turn = 0; turn < 50 && step.state.phase === 'COMBAT'; turn++) {
        step = applyTowerAction(step.state, step.floor, { type: 'attack' }, RULES, FOES);
      }
      if (step.state.phase === 'LOOT') step = applyTowerAction(step.state, step.floor, { type: 'discard' }, RULES, FOES);
      if (step.state.phase === 'MERCHANT') step = applyTowerAction(step.state, step.floor, { type: 'leave_shop' }, RULES, FOES);
      if (step.state.phase === 'EVENT') step = applyTowerAction(step.state, step.floor, { type: 'event', index: 1 }, RULES, FOES);
      if (step.state.phase === 'BLESSING') step = applyTowerAction(step.state, step.floor, { type: 'bless', index: 0 }, RULES, FOES);
    }
    expect(step.floor).toBe(1);
    expect(step.state.floorsCleared).toBe(0);
  });

  test('après les étages dessinés : la boucle ou des étages générés', () => {
    const drawn = [{ ...defaultTowerLayout(), name: 'A' }];
    expect(towerFloorLayout(drawn, 2, 'LOOP', 1)?.name).toBe('A');
    expect(towerFloorLayout(drawn, 2, 'GENERATE', 1)?.name).toBe('');
    // Sans étage dessiné, la Tour génère toujours les siens : un étage finit toujours par son gardien.
    expect(exitRoom(towerFloorLayout([], 1, 'GENERATE', 1))).not.toBeNull();
    expect(exitRoom(towerFloorLayout([], 1, 'LOOP', 1))).not.toBeNull();
  });

  test('le brouillard ne montre que les salles faites, la sienne et leurs voisines', () => {
    const layout = { ...defaultTowerLayout(), fog: true };
    const visible = visibleRooms(layout, '3-8', ['3-8']);
    expect(visible && [...visible].sort()).toEqual(['3-7', '3-8']);
    expect(visibleRooms({ ...layout, fog: false }, '3-8', [])).toBeNull();
  });

  test('un trait se voit avant le combat et change le monstre', () => {
    const plain = start();
    plain.doorInfo = [{ traits: [], mechanic: null, event: null }, ...(plain.doorInfo ?? []).slice(1)];
    const armored = start();
    armored.doorInfo = [{ traits: ['ARMORED'], mechanic: null, event: null }, ...(armored.doorInfo ?? []).slice(1)];
    const a = applyTowerAction(plain, 1, { type: 'door', index: 0 }, RULES, FOES).state.encounter!;
    const b = applyTowerAction(armored, 1, { type: 'door', index: 0 }, RULES, FOES).state.encounter!;
    expect(b.traits).toEqual(['ARMORED']);
    expect(b.defense).toBeGreaterThan(a.defense);
  });

  test('le bouclier d\'un gardien encaisse avant ses PV', () => {
    const fighting = applyTowerAction(start(), 1, { type: 'door', index: 0 }, RULES, FOES).state;
    fighting.encounter!.shield = 1_000_000;
    const health = fighting.encounter!.health;
    const step = applyTowerAction(fighting, 1, { type: 'attack' }, RULES, FOES);
    expect(step.state.encounter?.health).toBe(health);
    expect(step.state.encounter?.log.some((entry) => entry.k === 'shield')).toBe(true);
  });

  test('la relique Dernier rempart évite une fois la mort', () => {
    const fighting = applyTowerAction(start({ ...STRONG, attack: 1, speed: 1, defense: 0 }), 1, { type: 'door', index: 0 }, RULES, FOES).state;
    fighting.gear.relic = {
      slot: 'relic', name: 'Sablier', emoji: '', rarity: 'LEGENDARY',
      attack: 0, defense: 0, speed: 0, maxHealth: 0, critChance: 0, lifesteal: 0, thorns: 0, armorPiercing: 0,
      perk: 'LAST_STAND',
    };
    fighting.hp = 1;
    const step = applyTowerAction(fighting, 1, { type: 'attack' }, RULES, FOES);
    expect(step.dead).toBe(false);
    expect(step.state.hp).toBe(1);
    expect(step.state.encounter?.lastStandUsed).toBe(true);
  });

  test('le parieur double ou divise l\'or, et l\'autel de sang bénit', () => {
    const gambling = start();
    gambling.phase = 'EVENT';
    gambling.event = { id: 'GAMBLER' };
    gambling.gold = 100;
    const bet = applyTowerAction(gambling, 1, { type: 'event', index: 0 }, RULES, FOES);
    expect([50, 150]).toContain(bet.state.gold);
    expect(bet.state.notice).toMatchObject({ k: 'event', id: 'GAMBLER', amount: 50 });

    const altar = start();
    altar.phase = 'EVENT';
    altar.event = { id: 'BLOOD_ALTAR' };
    const offered = applyTowerAction(altar, 1, { type: 'event', index: 0 }, RULES, FOES);
    expect(offered.state.hp).toBe(STRONG.maxHealth - Math.floor(STRONG.maxHealth * 0.2));
    expect(offered.state.phase).toBe('BLESSING');
  });

  test('le forgeron refuse sans pièce à reforger', () => {
    const forge = start();
    forge.phase = 'EVENT';
    forge.event = { id: 'BLACKSMITH' };
    forge.gold = 10_000;
    expect(() => applyTowerAction(forge, 1, { type: 'event', index: 0 }, RULES, FOES)).toThrow(TowerActionRefused);
  });

  test('le profil d\'une créature change sa façon de combattre, pas sa force', () => {
    const golem = towerFoeShape({ health: 700, attack: 10, defense: 30, speed: 5 });
    expect(golem.health * golem.attack * golem.defense).toBeCloseTo(1);
    expect(golem.health).toBeGreaterThan(golem.attack);
    expect(golem.speed).toBeLessThan(1);
  });

  test('l\'ascension du jour a la même graine pour tout le serveur le même jour', () => {
    const day = towerDayKey(new Date('2026-09-28T15:00:00Z'));
    expect(day).toBe('2026-09-28');
    expect(towerDailySeed('123', day)).toBe(towerDailySeed('123', day));
    expect(towerDailySeed('123', day)).not.toBe(towerDailySeed('123', '2026-09-29'));
  });
});

describe('sorties d\'étage', () => {
  const room = (x: number, y: number, type: string, extra: Record<string, unknown> = {}) => ({ x, y, type, ...extra });
  const layoutOf = (rooms: ReturnType<typeof room>[]) => {
    const result = normalizeTowerLayout({ width: 4, height: 4, rooms });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  const begin = (rooms: ReturnType<typeof room>[]) => ({
    state: createTowerState({ base: { ...STRONG, speed: 100 }, skills: [], potions: 1, seed: 11, rules: RULES, layout: layoutOf(rooms) }),
    floor: 1,
    dead: false,
  });
  const go = (step: ReturnType<typeof begin>, type: string) => {
    const index = step.state.moves.findIndex((move) => move.type === type);
    return applyTowerAction(step.state, step.floor, { type: 'door', index }, RULES, FOES);
  };
  const fight = (step: ReturnType<typeof begin>) => {
    for (let turn = 0; turn < 100 && step.state.phase === 'COMBAT'; turn++) {
      step = applyTowerAction(step.state, step.floor, { type: 'attack' }, RULES, FOES);
    }
    if (step.state.phase === 'LOOT') step = applyTowerAction(step.state, step.floor, { type: 'discard' }, RULES, FOES);
    return step;
  };

  test('une carte refuse deux sorties, une clé sans escalier ou un sceau sans portail', () => {
    expect(normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(2, 0, 'BOSS'), room(0, 1, 'STAIRS'), room(1, 1, 'ELITE', { key: true })] }).ok).toBe(false);
    expect(normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(2, 0, 'BOSS'), room(0, 1, 'ELITE', { key: true })] }).ok).toBe(false);
    expect(normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(2, 0, 'BOSS'), room(0, 1, 'SEAL')] }).ok).toBe(false);
    // L'épreuve n'est plus une sortie : seule, elle ne ferme pas l'étage ; elle peut garder une clé.
    expect(normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'TRIAL')] }).ok).toBe(false);
    expect(normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'TRIAL', { key: true }), room(0, 1, 'STAIRS')] }).ok).toBe(true);
    expect(normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'STAIRS')] }).ok).toBe(false);
    expect(normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'GATE')] }).ok).toBe(false);
  });

  test('l\'escalier scellé attend ses clés, puis fait monter', () => {
    let step = begin([room(0, 0, 'START'), room(1, 0, 'ELITE', { key: true }), room(0, 1, 'STAIRS')]);
    const locked = step;
    expect(() => go(locked, 'STAIRS')).toThrow(TowerActionRefused);
    step = fight(go(step, 'ELITE'));
    expect(step.state.notice).toMatchObject({ k: 'victory', lock: { kind: 'key', done: 1, needed: 1 } });
    step = go(step, 'START');
    step = go(step, 'STAIRS');
    expect(step.floor).toBe(2);
    expect(step.state.floorsCleared).toBe(1);
    expect(step.state.notice).toMatchObject({ k: 'exit', exit: 'STAIRS' });
  });

  test('le portail s\'ouvre une fois les sceaux allumés', () => {
    let step = begin([room(0, 0, 'START'), room(1, 0, 'SEAL'), room(0, 1, 'GATE')]);
    const locked = step;
    expect(() => go(locked, 'GATE')).toThrow(TowerActionRefused);
    step = fight(go(step, 'SEAL'));
    expect(step.state.notice).toMatchObject({ k: 'victory', lock: { kind: 'seal', done: 1, needed: 1 } });
    step = go(go(step, 'START'), 'GATE');
    expect(step.floor).toBe(2);
  });

  test('l\'escalier ouvert fait monter sans clé, sceau ni gardien', () => {
    expect(normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'EXIT'), room(0, 1, 'ELITE', { key: true })] }).ok).toBe(false);
    const step = go(begin([room(0, 0, 'START'), room(1, 0, 'EXIT')]), 'EXIT');
    expect(step.floor).toBe(2);
    expect(step.state.notice).toMatchObject({ k: 'exit', exit: 'EXIT' });
  });

  // Une épreuve au bout d'un embranchement, le gardien plus loin.
  const WITH_TRIAL = (extra: Record<string, unknown> = {}) => [room(0, 0, 'START'), room(1, 0, 'TRIAL', extra), room(0, 1, 'EMPTY'), room(0, 2, 'BOSS')];

  test('l\'épreuve enchaîne ses vagues sans fuite, puis la salle est résolue sans monter', () => {
    let step = go(begin(WITH_TRIAL()), 'TRIAL');
    expect(step.state.trial).toMatchObject({ wave: 1, waves: 3, reward: true });
    const fighting = step;
    expect(() => applyTowerAction(fighting.state, fighting.floor, { type: 'flee' }, RULES, FOES)).toThrow(TowerActionRefused);
    step = fight(step);
    expect(step.floor).toBe(1);
    expect(step.state.kills).toBe(3);
    expect(step.state.trial).toBeNull();
    expect(step.state.map?.cleared).toContain('1-0');
  });

  test('une épreuve règle ses vagues, sa puissance et sa récompense', () => {
    let step = go(begin(WITH_TRIAL({ waves: 2, powerPercent: 150, trialReward: false })), 'TRIAL');
    expect(step.state.trial).toMatchObject({ wave: 1, waves: 2, power: 1.5, reward: false });
    expect(step.state.encounter?.power).toBe(1.5);
    step = fight(step);
    expect(step.floor).toBe(1);
    expect(step.state.kills).toBe(2);
  });

  test('une épreuve peut garder une clé de l\'escalier', () => {
    let step = go(begin([room(0, 0, 'START'), room(1, 0, 'TRIAL', { key: true, waves: 2, trialReward: false }), room(0, 1, 'STAIRS')]), 'TRIAL');
    step = fight(step);
    expect(step.state.notice).toMatchObject({ k: 'victory', lock: { kind: 'key', done: 1, needed: 1 } });
    step = go(go(step, 'START'), 'STAIRS');
    expect(step.floor).toBe(2);
  });

  test('une partie commencée quand l\'épreuve était une sortie monte encore en la réussissant', () => {
    const layout = { name: '', width: 4, height: 4, fog: false, modifier: 'NONE' as const, rooms: [newTowerRoom(0, 0, 'START'), newTowerRoom(1, 0, 'TRIAL')] };
    let step = { state: createTowerState({ base: { ...STRONG, speed: 100 }, skills: [], potions: 1, seed: 11, rules: RULES, layout }), floor: 1, dead: false };
    step = fight(go(step, 'TRIAL'));
    expect(step.floor).toBe(2);
  });
});

describe('portails A et B', () => {
  const room = (x: number, y: number, type: string) => ({ x, y, type });
  // Le gardien n'est joignable que par les portails.
  const LINKED = { width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'WARP_A'), room(3, 3, 'WARP_B'), room(2, 1, 'BOSS')] };

  test('un portail va par paire, et une seule paire par étage', () => {
    expect(normalizeTowerLayout({ ...LINKED, rooms: LINKED.rooms.filter((entry) => entry.type !== 'WARP_B') }).ok).toBe(false);
    expect(normalizeTowerLayout({ ...LINKED, rooms: [...LINKED.rooms, room(0, 1, 'WARP_A')] }).ok).toBe(false);
  });

  test('les portails relient deux coins de l\'étage, et la carte reste valide', () => {
    const layout = normalizeTowerLayout(LINKED);
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    let step = { state: createTowerState({ base: STRONG, skills: [], potions: 1, seed: 3, rules: RULES, layout: layout.value }), floor: 1, dead: false };
    step = applyTowerAction(step.state, step.floor, { type: 'door', index: step.state.moves.findIndex((move) => move.type === 'WARP_A') }, RULES, FOES);
    const warp = step.state.moves.find((move) => move.type === 'WARP_B');
    expect(warp?.direction).toBe('WARP');
    step = applyTowerAction(step.state, step.floor, { type: 'door', index: step.state.moves.indexOf(warp!) }, RULES, FOES);
    expect(step.state.map?.pos).toBe('3-3');
    expect(step.state.moves.some((move) => move.type === 'BOSS')).toBe(true);
  });
});

describe('mimiques, mercenaires, pièges et ambiances', () => {
  const room = (x: number, y: number, type: string) => ({ x, y, type });
  const make = (middle: string, modifier = 'NONE') => {
    const layout = normalizeTowerLayout({ width: 4, height: 4, modifier, rooms: [room(0, 0, 'START'), room(1, 0, middle), room(2, 0, 'BOSS')] });
    if (!layout.ok) throw new Error(layout.error);
    return createTowerState({ base: { ...STRONG, speed: 1 }, skills: [], potions: 1, seed: 21, rules: RULES, layout: layout.value });
  };
  const enter = (state: TowerState, type: string) =>
    applyTowerAction(state, 1, { type: 'door', index: state.moves.findIndex((move) => move.type === type) }, RULES, FOES);

  test('une ambiance inconnue retombe sur aucune', () => {
    const flooded = normalizeTowerLayout({ width: 4, height: 4, modifier: 'FLOODED', rooms: [room(0, 0, 'START'), room(1, 0, 'BOSS')] });
    const unknown = normalizeTowerLayout({ width: 4, height: 4, modifier: 'LAVA', rooms: [room(0, 0, 'START'), room(1, 0, 'BOSS')] });
    expect(flooded.ok && flooded.value.modifier).toBe('FLOODED');
    expect(unknown.ok && unknown.value.modifier).toBe('NONE');
  });

  test('un piège blesse sans jamais achever, ou s\'évite', () => {
    const state = make('TRAP');
    state.hp = 1;
    const step = enter(state, 'TRAP');
    expect(step.state.hp).toBe(1);
    expect(step.state.notice).toMatchObject({ k: 'trap' });
    expect(step.state.map?.cleared).toContain('1-0');
  });

  test('une mimique se révèle à l\'ouverture et garantit son butin', () => {
    let step = enter(make('MIMIC'), 'MIMIC');
    expect(step.state.encounter).toMatchObject({ name: 'Mimique', mimic: true, kind: 'ELITE' });
    for (let turn = 0; turn < 50 && step.state.phase === 'COMBAT'; turn++) {
      step = applyTowerAction(step.state, step.floor, { type: 'attack' }, RULES, FOES);
    }
    expect(step.state.phase).toBe('LOOT');
  });

  test('un mercenaire engagé frappe à chaque tour', () => {
    const state = make('MERCENARY');
    state.gold = 1000;
    let step = enter(state, 'MERCENARY');
    expect(step.state.phase).toBe('MERCENARY');
    step = applyTowerAction(step.state, step.floor, { type: 'hire' }, RULES, FOES);
    expect(step.state.ally).toBe(true);
    expect(step.state.gold).toBeLessThan(1000);
    step = applyTowerAction(step.state, step.floor, { type: 'door', index: step.state.moves.findIndex((move) => move.type === 'BOSS') }, RULES, FOES);
    step = applyTowerAction(step.state, step.floor, { type: 'defend' }, RULES, FOES);
    expect(step.state.encounter?.log.some((entry) => entry.k === 'ally')).toBe(true);
  });

  test('un étage en feu brûle chaque nouvelle salle, un étage béni soigne mieux', () => {
    const burning = enter(make('CHEST', 'BURNING'), 'CHEST');
    expect(burning.state.burned).toBe(Math.floor(STRONG.maxHealth * 0.03));

    const blessed = make('CHEST', 'BLESSED');
    blessed.hp = 1000;
    const potion = applyTowerAction(blessed, 1, { type: 'potion' }, RULES, FOES);
    expect(potion.state.hp).toBe(1000 + Math.floor(STRONG.maxHealth * 0.35 * 1.25));
  });
});

describe('achats, chaleur, mentor et combat automatique', () => {
  const room = (x: number, y: number, type: string, extra: Record<string, unknown> = {}) => ({ x, y, type, ...extra });
  const SKILL = { id: 'bolt', name: 'Éclair', emoji: '', cooldownTurns: 3, effect: { damageMultiplier: 1.5 }, tier: 1 };
  const start = (rooms: ReturnType<typeof room>[], extra: { gold?: number; heat?: ('FEROCIOUS' | 'FAMINE' | 'GREED' | 'DRY')[]; skillPool?: typeof SKILL[] } = {}) => {
    const layout = normalizeTowerLayout({ width: 4, height: 4, rooms });
    if (!layout.ok) throw new Error(layout.error);
    return createTowerState({ base: { ...STRONG, speed: 100 }, skills: [], potions: 2, seed: 7, rules: RULES, layout: layout.value, ...extra });
  };
  const move = (state: ReturnType<typeof start>, type: string) =>
    applyTowerAction(state, 1, { type: 'door', index: state.moves.findIndex((candidate) => candidate.type === type) }, RULES, FOES);

  test('une compétence coûte plus cher au bout de l\'arbre', () => {
    expect(towerSkillTier({ id: 'mag_hemorrhage', levelRequired: 23 })).toBe(4);
    expect(towerSkillTier({ id: 'fireball', levelRequired: 5 })).toBe(1);
    expect(towerSkillTier({ id: 'second', levelRequired: 12 })).toBe(2);
    expect(towerSkillPrice(10, { ...SKILL, tier: 4 })).toBe(30);
    expect(towerSkillPrice(10, { ...SKILL, tier: 1 })).toBe(10);
  });

  test('la sécheresse fait partir sans potion', () => {
    expect(start([room(0, 0, 'START'), room(1, 0, 'BOSS')], { heat: ['DRY'] }).potions).toBe(0);
  });

  test('le combat automatique vainc un monstre ordinaire, jamais une élite', () => {
    const fighting = move(start([room(0, 0, 'START'), room(1, 0, 'MONSTER'), room(0, 1, 'ELITE'), room(2, 2, 'BOSS'), room(1, 1, 'EMPTY'), room(1, 2, 'EMPTY')]), 'MONSTER');
    const done = applyTowerAction(fighting.state, 1, { type: 'auto' }, RULES, FOES);
    expect(done.state.phase).not.toBe('COMBAT');
    const elite = move(start([room(0, 0, 'START'), room(0, 1, 'ELITE'), room(1, 0, 'EMPTY'), room(2, 0, 'BOSS')]), 'ELITE');
    expect(() => applyTowerAction(elite.state, 1, { type: 'auto' }, RULES, FOES)).toThrow(TowerActionRefused);
  });

  test('le mentor enseigne contre de l\'or une compétence laissée au départ', () => {
    const state = start([room(0, 0, 'START'), room(1, 0, 'MENTOR'), room(0, 1, 'EMPTY'), room(0, 2, 'BOSS')], { gold: 500, skillPool: [SKILL] });
    const visit = move(state, 'MENTOR');
    expect(visit.state.phase).toBe('MENTOR');
    const learned = applyTowerAction(visit.state, 1, { type: 'learn', index: 0 }, RULES, FOES);
    expect(learned.state.skills.map((skill) => skill.id)).toEqual(['bolt']);
    expect(learned.state.skillPool).toEqual([]);
    expect(learned.state.gold).toBeLessThan(500);
  });

  test('un fantôme laisse son équipement au premier qui remporte la salle', () => {
    const state = start([room(0, 0, 'START'), room(1, 0, 'MONSTER'), room(0, 1, 'EMPTY'), room(0, 2, 'BOSS')]);
    const gear = { slot: 'weapon' as const, name: 'Lame du disparu', emoji: '', rarity: 'EPIC' as const, attack: 40, defense: 0, speed: 0, maxHealth: 0, critChance: 0, lifesteal: 0, thorns: 0, armorPiercing: 0 };
    state.map!.ghosts = [{ roomId: '1-0', userId: '42', runId: 'run-1', gear }];
    let step = move(state, 'MONSTER');
    for (let turn = 0; turn < 50 && step.state.phase === 'COMBAT'; turn++) step = applyTowerAction(step.state, 1, { type: 'attack' }, RULES, FOES);
    expect(step.state.pendingLoot?.name).toBe('Lame du disparu');
    // Ramenée à la profondeur de celui qui la trouve : même rareté, stats de ce niveau.
    expect(step.state.pendingLoot?.rarity).toBe('EPIC');
    expect(step.state.pendingLoot?.attack).toBeLessThan(40);
    expect(step.state.ghostTaken).toBe('run-1');
    expect(step.state.map?.ghosts).toEqual([]);
    expect(step.state.notice).toMatchObject({ k: 'victory', ghost: '42' });
  });

  test('une seule sorte d\'entrée par étage, en nombre permis', () => {
    const ok = (rooms: ReturnType<typeof room>[]) => normalizeTowerLayout({ width: 4, height: 4, rooms }).ok;
    expect(ok([room(0, 0, 'WELL'), room(1, 0, 'WELL'), room(2, 0, 'EXIT')])).toBe(true);
    expect(ok([room(0, 0, 'WELL'), room(1, 0, 'EXIT')])).toBe(false);
    expect(ok([room(0, 0, 'START'), room(1, 0, 'WELL'), room(2, 0, 'WELL'), room(3, 0, 'EXIT')])).toBe(false);
    expect(ok([room(0, 0, 'ENTRANCE'), room(1, 0, 'ENTRANCE'), room(2, 0, 'EXIT')])).toBe(true);
  });

  test('on tombe dans l\'un des puits', () => {
    const state = start([room(0, 0, 'WELL'), room(1, 0, 'EMPTY'), room(2, 0, 'WELL'), room(3, 0, 'EXIT')]);
    expect(['0-0', '2-0']).toContain(state.map!.pos);
    expect(state.map!.cleared).toEqual([state.map!.pos]);
  });

  test('devant les entrées au choix, le joueur choisit avant d\'entrer', () => {
    const state = start([room(0, 0, 'ENTRANCE'), room(1, 0, 'EMPTY'), room(2, 0, 'ENTRANCE'), room(3, 0, 'EXIT')]);
    expect(state.phase).toBe('ENTRY');
    expect(state.map!.cleared).toEqual([]);
    const chosen = applyTowerAction(state, 1, { type: 'door', index: 1 }, RULES, FOES);
    expect(chosen.state.phase).toBe('DOORS');
    expect(chosen.state.map!.pos).toBe('2-0');
    expect(chosen.state.moves.some((candidate) => candidate.type === 'EXIT')).toBe(true);
  });

  test('une embuscade frappe avant le combat, sans achever', () => {
    const step = move(start([room(0, 0, 'START'), room(1, 0, 'AMBUSH'), room(2, 0, 'EXIT')]), 'AMBUSH');
    expect(step.state.phase).toBe('COMBAT');
    expect(step.state.notice).toMatchObject({ k: 'ambush' });
    expect(step.state.hp).toBeLessThan(STRONG.maxHealth);
  });

  test('l\'escalier fragile fait monter à temps, puis cède la place à un gardien', () => {
    const rooms = [room(0, 0, 'START'), room(1, 0, 'EMPTY'), room(0, 1, 'COLLAPSE', { collapseSteps: 3 })];
    expect(move(start(rooms), 'COLLAPSE').floor).toBe(2);
    let state = start(rooms);
    for (let index = 0; index < 4; index++) state = move(move(state, 'EMPTY').state, 'START').state;
    const late = move(state, 'COLLAPSE');
    expect(late.floor).toBe(1);
    expect(late.state.encounter?.kind).toBe('BOSS');
    expect(late.state.notice).toMatchObject({ k: 'collapsed' });
  });

  test('le péage se paie, ou se force contre une élite', () => {
    const rooms = [room(0, 0, 'START'), room(1, 0, 'TOLL', { tollGold: 50 })];
    const rich = move(start(rooms, { gold: 80 }), 'TOLL');
    expect(rich.state.phase).toBe('TOLL');
    const paid = applyTowerAction(rich.state, 1, { type: 'pay' }, RULES, FOES);
    expect(paid.floor).toBe(2);
    expect(paid.state.gold).toBe(30);
    const poor = move(start(rooms), 'TOLL');
    expect(() => applyTowerAction(poor.state, 1, { type: 'pay' }, RULES, FOES)).toThrow(TowerActionRefused);
    let forced = applyTowerAction(poor.state, 1, { type: 'force' }, RULES, FOES);
    expect(forced.state.encounter?.opensExit).toBe(true);
    for (let turn = 0; turn < 60 && forced.state.phase === 'COMBAT'; turn++) forced = applyTowerAction(forced.state, 1, { type: 'attack' }, RULES, FOES);
    expect(forced.floor).toBe(2);
  });

  test('la source commune soigne en puisant dans la réserve, et reçoit l\'or versé', () => {
    const rooms = [room(0, 0, 'START'), room(1, 0, 'FOUNTAIN'), room(2, 0, 'EXIT')];
    const hurt = start(rooms, { gold: 100 });
    hurt.hp = 10;
    const visit = move(hurt, 'FOUNTAIN');
    expect(visit.state.phase).toBe('FOUNTAIN');
    expect(() => applyTowerAction({ ...visit.state, fountainPool: 0 }, 1, { type: 'drink' }, RULES, FOES)).toThrow(TowerActionRefused);
    const drank = applyTowerAction({ ...visit.state, fountainPool: 500 }, 1, { type: 'drink' }, RULES, FOES);
    expect(drank.state.hp).toBeGreaterThan(10);
    expect(drank.state.fountainDelta).toBeLessThan(0);
    const gave = applyTowerAction(visit.state, 1, { type: 'donate' }, RULES, FOES);
    expect(gave.state.fountainDelta).toBeGreaterThan(0);
    expect(gave.state.gold).toBeLessThan(100);
  });

  const win = (step: ReturnType<typeof applyTowerAction>) => {
    for (let turn = 0; turn < 60 && step.state.phase === 'COMBAT'; turn++) step = applyTowerAction(step.state, step.floor, { type: 'attack' }, RULES, FOES);
    return step;
  };

  test('battre le geôlier libère le captif, qui rend ce qu\'on attend de lui', () => {
    const fight = move(start([room(0, 0, 'START'), room(1, 0, 'PRISONER', { captive: 'POTION' }), room(2, 0, 'EXIT')]), 'PRISONER');
    expect(fight.state.encounter?.captive).toBe('POTION');
    const done = win(fight);
    expect(done.state.notice).toMatchObject({ k: 'victory', captive: { kind: 'POTION' } });
    expect(done.state.potions).toBe(3);
  });

  test('l\'oracle lève le brouillard, ou montre le chemin sans brouillard', () => {
    const rooms = [room(0, 0, 'START'), room(1, 0, 'ORACLE'), room(2, 0, 'EMPTY'), room(3, 0, 'EXIT')];
    const plain = move(start(rooms, { gold: 200 }), 'ORACLE');
    expect(plain.state.phase).toBe('ORACLE');
    const shown = applyTowerAction(plain.state, 1, { type: 'reveal' }, RULES, FOES);
    expect(shown.state.map?.oraclePath).toEqual(['2-0', '3-0']);
    expect(shown.state.gold).toBeLessThan(200);
    const layout = normalizeTowerLayout({ width: 4, height: 4, fog: true, rooms });
    if (!layout.ok) throw new Error(layout.error);
    const foggy = createTowerState({ base: STRONG, skills: [], potions: 1, seed: 3, rules: RULES, layout: layout.value, gold: 200 });
    const revealed = applyTowerAction(move(foggy, 'ORACLE').state, 1, { type: 'reveal' }, RULES, FOES);
    expect(revealed.state.map?.revealed).toBe(true);
  });

  test('un monstre errant attaque qui entre dans sa salle, et quitte l\'étage une fois vaincu', () => {
    const state = start([room(0, 0, 'START'), room(1, 0, 'EMPTY'), room(2, 0, 'WANDERER', { wanderRadius: 1 }), room(3, 0, 'EMPTY'), room(3, 1, 'EXIT')]);
    expect(state.map?.wanderers).toEqual([{ spawn: '2-0', pos: '2-0', radius: 1 }]);
    state.map!.wanderers![0].pos = '1-0';
    const caught = move(state, 'EMPTY');
    expect(caught.state.encounter?.wanderer).toBe('2-0');
    expect(caught.state.notice).toMatchObject({ k: 'wanderer' });
    const done = win(caught);
    expect(done.state.map?.wanderers).toEqual([]);
  });

  test('un monstre errant ne quitte jamais sa zone ni ses cases permises', () => {
    let state = start([room(0, 0, 'START'), room(1, 0, 'EMPTY'), room(2, 0, 'WANDERER', { wanderRadius: 1 }), room(3, 0, 'EMPTY'), room(3, 1, 'CHEST'), room(3, 2, 'EXIT')]);
    for (let index = 0; index < 20; index++) {
      const step = move(state, index % 2 === 0 ? 'EMPTY' : 'START');
      if (step.state.phase !== 'DOORS') break;
      expect(['1-0', '2-0', '3-0']).toContain(step.state.map!.wanderers![0].pos);
      state = step.state;
    }
  });

  test('les éclats par salle récompensent l\'exploration, en plus de ceux de l\'étage', () => {
    const rules = { ...RULES, shardsPerRoom: 3 };
    const layout = normalizeTowerLayout({ width: 4, height: 4, rooms: [room(0, 0, 'START'), room(1, 0, 'CHEST'), room(2, 0, 'EMPTY'), room(3, 0, 'EXIT')] });
    if (!layout.ok) throw new Error(layout.error);
    let state = createTowerState({ base: STRONG, skills: [], potions: 1, seed: 5, rules, layout: layout.value });
    const go = (type: string) => applyTowerAction(state, 1, { type: 'door', index: state.moves.findIndex((candidate) => candidate.type === type) }, rules, FOES);
    state = go('CHEST').state;
    if (state.phase === 'LOOT') state = applyTowerAction(state, 1, { type: 'discard' }, rules, FOES).state;
    expect(state.shards).toBe(3);
    // Un couloir ne se résout pas : il ne rapporte rien.
    state = go('EMPTY').state;
    expect(state.shards).toBe(3);
  });

  test('le simulateur joue des ascensions complètes sans planter', async () => {
    const result = await simulateTowerRuns({
      base: STRONG, skills: [], potions: 2, rules: RULES, foes: FOES, floors: [], floorsAfter: 'GENERATE',
      generatedFog: true, heat: [], deathShardPercent: 50, runs: 3, seed: 42,
    });
    expect(result.runs).toBe(3);
    expect(result.averageFloor).toBeGreaterThanOrEqual(0);
  });
});
