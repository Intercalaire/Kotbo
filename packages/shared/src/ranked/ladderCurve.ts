/**
 * Générateur d'échelle de paliers (RP).
 *
 * `ladder.ts` sait lire une échelle ; celui-ci sait en fabriquer une à partir de
 * trois réglages plutôt que de vingt seuils saisis à la main. C'est le pendant
 * de `leveling/curve.ts` : le dashboard pose une courbe, le bot en déduit les
 * paliers, et l'échelle reste la seule source de vérité une fois générée.
 *
 * Le nombre de paliers est un réglage à part entière : c'est aussi le nombre de
 * rôles Discord que la guilde devra tenir, donc le premier chiffre qu'un
 * administrateur veut pouvoir choisir.
 */

import type { RankedLadder, RankedLadderEntry } from './ladder.js';

export type LadderCurve = {
  /** Nombre total de paliers, donc de rôles à créer. */
  tierCount: number;
  /** RP du deuxième palier : l'écart de départ, avant élargissement. */
  baseRp: number;
  /** Élargissement des écarts à mesure qu'on monte. 1 = écarts constants. */
  exponent: number;
  /** Divisions par famille (Bronze I, II, III). 1 = un palier par famille. */
  divisions: number;
};

/**
 * Reprend la forme de `DEFAULT_RANKED_LADDER` : 6 familles de 3 divisions plus
 * un apex. Les seuils générés ne sont pas identiques à ceux codés en dur - une
 * guilde qui n'a jamais touché à son échelle garde la sienne, la courbe ne
 * s'applique qu'une fois choisie.
 */
export const DEFAULT_LADDER_CURVE: LadderCurve = {
  tierCount: 19,
  baseRp: 250,
  exponent: 1.35,
  divisions: 3,
};

export const LADDER_CURVE_LIMITS = {
  tierCount: { min: 2, max: 30 },
  baseRp: { min: 10, max: 5_000 },
  exponent: { min: 1, max: 2.5 },
  divisions: { min: 1, max: 5 },
} as const;

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/**
 * Familles de paliers, dans l'ordre de progression. La liste couvre le nombre
 * maximum de paliers sans division ; au-delà, `familyAt` fabrique une famille
 * numérotée plutôt que de reboucler sur Bronze.
 */
export const LADDER_FAMILIES: ReadonlyArray<{ tier: string; label: string; color: string }> = [
  { tier: 'BRONZE', label: 'Bronze', color: '#c07c42' },
  { tier: 'SILVER', label: 'Silver', color: '#9aa5b1' },
  { tier: 'GOLD', label: 'Gold', color: '#e0b341' },
  { tier: 'PLATINUM', label: 'Platinum', color: '#57c9d5' },
  { tier: 'EMERALD', label: 'Emerald', color: '#22c55e' },
  { tier: 'DIAMOND', label: 'Diamond', color: '#8b7cf6' },
  { tier: 'MASTER', label: 'Master', color: '#ec4899' },
  { tier: 'GRANDMASTER', label: 'Grandmaster', color: '#f97316' },
  { tier: 'CHAMPION', label: 'Champion', color: '#ef4444' },
  { tier: 'LEGEND', label: 'Legend', color: '#facc15' },
  { tier: 'MYTHIC', label: 'Mythic', color: '#a855f7' },
  { tier: 'ETERNAL', label: 'Eternal', color: '#14b8a6' },
  { tier: 'RADIANT', label: 'Radiant', color: '#f43f5e' },
  { tier: 'CELESTIAL', label: 'Celestial', color: '#38bdf8' },
  { tier: 'ASCENDANT', label: 'Ascendant', color: '#84cc16' },
  { tier: 'IMMORTAL', label: 'Immortal', color: '#fb7185' },
  { tier: 'TITAN', label: 'Titan', color: '#0ea5e9' },
  { tier: 'ORACLE', label: 'Oracle', color: '#c084fc' },
  { tier: 'PHOENIX', label: 'Phoenix', color: '#fb923c' },
  { tier: 'NOVA', label: 'Nova', color: '#2dd4bf' },
];

