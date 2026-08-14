/**
 * Échelle de paliers compétitifs (RP).
 *
 * Le RP est une mesure *saisonnière et réversible*, contrairement à l'XP de
 * `leveling/curve.ts` qui ne fait que croître. C'est ce qui autorise le decay :
 * un palier perdu se regagne, alors qu'un niveau perdu retirerait des rôles de
 * récompense déjà annoncés.
 *
 * Une échelle est une simple liste de seuils triée par RP croissant. Les
 * divisions montent (I < II < III) et le dernier palier n'a pas de suivant :
 * au-delà, on ne classe plus que par RP brut.
 */

export type RankedLadderEntry = {
  /** Identifiant stable stocké en base (`RankedMember.tierKey`). */
  key: string;
  /** Famille de palier, partagée par ses divisions (BRONZE, GOLD, ...). */
  tier: string;
  /** 0 pour un palier sans division (l'apex). */
  division: number;
  name: string;
  minRp: number;
  /** Couleur hex utilisée par la carte de rang et le dashboard. */
  color: string;
};

export type RankedLadder = RankedLadderEntry[];

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

function entry(tier: string, division: number, minRp: number, color: string): RankedLadderEntry {
  const suffix = division > 0 ? ` ${ROMAN[division] ?? String(division)}` : '';
  const label = tier.charAt(0) + tier.slice(1).toLowerCase();
  return {
    key: division > 0 ? `${tier}_${division}` : tier,
    tier,
    division,
    name: `${label}${suffix}`,
    minRp,
    color,
  };
}

const BRONZE = '#c07c42';
const SILVER = '#9aa5b1';
const GOLD = '#e0b341';
const PLATINUM = '#57c9d5';
const EMERALD = '#22c55e';
const DIAMOND = '#8b7cf6';
const MASTER = '#ec4899';

/**
 * Échelle par défaut : 6 familles de 3 divisions, puis un apex sans division.
 *
 * Les écarts s'élargissent à mesure qu'on monte pour que le haut de l'échelle
 * reste un objectif après plusieurs saisons, sans rendre les premiers paliers
 * inatteignables pour un membre qui écrit quelques messages par jour.
 */
export const DEFAULT_RANKED_LADDER: RankedLadder = [
  entry('BRONZE', 1, 0, BRONZE),
  entry('BRONZE', 2, 250, BRONZE),
  entry('BRONZE', 3, 500, BRONZE),
  entry('SILVER', 1, 800, SILVER),
  entry('SILVER', 2, 1150, SILVER),
  entry('SILVER', 3, 1550, SILVER),
  entry('GOLD', 1, 2000, GOLD),
  entry('GOLD', 2, 2500, GOLD),
  entry('GOLD', 3, 3050, GOLD),
  entry('PLATINUM', 1, 3650, PLATINUM),
  entry('PLATINUM', 2, 4300, PLATINUM),
  entry('PLATINUM', 3, 5000, PLATINUM),
  entry('EMERALD', 1, 5800, EMERALD),
  entry('EMERALD', 2, 6700, EMERALD),
  entry('EMERALD', 3, 7700, EMERALD),
  entry('DIAMOND', 1, 8800, DIAMOND),
  entry('DIAMOND', 2, 10000, DIAMOND),
  entry('DIAMOND', 3, 11300, DIAMOND),
  entry('MASTER', 0, 13000, MASTER),
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function sanitizeKey(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 32);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Ramène une échelle quelconque (colonne JSON, corps de requête) à une échelle
 * sûre à parcourir : triée, sans doublon de seuil ni de clé, démarrant à 0.
 *
 * Deux paliers au même RP rendraient l'attribution non déterministe (le membre
 * changerait de palier au gré de l'ordre de lecture), et une échelle qui ne
 * commence pas à 0 laisserait un membre neuf sans palier du tout.
 */
export function normalizeRankedLadder(raw: unknown): RankedLadder {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_RANKED_LADDER;

  const seenKeys = new Set<string>();
  const seenRp = new Set<number>();
  const normalized: RankedLadder = [];

  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;

    const minRp = Math.max(0, Math.floor(Number(source.minRp)));
    if (!Number.isFinite(minRp) || seenRp.has(minRp)) continue;

    const tier = sanitizeKey(source.tier, `TIER_${index + 1}`);
    const division = Math.min(5, Math.max(0, Math.floor(Number(source.division) || 0)));
    const key = sanitizeKey(source.key, division > 0 ? `${tier}_${division}` : tier);
    if (seenKeys.has(key)) continue;

    const name = typeof source.name === 'string' && source.name.trim().length > 0
      ? source.name.trim().slice(0, 48)
      : `${tier}${division > 0 ? ` ${ROMAN[division] ?? division}` : ''}`;
    const color = typeof source.color === 'string' && HEX_COLOR.test(source.color.trim())
      ? source.color.trim()
      : '#9aa5b1';

    seenKeys.add(key);
    seenRp.add(minRp);
    normalized.push({ key, tier, division, name, minRp, color });
  }

  if (normalized.length === 0) return DEFAULT_RANKED_LADDER;

  normalized.sort((a, b) => a.minRp - b.minRp);
  // Le premier palier est ramené à 0 plutôt que rejeté : une échelle éditée à
  // la main ne doit pas laisser un membre à 0 RP sans palier attribuable.
  normalized[0] = { ...normalized[0], minRp: 0 };
  return normalized;
}

