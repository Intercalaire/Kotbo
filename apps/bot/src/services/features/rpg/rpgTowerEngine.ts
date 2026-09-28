/**
 * Moteur d'une ascension de la Tour : une machine à états pure.
 *
 * Chaque clic est une action appliquée à l'état stocké avec la partie, qui renvoie l'état
 * suivant. Aucun accès base, aucun collecteur : la partie survit à un redémarrage du bot,
 * et le service n'a qu'à écrire le résultat sous condition de version.
 */

import { computeAttack } from './rpgCombatMath.js';
import {
  BOSS_VICTORY_HEAL,
  CAMPFIRE_HEAL,
  EMPTY_GEAR,
  FALLBACK_BOSSES,
  FALLBACK_MONSTERS,
  LOOT_CHANCE,
  MAX_POTIONS,
  MERCHANT_HEAL,
  POTION_HEAL,
  TOWER_MONSTER_CRIT,
  TowerRng,
  effectiveCooldown,
  encounterGold,
  findBlessing,
  floorShards,
  isBossFloor,
  rollBlessingChoices,
  rollDoors,
  rollMerchantOffers,
  rollTowerGear,
  scrapValue,
  towerEffectiveStats,
  towerMonsterStats,
  treasureGold,
  type TowerCoreStats,
  type TowerDoor,
  type TowerEffectiveStats,
  type TowerEncounterKind,
  type TowerFoeName,
  type TowerGear,
  type TowerGearSet,
  type TowerOffer,
  type TowerSkill,
} from './rpgTowerPolicy.js';
import {
  roomNeighbors,
  startRoom,
  type TowerDirection,
  type TowerLayout,
  type TowerRoomType,
} from './rpgTowerMap.js';

export type TowerPhase = 'DOORS' | 'COMBAT' | 'LOOT' | 'BLESSING' | 'MERCHANT';

export type TowerLogEntry =
  | { k: 'attack'; dmg: number; crit: boolean }
  | { k: 'skill'; name: string; emoji: string; dmg: number; crit: boolean }
  | { k: 'support'; name: string; emoji: string }
  | { k: 'defend' }
  | { k: 'potion'; hp: number }
  | { k: 'heal'; hp: number }
  | { k: 'monster'; dmg: number; crit: boolean }
  | { k: 'evaded' }
  | { k: 'thorns'; dmg: number };

export type TowerEncounter = {
  kind: TowerEncounterKind;
  name: string;
  emoji: string;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  /** Tours restants avant que chaque compétence redevienne disponible. */
  cooldowns: Record<string, number>;
  defenseMultiplier: number;
  evade: boolean;
  log: TowerLogEntry[];
};

/** Ce qui s'est passé à la dernière action, affiché en tête de l'écran suivant. */
export type TowerNotice =
  /** `section` : numéro de la nouvelle section quand un boss de carte vient de tomber. */
  | { k: 'victory'; name: string; emoji: string; gold: number; healed: number; section: number | null }
  | { k: 'treasure'; gold: number }
  | { k: 'campfire'; hp: number }
  | { k: 'potion'; hp: number }
  | { k: 'equipped'; name: string; emoji: string }
  | { k: 'scrapped'; gold: number }
  | { k: 'blessed'; id: string; rank: number }
  | { k: 'bought'; kind: TowerOffer['kind'] };

/** Position sur une carte dessinée. La carte est copiée à l'entrée : la modifier ne touche pas aux parties lancées. */
export type TowerMapState = {
  layout: TowerLayout;
  section: number;
  /** Salle où se trouve le joueur. */
  pos: string;
  /** Salles déjà résolues dans la section en cours ; les retraverser ne coûte rien. */
  cleared: string[];
};

/** Salle voisine proposée au joueur. */
export type TowerMove = { roomId: string; type: TowerRoomType; direction: TowerDirection; cleared: boolean };

