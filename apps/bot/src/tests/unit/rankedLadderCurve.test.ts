import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_LADDER_CURVE,
  LADDER_CURVE_LIMITS,
  RANKED_PRESETS,
  findRankedPreset,
  generateRankedLadder,
  ladderApexRp,
  ladderMatchesCurve,
  normalizeLadderCurve,
  normalizeRankedLadder,
  rankedPresetValues,
  rankedProgress,
  rankedValuesApexRp,
  resolveRankedTier,
} from '@kotbo/shared';

describe('normalizeLadderCurve', () => {
  test('borne les reglages et retombe sur la courbe par defaut', () => {
    expect(normalizeLadderCurve(null)).toEqual(DEFAULT_LADDER_CURVE);
    expect(normalizeLadderCurve({ tierCount: 900 }).tierCount).toBe(LADDER_CURVE_LIMITS.tierCount.max);
    expect(normalizeLadderCurve({ tierCount: 0 }).tierCount).toBe(LADDER_CURVE_LIMITS.tierCount.min);
    expect(normalizeLadderCurve({ exponent: 'abc' }).exponent).toBe(DEFAULT_LADDER_CURVE.exponent);
  });
});

describe('generateRankedLadder', () => {
  test('produit exactement le nombre de paliers demande', () => {
    for (const tierCount of [2, 6, 19, 30]) {
      expect(generateRankedLadder({ ...DEFAULT_LADDER_CURVE, tierCount })).toHaveLength(tierCount);
    }
  });

  test('demarre a 0 RP et reste strictement croissante, meme avec un RP de base minuscule', () => {
    const ladder = generateRankedLadder({ tierCount: 30, baseRp: 10, exponent: 1, divisions: 3 });
    expect(ladder[0].minRp).toBe(0);
    for (let index = 1; index < ladder.length; index++) {
      expect(ladder[index].minRp).toBeGreaterThan(ladder[index - 1].minRp);
    }
  });

  test('n a aucune cle en double, y compris au-dela des familles nommees', () => {
    const ladder = generateRankedLadder({ tierCount: 30, baseRp: 250, exponent: 1.35, divisions: 1 });
    expect(new Set(ladder.map((tier) => tier.key)).size).toBe(ladder.length);
  });

  test('reserve le sommet a une famille sans division', () => {
    const ladder = generateRankedLadder({ ...DEFAULT_LADDER_CURVE, tierCount: 19, divisions: 3 });
    expect(ladder[ladder.length - 1].division).toBe(0);
    expect(ladder[ladder.length - 2].division).toBeGreaterThan(0);
  });

  test('sans division, aucun palier ne porte de chiffre romain', () => {
    const ladder = generateRankedLadder({ ...DEFAULT_LADDER_CURVE, tierCount: 6, divisions: 1 });
    expect(ladder.every((tier) => tier.division === 0)).toBe(true);
    expect(ladder.map((tier) => tier.name)).toEqual(['Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond']);
  });

  test('un exposant plus eleve elargit les ecarts du haut sans toucher au premier', () => {
    const flat = generateRankedLadder({ ...DEFAULT_LADDER_CURVE, exponent: 1 });
    const steep = generateRankedLadder({ ...DEFAULT_LADDER_CURVE, exponent: 2 });
    expect(steep[1].minRp).toBe(flat[1].minRp);
    expect(ladderApexRp(steep)).toBeGreaterThan(ladderApexRp(flat));
  });

  test('l echelle generee traverse la normalisation sans perdre un palier', () => {
    const ladder = generateRankedLadder(DEFAULT_LADDER_CURVE);
    expect(normalizeRankedLadder(ladder)).toEqual(ladder);
  });

  test('reste utilisable par les fonctions de palier', () => {
    const ladder = generateRankedLadder({ tierCount: 4, baseRp: 100, exponent: 1, divisions: 1 });
    expect(resolveRankedTier(0, ladder).key).toBe(ladder[0].key);
    expect(resolveRankedTier(ladder[2].minRp, ladder).key).toBe(ladder[2].key);
    expect(rankedProgress(ladder[3].minRp, ladder).next).toBeNull();
  });
});

describe('ladderMatchesCurve', () => {
  test('reconnait sa propre echelle et rejette une echelle retouchee', () => {
    const ladder = generateRankedLadder(DEFAULT_LADDER_CURVE);
    expect(ladderMatchesCurve(ladder, DEFAULT_LADDER_CURVE)).toBe(true);

    const edited = ladder.map((tier, index) => (index === 3 ? { ...tier, minRp: tier.minRp + 1 } : tier));
    expect(ladderMatchesCurve(edited, DEFAULT_LADDER_CURVE)).toBe(false);
    expect(ladderMatchesCurve(ladder.slice(0, -1), DEFAULT_LADDER_CURVE)).toBe(false);
  });
});

describe('prereglages du prestige', () => {
  test('chaque prereglage se retrouve a partir des valeurs qu il pose', () => {
    for (const preset of RANKED_PRESETS) {
      expect(findRankedPreset(rankedPresetValues(preset))?.id).toBe(preset.id);
    }
  });

  test('une configuration hors prereglage n en designe aucun', () => {
    const values = { ...rankedPresetValues(RANKED_PRESETS[0]), ladderBaseRp: 137 };
    expect(findRankedPreset(values)).toBeNull();
  });

  test('les sommets s echelonnent du plus court au plus long', () => {
    const sprint = rankedValuesApexRp(rankedPresetValues(RANKED_PRESETS.find((preset) => preset.id === 'sprint')!));
    const marathon = rankedValuesApexRp(rankedPresetValues(RANKED_PRESETS.find((preset) => preset.id === 'marathon')!));
    expect(marathon).toBeGreaterThan(sprint);
  });
});
