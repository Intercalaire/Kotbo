/**
 * Combat automatique contre une créature, et tirage de ce qu'elle rapporte.
 *
 * Aucun accès base : les combats de boss et les étages de donjon s'en servent tous deux, les
 * premiers en écrivant le résultat aussitôt, les seconds en le gardant en attente jusqu'à la
 * sortie du donjon.
 */

import { computeAttack } from './rpgCombatMath.js';

export type DuelStats = {
  attack: number;
  defense: number;
  speed: number;
  maxHealth: number;
  critChance: number;
  armorPiercing: number;
  lifesteal: number;
  damageReduction: number;
  thorns: number;
};

export type DuelSkill = {
  name: string;
  cooldownTurns: number;
  effect: { damageMultiplier: number; armorPiercing?: number; lifesteal?: number };
};

export type DuelMonster = {
  health: number;
  attack: number;
  defense: number;
  speed: number;
};

export type DuelTurn = {
  attacker: 'player' | 'monster';
  damage: number;
  critical: boolean;
  playerHp: number;
  monsterHp: number;
  /** Nom de la compétence employée, `null` pour une attaque normale. */
  skillName: string | null;
};

export type DuelResult = {
  won: boolean;
  turns: DuelTurn[];
  playerHp: number;
  monsterHp: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
};

export const DUEL_MAX_TURNS = 40;
const MONSTER_CRIT_CHANCE = 0.08;

/**
 * Meilleure compétence offensive, celle que le combat automatique alterne avec l'attaque
 * normale pour que la classe pèse autant qu'en combat interactif.
 */
export function pickDuelSkill<T extends DuelSkill>(skills: T[]): T | null {
  return skills
    .filter((skill) => skill.effect.damageMultiplier > 0)
    .sort((a, b) => b.effect.damageMultiplier - a.effect.damageMultiplier)[0] ?? null;
}

export function simulateDuel(input: {
  stats: DuelStats;
  skill: DuelSkill | null;
  playerHp: number;
  monster: DuelMonster;
  random?: () => number;
}): DuelResult {
  const { stats, skill: bestSkill, monster } = input;
  const random = input.random ?? Math.random;

  let playerHp = input.playerHp;
  let monsterHp = monster.health;
  const turns: DuelTurn[] = [];

  const playerFirst = stats.speed >= monster.speed;
  let skillCooldown = 0;

  for (let i = 0; i < DUEL_MAX_TURNS && playerHp > 0 && monsterHp > 0; i++) {
    if ((playerFirst && i % 2 === 0) || (!playerFirst && i % 2 === 1)) {
      const useSkill = bestSkill !== null && skillCooldown === 0;
      const skill = useSkill ? bestSkill : null;

      const { damage, critical, healed } = computeAttack({
        attack: stats.attack,
        targetDefense: monster.defense,
        speed: stats.speed,
        critChance: stats.critChance,
        armorPiercing: Math.max(stats.armorPiercing, skill?.effect.armorPiercing ?? 0),
        skillMultiplier: skill?.effect.damageMultiplier ?? 1,
        // Le vol de vie de la compétence et celui des enchantements se cumulent : ce sont
        // deux sources distinctes, et une compétence ne doit pas annuler un enchantement.
        lifesteal: stats.lifesteal + (skill?.effect.lifesteal ?? 0),
        random,
      });

      monsterHp = Math.max(0, monsterHp - damage);
      if (healed > 0) playerHp = Math.min(stats.maxHealth, playerHp + healed);
      skillCooldown = useSkill ? (bestSkill?.cooldownTurns ?? 0) : Math.max(0, skillCooldown - 1);

      turns.push({ attacker: 'player', damage, critical, playerHp, monsterHp, skillName: skill?.name ?? null });
    } else {
      const { damage, critical, reflected } = computeAttack({
        attack: monster.attack,
        targetDefense: stats.defense,
        speed: monster.speed,
        critChance: MONSTER_CRIT_CHANCE,
        targetDamageReduction: stats.damageReduction,
        targetThorns: stats.thorns,
        random,
      });
      playerHp = Math.max(0, playerHp - damage);
      // Les épines frappent même si le coup est mortel : l'armure réagit à l'impact.
      if (reflected > 0) monsterHp = Math.max(0, monsterHp - reflected);
      turns.push({ attacker: 'monster', damage, critical, playerHp, monsterHp, skillName: null });
    }
  }

  return {
    won: monsterHp <= 0,
    turns,
    playerHp: Math.max(0, playerHp),
    monsterHp: Math.max(0, monsterHp),
    totalDamageDealt: turns.filter((turn) => turn.attacker === 'player').reduce((sum, turn) => sum + turn.damage, 0),
    totalDamageTaken: turns.filter((turn) => turn.attacker === 'monster').reduce((sum, turn) => sum + turn.damage, 0),
  };
}

export type MonsterDrop = {
  itemName: string;
  emoji?: string;
  chance: number;
  coinBonus?: number;
};

export function parseMonsterDropList(drops: unknown): MonsterDrop[] {
  const list = Array.isArray(drops) ? drops : JSON.parse(String(drops || '[]'));
  return Array.isArray(list) ? list as MonsterDrop[] : [];
}

/**
 * Gains d'une victoire : la récompense de base majorée d'un aléa jusqu'à 30 %, et au plus un
 * objet, le premier de la liste dont le tirage réussit.
 */
export function rollMonsterLoot(
  monster: { xpReward: number; coinReward: number; drops: unknown },
  random: () => number = Math.random,
): { xp: number; coins: number; drop: MonsterDrop | null } {
  const xp = monster.xpReward + Math.floor(random() * Math.floor(monster.xpReward * 0.3));
  let coins = monster.coinReward + Math.floor(random() * Math.floor(monster.coinReward * 0.3));

  for (const drop of parseMonsterDropList(monster.drops)) {
    if (random() < drop.chance) {
      if (drop.coinBonus) coins += drop.coinBonus;
      return { xp, coins, drop };
    }
  }
  return { xp, coins, drop: null };
}
