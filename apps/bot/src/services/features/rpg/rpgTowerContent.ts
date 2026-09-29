/**
 * Contenu de la Tour qui donne du relief aux combats et à l'exploration : traits des
 * monstres, mécaniques des gardiens, effets uniques des reliques et événements.
 *
 * Catalogues fixes et constantes, sans aucun import : la carte, les règles et le moteur les
 * partagent sans risque de dépendance circulaire. Les libellés sont traduits par le panneau.
 */

// ─────────────────────────────────────────────────────────────
// Traits des monstres
// ─────────────────────────────────────────────────────────────

/**
 * Trait visible avant le combat, qui appelle une réponse : un monstre blindé récompense le
 * perce-armure, un vampire une mise à mort rapide, un épineux la prudence.
 */
export const TOWER_TRAITS = ['ARMORED', 'VAMPIRIC', 'SWIFT', 'THORNY', 'BERSERK', 'REGENERATING'] as const;
export type TowerTrait = (typeof TOWER_TRAITS)[number];

/** Multiplicateurs de stats de chaque trait ; les effets en combat sont dans le moteur. */
export const TRAIT_STATS: Record<TowerTrait, { health?: number; attack?: number; defense?: number; speed?: number }> = {
  ARMORED: { defense: 1.8, speed: 0.9 },
  VAMPIRIC: {},
  SWIFT: { speed: 1.6, health: 0.9 },
  THORNY: {},
  BERSERK: { attack: 1.25, health: 0.85 },
  REGENERATING: {},
};

/** Part des dégâts infligés qu'un vampire récupère. */
export const VAMPIRIC_DRAIN = 0.3;
/** Part des dégâts reçus qu'un épineux renvoie. */
export const THORNY_REFLECT = 0.15;
/** Soin d'un monstre qui se régénère, à chaque tour, en part de ses PV max. */
export const REGENERATION = 0.05;
/** Traits imposés à une salle au plus. */
export const TOWER_ROOM_TRAITS_MAX = 2;
/** À partir de ce niveau, un monstre ordinaire peut porter un trait. */
export const TRAIT_MONSTER_LEVEL = 15;
export const TRAIT_MONSTER_CHANCE = 0.2;

// ─────────────────────────────────────────────────────────────
// Mécaniques des gardiens
// ─────────────────────────────────────────────────────────────

/** Mécanique propre à un gardien, en plus de ses coups puissants et de sa rage. */
export const TOWER_BOSS_MECHANICS = ['SHIELD', 'SUMMONER', 'PHASES'] as const;
export type TowerBossMechanic = (typeof TOWER_BOSS_MECHANICS)[number];
/** Réglage d'une salle de gardien : tirée au hasard, aucune, ou imposée. */
export const TOWER_MECHANIC_CHOICES = ['RANDOM', 'NONE', ...TOWER_BOSS_MECHANICS] as const;
export type TowerMechanicChoice = (typeof TOWER_MECHANIC_CHOICES)[number];

/** Bouclier de départ, en part des PV max : il encaisse avant les PV. */
export const SHIELD_SHARE = 0.35;
/** Un sbire tous les N coups, jusqu'à un plafond ; chacun ajoute une part d'attaque au gardien. */
export const SUMMON_EVERY = 3;
export const SUMMON_MAX = 3;
export const SUMMON_POWER = 0.25;
/** Une compétence au moins aussi puissante disperse les sbires. */
export const DISPEL_SKILL_MULTIPLIER = 2;
/** Seconde phase : sous ce seuil, le gardien se soigne et se renforce, une fois. */
export const PHASE_THRESHOLD = 0.5;
export const PHASE_HEAL = 0.2;
export const PHASE_BOOST = 1.25;

// ─────────────────────────────────────────────────────────────
// Reliques
// ─────────────────────────────────────────────────────────────

/** Effet unique d'une relique, au-delà de ses stats. */
export const TOWER_RELIC_PERKS = ['FIRST_STRIKE', 'LAST_STAND', 'EXECUTE', 'GUARDIAN_POTION', 'SHARD_SEEKER'] as const;
export type TowerRelicPerk = (typeof TOWER_RELIC_PERKS)[number];

/** Chance qu'une relique porte un effet, selon sa rareté : un effet unique doit rester rare. */
export const RELIC_PERK_CHANCE: Record<string, number> = { COMMON: 0, UNCOMMON: 0, RARE: 0.05, EPIC: 0.15, LEGENDARY: 0.3 };
/** EXECUTE : bonus de dégâts contre une cible affaiblie. */
export const EXECUTE_THRESHOLD = 0.3;
export const EXECUTE_BONUS = 1.5;
/** SHARD_SEEKER : éclats gagnés en plus. */
export const SHARD_SEEKER_BONUS = 0.2;

// ─────────────────────────────────────────────────────────────
// Événements
// ─────────────────────────────────────────────────────────────

/** Choix narratif d'une salle d'événement. Chaque événement propose deux options. */
export const TOWER_EVENTS = ['BLOOD_ALTAR', 'GAMBLER', 'SPRING', 'BLACKSMITH', 'CURSED_PACT'] as const;
export type TowerEventId = (typeof TOWER_EVENTS)[number];
export const TOWER_EVENT_CHOICES = ['RANDOM', ...TOWER_EVENTS] as const;
export type TowerEventChoice = (typeof TOWER_EVENT_CHOICES)[number];

