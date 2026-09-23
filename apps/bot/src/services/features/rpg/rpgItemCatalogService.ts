/**
 * Catalogue des objets : tout ce qui existe sur le serveur, et où l'obtenir.
 *
 * Contrairement au bestiaire, rien n'est à débloquer : le catalogue sert à savoir quoi
 * chercher, pas à récompenser la découverte. Les provenances sont dérivées des réglages en
 * place (boutique, butins, recettes, primes, campagne) : il n'y a rien à tenir à jour à côté.
 */

import type { RpgItem } from '@prisma/client';
import prisma from '../../../utils/db.js';
import { getOrCreateEconomyConfig, getShopModuleState } from '../economyService.js';
import { isShopItemUnlocked } from '../economyPolicy.js';
import { listGuildMonsters } from './rpgBestiaryService.js';
import { parseMonsterDrops } from './rpgBestiaryPolicy.js';
import { RPG_CAMPAIGN } from './rpgCampaign.js';
import { listFirstKills } from './rpgFirstKillService.js';
import { preferGuildRecipes } from './rpgRecipePolicy.js';

export type ItemCatalogEntry = {
  item: RpgItem;
  shop: boolean;
  /** Créatures ordinaires et boss qui le laissent tomber, par nom. */
  monsters: string[];
  bosses: string[];
  crafted: boolean;
  /** Créatures dont le premier vainqueur le recevra : celles déjà battues n'offrent plus rien. */
  firstKill: string[];
  campaign: boolean;
};

export const ITEM_SOURCE_FILTERS = ['all', 'shop', 'monster', 'boss', 'craft', 'unique', 'unavailable'] as const;

export type ItemSourceFilter = (typeof ITEM_SOURCE_FILTERS)[number];

function hasRegularSource(entry: ItemCatalogEntry): boolean {
  return entry.shop || entry.monsters.length > 0 || entry.bosses.length > 0 || entry.crafted;
}

/**
 * Objet qu'aucune source régulière ne donne, mais qui se gagne une fois : par la prime d'un
 * premier vainqueur ou par la campagne.
 */
export function isUniqueItem(entry: ItemCatalogEntry): boolean {
  return !hasRegularSource(entry) && (entry.firstKill.length > 0 || entry.campaign);
}

/**
 * Objet que rien dans le jeu ne donne : ni boutique, ni butin, ni recette, ni prime, ni
 * campagne. Il n'arrive que par un drop d'animation ou la main d'un administrateur.
 */
export function isUnavailableItem(entry: ItemCatalogEntry): boolean {
  return !hasRegularSource(entry) && entry.firstKill.length === 0 && !entry.campaign;
}

export function matchesSourceFilter(entry: ItemCatalogEntry, filter: ItemSourceFilter): boolean {
  switch (filter) {
    case 'shop': return entry.shop;
    case 'monster': return entry.monsters.length > 0;
    case 'boss': return entry.bosses.length > 0;
    case 'craft': return entry.crafted;
    case 'unique': return isUniqueItem(entry);
    case 'unavailable': return isUnavailableItem(entry);
    default: return true;
  }
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key) ?? [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list);
}

export async function getItemCatalog(guildId: string): Promise<ItemCatalogEntry[]> {
  const [rows, recipes, monsters, config, modules, firstKills] = await Promise.all([
    prisma.rpgItem.findMany({ where: { OR: [{ guildId: null }, { guildId }] } }),
    prisma.rpgRecipe.findMany({
      where: { OR: [{ guildId: null }, { guildId }] },
      select: { guildId: true, resultItemId: true },
    }),
    listGuildMonsters(guildId),
    getOrCreateEconomyConfig(guildId),
    getShopModuleState(guildId),
    listFirstKills(guildId),
  ]);

  // Un objet du serveur masque le livré du même nom, comme partout ailleurs : le catalogue
  // ne doit montrer qu'une fiche par nom, celle que le jeu remet réellement.
  const byName = new Map<string, RpgItem>();
  for (const row of rows) {
    const known = byName.get(row.name);
    if (!known || (known.guildId === null && row.guildId !== null)) byName.set(row.name, row);
  }

  const nameById = new Map(rows.map((row) => [row.id, row.name]));
  const craftedNames = new Set(
    preferGuildRecipes(recipes)
      .map((recipe) => nameById.get(recipe.resultItemId))
      .filter((name): name is string => Boolean(name)),
  );

  const droppedBy = new Map<string, string[]>();
  const droppedByBoss = new Map<string, string[]>();
  const firstKillOf = new Map<string, string[]>();
  for (const monster of monsters) {
    for (const drop of parseMonsterDrops(monster.drops)) {
      push(monster.isBoss ? droppedByBoss : droppedBy, drop.itemName, monster.name);
    }
    if (monster.firstKillItemName && !firstKills.has(monster.name)) {
      push(firstKillOf, monster.firstKillItemName, monster.name);
    }
  }

  const campaignNames = new Set(
    RPG_CAMPAIGN.flatMap((chapter) => [chapter.reward, ...chapter.steps.map((step) => step.reward)])
      .map((reward) => reward.itemName)
      .filter((name): name is string => Boolean(name)),
  );

  return [...byName.values()].map((item) => ({
    item,
    shop: config.shopEnabled && item.purchasable && isShopItemUnlocked(item, modules),
    monsters: droppedBy.get(item.name) ?? [],
    bosses: droppedByBoss.get(item.name) ?? [],
    crafted: craftedNames.has(item.name),
    firstKill: firstKillOf.get(item.name) ?? [],
    campaign: campaignNames.has(item.name),
  }));
}
