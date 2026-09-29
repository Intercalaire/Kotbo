/**
 * Règles de la Tour de clan. Aucun accès base.
 *
 * Une fois par semaine, les clans du serveur gravissent une même tour, chacun de son côté.
 * Chaque membre y entre à égalité une fois par jour de l'événement ; le premier d'un clan à
 * franchir un étage le conquiert pour lui. À la clôture, chaque étage conquis paie son
 * conquérant, et le podium paie le clan entier.
 */

import { TOWER_FLOORS_AFTER, type TowerFloorsAfter } from './rpgTowerMap.js';

export const CLAN_TOWER_RANGES = {
  weekday: { min: 0, max: 6 },
  hour: { min: 0, max: 23 },
  durationHours: { min: 24, max: 96 },
  pointsPerFloor: { min: 0, max: 1_000 },
  podiumPoints: { min: 0, max: 100_000 },
} as const;

export const CLAN_TOWER_NAME_MAX = 40;
export const CLAN_TOWER_PODIUM_SIZE = 3;

/** Une tentative par membre et par tranche de vingt-quatre heures depuis l'ouverture. */
const ATTEMPT_MS = 24 * 60 * 60 * 1000;

export type ClanTowerSettings = {
  enabled: boolean;
  name: string;
  floorsAfter: TowerFloorsAfter;
  generatedFog: boolean;
  weekday: number;
  hour: number;
  durationHours: number;
  pointsPerFloor: number;
  podiumPoints: number[];
  announceChannelId: string | null;
};

export const CLAN_TOWER_DEFAULTS: ClanTowerSettings = {
  enabled: false,
  name: 'Tour de clan',
  floorsAfter: 'GENERATE',
  generatedFog: true,
  weekday: 6,
  hour: 18,
  durationHours: 48,
  pointsPerFloor: 10,
  podiumPoints: [150, 100, 50],
  announceChannelId: null,
};

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(parsed)));
}

/** Réglages relus ou reçus du dashboard : un champ absent ou illisible garde sa valeur de repli. */
export function normalizeClanTowerSettings(input: Record<string, unknown>, base: ClanTowerSettings = CLAN_TOWER_DEFAULTS): ClanTowerSettings {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, CLAN_TOWER_NAME_MAX) : base.name;
  const podium = Array.isArray(input.podiumPoints) ? input.podiumPoints : base.podiumPoints;
  const channel = input.announceChannelId === undefined ? base.announceChannelId : input.announceChannelId;
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
    name: name || CLAN_TOWER_DEFAULTS.name,
    floorsAfter: TOWER_FLOORS_AFTER.includes(input.floorsAfter as TowerFloorsAfter) ? (input.floorsAfter as TowerFloorsAfter) : base.floorsAfter,
    generatedFog: typeof input.generatedFog === 'boolean' ? input.generatedFog : base.generatedFog,
    weekday: clampInt(input.weekday, CLAN_TOWER_RANGES.weekday, base.weekday),
    hour: clampInt(input.hour, CLAN_TOWER_RANGES.hour, base.hour),
    durationHours: clampInt(input.durationHours, CLAN_TOWER_RANGES.durationHours, base.durationHours),
    pointsPerFloor: clampInt(input.pointsPerFloor, CLAN_TOWER_RANGES.pointsPerFloor, base.pointsPerFloor),
    podiumPoints: Array.from({ length: CLAN_TOWER_PODIUM_SIZE }, (_, index) =>
      clampInt(podium[index], CLAN_TOWER_RANGES.podiumPoints, 0)),
    announceChannelId: typeof channel === 'string' && /^\d{5,25}$/.test(channel) ? channel : null,
  };
}

/** Tentative en cours : la première journée depuis l'ouverture vaut 0, la suivante 1… */
export function clanTowerAttemptIndex(startsAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - startsAt.getTime()) / ATTEMPT_MS));
}

/** Clé d'une tentative, rangée dans `RpgTowerRun.dailyKey`. */
export function clanTowerAttemptKey(eventId: string, startsAt: Date, now: Date = new Date()): string {
  return `clan:${eventId}:${clanTowerAttemptIndex(startsAt, now)}`;
}

/** Prochaine tentative, ou `null` si l'événement ferme avant. */
export function nextClanTowerAttempt(startsAt: Date, endsAt: Date, now: Date = new Date()): Date | null {
  const next = new Date(startsAt.getTime() + (clanTowerAttemptIndex(startsAt, now) + 1) * ATTEMPT_MS);
  return next.getTime() < endsAt.getTime() ? next : null;
}

export type ClanTowerConquestRow = { clanId: string; floor: number; userId: string; conqueredAt: Date };

export type ClanTowerStanding = {
  clanId: string;
  /** Plus haut étage conquis. */
  floors: number;
  /** Moment où cet étage a été conquis : à étages égaux, le premier arrivé passe devant. */
  reachedAt: Date;
  /** Étages conquis par membre, du plus au moins. */
  climbers: { userId: string; floors: number }[];
  rank: number;
};

/** Classement des clans : l'étage le plus haut, puis le premier à l'avoir atteint. */
export function rankClanTower(conquests: readonly ClanTowerConquestRow[]): ClanTowerStanding[] {
  const byClan = new Map<string, ClanTowerConquestRow[]>();
  for (const row of conquests) {
    const rows = byClan.get(row.clanId) ?? [];
    rows.push(row);
    byClan.set(row.clanId, rows);
  }
  const standings = [...byClan.entries()].map(([clanId, rows]) => {
    const top = rows.reduce((best, row) => (row.floor > best.floor ? row : best));
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
    return {
      clanId,
      floors: top.floor,
      reachedAt: top.conqueredAt,
      climbers: [...counts.entries()].map(([userId, floors]) => ({ userId, floors })).sort((a, b) => b.floors - a.floors),
      rank: 0,
    };
  });
  standings.sort((a, b) => b.floors - a.floors || a.reachedAt.getTime() - b.reachedAt.getTime());
  return standings.map((standing, index) => ({ ...standing, rank: index + 1 }));
}

export type ClanTowerAward = {
  clanId: string;
  rank: number;
  floors: number;
  /** Étages conquis et points, par conquérant. */
  climbers: { userId: string; floors: number; points: number }[];
  /** Bonus du podium, versé au clan entier. */
  podium: number;
  total: number;
};

/** Ce que rapporte l'événement à chaque clan classé. */
export function clanTowerAwards(standings: readonly ClanTowerStanding[], settings: Pick<ClanTowerSettings, 'pointsPerFloor' | 'podiumPoints'>): ClanTowerAward[] {
  return standings.map((standing) => {
    const climbers = standing.climbers.map((climber) => ({ ...climber, points: climber.floors * settings.pointsPerFloor }));
    const podium = settings.podiumPoints[standing.rank - 1] ?? 0;
    return {
      clanId: standing.clanId,
      rank: standing.rank,
      floors: standing.floors,
      climbers,
      podium,
      total: podium + climbers.reduce((sum, climber) => sum + climber.points, 0),
    };
  });
}