function familyAt(index: number): { tier: string; label: string; color: string } {
  const known = LADDER_FAMILIES[index];
  if (known) return known;
  // Au-delà de la liste, une famille numérotée : elle reste triable et lisible,
  // là où un second « Bronze » rendrait deux paliers indiscernables.
  const rank = index + 1;
  return {
    tier: `PRESTIGE_${rank}`,
    label: `Prestige ${rank}`,
    color: LADDER_FAMILIES[index % LADDER_FAMILIES.length].color,
  };
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/** Ramène une courbe quelconque (corps de requête, colonnes) à des réglages sûrs. */
export function normalizeLadderCurve(raw: unknown): LadderCurve {
  const candidate = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    tierCount: Math.round(clamp(candidate.tierCount, DEFAULT_LADDER_CURVE.tierCount, LADDER_CURVE_LIMITS.tierCount.min, LADDER_CURVE_LIMITS.tierCount.max)),
    baseRp: Math.round(clamp(candidate.baseRp, DEFAULT_LADDER_CURVE.baseRp, LADDER_CURVE_LIMITS.baseRp.min, LADDER_CURVE_LIMITS.baseRp.max)),
    exponent: clamp(candidate.exponent, DEFAULT_LADDER_CURVE.exponent, LADDER_CURVE_LIMITS.exponent.min, LADDER_CURVE_LIMITS.exponent.max),
    divisions: Math.round(clamp(candidate.divisions, DEFAULT_LADDER_CURVE.divisions, LADDER_CURVE_LIMITS.divisions.min, LADDER_CURVE_LIMITS.divisions.max)),
  };
}

/** Arrondi lisible : personne ne retient « 1 137 RP » comme seuil de palier. */
function roundThreshold(value: number): number {
  const step = value >= 10_000 ? 250 : value >= 1_000 ? 50 : 10;
  return Math.round(value / step) * step;
}

/**
 * Fabrique l'échelle décrite par la courbe.
 *
 * Le dernier palier est l'apex : sans division, comme le Master de l'échelle
 * historique, pour que le sommet se distingue des paliers qu'on traverse. Les
 * seuils sont strictement croissants même quand l'arrondi voudrait les coller.
 */
export function generateRankedLadder(raw: unknown): RankedLadder {
  const curve = normalizeLadderCurve(raw);
  const hasApex = curve.divisions > 1 && curve.tierCount >= 2;
  const graded = hasApex ? curve.tierCount - 1 : curve.tierCount;

  const ladder: RankedLadderEntry[] = [];
  let previous = -1;

  for (let index = 0; index < curve.tierCount; index++) {
    const apex = hasApex && index === graded;
    const familyIndex = apex ? Math.ceil(graded / curve.divisions) : Math.floor(index / curve.divisions);
    const division = apex ? 0 : (index % curve.divisions) + 1;
    const family = familyAt(familyIndex);

    const threshold = index === 0 ? 0 : roundThreshold(curve.baseRp * Math.pow(index, curve.exponent));
    const minRp = Math.max(threshold, previous + 1);
    previous = minRp;

    const suffix = division > 0 && curve.divisions > 1 ? ` ${ROMAN[division] ?? String(division)}` : '';
    ladder.push({
      key: division > 0 && curve.divisions > 1 ? `${family.tier}_${division}` : family.tier,
      tier: family.tier,
      division: curve.divisions > 1 ? division : 0,
      name: `${family.label}${suffix}`,
      minRp,
      color: family.color,
    });
  }

  return ladder;
}

/**
 * L'échelle enregistrée est-elle exactement celle que produirait cette courbe ?
 *
 * Sert à savoir si les curseurs peuvent l'afficher sans la déformer : une
 * échelle retouchée à la main ne tombe sur aucune courbe, et le dashboard le dit
 * plutôt que de faire croire que ses curseurs la décrivent.
 */
export function ladderMatchesCurve(ladder: RankedLadder, curve: LadderCurve): boolean {
  const generated = generateRankedLadder(curve);
  if (generated.length !== ladder.length) return false;
  return generated.every((tier, index) =>
    tier.key === ladder[index].key && tier.minRp === ladder[index].minRp);
}

/**
 * RP à accumuler pour atteindre le sommet de l'échelle : le seul chiffre qui
 * résume une courbe en un coup d'œil, et qui permet de comparer deux
 * préréglages entre eux.
 */
export function ladderApexRp(ladder: RankedLadder): number {
  return ladder.length > 0 ? ladder[ladder.length - 1].minRp : 0;
}
