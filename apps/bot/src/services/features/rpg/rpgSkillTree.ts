/**
 * Arbre de compétences : contenu statique, une branche par identité de jeu.
 *
 * L'arbre s'AJOUTE aux compétences de classe, il ne les remplace pas. Les deux
 * compétences actives d'une classe restent acquises au niveau, gratuitement : les
 * faire passer par l'arbre retirerait à tous les personnages existants ce qu'ils
 * possèdent déjà, pour un bénéfice de design nul.
 *
 * Un nœud coûte des POINTS DE COMPÉTENCE (`RpgProfile.skillPoints`), distincts des
 * points de caractéristiques. Les mélanger transformerait l'arbre en second curseur
 * de statistiques, alors que tout son intérêt est de faire choisir une direction.
 *
 * Cohérence vérifiée par `rpgSkillTree.test.ts` :
 *  - chaque `requires` désigne un nœud de la MÊME classe ;
 *  - aucun cycle, et aucun prérequis d'un palier supérieur ou égal au sien ;
 *  - les identifiants de nœuds et de compétences accordées sont uniques.
 */

import type { RpgClassId, RpgSkill } from './rpgClasses.js';

/** Points d'arbre accordés à chaque niveau gagné. */
export const SKILL_POINTS_PER_LEVEL = 1;

/**
 * Niveau à partir duquel l'arbre s'ouvre.
 *
 * Il suit le choix de classe : les branches sont propres à une classe, un arbre sans
 * classe n'aurait rien à afficher.
 */
export const SKILL_TREE_UNLOCK_LEVEL = 5;

/** Coût en pièces d'une remise à zéro de l'arbre. Les points sont intégralement rendus. */
export const RESPEC_COST = 1_500;

/**
 * Bonus accordés par un nœud, POUR UN RANG.
 *
 * Le vocabulaire est celui des enchantements, à dessein : les deux sources alimentent
 * les mêmes plafonds dans `getEffectiveStats`, et un joueur ne devrait pas avoir à
 * apprendre deux barèmes pour comprendre d'où vient sa réduction de dégâts.
 */
export type SkillNodeBonus = {
  attackFlat?: number;
  defenseFlat?: number;
  speedFlat?: number;
  maxHealthFlat?: number;
  attackPercent?: number;
  defensePercent?: number;
  speedPercent?: number;
  maxHealthPercent?: number;
  critChance?: number;
  armorPiercing?: number;
  damageReduction?: number;
  lifesteal?: number;
  thorns?: number;
};

export type SkillNode = {
  id: string;
  classId: RpgClassId;
  /** Branche d'appartenance, qui regroupe l'affichage. */
  branch: string;
  name: string;
  emoji: string;
  description: string;
  /** Rangée dans l'arbre, de 1 à 4. Donne l'ordre d'affichage et borne les prérequis. */
  tier: number;
  /** Niveau de personnage minimum. */
  levelRequired: number;
  /** Nœuds à posséder au rang maximum avant de pouvoir acheter celui-ci. */
  requires: string[];
  /** Nombre de rangs achetables. Un nœud de compétence vaut toujours 1. */
  maxRank: number;
  /** Coût en points de compétence, par rang. */
  cost: number;
  /** Bonus permanents accordés, multipliés par le rang atteint. */
  bonus?: SkillNodeBonus;
  /** Compétence active débloquée par ce nœud, en plus de celles de la classe. */
  grantsSkill?: RpgSkill;
};

// ════════════════════════════════════════════════════════════════════════════
// GUERRIER — Rempart / Fureur / Vétéran
// ════════════════════════════════════════════════════════════════════════════

