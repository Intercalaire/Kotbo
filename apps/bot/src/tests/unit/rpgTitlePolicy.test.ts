import { describe, expect, test } from 'bun:test';
import { DEFAULT_TITLE_COLOR, normalizeTitleInput, titleBonusParts } from '../../services/features/rpg/rpgTitlePolicy.js';

describe('normalisation d\'un titre', () => {
  test('refuse un titre sans nom', () => {
    expect(normalizeTitleInput({ name: '   ' }).ok).toBe(false);
  });

  test('refuse un nom trop long pour la carte', () => {
    expect(normalizeTitleInput({ name: 'Pourfendeur des dragons anciens' }).ok).toBe(false);
    expect(normalizeTitleInput({ name: 'Pourfendeur de dragons' }).ok).toBe(true);
  });

  test('borne les bonus', () => {
    const result = normalizeTitleInput({ name: 'Tueur de dragons', attackBonus: 99_999, critBonus: 80, healthBonus: -5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attackBonus).toBe(1_000);
    expect(result.value.critBonus).toBe(25);
    expect(result.value.healthBonus).toBe(0);
  });

  test('retombe sur la couleur par défaut quand elle est invalide', () => {
    const result = normalizeTitleInput({ name: 'Vétéran', color: 'rouge' });
    expect(result.ok && result.value.color).toBe(DEFAULT_TITLE_COLOR);
  });
});

describe('bonus d\'un titre', () => {
  test('ne garde que les bonus non nuls', () => {
    expect(titleBonusParts({ attackBonus: 10, defenseBonus: 0, speedBonus: 0, healthBonus: 50, critBonus: 0 }))
      .toEqual([{ stat: 'atk', value: 10 }, { stat: 'hp', value: 50 }]);
  });
});
