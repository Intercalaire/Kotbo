/**
 * Prereglages AutoMod : niveaux de protection poses d'un coup, sans parcourir
 * les vingt sections des onglets.
 *
 * Un prereglage ne touche qu'aux reglages qui ont un sens sans connaitre le
 * serveur : les interrupteurs, les seuils et les sanctions. Tout ce qui demande
 * un salon, un role ou une liste de mots reste a regler dans les onglets, un
 * prereglage n'ayant aucun moyen de les deviner.
 *
 * L'anti-bot et la suspension par rafale en sont exclus pour une autre raison :
 * l'API les reserve au proprietaire du serveur, un prereglage qui y toucherait
 * serait refuse a tout autre administrateur. L'AutoMod natif de Discord l'est
 * aussi : l'API le force a true a chaque enregistrement, un prereglage ne peut
 * donc pas le piloter.
 */

/** Reglages du modele AutoMod (filtres du bot). */
export type AutomodFilterValues = {
  spamEnabled: boolean;
  spamLimit: number;
  spamIntervalSeconds: number;
  spamAction: string;
  linksEnabled: boolean;
  linksAction: string;
  capsEnabled: boolean;
  capsThresholdPercent: number;
  capsMinLength: number;
  emojisEnabled: boolean;
  emojisLimit: number;
  mentionsEnabled: boolean;
  mentionsLimit: number;
  ghostPingEnabled: boolean;
  ghostPingAction: string;
  antiEveryoneEnabled: boolean;
  antiEveryoneAction: string;
  profanityEnabled: boolean;
  profanityAction: string;
  profanityTimeoutSec: number;
  inviteFilterEnabled: boolean;
  inviteFilterAction: string;
  inviteFilterTimeoutSec: number;
};

/** Reglages du modele Anti-Raid qui ne dependent d'aucun salon ni role. */
export type AutomodRaidValues = {
  antiRaidEnabled: boolean;
  antiRaidJoinThreshold: number;
  antiRaidJoinWindowSec: number;
  antiRaidAction: string;
  antiRaidAutoDisableMinutes: number;
  scamFilterEnabled: boolean;
  scamFilterAction: string;
  scamFilterTimeoutMin: number;
  scamImageFilterEnabled: boolean;
};

export type AutomodPreset = {
  id: string;
  icon: string;
  filters: AutomodFilterValues;
  raid: AutomodRaidValues;
  /** Mis en avant dans la grille : le choix sur pour une guilde qui debute. */
  recommended?: boolean;
};

