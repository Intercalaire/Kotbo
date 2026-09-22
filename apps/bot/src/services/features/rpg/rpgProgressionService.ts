/**
 * Progression du personnage : choix de classe, répartition des points de caractéristiques,
 * artisanat et amélioration d'équipement (forge).
 *
 * Ces quatre systèmes partagent la même règle : ils écrivent uniquement des stats de BASE
 * ou des références d'équipement. Aucun bonus n'est jamais incorporé aux colonnes, le calcul
 * final restant la responsabilité exclusive de `getEffectiveStats`.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../../../utils/db.js';
import { CLASS_UNLOCK_LEVEL, getRpgClass, isRpgClassId, type RpgClassId } from './rpgClasses.js';
import { MAX_UPGRADE_LEVEL, upgradeCost, upgradeSuccessChance } from './rpgStats.js';
import { ensureItemInstance } from './rpgItemInstanceService.js';
import { addInventoryQuantity, lockRpgProfile, takeInventoryQuantity } from './rpgInventoryWrites.js';
import { parseRecipeIngredients, preferGuildRecipes, salvageYield } from './rpgRecipePolicy.js';
import { listGuildMonsters } from './rpgBestiaryService.js';
import { parseMonsterDrops } from './rpgBestiaryPolicy.js';
import { resetSkillTreeForClassChange } from './rpgSkillTreeService.js';
import { loadGuildPerks } from './rpgGuildBuildingService.js';
import { NO_GUILD_PERKS } from './rpgGuildBuildings.js';

/**
 * Chance de réussite d'une amélioration, forge de guilde comprise.
 *
 * Le bonus du village ne peut pas pousser au-delà de 95 % : garantir la réussite
 * retirerait tout enjeu aux derniers paliers, qui sont le principal puits à pièces.
 * Les paliers déjà garantis par `upgradeSuccessChance` échappent à ce plafond.
 */
function forgeChance(currentLevel: number, guildBonus: number): number {
  const base = upgradeSuccessChance(currentLevel);
  if (base >= 1) return 1;
  return Math.min(0.95, base + guildBonus);
}
import {
  SLOT_ITEM_FIELD,
  equippedItemIds,
  unlockedSlots,
  type EquipmentSlot,
} from './rpgEquipment.js';

// Le vocabulaire des emplacements vit dans `rpgEquipment.ts`. Il reste réexporté ici
// parce que la forge en est le principal consommateur historique, et que les modules
// qui l'importaient d'ici n'ont aucune raison de changer d'adresse.
export { SLOT_ITEM_FIELD, slotForItemType, type EquipmentSlot } from './rpgEquipment.js';

export type AllocatableStat = 'attack' | 'defense' | 'speed' | 'maxHealth';

/** Points de caractéristiques accordés à chaque niveau gagné. */
export const STAT_POINTS_PER_LEVEL = 3;

/** Un point investi dans les PV vaut plusieurs PV, sinon l'option ne vaut jamais le coup. */
const MAX_HEALTH_PER_POINT = 8;

// ════════════════════════════════════════════════════════════════════════════
// CLASSE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Fixe la classe du personnage. Le premier choix est gratuit ; en changer ensuite coûte
 * `RECLASS_COST` pour que la décision garde du poids sans être définitive.
 */
export const RECLASS_COST = 2_500;

