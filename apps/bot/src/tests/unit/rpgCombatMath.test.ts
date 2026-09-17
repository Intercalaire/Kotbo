import { describe, expect, test } from 'bun:test';
import {
  CRIT_MULTIPLIER,
  DEFENSE_SCALE,
  MIN_DAMAGE_THROUGH,
  computeAttack,
  damageThrough,
} from '../../services/features/rpg/rpgCombatMath.js';

/** Tirage figé : la médiane, pour que la variance ne brouille pas les assertions. */
const rng = () => 0.5;

describe('damageThrough', () => {
  test('sans défense, tout passe', () => {
    expect(damageThrough(0)).toBe(1);
  });

  test('à DEFENSE_SCALE de défense, la moitié passe', () => {
    expect(damageThrough(DEFENSE_SCALE)).toBeCloseTo(0.5, 5);
  });

  test('la défense réduit toujours, sans jamais annuler', () => {
    // C'est le défaut central de l'ancienne soustraction : au-delà d'un seuil, les coups
    // tombaient à 1 dégât fixe et le personnage devenait intouchable.
    for (const defense of [50, 200, 1000, 100_000]) {
      const through = damageThrough(defense);
      expect(through).toBeGreaterThanOrEqual(MIN_DAMAGE_THROUGH);
      expect(through).toBeLessThan(1);
    }
  });

  test('décroît strictement tant que le plancher n est pas atteint', () => {
    expect(damageThrough(20)).toBeGreaterThan(damageThrough(60));
    expect(damageThrough(60)).toBeGreaterThan(damageThrough(120));
  });

  test('une défense négative est traitée comme nulle', () => {
    expect(damageThrough(-50)).toBe(1);
  });
});

describe('computeAttack', () => {
  test('une défense élevée n annule plus les dégâts', () => {
    // Le Golem de Pierre frappait à 20 contre 44 de défense : l'ancienne formule
    // donnait `max(1, 20 - 22)` = 1 dégât, quel que soit le reste du combat.
    const { damage } = computeAttack({
      attack: 20, targetDefense: 44, speed: 3, critChance: 0, random: rng,
    });

    expect(damage).toBeGreaterThan(5);
  });

  test('une attaque écrasante ne passe plus intégralement', () => {
    // L'autre bout du même défaut : au-delà du seuil, la défense ne freinait plus rien
    // et les créatures tombaient en un coup.
    const { damage } = computeAttack({
      attack: 400, targetDefense: 60, speed: 3, critChance: 0, random: rng,
    });

    expect(damage).toBeLessThan(400);
    expect(damage).toBeGreaterThan(200);
  });

  test('la pénétration d armure rend la cible plus tendre', () => {
    const base = computeAttack({ attack: 100, targetDefense: 90, speed: 3, critChance: 0, random: rng });
    const pierced = computeAttack({
      attack: 100, targetDefense: 90, speed: 3, critChance: 0, armorPiercing: 0.5, random: rng,
    });

    expect(pierced.damage).toBeGreaterThan(base.damage);
  });

  test('la posture défensive de la cible encaisse davantage', () => {
    const base = computeAttack({ attack: 100, targetDefense: 60, speed: 3, critChance: 0, random: rng });
    const guarded = computeAttack({
      attack: 100, targetDefense: 60, speed: 3, critChance: 0, targetDefenseMultiplier: 2, random: rng,
    });

    expect(guarded.damage).toBeLessThan(base.damage);
  });

  test('la compétence multiplie les dégâts après atténuation', () => {
    const normal = computeAttack({ attack: 100, targetDefense: 90, speed: 3, critChance: 0, random: rng });
    const skill = computeAttack({
      attack: 100, targetDefense: 90, speed: 3, critChance: 0, skillMultiplier: 2, random: rng,
    });

    expect(skill.damage).toBeGreaterThan(normal.damage * 1.8);
  });

  test('le critique applique son multiplicateur', () => {
    const normal = computeAttack({ attack: 100, targetDefense: 90, speed: 3, critChance: 0, random: rng });
    // `critChance` à 1 : le tirage médian tombe forcément dessous.
    const crit = computeAttack({ attack: 100, targetDefense: 90, speed: 3, critChance: 1, random: rng });

    expect(crit.critical).toBe(true);
    expect(crit.damage).toBeGreaterThan(normal.damage * (CRIT_MULTIPLIER - 0.2));
  });

  test('la réduction du passif adverse s applique en dernier', () => {
    const base = computeAttack({ attack: 100, targetDefense: 60, speed: 3, critChance: 0, random: rng });
    const reduced = computeAttack({
      attack: 100, targetDefense: 60, speed: 3, critChance: 0, targetDamageReduction: 0.5, random: rng,
    });

    expect(reduced.damage).toBeCloseTo(Math.floor(base.damage * 0.5), 0);
  });

  test('les dégâts valent toujours au moins un', () => {
    // Aucun combat ne doit pouvoir se bloquer parce que les deux camps infligent zéro.
    const { damage } = computeAttack({
      attack: 1, targetDefense: 100_000, speed: 1, critChance: 0, targetDamageReduction: 0.9, random: rng,
    });

    expect(damage).toBeGreaterThanOrEqual(1);
  });

  test('vol de vie et épines se dérivent des dégâts réellement infligés', () => {
    const result = computeAttack({
      attack: 100, targetDefense: 0, speed: 3, critChance: 0,
      lifesteal: 0.5, targetThorns: 0.25, random: rng,
    });

    expect(result.healed).toBe(Math.floor(result.damage * 0.5));
    expect(result.reflected).toBe(Math.floor(result.damage * 0.25));
  });
});

describe('équilibre du combat', () => {
  /** Tours qu'il faut pour venir à bout d'une cible. */
  function turns(attack: number, defense: number, health: number): number {
    const { damage } = computeAttack({ attack, targetDefense: defense, speed: 10, critChance: 0, random: rng });
    return Math.ceil(health / damage);
  }

  test('une créature de son niveau ne tombe pas en un coup', () => {
    // Un personnage de niveau 20 correctement équipé, face au Golem d'Obsidienne.
    expect(turns(169, 38, 770)).toBeGreaterThanOrEqual(3);
  });

  test('une créature de son niveau ne dure pas non plus indéfiniment', () => {
    expect(turns(169, 38, 770)).toBeLessThanOrEqual(12);
  });

  test('un personnage très défensif encaisse quand même', () => {
    // 170 de défense face à une créature de haut palier : l'ancienne formule donnait 1.
    const { damage } = computeAttack({
      attack: 127, targetDefense: 170, speed: 10, critChance: 0, random: rng,
    });

    expect(damage).toBeGreaterThan(20);
  });
});
