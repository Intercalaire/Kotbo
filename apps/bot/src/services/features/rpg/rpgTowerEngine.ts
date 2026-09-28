/**
 * Moteur d'une ascension de la Tour : une machine à états pure.
 *
 * Chaque clic est une action appliquée à l'état stocké avec la partie, qui renvoie l'état
 * suivant. Aucun accès base, aucun collecteur : la partie survit à un redémarrage du bot,
 * et le service n'a qu'à écrire le résultat sous condition de version.
 */

import { computeAttack } from './rpgCombatMath.js';
import {
  ALTAR_COST,
  BLACKSMITH_BOOST,
  CURSE_ATTACK,
  DISPEL_SKILL_MULTIPLIER,
  EXECUTE_BONUS,
  EXECUTE_THRESHOLD,
  PACT_TREASURES,
  PHASE_BOOST,
  PHASE_HEAL,
  PHASE_THRESHOLD,
  REGENERATION,
  SHARD_SEEKER_BONUS,
  SHIELD_SHARE,
  SPRING_HEAL,
  SUMMON_EVERY,
  SUMMON_MAX,
  SUMMON_POWER,
  THORNY_REFLECT,
  TOWER_BOSS_MECHANICS,
  TOWER_EVENTS,
  TOWER_TRAITS,
  TRAIT_MONSTER_CHANCE,
  TRAIT_MONSTER_LEVEL,
  TRAIT_STATS,
  VAMPIRIC_DRAIN,
  blacksmithPrice,
  type TowerBossMechanic,
  type TowerEventId,
  type TowerMechanicChoice,
  type TowerRelicPerk,
  type TowerTrait,
} from './rpgTowerContent.js';
import {
  BOSS_VICTORY_HEAL,
  CAMPFIRE_HEAL,
  EMPTY_GEAR,
  FALLBACK_BOSSES,
  FALLBACK_MONSTERS,
  LOOT_CHANCE,
  MAX_POTIONS,
  TOWER_CHARGE_EVERY,
  TOWER_DEFEND_HEAL,
  TOWER_ENRAGE_MULTIPLIER,
  TOWER_ENRAGE_THRESHOLD,
  TOWER_FLEE_GOLD_LOSS,
  TOWER_HEAVY_MULTIPLIER,
  TOWER_MERCHANT_DEFAULTS,
  TOWER_MONSTER_CRIT,
  TOWER_PARRIED_MULTIPLIER,
  TOWER_RIPOSTE_MULTIPLIER,
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
  towerDodgeChance,
  towerEffectiveStats,
  towerMonsterStats,
  towerRerollPrice,
  treasureGold,
  type TowerCoreStats,
  type TowerDoor,
  type TowerEffectiveStats,
  type TowerEncounterKind,
  type TowerFoeName,
  type TowerGear,
  type TowerGearSet,
  type TowerMerchantSettings,
  type TowerOffer,
  type TowerSkill,
} from './rpgTowerPolicy.js';
import {
  exitLocks,
  roomNeighbors,
  startRoom,
  type TowerDirection,
  type TowerExitType,
  type TowerFloorsAfter,
  type TowerLayout,
  type TowerRoomType,
} from './rpgTowerMap.js';
import { towerFloorLayout } from './rpgTowerGen.js';

export type TowerPhase = 'DOORS' | 'COMBAT' | 'LOOT' | 'BLESSING' | 'MERCHANT' | 'EVENT';

export type TowerLogEntry =
  | { k: 'attack'; dmg: number; crit: boolean }
  | { k: 'skill'; name: string; emoji: string; dmg: number; crit: boolean }
  | { k: 'support'; name: string; emoji: string }
  | { k: 'defend'; hp?: number }
  | { k: 'potion'; hp: number }
  | { k: 'heal'; hp: number }
  /** `heavy` : coup puissant annoncé au tour précédent ; `parried` : reçu en garde. */
  | { k: 'monster'; dmg: number; crit: boolean; heavy?: boolean; parried?: boolean }
  | { k: 'evaded' }
  | { k: 'dodged' }
  | { k: 'charge' }
  | { k: 'enrage' }
  | { k: 'thorns'; dmg: number }
  /** Le monstre (trait Rapide) esquive le coup du joueur. */
  | { k: 'foeDodged' }
  | { k: 'shield'; dmg: number }
  | { k: 'shieldBroken' }
  | { k: 'summon'; count: number }
  | { k: 'dispel' }
  | { k: 'phase' }
  | { k: 'regen'; hp: number }
  | { k: 'drain'; hp: number }
  | { k: 'spikes'; dmg: number }
  | { k: 'lastStand' };

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
  /** Coups portés par le monstre. Les champs suivants manquent aux parties d'avant leur ajout. */
  turn?: number;
  /** Le prochain coup du monstre est un coup puissant. */
  charging?: boolean;
  enraged?: boolean;
  /** Le joueur s'est défendu : sa prochaine attaque est renforcée. */
  riposte?: boolean;
  traits?: TowerTrait[];
  mechanic?: TowerBossMechanic | null;
  /** Bouclier restant (mécanique SHIELD) : il encaisse avant les PV. */
  shield?: number;
  /** Sbires invoqués (mécanique SUMMONER). */
  minions?: number;
  /** Seconde phase déclenchée (mécanique PHASES). */
  phased?: boolean;
  /** Le joueur a déjà frappé dans ce combat (relique FIRST_STRIKE). */
  opened?: boolean;
  /** Le sursis de la relique LAST_STAND a servi dans ce combat. */
  lastStandUsed?: boolean;
};

/** Étage atteint en montant : son numéro et le nom de sa carte. */
export type TowerClimb = { floor: number; name: string };