export type TowerState = {
  v: 1;
  rng: number;
  base: TowerCoreStats;
  hp: number;
  gold: number;
  potions: number;
  gear: TowerGearSet;
  blessings: Record<string, number>;
  skills: TowerSkill[];
  phase: TowerPhase;
  doors: TowerDoor[];
  encounter: TowerEncounter | null;
  pendingLoot: TowerGear | null;
  blessingDue: boolean;
  blessingChoices: string[];
  merchant: TowerOffer[];
  shards: number;
  floorsCleared: number;
  kills: number;
  notice: TowerNotice | null;
  /** Carte dessinée, `null` en mode aléatoire. */
  map: TowerMapState | null;
  moves: TowerMove[];
};

export type TowerRules = {
  floorGrowthPercent: number;
  bossEvery: number;
  blessingEvery: number;
  maxBlessings: number;
  shardsPerFloor: number;
};

export type TowerFoePool = {
  monsters: TowerFoeName[];
  bosses: TowerFoeName[];
  /** Tout le bestiaire par nom, désactivés compris, pour les salles qui imposent leur créature. */
  byName: Record<string, TowerFoeName>;
};

export type TowerAction =
  | { type: 'door'; index: number }
  | { type: 'attack' }
  | { type: 'defend' }
  | { type: 'skill'; id: string }
  | { type: 'potion' }
  | { type: 'equip' }
  | { type: 'discard' }
  | { type: 'bless'; index: number }
  | { type: 'buy'; index: number }
  | { type: 'leave_shop' };

export type TowerActionError =
  | 'wrong_phase'
  | 'bad_choice'
  | 'skill_cooldown'
  | 'no_potion'
  | 'hp_full'
  | 'no_gold'
  | 'sold_out'
  | 'potions_full';

export class TowerActionRefused extends Error {
  constructor(readonly reason: TowerActionError) {
    super(`Action de Tour refusée : ${reason}`);
    this.name = 'TowerActionRefused';
  }
}

export type TowerStepResult = { state: TowerState; floor: number; dead: boolean };

const LOG_KEPT = 6;

export function towerStats(state: TowerState): TowerEffectiveStats {
  return towerEffectiveStats(state.base, state.gear, state.blessings);
}

function clone(state: TowerState): TowerState {
  return structuredClone(state);
}

/** Applique un changement de PV max en gardant les PV cohérents : un gain de PV max soigne d'autant. */
function withMaxHealthChange(state: TowerState, change: () => void): void {
  const before = towerStats(state).maxHealth;
  change();
  const after = towerStats(state).maxHealth;
  state.hp = Math.max(1, Math.min(after, state.hp + Math.max(0, after - before)));
}

function heal(state: TowerState, share: number): number {
  const max = towerStats(state).maxHealth;
  const before = state.hp;
  state.hp = Math.min(max, state.hp + Math.floor(max * share));
  return state.hp - before;
}

export function createTowerState(input: {
  base: TowerCoreStats;
  skills: TowerSkill[];
  potions: number;
  seed: number;
  rules: TowerRules;
  layout?: TowerLayout | null;
}): TowerState {
  const rng = new TowerRng(input.seed);
  const start = input.layout ? startRoom(input.layout) : null;
  const map: TowerMapState | null = input.layout && start
    ? { layout: structuredClone(input.layout), section: 1, pos: start.id, cleared: [start.id] }
    : null;
  const doors = map ? [] : rollDoors(1, input.rules.bossEvery, rng);
  const state: TowerState = {
    v: 1,
    rng: rng.state,
    base: input.base,
    hp: input.base.maxHealth,
    gold: 0,
    potions: Math.min(MAX_POTIONS, input.potions),
    gear: { ...EMPTY_GEAR },
    blessings: {},
    skills: input.skills,
    phase: 'DOORS',
    doors,
    encounter: null,
    pendingLoot: null,
    blessingDue: false,
    blessingChoices: [],
    merchant: [],
    shards: 0,
    floorsCleared: 0,
    kills: 0,
    notice: null,
    map,
    moves: [],
  };
  if (map) state.moves = computeMoves(state);
  return state;
}

function computeMoves(state: TowerState): TowerMove[] {
  const map = state.map;
  if (!map) return [];
  return roomNeighbors(map.layout, map.pos).map(({ room, direction }) => ({
    roomId: room.id,
    type: room.type,
    direction,
    cleared: map.cleared.includes(room.id),
  }));
}

