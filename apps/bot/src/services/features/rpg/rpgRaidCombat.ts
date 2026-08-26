/**
 * Déroulé d'un assaut de raid.
 *
 * Un assaut n'est pas un combat de boss ordinaire : la réserve de points de vie appartient
 * à l'équipe et non au joueur qui frappe, le boss lance des sorts, et l'affrontement
 * s'arrête au bout d'un nombre de tours même si personne n'est tombé. Le moteur est donc
 * distinct de `simulateBattle`, dont la boucle ne connaît ni sorts adverses ni états qui
 * durent. Ce qui doit rester commun l'est déjà : `computeAttack` porte la formule de
 * dégâts, précisément pour que les deux moteurs ne divergent pas.
 *
 * Aucun accès base : tout entre par les paramètres et ressort dans le résultat, ce qui rend
 * le déroulé rejouable en test avec un générateur aléatoire injecté.
 */

import { computeAttack } from './rpgCombatMath.js';
import { pickRaidSpell } from './rpgRaidPolicy.js';
import type { RaidSpell } from './rpgRaidContent.js';

/** Au delà, l'assaut tourne en rond : ni le joueur ni la réserve ne bougent plus assez. */
export const RAID_MAX_TURNS = 30;

export interface RaidFighterStats {
  attack: number;
  defense: number;
  speed: number;
  maxHealth: number;
  critChance: number;
  armorPiercing: number;
  damageReduction: number;
}

export interface RaidBossStats {
  attack: number;
  defense: number;
  speed: number;
  spells: RaidSpell[];
}

export interface RaidTurn {
  attacker: 'player' | 'boss';
  damage: number;
  critical: boolean;
  /** Sort lancé par le boss ce tour-ci, le cas échéant. */
  spellName: string | null;
  spellEmoji: string | null;
  playerHp: number;
  remainingHealth: number;
}

export interface RaidAssaultResult {
  turns: RaidTurn[];
  /** Dégâts réellement retirés de la réserve, soins du boss déduits. */
  damageDealt: number;
  damageTaken: number;
  /** Vrai si la réserve est tombée à zéro pendant cet assaut. */
  killingBlow: boolean;
  survived: boolean;
  remainingHealth: number;
  spellsCast: string[];
}

export interface RaidAssaultInput {
  stats: RaidFighterStats;
  playerHealth: number;
  /** Compétences du joueur, appliquées comme en combat de boss automatique. */
  playerSkills: Array<{ name: string; cooldownTurns: number; effect: { damageMultiplier: number; armorPiercing?: number; lifesteal?: number } }>;
  boss: RaidBossStats;
  remainingHealth: number;
  totalHealth: number;
  random?: () => number;
}

interface BossState {
  cooldowns: Record<string, number>;
  defenseMultiplier: number;
  damageReduction: number;
  thorns: number;
  /** Tours restants sur les effets défensifs en cours. */
  effectTurns: number;
  stunPlayer: boolean;
}

/**
 * Joue un assaut et rend son déroulé.
 *
 * Le joueur commence s'il est plus rapide, comme partout ailleurs dans le jeu. Les effets
 * défensifs du boss tiennent un nombre de tours donné puis retombent : sans cette
 * expiration, une carapace lancée au premier tour rendrait le boss invulnérable jusqu'à la
 * fin de l'assaut.
 */