const WARRIOR_NODES: SkillNode[] = [
  {
    id: 'war_bulwark_1', classId: 'WARRIOR', branch: 'Rempart', name: 'Garde haute', emoji: '🛡️',
    description: "La posture de base de tout porteur de bouclier.",
    tier: 1, levelRequired: 5, requires: [], maxRank: 3, cost: 1,
    bonus: { defenseFlat: 4 },
  },
  {
    id: 'war_bulwark_2', classId: 'WARRIOR', branch: 'Rempart', name: 'Carrure', emoji: '🧱',
    description: "Encaisser, c'est d'abord avoir de quoi encaisser.",
    tier: 2, levelRequired: 9, requires: ['war_bulwark_1'], maxRank: 3, cost: 1,
    bonus: { maxHealthFlat: 25 },
  },
  {
    id: 'war_bulwark_3', classId: 'WARRIOR', branch: 'Rempart', name: 'Peau de pierre', emoji: '🗿',
    description: "Une part des coups ne vous atteint tout simplement plus.",
    tier: 3, levelRequired: 15, requires: ['war_bulwark_2'], maxRank: 2, cost: 2,
    bonus: { damageReduction: 0.04, defensePercent: 0.05 },
  },
  {
    id: 'war_bulwark_4', classId: 'WARRIOR', branch: 'Rempart', name: 'Représailles', emoji: '🌵',
    description: "Frapper un mur finit par coûter cher.",
    tier: 4, levelRequired: 22, requires: ['war_bulwark_3'], maxRank: 1, cost: 3,
    bonus: { thorns: 0.12, defenseFlat: 10 },
  },

  {
    id: 'war_fury_1', classId: 'WARRIOR', branch: 'Fureur', name: 'Poigne de fer', emoji: '✊',
    description: "Un peu plus de force dans chaque coup.",
    tier: 1, levelRequired: 5, requires: [], maxRank: 3, cost: 1,
    bonus: { attackFlat: 4 },
  },
  {
    id: 'war_fury_2', classId: 'WARRIOR', branch: 'Fureur', name: 'Fendoir', emoji: '🪓',
    description: "Vos coups trouvent les défauts de l'armure.",
    tier: 2, levelRequired: 11, requires: ['war_fury_1'], maxRank: 2, cost: 2,
    bonus: { armorPiercing: 0.06 },
  },
  {
    id: 'war_fury_3', classId: 'WARRIOR', branch: 'Fureur', name: 'Déchaînement', emoji: '💢',
    description: "Trois coups enchaînés, sans reprendre votre souffle.",
    tier: 3, levelRequired: 17, requires: ['war_fury_2'], maxRank: 1, cost: 3,
    grantsSkill: {
      id: 'war_rampage', name: 'Déchaînement', emoji: '💢',
      description: "Une rafale à 280 % de dégâts qui ignore un tiers de la défense adverse.",
      levelRequired: 17, cooldownTurns: 4,
      effect: { damageMultiplier: 2.8, armorPiercing: 0.33 },
    },
  },

  {
    id: 'war_veteran_1', classId: 'WARRIOR', branch: 'Vétéran', name: 'Endurance', emoji: '❤️',
    description: "Les longues campagnes forgent les constitutions solides.",
    tier: 2, levelRequired: 10, requires: [], maxRank: 3, cost: 1,
    bonus: { maxHealthPercent: 0.03 },
  },
  {
    id: 'war_veteran_2', classId: 'WARRIOR', branch: 'Vétéran', name: 'Second souffle', emoji: '🩹',
    description: "Reprendre pied au milieu du combat.",
    tier: 3, levelRequired: 16, requires: ['war_veteran_1'], maxRank: 1, cost: 3,
    grantsSkill: {
      id: 'war_second_wind', name: 'Second souffle', emoji: '🩹',
      description: "Rend 30 % de vos PV maximum et double votre défense au tour suivant.",
      levelRequired: 16, cooldownTurns: 5,
      effect: { damageMultiplier: 0, healPercent: 0.3, defenseMultiplier: 2 },
    },
  },
  {
    id: 'war_veteran_3', classId: 'WARRIOR', branch: 'Vétéran', name: 'Soif de sang', emoji: '🩸',
    description: "Chaque blessure infligée vous remet debout.",
    tier: 4, levelRequired: 21, requires: ['war_veteran_2'], maxRank: 2, cost: 2,
    bonus: { lifesteal: 0.05 },
  },
];

// ════════════════════════════════════════════════════════════════════════════
// RÔDEUR — Précision / Ombre / Traqueur
// ════════════════════════════════════════════════════════════════════════════

