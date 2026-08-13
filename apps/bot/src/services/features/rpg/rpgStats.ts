/**
 * Calcul des statistiques effectives d'un personnage.
 *
 * SOURCE DE VÉRITÉ UNIQUE : les colonnes `attack`/`defense`/`speed`/`maxHealth` du profil
 * contiennent les stats de BASE (niveaux + points investis). Tous les bonus - équipement,
 * améliorations de forge, classe - sont recalculés ici à chaque lecture.
 *
 * Ce choix remplace l'ancien modèle où les bonus étaient additionnés dans les colonnes à
 * l'équipement : chaque source de bonus supplémentaire y multipliait les risques de dérive
 * permanente (objet supprimé, reset partiel, double comptage en combat).
 */

import { getRpgClass } from './rpgClasses.js';

/** Sous-ensemble de `RpgItem` nécessaire au calcul. */
export type StatItem = {
  atkBonus: number;
  defBonus: number;
  spdBonus: number;
  hpBonus: number;
  rarity: string;
};

export type StatProfile = {
  level: number;
  attack: number;
  defense: number;
  speed: number;
  maxHealth: number;
  className: string | null;
  weaponUpgrade: number;
  armorUpgrade: number;
  accessoryUpgrade: number;
};

export type Equipment = {
  weapon: StatItem | null;
  armor: StatItem | null;
  accessory: StatItem | null;
};

export type EffectiveStats = {
  attack: number;
  defense: number;
  speed: number;
  maxHealth: number;
  /** Chance de coup critique totale, de 0 à 1. */
  critChance: number;
  /** Part de la défense adverse ignorée, de 0 à 1. */
  armorPiercing: number;
  /** Part des dégâts subis annulée par le passif de classe, de 0 à 1. */
  damageReduction: number;
};

export const MAX_UPGRADE_LEVEL = 10;
export const BASE_CRIT_CHANCE = 0.1;

/** Chance de critique accordée par la rareté de l'arme équipée. */
const RARITY_CRIT_BONUS: Record<string, number> = {
  COMMON: 0,
  UNCOMMON: 0.02,
  RARE: 0.04,
  EPIC: 0.07,
  LEGENDARY: 0.12,
};

/**
 * Bonus apporté par l'amélioration d'un objet : +12 % de ses stats de base par niveau,
 * avec un minimum de +1 par niveau pour qu'améliorer un objet faible reste utile.
 */
export function upgradeBonus(baseValue: number, upgradeLevel: number): number {
  if (baseValue <= 0 || upgradeLevel <= 0) return 0;
  return Math.max(upgradeLevel, Math.round(baseValue * 0.12 * upgradeLevel));
}

function itemContribution(item: StatItem | null, upgrade: number) {
  if (!item) return { atk: 0, def: 0, spd: 0, hp: 0 };
  return {
    atk: item.atkBonus + upgradeBonus(item.atkBonus, upgrade),
    def: item.defBonus + upgradeBonus(item.defBonus, upgrade),
    spd: item.spdBonus + upgradeBonus(item.spdBonus, upgrade),
    hp: item.hpBonus + upgradeBonus(item.hpBonus, upgrade),
  };
}

export function getEffectiveStats(profile: StatProfile, equipment: Equipment): EffectiveStats {
  const weapon = itemContribution(equipment.weapon, profile.weaponUpgrade);
  const armor = itemContribution(equipment.armor, profile.armorUpgrade);
  const accessory = itemContribution(equipment.accessory, profile.accessoryUpgrade);

  const rpgClass = getRpgClass(profile.className);
  const mods = rpgClass?.modifiers ?? { attack: 1, defense: 1, speed: 1, maxHealth: 1 };

  // Les multiplicateurs de classe portent sur les stats de base uniquement : un Mage ne
  // doit pas voir le bonus brut de son bâton multiplié une seconde fois par 1.35.
  const attack = Math.round(profile.attack * mods.attack) + weapon.atk + armor.atk + accessory.atk;
  const defense = Math.round(profile.defense * mods.defense) + weapon.def + armor.def + accessory.def;
  const speed = Math.round(profile.speed * mods.speed) + weapon.spd + armor.spd + accessory.spd;
  const maxHealth = Math.round(profile.maxHealth * mods.maxHealth) + weapon.hp + armor.hp + accessory.hp;

  const critChance = Math.min(
    0.75,
    BASE_CRIT_CHANCE
      + (RARITY_CRIT_BONUS[equipment.weapon?.rarity ?? 'COMMON'] ?? 0)
      + (rpgClass?.passive.bonusCritChance ?? 0),
  );

  return {
    attack: Math.max(1, attack),
    defense: Math.max(0, defense),
    speed: Math.max(1, speed),
    maxHealth: Math.max(1, maxHealth),
    critChance,
    armorPiercing: Math.min(1, rpgClass?.passive.armorPiercing ?? 0),
    damageReduction: Math.min(0.9, rpgClass?.passive.damageReduction ?? 0),
  };
}

/**
 * Coût en pièces pour passer un objet du niveau d'amélioration `current` au suivant.
 * La courbe est volontairement exponentielle : c'est le principal puits à pièces du jeu.
 */
export function upgradeCost(itemPrice: number, current: number): number {
  const base = Math.max(50, Math.round(itemPrice * 0.3));
  return Math.round(base * Math.pow(1.55, current));
}

/**
 * Probabilité de réussite d'une amélioration. Garantie jusqu'à +3, puis décroissante.
 * Un échec ne détruit ni ne rétrograde l'objet : seules les pièces sont perdues.
 */
export function upgradeSuccessChance(current: number): number {
  if (current < 3) return 1;
  return Math.max(0.25, 1 - (current - 2) * 0.09);
}
