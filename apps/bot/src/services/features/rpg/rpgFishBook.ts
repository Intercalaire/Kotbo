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