export async function chooseRpgClass(guildId: string, userId: string, classId: string) {
  if (!isRpgClassId(classId)) throw new Error('Classe inconnue.');

  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!profile) throw new Error('Profil RPG introuvable.');

  if (profile.level < CLASS_UNLOCK_LEVEL) {
    throw new Error(`Le choix de classe se débloque au niveau ${CLASS_UNLOCK_LEVEL}. Vous êtes niveau ${profile.level}.`);
  }
  if (profile.className === classId) {
    throw new Error('Vous appartenez déjà à cette classe.');
  }

  const isReclass = profile.className !== null;
  if (isReclass && profile.balance < RECLASS_COST) {
    throw new Error(`Changer de classe coûte ${RECLASS_COST} pièces. Vous en avez ${profile.balance}.`);
  }

  // Garde atomique sur le solde : deux changements simultanés ne peuvent pas être
  // payés une seule fois.
  const updated = await prisma.rpgProfile.updateMany({
    where: isReclass
      ? { id: profile.id, balance: { gte: RECLASS_COST }, className: profile.className }
      : { id: profile.id, className: null },
    data: {
      className: classId,
      ...(isReclass ? { balance: { decrement: RECLASS_COST } } : {}),
    },
  });

  if (updated.count === 0) {
    throw new Error('Le changement de classe a échoué, réessayez.');
  }

  // Les branches de l'arbre appartiennent à une classe : garder les nœuds de l'ancienne
  // laisserait des bonus que le nouvel arbre ne sait plus expliquer ni retirer. Les points
  // sont intégralement rendus, le joueur paie déjà le changement de classe.
  const refundedSkillPoints = isReclass
    ? await resetSkillTreeForClassChange(profile.id)
    : 0;

  return {
    rpgClass: getRpgClass(classId)!,
    cost: isReclass ? RECLASS_COST : 0,
    refundedSkillPoints,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// POINTS DE CARACTÉRISTIQUES
// ════════════════════════════════════════════════════════════════════════════

export async function allocateStatPoint(guildId: string, userId: string, stat: AllocatableStat, amount = 1) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Quantité invalide.');

  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!profile) throw new Error('Profil RPG introuvable.');
  if (profile.statPoints < amount) {
    throw new Error(`Vous n'avez que ${profile.statPoints} point(s) à répartir.`);
  }

  const gain = stat === 'maxHealth' ? amount * MAX_HEALTH_PER_POINT : amount;

  const data: Prisma.RpgProfileUpdateInput = {
    statPoints: { decrement: amount },
    [stat]: { increment: gain },
  };
  // Investir en vitalité soigne d'autant, sinon le gain reste invisible jusqu'au repos.
  if (stat === 'maxHealth') data.health = { increment: gain };

  // `updateMany` avec garde sur `statPoints` : deux clics rapides ne peuvent pas
  // dépenser le même point deux fois.
  const updated = await prisma.rpgProfile.updateMany({
    where: { id: profile.id, statPoints: { gte: amount } },
    data: data as Prisma.RpgProfileUpdateManyMutationInput,
  });

  if (updated.count === 0) {
    throw new Error("Ces points ont déjà été dépensés.");
  }

  return { stat, spent: amount, gain, remaining: profile.statPoints - amount };
}

// ════════════════════════════════════════════════════════════════════════════
// ARTISANAT
// ════════════════════════════════════════════════════════════════════════════

export type RecipeIngredient = { itemName: string; quantity: number };

export type CraftableRecipe = {
  id: string;
  resultItemId: string;
  resultName: string;
  resultEmoji: string;
  resultRarity: string;
  resultType: string;
  coinCost: number;
  levelRequired: number;
  ingredients: (RecipeIngredient & { owned: number })[];
  craftable: boolean;
  missingReason: string | null;
};

/** Recettes visibles pour un joueur, avec l'état de ses matériaux. */
export async function listRecipesFor(guildId: string, userId: string): Promise<CraftableRecipe[]> {
  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
    include: { inventory: { where: { quantity: { gt: 0 } }, include: { item: true } } },
  });
  if (!profile) return [];

  const allRecipes = await prisma.rpgRecipe.findMany({
    where: { OR: [{ guildId: null }, { guildId }] },
    include: { resultItem: true },
    orderBy: { levelRequired: 'asc' },
  });

  // Une recette écrite par le serveur remplace celle fournie de base pour le même objet :
  // les deux côte à côte donnaient deux entrées identiques à un prix différent.
  const recipes = preferGuildRecipes(allRecipes);

  const ownedByName = new Map<string, number>();
  for (const entry of profile.inventory) {
    ownedByName.set(entry.item.name, (ownedByName.get(entry.item.name) ?? 0) + entry.quantity);
  }

  return recipes.map((recipe) => {
    const ingredients = (recipe.ingredients as unknown as RecipeIngredient[]).map((ing) => ({
      ...ing,
      owned: ownedByName.get(ing.itemName) ?? 0,
    }));

    const missingMaterial = ingredients.find((ing) => ing.owned < ing.quantity);
    let missingReason: string | null = null;
    if (profile.level < recipe.levelRequired) missingReason = `Niveau ${recipe.levelRequired} requis`;
    else if (profile.balance < recipe.coinCost) missingReason = `${recipe.coinCost} pièces requises`;
    else if (missingMaterial) missingReason = `${missingMaterial.itemName} : ${missingMaterial.owned}/${missingMaterial.quantity}`;

    return {
      id: recipe.id,
      resultItemId: recipe.resultItemId,
      resultName: recipe.resultItem.name,
      resultEmoji: recipe.resultItem.emoji,
      resultRarity: recipe.resultItem.rarity,
      resultType: recipe.resultItem.type,
      coinCost: recipe.coinCost,
      levelRequired: recipe.levelRequired,
      ingredients,
      craftable: missingReason === null,
      missingReason,
    };
  });
}