function markRoomCleared(state: TowerState): void {
  const map = state.map;
  if (map && !map.cleared.includes(map.pos)) map.cleared.push(map.pos);
}

/** Boss de carte abattu : la section suivante recommence au départ, avec toutes ses salles. */
function completeSection(state: TowerState): number | null {
  const map = state.map;
  const start = map ? startRoom(map.layout) : null;
  if (!map || !start) return null;
  map.section += 1;
  map.pos = start.id;
  map.cleared = [start.id];
  return map.section;
}

/** Un étage de boss en mode aléatoire, une salle de boss sur une carte. */
function isBossStep(state: TowerState, floor: number, rules: TowerRules, kind?: TowerEncounterKind): boolean {
  return state.map ? kind === 'BOSS' : isBossFloor(floor, rules.bossEvery);
}

/** Écran suivant, par ordre de priorité : butin, marchand encore ouvert, bénédiction, portes. */
function advance(state: TowerState, floor: number, rules: TowerRules, rng: TowerRng): void {
  state.encounter = null;
  if (state.pendingLoot) {
    state.phase = 'LOOT';
    return;
  }
  if (state.merchant.length > 0) {
    state.phase = 'MERCHANT';
    return;
  }
  if (state.blessingDue) {
    const choices = rollBlessingChoices(state.blessings, rules.maxBlessings, rng);
    if (choices.length > 0) {
      state.phase = 'BLESSING';
      state.blessingChoices = choices;
      return;
    }
    state.blessingDue = false;
  }
  state.phase = 'DOORS';
  if (state.map) {
    state.doors = [];
    state.moves = computeMoves(state);
  } else {
    state.doors = rollDoors(floor, rules.bossEvery, rng);
    state.moves = [];
  }
}

/**
 * Étage franchi : éclats et compteur. En mode aléatoire, une bénédiction tombe sur les étages
 * ronds ; sur une carte, ce sont les autels qui en donnent.
 */
function clearFloor(state: TowerState, floor: number, rules: TowerRules, boss: boolean): number {
  state.shards += floorShards(floor, rules.shardsPerFloor, boss);
  state.floorsCleared += 1;
  if (!state.map && rules.blessingEvery > 0 && floor % rules.blessingEvery === 0) state.blessingDue = true;
  return floor + 1;
}

function startEncounter(
  state: TowerState,
  floor: number,
  kind: TowerEncounterKind,
  rules: TowerRules,
  foes: TowerFoePool,
  rng: TowerRng,
  imposed: string | null = null,
): void {
  const pool = kind === 'BOSS'
    ? (foes.bosses.length > 0 ? foes.bosses : FALLBACK_BOSSES)
    : (foes.monsters.length > 0 ? foes.monsters : FALLBACK_MONSTERS);
  // Une créature imposée retirée du bestiaire depuis retombe sur le tirage habituel.
  const foe = (imposed ? foes.byName?.[imposed] : undefined) ?? rng.pick(pool);
  const stats = towerMonsterStats(floor, rules.floorGrowthPercent, kind);
  state.encounter = {
    kind,
    name: foe.name,
    emoji: foe.emoji,
    health: stats.health,
    maxHealth: stats.health,
    attack: stats.attack,
    defense: stats.defense,
    speed: stats.speed,
    cooldowns: Object.fromEntries(state.skills.map((skill) => [skill.id, 0])),
    defenseMultiplier: 1,
    evade: false,
    log: [],
  };
  state.phase = 'COMBAT';
}

function monsterStrike(state: TowerState, encounter: TowerEncounter, stats: TowerEffectiveStats, rng: TowerRng, log: TowerLogEntry[]): void {
  if (encounter.evade) {
    encounter.evade = false;
    log.push({ k: 'evaded' });
    return;
  }
  const hit = computeAttack({
    attack: encounter.attack,
    targetDefense: stats.defense,
    speed: encounter.speed,
    critChance: TOWER_MONSTER_CRIT,
    targetDefenseMultiplier: encounter.defenseMultiplier,
    targetDamageReduction: stats.damageReduction,
    targetThorns: stats.thorns,
    random: () => rng.next(),
  });
  state.hp = Math.max(0, state.hp - hit.damage);
  log.push({ k: 'monster', dmg: hit.damage, crit: hit.critical });
  if (hit.reflected > 0) {
    encounter.health = Math.max(0, encounter.health - hit.reflected);
    log.push({ k: 'thorns', dmg: hit.reflected });
  }
}