/** BLOOD_ALTAR : PV sacrifiés (part des PV max) contre une bénédiction. */
export const ALTAR_COST = 0.2;
/** SPRING : soin de la source. */
export const SPRING_HEAL = 0.3;
/** BLACKSMITH : prix et gain d'une pièce reforgée. */
export const BLACKSMITH_BASE_PRICE = 20;
export const BLACKSMITH_PRICE_PER_LEVEL = 3;
export const BLACKSMITH_BOOST = 1.15;
/** CURSED_PACT : or gagné (en coffres) et force ajoutée aux monstres par malédiction. */
export const PACT_TREASURES = 3;
export const CURSE_ATTACK = 0.1;

export function blacksmithPrice(level: number): number {
  return BLACKSMITH_BASE_PRICE + Math.max(1, level) * BLACKSMITH_PRICE_PER_LEVEL;
}

// ─────────────────────────────────────────────────────────────
// Salles d'étage : mimique, mercenaire, piège ; ambiances d'étage
// ─────────────────────────────────────────────────────────────

/** Mimique : un coffre qui mord. Son butin est garanti, c'est ce qui paie le risque. */
export const MIMIC_NAME = 'Mimique';
/** Part des coffres d'un étage généré qui sont des mimiques. */
export const MIMIC_CHANCE = 0.25;

/** Mercenaire : frappe à chaque tour jusqu'à la fin de l'étage, pour une part de l'attaque du joueur. */
export const ALLY_POWER = 0.35;
export function mercenaryPrice(level: number): number {
  return 30 + Math.max(1, level) * 4;
}

/**
 * Chaleur : des malédictions que le joueur s'impose au départ, chacune contre plus d'éclats.
 * FEROCIOUS : monstres plus robustes et plus forts. FAMINE : tous les soins réduits de moitié.
 * GREED : marchands plus chers. DRY : départ sans potion.
 */
export const TOWER_HEATS = ['FEROCIOUS', 'FAMINE', 'GREED', 'DRY'] as const;
export type TowerHeat = (typeof TOWER_HEATS)[number];
export const HEAT_SHARD_BONUS = 0.25;
export const HEAT_FOE_BOOST = 1.2;
export const HEAT_FAMINE_HEAL = 0.5;
export const HEAT_GREED_PRICE = 1.5;

/** Chaleur choisie : le bit `i` désigne la i-ème de `TOWER_HEATS`. */
export function heatsFromMask(mask: number): TowerHeat[] {
  return TOWER_HEATS.filter((_, index) => (mask & (1 << index)) !== 0);
}

/**
 * Mentor : enseigne, contre de l'or, une des compétences du RPG que le joueur n'a pas achetées
 * au départ. Une seule par salle, parmi quelques-unes proposées.
 */
export const MENTOR_OFFERS = 3;
export function mentorPrice(level: number): number {
  return 40 + Math.max(1, level) * 5;
}

/** Embuscade : le monstre frappe avant que le combat ne commence, sans jamais achever. */
export const AMBUSH_DAMAGE = 0.08;

/**
 * Source commune : une fontaine partagée par tout le serveur. On y verse de l'or, on y boit
 * un soin qui puise dans la réserve. Une seule action par visite.
 */
export const FOUNTAIN_HEAL = 0.4;
export function fountainDrinkCost(level: number): number {
  return 20 + Math.max(1, level) * 2;
}
export function fountainDonation(level: number): number {
  return 10 + Math.max(1, level);
}

/** Oracle : contre de l'or, révèle tout l'étage sous le brouillard, ou montre le chemin de la sortie. */
export function oraclePrice(level: number): number {
  return 25 + Math.max(1, level) * 3;
}

/** Prisonnier : l'or offert par un captif libéré, en multiple d'un coffre de la profondeur. */
export const CAPTIVE_GOLD = 2;

/** Piège : dégâts en part des PV max, jamais mortels ; la vitesse permet de l'éviter. */
export const TRAP_DAMAGE = 0.12;
export const TRAP_DODGE = { min: 0.1, max: 0.75 } as const;

/** Étage inondé : vitesse du joueur réduite. */
export const FLOODED_SPEED = 0.8;
/** Étage en feu : PV perdus en entrant dans une nouvelle salle, jamais mortels. */
export const BURN_DAMAGE = 0.03;
/** Étage béni : soins renforcés. */
export const BLESSED_HEAL = 1.25;
/** Étage dans la brume : le brouillard est forcé, mais les coffres rapportent plus d'or. */
export const MIST_CHEST_GOLD = 1.25;
/**
 * Salles explorées sur l'étage (résolues, entrées non comprises) au bout desquelles la brume
 * se lève, avec son brouillard et son bonus. Des salles, pas des pas : faire des allers-retours
 * ne la lève pas.
 */
export const MIST_LIFT_ROOMS = 8;
/** Étage en feu : le feu part d'une salle à au moins cette distance de l'entrée. */
export const FIRE_START_DISTANCE = 3;
/** Étage gelé : le premier coup de chaque combat, d'un côté comme de l'autre, est amorti. */
export const FROST_FIRST_HIT = 0.5;
/** Nuit sans lune : les errants font deux pas au lieu d'un, les embuscades paient plus. */
export const MOONLESS_WANDERER_STEPS = 2;
export const MOONLESS_AMBUSH_BOUNTY = 1.5;