const RANGER_NODES: SkillNode[] = [
  {
    id: 'rng_precision_1', classId: 'RANGER', branch: 'Précision', name: 'Main sûre', emoji: '🎯',
    description: "La flèche part où l'œil regarde.",
    tier: 1, levelRequired: 5, requires: [], maxRank: 3, cost: 1,
    bonus: { critChance: 0.02 },
  },
  {
    id: 'rng_precision_2', classId: 'RANGER', branch: 'Précision', name: 'Point faible', emoji: '🔎',
    description: "Vous savez exactement où viser.",
    tier: 2, levelRequired: 10, requires: ['rng_precision_1'], maxRank: 2, cost: 2,
    bonus: { armorPiercing: 0.07 },
  },
  {
    id: 'rng_precision_3', classId: 'RANGER', branch: 'Précision', name: 'Tir de rupture', emoji: '🏹',
    description: "Un trait qui traverse tout ce qui se met en travers.",
    tier: 3, levelRequired: 17, requires: ['rng_precision_2'], maxRank: 1, cost: 3,
    grantsSkill: {
      id: 'rng_piercing_volley', name: 'Tir de rupture', emoji: '🏹',
      description: "Ignore toute la défense adverse et frappe à 200 %.",
      levelRequired: 17, cooldownTurns: 4,
      effect: { damageMultiplier: 2, armorPiercing: 1 },
    },
  },

  {
    id: 'rng_shadow_1', classId: 'RANGER', branch: 'Ombre', name: 'Pas léger', emoji: '💨',
    description: "On ne vous entend pas venir.",
    tier: 1, levelRequired: 5, requires: [], maxRank: 3, cost: 1,
    bonus: { speedFlat: 4 },
  },
  {
    id: 'rng_shadow_2', classId: 'RANGER', branch: 'Ombre', name: 'Esquive fluide', emoji: '🌀',
    description: "Le coup passe à un cheveu.",
    tier: 2, levelRequired: 11, requires: ['rng_shadow_1'], maxRank: 2, cost: 2,
    bonus: { damageReduction: 0.04, speedPercent: 0.04 },
  },
  {
    id: 'rng_shadow_3', classId: 'RANGER', branch: 'Ombre', name: "Frappe de l'ombre", emoji: '🌑',
    description: "Disparaître, puis frapper dans le dos.",
    tier: 4, levelRequired: 22, requires: ['rng_shadow_2'], maxRank: 1, cost: 3,
    grantsSkill: {
      id: 'rng_shadow_strike', name: "Frappe de l'ombre", emoji: '🌑',
      description: "Frappe à 240 % et vous rend un tiers des dégâts en PV.",
      levelRequired: 22, cooldownTurns: 5,
      effect: { damageMultiplier: 2.4, lifesteal: 0.33 },
    },
  },

  {
    id: 'rng_tracker_1', classId: 'RANGER', branch: 'Traqueur', name: 'Souffle long', emoji: '🫁',
    description: "Tenir la distance, aussi longtemps qu'il le faut.",
    tier: 2, levelRequired: 9, requires: [], maxRank: 3, cost: 1,
    bonus: { maxHealthFlat: 18, speedFlat: 2 },
  },
  {
    id: 'rng_tracker_2', classId: 'RANGER', branch: 'Traqueur', name: 'Instinct', emoji: '🐺',
    description: "Vous sentez le coup avant qu'il parte.",
    tier: 3, levelRequired: 15, requires: ['rng_tracker_1'], maxRank: 2, cost: 2,
    bonus: { critChance: 0.03, attackPercent: 0.04 },
  },
  {
    id: 'rng_tracker_3', classId: 'RANGER', branch: 'Traqueur', name: 'Mise à mort', emoji: '☠️',
    description: "La proie blessée ne va jamais bien loin.",
    tier: 4, levelRequired: 21, requires: ['rng_tracker_2'], maxRank: 1, cost: 3,
    bonus: { critChance: 0.06, armorPiercing: 0.08 },
  },
];

// ════════════════════════════════════════════════════════════════════════════
// MAGE — Arcane / Sang / Protection
// ════════════════════════════════════════════════════════════════════════════

const MAGE_NODES: SkillNode[] = [
  {
    id: 'mag_arcane_1', classId: 'MAGE', branch: 'Arcane', name: 'Canalisation', emoji: '🔮',
    description: "Moins de puissance perdue entre le sort et la cible.",
    tier: 1, levelRequired: 5, requires: [], maxRank: 3, cost: 1,
    bonus: { attackFlat: 5 },
  },
  {
    id: 'mag_arcane_2', classId: 'MAGE', branch: 'Arcane', name: 'Percée', emoji: '🌀',
    description: "Les armures ne sont, après tout, que de la matière.",
    tier: 2, levelRequired: 10, requires: ['mag_arcane_1'], maxRank: 2, cost: 2,
    bonus: { armorPiercing: 0.08 },
  },
  {
    id: 'mag_arcane_3', classId: 'MAGE', branch: 'Arcane', name: 'Météore', emoji: '☄️',
    description: "Le ciel tombe, à l'endroit exact que vous désignez.",
    tier: 4, levelRequired: 22, requires: ['mag_arcane_2'], maxRank: 1, cost: 3,
    grantsSkill: {
      id: 'mag_meteor', name: 'Météore', emoji: '☄️',
      description: "Une déflagration à 320 % de dégâts.",
      levelRequired: 22, cooldownTurns: 5,
      effect: { damageMultiplier: 3.2 },
    },
  },

  {
    id: 'mag_blood_1', classId: 'MAGE', branch: 'Sang', name: 'Pacte mineur', emoji: '🩸',
    description: "Un peu de votre vie en échange d'un peu de puissance.",
    tier: 1, levelRequired: 5, requires: [], maxRank: 3, cost: 1,
    bonus: { lifesteal: 0.03 },
  },
  {
    id: 'mag_blood_2', classId: 'MAGE', branch: 'Sang', name: 'Sangsue', emoji: '🦟',
    description: "Chaque sort vous nourrit un peu plus.",
    tier: 3, levelRequired: 16, requires: ['mag_blood_1'], maxRank: 2, cost: 2,
    bonus: { lifesteal: 0.05, attackPercent: 0.04 },
  },
  {
    id: 'mag_blood_3', classId: 'MAGE', branch: 'Sang', name: 'Hémorragie', emoji: '🫀',
    description: "Vider une cible de sa substance, d'un seul geste.",
    tier: 4, levelRequired: 23, requires: ['mag_blood_2'], maxRank: 1, cost: 3,
    grantsSkill: {
      id: 'mag_hemorrhage', name: 'Hémorragie', emoji: '🫀',
      description: "Inflige 200 % de dégâts et vous rend 70 % du total en PV.",
      levelRequired: 23, cooldownTurns: 5,
      effect: { damageMultiplier: 2, lifesteal: 0.7 },
    },
  },

  {
    id: 'mag_ward_1', classId: 'MAGE', branch: 'Protection', name: 'Bouclier arcanique', emoji: '🔵',
    description: "Une pellicule de magie, fine mais tenace.",
    tier: 2, levelRequired: 9, requires: [], maxRank: 3, cost: 1,
    bonus: { defenseFlat: 3, maxHealthFlat: 15 },
  },
  {
    id: 'mag_ward_2', classId: 'MAGE', branch: 'Protection', name: 'Dissipation', emoji: '✨',
    description: "Ce qui vous frappe perd une part de sa force en chemin.",
    tier: 3, levelRequired: 15, requires: ['mag_ward_1'], maxRank: 2, cost: 2,
    bonus: { damageReduction: 0.05 },
  },
  {
    id: 'mag_ward_3', classId: 'MAGE', branch: 'Protection', name: 'Contresort', emoji: '🪞',
    description: "Le sort adverse repart d'où il vient.",
    tier: 4, levelRequired: 21, requires: ['mag_ward_2'], maxRank: 1, cost: 3,
    bonus: { thorns: 0.15, defensePercent: 0.08 },
  },
];

