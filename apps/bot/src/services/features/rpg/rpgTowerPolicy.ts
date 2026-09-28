/**
 * Règles de la Tour : formules, catalogue et bornes de réglage. Aucun accès base.
 *
 * La Tour est un mode roguelite dont les statistiques sont indépendantes du RPG. Ce qu'un
 * joueur y apporte de son profil passe par une compression logarithmique plafonnée : un
 * personnage cent fois plus fort n'y entre qu'avec quelques dizaines de pourcents de plus,
 * et la croissance exponentielle des monstres ne lui laisse que quelques étages d'avance.
 */

import type { SkillEffect } from './rpgClasses.js';
import { RPG_SKILL_NODES } from './rpgSkillTree.js';
import { RELIC_PERK_CHANCE, TOWER_RELIC_PERKS, type TowerRelicPerk } from './rpgTowerContent.js';
import { TOWER_FLOORS_AFTER, TOWER_OFFER_KINDS, type TowerFloorsAfter, type TowerOfferKind } from './rpgTowerMap.js';

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
  /** Part des éclats gardée en quittant hors palier sûr (juste après un boss, tout est gardé). */
  leaveShardPercent: number;
  weeklyShardCap: number;
  idleTimeoutMinutes: number;
  currencyName: string;
  currencyEmoji: string;
  upgrades: TowerUpgradeDef[];
  merchant: TowerMerchantSettings;
  /** Après le dernier étage dessiné : étages générés ou retour au premier. */
  floorsAfter: TowerFloorsAfter;
  /** Brouillard de guerre sur les étages générés ; les étages dessinés ont chacun le leur. */
  generatedFog: boolean;
  /** Ascension du jour : même graine pour tous, stats égales, une tentative par jour. */
  dailyEnabled: boolean;
  /** Salon où annoncer les records de la saison ; `null` pour ne rien annoncer. */
  announceChannelId: string | null;
  /** Prix en éclats d'une compétence du RPG, achetée pour une seule ascension. */
  skillPrice: number;
};