/** Fabrique l'objet d'une recette : consomme les matériaux et les pièces. */
export async function craftRecipe(guildId: string, userId: string, recipeId: string) {
  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
    include: { inventory: { where: { quantity: { gt: 0 } }, include: { item: true } } },
  });
  if (!profile) throw new Error('Profil RPG introuvable.');

  const recipe = await prisma.rpgRecipe.findUnique({
    where: { id: recipeId },
    include: { resultItem: true },
  });
  if (!recipe || (recipe.guildId !== null && recipe.guildId !== guildId)) {
    throw new Error('Recette introuvable.');
  }
  if (profile.level < recipe.levelRequired) {
    throw new Error(`Cette recette requiert le niveau ${recipe.levelRequired}.`);
  }
  if (profile.balance < recipe.coinCost) {
    throw new Error(`Il vous manque des pièces (coût : ${recipe.coinCost}).`);
  }

  const ingredients = recipe.ingredients as unknown as RecipeIngredient[];
  const entriesByName = new Map(profile.inventory.map((entry) => [entry.item.name, entry]));

  // Vérification complète AVANT toute écriture : on ne consomme jamais partiellement.
  const consumptions: { itemId: string; itemName: string; quantity: number }[] = [];
  for (const ingredient of ingredients) {
    const entry = entriesByName.get(ingredient.itemName);
    if (!entry || entry.quantity < ingredient.quantity) {
      throw new Error(`Matériau manquant : ${ingredient.itemName} (${entry?.quantity ?? 0}/${ingredient.quantity}).`);
    }
    consumptions.push({ itemId: entry.itemId, itemName: ingredient.itemName, quantity: ingredient.quantity });
  }

  // Tout se rejoue sous verrou, par décréments conditionnels : la quantité restante était
  // calculée à l'avance puis réécrite, si bien qu'un double clic fabriquait deux objets
  // pour le prix d'un et qu'un achat fait entre-temps était effacé.
  await prisma.$transaction(async (tx) => {
    await lockRpgProfile(tx, profile.id);

    for (const consumption of consumptions) {
      const taken = await takeInventoryQuantity(tx, profile.id, consumption.itemId, consumption.quantity);
      if (!taken) throw new Error(`Matériau manquant : ${consumption.itemName}.`);
    }

    const paid = await tx.rpgProfile.updateMany({
      where: { id: profile.id, balance: { gte: recipe.coinCost } },
      data: { balance: { decrement: recipe.coinCost } },
    });
    if (paid.count === 0) throw new Error(`Il vous manque des pièces (coût : ${recipe.coinCost}).`);

    await addInventoryQuantity(tx, profile.id, recipe.resultItemId, 1);
  });

  return {
    itemName: recipe.resultItem.name,
    itemEmoji: recipe.resultItem.emoji,
    rarity: recipe.resultItem.rarity,
    coinCost: recipe.coinCost,
  };
}

export type MaterialSource = {
  /** Créatures déjà affrontées par le joueur qui lâchent ce matériau. */
  known: string[];
  /** Créatures qui le lâchent mais que le joueur n'a jamais affrontées. */
  hidden: number;
};

/**
 * Où trouver chaque matériau demandé, d'après le butin du bestiaire du serveur.
 *
 * Les créatures jamais affrontées ne sont que comptées : les nommer ici dévoilerait ce que
 * le bestiaire garde caché tant que le joueur ne les a pas rencontrées.
 */
