/**
 * Préréglages du classement de prestige : gains de RP et échelle de paliers
 * posés ensemble, sans passer par les sections de configuration.
 *
 * Même parti pris que `levelingPresets` côté dashboard : chaque préréglage est
 * exprimé en crans du mode simple plutôt qu'en valeurs brutes, pour que la
 * configuration qu'il pose tombe toujours sur les curseurs et que passer en
 * mode détaillé ne montre jamais un réglage impossible à retrouver.
 */

import { generateRankedLadder, ladderApexRp, type LadderCurve } from './ladderCurve.js';
import type { RankedLadder } from './ladder.js';

/** Crans du curseur « rythme des gains ». */
export const RP_GAIN_STEPS = [
  { rpPerXp: 0.15, reactionRp: 1, reactionDailyCap: 10, dailyRpCap: 0 },
  { rpPerXp: 0.25, reactionRp: 2, reactionDailyCap: 15, dailyRpCap: 0 },
  { rpPerXp: 0.35, reactionRp: 2, reactionDailyCap: 15, dailyRpCap: 0 },
  { rpPerXp: 0.5, reactionRp: 3, reactionDailyCap: 25, dailyRpCap: 0 },
  { rpPerXp: 0.75, reactionRp: 5, reactionDailyCap: 40, dailyRpCap: 0 },
] as const;

/** Crans du curseur « largeur des paliers » : facteur appliqué au RP de base. */
export const LADDER_PACE_FACTORS = [0.4, 0.7, 1, 1.6, 2.6];
/** Crans du curseur « élargissement » : exposant de la courbe des seuils. */
export const LADDER_EXPONENT_STEPS = [1, 1.2, 1.35, 1.6, 2];

/** RP de base de référence, cran médian du curseur de largeur. */
export const LADDER_REFERENCE_BASE_RP = 250;

export function ladderPaceBaseRp(step: number): number {
  const factor = LADDER_PACE_FACTORS[Math.min(LADDER_PACE_FACTORS.length, Math.max(1, step)) - 1];
  return Math.max(10, Math.round(LADDER_REFERENCE_BASE_RP * factor));
}

export type RankedPresetValues = {
  rpPerXp: number;
  reactionRp: number;
  reactionDailyCap: number;
  dailyRpCap: number;
  ladderTierCount: number;
  ladderBaseRp: number;
  ladderExponent: number;
  ladderDivisions: number;
  decayEnabled: boolean;
  streakEnabled: boolean;
};

export type RankedPreset = {
  id: string;
  icon: string;
  gainStep: number;
  paceStep: number;
  steepStep: number;
  tierCount: number;
  divisions: number;
  decayEnabled: boolean;
  streakEnabled: boolean;
  /** Mis en avant dans la grille : le choix sûr pour une guilde qui débute. */
  recommended?: boolean;
};

export const RANKED_PRESETS: readonly RankedPreset[] = [
  { id: 'classic', icon: 'Shield', gainStep: 3, paceStep: 3, steepStep: 3, tierCount: 19, divisions: 3, decayEnabled: false, streakEnabled: true, recommended: true },
  { id: 'sprint', icon: 'Zap', gainStep: 5, paceStep: 2, steepStep: 2, tierCount: 12, divisions: 3, decayEnabled: false, streakEnabled: true },
  { id: 'esport', icon: 'Crown', gainStep: 3, paceStep: 3, steepStep: 4, tierCount: 19, divisions: 3, decayEnabled: true, streakEnabled: true },
  { id: 'compact', icon: 'Grades', gainStep: 3, paceStep: 4, steepStep: 3, tierCount: 6, divisions: 1, decayEnabled: false, streakEnabled: true },
  { id: 'marathon', icon: 'Flame', gainStep: 2, paceStep: 5, steepStep: 5, tierCount: 24, divisions: 3, decayEnabled: true, streakEnabled: true },
];

export function rankedPresetValues(preset: RankedPreset): RankedPresetValues {
  const gains = RP_GAIN_STEPS[Math.min(RP_GAIN_STEPS.length, Math.max(1, preset.gainStep)) - 1];
  return {
    ...gains,
    ladderTierCount: preset.tierCount,
    ladderBaseRp: ladderPaceBaseRp(preset.paceStep),
    ladderExponent: LADDER_EXPONENT_STEPS[Math.min(LADDER_EXPONENT_STEPS.length, Math.max(1, preset.steepStep)) - 1],
    ladderDivisions: preset.divisions,
    decayEnabled: preset.decayEnabled,
    streakEnabled: preset.streakEnabled,
  };
}

export function rankedValuesCurve(values: Pick<RankedPresetValues, 'ladderTierCount' | 'ladderBaseRp' | 'ladderExponent' | 'ladderDivisions'>): LadderCurve {
  return {
    tierCount: values.ladderTierCount,
    baseRp: values.ladderBaseRp,
    exponent: values.ladderExponent,
    divisions: values.ladderDivisions,
  };
}

export function rankedValuesLadder(values: RankedPresetValues): RankedLadder {
  return generateRankedLadder(rankedValuesCurve(values));
}

/** RP du sommet de l'échelle : le repère qui distingue deux préréglages. */
export function rankedValuesApexRp(values: RankedPresetValues): number {
  return ladderApexRp(rankedValuesLadder(values));
}

export function matchesRankedPreset(preset: RankedPreset, config: Partial<RankedPresetValues>): boolean {
  const values = rankedPresetValues(preset);
  return (Object.keys(values) as Array<keyof RankedPresetValues>)
    .every((key) => values[key] === config[key]);
}

export function findRankedPreset(config: Partial<RankedPresetValues>): RankedPreset | null {
  return RANKED_PRESETS.find((preset) => matchesRankedPreset(preset, config)) ?? null;
}