export const TOWER_DEFAULTS: TowerSettings = {
  enabled: false,
  name: 'La Tour',
  // Vide : le panneau pose alors l'icône de la Tour du bot plutôt qu'un emoji Unicode.
  emoji: '',
  description: '',
  entryMode: 'COMPRESSED',
  inheritCapPercent: 50,
  titleCapPercent: 30,
  floorGrowthPercent: 8,
  bossEvery: 10,
  blessingEvery: 5,
  maxBlessings: 6,
  shardsPerFloor: 10,
  deathShardPercent: 50,
  leaveShardPercent: 80,
  weeklyShardCap: 0,
  idleTimeoutMinutes: 30,
  currencyName: 'Éclats de Tour',
  currencyEmoji: '',
  upgrades: defaultTowerUpgrades(),
  merchant: defaultTowerMerchant(),
  floorsAfter: 'GENERATE',
  generatedFog: true,
  // À activer au dashboard : un classement quotidien n'a de sens que si le serveur le veut.
  dailyEnabled: false,
  announceChannelId: null,
  skillPrice: 10,
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
  leaveShardPercent: { min: 0, max: 100 },
  weeklyShardCap: { min: 0, max: 1_000_000 },
  idleTimeoutMinutes: { min: 5, max: 1440 },
  skillPrice: { min: 0, max: 1000 },
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
  const upgrades = normalizeTowerUpgrades(input.upgrades ?? []);
  if (!upgrades.ok) return upgrades;

  return {
    ok: true,
    value: {
      enabled: input.enabled === true,
      name,
      emoji: text(input.emoji),
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
      leaveShardPercent: int('leaveShardPercent'),
      weeklyShardCap: int('weeklyShardCap'),
      idleTimeoutMinutes: int('idleTimeoutMinutes'),
      currencyName,
      currencyEmoji: text(input.currencyEmoji),
      upgrades: input.upgrades === undefined || input.upgrades === null ? defaultTowerUpgrades() : upgrades.value,
      merchant: normalizeTowerMerchant(input.merchant),
      floorsAfter: TOWER_FLOORS_AFTER.includes(input.floorsAfter as TowerFloorsAfter)
        ? (input.floorsAfter as TowerFloorsAfter)
        : TOWER_DEFAULTS.floorsAfter,
      generatedFog: input.generatedFog !== false,
      dailyEnabled: input.dailyEnabled === true,
      announceChannelId: /^\d{15,25}$/.test(text(input.announceChannelId)) ? text(input.announceChannelId) : null,
      skillPrice: int('skillPrice'),
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
    emoji: text(input.emoji),
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

/** Jour de l'ascension du jour, en UTC : « 2026-09-28 ». */
export function towerDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Graine de l'ascension du jour, la même pour tout le serveur pendant la journée (FNV-1a). */
export function towerDailySeed(guildId: string, dayKey: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${guildId}:${dayKey}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
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
  /** Bonus des améliorations achetées avec des éclats, voir `towerUpgradeBonus`. */
  upgradeBonus?: TowerUpgradeBonus;
};

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
    const upgraded = 1 + (input.upgradeBonus?.[key] ?? 0);
    stats[key] = Math.max(1, Math.round(base * (input.classModifiers[key] ?? 1) * (1 + inherited + fromTitle) * upgraded));
  }

  return {
    ...stats,
    critChance: TOWER_BASE_CRIT
      + (input.classPassive.bonusCritChance ?? 0)
      + Math.min(TITLE_CRIT_CAP, Math.max(0, input.title.critPercent) / 200)
      + (input.upgradeBonus?.critChance ?? 0),
    armorPiercing: input.classPassive.armorPiercing ?? 0,
    damageReduction: input.classPassive.damageReduction ?? 0,
    lifesteal: 0,
    thorns: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Étages et monstres
// ─────────────────────────────────────────────────────────────

export const TOWER_DOORS = ['COMBAT', 'ELITE', 'TREASURE', 'CAMPFIRE', 'MERCHANT', 'EVENT', 'BOSS'] as const;
export type TowerDoor = (typeof TOWER_DOORS)[number];
export type TowerEncounterKind = 'COMBAT' | 'ELITE' | 'BOSS';

const DOOR_WEIGHTS: Record<Exclude<TowerDoor, 'BOSS'>, number> = {
  COMBAT: 45,
  ELITE: 18,
  TREASURE: 12,
  CAMPFIRE: 13,
  MERCHANT: 12,
  EVENT: 10,
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
 * Étage à partir duquel la croissance des monstres est divisée par deux. L'équipement ne
 * progresse que linéairement : à pleine croissance, le mur tombait d'un coup vers l'étage 40.
 */
export const TOWER_GROWTH_KNEE = 25;

export function towerFloorGrowth(floor: number, growthPercent: number): number {
  const steps = Math.max(0, floor - 1);
  const steep = Math.min(steps, TOWER_GROWTH_KNEE - 1);
  return Math.pow(1 + growthPercent / 100, steep) * Math.pow(1 + growthPercent / 200, steps - steep);
}

/**
 * Force d'un monstre, qui ne dépend que de l'étage : jamais du joueur. Deux joueurs au même
 * étage affrontent la même difficulté, et le classement reste comparable.
 */
export function towerMonsterStats(floor: number, growthPercent: number, kind: TowerEncounterKind): TowerMonsterStats {
  const growth = towerFloorGrowth(floor, growthPercent);
  const mult = ENCOUNTER_MULTIPLIERS[kind];
  return {
    health: Math.round(70 * growth * mult.health),
    attack: Math.round(13 * growth * mult.attack),
    defense: Math.round(6 * growth * mult.defense),
    speed: Math.round(9 * Math.pow(TOWER_MONSTER_SPEED_GROWTH, Math.max(0, floor - 1)) * mult.speed),
  };
}

export const TOWER_MONSTER_CRIT = 0.08;
/**
 * Croissance de la vitesse des monstres par étage. Plus lente que leur force, mais assez
 * rapide pour qu'une seule relique ne suffise pas à tenir l'esquive au plafond.
 */
export const TOWER_MONSTER_SPEED_GROWTH = 1.025;

/**
 * Esquive tirée de l'écart de vitesse : rien à vitesse égale ou inférieure, le plafond à
 * vitesse triple. La vitesse vaut quelque chose sans devenir un bonus plat que tout
 * équipement atteint.
 */
export const TOWER_DODGE_CAP = 0.25;
export const TOWER_DODGE_FULL_RATIO = 3;

export function towerDodgeChance(defenderSpeed: number, attackerSpeed: number): number {
  if (attackerSpeed <= 0 || defenderSpeed <= attackerSpeed) return 0;
  const ratio = defenderSpeed / attackerSpeed;
  return Math.min(TOWER_DODGE_CAP, ((ratio - 1) / (TOWER_DODGE_FULL_RATIO - 1)) * TOWER_DODGE_CAP);
}

/** Tous les combien de coups une élite ou un boss prépare un coup puissant (0 = jamais). */
export const TOWER_CHARGE_EVERY: Record<TowerEncounterKind, number> = { COMBAT: 0, ELITE: 5, BOSS: 4 };
export const TOWER_HEAVY_MULTIPLIER = 1.8;
/** Coup puissant reçu en garde (Défendre ou compétence défensive). */
export const TOWER_PARRIED_MULTIPLIER = 0.5;
/** Sous cette part de PV, un boss entre en rage. */
export const TOWER_ENRAGE_THRESHOLD = 0.3;
export const TOWER_ENRAGE_MULTIPLIER = 1.2;

/** Défendre soigne un peu et renforce la prochaine attaque. */
export const TOWER_DEFEND_HEAL = 0.05;
export const TOWER_RIPOSTE_MULTIPLIER = 1.3;

/** Part de l'or de la partie perdue en fuyant un combat. */
export const TOWER_FLEE_GOLD_LOSS = 0.25;

const KIND_GOLD: Record<TowerEncounterKind, number> = { COMBAT: 1, ELITE: 2, BOSS: 4 };

export function encounterGold(floor: number, kind: TowerEncounterKind, goldPercent: number, rng: TowerRng): number {
  const base = (6 + floor * 2) * KIND_GOLD[kind];
  return Math.round(base * (0.85 + rng.next() * 0.3) * (1 + goldPercent));
}

export function treasureGold(floor: number, rng: TowerRng): number {
  return Math.round((10 + floor * 3) * (0.85 + rng.next() * 0.3));
}

/**
 * Chance de butin par victoire. Un étage compte une dizaine de combats : à 35 % par monstre,
 * le joueur changeait d'équipement à chaque salle et ne choisissait plus rien.
 */
export const LOOT_CHANCE: Record<TowerEncounterKind, number> = { COMBAT: 0.05, ELITE: 0.2, BOSS: 0.45 };
export const CAMPFIRE_HEAL = 0.35;
export const BOSS_VICTORY_HEAL = 0.3;
export const MAX_POTIONS = 5;

/**
 * Profil d'une créature : la répartition de ses stats dans le bestiaire, à puissance égale.
 * Un golem y est plus robuste et plus lent, un assassin plus fragile et plus dangereux, sans
 * qu'aucun des deux ne soit plus fort qu'un autre monstre du même étage.
 */
export type TowerFoeShape = { health: number; attack: number; defense: number; speed: number };

/** Nom et emoji d'un adversaire, tirés du bestiaire du serveur ; vide, le panneau pose une icône. */
export type TowerFoeName = { name: string; emoji: string; shape?: TowerFoeShape };

const SHAPE_RANGE = { min: 0.7, max: 1.4 } as const;
const SPEED_SHAPE_RANGE = { min: 0.8, max: 1.3 } as const;

/**
 * Profil tiré des stats d'une fiche du bestiaire, rapportées aux stats de base d'un monstre de
 * la Tour. Santé, attaque et défense sont bornées puis ramenées à un produit de 1 : le profil
 * change la manière de combattre, jamais la difficulté.
 */
export function towerFoeShape(monster: { health: number; attack: number; defense: number; speed: number }): TowerFoeShape {
  const ratio = (value: number, base: number) => Math.max(0.01, value) / base;
  const h = ratio(monster.health, 70);
  const a = ratio(monster.attack, 13);
  const d = ratio(monster.defense, 6);
  const mean = Math.cbrt(h * a * d);
  const clamp = (value: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, value));
  const raw = { health: clamp(h / mean, SHAPE_RANGE), attack: clamp(a / mean, SHAPE_RANGE), defense: clamp(d / mean, SHAPE_RANGE) };
  const norm = Math.cbrt(raw.health * raw.attack * raw.defense);
  return {
    health: raw.health / norm,
    attack: raw.attack / norm,
    defense: raw.defense / norm,
    speed: clamp(ratio(monster.speed, 9) / mean, SPEED_SHAPE_RANGE),
  };
}

export const FALLBACK_MONSTERS: TowerFoeName[] = [
  { name: 'Gobelin des marches', emoji: '' },
  { name: 'Squelette gardien', emoji: '' },
  { name: 'Limace de pierre', emoji: '' },
  { name: 'Chauve-souris d\'écho', emoji: '' },
  { name: 'Araignée des combles', emoji: '' },
];

export const FALLBACK_BOSSES: TowerFoeName[] = [
  { name: 'Gardien de l\'étage', emoji: '' },
  { name: 'Liche de la Tour', emoji: '' },
  { name: 'Golem d\'airain', emoji: '' },
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
  /** Effet unique d'une relique. */
  perk?: TowerRelicPerk;
};

export type TowerGearSet = Record<TowerGearSlot, TowerGear | null>;
export const EMPTY_GEAR: TowerGearSet = { weapon: null, armor: null, relic: null };

const RARITY_MULT: Record<TowerRarity, number> = { COMMON: 1, UNCOMMON: 1.2, RARE: 1.45, EPIC: 1.75, LEGENDARY: 2.1 };

export type TowerLootSource = TowerEncounterKind | 'TREASURE' | 'MERCHANT';

/** Raretés du butin : l'épique et le légendaire restent des événements, même sur un gardien. */
const RARITY_WEIGHTS: Record<TowerLootSource, Record<TowerRarity, number>> = {
  COMBAT: { COMMON: 83.62, UNCOMMON: 12, RARE: 3.5, EPIC: 0.8, LEGENDARY: 0.08 },
  ELITE: { COMMON: 74.3, UNCOMMON: 16, RARE: 7.5, EPIC: 2, LEGENDARY: 0.2 },
  BOSS: { COMMON: 48.7, UNCOMMON: 30, RARE: 15, EPIC: 5.5, LEGENDARY: 0.8 },
  TREASURE: { COMMON: 78.3, UNCOMMON: 14, RARE: 6, EPIC: 1.5, LEGENDARY: 0.2 },
  MERCHANT: { COMMON: 70.8, UNCOMMON: 18, RARE: 9, EPIC: 2, LEGENDARY: 0.2 },
};

const GEAR_NAMES: Record<TowerGearSlot, TowerFoeName[]> = {
  weapon: [
    { name: 'Lame d\'escalier', emoji: '' },
    { name: 'Hache du palier', emoji: '' },
    { name: 'Arc des meurtrières', emoji: '' },
    { name: 'Bâton de vigie', emoji: '' },
    { name: 'Marteau de rampe', emoji: '' },
  ],
  armor: [
    { name: 'Cotte de gardien', emoji: '' },
    { name: 'Plastron de pierre', emoji: '' },
    { name: 'Manteau des courants d\'air', emoji: '' },
    { name: 'Brigandine rouillée', emoji: '' },
  ],
  relic: [
    { name: 'Œil de la Tour', emoji: '' },
    { name: 'Clé sans serrure', emoji: '' },
    { name: 'Sablier fêlé', emoji: '' },
    { name: 'Plume d\'aigle', emoji: '' },
    { name: 'Dent de dragon', emoji: '' },
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
    if (rng.next() < (RELIC_PERK_CHANCE[rarity] ?? 0)) gear.perk = rng.pick(TOWER_RELIC_PERKS);
  }
  return gear;
}

/**
 * Objet d'un fantôme, ramené à la profondeur de celui qui le trouve : il garde son nom, sa
 * rareté, son pouvoir de relique et son effet, mais ses stats suivent le même barème que le
 * butin de cette profondeur, au milieu de la fourchette. Sans quoi un joueur tombé très haut
 * laisserait, sur un étage qui revient en boucle, une arme qui écraserait les débutants.
 */
export function rescaleTowerGear(gear: TowerGear, floor: number): TowerGear {
  const mult = RARITY_MULT[gear.rarity] ?? 1;
  const scaled: TowerGear = { ...gear };
  if (gear.slot === 'weapon') {
    scaled.attack = Math.round((6 + floor * 2.2) * mult);
    scaled.speed = gear.speed > 0 ? Math.round((1 + floor * 0.4) * mult) : 0;
  } else if (gear.slot === 'armor') {
    scaled.defense = Math.round((4 + floor * 1.6) * mult);
    scaled.maxHealth = Math.round((12 + floor * 5) * mult);
  } else {
    // Le pouvoir d'une relique ne dépend que de sa rareté : seule sa vitesse suit la profondeur.
    scaled.speed = Math.round((2 + floor * 0.6) * mult);
  }
  return scaled;
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
  /** Clé d'icône du bot (`rpgIcons.icon`). */
  icon: string;
  name: string;
  description: string;
  maxRank: number;
  /** Effet d'UN rang : les rangs s'additionnent. */
  perRank: TowerBlessingEffect;
};

export const TOWER_BLESSINGS: TowerBlessing[] = [
  { id: 'might', icon: 'rpgAtk', name: 'Puissance', description: '+12 % d\'attaque par rang', maxRank: 3, perRank: { attackPercent: 0.12 } },
  { id: 'bulwark', icon: 'rpgDef', name: 'Rempart', description: '+12 % de défense par rang', maxRank: 3, perRank: { defensePercent: 0.12 } },
  { id: 'vitality', icon: 'rpgHp', name: 'Vitalité', description: '+15 % de PV max par rang', maxRank: 3, perRank: { maxHealthPercent: 0.15 } },
  { id: 'swift', icon: 'rpgSpd', name: 'Célérité', description: '+12 % de vitesse par rang', maxRank: 3, perRank: { speedPercent: 0.12 } },
  { id: 'keen', icon: 'rpgCrit', name: 'Œil vif', description: '+5 % de coups critiques par rang', maxRank: 3, perRank: { critChance: 0.05 } },
  { id: 'leech', icon: 'rpgPotion', name: 'Sangsue', description: '+5 % de vol de vie par rang', maxRank: 3, perRank: { lifesteal: 0.05 } },
  { id: 'thorns', icon: 'shield', name: 'Ronces', description: '+10 % de dégâts renvoyés par rang', maxRank: 3, perRank: { thorns: 0.1 } },
  { id: 'stoneskin', icon: 'rpgArmor', name: 'Peau de pierre', description: '-5 % de dégâts subis par rang', maxRank: 3, perRank: { damageReduction: 0.05 } },
  { id: 'piercing', icon: 'rpgSword', name: 'Perce-armure', description: '+10 % de défense ignorée par rang', maxRank: 3, perRank: { armorPiercing: 0.1 } },
  { id: 'second_wind', icon: 'rpgRest', name: 'Second souffle', description: 'Rend 8 % des PV après chaque victoire, par rang', maxRank: 3, perRank: { healAfterCombat: 0.08 } },
  { id: 'greed', icon: 'coins', name: 'Avarice', description: '+25 % d\'or par rang', maxRank: 2, perRank: { goldPercent: 0.25 } },
  { id: 'focus', icon: 'rpgEnergy', name: 'Concentration', description: 'Recharge des compétences réduite d\'un tour', maxRank: 1, perRank: { cooldownReduction: 1 } },
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

/**
 * Réglages du marchand : prix de base, hausse par étage et puissance des soins. Les potions
 * trouvées ou achetées soignent toutes de `potionHealPercent`.
 */
export type TowerMerchantSettings = {
  /** Articles du marchand en mode aléatoire ; une salle de carte choisit les siens. */
  offers: TowerOfferKind[];
  potionPrice: number;
  potionPricePerFloor: number;
  healPrice: number;
  healPricePerFloor: number;
  healPercent: number;
  gearPrice: number;
  gearPricePerFloor: number;
  potionHealPercent: number;
};

/** Fonction plutôt que constante : `TOWER_DEFAULTS`, plus haut dans le module, en a besoin à l'initialisation. */
export function defaultTowerMerchant(): TowerMerchantSettings {
  return {
    offers: [...TOWER_OFFER_KINDS],
    potionPrice: 20,
    potionPricePerFloor: 2,
    healPrice: 25,
    healPricePerFloor: 3,
    healPercent: 40,
    gearPrice: 40,
    gearPricePerFloor: 5,
    potionHealPercent: 35,
  };
}

export const TOWER_MERCHANT_DEFAULTS: TowerMerchantSettings = defaultTowerMerchant();

export const TOWER_MERCHANT_RANGES = {
  potionPrice: { min: 1, max: 100_000 },
  potionPricePerFloor: { min: 0, max: 10_000 },
  healPrice: { min: 1, max: 100_000 },
  healPricePerFloor: { min: 0, max: 10_000 },
  healPercent: { min: 5, max: 100 },
  gearPrice: { min: 1, max: 100_000 },
  gearPricePerFloor: { min: 0, max: 10_000 },
  potionHealPercent: { min: 5, max: 100 },
} as const;

export function normalizeTowerMerchant(input: unknown): TowerMerchantSettings {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const int = (key: keyof typeof TOWER_MERCHANT_RANGES) => clampInt(raw[key], TOWER_MERCHANT_RANGES[key], TOWER_MERCHANT_DEFAULTS[key]);
  const offers = Array.isArray(raw.offers)
    ? TOWER_OFFER_KINDS.filter((kind) => (raw.offers as unknown[]).includes(kind))
    : [...TOWER_MERCHANT_DEFAULTS.offers];
  return {
    // Un marchand sans rien à vendre ne serait qu'une porte perdue.
    offers: offers.length > 0 ? offers : [...TOWER_MERCHANT_DEFAULTS.offers],
    potionPrice: int('potionPrice'),
    potionPricePerFloor: int('potionPricePerFloor'),
    healPrice: int('healPrice'),
    healPricePerFloor: int('healPricePerFloor'),
    healPercent: int('healPercent'),
    gearPrice: int('gearPrice'),
    gearPricePerFloor: int('gearPricePerFloor'),
    potionHealPercent: int('potionHealPercent'),
  };
}

/**
 * Étal d'un marchand. Sur une carte dessinée, la salle choisit ses articles et module leur
 * prix ; sans carte, le marchand vend les articles des réglages.
 */
export function rollMerchantOffers(
  floor: number,
  rng: TowerRng,
  kinds: readonly TowerOffer['kind'][] = TOWER_MERCHANT_DEFAULTS.offers,
  pricePercent = 100,
  merchant: TowerMerchantSettings = TOWER_MERCHANT_DEFAULTS,
): TowerOffer[] {
  const price = (base: number, perFloor: number) => Math.max(1, Math.round((base + floor * perFloor) * pricePercent / 100));
  return kinds.map((kind): TowerOffer => {
    if (kind === 'POTION') return { kind, price: price(merchant.potionPrice, merchant.potionPricePerFloor), sold: false };
    if (kind === 'HEAL') return { kind, price: price(merchant.healPrice, merchant.healPricePerFloor), sold: false };
    return { kind, price: price(merchant.gearPrice, merchant.gearPricePerFloor), sold: false, gear: rollTowerGear(floor, 'MERCHANT', rng) };
  });
}

/** Prix pour renouveler l'équipement d'un marchand : un quart d'une pièce au prix normal. */
export function towerRerollPrice(floor: number, merchant: TowerMerchantSettings = TOWER_MERCHANT_DEFAULTS): number {
  return Math.max(1, Math.round((merchant.gearPrice + floor * merchant.gearPricePerFloor) / 4));
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
  /** Palier dans l'arbre (1 à 4), qui fixe son prix d'achat ; absent des parties d'avant. */
  tier?: number;
};

/**
 * Prix d'une compétence selon son palier : une compétence du bout de l'arbre coûte le triple
 * d'une compétence de départ. Les compétences de classe comptent comme les paliers 1 et 2.
 */
export const TOWER_SKILL_TIER_PRICE: Record<number, number> = { 1: 1, 2: 1.5, 3: 2, 4: 3 };
const CLASS_SKILL_TIER2_LEVEL = 12;

export function towerSkillTier(skill: { id: string; levelRequired: number }): number {
  const node = RPG_SKILL_NODES.find((candidate) => candidate.grantsSkill?.id === skill.id);
  if (node) return node.tier;
  return skill.levelRequired >= CLASS_SKILL_TIER2_LEVEL ? 2 : 1;
}

export function towerSkillPrice(basePrice: number, skill: TowerSkill): number {
  return Math.round(basePrice * (TOWER_SKILL_TIER_PRICE[skill.tier ?? 1] ?? 1));
}

/**
 * Une compétence du RPG ramenée à la Tour. Taillées pour des combats isolés, elles écrasaient
 * une ascension où les combats s'enchaînent sans repos : un vol de vie à 70 % rendait le
 * joueur quasi immortel. Les dégâts gardent la moitié de leur bonus, le vol de vie et les
 * soins sont plafonnés, et chaque compétence revient un tour plus tard.
 */
export const TOWER_SKILL_TUNING = {
  damageBonus: 0.5,
  lifesteal: { factor: 0.35, max: 0.15 },
  heal: { factor: 0.5, max: 0.12 },
  armorPiercing: 0.6,
  defenseMax: 1.5,
  extraCooldown: 1,
  minCooldown: 3,
} as const;

export function towerSkill(skill: TowerSkill): TowerSkill {
  const t = TOWER_SKILL_TUNING;
  const e = skill.effect;
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    ...skill,
    cooldownTurns: Math.max(t.minCooldown, skill.cooldownTurns + t.extraCooldown),
    effect: {
      ...e,
      damageMultiplier: e.damageMultiplier > 0 ? round(1 + (e.damageMultiplier - 1) * t.damageBonus) : 0,
      ...(e.lifesteal ? { lifesteal: round(Math.min(t.lifesteal.max, e.lifesteal * t.lifesteal.factor)) } : {}),
      ...(e.healPercent ? { healPercent: round(Math.min(t.heal.max, e.healPercent * t.heal.factor)) } : {}),
      ...(e.armorPiercing ? { armorPiercing: round(e.armorPiercing * t.armorPiercing) } : {}),
      ...(e.defenseMultiplier ? { defenseMultiplier: Math.min(t.defenseMax, e.defenseMultiplier) } : {}),
    },
  };
}

export function effectiveCooldown(cooldownTurns: number, reduction: number): number {
  return Math.max(1, cooldownTurns - reduction);
}

// ─────────────────────────────────────────────────────────────
// Éclats et améliorations
// ─────────────────────────────────────────────────────────────

/** Éclats d'un étage franchi : la valeur croît par tranche de dix, un boss en vaut cinq de plus. */
/**
 * Éclats d'un étage gravi : la valeur de base, qui augmente tous les 10 étages, doublée quand
 * l'étage se termine sur un gardien vaincu.
 */
export function floorShards(floor: number, shardsPerFloor: number, boss: boolean): number {
  return shardsPerFloor * (1 + Math.floor(floor / 10)) * (boss ? 2 : 1);
}

export type TowerOutcome = 'DEAD' | 'LEFT';

/**
 * Éclats gardés en fin de partie. Partir sur un palier sûr (juste après un boss) garde tout ;
 * partir ailleurs en garde `leaveShardPercent`, sans quoi il suffisait de quitter dès que les
 * PV baissaient pour ne jamais subir la pénalité de mort.
 */
export function settleShards(
  earned: number,
  outcome: TowerOutcome,
  deathShardPercent: number,
  leaveShardPercent = 100,
  safe = false,
): number {
  if (outcome === 'LEFT') return safe ? earned : Math.floor(earned * leaveShardPercent / 100);
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

/**
 * Améliorations permanentes achetées avec des éclats, réglées par serveur. Le profil garde
 * le niveau acheté de chaque amélioration sous son `id` : renommer ou réévaluer une
 * amélioration garde les niveaux, la supprimer les rend inertes.
 */
export const TOWER_UPGRADE_EFFECTS = ['POTION', 'HEALTH', 'ATTACK', 'DEFENSE', 'SPEED', 'CRIT', 'GOLD'] as const;
export type TowerUpgradeEffect = (typeof TOWER_UPGRADE_EFFECTS)[number];

export type TowerUpgradeDef = {
  id: string;
  enabled: boolean;
  /** Vide : le panneau affiche le nom de l'effet dans la langue du joueur. */
  name: string;
  emoji: string;
  description: string;
  effect: TowerUpgradeEffect;
  /**
   * Gain d'un niveau : potions de départ (POTION), pourcentage de la stat (HEALTH, ATTACK,
   * DEFENSE, SPEED), points de pourcentage de critique (CRIT) ou or de départ (GOLD).
   */
  perLevel: number;
  maxLevel: number;
  baseCost: number;
  /** Hausse du prix à chaque niveau, en pourcentage : 100 double le prix. */
  costGrowthPercent: number;
};

export const TOWER_UPGRADES_MAX = 10;
export const TOWER_UPGRADE_PER_LEVEL_RANGES: Record<TowerUpgradeEffect, { min: number; max: number }> = {
  POTION: { min: 1, max: 5 },
  HEALTH: { min: 1, max: 100 },
  ATTACK: { min: 1, max: 100 },
  DEFENSE: { min: 1, max: 100 },
  SPEED: { min: 1, max: 100 },
  CRIT: { min: 1, max: 20 },
  GOLD: { min: 1, max: 10_000 },
};
export const TOWER_UPGRADE_RANGES = {
  maxLevel: { min: 1, max: 20 },
  baseCost: { min: 1, max: 1_000_000 },
  costGrowthPercent: { min: 0, max: 300 },
} as const;
const UPGRADE_ID = /^[a-z0-9_-]{1,24}$/;

export function defaultTowerUpgrades(): TowerUpgradeDef[] {
  return [
    { id: 'potion', enabled: true, name: '', emoji: '', description: '', effect: 'POTION', perLevel: 1, maxLevel: 3, baseCost: 25, costGrowthPercent: 100 },
    { id: 'vigor', enabled: true, name: '', emoji: '', description: '', effect: 'HEALTH', perLevel: 5, maxLevel: 5, baseCost: 40, costGrowthPercent: 100 },
  ];
}

export function normalizeTowerUpgrades(input: unknown): TowerNormalizeResult<TowerUpgradeDef[]> {
  if (!Array.isArray(input)) return { ok: false, error: 'La liste des améliorations est invalide.' };
  if (input.length > TOWER_UPGRADES_MAX) return { ok: false, error: `La Tour compte au plus ${TOWER_UPGRADES_MAX} améliorations.` };
  const seen = new Set<string>();
  const upgrades: TowerUpgradeDef[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'Amélioration invalide.' };
    const raw = entry as Record<string, unknown>;
    const id = text(raw.id).toLowerCase();
    if (!UPGRADE_ID.test(id)) return { ok: false, error: 'Identifiant d\'amélioration invalide.' };
    if (seen.has(id)) return { ok: false, error: 'Deux améliorations portent le même identifiant.' };
    seen.add(id);
    const effect = TOWER_UPGRADE_EFFECTS.includes(raw.effect as TowerUpgradeEffect) ? (raw.effect as TowerUpgradeEffect) : null;
    if (!effect) return { ok: false, error: 'Effet d\'amélioration inconnu.' };
    const name = text(raw.name);
    if (name.length > TOWER_NAME_MAX) return { ok: false, error: `Le nom ne peut pas dépasser ${TOWER_NAME_MAX} caractères.` };
    const description = text(raw.description);
    if (description.length > TOWER_DESCRIPTION_MAX) {
      return { ok: false, error: `La description ne peut pas dépasser ${TOWER_DESCRIPTION_MAX} caractères.` };
    }
    const perLevelRange = TOWER_UPGRADE_PER_LEVEL_RANGES[effect];
    upgrades.push({
      id,
      enabled: raw.enabled !== false,
      name,
      emoji: text(raw.emoji),
      description,
      effect,
      perLevel: clampInt(raw.perLevel, perLevelRange, perLevelRange.min),
      maxLevel: clampInt(raw.maxLevel, TOWER_UPGRADE_RANGES.maxLevel, 1),
      baseCost: clampInt(raw.baseCost, TOWER_UPGRADE_RANGES.baseCost, 50),
      costGrowthPercent: clampInt(raw.costGrowthPercent, TOWER_UPGRADE_RANGES.costGrowthPercent, 100),
    });
  }
  return { ok: true, value: upgrades };
}

export function towerUpgradeCost(upgrade: Pick<TowerUpgradeDef, 'baseCost' | 'costGrowthPercent'>, currentLevel: number): number {
  return Math.round(upgrade.baseCost * Math.pow(1 + upgrade.costGrowthPercent / 100, currentLevel));
}

/** Niveaux achetés, bornés au niveau maximal actuel ; une amélioration supprimée n'a plus de niveau. */
export function parseTowerUpgrades(value: unknown, upgrades: readonly TowerUpgradeDef[]): Record<string, number> {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const levels: Record<string, number> = {};
  for (const upgrade of upgrades) {
    const raw = Number(record[upgrade.id]);
    levels[upgrade.id] = Number.isFinite(raw) ? Math.min(upgrade.maxLevel, Math.max(0, Math.trunc(raw))) : 0;
  }
  return levels;
}

export type TowerUpgradeBonus = Record<TowerStatKey, number> & { critChance: number; potions: number; gold: number };

/**
 * Effet cumulé des améliorations achetées. Une amélioration désactivée ne se vend plus mais
 * ses niveaux restent acquis : les éclats dépensés ne partent pas en fumée.
 */
export function towerUpgradeBonus(upgrades: readonly TowerUpgradeDef[], levels: Record<string, number>): TowerUpgradeBonus {
  const bonus: TowerUpgradeBonus = { attack: 0, defense: 0, speed: 0, maxHealth: 0, critChance: 0, potions: 0, gold: 0 };
  for (const upgrade of upgrades) {
    const gain = upgrade.perLevel * (levels[upgrade.id] ?? 0);
    switch (upgrade.effect) {
      case 'POTION': bonus.potions += gain; break;
      case 'HEALTH': bonus.maxHealth += gain / 100; break;
      case 'ATTACK': bonus.attack += gain / 100; break;
      case 'DEFENSE': bonus.defense += gain / 100; break;
      case 'SPEED': bonus.speed += gain / 100; break;
      case 'CRIT': bonus.critChance += gain / 100; break;
      case 'GOLD': bonus.gold += gain; break;
    }
  }
  return bonus;
}

export const STARTING_POTIONS = 1;