export function runRaidAssault(input: RaidAssaultInput): RaidAssaultResult {
  const random = input.random ?? Math.random;
  const { stats, boss } = input;

  const bestSkill = [...input.playerSkills]
    .filter((skill) => skill.effect.damageMultiplier > 0)
    .sort((a, b) => b.effect.damageMultiplier - a.effect.damageMultiplier)[0] ?? null;

  let playerHp = Math.max(1, input.playerHealth);
  let remaining = Math.max(0, input.remainingHealth);
  const total = Math.max(1, input.totalHealth);

  const state: BossState = {
    cooldowns: {},
    defenseMultiplier: 1,
    damageReduction: 0,
    thorns: 0,
    effectTurns: 0,
    stunPlayer: false,
  };

  const turns: RaidTurn[] = [];
  const spellsCast: string[] = [];
  let damageDealt = 0;
  let damageTaken = 0;
  let skillCooldown = 0;

  const playerFirst = stats.speed >= boss.speed;

  for (let i = 0; i < RAID_MAX_TURNS && playerHp > 0 && remaining > 0; i++) {
    const playerTurn = (playerFirst && i % 2 === 0) || (!playerFirst && i % 2 === 1);

    if (playerTurn) {
      if (state.stunPlayer) {
        // Le tour est perdu, mais il compte : un étourdissement doit coûter du temps.
        state.stunPlayer = false;
        turns.push({ attacker: 'player', damage: 0, critical: false, spellName: null, spellEmoji: null, playerHp, remainingHealth: remaining });
        expireBossEffects(state);
        continue;
      }

      const useSkill = bestSkill !== null && skillCooldown === 0;
      const skill = useSkill ? bestSkill : null;

      const { damage, critical } = computeAttack({
        attack: stats.attack,
        targetDefense: boss.defense,
        speed: stats.speed,
        critChance: stats.critChance,
        armorPiercing: Math.max(stats.armorPiercing, skill?.effect.armorPiercing ?? 0),
        skillMultiplier: skill?.effect.damageMultiplier ?? 1,
        targetDefenseMultiplier: state.defenseMultiplier,
        targetDamageReduction: state.damageReduction,
        random,
      });

      remaining = Math.max(0, remaining - damage);
      damageDealt += damage;
      skillCooldown = useSkill ? skill!.cooldownTurns : Math.max(0, skillCooldown - 1);

      if (skill?.effect.lifesteal) {
        playerHp = Math.min(stats.maxHealth, playerHp + Math.floor(damage * skill.effect.lifesteal));
      }

      // Les épines frappent avant que le tour ne se termine : elles punissent le coup qui
      // vient d'être porté, pas le suivant.
      if (state.thorns > 0) {
        const reflected = Math.max(1, Math.floor(damage * state.thorns));
        playerHp = Math.max(0, playerHp - reflected);
        damageTaken += reflected;
      }

      turns.push({ attacker: 'player', damage, critical, spellName: null, spellEmoji: null, playerHp, remainingHealth: remaining });
      expireBossEffects(state);
      continue;
    }

    const spell = pickRaidSpell(boss.spells, {
      healthShare: remaining / total,
      cooldowns: state.cooldowns,
    });

    if (spell) {
      state.cooldowns[spell.id] = spell.cooldownTurns + 1;
      spellsCast.push(spell.id);
      applyBossSpell(state, spell);
    }

    let damage = 0;
    let critical = false;
    if (!spell || spell.effect.damageMultiplier > 0) {
      const attack = computeAttack({
        attack: boss.attack,
        targetDefense: stats.defense,
        speed: boss.speed,
        critChance: 0.08,
        armorPiercing: spell?.effect.armorPiercing ?? 0,
        skillMultiplier: spell?.effect.damageMultiplier ?? 1,
        targetDamageReduction: stats.damageReduction,
        random,
      });
      damage = attack.damage;
      critical = attack.critical;

      playerHp = Math.max(0, playerHp - damage);
      damageTaken += damage;

      // Le boss se soigne sur la réserve de l'équipe : ce que rend la gueule dévorante est
      // repris à tout le monde, pas au seul joueur present.
      if (spell?.effect.lifesteal) {
        const healed = Math.floor(damage * spell.effect.lifesteal);
        const before = remaining;
        remaining = Math.min(total, remaining + healed);
        damageDealt -= remaining - before;
      }
    }

    turns.push({
      attacker: 'boss',
      damage,
      critical,
      spellName: spell?.name ?? null,
      spellEmoji: spell?.emoji ?? null,
      playerHp,
      remainingHealth: remaining,
    });

    tickCooldowns(state);
    expireBossEffects(state);
  }

  return {
    turns,
    damageDealt: Math.max(0, damageDealt),
    damageTaken,
    killingBlow: remaining <= 0,
    survived: playerHp > 0,
    remainingHealth: remaining,
    spellsCast,
  };
}

function applyBossSpell(state: BossState, spell: RaidSpell): void {
  const duration = spell.effect.durationTurns ?? 1;
  if (spell.effect.defenseMultiplier && spell.effect.defenseMultiplier !== 1) {
    state.defenseMultiplier = spell.effect.defenseMultiplier;
    state.effectTurns = Math.max(state.effectTurns, duration * 2);
  }
  if (spell.effect.damageReduction) {
    state.damageReduction = spell.effect.damageReduction;
    state.effectTurns = Math.max(state.effectTurns, duration * 2);
  }
  if (spell.effect.thorns) {
    state.thorns = spell.effect.thorns;
    state.effectTurns = Math.max(state.effectTurns, duration * 2);
  }
  if (spell.effect.stunNextTurn) state.stunPlayer = true;
}

/**
 * Fait vieillir les effets défensifs d'un tour.
 *
 * La durée est comptée en tours de jeu et non en tours de boss, d'où le doublage à la pose :
 * un joueur et un boss jouent chacun leur tour, et « deux tours » doit s'entendre comme
 * deux échanges, sans quoi une carapace annoncée pour deux tours n'en tiendrait qu'un.
 */
function expireBossEffects(state: BossState): void {
  if (state.effectTurns <= 0) return;
  state.effectTurns -= 1;
  if (state.effectTurns > 0) return;

  state.defenseMultiplier = 1;
  state.damageReduction = 0;
  state.thorns = 0;
}

function tickCooldowns(state: BossState): void {
  for (const id of Object.keys(state.cooldowns)) {
    state.cooldowns[id] = Math.max(0, state.cooldowns[id] - 1);
  }
}
