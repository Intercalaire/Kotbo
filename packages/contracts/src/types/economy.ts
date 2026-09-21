/**
 * Charges utiles d'ecriture de l'economie, partagees par le bot et le
 * dashboard.
 *
 * Ces formes etaient ecrites deux fois : en litteral dans la route du bot, et
 * nulle part cote dashboard, qui envoyait un `any`. Rien ne garantissait donc
 * que les deux parlent du meme objet, et rien ne l'aurait signale : c'est
 * exactement la derive qui avait fini par empecher le dashboard de compiler
 * sur la configuration des salons, un champ ayant ete ajoute d'un seul cote.
 *
 * Le contrat vit ici, et les deux le lisent.
 */

/**
 * Familles d'objets vendables et utilisables.
 *
 * Cette liste fait foi. Quatre listes divergentes coexistaient auparavant -
 * rpgContent, la route POST, le commentaire du schema Prisma et l'outil MCP -
 * et aucune n'etait verifiee a l'execution : la route se contentait de tester
 * que le champ etait rempli, puis ecrivait la chaine telle quelle. Toute
 * declaration qui parle du type d'un objet lit desormais celle-ci, et
 * `rpgItemTypes.test.ts` echoue si l'une d'elles s'en ecarte.
 *
 * Ce que chaque famille implique :
 *   WEAPON, ARMOR, ACCESSORY  s'equipent, chacune sur son emplacement
 *   POTION                    se consomme, et peut verser des recompenses
 *                             des modules voisins (XP, points de clan, assauts)
 *   MATERIAL                  entre dans les recettes d'artisanat
 *   SCROLL                    pose un enchantement (`enchantId`, `enchantTier`)
 *   QUEST                     n'a aucun effet mecanique : objet narratif,
 *                             cle ou badge, que le serveur met en scene
 *
 * `USABLE`, qui n'existait que dans le schema zod de l'outil MCP, ne
 * correspondait a rien et n'en fait pas partie.
 */
export const RPG_ITEM_TYPES = [
  'WEAPON',
  'ARMOR',
  'ACCESSORY',
  'POTION',
  'MATERIAL',
  'SCROLL',
  'QUEST',
] as const;

export type RpgItemType = (typeof RPG_ITEM_TYPES)[number];

/**
 * Le type est-il connu ?
 *
 * Le garde vit ici plutot que dans chaque appelant : la route, l'outil MCP et
 * le dashboard doivent refuser exactement les memes valeurs.
 */
export function isRpgItemType(value: unknown): value is RpgItemType {
  return typeof value === 'string' && (RPG_ITEM_TYPES as readonly string[]).includes(value);
}

/** Familles qui s'equipent, par opposition a celles qui se consomment. */
export const EQUIPPABLE_RPG_ITEM_TYPES = ['WEAPON', 'ARMOR', 'ACCESSORY'] as const;

/**
 * Objet envoye a POST /economy/items.
 *
 * `id` absent vaut creation. Les bonus omis valent zero cote serveur, qui les
 * borne : les fournir n'est utile que pour les modifier.
 */
export type RpgItemPayload = {
  id?: string;
  name: string;
  description: string;
  emoji?: string;
  type: RpgItemType;
  atkBonus?: number;
  defBonus?: number;
  spdBonus?: number;
  /** PV maximum accordes tant que l'objet est porte. Equipement uniquement. */
  hpBonus?: number;
  hpRestore?: number;
  energyRestore?: number;
  /**
   * Recompenses versees par les modules voisins a la consommation.
   *
   * Reservees aux potions : le serveur les ignore sur les autres familles.
   */
  levelXpReward?: number;
  clanPointsReward?: number;
  raidAssaultBonus?: number;
  price: number;
  purchasable?: boolean;
  blackMarketEligible?: boolean;
  /**
   * Rarete et niveau requis.
   *
   * Omis vaut « ne change pas » : le serveur laisse alors la valeur en place,
   * ou celle par defaut a la creation.
   */
  rarity?: RpgItemRarity;
  levelRequired?: number;
  /**
   * Parchemins uniquement : enchantement pose et palier accorde.
   *
   * `enchantId` designe une entree de RPG_ENCHANTMENTS. Un parchemin qui n'en
   * porte pas n'enchante rien : le selecteur du dashboard proposait justement
   * de creer des SCROLL sans ces deux champs, ce qui donnait des objets
   * silencieusement inertes.
   */
  enchantId?: string | null;
  enchantTier?: number;
};

/**
 * Paliers de rarete d'un objet.
 *
 * La rarete fixe le nombre d'enchantements qu'un equipement peut porter
 * (ENCHANT_SLOTS_BY_RARITY) : une valeur inconnue ecrite en base retombait sur un
 * seul emplacement, et la boutique affichait une rarete que rien ne sait colorer.
 */
export const RPG_ITEM_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;

export type RpgItemRarity = (typeof RPG_ITEM_RARITIES)[number];

export function isRpgItemRarity(value: unknown): value is RpgItemRarity {
  return typeof value === 'string' && (RPG_ITEM_RARITIES as readonly string[]).includes(value);
}
