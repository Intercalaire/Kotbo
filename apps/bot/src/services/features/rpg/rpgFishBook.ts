/** Carnet de pêche : le catalogue des espèces croisé avec les prises d'un joueur. */

export type FishSpecies = { name: string; emoji: string; rarity: string };

export type FishBookEntry = FishSpecies & { caught: number };

export type FishBook = {
  entries: FishBookEntry[];
  discovered: number;
  total: number;
  totalCaught: number;
};

/**
 * Les prises d'une espèce retirée du catalogue comptent dans le total mais n'ont pas de
 * ligne : le carnet montre ce qu'on peut encore pêcher, pas l'historique des versions.
 */
export function buildFishBook(catalog: FishSpecies[], catches: Map<string, number>): FishBook {
  const entries = catalog.map((species) => ({ ...species, caught: catches.get(species.name) ?? 0 }));
  return {
    entries,
    discovered: entries.filter((entry) => entry.caught > 0).length,
    total: entries.length,
    totalCaught: [...catches.values()].reduce((sum, count) => sum + count, 0),
  };
}

export const FISH_BOOK_TIERS = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'COMPLETE'] as const;
export type FishBookTier = (typeof FISH_BOOK_TIERS)[number];

export function isFishBookTier(value: unknown): value is FishBookTier {
  return typeof value === 'string' && (FISH_BOOK_TIERS as readonly string[]).includes(value);
}

/** Alias de type et non interface : Prisma refuse une interface en argument `data`. */
export type FishBookReward = {
  coinReward: number;
  xpReward: number;
  /** Points de clan, ou XP de guilde selon les équipes du serveur. */
  clanPoints: number;
  itemName: string | null;
  roleId: string | null;
  titleId: string | null;
};

/**
 * Récompenses versées quand le serveur n'a rien réglé. Elles montent avec la rareté : la
 * série légendaire ne compte que deux espèces, mais au poids de 1 %, la compléter prend
 * des centaines de lancers.
 */
export const DEFAULT_FISH_BOOK_REWARDS: Record<FishBookTier, FishBookReward> = {
  COMMON: { coinReward: 100, xpReward: 50, clanPoints: 0, itemName: null, roleId: null, titleId: null },
  UNCOMMON: { coinReward: 250, xpReward: 100, clanPoints: 0, itemName: null, roleId: null, titleId: null },
  RARE: { coinReward: 500, xpReward: 200, clanPoints: 0, itemName: null, roleId: null, titleId: null },
  EPIC: { coinReward: 1_000, xpReward: 400, clanPoints: 0, itemName: null, roleId: null, titleId: null },
  LEGENDARY: { coinReward: 2_500, xpReward: 800, clanPoints: 0, itemName: null, roleId: null, titleId: null },
  COMPLETE: { coinReward: 5_000, xpReward: 1_500, clanPoints: 0, itemName: null, roleId: null, titleId: null },
};

export const FISH_BOOK_REWARD_RANGE = { min: 0, max: 1_000_000 } as const;
/** Même plafond que les primes de clan du bestiaire. */
export const FISH_BOOK_CLAN_POINTS_MAX = 100_000;

export type FishBookTierProgress = { tier: FishBookTier; caught: number; total: number; complete: boolean };

/**
 * Avancement de chaque palier. Une rareté sans aucune espèce active n'a pas de palier : le
 * serveur qui l'a vidée ne doit pas offrir une récompense gagnée sans lancer.
 */
export function fishBookProgress(book: FishBook): FishBookTierProgress[] {
  const tiers: FishBookTierProgress[] = [];
  for (const tier of FISH_BOOK_TIERS) {
    const entries = tier === 'COMPLETE' ? book.entries : book.entries.filter((entry) => entry.rarity === tier);
    if (entries.length === 0) continue;
    const caught = entries.filter((entry) => entry.caught > 0).length;
    tiers.push({ tier, caught, total: entries.length, complete: caught === entries.length });
  }
  return tiers;
}

export function hasFishBookReward(reward: FishBookReward): boolean {
  return reward.coinReward > 0 || reward.xpReward > 0 || reward.clanPoints > 0 || Boolean(reward.itemName) || Boolean(reward.roleId) || Boolean(reward.titleId);
}

export interface FishBookRewardInput {
  coinReward?: unknown;
  xpReward?: unknown;
  clanPoints?: unknown;
  itemName?: unknown;
  roleId?: unknown;
  titleId?: unknown;
}

function clampReward(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(FISH_BOOK_REWARD_RANGE.max, Math.max(FISH_BOOK_REWARD_RANGE.min, Math.trunc(parsed)));
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeFishBookReward(input: FishBookRewardInput): FishBookReward {
  const roleId = optionalText(input.roleId);
  return {
    coinReward: clampReward(input.coinReward),
    xpReward: clampReward(input.xpReward),
    clanPoints: Math.min(FISH_BOOK_CLAN_POINTS_MAX, clampReward(input.clanPoints)),
    itemName: optionalText(input.itemName),
    roleId: roleId && /^\d{17,20}$/.test(roleId) ? roleId : null,
    titleId: optionalText(input.titleId),
  };
}
