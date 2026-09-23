/**
 * Catalogue des poissons : espèces livrées de base, bornes de saisie et tirage.
 *
 * Aucun accès base. Les espèces livrées vivent ici et non en base : un serveur les
 * personnalise en déposant une ligne de même nom, exactement comme pour le bestiaire, mais
 * sans catalogue global à tenir à jour par migration.
 */

export const FISH_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;
export type FishRarity = (typeof FISH_RARITIES)[number];

/**
 * Poids de tirage de chaque rareté. Il porte sur la rareté, pas sur l'espèce : ajouter dix
 * poissons communs ne rend pas les légendaires plus rares, il les dilue entre eux.
 */
export const FISH_RARITY_WEIGHTS: Record<FishRarity, number> = {
  COMMON: 60,
  UNCOMMON: 25,
  RARE: 10,
  EPIC: 4,
  LEGENDARY: 1,
};

export const FISH_NAME_MAX = 40;
/** Espèces qu'un serveur peut créer en plus des livrées : au-delà, le carnet ne tient plus dans un message. */
export const FISH_GUILD_CREATED_MAX = 30;
export const FISH_VALUE_RANGE = { min: 0, max: 100_000 } as const;
export const FISH_XP_RANGE = { min: 0, max: 10_000 } as const;

export type FishSpeciesData = {
  name: string;
  emoji: string;
  rarity: FishRarity;
  value: number;
  xp: number;
};

export const DEFAULT_FISH: FishSpeciesData[] = [
  { name: 'Sardine', emoji: '🐟', rarity: 'COMMON', value: 5, xp: 5 },
  { name: 'Truite', emoji: '🐟', rarity: 'COMMON', value: 8, xp: 5 },
  { name: 'Maquereau', emoji: '🐟', rarity: 'COMMON', value: 6, xp: 5 },
  { name: 'Perche', emoji: '🐟', rarity: 'COMMON', value: 7, xp: 5 },
  { name: 'Saumon', emoji: '🐠', rarity: 'UNCOMMON', value: 15, xp: 8 },
  { name: 'Thon', emoji: '🐠', rarity: 'UNCOMMON', value: 20, xp: 8 },
  { name: 'Espadon', emoji: '🐠', rarity: 'UNCOMMON', value: 18, xp: 10 },
  { name: 'Poisson-Lune', emoji: '🌙', rarity: 'RARE', value: 40, xp: 15 },
  { name: 'Barracuda', emoji: '🦈', rarity: 'RARE', value: 50, xp: 15 },
  { name: 'Coelacanthe', emoji: '🐡', rarity: 'EPIC', value: 100, xp: 25 },
  { name: 'Poisson d\'Or', emoji: '✨', rarity: 'EPIC', value: 120, xp: 30 },
  { name: 'Léviathan Miniature', emoji: '🐋', rarity: 'LEGENDARY', value: 300, xp: 60 },
  { name: 'Kraken Bébé', emoji: '🦑', rarity: 'LEGENDARY', value: 500, xp: 80 },
];

const DEFAULT_NAMES = new Set(DEFAULT_FISH.map((fish) => fish.name));

export function isDefaultFishName(name: string): boolean {
  return DEFAULT_NAMES.has(name);
}

export function isFishRarity(value: unknown): value is FishRarity {
  return typeof value === 'string' && (FISH_RARITIES as readonly string[]).includes(value);
}

export type GuildFishRow = FishSpeciesData & { id: string; enabled: boolean };

export type ResolvedFish = FishSpeciesData & {
  /** Identifiant de la ligne du serveur, `null` pour une espèce livrée jamais touchée. */
  id: string | null;
  enabled: boolean;
  /** `DEFAULT` : espèce livrée telle quelle. `GUILD` : ligne du serveur, copie ou création. */
  scope: 'DEFAULT' | 'GUILD';
  /** Vrai pour une ligne du serveur qui remplace une espèce livrée du même nom. */
  overridesDefault: boolean;
};

/**
 * Catalogue effectif d'un serveur : les espèces livrées, remplacées par nom par celles du
 * serveur, puis les créations du serveur. Rangé par rareté, puis dans l'ordre de saisie.
 */
export function resolveFishCatalog(rows: GuildFishRow[]): ResolvedFish[] {
  const byName = new Map(rows.map((row) => [row.name, row]));

  const defaults = DEFAULT_FISH.map((fish): ResolvedFish => {
    const override = byName.get(fish.name);
    return override
      ? { ...override, scope: 'GUILD', overridesDefault: true }
      : { ...fish, id: null, enabled: true, scope: 'DEFAULT', overridesDefault: false };
  });
  const created = rows
    .filter((row) => !DEFAULT_NAMES.has(row.name))
    .map((row): ResolvedFish => ({ ...row, scope: 'GUILD', overridesDefault: false }));

  const rank = (rarity: string) => FISH_RARITIES.indexOf(rarity as FishRarity);
  return [...defaults, ...created]
    .map((fish, order) => ({ fish, order }))
    .sort((a, b) => rank(a.fish.rarity) - rank(b.fish.rarity) || a.order - b.order)
    .map(({ fish }) => fish);
}

/**
 * Tire une prise parmi les espèces actives. Une rareté sans espèce active sort du tirage,
 * et son poids se répartit sur les autres. `null` si le serveur a tout désactivé.
 */
export function rollFishSpecies<T extends { rarity: string; enabled: boolean }>(
  catalog: T[],
  random: () => number = Math.random,
): T | null {
  const tiers = FISH_RARITIES
    .map((rarity) => ({ weight: FISH_RARITY_WEIGHTS[rarity], fish: catalog.filter((fish) => fish.enabled && fish.rarity === rarity) }))
    .filter((tier) => tier.fish.length > 0);
  if (tiers.length === 0) return null;

  const total = tiers.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = random() * total;
  for (const tier of tiers) {
    roll -= tier.weight;
    if (roll < 0) return tier.fish[Math.floor(random() * tier.fish.length)] ?? tier.fish[0];
  }
  const last = tiers[tiers.length - 1];
  return last.fish[last.fish.length - 1];
}

export interface FishInput {
  name?: unknown;
  emoji?: unknown;
  rarity?: unknown;
  value?: unknown;
  xp?: unknown;
  enabled?: unknown;
}

export type NormalizedFish = FishSpeciesData & { enabled: boolean };

export type FishNormalizeResult = { ok: true; value: NormalizedFish } | { ok: false; error: string };

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(parsed)));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeFishInput(input: FishInput): FishNormalizeResult {
  const name = text(input.name);
  if (!name) return { ok: false, error: 'Le nom du poisson est obligatoire.' };
  if (name.length > FISH_NAME_MAX) {
    return { ok: false, error: `Le nom du poisson ne peut pas dépasser ${FISH_NAME_MAX} caractères.` };
  }
  const rarity = input.rarity === undefined ? 'COMMON' : input.rarity;
  if (!isFishRarity(rarity)) {
    return { ok: false, error: `Rareté inconnue. Valeurs possibles : ${FISH_RARITIES.join(', ')}.` };
  }

  return {
    ok: true,
    value: {
      name,
      emoji: text(input.emoji) || '🐟',
      rarity,
      value: clampInt(input.value, FISH_VALUE_RANGE, 5),
      xp: clampInt(input.xp, FISH_XP_RANGE, 5),
      enabled: input.enabled !== false,
    },
  };
}
