/**
 * Village de guilde : catalogue statique des bâtiments.
 *
 * La guilde RPG n'offrait qu'un trésor et un niveau, sans rien à en faire : déposer des
 * pièces ne changeait rien au jeu. Chaque bâtiment transforme ce trésor en un avantage
 * concret, partagé par TOUS les membres — c'est ce qui donne une raison de cotiser.
 *
 * RÈGLE : un bâtiment améliore quelque chose qui existe déjà dans le jeu et que le joueur
 * peut constater (prix de la boutique, réussite à la forge, statistiques de combat). Un
 * bâtiment purement décoratif ne vaut pas son coût en trésor.
 *
 * Cohérence vérifiée par `rpgGuildBuildings.test.ts` :
 *  - les identifiants sont uniques ;
 *  - chaque bâtiment a au moins un palier, et chacun un effet non vide ;
 *  - coûts et niveaux de guilde requis sont croissants d'un palier au suivant ;
 *  - aucun palier n'accorde à lui seul plus que le plafond de son avantage.
 */

/** Avantages accordés par un palier de bâtiment, cumulés sur tout le village. */
export type GuildPerks = {
  /** Remise sur les prix de la boutique, de 0 à 1. */
  shopDiscount: number;
  /** Chance de réussite ajoutée à la forge, de 0 à 1. */
  forgeSuccess: number;
  /** Part d'XP de combat en plus, de 0 à 1. */
  xpBonus: number;
  /** Part de pièces de combat en plus, de 0 à 1. */
  coinBonus: number;
  /** Attaque, défense et PV maximum offerts à chaque membre. */
  attackFlat: number;
  defenseFlat: number;
  maxHealthFlat: number;
};

export const NO_GUILD_PERKS: GuildPerks = {
  shopDiscount: 0,
  forgeSuccess: 0,
  xpBonus: 0,
  coinBonus: 0,
  attackFlat: 0,
  defenseFlat: 0,
  maxHealthFlat: 0,
};

/** Plafonds du village, pour qu'une guilde ancienne ne rende pas le jeu trivial. */
export const GUILD_PERK_CAPS = {
  shopDiscount: 0.3,
  forgeSuccess: 0.15,
  xpBonus: 0.5,
  coinBonus: 0.5,
} as const;

export type BuildingTier = {
  /** Niveau de guilde requis pour bâtir ce palier. */
  guildLevel: number;
  /** Coût en pièces, prélevé sur le trésor de la guilde. */
  cost: number;
  /** Ce que ce palier ajoute au village. Les paliers ne se cumulent PAS entre eux. */
  perks: Partial<GuildPerks>;
  /** Description de l'effet, telle qu'affichée. */
  effect: string;
};

export type GuildBuilding = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  /** Paliers, du premier au dernier. `tiers.length` fait foi pour le niveau maximum. */
  tiers: BuildingTier[];
};

