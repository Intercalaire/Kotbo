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
 * ATTENTION : quatre listes divergentes coexistaient au moment d'ecrire ceci,
 * et aucune n'etait verifiee a l'execution - la route se contente de tester
 * que le champ est rempli, puis ecrit la chaine telle quelle.
 *
 *   rpgContent.ts   WEAPON ARMOR ACCESSORY POTION MATERIAL SCROLL
 *   route POST      WEAPON ARMOR           POTION          QUEST
 *   schema Prisma   WEAPON ARMOR ACCESSORY POTION MATERIAL QUEST
 *   outil MCP       WEAPON ARMOR           POTION MATERIAL QUEST + USABLE
 *
 * Cette union est celle de ce qui est reellement produit par le code, pour ne
 * rien casser. Elle n'est pas une decision : c'est au proprietaire du module
 * de dire laquelle fait foi, et d'aligner les trois autres.
 */
export type RpgItemType =
  | 'WEAPON'
  | 'ARMOR'
  | 'ACCESSORY'
  | 'POTION'
  | 'MATERIAL'
  | 'SCROLL'
  | 'QUEST';

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
};

/** Paliers de rarete d'un objet. */
export type RpgItemRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