function playerStrike(state: TowerState, encounter: TowerEncounter, stats: TowerEffectiveStats, skill: TowerSkill | null, rng: TowerRng): { dmg: number; crit: boolean } {
  const hit = computeAttack({
    attack: stats.attack,
    targetDefense: encounter.defense,
    speed: stats.speed,
    critChance: stats.critChance,
    armorPiercing: Math.max(stats.armorPiercing, skill?.effect.armorPiercing ?? 0),
    skillMultiplier: skill?.effect.damageMultiplier ?? 1,
    lifesteal: stats.lifesteal + (skill?.effect.lifesteal ?? 0),
    random: () => rng.next(),
  });
  encounter.health = Math.max(0, encounter.health - hit.damage);
  if (hit.healed > 0) state.hp = Math.min(stats.maxHealth, state.hp + hit.healed);
  return { dmg: hit.damage, crit: hit.critical };
}

function winEncounter(state: TowerState, floor: number, rules: TowerRules, rng: TowerRng): number {
  const encounter = state.encounter!;
  const stats = towerStats(state);
  const gold = encounterGold(floor, encounter.kind, stats.goldPercent, rng);
  state.gold += gold;
  state.kills += 1;
  if (rng.next() < LOOT_CHANCE[encounter.kind]) state.pendingLoot = rollTowerGear(floor, encounter.kind, rng);

  let healed = heal(state, stats.healAfterCombat);
  if (encounter.kind === 'BOSS') healed += heal(state, BOSS_VICTORY_HEAL);

  const next = clearFloor(state, floor, rules, isBossStep(state, floor, rules, encounter.kind));
  markRoomCleared(state);
  const section = state.map && encounter.kind === 'BOSS' ? completeSection(state) : null;
  state.notice = { k: 'victory', name: encounter.name, emoji: encounter.emoji, gold, healed, section };
  advance(state, next, rules, rng);
  return next;
}

function combatTurn(state: TowerState, floor: number, action: TowerAction, rules: TowerRules, rng: TowerRng): TowerStepResult {
  const encounter = state.encounter;
  if (!encounter) throw new TowerActionRefused('wrong_phase');
  const stats = towerStats(state);
  const log: TowerLogEntry[] = [];

  // Les postures ne durent qu'un tour ennemi.
  encounter.defenseMultiplier = 1;

  switch (action.type) {
    case 'attack': {
      log.push({ k: 'attack', ...playerStrike(state, encounter, stats, null, rng) });
      break;
    }
    case 'defend': {
      encounter.defenseMultiplier = 2;
      log.push({ k: 'defend' });
      break;
    }
    case 'potion': {
      if (state.potions <= 0) throw new TowerActionRefused('no_potion');
      state.potions -= 1;
      log.push({ k: 'potion', hp: heal(state, POTION_HEAL) });
      break;
    }
    case 'skill': {
      const skill = state.skills.find((candidate) => candidate.id === action.id);
      if (!skill) throw new TowerActionRefused('bad_choice');
      if ((encounter.cooldowns[skill.id] ?? 0) > 0) throw new TowerActionRefused('skill_cooldown');
      encounter.cooldowns[skill.id] = effectiveCooldown(skill.cooldownTurns, stats.cooldownReduction);
      if (skill.effect.defenseMultiplier) encounter.defenseMultiplier = skill.effect.defenseMultiplier;
      if (skill.effect.evadeNextAttack) encounter.evade = true;
      if (skill.effect.healPercent) {
        const healed = heal(state, skill.effect.healPercent);
        if (healed > 0) log.push({ k: 'heal', hp: healed });
      }
      if (skill.effect.damageMultiplier > 0) {
        log.push({ k: 'skill', name: skill.name, emoji: skill.emoji, ...playerStrike(state, encounter, stats, skill, rng) });
      } else {
        log.push({ k: 'support', name: skill.name, emoji: skill.emoji });
      }
      break;
    }
    default:
      throw new TowerActionRefused('wrong_phase');
  }

  // Comme en combat classique : chaque action du joueur fait avancer toutes les recharges.
  for (const id of Object.keys(encounter.cooldowns)) {
    if (encounter.cooldowns[id] > 0) encounter.cooldowns[id] -= 1;
  }

  if (encounter.health > 0) monsterStrike(state, encounter, stats, rng, log);
  encounter.log = [...encounter.log, ...log].slice(-LOG_KEPT);

  if (encounter.health <= 0) {
    return { state, floor: winEncounter(state, floor, rules, rng), dead: false };
  }
  if (state.hp <= 0) {
    return { state, floor, dead: true };
  }
  return { state, floor, dead: false };
}