/** Ce qui s'est passé à la dernière action, affiché en tête de l'écran suivant. */
export type TowerNotice =
  /** `climbed` : étage atteint quand le gardien d'une carte vient de tomber. */
  | {
    k: 'victory';
    name: string;
    emoji: string;
    gold: number;
    healed: number;
    climbed: TowerClimb | null;
    /** Clé de l'escalier scellé trouvée sur ce monstre, ou sceau allumé en le battant. */
    lock?: TowerLockProgress | null;
  }
  | { k: 'treasure'; gold: number; lock?: TowerLockProgress | null }
  /** Vague suivante d'une épreuve. */
  | { k: 'wave'; wave: number; waves: number; gold: number }
  /** Sortie franchie sans combat : escalier ouvert ou portail. */
  | { k: 'exit'; exit: TowerExitType; climbed: TowerClimb | null }
  | { k: 'campfire'; hp: number }
  | { k: 'potion'; hp: number }
  | { k: 'equipped'; name: string; emoji: string }
  | { k: 'scrapped'; gold: number }
  | { k: 'blessed'; id: string; rank: number }
  | { k: 'bought'; kind: TowerOffer['kind'] }
  | { k: 'fled'; gold: number }
  | { k: 'rerolled' }
  /** Issue d'un événement : `amount` selon l'événement (PV, or, prix), `won` pour le pari. */
  | { k: 'event'; id: TowerEventId; option: number; amount: number; won?: boolean; item?: string };

/** Progression vers l'ouverture de la sortie, après une clé trouvée ou un sceau allumé. */
export type TowerLockProgress = { kind: 'key' | 'seal'; done: number; needed: number };

/** Ce qu'on sait d'une porte ou d'une salle avant d'y entrer. */
export type TowerRoomInfo = { traits: TowerTrait[]; mechanic: TowerBossMechanic | null; event: TowerEventId | null };

/**
 * Position sur l'étage en cours. Sa carte est copiée en y arrivant : la modifier ensuite ne
 * touche pas à l'étage où se trouve le joueur, seulement aux étages qu'il n'a pas atteints.
 */
export type TowerMapState = {
  layout: TowerLayout;
  /** Ancien compteur de sections, conservé dans les parties d'avant les étages. */
  section?: number;
  /**
   * Salles résolues depuis l'entrée, plus un : c'est ce qui règle la force des monstres, l'or
   * et le butin, pour que la difficulté monte à chaque salle et pas seulement à chaque étage.
   * Absent des parties d'avant les étages, où le numéro d'étage en tenait lieu.
   */
  depth?: number;
  /** Salle où se trouve le joueur. */
  pos: string;
  /** Salles déjà résolues sur l'étage en cours ; les retraverser ne coûte rien. */
  cleared: string[];
  /** Salle d'où l'on vient, où ramène une fuite. */
  prev?: string;
  /** Traits, mécaniques et événements des salles, tirés en arrivant sur l'étage. */
  rooms?: Record<string, TowerRoomInfo>;
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
  /**
   * Règles figées à l'entrée : un réglage changé au dashboard ne touche pas aux parties en
   * cours. Absent des parties lancées avant ce champ, qui suivent les réglages du moment.
   */
  rules?: TowerRules;
  /** Le marchand courant a déjà renouvelé son équipement. */
  merchantRerolled?: boolean;
  /** Palier sûr : un gardien vient de tomber, partir maintenant garde tous les éclats. */
  safeLeave?: boolean;
  /** Graine de la partie : les étages générés en découlent. */
  seed?: number;
  /** Ce que cache chaque porte en mode aléatoire, dans l'ordre des portes. */
  doorInfo?: TowerRoomInfo[];
  /** Événement en cours. */
  event?: { id: TowerEventId } | null;
  /** Malédictions acceptées : chacune renforce l'attaque des monstres. */
  curse?: number;
  /** Épreuve en cours : vague atteinte sur le total. On n'en fuit pas. */
  trial?: { wave: number; waves: number } | null;
};

export type TowerRules = {
  floorGrowthPercent: number;
  bossEvery: number;
  blessingEvery: number;
  maxBlessings: number;
  shardsPerFloor: number;
  /** Absent : réglages par défaut du marchand. */
  merchant?: TowerMerchantSettings;
  /** Absent : la tour reprend au premier étage dessiné. */
  floorsAfter?: TowerFloorsAfter;
  /** Absent : les étages générés ont leur brouillard. */
  generatedFog?: boolean;
};

function merchantOf(rules: TowerRules): TowerMerchantSettings {
  return rules.merchant ?? TOWER_MERCHANT_DEFAULTS;
}

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
  | { type: 'reroll' }
  | { type: 'leave_shop' }
  | { type: 'flee' }
  | { type: 'event'; index: number };

export type TowerActionError =
  | 'wrong_phase'
  | 'bad_choice'
  | 'skill_cooldown'
  | 'no_potion'
  | 'hp_full'
  | 'no_gold'
  | 'sold_out'
  | 'potions_full'
  | 'no_flee'
  | 'no_reroll'
  | 'no_gear'
  | 'stairs_locked'
  | 'gate_locked';

export class TowerActionRefused extends Error {
  constructor(readonly reason: TowerActionError) {
    super(`Action de Tour refusée : ${reason}`);
    this.name = 'TowerActionRefused';
  }
}

export type TowerStepResult = { state: TowerState; floor: number; dead: boolean };

const LOG_KEPT = 6;
/** Chance qu'un coffre mixte (or et objet) contienne vraiment un objet. */
const CHEST_GEAR_CHANCE = 0.2;

export function towerStats(state: TowerState): TowerEffectiveStats {
  return towerEffectiveStats(state.base, state.gear, state.blessings);
}

/** Effet unique de la relique portée. */
export function hasPerk(state: TowerState, perk: TowerRelicPerk): boolean {
  return state.gear.relic?.perk === perk;
}

