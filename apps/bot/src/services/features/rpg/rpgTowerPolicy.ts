/**
 * Règles de la Tour : formules, catalogue et bornes de réglage. Aucun accès base.
 *
 * La Tour est un mode roguelite dont les statistiques sont indépendantes du RPG. Ce qu'un
 * joueur y apporte de son profil passe par une compression logarithmique plafonnée : un
 * personnage cent fois plus fort n'y entre qu'avec quelques dizaines de pourcents de plus,
 * et la croissance exponentielle des monstres ne lui laisse que quelques étages d'avance.
 */

import type { SkillEffect } from './rpgClasses.js';

// ─────────────────────────────────────────────────────────────
// Réglages
// ─────────────────────────────────────────────────────────────

export const TOWER_ENTRY_MODES = ['COMPRESSED', 'RESET'] as const;
export type TowerEntryMode = (typeof TOWER_ENTRY_MODES)[number];

export type TowerSettings = {
  enabled: boolean;
  name: string;
  emoji: string;
  description: string;
  entryMode: TowerEntryMode;
  inheritCapPercent: number;
  titleCapPercent: number;
  floorGrowthPercent: number;
  bossEvery: number;
  blessingEvery: number;
  maxBlessings: number;
  shardsPerFloor: number;
  deathShardPercent: number;
  weeklyShardCap: number;
  idleTimeoutMinutes: number;
  currencyName: string;
  currencyEmoji: string;
};

export const TOWER_DEFAULTS: TowerSettings = {
  enabled: false,
  name: 'La Tour',
  emoji: '🗼',
  description: '',
  entryMode: 'COMPRESSED',
  inheritCapPercent: 50,
  titleCapPercent: 30,
  floorGrowthPercent: 8,
  bossEvery: 10,
  blessingEvery: 5,
  maxBlessings: 6,
  shardsPerFloor: 2,
  deathShardPercent: 50,
  weeklyShardCap: 0,
  idleTimeoutMinutes: 30,
  currencyName: 'Éclats de Tour',
  currencyEmoji: '💠',
};

export const TOWER_RANGES = {
  inheritCapPercent: { min: 0, max: 300 },
  titleCapPercent: { min: 0, max: 200 },
  floorGrowthPercent: { min: 1, max: 30 },
  bossEvery: { min: 0, max: 50 },
  blessingEvery: { min: 0, max: 20 },
  maxBlessings: { min: 1, max: 12 },
  shardsPerFloor: { min: 0, max: 1000 },
  deathShardPercent: { min: 0, max: 100 },
  weeklyShardCap: { min: 0, max: 1_000_000 },
  idleTimeoutMinutes: { min: 5, max: 1440 },
} as const;