/** Index du palier occupé à `rp`. Toujours valide : l'échelle démarre à 0. */
export function rankedTierIndex(rp: number, ladder: RankedLadder = DEFAULT_RANKED_LADDER): number {
  const value = Number.isFinite(rp) ? rp : 0;
  let index = 0;
  for (let i = 0; i < ladder.length; i++) {
    if (value >= ladder[i].minRp) index = i;
    else break;
  }
  return index;
}

export function resolveRankedTier(rp: number, ladder: RankedLadder = DEFAULT_RANKED_LADDER): RankedLadderEntry {
  return ladder[rankedTierIndex(rp, ladder)];
}

/** Palier d'une clé, ou `null` si l'échelle a changé depuis son stockage. */
export function rankedTierByKey(key: string | null | undefined, ladder: RankedLadder = DEFAULT_RANKED_LADDER): RankedLadderEntry | null {
  if (!key) return null;
  return ladder.find((tier) => tier.key === key) ?? null;
}

export type RankedProgress = {
  current: RankedLadderEntry;
  /** Palier précédent de l'échelle, `null` au tout premier. */
  below: RankedLadderEntry | null;
  /** Palier suivant, `null` à l'apex. */
  next: RankedLadderEntry | null;
  /** RP accumulés à l'intérieur du palier courant. */
  rpIntoTier: number;
  /** RP séparant le seuil courant du suivant. 0 à l'apex. */
  rpForNext: number;
  /** RP restant à gagner pour la promotion. 0 à l'apex. */
  rpRemaining: number;
  /** Avancement dans le palier, 0..100. Vaut 100 à l'apex. */
  percent: number;
};

/**
 * Tout ce qu'il faut pour dessiner la barre de progression : palier courant,
 * ses voisins, et l'avancement vers la promotion.
 */
export function rankedProgress(rp: number, ladder: RankedLadder = DEFAULT_RANKED_LADDER): RankedProgress {
  const value = Math.max(0, Number.isFinite(rp) ? Math.floor(rp) : 0);
  const index = rankedTierIndex(value, ladder);
  const current = ladder[index];
  const below = index > 0 ? ladder[index - 1] : null;
  const next = index < ladder.length - 1 ? ladder[index + 1] : null;

  const rpIntoTier = value - current.minRp;
  const rpForNext = next ? next.minRp - current.minRp : 0;
  const rpRemaining = next ? Math.max(0, next.minRp - value) : 0;
  const percent = next && rpForNext > 0
    ? Math.min(100, Math.max(0, Math.round((rpIntoTier / rpForNext) * 100)))
    : 100;

  return { current, below, next, rpIntoTier, rpForNext, rpRemaining, percent };
}

/**
 * RP plancher d'un palier protégé du decay. `null` (palier inconnu) vaut pas de
 * protection : mieux vaut un decay appliqué qu'un membre gelé par une clé
 * devenue orpheline après une refonte de l'échelle.
 */
export function rankedFloorRp(floorTierKey: string | null | undefined, ladder: RankedLadder = DEFAULT_RANKED_LADDER): number {
  return rankedTierByKey(floorTierKey, ladder)?.minRp ?? 0;
}

/**
 * Compare deux paliers par leur position dans l'échelle.
 * > 0 = promotion, < 0 = rétrogradation, 0 = palier inchangé.
 */
export function compareRankedTiers(
  fromKey: string | null | undefined,
  toKey: string | null | undefined,
  ladder: RankedLadder = DEFAULT_RANKED_LADDER,
): number {
  const from = ladder.findIndex((tier) => tier.key === fromKey);
  const to = ladder.findIndex((tier) => tier.key === toKey);
  if (from < 0 || to < 0) return 0;
  return to - from;
}