/** Salles explorées : la profondeur sur une carte, les portes franchies sinon. Départage le classement. */
export function towerRoomsExplored(state: TowerState): number {
  return state.map ? Math.max(0, (state.map.depth ?? 1) - 1) : state.floorsCleared;
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

/**
 * Niveau de difficulté : l'étage en mode aléatoire, la profondeur en salles sur une carte.
 * Force des monstres, or, butin et prix du marchand le suivent.
 */
export function towerLevel(state: TowerState, floor: number): number {
  return state.map ? (state.map.depth ?? floor) : floor;
}

// ─────────────────────────────────────────────────────────────
// Ce que cachent portes et salles
// ─────────────────────────────────────────────────────────────

function rollTraits(kind: TowerEncounterKind, level: number, rng: TowerRng): TowerTrait[] {
  if (kind === 'COMBAT') return level >= TRAIT_MONSTER_LEVEL && rng.next() < TRAIT_MONSTER_CHANCE ? [rng.pick(TOWER_TRAITS)] : [];
  return [rng.pick(TOWER_TRAITS)];
}

function rollMechanic(choice: TowerMechanicChoice, rng: TowerRng): TowerBossMechanic | null {
  if (choice === 'NONE') return null;
  if (choice === 'RANDOM') return rng.pick(TOWER_BOSS_MECHANICS);
  return choice;
}

const ROOM_KIND: Partial<Record<TowerRoomType, TowerEncounterKind>> = { MONSTER: 'COMBAT', ELITE: 'ELITE', BOSS: 'BOSS', SEAL: 'ELITE' };
/** Vagues d'une épreuve : deux combats ordinaires puis une élite. */
export const TRIAL_WAVES = 3;
const DOOR_KIND: Partial<Record<TowerDoor, TowerEncounterKind>> = { COMBAT: 'COMBAT', ELITE: 'ELITE', BOSS: 'BOSS' };

/**
 * Tire ce que cache chaque salle de l'étage : traits des monstres, mécanique du gardien,
 * événement. Fait en arrivant sur l'étage, pour que le joueur le voie avant d'y entrer.
 */
function prepareFloor(map: TowerMapState, rng: TowerRng): void {
  const level = map.depth ?? 1;
  const rooms: Record<string, TowerRoomInfo> = {};
  for (const room of map.layout.rooms) {
    const kind = ROOM_KIND[room.type];
    if (kind) {
      rooms[room.id] = {
        traits: room.traits?.length ? [...room.traits] : rollTraits(kind, level, rng),
        mechanic: kind === 'BOSS' ? rollMechanic(room.mechanic ?? 'RANDOM', rng) : null,
        event: null,
      };
    } else if (room.type === 'EVENT') {
      const choice = room.event ?? 'RANDOM';
      rooms[room.id] = { traits: [], mechanic: null, event: choice === 'RANDOM' ? rng.pick(TOWER_EVENTS) : choice };
    }
  }
  map.rooms = rooms;
}

function rollDoorInfo(doors: TowerDoor[], level: number, rng: TowerRng): TowerRoomInfo[] {
  return doors.map((door) => {
    const kind = DOOR_KIND[door];
    if (kind) return { traits: rollTraits(kind, level, rng), mechanic: kind === 'BOSS' ? rng.pick(TOWER_BOSS_MECHANICS) : null, event: null };
    if (door === 'EVENT') return { traits: [], mechanic: null, event: rng.pick(TOWER_EVENTS) };
    return { traits: [], mechanic: null, event: null };
  });
}

function setDoors(state: TowerState, floor: number, rules: TowerRules, rng: TowerRng): void {
  state.doors = rollDoors(floor, rules.bossEvery, rng);
  state.doorInfo = rollDoorInfo(state.doors, floor, rng);
}

export function createTowerState(input: {
  base: TowerCoreStats;
  skills: TowerSkill[];
  potions: number;
  /** Or de départ, offert par les améliorations. */
  gold?: number;
  seed: number;
  rules: TowerRules;
  layout?: TowerLayout | null;
}): TowerState {
  const rng = new TowerRng(input.seed);
  const start = input.layout ? startRoom(input.layout) : null;
  const map: TowerMapState | null = input.layout && start
    ? { layout: structuredClone(input.layout), depth: 1, pos: start.id, cleared: [start.id] }
    : null;
  const state: TowerState = {
    v: 1,
    rng: rng.state,
    base: input.base,
    hp: input.base.maxHealth,
    gold: Math.max(0, Math.trunc(input.gold ?? 0)),
    potions: Math.min(MAX_POTIONS, input.potions),
    gear: { ...EMPTY_GEAR },
    blessings: {},
    skills: input.skills,
    phase: 'DOORS',
    doors: [],
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
    rules: structuredClone(input.rules),
    seed: input.seed,
  };
  if (map) {
    prepareFloor(map, rng);
    state.moves = computeMoves(state);
  } else {
    setDoors(state, 1, input.rules, rng);
  }
  state.rng = rng.state;
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

/**
 * Gardien abattu : on monte à l'étage `floor`. Sa carte suit l'ordre de la tour, puis selon
 * les réglages reprend au premier étage dessiné ou est générée ; à défaut, la carte en cours
 * recommence.
 */
function climb(state: TowerState, floor: number, rules: TowerRules, floors: readonly TowerLayout[], rng: TowerRng): TowerClimb | null {
  const map = state.map;
  if (!map) return null;
  const next = towerFloorLayout(floors, floor, rules.floorsAfter ?? 'LOOP', state.seed ?? 0, rules.generatedFog ?? true);
  const start = startRoom(next);
  if (!start) return null;
  map.layout = structuredClone(next);
  map.pos = start.id;
  map.cleared = [start.id];
  map.prev = undefined;
  prepareFloor(map, rng);
  return { floor, name: next.name };
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
    setDoors(state, floor, rules, rng);
    state.moves = [];
  }
}

/**
 * Étape franchie, renvoie l'étage où se trouve désormais le joueur.
 *
 * En mode aléatoire, chaque porte est un étage : éclats, compteur, et une bénédiction sur
 * les étages ronds. Sur une carte, chaque salle rapporte ses éclats et approfondit la
 * difficulté, mais seul le gardien fait monter d'un étage ; une bénédiction tombe tous les
 * `blessingEvery` étages gravis, en plus de celles des autels.
 */
function progress(state: TowerState, floor: number, rules: TowerRules, boss: boolean): number {
  const bonus = hasPerk(state, 'SHARD_SEEKER') ? 1 + SHARD_SEEKER_BONUS : 1;
  const map = state.map;
  if (!map) {
    state.shards += Math.round(floorShards(floor, rules.shardsPerFloor, boss) * bonus);
    state.floorsCleared += 1;
    if (rules.blessingEvery > 0 && floor % rules.blessingEvery === 0) state.blessingDue = true;
    return floor + 1;
  }
  const depth = map.depth ?? floor;
  state.shards += Math.round(floorShards(depth, rules.shardsPerFloor, boss) * bonus);
  map.depth = depth + 1;
  if (!boss) return floor;
  state.floorsCleared += 1;
  if (rules.blessingEvery > 0 && state.floorsCleared % rules.blessingEvery === 0) state.blessingDue = true;
  return floor + 1;
}

// ─────────────────────────────────────────────────────────────
// Combat
// ─────────────────────────────────────────────────────────────

const NEUTRAL_SHAPE = { health: 1, attack: 1, defense: 1, speed: 1 };

function startEncounter(
  state: TowerState,
  level: number,
  kind: TowerEncounterKind,
  rules: TowerRules,
  foes: TowerFoePool,
  rng: TowerRng,
  imposed: string | null = null,
  info: TowerRoomInfo | null = null,
): void {
  const pool = kind === 'BOSS'
    ? (foes.bosses.length > 0 ? foes.bosses : FALLBACK_BOSSES)
    : (foes.monsters.length > 0 ? foes.monsters : FALLBACK_MONSTERS);
  // Une créature imposée retirée du bestiaire depuis retombe sur le tirage habituel.
  const foe = (imposed ? foes.byName?.[imposed] : undefined) ?? rng.pick(pool);
  const traits = info?.traits ?? rollTraits(kind, level, rng);
  const mechanic = kind === 'BOSS' ? (info ? info.mechanic : rng.pick(TOWER_BOSS_MECHANICS)) : null;

  const base = towerMonsterStats(level, rules.floorGrowthPercent, kind);
  const shape = foe.shape ?? NEUTRAL_SHAPE;
  const mult = { health: shape.health, attack: shape.attack * (1 + CURSE_ATTACK * (state.curse ?? 0)), defense: shape.defense, speed: shape.speed };
  for (const trait of traits) {
    const effect = TRAIT_STATS[trait];
    mult.health *= effect.health ?? 1;
    mult.attack *= effect.attack ?? 1;
    mult.defense *= effect.defense ?? 1;
    mult.speed *= effect.speed ?? 1;
  }
  const health = Math.max(1, Math.round(base.health * mult.health));
  const shield = mechanic === 'SHIELD' ? Math.round(health * SHIELD_SHARE) : 0;

  state.encounter = {
    kind,
    name: foe.name,
    emoji: foe.emoji,
    health,
    maxHealth: health,
    attack: Math.max(1, Math.round(base.attack * mult.attack)),
    defense: Math.max(0, Math.round(base.defense * mult.defense)),
    speed: Math.max(1, Math.round(base.speed * mult.speed)),
    cooldowns: Object.fromEntries(state.skills.map((skill) => [skill.id, 0])),
    defenseMultiplier: 1,
    evade: false,
    log: [],
    traits,
    mechanic,
    shield,
    minions: 0,
  };
  state.phase = 'COMBAT';
}

/** Dégâts au joueur, avec le sursis de la relique LAST_STAND une fois par combat. */
function hurtPlayer(state: TowerState, encounter: TowerEncounter, amount: number, log: TowerLogEntry[]): void {
  if (state.hp - amount <= 0 && hasPerk(state, 'LAST_STAND') && !encounter.lastStandUsed) {
    encounter.lastStandUsed = true;
    state.hp = 1;
    log.push({ k: 'lastStand' });
    return;
  }
  state.hp = Math.max(0, state.hp - amount);
}

/** Dégâts au monstre : son bouclier encaisse d'abord. */
function hurtFoe(encounter: TowerEncounter, amount: number, log: TowerLogEntry[]): void {
  let rest = amount;
  const shield = encounter.shield ?? 0;
  if (shield > 0 && rest > 0) {
    const absorbed = Math.min(shield, rest);
    encounter.shield = shield - absorbed;
    rest -= absorbed;
    log.push({ k: 'shield', dmg: absorbed });
    if (encounter.shield === 0) log.push({ k: 'shieldBroken' });
  }
  encounter.health = Math.max(0, encounter.health - rest);
}

/**
 * Coup du monstre. Une élite ou un boss annonce un coup puissant un tour à l'avance : se
 * mettre en garde à ce moment-là le pare. La vitesse du joueur lui donne une chance d'esquive.
 */
function monsterStrike(state: TowerState, encounter: TowerEncounter, stats: TowerEffectiveStats, rng: TowerRng, log: TowerLogEntry[]): void {
  const heavy = encounter.charging === true;
  encounter.charging = false;

  if (encounter.evade) {
    encounter.evade = false;
    log.push({ k: 'evaded' });
  } else if (rng.next() < towerDodgeChance(stats.speed, encounter.speed)) {
    log.push({ k: 'dodged' });
  } else {
    const guarded = encounter.defenseMultiplier > 1;
    const power = heavy ? (guarded ? TOWER_PARRIED_MULTIPLIER : TOWER_HEAVY_MULTIPLIER) : 1;
    const hit = computeAttack({
      attack: encounter.attack,
      targetDefense: stats.defense,
      speed: encounter.speed,
      critChance: TOWER_MONSTER_CRIT,
      skillMultiplier: power
        * (encounter.enraged ? TOWER_ENRAGE_MULTIPLIER : 1)
        * (1 + SUMMON_POWER * (encounter.minions ?? 0)),
      targetDefenseMultiplier: encounter.defenseMultiplier,
      targetDamageReduction: stats.damageReduction,
      targetThorns: stats.thorns,
      random: () => rng.next(),
    });
    log.push({ k: 'monster', dmg: hit.damage, crit: hit.critical, heavy, parried: heavy && guarded });
    hurtPlayer(state, encounter, hit.damage, log);
    if (encounter.traits?.includes('VAMPIRIC')) {
      const drained = Math.min(encounter.maxHealth - encounter.health, Math.floor(hit.damage * VAMPIRIC_DRAIN));
      if (drained > 0) {
        encounter.health += drained;
        log.push({ k: 'drain', hp: drained });
      }
    }
    if (hit.reflected > 0) {
      log.push({ k: 'thorns', dmg: hit.reflected });
      hurtFoe(encounter, hit.reflected, log);
    }
  }

  encounter.turn = (encounter.turn ?? 0) + 1;
  if (encounter.health <= 0) return;

  const every = TOWER_CHARGE_EVERY[encounter.kind];
  if (every > 0 && encounter.turn % every === 0) {
    encounter.charging = true;
    log.push({ k: 'charge' });
  }
  if (encounter.mechanic === 'SUMMONER' && encounter.turn % SUMMON_EVERY === 0 && (encounter.minions ?? 0) < SUMMON_MAX) {
    encounter.minions = (encounter.minions ?? 0) + 1;
    log.push({ k: 'summon', count: encounter.minions });
  }
  if (encounter.traits?.includes('REGENERATING') && encounter.health < encounter.maxHealth) {
    const regen = Math.min(encounter.maxHealth - encounter.health, Math.max(1, Math.round(encounter.maxHealth * REGENERATION)));
    encounter.health += regen;
    log.push({ k: 'regen', hp: regen });
  }
}

/** Coup du joueur, attaque ou compétence : il écrit lui-même ses lignes dans le journal. */
function playerStrike(
  state: TowerState,
  encounter: TowerEncounter,
  stats: TowerEffectiveStats,
  skill: TowerSkill | null,
  rng: TowerRng,
  log: TowerLogEntry[],
): void {
  // Un monstre Rapide peut esquiver, comme le joueur : la riposte préparée est perdue.
  if (encounter.traits?.includes('SWIFT') && rng.next() < towerDodgeChance(encounter.speed, stats.speed)) {
    encounter.riposte = false;
    encounter.opened = true;
    log.push({ k: 'foeDodged' });
    return;
  }

  const firstStrike = hasPerk(state, 'FIRST_STRIKE') && !encounter.opened;
  const execute = hasPerk(state, 'EXECUTE') && encounter.health <= encounter.maxHealth * EXECUTE_THRESHOLD;
  const hit = computeAttack({
    attack: stats.attack,
    targetDefense: encounter.defense,
    speed: stats.speed,
    critChance: firstStrike ? 1 : stats.critChance,
    armorPiercing: Math.max(stats.armorPiercing, skill?.effect.armorPiercing ?? 0),
    skillMultiplier: (skill?.effect.damageMultiplier ?? 1)
      * (encounter.riposte ? TOWER_RIPOSTE_MULTIPLIER : 1)
      * (execute ? EXECUTE_BONUS : 1),
    lifesteal: stats.lifesteal + (skill?.effect.lifesteal ?? 0),
    random: () => rng.next(),
  });
  encounter.riposte = false;
  encounter.opened = true;
  log.push(skill
    ? { k: 'skill', name: skill.name, emoji: skill.emoji, dmg: hit.damage, crit: hit.critical }
    : { k: 'attack', dmg: hit.damage, crit: hit.critical });
  hurtFoe(encounter, hit.damage, log);
  if (hit.healed > 0) state.hp = Math.min(stats.maxHealth, state.hp + hit.healed);

  if (encounter.traits?.includes('THORNY')) {
    const spikes = Math.floor(hit.damage * THORNY_REFLECT);
    if (spikes > 0) {
      log.push({ k: 'spikes', dmg: spikes });
      hurtPlayer(state, encounter, spikes, log);
    }
  }
  if (skill && skill.effect.damageMultiplier >= DISPEL_SKILL_MULTIPLIER && (encounter.minions ?? 0) > 0) {
    encounter.minions = 0;
    log.push({ k: 'dispel' });
  }
}

/**
 * Salle du joueur qui vient d'être résolue : si elle gardait une clé de l'escalier ou un
 * sceau du portail, où en est l'ouverture de la sortie.
 */
function lockProgress(state: TowerState): TowerLockProgress | null {
  const map = state.map;
  const room = map?.layout.rooms.find((candidate) => candidate.id === map.pos);
  if (!map || !room) return null;
  const locks = exitLocks(map.layout, map.cleared);
  if (room.key) return { kind: 'key', done: locks.keysFound, needed: locks.keysNeeded };
  if (room.type === 'SEAL') return { kind: 'seal', done: locks.sealsLit, needed: locks.sealsNeeded };
  return null;
}

/**
 * Sortie franchie : l'étage est gravi, la carte suivante chargée et le palier est sûr.
 * Sert au gardien, à la dernière vague d'une épreuve, à l'escalier et au portail.
 */
function exitFloor(state: TowerState, floor: number, rules: TowerRules, floors: readonly TowerLayout[], rng: TowerRng): { next: number; climbed: TowerClimb | null } {
  const next = progress(state, floor, rules, true);
  markRoomCleared(state);
  const climbed = state.map ? climb(state, next, rules, floors, rng) : null;
  state.safeLeave = true;
  return { next, climbed };
}

function winEncounter(
  state: TowerState,
  floor: number,
  rules: TowerRules,
  rng: TowerRng,
  floors: readonly TowerLayout[],
  foes: TowerFoePool,
): number {
  const encounter = state.encounter!;
  const stats = towerStats(state);
  const level = towerLevel(state, floor);
  const gold = encounterGold(level, encounter.kind, stats.goldPercent, rng);
  state.gold += gold;
  state.kills += 1;

  // Épreuve : tant qu'il reste des vagues, la suivante arrive aussitôt, sans butin ni répit.
  const trial = state.trial;
  if (trial && trial.wave < trial.waves) {
    trial.wave += 1;
    state.notice = { k: 'wave', wave: trial.wave, waves: trial.waves, gold };
    startEncounter(state, level, trial.wave === trial.waves ? 'ELITE' : 'COMBAT', rules, foes, rng);
    return floor;
  }

  if (rng.next() < LOOT_CHANCE[encounter.kind]) state.pendingLoot = rollTowerGear(level, encounter.kind, rng);

  let healed = heal(state, stats.healAfterCombat);
  if (encounter.kind === 'BOSS') {
    healed += heal(state, BOSS_VICTORY_HEAL);
    if (hasPerk(state, 'GUARDIAN_POTION')) state.potions = Math.min(MAX_POTIONS, state.potions + 1);
  }

  // Le gardien, ou la dernière vague d'une épreuve, ferme l'étage.
  const closesFloor = state.map ? (encounter.kind === 'BOSS' || Boolean(trial)) : isBossStep(state, floor, rules, encounter.kind);
  state.trial = null;
  if (closesFloor && state.map) {
    const { next, climbed } = exitFloor(state, floor, rules, floors, rng);
    state.notice = { k: 'victory', name: encounter.name, emoji: encounter.emoji, gold, healed, climbed };
    advance(state, next, rules, rng);
    return next;
  }

  const next = progress(state, floor, rules, closesFloor);
  markRoomCleared(state);
  if (closesFloor) state.safeLeave = true;
  state.notice = { k: 'victory', name: encounter.name, emoji: encounter.emoji, gold, healed, climbed: null, lock: lockProgress(state) };
  advance(state, next, rules, rng);
  return next;
}

/** Fuite : retour à la salle d'où l'on vient sur une carte, de nouvelles portes au même étage sinon. */
function retreat(state: TowerState): void {
  const map = state.map;
  if (!map) return;
  const back = map.prev && map.layout.rooms.some((room) => room.id === map.prev) ? map.prev : startRoom(map.layout)?.id;
  if (back) map.pos = back;
}

function combatTurn(
  state: TowerState,
  floor: number,
  action: TowerAction,
  rules: TowerRules,
  rng: TowerRng,
  floors: readonly TowerLayout[],
  foes: TowerFoePool,
): TowerStepResult {
  const encounter = state.encounter;
  if (!encounter) throw new TowerActionRefused('wrong_phase');
  const stats = towerStats(state);
  const log: TowerLogEntry[] = [];

  // Les postures ne durent qu'un tour ennemi.
  encounter.defenseMultiplier = 1;

  // On ne fuit ni un boss ni une épreuve. Fuir laisse au monstre un dernier coup et coûte une
  // part de l'or.
  if (action.type === 'flee') {
    if (encounter.kind === 'BOSS' || state.trial) throw new TowerActionRefused('no_flee');
    monsterStrike(state, encounter, stats, rng, log);
    encounter.log = [...encounter.log, ...log].slice(-LOG_KEPT);
    if (state.hp <= 0) return { state, floor, dead: true };
    if (encounter.health <= 0) return { state, floor: winEncounter(state, floor, rules, rng, floors, foes), dead: false };
    const lost = Math.floor(state.gold * TOWER_FLEE_GOLD_LOSS);
    state.gold -= lost;
    retreat(state);
    state.notice = { k: 'fled', gold: lost };
    advance(state, floor, rules, rng);
    return { state, floor, dead: false };
  }

  switch (action.type) {
    case 'attack': {
      playerStrike(state, encounter, stats, null, rng, log);
      break;
    }
    case 'defend': {
      encounter.defenseMultiplier = 2;
      encounter.riposte = true;
      log.push({ k: 'defend', hp: heal(state, TOWER_DEFEND_HEAL) });
      break;
    }
    case 'potion': {
      if (state.potions <= 0) throw new TowerActionRefused('no_potion');
      if (state.hp >= stats.maxHealth) throw new TowerActionRefused('hp_full');
      state.potions -= 1;
      log.push({ k: 'potion', hp: heal(state, merchantOf(rules).potionHealPercent / 100) });
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
        playerStrike(state, encounter, stats, skill, rng, log);
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

  if (encounter.mechanic === 'PHASES' && !encounter.phased && encounter.health > 0
    && encounter.health <= encounter.maxHealth * PHASE_THRESHOLD) {
    encounter.phased = true;
    encounter.health = Math.min(encounter.maxHealth, encounter.health + Math.round(encounter.maxHealth * PHASE_HEAL));
    encounter.attack = Math.round(encounter.attack * PHASE_BOOST);
    encounter.defense = Math.round(encounter.defense * PHASE_BOOST);
    log.push({ k: 'phase' });
  }
  if (encounter.kind === 'BOSS' && !encounter.enraged && encounter.health > 0
    && encounter.health <= encounter.maxHealth * TOWER_ENRAGE_THRESHOLD) {
    encounter.enraged = true;
    log.push({ k: 'enrage' });
  }

  if (encounter.health > 0 && state.hp > 0) monsterStrike(state, encounter, stats, rng, log);
  encounter.log = [...encounter.log, ...log].slice(-LOG_KEPT);

  // La mort passe avant la victoire : un monstre tué par les épines de son dernier coup
  // n'empêche pas le joueur de tomber, sans quoi il repartait à 0 PV.
  if (state.hp <= 0) {
    return { state, floor, dead: true };
  }
  if (encounter.health <= 0) {
    return { state, floor: winEncounter(state, floor, rules, rng, floors, foes), dead: false };
  }
  return { state, floor, dead: false };
}

// ─────────────────────────────────────────────────────────────
// Événements
// ─────────────────────────────────────────────────────────────

/**
 * Résout le choix fait devant un événement. L'option 1 est toujours sans risque (partir, ou
 * pour la source remplir une fiole) ; l'option 0 est le pari de l'événement.
 */
function resolveEvent(state: TowerState, id: TowerEventId, option: number, level: number, rng: TowerRng): TowerNotice {
  const leave: TowerNotice = { k: 'event', id, option, amount: 0 };
  switch (id) {
    case 'BLOOD_ALTAR': {
      if (option !== 0) return leave;
      const cost = Math.floor(towerStats(state).maxHealth * ALTAR_COST);
      state.hp = Math.max(1, state.hp - cost);
      state.blessingDue = true;
      return { k: 'event', id, option, amount: cost };
    }
    case 'GAMBLER': {
      if (option !== 0) return leave;
      const stake = Math.floor(state.gold / 2);
      if (stake <= 0) throw new TowerActionRefused('no_gold');
      const won = rng.next() < 0.5;
      state.gold += won ? stake : -stake;
      return { k: 'event', id, option, amount: stake, won };
    }
    case 'SPRING': {
      if (option === 0) return { k: 'event', id, option, amount: heal(state, SPRING_HEAL) };
      if (state.potions >= MAX_POTIONS) throw new TowerActionRefused('potions_full');
      state.potions += 1;
      return { k: 'event', id, option, amount: 1 };
    }
    case 'BLACKSMITH': {
      if (option !== 0) return leave;
      const price = blacksmithPrice(level);
      if (state.gold < price) throw new TowerActionRefused('no_gold');
      const slots = (['weapon', 'armor'] as const).filter((slot) => state.gear[slot] !== null);
      if (slots.length === 0) throw new TowerActionRefused('no_gear');
      const slot = rng.pick(slots);
      const piece = state.gear[slot]!;
      const boost = (value: number) => (value > 0 ? Math.max(value + 1, Math.round(value * BLACKSMITH_BOOST)) : 0);
      withMaxHealthChange(state, () => {
        state.gear[slot] = {
          ...piece,
          attack: boost(piece.attack),
          defense: boost(piece.defense),
          speed: boost(piece.speed),
          maxHealth: boost(piece.maxHealth),
        };
      });
      state.gold -= price;
      return { k: 'event', id, option, amount: price, item: piece.name };
    }
    case 'CURSED_PACT': {
      if (option !== 0) return leave;
      const gold = treasureGold(level, rng) * PACT_TREASURES;
      state.gold += gold;
      state.curse = (state.curse ?? 0) + 1;
      return { k: 'event', id, option, amount: gold };
    }
  }
}

/**
 * Entre dans une salle voisine de la carte et la résout. Une salle déjà résolue se traverse
 * sans rien déclencher : c'est ainsi qu'on ressort d'un cul-de-sac.
 */
function enterRoom(
  state: TowerState,
  floor: number,
  move: TowerMove,
  rules: TowerRules,
  foes: TowerFoePool,
  rng: TowerRng,
  floors: readonly TowerLayout[],
): number {
  const level = towerLevel(state, floor);
  const map = state.map!;
  const room = map.layout.rooms.find((candidate) => candidate.id === move.roomId);
  if (!room) throw new TowerActionRefused('bad_choice');

  // Une sortie scellée se refuse avant d'y mettre les pieds : le joueur reste où il est.
  const locks = exitLocks(map.layout, map.cleared);
  if (room.type === 'STAIRS' && locks.keysFound < locks.keysNeeded) throw new TowerActionRefused('stairs_locked');
  if (room.type === 'GATE' && locks.sealsLit < locks.sealsNeeded) throw new TowerActionRefused('gate_locked');

  map.prev = map.pos;
  map.pos = room.id;

  if (map.cleared.includes(room.id)) {
    advance(state, floor, rules, rng);
    return floor;
  }

  const info = map.rooms?.[room.id] ?? null;
  switch (room.type) {
    case 'MONSTER':
      startEncounter(state, level, 'COMBAT', rules, foes, rng, room.foe, info);
      return floor;
    case 'ELITE':
      startEncounter(state, level, 'ELITE', rules, foes, rng, room.foe, info);
      return floor;
    case 'BOSS':
      startEncounter(state, level, 'BOSS', rules, foes, rng, room.foe, info);
      return floor;
    case 'SEAL':
      // Chaque sceau est gardé par une élite : l'abattre l'allume.
      startEncounter(state, level, 'ELITE', rules, foes, rng, room.foe, info);
      return floor;
    case 'TRIAL':
      state.trial = { wave: 1, waves: TRIAL_WAVES };
      startEncounter(state, level, 'COMBAT', rules, foes, rng);
      return floor;
    case 'STAIRS':
    case 'GATE': {
      const { next, climbed } = exitFloor(state, floor, rules, floors, rng);
      state.notice = { k: 'exit', exit: room.type, climbed };
      advance(state, next, rules, rng);
      return next;
    }
    case 'MERCHANT':
      state.merchant = rollMerchantOffers(level, rng, room.offers, room.pricePercent, merchantOf(rules));
      state.merchantRerolled = false;
      state.phase = 'MERCHANT';
      return floor;
    case 'EVENT':
      state.event = { id: info?.event ?? rng.pick(TOWER_EVENTS) };
      state.phase = 'EVENT';
      return floor;
    case 'CHEST': {
      const gold = room.chest === 'GEAR' ? 0 : treasureGold(level, rng);
      state.gold += gold;
      // Un coffre mixte ne donne un objet qu'une fois sur cinq ; un coffre à équipement, toujours.
      if (room.chest === 'GEAR' || (room.chest === 'BOTH' && rng.next() < CHEST_GEAR_CHANCE)) {
        state.pendingLoot = rollTowerGear(level, 'TREASURE', rng);
      }
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
      // Départ et couloir : on les traverse sans rien résoudre.
      markRoomCleared(state);
      advance(state, floor, rules, rng);
      return floor;
  }

  markRoomCleared(state);
  if (state.notice?.k === 'treasure') state.notice.lock = lockProgress(state);
  const next = progress(state, floor, rules, false);
  advance(state, next, rules, rng);
  return next;
}

/**
 * Applique une action du joueur. L'état d'entrée n'est jamais modifié. Les règles figées dans
 * la partie l'emportent sur `liveRules`, qui ne sert qu'aux parties d'avant ce gel.
 * Lève `TowerActionRefused` si l'action n'a pas de sens dans la phase en cours.
 */
export function applyTowerAction(
  input: TowerState,
  floor: number,
  action: TowerAction,
  liveRules: TowerRules,
  foes: TowerFoePool,
  /** Étages dessinés, dans l'ordre de la montée ; vide en mode aléatoire. */
  floors: readonly TowerLayout[] = [],
): TowerStepResult {
  const rules = input.rules ?? liveRules;
  const state = clone(input);
  const rng = new TowerRng(state.rng);
  const level = towerLevel(state, floor);
  state.notice = null;

  const done = (nextFloor: number, dead = false): TowerStepResult => {
    state.rng = rng.state;
    return { state, floor: nextFloor, dead };
  };

  if (state.phase === 'COMBAT') {
    const result = combatTurn(state, floor, action, rules, rng, floors, foes);
    state.rng = rng.state;
    return result;
  }

  // Une potion se boit aussi entre deux combats, sans passer son tour.
  if (action.type === 'potion') {
    if (state.potions <= 0) throw new TowerActionRefused('no_potion');
    if (state.hp >= towerStats(state).maxHealth) throw new TowerActionRefused('hp_full');
    state.potions -= 1;
    state.notice = { k: 'potion', hp: heal(state, merchantOf(rules).potionHealPercent / 100) };
    return done(floor);
  }

  switch (state.phase) {
    case 'DOORS': {
      if (action.type !== 'door') throw new TowerActionRefused('wrong_phase');
      // Le palier sûr ne dure que jusqu'au pas suivant.
      state.safeLeave = false;
      if (state.map) {
        const move = state.moves[action.index];
        if (!move) throw new TowerActionRefused('bad_choice');
        return done(enterRoom(state, floor, move, rules, foes, rng, floors));
      }
      const door = state.doors[action.index];
      if (!door) throw new TowerActionRefused('bad_choice');
      const info = state.doorInfo?.[action.index] ?? null;
      state.doors = [];
      state.doorInfo = [];

      if (door === 'COMBAT' || door === 'ELITE' || door === 'BOSS') {
        startEncounter(state, floor, door, rules, foes, rng, null, info);
        return done(floor);
      }
      if (door === 'TREASURE') {
        const gold = treasureGold(floor, rng);
        state.gold += gold;
        state.pendingLoot = rollTowerGear(floor, 'TREASURE', rng);
        state.notice = { k: 'treasure', gold };
        const next = progress(state, floor, rules, false);
        advance(state, next, rules, rng);
        return done(next);
      }
      if (door === 'CAMPFIRE') {
        state.notice = { k: 'campfire', hp: heal(state, CAMPFIRE_HEAL) };
        const next = progress(state, floor, rules, false);
        advance(state, next, rules, rng);
        return done(next);
      }
      if (door === 'EVENT') {
        state.event = { id: info?.event ?? rng.pick(TOWER_EVENTS) };
        state.phase = 'EVENT';
        return done(floor);
      }
      state.merchant = rollMerchantOffers(floor, rng, merchantOf(rules).offers, 100, merchantOf(rules));
      state.merchantRerolled = false;
      state.phase = 'MERCHANT';
      return done(floor);
    }

    case 'EVENT': {
      if (action.type !== 'event') throw new TowerActionRefused('wrong_phase');
      const event = state.event;
      if (!event) throw new TowerActionRefused('wrong_phase');
      if (action.index !== 0 && action.index !== 1) throw new TowerActionRefused('bad_choice');
      state.notice = resolveEvent(state, event.id, action.index, level, rng);
      state.event = null;
      markRoomCleared(state);
      const next = progress(state, floor, rules, false);
      advance(state, next, rules, rng);
      return done(next);
    }

    case 'LOOT': {
      const loot = state.pendingLoot;
      if (!loot) throw new TowerActionRefused('wrong_phase');
      if (action.type === 'equip') {
        withMaxHealthChange(state, () => { state.gear[loot.slot] = loot; });
        state.notice = { k: 'equipped', name: loot.name, emoji: loot.emoji };
      } else if (action.type === 'discard') {
        const gold = scrapValue(level);
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
        state.merchantRerolled = false;
        markRoomCleared(state);
        const next = progress(state, floor, rules, false);
        advance(state, next, rules, rng);
        return done(next);
      }
      if (action.type === 'reroll') {
        if (state.merchantRerolled) throw new TowerActionRefused('no_reroll');
        const gear = state.merchant.filter((offer): offer is Extract<TowerOffer, { kind: 'GEAR' }> => offer.kind === 'GEAR' && !offer.sold);
        if (gear.length === 0) throw new TowerActionRefused('no_reroll');
        const price = towerRerollPrice(level, merchantOf(rules));
        if (state.gold < price) throw new TowerActionRefused('no_gold');
        state.gold -= price;
        for (const offer of gear) offer.gear = rollTowerGear(level, 'MERCHANT', rng);
        state.merchantRerolled = true;
        state.notice = { k: 'rerolled' };
        return done(floor);
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
        heal(state, merchantOf(rules).healPercent / 100);
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