export const AUTOMOD_PRESETS: readonly AutomodPreset[] = [
  {
    id: 'light',
    icon: 'Shield',
    filters: {
      spamEnabled: true, spamLimit: 8, spamIntervalSeconds: 5, spamAction: 'WARN',
      linksEnabled: false, linksAction: 'DELETE_AND_WARN',
      capsEnabled: false, capsThresholdPercent: 80, capsMinLength: 10,
      emojisEnabled: false, emojisLimit: 15,
      mentionsEnabled: true, mentionsLimit: 8,
      ghostPingEnabled: false, ghostPingAction: 'ALERT',
      antiEveryoneEnabled: true, antiEveryoneAction: 'DELETE_AND_WARN',
      profanityEnabled: false, profanityAction: 'BLOCK', profanityTimeoutSec: 60,
      inviteFilterEnabled: false, inviteFilterAction: 'BLOCK', inviteFilterTimeoutSec: 60,
    },
    raid: {
      antiRaidEnabled: false, antiRaidJoinThreshold: 15, antiRaidJoinWindowSec: 60, antiRaidAction: 'LOCK', antiRaidAutoDisableMinutes: 30,
      scamFilterEnabled: true, scamFilterAction: 'DELETE', scamFilterTimeoutMin: 60,
      scamImageFilterEnabled: false,
    },
  },
  {
    id: 'standard',
    icon: 'ShieldCheck',
    recommended: true,
    filters: {
      spamEnabled: true, spamLimit: 5, spamIntervalSeconds: 5, spamAction: 'TIMEOUT',
      linksEnabled: true, linksAction: 'DELETE_AND_WARN',
      capsEnabled: true, capsThresholdPercent: 80, capsMinLength: 10,
      emojisEnabled: true, emojisLimit: 10,
      mentionsEnabled: true, mentionsLimit: 5,
      ghostPingEnabled: true, ghostPingAction: 'ALERT',
      antiEveryoneEnabled: true, antiEveryoneAction: 'DELETE_AND_WARN',
      profanityEnabled: true, profanityAction: 'BLOCK', profanityTimeoutSec: 60,
      inviteFilterEnabled: true, inviteFilterAction: 'BLOCK', inviteFilterTimeoutSec: 60,
    },
    raid: {
      antiRaidEnabled: true, antiRaidJoinThreshold: 10, antiRaidJoinWindowSec: 60, antiRaidAction: 'LOCK', antiRaidAutoDisableMinutes: 30,
      scamFilterEnabled: true, scamFilterAction: 'DELETE_AND_TIMEOUT', scamFilterTimeoutMin: 60,
      scamImageFilterEnabled: true,
    },
  },
  {
    id: 'strict',
    icon: 'ShieldAlert',
    filters: {
      spamEnabled: true, spamLimit: 3, spamIntervalSeconds: 5, spamAction: 'TIMEOUT',
      linksEnabled: true, linksAction: 'DELETE_AND_WARN',
      capsEnabled: true, capsThresholdPercent: 60, capsMinLength: 8,
      emojisEnabled: true, emojisLimit: 5,
      mentionsEnabled: true, mentionsLimit: 3,
      ghostPingEnabled: true, ghostPingAction: 'WARN',
      antiEveryoneEnabled: true, antiEveryoneAction: 'DELETE_AND_WARN',
      profanityEnabled: true, profanityAction: 'BLOCK', profanityTimeoutSec: 300,
      inviteFilterEnabled: true, inviteFilterAction: 'BLOCK', inviteFilterTimeoutSec: 300,
    },
    raid: {
      antiRaidEnabled: true, antiRaidJoinThreshold: 5, antiRaidJoinWindowSec: 60, antiRaidAction: 'LOCK', antiRaidAutoDisableMinutes: 60,
      scamFilterEnabled: true, scamFilterAction: 'DELETE_AND_TIMEOUT', scamFilterTimeoutMin: 180,
      scamImageFilterEnabled: true,
    },
  },
];

/** Nombre de filtres actifs, l'indicateur le plus parlant d'un niveau. */
export function automodActiveFilterCount(
  filters: Partial<AutomodFilterValues>,
  raid: Partial<AutomodRaidValues>,
): number {
  const switches = [
    filters.spamEnabled, filters.linksEnabled, filters.capsEnabled, filters.emojisEnabled,
    filters.mentionsEnabled, filters.ghostPingEnabled, filters.antiEveryoneEnabled,
    filters.profanityEnabled, filters.inviteFilterEnabled,
    raid.antiRaidEnabled, raid.scamFilterEnabled, raid.scamImageFilterEnabled,
  ];
  return switches.filter(Boolean).length;
}

export const AUTOMOD_FILTER_TOTAL = 12;

export function matchesAutomodPreset(
  preset: AutomodPreset,
  filters: Partial<AutomodFilterValues>,
  raid: Partial<AutomodRaidValues>,
): boolean {
  const filtersMatch = (Object.keys(preset.filters) as Array<keyof AutomodFilterValues>)
    .every((key) => preset.filters[key] === filters[key]);
  const raidMatch = (Object.keys(preset.raid) as Array<keyof AutomodRaidValues>)
    .every((key) => preset.raid[key] === raid[key]);
  return filtersMatch && raidMatch;
}

export function findAutomodPreset(
  filters: Partial<AutomodFilterValues>,
  raid: Partial<AutomodRaidValues>,
): AutomodPreset | null {
  return AUTOMOD_PRESETS.find((preset) => matchesAutomodPreset(preset, filters, raid)) ?? null;
}