export const RPG_GUILD_BUILDINGS: GuildBuilding[] = [
  {
    id: 'market',
    name: 'Échoppe',
    emoji: '🏪',
    description: "Un comptoir tenu par la guilde. Les marchands du coin font un prix aux membres.",
    tiers: [
      { guildLevel: 1, cost: 2_000, perks: { shopDiscount: 0.05 }, effect: '−5 % sur la boutique' },
      { guildLevel: 3, cost: 6_000, perks: { shopDiscount: 0.10 }, effect: '−10 % sur la boutique' },
      { guildLevel: 6, cost: 15_000, perks: { shopDiscount: 0.18 }, effect: '−18 % sur la boutique' },
    ],
  },
  {
    id: 'forge',
    name: 'Forge de guilde',
    emoji: '⚒️',
    description: "Un forgeron à demeure, qui rate nettement moins souvent que celui du village.",
    tiers: [
      { guildLevel: 2, cost: 3_000, perks: { forgeSuccess: 0.03 }, effect: '+3 % de réussite à la forge' },
      { guildLevel: 4, cost: 9_000, perks: { forgeSuccess: 0.07 }, effect: '+7 % de réussite à la forge' },
      { guildLevel: 7, cost: 20_000, perks: { forgeSuccess: 0.12 }, effect: '+12 % de réussite à la forge' },
    ],
  },
  {
    id: 'tavern',
    name: 'Taverne',
    emoji: '🍺',
    description: "On y refait le monde, et on y apprend surtout beaucoup des récits des autres.",
    tiers: [
      { guildLevel: 1, cost: 1_500, perks: { xpBonus: 0.05 }, effect: '+5 % d’XP de combat' },
      { guildLevel: 3, cost: 5_000, perks: { xpBonus: 0.12 }, effect: '+12 % d’XP de combat' },
      { guildLevel: 6, cost: 14_000, perks: { xpBonus: 0.22 }, effect: '+22 % d’XP de combat' },
    ],
  },
  {
    id: 'barracks',
    name: 'Caserne',
    emoji: '🏰',
    description: "On s’y entraîne tous les matins. Ça finit par se voir au combat.",
    tiers: [
      { guildLevel: 2, cost: 4_000, perks: { attackFlat: 3, defenseFlat: 3 }, effect: '+3 ATQ et +3 DÉF' },
      { guildLevel: 5, cost: 11_000, perks: { attackFlat: 7, defenseFlat: 7, maxHealthFlat: 30 }, effect: '+7 ATQ, +7 DÉF, +30 PV' },
      { guildLevel: 8, cost: 25_000, perks: { attackFlat: 14, defenseFlat: 14, maxHealthFlat: 80 }, effect: '+14 ATQ, +14 DÉF, +80 PV' },
    ],
  },
  {
    id: 'vault',
    name: 'Chambre forte',
    emoji: '🏦',
    description: "Le butin y est compté, pesé, et réparti sans qu’il en manque jamais.",
    tiers: [
      { guildLevel: 2, cost: 3_500, perks: { coinBonus: 0.06 }, effect: '+6 % de pièces de combat' },
      { guildLevel: 4, cost: 10_000, perks: { coinBonus: 0.14 }, effect: '+14 % de pièces de combat' },
      { guildLevel: 7, cost: 22_000, perks: { coinBonus: 0.25 }, effect: '+25 % de pièces de combat' },
    ],
  },
];

/**
 * Prix d'un article une fois la remise du village appliquée.
 *
 * Le plancher à 1 pièce évite qu'une remise maximale ne rende gratuits les objets les
 * moins chers : une boutique qui donne n'est plus une boutique.
 */
export function discountedPrice(price: number, discount: number): number {
  if (discount <= 0) return price;
  return Math.max(1, Math.round(price * (1 - Math.min(discount, GUILD_PERK_CAPS.shopDiscount))));
}

const BUILDING_BY_ID = new Map(RPG_GUILD_BUILDINGS.map((building) => [building.id, building]));

export function getGuildBuilding(buildingId: string): GuildBuilding | null {
  return BUILDING_BY_ID.get(buildingId) ?? null;
}

export function maxBuildingLevel(building: GuildBuilding): number {
  return building.tiers.length;
}

/**
 * Palier suivant d'un bâtiment, `null` quand il est déjà au maximum.
 * `currentLevel` vaut 0 quand rien n'est bâti.
 */
export function nextTier(building: GuildBuilding, currentLevel: number): BuildingTier | null {
  return building.tiers[currentLevel] ?? null;
}

/** Palier atteint, `null` quand rien n'est bâti. */
export function currentTier(building: GuildBuilding, currentLevel: number): BuildingTier | null {
  return currentLevel > 0 ? building.tiers[Math.min(currentLevel, building.tiers.length) - 1] ?? null : null;
}

/**
 * Avantages du village entier.
 *
 * Les paliers d'un même bâtiment ne se cumulent PAS : le palier 3 REMPLACE le palier 2.
 * Sans cette règle, le coût d'un palier supérieur serait payé pour un gain marginal alors
 * que sa valeur affichée serait déjà acquise.
 */
export function aggregateGuildPerks(built: { buildingId: string; level: number }[]): GuildPerks {
  const total: GuildPerks = { ...NO_GUILD_PERKS };

  for (const entry of built) {
    const building = BUILDING_BY_ID.get(entry.buildingId);
    if (!building) continue;

    const tier = currentTier(building, entry.level);
    if (!tier) continue;

    for (const [key, value] of Object.entries(tier.perks) as [keyof GuildPerks, number][]) {
      total[key] += value;
    }
  }

  return {
    ...total,
    shopDiscount: Math.min(GUILD_PERK_CAPS.shopDiscount, total.shopDiscount),
    forgeSuccess: Math.min(GUILD_PERK_CAPS.forgeSuccess, total.forgeSuccess),
    xpBonus: Math.min(GUILD_PERK_CAPS.xpBonus, total.xpBonus),
    coinBonus: Math.min(GUILD_PERK_CAPS.coinBonus, total.coinBonus),
  };
}
