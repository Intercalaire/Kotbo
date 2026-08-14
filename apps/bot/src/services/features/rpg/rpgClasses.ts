/**
 * Classes de personnage et compétences actives.
 *
 * La classe est choisie à partir de `CLASS_UNLOCK_LEVEL` et donne trois choses :
 *  - un profil de statistiques (multiplicateurs appliqués aux stats de base) ;
 *  - un passif permanent qui modifie le combat ;
 *  - deux compétences actives débloquées par niveau, utilisables en combat.
 *
 * Tout est déclaratif : le moteur de combat lit ces données, il ne connaît aucune classe
 * en particulier. Ajouter une classe ne demande donc aucune modification du combat.
 */

export const CLASS_UNLOCK_LEVEL = 5;

export type RpgClassId = 'WARRIOR' | 'RANGER' | 'MAGE';

/** Effet d'une compétence, résolu par le moteur de combat. */
export type SkillEffect = {
  /** Multiplicateur appliqué aux dégâts de base (0 = compétence non offensive). */
  damageMultiplier: number;
  /** Part de la défense adverse ignorée, de 0 à 1. */
  armorPiercing?: number;
  /** Part des dégâts infligés rendue en PV. */
  lifesteal?: number;
  /** Multiplicateur de défense du joueur pendant le tour suivant. */
  defenseMultiplier?: number;
  /** Le prochain coup ennemi est totalement évité. */
  evadeNextAttack?: boolean;
  /** Soin direct, en pourcentage des PV maximum. */
  healPercent?: number;
};

export type RpgSkill = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  levelRequired: number;
  /** Nombre de tours à attendre entre deux usages dans un même combat. */
  cooldownTurns: number;
  effect: SkillEffect;
};

export type RpgClass = {
  id: RpgClassId;
  name: string;
  emoji: string;
  description: string;
  /** Multiplicateurs appliqués aux stats de base du personnage. */
  modifiers: { attack: number; defense: number; speed: number; maxHealth: number };
  passive: {
    name: string;
    description: string;
    /** Part des dégâts subis annulée, de 0 à 1. */
    damageReduction?: number;
    /** Chance de coup critique additionnelle, de 0 à 1. */
    bonusCritChance?: number;
    /** Part de la défense adverse ignorée sur les attaques normales, de 0 à 1. */
    armorPiercing?: number;
  };
  skills: RpgSkill[];
};

export const RPG_CLASSES: Record<RpgClassId, RpgClass> = {
  WARRIOR: {
    id: 'WARRIOR',
    name: 'Guerrier',
    emoji: '🛡️',
    description: 'Encaisse tout, avance quand même. Le choix sûr pour apprendre le jeu.',
    modifiers: { attack: 1.0, defense: 1.25, speed: 0.9, maxHealth: 1.2 },
    passive: {
      name: 'Peau de fer',
      description: 'Réduit de 15 % tous les dégâts subis.',
      damageReduction: 0.15,
    },
    skills: [
      {
        id: 'brutal_strike',
        name: 'Frappe Brutale',
        emoji: '💥',
        description: 'Un coup massif à 200 % de dégâts.',
        levelRequired: 5,
        cooldownTurns: 3,
        effect: { damageMultiplier: 2 },
      },
      {
        id: 'war_cry',
        name: 'Cri de Guerre',
        emoji: '📢',
        description: 'Double votre défense pour le tour suivant et rend 10 % de vos PV.',
        levelRequired: 12,
        cooldownTurns: 4,
        effect: { damageMultiplier: 0, defenseMultiplier: 2, healPercent: 0.1 },
      },
    ],
  },

  RANGER: {
    id: 'RANGER',
    name: 'Rôdeur',
    emoji: '🏹',
    description: 'Frappe vite et souvent, esquive le reste. Récompense les bons timings.',
    modifiers: { attack: 1.1, defense: 0.9, speed: 1.35, maxHealth: 0.95 },
    passive: {
      name: 'Œil de lynx',
      description: 'Ajoute 12 % de chances de coup critique.',
      bonusCritChance: 0.12,
    },
    skills: [
      {
        id: 'precise_shot',
        name: 'Tir Précis',
        emoji: '🎯',
        description: 'Ignore intégralement la défense adverse.',
        levelRequired: 5,
        cooldownTurns: 3,
        effect: { damageMultiplier: 1.3, armorPiercing: 1 },
      },
      {
        id: 'evasion',
        name: 'Esquive',
        emoji: '🌀',
        description: 'Évite totalement la prochaine attaque ennemie.',
        levelRequired: 12,
        cooldownTurns: 4,
        effect: { damageMultiplier: 0, evadeNextAttack: true },
      },
    ],
  },

  MAGE: {
    id: 'MAGE',
    name: 'Mage',
    emoji: '🔮',
    description: 'Fragile mais dévastateur. Les armures ne le ralentissent pas.',
    modifiers: { attack: 1.35, defense: 0.8, speed: 1.0, maxHealth: 0.85 },
    passive: {
      name: 'Percée arcanique',
      description: 'Vos attaques ignorent 30 % de la défense adverse.',
      armorPiercing: 0.3,
    },
    skills: [
      {
        id: 'fireball',
        name: 'Boule de Feu',
        emoji: '🔥',
        description: 'Une déflagration à 230 % de dégâts.',
        levelRequired: 5,
        cooldownTurns: 3,
        effect: { damageMultiplier: 2.3 },
      },
      {
        id: 'life_drain',
        name: 'Drain de Vie',
        emoji: '🩸',
        description: 'Inflige 150 % de dégâts et vous rend la moitié en PV.',
        levelRequired: 12,
        cooldownTurns: 4,
        effect: { damageMultiplier: 1.5, lifesteal: 0.5 },
      },
    ],
  },
};

export const RPG_CLASS_LIST: RpgClass[] = [RPG_CLASSES.WARRIOR, RPG_CLASSES.RANGER, RPG_CLASSES.MAGE];

export function isRpgClassId(value: string | null | undefined): value is RpgClassId {
  return value === 'WARRIOR' || value === 'RANGER' || value === 'MAGE';
}

export function getRpgClass(value: string | null | undefined): RpgClass | null {
  return isRpgClassId(value) ? RPG_CLASSES[value] : null;
}

/** Compétences réellement utilisables au niveau atteint. */
export function getAvailableSkills(className: string | null | undefined, level: number): RpgSkill[] {
  const rpgClass = getRpgClass(className);
  if (!rpgClass) return [];
  return rpgClass.skills.filter((skill) => level >= skill.levelRequired);
}

export function findSkill(className: string | null | undefined, skillId: string): RpgSkill | null {
  return getRpgClass(className)?.skills.find((skill) => skill.id === skillId) ?? null;
}
