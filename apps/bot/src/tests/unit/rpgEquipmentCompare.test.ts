import { describe, expect, test } from 'bun:test';
import { compareStats } from '../../services/features/rpg/rpgEquipmentCompare.js';
import { itemContribution } from '../../services/features/rpg/rpgStats.js';

const stats = (atk: number, def: number, spd: number, hp: number) => ({ atk, def, spd, hp });

describe('comparaison avec l equipement porte', () => {
  test('donne l ecart stat par stat', () => {
    expect(compareStats(stats(9, 0, 2, 0), stats(5, 0, 3, 0))).toEqual([
      { stat: 'atk', value: 9, delta: 4 },
      { stat: 'spd', value: 2, delta: -1 },
    ]);
  });

  test('garde une stat que l objet regarde n a pas mais que le porte avait', () => {
    expect(compareStats(stats(9, 0, 0, 0), stats(5, 3, 0, 0))).toContainEqual({ stat: 'def', value: 0, delta: -3 });
  });

  test('sur un emplacement libre, tout est un gain', () => {
    expect(compareStats(stats(0, 4, 0, 20), null)).toEqual([
      { stat: 'def', value: 4, delta: 4 },
      { stat: 'hp', value: 20, delta: 20 },
    ]);
  });

  // L'objet porte +5 compte avec sa forge : sans elle, une arme neuve semblerait meilleure
  // qu'une arme amelioree qui la depasse en realite.
  test('la forge de la piece portee entre dans la comparaison', () => {
    const worn = itemContribution({ atkBonus: 10, defBonus: 0, spdBonus: 0, hpBonus: 0, rarity: 'COMMON', upgrade: 5, enchants: [] });
    const [atk] = compareStats(stats(14, 0, 0, 0), worn);
    expect(atk?.delta).toBeLessThan(0);
  });
});