export async function listMaterialSources(
  guildId: string,
  userId: string,
  materialNames: string[],
): Promise<Map<string, MaterialSource>> {
  const sources = new Map<string, MaterialSource>();
  if (materialNames.length === 0) return sources;

  const wanted = new Set(materialNames);
  const [monsters, fought] = await Promise.all([
    listGuildMonsters(guildId),
    prisma.rpgBattle.findMany({ where: { guildId, userId }, distinct: ['monsterId'], select: { monsterId: true } }),
  ]);
  const foughtIds = new Set(fought.map((battle) => battle.monsterId));

  for (const monster of monsters) {
    for (const drop of parseMonsterDrops(monster.drops)) {
      if (!wanted.has(drop.itemName)) continue;
      const source = sources.get(drop.itemName) ?? { known: [], hidden: 0 };
      if (foughtIds.has(monster.id)) source.known.push(`${monster.emoji} ${monster.name}`);
      else source.hidden += 1;
      sources.set(drop.itemName, source);
    }
  }

  return sources;
}

/** Recette effective d'un objet pour ce serveur, celle du serveur passant avant la livrée. */
async function findRecipeForItem(guildId: string, itemId: string) {
  const recipes = await prisma.rpgRecipe.findMany({
    where: { resultItemId: itemId, OR: [{ guildId: null }, { guildId }] },
  });
  return preferGuildRecipes(recipes)[0] ?? null;
}

/** Matériaux que rendrait le démantèlement de l'objet, ou `null` s'il ne se fabrique pas. */
export async function getSalvageQuote(guildId: string, itemId: string): Promise<RecipeIngredient[] | null> {
  const recipe = await findRecipeForItem(guildId, itemId);
  if (!recipe) return null;
  const returned = salvageYield(parseRecipeIngredients(recipe.ingredients));
  return returned.length > 0 ? returned : null;
}

/**
 * Démantèle un exemplaire d'un objet fabricable contre une partie de ses matériaux.
 *
 * Mêmes garde-fous que la revente : un objet porté doit d'abord être retiré, et le dernier
 * exemplaire emporte sa progression (forge, enchantements) avec lui.
 */