export const RPG_SKILL_NODES: SkillNode[] = [...WARRIOR_NODES, ...RANGER_NODES, ...MAGE_NODES];

const NODE_BY_ID = new Map(RPG_SKILL_NODES.map((node) => [node.id, node]));

export function getSkillNode(nodeId: string): SkillNode | null {
  return NODE_BY_ID.get(nodeId) ?? null;
}

/** Nœuds d'une classe, rangés par branche puis par palier. */
export function nodesForClass(classId: RpgClassId): SkillNode[] {
  return RPG_SKILL_NODES
    .filter((node) => node.classId === classId)
    .sort((a, b) => a.branch.localeCompare(b.branch) || a.tier - b.tier);
}

/** Branches d'une classe, dans l'ordre d'affichage. */
export function branchesForClass(classId: RpgClassId): string[] {
  return [...new Set(nodesForClass(classId).map((node) => node.branch))];
}

/** Rang possédé sur un nœud, borné par le catalogue. */
function effectiveRank(node: SkillNode, rank: number): number {
  // Un rang stocké hors bornes viendrait d'un catalogue modifié depuis l'achat : on le
  // ramène dans les clous plutôt que d'accorder un bonus que l'arbre ne permet plus.
  return Math.max(0, Math.min(rank, node.maxRank));
}

/** Total des bonus, tous rangs confondus. Un nœud inconnu du catalogue est ignoré. */
export function aggregateNodeBonuses(unlocks: { nodeId: string; rank: number }[]): Required<SkillNodeBonus> {
  const total: Required<SkillNodeBonus> = {
    attackFlat: 0, defenseFlat: 0, speedFlat: 0, maxHealthFlat: 0,
    attackPercent: 0, defensePercent: 0, speedPercent: 0, maxHealthPercent: 0,
    critChance: 0, armorPiercing: 0, damageReduction: 0, lifesteal: 0, thorns: 0,
  };

  for (const unlock of unlocks) {
    const node = NODE_BY_ID.get(unlock.nodeId);
    if (!node?.bonus) continue;

    const rank = effectiveRank(node, unlock.rank);
    for (const [key, value] of Object.entries(node.bonus) as [keyof SkillNodeBonus, number][]) {
      total[key] += value * rank;
    }
  }

  return total;
}

/** Compétences actives accordées par les nœuds possédés. */
export function skillsFromNodes(unlocks: { nodeId: string }[]): RpgSkill[] {
  return unlocks
    .map((unlock) => NODE_BY_ID.get(unlock.nodeId)?.grantsSkill)
    .filter((skill): skill is RpgSkill => Boolean(skill));
}

/** Total de points déjà investis, ce que rend une remise à zéro. */
export function pointsSpent(unlocks: { nodeId: string; rank: number }[]): number {
  return unlocks.reduce((total, unlock) => {
    const node = NODE_BY_ID.get(unlock.nodeId);
    return node ? total + node.cost * effectiveRank(node, unlock.rank) : total;
  }, 0);
}