/**
 * Entre dans une salle voisine de la carte et la résout. Une salle déjà résolue se traverse
 * sans rien déclencher ni compter d'étage : c'est ainsi qu'on ressort d'un cul-de-sac.
 */
function enterRoom(state: TowerState, floor: number, move: TowerMove, rules: TowerRules, foes: TowerFoePool, rng: TowerRng): number {
  const map = state.map!;
  const room = map.layout.rooms.find((candidate) => candidate.id === move.roomId);
  if (!room) throw new TowerActionRefused('bad_choice');
  map.pos = room.id;

  if (map.cleared.includes(room.id)) {
    advance(state, floor, rules, rng);
    return floor;
  }

  switch (room.type) {
    case 'MONSTER':
      startEncounter(state, floor, 'COMBAT', rules, foes, rng, room.foe);
      return floor;
    case 'ELITE':
      startEncounter(state, floor, 'ELITE', rules, foes, rng, room.foe);
      return floor;
    case 'BOSS':
      startEncounter(state, floor, 'BOSS', rules, foes, rng, room.foe);
      return floor;
    case 'MERCHANT':
      state.merchant = rollMerchantOffers(floor, rng, room.offers, room.pricePercent);
      state.phase = 'MERCHANT';
      return floor;
    case 'CHEST': {
      const gold = room.chest === 'GEAR' ? 0 : treasureGold(floor, rng);
      state.gold += gold;
      if (room.chest !== 'GOLD') state.pendingLoot = rollTowerGear(floor, 'TREASURE', rng);
      state.notice = { k: 'treasure', gold };
      break;
    }
    case 'CAMPFIRE':
      state.notice = { k: 'campfire', hp: heal(state, room.healPercent / 100) };
      break;
    case 'SHRINE':
      state.blessingDue = true;
      break;
    default:
      // Départ et couloir : on les traverse, sans étage à compter.
      markRoomCleared(state);
      advance(state, floor, rules, rng);
      return floor;
  }

  markRoomCleared(state);
  const next = clearFloor(state, floor, rules, false);
  advance(state, next, rules, rng);
  return next;
}

/**
 * Applique une action du joueur. L'état d'entrée n'est jamais modifié.
 * Lève `TowerActionRefused` si l'action n'a pas de sens dans la phase en cours.
 */