export async function salvageItem(guildId: string, userId: string, itemId: string) {
  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { id: true },
  });
  if (!profile) throw new Error('Profil RPG introuvable.');

  const returned = await getSalvageQuote(guildId, itemId);
  if (!returned) throw new Error('Cet objet ne se fabrique pas : il ne peut pas être démantelé.');

  // Les matériaux sont désignés par leur nom : l'objet du serveur l'emporte sur le livré
  // du même nom, comme partout ailleurs.
  const materials = await prisma.rpgItem.findMany({
    where: { name: { in: returned.map((ingredient) => ingredient.itemName) }, OR: [{ guildId: null }, { guildId }] },
    select: { id: true, name: true, emoji: true, guildId: true },
  });
  const byName = new Map<string, (typeof materials)[number]>();
  for (const material of materials) {
    if (!byName.has(material.name) || material.guildId !== null) byName.set(material.name, material);
  }
  const missing = returned.find((ingredient) => !byName.has(ingredient.itemName));
  if (missing) throw new Error(`Le matériau « ${missing.itemName} » n'existe plus sur ce serveur.`);

  const item = await prisma.$transaction(async (tx) => {
    await lockRpgProfile(tx, profile.id);

    // Relu sous verrou : l'objet a pu être équipé depuis une autre fenêtre entre-temps.
    const current = await tx.rpgProfile.findUniqueOrThrow({ where: { id: profile.id } });
    if (equippedItemIds(current).includes(itemId)) {
      throw new Error("Vous ne pouvez pas démanteler un objet équipé. Déséquipez-le d'abord.");
    }

    const taken = await takeInventoryQuantity(tx, profile.id, itemId, 1, { dropInstance: true });
    if (!taken) throw new Error('Vous ne possédez plus cet objet dans votre inventaire.');

    for (const ingredient of returned) {
      await addInventoryQuantity(tx, profile.id, byName.get(ingredient.itemName)!.id, ingredient.quantity);
    }
    return taken.item;
  });

  return {
    itemName: item.name,
    itemEmoji: item.emoji,
    returned: returned.map((ingredient) => ({ ...ingredient, emoji: byName.get(ingredient.itemName)!.emoji })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// FORGE (amélioration d'équipement)
// ════════════════════════════════════════════════════════════════════════════

export type UpgradeQuote = {
  slot: EquipmentSlot;
  itemName: string;
  itemEmoji: string;
  currentLevel: number;
  maxed: boolean;
  cost: number;
  successChance: number;
};

/** État de la forge pour les trois emplacements du joueur. */
export async function getUpgradeQuotes(guildId: string, userId: string): Promise<UpgradeQuote[]> {
  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!profile) return [];

  const ids = equippedItemIds(profile);
  if (ids.length === 0) return [];

  // La forge de guilde relève les chances affichées ici comme celles du tirage : sinon
  // le devis annoncerait un taux que la tentative ne respecterait pas.
  const perks = profile.rpgGuildId ? await loadGuildPerks(profile.rpgGuildId) : NO_GUILD_PERKS;

  const [items, instances] = await Promise.all([
    prisma.rpgItem.findMany({ where: { id: { in: ids } } }),
    prisma.rpgItemInstance.findMany({ where: { rpgProfileId: profile.id, itemId: { in: ids } } }),
  ]);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const upgradeByItemId = new Map(instances.map((instance) => [instance.itemId, instance.upgrade]));

  const quotes: UpgradeQuote[] = [];
  for (const slot of unlockedSlots(profile.level)) {
    const itemId = profile[SLOT_ITEM_FIELD[slot]];
    if (!itemId) continue;
    const item = itemById.get(itemId);
    if (!item) continue;

    // Sans instance, l'objet n'a jamais été amélioré : il part de zéro.
    const currentLevel = upgradeByItemId.get(itemId) ?? 0;
    quotes.push({
      slot,
      itemName: item.name,
      itemEmoji: item.emoji,
      currentLevel,
      maxed: currentLevel >= MAX_UPGRADE_LEVEL,
      cost: upgradeCost(item.price, currentLevel),
      successChance: forgeChance(currentLevel, perks.forgeSuccess),
    });
  }

  return quotes;
}

/**
 * Tente d'améliorer l'objet porté dans un emplacement.
 * Un échec ne détruit ni ne rétrograde l'objet : seules les pièces sont perdues.
 */
export async function upgradeEquipment(guildId: string, userId: string, slot: EquipmentSlot) {
  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!profile) throw new Error('Profil RPG introuvable.');

  const itemId = profile[SLOT_ITEM_FIELD[slot]];
  if (!itemId) throw new Error("Aucun objet équipé dans cet emplacement.");

  const item = await prisma.rpgItem.findUnique({ where: { id: itemId } });
  if (!item) throw new Error('Objet équipé introuvable.');

  // L'instance est créée à l'équipement, mais un objet équipé avant cette version - ou
  // par un chemin d'écriture direct - peut ne pas en avoir : on la matérialise ici.
  const instance = await ensureItemInstance(profile.id, itemId);

  const currentLevel = instance.upgrade;
  if (currentLevel >= MAX_UPGRADE_LEVEL) {
    throw new Error(`${item.name} est déjà au niveau maximum (+${MAX_UPGRADE_LEVEL}).`);
  }

  const cost = upgradeCost(item.price, currentLevel);
  if (profile.balance < cost) {
    throw new Error(`Cette amélioration coûte ${cost} pièces, vous en avez ${profile.balance}.`);
  }

  // Débit atomique conditionné au solde ET à l'objet toujours porté : deux tentatives
  // simultanées ne peuvent pas être payées une seule fois.
  const paid = await prisma.rpgProfile.updateMany({
    where: {
      id: profile.id,
      balance: { gte: cost },
      [SLOT_ITEM_FIELD[slot]]: itemId,
    },
    data: { balance: { decrement: cost } },
  });

  if (paid.count === 0) {
    throw new Error("L'amélioration a échoué, réessayez.");
  }

  // Garde sur le niveau au moment de l'incrément : deux réussites simultanées ne peuvent
  // pas faire gagner deux niveaux pour un seul paiement.
  const perks = profile.rpgGuildId ? await loadGuildPerks(profile.rpgGuildId) : NO_GUILD_PERKS;
  const chance = forgeChance(currentLevel, perks.forgeSuccess);

  let success = Math.random() < chance;
  if (success) {
    const applied = await prisma.rpgItemInstance.updateMany({
      where: { id: instance.id, upgrade: currentLevel },
      data: { upgrade: currentLevel + 1 },
    });
    success = applied.count > 0;
  }

  return {
    success,
    itemName: item.name,
    itemEmoji: item.emoji,
    cost,
    newLevel: success ? currentLevel + 1 : currentLevel,
    successChance: chance,
  };
}

export type { RpgClassId };
