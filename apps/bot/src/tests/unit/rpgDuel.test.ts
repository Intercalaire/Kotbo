import { describe, expect, test } from 'bun:test';
import { pickDuelSkill, rollMonsterLoot, simulateDuel, type DuelStats } from '../../services/features/rpg/rpgDuel.js';

const stats: DuelStats = {
  attack: 40,
  defense: 20,
  speed: 10,
  maxHealth: 200,
  critChance: 0,
  armorPiercing: 0,
  lifesteal: 0,
  damageReduction: 0,
  thorns: 0,
};

/** Générateur qui ne fait jamais de critique ni de variance, pour des combats rejouables. */
const flat = () => 0.99;

describe('combat automatique', () => {
  test('un joueur bien plus fort gagne, et ses PV ne remontent pas au-delà du départ', () => {
    const result = simulateDuel({
      stats,
      skill: null,
      playerHp: 150,
      monster: { health: 60, attack: 5, defense: 2, speed: 1 },
      random: flat,
    });
    expect(result.won).toBe(true);
    expect(result.monsterHp).toBe(0);
    expect(result.playerHp).toBeLessThanOrEqual(150);
    expect(result.turns[0].attacker).toBe('player');
  });

  test('un joueur à bout de souffle perd', () => {
    const result = simulateDuel({
      stats,
      skill: null,
      playerHp: 5,
      monster: { health: 5000, attack: 80, defense: 60, speed: 50 },
      random: flat,
    });
    expect(result.won).toBe(false);
    expect(result.playerHp).toBe(0);
    expect(result.turns[0].attacker).toBe('monster');
  });

  test('les dégâts cumulés correspondent aux tours', () => {
    const result = simulateDuel({
      stats,
      skill: null,
      playerHp: 200,
      monster: { health: 300, attack: 20, defense: 10, speed: 5 },
      random: flat,
    });
    const dealt = result.turns.filter((turn) => turn.attacker === 'player').reduce((sum, turn) => sum + turn.damage, 0);
    expect(result.totalDamageDealt).toBe(dealt);
  });

  test('la meilleure compétence offensive est retenue, jamais une compétence de soutien', () => {
    const skills = [
      { name: 'Garde', cooldownTurns: 2, effect: { damageMultiplier: 0 } },
      { name: 'Frappe', cooldownTurns: 2, effect: { damageMultiplier: 1.5 } },
      { name: 'Exécution', cooldownTurns: 3, effect: { damageMultiplier: 2.2 } },
    ];
    expect(pickDuelSkill(skills)?.name).toBe('Exécution');
    expect(pickDuelSkill([skills[0]])).toBeNull();
  });
});

describe('gains d\'une victoire', () => {
  const monster = {
    xpReward: 100,
    coinReward: 50,
    drops: [
      { itemName: 'Écaille', emoji: '✨', chance: 0.5 },
      { itemName: 'Bourse', emoji: '💰', chance: 1, coinBonus: 30 },
    ],
  };

  test('sans aléa, la récompense de base et le premier butin réussi', () => {
    const loot = rollMonsterLoot(monster, () => 0);
    expect(loot).toMatchObject({ xp: 100, coins: 50, drop: { itemName: 'Écaille' } });
  });

  test('un butin raté laisse sa chance au suivant, avec son bonus de pièces', () => {
    const loot = rollMonsterLoot(monster, () => 0.9);
    expect(loot.drop?.itemName).toBe('Bourse');
    expect(loot.coins).toBe(50 + Math.floor(0.9 * 15) + 30);
  });

  test('les butins stockés en texte sont relus', () => {
    const loot = rollMonsterLoot({ ...monster, drops: JSON.stringify(monster.drops) }, () => 0);
    expect(loot.drop?.itemName).toBe('Écaille');
  });
});
