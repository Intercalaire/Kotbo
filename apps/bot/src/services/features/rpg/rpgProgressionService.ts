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

export type EquipmentSlot = 'weapon' | 'armor' | 'accessory';
export type AllocatableStat = 'attack' | 'defense' | 'speed' | 'maxHealth';

/** Points de caractéristiques accordés à chaque niveau gagné. */
export const STAT_POINTS_PER_LEVEL = 3;

/** Un point investi dans les PV vaut plusieurs PV, sinon l'option ne vaut jamais le coup. */
const MAX_HEALTH_PER_POINT = 8;

const SLOT_FIELDS: Record<EquipmentSlot, { itemId: 'weaponId' | 'armorId' | 'accessoryId'; upgrade: 'weaponUpgrade' | 'armorUpgrade' | 'accessoryUpgrade' }> = {
  weapon: { itemId: 'weaponId', upgrade: 'weaponUpgrade' },
  armor: { itemId: 'armorId', upgrade: 'armorUpgrade' },
  accessory: { itemId: 'accessoryId', upgrade: 'accessoryUpgrade' },
};

/** Emplacement d'équipement correspondant à un type d'objet. */
export function slotForItemType(type: string): EquipmentSlot | null {
  if (type === 'WEAPON') return 'weapon';
  if (type === 'ARMOR') return 'armor';
  if (type === 'ACCESSORY') return 'accessory';
  return null;
}

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

  return {
    rpgClass: getRpgClass(classId)!,
    cost: isReclass ? RECLASS_COST : 0,
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
    include: { inventory: { include: { item: true } } },
  });
  if (!profile) return [];

  const recipes = await prisma.rpgRecipe.findMany({
    where: { OR: [{ guildId: null }, { guildId }] },
    include: { resultItem: true },
    orderBy: { levelRequired: 'asc' },
  });

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
    include: { inventory: { include: { item: true } } },
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
  const consumptions: { entryId: string; remaining: number }[] = [];
  for (const ingredient of ingredients) {
    const entry = entriesByName.get(ingredient.itemName);
    if (!entry || entry.quantity < ingredient.quantity) {
      throw new Error(`Matériau manquant : ${ingredient.itemName} (${entry?.quantity ?? 0}/${ingredient.quantity}).`);
    }
    consumptions.push({ entryId: entry.id, remaining: entry.quantity - ingredient.quantity });
  }

  const writes: Prisma.PrismaPromise<unknown>[] = consumptions.map(({ entryId, remaining }) =>
    remaining > 0
      ? prisma.rpgInventoryItem.update({ where: { id: entryId }, data: { quantity: remaining } })
      : prisma.rpgInventoryItem.delete({ where: { id: entryId } }),
  );

  writes.push(
    prisma.rpgInventoryItem.upsert({
      where: { rpgProfileId_itemId: { rpgProfileId: profile.id, itemId: recipe.resultItemId } },
      update: { quantity: { increment: 1 } },
      create: { rpgProfileId: profile.id, itemId: recipe.resultItemId, quantity: 1 },
    }),
    prisma.rpgProfile.update({
      where: { id: profile.id },
      data: { balance: { decrement: recipe.coinCost } },
    }),
  );

  await prisma.$transaction(writes);

  return {
    itemName: recipe.resultItem.name,
    itemEmoji: recipe.resultItem.emoji,
    rarity: recipe.resultItem.rarity,
    coinCost: recipe.coinCost,
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

  const ids = [profile.weaponId, profile.armorId, profile.accessoryId].filter((id): id is string => Boolean(id));
  const items = ids.length > 0
    ? await prisma.rpgItem.findMany({ where: { id: { in: ids } } })
    : [];
  const itemById = new Map(items.map((item) => [item.id, item]));

  const quotes: UpgradeQuote[] = [];
  for (const slot of ['weapon', 'armor', 'accessory'] as EquipmentSlot[]) {
    const fields = SLOT_FIELDS[slot];
    const itemId = profile[fields.itemId];
    if (!itemId) continue;
    const item = itemById.get(itemId);
    if (!item) continue;

    const currentLevel = profile[fields.upgrade];
    quotes.push({
      slot,
      itemName: item.name,
      itemEmoji: item.emoji,
      currentLevel,
      maxed: currentLevel >= MAX_UPGRADE_LEVEL,
      cost: upgradeCost(item.price, currentLevel),
      successChance: upgradeSuccessChance(currentLevel),
    });
  }

  return quotes;
}

/**
 * Tente d'améliorer l'objet porté dans un emplacement.
 * Un échec ne détruit ni ne rétrograde l'objet : seules les pièces sont perdues.
 */
export async function upgradeEquipment(guildId: string, userId: string, slot: EquipmentSlot) {
  const fields = SLOT_FIELDS[slot];

  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!profile) throw new Error('Profil RPG introuvable.');

  const itemId = profile[fields.itemId];
  if (!itemId) throw new Error("Aucun objet équipé dans cet emplacement.");

  const item = await prisma.rpgItem.findUnique({ where: { id: itemId } });
  if (!item) throw new Error('Objet équipé introuvable.');

  const currentLevel = profile[fields.upgrade];
  if (currentLevel >= MAX_UPGRADE_LEVEL) {
    throw new Error(`${item.name} est déjà au niveau maximum (+${MAX_UPGRADE_LEVEL}).`);
  }

  const cost = upgradeCost(item.price, currentLevel);
  if (profile.balance < cost) {
    throw new Error(`Cette amélioration coûte ${cost} pièces, vous en avez ${profile.balance}.`);
  }

  // Débit atomique conditionné au solde ET au niveau actuel : deux tentatives simultanées
  // ne peuvent ni être payées une seule fois, ni faire gagner deux niveaux pour un paiement.
  const paid = await prisma.rpgProfile.updateMany({
    where: {
      id: profile.id,
      balance: { gte: cost },
      [fields.upgrade]: currentLevel,
      [fields.itemId]: itemId,
    },
    data: { balance: { decrement: cost } },
  });

  if (paid.count === 0) {
    throw new Error("L'amélioration a échoué, réessayez.");
  }

  const success = Math.random() < upgradeSuccessChance(currentLevel);
  if (success) {
    await prisma.rpgProfile.update({
      where: { id: profile.id },
      data: { [fields.upgrade]: { increment: 1 } },
    });
  }

  return {
    success,
    itemName: item.name,
    itemEmoji: item.emoji,
    cost,
    newLevel: success ? currentLevel + 1 : currentLevel,
    successChance: upgradeSuccessChance(currentLevel),
  };
}

export type { RpgClassId };
