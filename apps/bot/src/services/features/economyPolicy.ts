type ShopItemAvailability = {
  purchasable: boolean;
  guildId: string | null;
  levelXpReward?: number;
  clanPointsReward?: number;
  blackMarketEligible?: boolean;
};

/**
 * État des modules dont la boutique peut vendre les récompenses.
 *
 * `clanPointsEnabled` reprend la condition du pont RPG → clans : les clans doivent tourner
 * *et* le pont être ouvert, sinon l'achat promettrait des points que rien ne verserait.
 */
export type ShopModuleState = {
  levelingEnabled: boolean;
  clanPointsEnabled: boolean;
};

/** Bornes des récompenses vendues, alignées sur celles des primes du bestiaire. */
export const LEVEL_XP_REWARD_RANGE = { min: 0, max: 1_000_000 } as const;
export const CLAN_POINTS_REWARD_RANGE = { min: 0, max: 100_000 } as const;

/**
 * Un objet dont la récompense dépend d'un module éteint n'est pas vendable.
 *
 * On le retire de la vente plutôt que de le vendre inerte : le joueur paierait pour une
 * récompense qui ne serait jamais versée.
 */
export function isShopItemUnlocked(
  item: Pick<ShopItemAvailability, 'levelXpReward' | 'clanPointsReward'>,
  modules: ShopModuleState,
): boolean {
  if ((item.levelXpReward ?? 0) > 0 && !modules.levelingEnabled) return false;
  if ((item.clanPointsReward ?? 0) > 0 && !modules.clanPointsEnabled) return false;
  return true;
}

export function isShopItemAvailable<T extends ShopItemAvailability>(
  item: T | null,
  guildId: string,
  modules: ShopModuleState,
): item is T {
  if (!item?.purchasable) return false;
  if (item.guildId !== null && item.guildId !== guildId) return false;
  return isShopItemUnlocked(item, modules);
}

/** Un objet porte-t-il une récompense versée par un module voisin ? */
export function hasModuleReward(
  item: Pick<ShopItemAvailability, 'levelXpReward' | 'clanPointsReward'>,
): boolean {
  return (item.levelXpReward ?? 0) > 0 || (item.clanPointsReward ?? 0) > 0;
}

/**
 * Un objet peut-il être tiré au marché noir ?
 *
 * Le tirage brade de 20 à 50 %. L'exclusion se règle par objet via `blackMarketEligible`,
 * dont la valeur est posée à l'enregistrement : fausse par défaut pour ceux qui vendent une
 * récompense de module, leur prix étant justement l'équilibrage.
 */
export function isBlackMarketEligible(
  item: Pick<ShopItemAvailability, 'levelXpReward' | 'clanPointsReward' | 'blackMarketEligible'>,
  modules: ShopModuleState,
): boolean {
  if (item.blackMarketEligible === false) return false;
  return isShopItemUnlocked(item, modules);
}