export const TOWER_NAME_MAX = 50;
export const TOWER_DESCRIPTION_MAX = 300;
export const TOWER_CURRENCY_NAME_MAX = 30;

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(parsed)));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export type TowerNormalizeResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function normalizeTowerSettings(input: Record<string, unknown>): TowerNormalizeResult<TowerSettings> {
  const name = text(input.name) || TOWER_DEFAULTS.name;
  if (name.length > TOWER_NAME_MAX) return { ok: false, error: `Le nom ne peut pas dépasser ${TOWER_NAME_MAX} caractères.` };
  const description = text(input.description);
  if (description.length > TOWER_DESCRIPTION_MAX) {
    return { ok: false, error: `La description ne peut pas dépasser ${TOWER_DESCRIPTION_MAX} caractères.` };
  }
  const currencyName = text(input.currencyName) || TOWER_DEFAULTS.currencyName;
  if (currencyName.length > TOWER_CURRENCY_NAME_MAX) {
    return { ok: false, error: `Le nom de la monnaie ne peut pas dépasser ${TOWER_CURRENCY_NAME_MAX} caractères.` };
  }
  const entryMode = TOWER_ENTRY_MODES.includes(input.entryMode as TowerEntryMode)
    ? (input.entryMode as TowerEntryMode)
    : TOWER_DEFAULTS.entryMode;

  const int = (key: keyof typeof TOWER_RANGES) => clampInt(input[key], TOWER_RANGES[key], TOWER_DEFAULTS[key]);

  return {
    ok: true,
    value: {
      enabled: input.enabled === true,
      name,
      emoji: text(input.emoji) || TOWER_DEFAULTS.emoji,
      description,
      entryMode,
      inheritCapPercent: int('inheritCapPercent'),
      titleCapPercent: int('titleCapPercent'),
      floorGrowthPercent: int('floorGrowthPercent'),
      bossEvery: int('bossEvery'),
      blessingEvery: int('blessingEvery'),
      maxBlessings: int('maxBlessings'),
      shardsPerFloor: int('shardsPerFloor'),
      deathShardPercent: int('deathShardPercent'),
      weeklyShardCap: int('weeklyShardCap'),
      idleTimeoutMinutes: int('idleTimeoutMinutes'),
      currencyName,
      currencyEmoji: text(input.currencyEmoji) || TOWER_DEFAULTS.currencyEmoji,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Récompenses
// ─────────────────────────────────────────────────────────────

export const TOWER_REWARD_KINDS = ['SHOP', 'MILESTONE'] as const;
export type TowerRewardKind = (typeof TOWER_REWARD_KINDS)[number];
export const TOWER_REWARDS_PER_GUILD_MAX = 40;
export const TOWER_REWARD_PRICE_RANGE = { min: 1, max: 1_000_000 } as const;
export const TOWER_REWARD_FLOOR_RANGE = { min: 1, max: 1000 } as const;
export const TOWER_REWARD_COINS_RANGE = { min: 0, max: 1_000_000 } as const;

export type NormalizedTowerReward = {
  kind: TowerRewardKind;
  name: string;
  description: string;
  emoji: string;
  price: number;
  floor: number;
  repeatable: boolean;
  titleId: string | null;
  roleId: string | null;
  coins: number;
  xp: number;
  clanPoints: number;
  itemName: string | null;
  shards: number;
  enabled: boolean;
};

export function normalizeTowerReward(input: Record<string, unknown>): TowerNormalizeResult<NormalizedTowerReward> {
  const kind = TOWER_REWARD_KINDS.includes(input.kind as TowerRewardKind) ? (input.kind as TowerRewardKind) : null;
  if (!kind) return { ok: false, error: 'Type de récompense invalide.' };
  const name = text(input.name);
  if (!name) return { ok: false, error: 'Le nom de la récompense est obligatoire.' };
  if (name.length > TOWER_NAME_MAX) return { ok: false, error: `Le nom ne peut pas dépasser ${TOWER_NAME_MAX} caractères.` };
  const description = text(input.description);
  if (description.length > TOWER_DESCRIPTION_MAX) {
    return { ok: false, error: `La description ne peut pas dépasser ${TOWER_DESCRIPTION_MAX} caractères.` };
  }

  const value: NormalizedTowerReward = {
    kind,
    name,
    description,
    emoji: text(input.emoji) || '🎁',
    price: kind === 'SHOP' ? clampInt(input.price, TOWER_REWARD_PRICE_RANGE, 100) : 0,
    floor: kind === 'MILESTONE' ? clampInt(input.floor, TOWER_REWARD_FLOOR_RANGE, 10) : 0,
    // Un palier ne se verse qu'une fois : le rendre répétable n'aurait aucun sens.
    repeatable: kind === 'SHOP' && input.repeatable === true,
    titleId: text(input.titleId) || null,
    roleId: text(input.roleId) || null,
    coins: clampInt(input.coins, TOWER_REWARD_COINS_RANGE, 0),
    xp: clampInt(input.xp, TOWER_REWARD_COINS_RANGE, 0),
    clanPoints: clampInt(input.clanPoints, TOWER_REWARD_COINS_RANGE, 0),
    itemName: text(input.itemName) || null,
    shards: kind === 'MILESTONE' ? clampInt(input.shards, TOWER_REWARD_COINS_RANGE, 0) : 0,
    enabled: input.enabled !== false,
  };

  const grantsSomething = value.titleId || value.roleId || value.itemName
    || value.coins > 0 || value.xp > 0 || value.clanPoints > 0 || value.shards > 0;
  if (!grantsSomething) {
    return { ok: false, error: 'Une récompense doit accorder au moins un titre, un rôle, un objet, des pièces, de l\'XP, des points de clan ou des éclats.' };
  }
  // Un rôle ou un titre ne se possède qu'une fois : le racheter viderait le solde pour rien.
  if (value.repeatable && (value.titleId || value.roleId)) {
    return { ok: false, error: 'Un article qui donne un titre ou un rôle ne peut pas être répétable.' };
  }
  return { ok: true, value };
}

// ─────────────────────────────────────────────────────────────
// Aléatoire reproductible
// ─────────────────────────────────────────────────────────────

/**
 * Générateur mulberry32 dont l'état tient dans un entier stocké avec la partie : relancer
 * une action (double clic, vieux message) ne peut pas retirer un meilleur butin.
 */
export class TowerRng {
  constructor(public state: number) {}

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let r = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  weighted<T extends string>(weights: Record<T, number>): T {
    const entries = Object.entries(weights) as [T, number][];
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [key, weight] of entries) {
      roll -= weight;
      if (roll < 0) return key;
    }
    return entries[entries.length - 1][0];
  }
}

export function newTowerSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

// ─────────────────────────────────────────────────────────────
// Statistiques d'entrée
// ─────────────────────────────────────────────────────────────

export const TOWER_BASE_STATS = { attack: 20, defense: 10, speed: 10, maxHealth: 150 } as const;
export type TowerStatKey = keyof typeof TOWER_BASE_STATS;
const STAT_KEYS: TowerStatKey[] = ['attack', 'defense', 'speed', 'maxHealth'];

export const TOWER_BASE_CRIT = 0.1;
/** Pente de l'héritage : ×10 sur la stat du RPG rapporte +20 % dans la Tour. */
export const INHERIT_SLOPE = 0.2;
/** Pente du titre, deux fois plus douce : un titre colore la Tour, il ne la porte pas. */
export const TITLE_SLOPE = 0.1;
export const TITLE_CRIT_CAP = 0.1;

export type TowerCoreStats = {
  attack: number;
  defense: number;
  speed: number;
  maxHealth: number;
  critChance: number;
  armorPiercing: number;
  damageReduction: number;
  lifesteal: number;
  thorns: number;
};

/**
 * Part de bonus tirée d'une valeur du RPG, de 0 au plafond.
 *
 * `slope × log10(1 + valeur / base)` : chaque ordre de grandeur rapporte la même chose,
 * si bien que passer de 10 000 à 1 000 000 d'attaque vaut autant que de 100 à 10 000.
 */
export function inheritedShare(value: number, base: number, slope: number, capPercent: number): number {
  if (capPercent <= 0 || value <= 0 || base <= 0) return 0;
  return Math.min(capPercent / 100, slope * Math.log10(1 + value / base));
}

export type TowerEntryInput = {
  mode: TowerEntryMode;
  inheritCapPercent: number;
  titleCapPercent: number;
  /** Stats effectives du profil RPG (équipement, arbre, titre compris). */
  main: Record<TowerStatKey, number>;
  /** Bonus bruts du titre porté ; `critPercent` en points de pourcentage. */
  title: Record<TowerStatKey, number> & { critPercent: number };
  classModifiers: Record<TowerStatKey, number>;
  classPassive: { damageReduction?: number; bonusCritChance?: number; armorPiercing?: number };
  /** Niveau de l'amélioration « Vigueur » achetée avec des éclats. */
  vigorLevel: number;
};

export const VIGOR_PER_LEVEL = 0.05;

/**
 * Stats de départ d'une ascension.
 *
 * La classe garde son profil (multiplicateurs et passif) : c'est l'identité du personnage,
 * pas sa puissance. L'équipement, la forge et les enchantements ne passent qu'à travers
 * l'héritage compressé, et disparaissent totalement en mode RESET.
 */
export function computeTowerEntryStats(input: TowerEntryInput): TowerCoreStats {
  const stats = {} as Record<TowerStatKey, number>;
  for (const key of STAT_KEYS) {
    const base = TOWER_BASE_STATS[key];
    const inherited = input.mode === 'COMPRESSED'
      ? inheritedShare(input.main[key], base, INHERIT_SLOPE, input.inheritCapPercent)
      : 0;
    const fromTitle = inheritedShare(input.title[key], base, TITLE_SLOPE, input.titleCapPercent);
    stats[key] = Math.max(1, Math.round(base * (input.classModifiers[key] ?? 1) * (1 + inherited + fromTitle)));
  }
  stats.maxHealth = Math.round(stats.maxHealth * (1 + VIGOR_PER_LEVEL * Math.max(0, input.vigorLevel)));

  return {
    ...stats,
    critChance: TOWER_BASE_CRIT
      + (input.classPassive.bonusCritChance ?? 0)
      + Math.min(TITLE_CRIT_CAP, Math.max(0, input.title.critPercent) / 200),
    armorPiercing: input.classPassive.armorPiercing ?? 0,
    damageReduction: input.classPassive.damageReduction ?? 0,
    lifesteal: 0,
    thorns: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Étages et monstres
// ─────────────────────────────────────────────────────────────

export const TOWER_DOORS = ['COMBAT', 'ELITE', 'TREASURE', 'CAMPFIRE', 'MERCHANT', 'BOSS'] as const;
export type TowerDoor = (typeof TOWER_DOORS)[number];
export type TowerEncounterKind = 'COMBAT' | 'ELITE' | 'BOSS';

const DOOR_WEIGHTS: Record<Exclude<TowerDoor, 'BOSS'>, number> = {
  COMBAT: 45,
  ELITE: 18,
  TREASURE: 12,
  CAMPFIRE: 13,
  MERCHANT: 12,
};

export function isBossFloor(floor: number, bossEvery: number): boolean {
  return bossEvery > 0 && floor % bossEvery === 0;
}

/**
 * Portes proposées à un étage : trois types distincts, ou le seul boss. Le premier étage
 * ouvre toujours sur un combat, pour que la première décision ne soit pas un coffre gratuit.
 */
export function rollDoors(floor: number, bossEvery: number, rng: TowerRng): TowerDoor[] {
  if (isBossFloor(floor, bossEvery)) return ['BOSS'];
  const pool = { ...DOOR_WEIGHTS };
  const doors: TowerDoor[] = [];
  if (floor === 1) {
    doors.push('COMBAT');
    delete (pool as Partial<typeof pool>).COMBAT;
  }
  while (doors.length < 3) {
    const door = rng.weighted(pool);
    doors.push(door);
    delete (pool as Partial<typeof pool>)[door];
  }
  return doors;
}

export type TowerMonsterStats = { health: number; attack: number; defense: number; speed: number };

const ENCOUNTER_MULTIPLIERS: Record<TowerEncounterKind, TowerMonsterStats> = {
  COMBAT: { health: 1, attack: 1, defense: 1, speed: 1 },
  ELITE: { health: 1.5, attack: 1.25, defense: 1.2, speed: 1.05 },
  BOSS: { health: 2.6, attack: 1.35, defense: 1.3, speed: 1.1 },
};

/**
 * Force d'un monstre, qui ne dépend que de l'étage : jamais du joueur. Deux joueurs au même
 * étage affrontent la même difficulté, et le classement reste comparable.
 */
export function towerMonsterStats(floor: number, growthPercent: number, kind: TowerEncounterKind): TowerMonsterStats {
  const growth = Math.pow(1 + growthPercent / 100, Math.max(0, floor - 1));
  const mult = ENCOUNTER_MULTIPLIERS[kind];
  return {
    health: Math.round(70 * growth * mult.health),
    attack: Math.round(13 * growth * mult.attack),
    defense: Math.round(6 * growth * mult.defense),
    speed: Math.round(9 * Math.pow(1.02, Math.max(0, floor - 1)) * mult.speed),
  };
}

export const TOWER_MONSTER_CRIT = 0.08;

const KIND_GOLD: Record<TowerEncounterKind, number> = { COMBAT: 1, ELITE: 2, BOSS: 4 };

export function encounterGold(floor: number, kind: TowerEncounterKind, goldPercent: number, rng: TowerRng): number {
  const base = (6 + floor * 2) * KIND_GOLD[kind];
  return Math.round(base * (0.85 + rng.next() * 0.3) * (1 + goldPercent));
}

export function treasureGold(floor: number, rng: TowerRng): number {
  return Math.round((10 + floor * 3) * (0.85 + rng.next() * 0.3));
}

export const LOOT_CHANCE: Record<TowerEncounterKind, number> = { COMBAT: 0.35, ELITE: 1, BOSS: 1 };
export const CAMPFIRE_HEAL = 0.35;
export const POTION_HEAL = 0.35;
export const BOSS_VICTORY_HEAL = 0.3;
export const MAX_POTIONS = 5;

/** Nom et emoji d'un adversaire, tirés du bestiaire du serveur. */
export type TowerFoeName = { name: string; emoji: string };

export const FALLBACK_MONSTERS: TowerFoeName[] = [
  { name: 'Gobelin des marches', emoji: '👺' },
  { name: 'Squelette gardien', emoji: '💀' },
  { name: 'Limace de pierre', emoji: '🐌' },
  { name: 'Chauve-souris d\'écho', emoji: '🦇' },
  { name: 'Araignée des combles', emoji: '🕷️' },
];

export const FALLBACK_BOSSES: TowerFoeName[] = [
  { name: 'Gardien de l\'étage', emoji: '🗿' },
  { name: 'Liche de la Tour', emoji: '🧙' },
  { name: 'Golem d\'airain', emoji: '🤖' },
];

// ─────────────────────────────────────────────────────────────
// Équipement de la Tour
// ─────────────────────────────────────────────────────────────

export const TOWER_GEAR_SLOTS = ['weapon', 'armor', 'relic'] as const;
export type TowerGearSlot = (typeof TOWER_GEAR_SLOTS)[number];
export const TOWER_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;
export type TowerRarity = (typeof TOWER_RARITIES)[number];

export type TowerGear = {
  slot: TowerGearSlot;
  name: string;
  emoji: string;
  rarity: TowerRarity;
  attack: number;
  defense: number;
  speed: number;
  maxHealth: number;
  critChance: number;
  lifesteal: number;
  thorns: number;
  armorPiercing: number;
};

export type TowerGearSet = Record<TowerGearSlot, TowerGear | null>;
export const EMPTY_GEAR: TowerGearSet = { weapon: null, armor: null, relic: null };

const RARITY_MULT: Record<TowerRarity, number> = { COMMON: 1, UNCOMMON: 1.2, RARE: 1.45, EPIC: 1.75, LEGENDARY: 2.1 };

export type TowerLootSource = TowerEncounterKind | 'TREASURE' | 'MERCHANT';

const RARITY_WEIGHTS: Record<TowerLootSource, Record<TowerRarity, number>> = {
  COMBAT: { COMMON: 60, UNCOMMON: 25, RARE: 10, EPIC: 4, LEGENDARY: 1 },
  ELITE: { COMMON: 30, UNCOMMON: 35, RARE: 22, EPIC: 10, LEGENDARY: 3 },
  BOSS: { COMMON: 0, UNCOMMON: 20, RARE: 40, EPIC: 28, LEGENDARY: 12 },
  TREASURE: { COMMON: 40, UNCOMMON: 30, RARE: 20, EPIC: 8, LEGENDARY: 2 },
  MERCHANT: { COMMON: 20, UNCOMMON: 40, RARE: 28, EPIC: 10, LEGENDARY: 2 },
};

const GEAR_NAMES: Record<TowerGearSlot, TowerFoeName[]> = {
  weapon: [
    { name: 'Lame d\'escalier', emoji: '🗡️' },
    { name: 'Hache du palier', emoji: '🪓' },
    { name: 'Arc des meurtrières', emoji: '🏹' },
    { name: 'Bâton de vigie', emoji: '🪄' },
    { name: 'Marteau de rampe', emoji: '🔨' },
  ],
  armor: [
    { name: 'Cotte de gardien', emoji: '🥋' },
    { name: 'Plastron de pierre', emoji: '🛡️' },
    { name: 'Manteau des courants d\'air', emoji: '🧥' },
    { name: 'Brigandine rouillée', emoji: '🦺' },
  ],
  relic: [
    { name: 'Œil de la Tour', emoji: '🧿' },
    { name: 'Clé sans serrure', emoji: '🗝️' },
    { name: 'Sablier fêlé', emoji: '⏳' },
    { name: 'Plume d\'aigle', emoji: '🪶' },
    { name: 'Dent de dragon', emoji: '🦷' },
  ],
};

type RelicPower = 'critChance' | 'lifesteal' | 'thorns' | 'armorPiercing';
const RELIC_POWER: Record<RelicPower, number> = { critChance: 0.04, lifesteal: 0.05, thorns: 0.1, armorPiercing: 0.1 };

/** Pièce d'équipement tirée à un étage : ses stats croissent avec l'étage et la rareté. */
export function rollTowerGear(floor: number, source: TowerLootSource, rng: TowerRng, slot?: TowerGearSlot): TowerGear {
  const chosenSlot = slot ?? rng.pick(TOWER_GEAR_SLOTS);
  const rarity = rng.weighted(RARITY_WEIGHTS[source]);
  const mult = RARITY_MULT[rarity];
  const roll = () => mult * (0.85 + rng.next() * 0.3);
  const naming = rng.pick(GEAR_NAMES[chosenSlot]);

  const gear: TowerGear = {
    slot: chosenSlot,
    name: naming.name,
    emoji: naming.emoji,
    rarity,
    attack: 0,
    defense: 0,
    speed: 0,
    maxHealth: 0,
    critChance: 0,
    lifesteal: 0,
    thorns: 0,
    armorPiercing: 0,
  };

  if (chosenSlot === 'weapon') {
    gear.attack = Math.round((6 + floor * 2.2) * roll());
    if (rng.next() < 0.3) gear.speed = Math.round((1 + floor * 0.4) * roll());
  } else if (chosenSlot === 'armor') {
    gear.defense = Math.round((4 + floor * 1.6) * roll());
    gear.maxHealth = Math.round((12 + floor * 5) * roll());
  } else {
    gear.speed = Math.round((2 + floor * 0.6) * roll());
    const power = rng.pick(Object.keys(RELIC_POWER) as RelicPower[]);
    gear[power] = Math.round(RELIC_POWER[power] * mult * 100) / 100;
  }
  return gear;
}

export function scrapValue(floor: number): number {
  return 3 + floor;
}

// ─────────────────────────────────────────────────────────────
// Bénédictions
// ─────────────────────────────────────────────────────────────

export type TowerBlessingEffect = {
  attackPercent?: number;
  defensePercent?: number;
  speedPercent?: number;
  maxHealthPercent?: number;
  critChance?: number;
  lifesteal?: number;
  thorns?: number;
  damageReduction?: number;
  armorPiercing?: number;
  /** Soin après chaque victoire, en part des PV maximum. */
  healAfterCombat?: number;
  goldPercent?: number;
  /** Tours retirés à la recharge des compétences, jamais sous 1. */
  cooldownReduction?: number;
};

export type TowerBlessing = {
  id: string;
  emoji: string;
  name: string;
  description: string;
  maxRank: number;
  /** Effet d'UN rang : les rangs s'additionnent. */
  perRank: TowerBlessingEffect;
};

export const TOWER_BLESSINGS: TowerBlessing[] = [
  { id: 'might', emoji: '💪', name: 'Puissance', description: '+12 % d\'attaque par rang', maxRank: 3, perRank: { attackPercent: 0.12 } },
  { id: 'bulwark', emoji: '🧱', name: 'Rempart', description: '+12 % de défense par rang', maxRank: 3, perRank: { defensePercent: 0.12 } },
  { id: 'vitality', emoji: '❤️', name: 'Vitalité', description: '+15 % de PV max par rang', maxRank: 3, perRank: { maxHealthPercent: 0.15 } },
  { id: 'swift', emoji: '💨', name: 'Célérité', description: '+12 % de vitesse par rang', maxRank: 3, perRank: { speedPercent: 0.12 } },
  { id: 'keen', emoji: '🎯', name: 'Œil vif', description: '+5 % de coups critiques par rang', maxRank: 3, perRank: { critChance: 0.05 } },
  { id: 'leech', emoji: '🩸', name: 'Sangsue', description: '+5 % de vol de vie par rang', maxRank: 3, perRank: { lifesteal: 0.05 } },
  { id: 'thorns', emoji: '🌵', name: 'Ronces', description: '+10 % de dégâts renvoyés par rang', maxRank: 3, perRank: { thorns: 0.1 } },
  { id: 'stoneskin', emoji: '🪨', name: 'Peau de pierre', description: '-5 % de dégâts subis par rang', maxRank: 3, perRank: { damageReduction: 0.05 } },
  { id: 'piercing', emoji: '📌', name: 'Perce-armure', description: '+10 % de défense ignorée par rang', maxRank: 3, perRank: { armorPiercing: 0.1 } },
  { id: 'second_wind', emoji: '🌬️', name: 'Second souffle', description: 'Rend 8 % des PV après chaque victoire, par rang', maxRank: 3, perRank: { healAfterCombat: 0.08 } },
  { id: 'greed', emoji: '💰', name: 'Avarice', description: '+25 % d\'or par rang', maxRank: 2, perRank: { goldPercent: 0.25 } },
  { id: 'focus', emoji: '🧘', name: 'Concentration', description: 'Recharge des compétences réduite d\'un tour', maxRank: 1, perRank: { cooldownReduction: 1 } },
];

export function findBlessing(id: string): TowerBlessing | null {
  return TOWER_BLESSINGS.find((blessing) => blessing.id === id) ?? null;
}

/** Trois bénédictions proposées : jamais une déjà au maximum, et plus de nouvelle au-delà du plafond. */
export function rollBlessingChoices(owned: Record<string, number>, maxBlessings: number, rng: TowerRng): string[] {
  const distinct = Object.keys(owned).filter((id) => (owned[id] ?? 0) > 0).length;
  const pool = TOWER_BLESSINGS
    .filter((blessing) => (owned[blessing.id] ?? 0) < blessing.maxRank)
    .filter((blessing) => distinct < maxBlessings || (owned[blessing.id] ?? 0) > 0)
    .map((blessing) => blessing.id);
  const choices: string[] = [];
  while (choices.length < 3 && pool.length > 0) {
    choices.push(pool.splice(rng.int(pool.length), 1)[0]);
  }
  return choices;
}

// ─────────────────────────────────────────────────────────────
// Stats effectives en ascension
// ─────────────────────────────────────────────────────────────

export const TOWER_CAPS = { critChance: 0.6, lifesteal: 0.5, thorns: 0.5, damageReduction: 0.6, armorPiercing: 0.8 } as const;

export type TowerEffectiveStats = TowerCoreStats & {
  healAfterCombat: number;
  goldPercent: number;
  cooldownReduction: number;
};

export function towerEffectiveStats(base: TowerCoreStats, gear: TowerGearSet, blessings: Record<string, number>): TowerEffectiveStats {
  const sum: Required<TowerBlessingEffect> = {
    attackPercent: 0, defensePercent: 0, speedPercent: 0, maxHealthPercent: 0,
    critChance: 0, lifesteal: 0, thorns: 0, damageReduction: 0, armorPiercing: 0,
    healAfterCombat: 0, goldPercent: 0, cooldownReduction: 0,
  };
  for (const [id, rank] of Object.entries(blessings)) {
    const blessing = findBlessing(id);
    if (!blessing || rank <= 0) continue;
    for (const [key, value] of Object.entries(blessing.perRank) as [keyof TowerBlessingEffect, number][]) {
      sum[key] += value * Math.min(rank, blessing.maxRank);
    }
  }

  const pieces = TOWER_GEAR_SLOTS.map((slot) => gear[slot]).filter((piece): piece is TowerGear => piece !== null);
  const flat = (key: 'attack' | 'defense' | 'speed' | 'maxHealth') => pieces.reduce((total, piece) => total + piece[key], 0);
  const extra = (key: 'critChance' | 'lifesteal' | 'thorns' | 'armorPiercing') => pieces.reduce((total, piece) => total + piece[key], 0);

  return {
    attack: Math.max(1, Math.round((base.attack + flat('attack')) * (1 + sum.attackPercent))),
    defense: Math.max(0, Math.round((base.defense + flat('defense')) * (1 + sum.defensePercent))),
    speed: Math.max(1, Math.round((base.speed + flat('speed')) * (1 + sum.speedPercent))),
    maxHealth: Math.max(1, Math.round((base.maxHealth + flat('maxHealth')) * (1 + sum.maxHealthPercent))),
    critChance: Math.min(TOWER_CAPS.critChance, base.critChance + extra('critChance') + sum.critChance),
    lifesteal: Math.min(TOWER_CAPS.lifesteal, base.lifesteal + extra('lifesteal') + sum.lifesteal),
    thorns: Math.min(TOWER_CAPS.thorns, base.thorns + extra('thorns') + sum.thorns),
    damageReduction: Math.min(TOWER_CAPS.damageReduction, base.damageReduction + sum.damageReduction),
    armorPiercing: Math.min(TOWER_CAPS.armorPiercing, base.armorPiercing + extra('armorPiercing') + sum.armorPiercing),
    healAfterCombat: sum.healAfterCombat,
    goldPercent: sum.goldPercent,
    cooldownReduction: sum.cooldownReduction,
  };
}

// ─────────────────────────────────────────────────────────────
// Marchand
// ─────────────────────────────────────────────────────────────

export type TowerOffer =
  | { kind: 'POTION'; price: number; sold: boolean }
  | { kind: 'HEAL'; price: number; sold: boolean }
  | { kind: 'GEAR'; price: number; sold: boolean; gear: TowerGear };

export const MERCHANT_HEAL = 0.4;

/**
 * Étal d'un marchand. Sur une carte dessinée, la salle choisit ses articles et leur prix ;
 * sans carte, le marchand vend une potion, des soins et une pièce d'équipement.
 */
export function rollMerchantOffers(
  floor: number,
  rng: TowerRng,
  kinds: readonly TowerOffer['kind'][] = ['POTION', 'HEAL', 'GEAR'],
  pricePercent = 100,
): TowerOffer[] {
  const price = (base: number) => Math.max(1, Math.round(base * pricePercent / 100));
  return kinds.map((kind): TowerOffer => {
    if (kind === 'POTION') return { kind, price: price(20 + floor * 2), sold: false };
    if (kind === 'HEAL') return { kind, price: price(25 + floor * 3), sold: false };
    return { kind, price: price(40 + floor * 5), sold: false, gear: rollTowerGear(floor, 'MERCHANT', rng) };
  });
}

// ─────────────────────────────────────────────────────────────
// Compétences
// ─────────────────────────────────────────────────────────────

/** Compétence du RPG figée à l'entrée : un changement de classe en cours de partie n'y touche pas. */
export type TowerSkill = {
  id: string;
  name: string;
  emoji: string;
  cooldownTurns: number;
  effect: SkillEffect;
};

export function effectiveCooldown(cooldownTurns: number, reduction: number): number {
  return Math.max(1, cooldownTurns - reduction);
}

// ─────────────────────────────────────────────────────────────
// Éclats et améliorations
// ─────────────────────────────────────────────────────────────

/** Éclats d'un étage franchi : la valeur croît par tranche de dix, un boss en vaut cinq de plus. */
export function floorShards(floor: number, shardsPerFloor: number, boss: boolean): number {
  return shardsPerFloor * (1 + Math.floor(floor / 10)) + (boss ? shardsPerFloor * 5 : 0);
}

export type TowerOutcome = 'DEAD' | 'LEFT';

export function settleShards(earned: number, outcome: TowerOutcome, deathShardPercent: number): number {
  if (outcome === 'LEFT') return earned;
  return Math.floor(earned * deathShardPercent / 100);
}

/** Lundi 00:00 UTC de la semaine d'une date. */
export function towerWeekStart(date: Date): Date {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - day);
  return start;
}

/** Part d'un gain qui passe sous le plafond hebdomadaire (0 = aucun plafond). */
export function applyWeeklyCap(amount: number, alreadyThisWeek: number, cap: number): number {
  if (cap <= 0) return amount;
  return Math.max(0, Math.min(amount, cap - alreadyThisWeek));
}

export const TOWER_UPGRADES = {
  potion: { emoji: '🧪', name: 'Besace', description: '+1 potion au départ de chaque ascension', maxLevel: 3, baseCost: 25 },
  vigor: { emoji: '💗', name: 'Vigueur', description: '+5 % de PV max dans la Tour', maxLevel: 5, baseCost: 40 },
} as const;
export type TowerUpgradeKey = keyof typeof TOWER_UPGRADES;
export const TOWER_UPGRADE_KEYS = Object.keys(TOWER_UPGRADES) as TowerUpgradeKey[];

export function towerUpgradeCost(key: TowerUpgradeKey, currentLevel: number): number {
  return TOWER_UPGRADES[key].baseCost * Math.pow(2, currentLevel);
}

export function parseTowerUpgrades(value: unknown): Record<TowerUpgradeKey, number> {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const levelOf = (key: TowerUpgradeKey) => {
    const raw = Number(record[key]);
    return Number.isFinite(raw) ? Math.min(TOWER_UPGRADES[key].maxLevel, Math.max(0, Math.trunc(raw))) : 0;
  };
  return { potion: levelOf('potion'), vigor: levelOf('vigor') };
}

export const STARTING_POTIONS = 1;
