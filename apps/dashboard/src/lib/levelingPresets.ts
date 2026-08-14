/**
 * Prereglages du leveling : gains d'XP et courbe de progression posees
 * ensemble, sans passer par les onglets de configuration.
 *
 * Chaque prereglage est exprime en crans du mode simple plutot qu'en valeurs
 * brutes : la configuration qu'il pose tombe donc toujours sur les curseurs des
 * cartes « Gains d'XP » et « Progression », et passer en configuration
 * detaillee ne montre jamais un mode avance impose par un prereglage.
 */
import { DEFAULT_LEVEL_CURVE, xpForLevel, type LevelCurve } from '@kotbo/shared';

export const GAIN_STEPS = [
  { xpMin: 5, xpMax: 10, cooldownSeconds: 120, vocalXpPerMin: 2 },
  { xpMin: 10, xpMax: 15, cooldownSeconds: 90, vocalXpPerMin: 3 },
  { xpMin: 15, xpMax: 25, cooldownSeconds: 60, vocalXpPerMin: 5 },
  { xpMin: 25, xpMax: 40, cooldownSeconds: 45, vocalXpPerMin: 8 },
  { xpMin: 40, xpMax: 60, cooldownSeconds: 30, vocalXpPerMin: 12 },
];

export const CURVE_PACE_FACTORS = [0.35, 0.6, 1, 1.7, 3];
export const CURVE_EXPONENT_STEPS = [1.2, 1.6, 2, 2.5, 3];

export function curvePaceValues(step: number): { baseXp: number; linearXp: number } {
  const factor = CURVE_PACE_FACTORS[Math.min(CURVE_PACE_FACTORS.length, Math.max(1, step)) - 1];
  return {
    baseXp: Math.max(1, Math.round(DEFAULT_LEVEL_CURVE.baseXp * factor)),
    linearXp: Math.round(DEFAULT_LEVEL_CURVE.linearXp * factor),
  };
}

export type LevelingPresetValues = {
  xpMin: number;
  xpMax: number;
  cooldownSeconds: number;
  vocalXpPerMin: number;
  curveBaseXp: number;
  curveLinearXp: number;
  curveExponent: number;
  maxLevel: number;
};

export type LevelingPreset = {
  id: string;
  icon: string;
  gainStep: number;
  paceStep: number;
  steepStep: number;
  maxLevel: number;
  /** Mis en avant dans la grille : le choix sur pour une guilde qui debute. */
  recommended?: boolean;
};

export const LEVELING_PRESETS: readonly LevelingPreset[] = [
  { id: 'basic', icon: 'Star', gainStep: 3, paceStep: 3, steepStep: 3, maxLevel: 0, recommended: true },
  { id: 'fast', icon: 'Zap', gainStep: 5, paceStep: 2, steepStep: 2, maxLevel: 0 },
  { id: 'progressive', icon: 'TrendingUp', gainStep: 3, paceStep: 3, steepStep: 4, maxLevel: 0 },
  { id: 'prestige', icon: 'Crown', gainStep: 4, paceStep: 2, steepStep: 3, maxLevel: 100 },
  { id: 'marathon', icon: 'Flame', gainStep: 3, paceStep: 4, steepStep: 5, maxLevel: 0 },
];

export function levelingPresetValues(preset: LevelingPreset): LevelingPresetValues {
  const gains = GAIN_STEPS[Math.min(GAIN_STEPS.length, Math.max(1, preset.gainStep)) - 1];
  const pace = curvePaceValues(preset.paceStep);
  return {
    ...gains,
    curveBaseXp: pace.baseXp,
    curveLinearXp: pace.linearXp,
    curveExponent: CURVE_EXPONENT_STEPS[Math.min(CURVE_EXPONENT_STEPS.length, Math.max(1, preset.steepStep)) - 1],
    maxLevel: preset.maxLevel,
  };
}

export function levelingValuesCurve(values: LevelingPresetValues): LevelCurve {
  return {
    baseXp: values.curveBaseXp,
    linearXp: values.curveLinearXp,
    exponent: values.curveExponent,
    maxLevel: values.maxLevel,
  };
}

/** XP totale a accumuler pour atteindre `level` avec la courbe donnee. */
export function levelingValuesXpForLevel(values: LevelingPresetValues, level: number): number {
  return xpForLevel(level - 1, levelingValuesCurve(values));
}

export function levelingValuesHourlyXp(values: LevelingPresetValues): number {
  return Math.round((values.xpMin + values.xpMax) / 2 * (3600 / Math.max(1, values.cooldownSeconds)));
}

export function matchesLevelingPreset(
  preset: LevelingPreset,
  config: Partial<LevelingPresetValues>,
): boolean {
  const values = levelingPresetValues(preset);
  return (Object.keys(values) as Array<keyof LevelingPresetValues>)
    .every((key) => values[key] === config[key]);
}

export function findLevelingPreset(config: Partial<LevelingPresetValues>): LevelingPreset | null {
  return LEVELING_PRESETS.find((preset) => matchesLevelingPreset(preset, config)) ?? null;
}