export function applyTowerAction(
  input: TowerState,
  floor: number,
  action: TowerAction,
  rules: TowerRules,
  foes: TowerFoePool,
): TowerStepResult {
  const state = clone(input);
  const rng = new TowerRng(state.rng);
  state.notice = null;

  const done = (nextFloor: number, dead = false): TowerStepResult => {
    state.rng = rng.state;
    return { state, floor: nextFloor, dead };
  };

  if (state.phase === 'COMBAT') {
    const result = combatTurn(state, floor, action, rules, rng);
    state.rng = rng.state;
    return result;
  }

  // Une potion se boit aussi entre deux combats, sans passer son tour.
  if (action.type === 'potion') {
    if (state.potions <= 0) throw new TowerActionRefused('no_potion');
    if (state.hp >= towerStats(state).maxHealth) throw new TowerActionRefused('hp_full');
    state.potions -= 1;
    state.notice = { k: 'potion', hp: heal(state, POTION_HEAL) };
    return done(floor);
  }

  switch (state.phase) {
    case 'DOORS': {
      if (action.type !== 'door') throw new TowerActionRefused('wrong_phase');
      if (state.map) {
        const move = state.moves[action.index];
        if (!move) throw new TowerActionRefused('bad_choice');
        return done(enterRoom(state, floor, move, rules, foes, rng));
      }
      const door = state.doors[action.index];
      if (!door) throw new TowerActionRefused('bad_choice');
      state.doors = [];

      if (door === 'COMBAT' || door === 'ELITE' || door === 'BOSS') {
        startEncounter(state, floor, door, rules, foes, rng);
        return done(floor);
      }
      if (door === 'TREASURE') {
        const gold = treasureGold(floor, rng);
        state.gold += gold;
        state.pendingLoot = rollTowerGear(floor, 'TREASURE', rng);
        state.notice = { k: 'treasure', gold };
        const next = clearFloor(state, floor, rules, false);
        advance(state, next, rules, rng);
        return done(next);
      }
      if (door === 'CAMPFIRE') {
        state.notice = { k: 'campfire', hp: heal(state, CAMPFIRE_HEAL) };
        const next = clearFloor(state, floor, rules, false);
        advance(state, next, rules, rng);
        return done(next);
      }
      state.merchant = rollMerchantOffers(floor, rng);
      state.phase = 'MERCHANT';
      return done(floor);
    }

    case 'LOOT': {
      const loot = state.pendingLoot;
      if (!loot) throw new TowerActionRefused('wrong_phase');
      if (action.type === 'equip') {
        withMaxHealthChange(state, () => { state.gear[loot.slot] = loot; });
        state.notice = { k: 'equipped', name: loot.name, emoji: loot.emoji };
      } else if (action.type === 'discard') {
        const gold = scrapValue(floor);
        state.gold += gold;
        state.notice = { k: 'scrapped', gold };
      } else {
        throw new TowerActionRefused('wrong_phase');
      }
      state.pendingLoot = null;
      advance(state, floor, rules, rng);
      return done(floor);
    }

    case 'BLESSING': {
      if (action.type !== 'bless') throw new TowerActionRefused('wrong_phase');
      const id = state.blessingChoices[action.index];
      const blessing = id ? findBlessing(id) : null;
      if (!blessing) throw new TowerActionRefused('bad_choice');
      withMaxHealthChange(state, () => {
        state.blessings[blessing.id] = Math.min(blessing.maxRank, (state.blessings[blessing.id] ?? 0) + 1);
      });
      state.notice = { k: 'blessed', id: blessing.id, rank: state.blessings[blessing.id] };
      state.blessingDue = false;
      state.blessingChoices = [];
      advance(state, floor, rules, rng);
      return done(floor);
    }

    case 'MERCHANT': {
      if (action.type === 'leave_shop') {
        state.merchant = [];
        markRoomCleared(state);
        const next = clearFloor(state, floor, rules, false);
        advance(state, next, rules, rng);
        return done(next);
      }
      if (action.type !== 'buy') throw new TowerActionRefused('wrong_phase');
      const offer = state.merchant[action.index];
      if (!offer) throw new TowerActionRefused('bad_choice');
      if (offer.sold) throw new TowerActionRefused('sold_out');
      if (state.gold < offer.price) throw new TowerActionRefused('no_gold');

      if (offer.kind === 'POTION') {
        if (state.potions >= MAX_POTIONS) throw new TowerActionRefused('potions_full');
        state.potions += 1;
      } else if (offer.kind === 'HEAL') {
        if (state.hp >= towerStats(state).maxHealth) throw new TowerActionRefused('hp_full');
        heal(state, MERCHANT_HEAL);
      } else {
        state.pendingLoot = offer.gear;
      }
      state.gold -= offer.price;
      offer.sold = true;
      state.notice = { k: 'bought', kind: offer.kind };
      advance(state, floor, rules, rng);
      return done(floor);
    }

    default:
      throw new TowerActionRefused('wrong_phase');
  }
}
