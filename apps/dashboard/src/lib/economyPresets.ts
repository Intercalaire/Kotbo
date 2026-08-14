/**
 * Prereglages d'economie : rythme des gains et de l'energie pose d'un coup,
 * sans reprendre les six champs un par un.
 *
 * Un prereglage ne touche qu'au rythme. Le nom de la monnaie, son emoji et les
 * interrupteurs de modules (RPG, boutique, guildes) tiennent a l'identite du
 * serveur, qu'un prereglage n'a aucun moyen de deviner.
 */

export type EconomyPresetValues = {
  dailyRewardMin: number;
  dailyRewardMax: number;
  dailyCooldownHour: number;
  adventureCooldownMin: number;
  maxEnergy: number;
  energyRecoveryPerHour: number;
};

export type EconomyPreset = {
  id: string;
  icon: string;
  values: EconomyPresetValues;
  /** Mis en avant dans la grille : le choix sur pour une guilde qui debute. */
  recommended?: boolean;
};

export const ECONOMY_PRESETS: readonly EconomyPreset[] = [
  {
    id: 'calm',
    icon: 'Clock',
    values: {
      dailyRewardMin: 25,
      dailyRewardMax: 75,
      dailyCooldownHour: 24,
      adventureCooldownMin: 60,
      maxEnergy: 60,
      energyRecoveryPerHour: 5,
    },
  },
  {
    id: 'standard',
    icon: 'Star',
    recommended: true,
    values: {
      dailyRewardMin: 50,
      dailyRewardMax: 150,
      dailyCooldownHour: 20,
      adventureCooldownMin: 30,
      maxEnergy: 100,
      energyRecoveryPerHour: 10,
    },
  },
  {
    id: 'generous',
    icon: 'Zap',
    values: {
      dailyRewardMin: 100,
      dailyRewardMax: 250,
      dailyCooldownHour: 12,
      adventureCooldownMin: 15,
      maxEnergy: 150,
      energyRecoveryPerHour: 20,
    },
  },
];

/**
 * Pieces gagnees par jour via le daily. Le seul chiffre qui rende deux
 * prereglages comparables : un gain de 150 toutes les 24 h et un gain de 100
 * toutes les 12 h ne se classent pas dans l'ordre qu'on croit.
 */
export function economyDailyCoins(values: EconomyPresetValues): number {
  const average = (values.dailyRewardMin + values.dailyRewardMax) / 2;
  const claimsPerDay = 24 / Math.max(1, values.dailyCooldownHour);
  return Math.round(average * claimsPerDay);
}

/** Heures qu'il faut pour remplir la jauge d'energie depuis zero. */
export function economyEnergyRefillHours(values: EconomyPresetValues): number {
  return Math.round(values.maxEnergy / Math.max(1, values.energyRecoveryPerHour));
}

export function matchesEconomyPreset(
  preset: EconomyPreset,
  config: Partial<EconomyPresetValues>,
): boolean {
  return (Object.keys(preset.values) as Array<keyof EconomyPresetValues>)
    .every((key) => preset.values[key] === config[key]);
}

export function findEconomyPreset(config: Partial<EconomyPresetValues>): EconomyPreset | null {
  return ECONOMY_PRESETS.find((preset) => matchesEconomyPreset(preset, config)) ?? null;
}
