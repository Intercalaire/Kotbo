/**
 * Écritures d'inventaire sûres face aux clics concurrents.
 *
 * Deux fenêtres de `/rpg` ouvertes côte à côte, ou un double clic, lisaient la même
 * quantité puis la dépensaient chacune : potion bue deux fois, objet vendu deux fois,
 * fabrication payée une fois et livrée deux. Ces fonctions s'utilisent dans une transaction
 * qui a d'abord verrouillé le profil avec `lockRpgProfile`.
 */

import type { Prisma } from '@prisma/client';
import { parseEnchants, type EnchantStack } from './rpgEnchantments.js';
import { equippedItemIds } from './rpgEquipment.js';
import { countCopies, isBlankProgression } from './rpgItemInstanceService.js';

/**
 * Verrouille la ligne du profil jusqu'à la fin de la transaction.
 *
 * Toute écriture d'inventaire lit une quantité puis écrit : sans ce verrou, deux fenêtres
 * de `/rpg` ouvertes côte à côte lisaient la même quantité et la dépensaient deux fois.
 */
export async function lockRpgProfile(tx: Prisma.TransactionClient, profileId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "rpg_profiles" WHERE "id" = ${profileId} FOR UPDATE`;
}

/**
 * Ajoute des exemplaires à l'inventaire.
 *
 * Une ligne tombée sous zéro par d'anciennes écritures concurrentes est remise à plat
 * avant l'ajout : sinon l'objet acheté servirait à combler le trou et resterait invisible.
 */
export async function addInventoryQuantity(
  tx: Prisma.TransactionClient,
  rpgProfileId: string,
  itemId: string,
  quantity: number,
): Promise<void> {
  const entry = await tx.rpgInventoryItem.upsert({
    where: { rpgProfileId_itemId: { rpgProfileId, itemId } },
    update: { quantity: { increment: quantity } },
    create: { rpgProfileId, itemId, quantity }
  });

  if (entry.quantity < quantity) {
    await tx.rpgInventoryItem.update({ where: { id: entry.id }, data: { quantity } });
  }
}

/**
 * Exemplaires ordinaires qu'une action générique peut consommer : ni un exemplaire forgé
 * ou enchanté, qui ne part que si on le désigne, ni l'exemplaire ordinaire porté.
 */
export async function freePlainCopies(tx: Prisma.TransactionClient, rpgProfileId: string, itemId: string): Promise<number> {
  const [profile, copies] = await Promise.all([
    tx.rpgProfile.findUniqueOrThrow({
      where: { id: rpgProfileId },
      select: { weaponId: true, armorId: true, accessoryId: true, accessory2Id: true, accessory3Id: true },
    }),
    countCopies(tx, rpgProfileId, itemId),
  ]);
  const wornPlain = equippedItemIds(profile).includes(itemId) && !copies.wornInstance;
  return Math.max(0, copies.plain - (wornPlain ? 1 : 0));
}

/**
 * Retire des exemplaires ordinaires, dans une transaction qui a verrouillé le profil.
 *
 * Renvoie la ligne telle qu'elle était avant le retrait, ou `null` si le joueur n'a pas
 * assez d'exemplaires ordinaires libres. Vendre, fabriquer ou donner n'emporte donc jamais
 * un exemplaire forgé ni celui qu'on porte : ceux-là se retirent un par un, désignés.
 *
 * `anyCopy` (retrait par un administrateur) prend aussi les exemplaires forgés quand les
 * ordinaires ne suffisent pas : les moins forgés partent d'abord, celui porté en dernier.
 */
export async function takeInventoryQuantity(
  tx: Prisma.TransactionClient,
  rpgProfileId: string,
  itemId: string,
  quantity: number,
  options: { anyCopy?: boolean } = {},
) {
  const entry = await tx.rpgInventoryItem.findUnique({
    where: { rpgProfileId_itemId: { rpgProfileId, itemId } },
    include: { item: true }
  });
  if (!entry || entry.quantity < quantity) return null;
  if (!options.anyCopy && (await freePlainCopies(tx, rpgProfileId, itemId)) < quantity) return null;

  const removed = await tx.rpgInventoryItem.updateMany({
    where: { id: entry.id, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } }
  });
  if (removed.count === 0) return null;

  // Décidé sur la quantité en base et non sur celle lue : un butin de combat s'ajoute sans
  // passer par le verrou, et supprimer la ligne d'après la lecture l'emporterait avec elle.
  await tx.rpgInventoryItem.deleteMany({ where: { id: entry.id, quantity: { lte: 0 } } });

  if (options.anyCopy) await trimInstancesToStock(tx, rpgProfileId, itemId);

  return entry;
}

/**
 * Supprime les exemplaires individualisés en trop quand la pile a fondu sous leur nombre :
 * les moins forgés d'abord, celui porté en dernier.
 */
async function trimInstancesToStock(tx: Prisma.TransactionClient, rpgProfileId: string, itemId: string): Promise<void> {
  const stock = await tx.rpgInventoryItem.findUnique({
    where: { rpgProfileId_itemId: { rpgProfileId, itemId } },
    select: { quantity: true },
  });
  const instances = await tx.rpgItemInstance.findMany({
    where: { rpgProfileId, itemId },
    orderBy: [{ equipped: 'asc' }, { upgrade: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const surplus = instances.length - Math.max(0, stock?.quantity ?? 0);
  if (surplus <= 0) return;
  await tx.rpgItemInstance.deleteMany({ where: { id: { in: instances.slice(0, surplus).map((instance) => instance.id) } } });
}

/**
 * Retire UN exemplaire individualisé, désigné, dans une transaction qui a verrouillé le
 * profil. L'exemplaire porté est refusé : il faut d'abord le retirer.
 *
 * Renvoie l'objet et la progression emportée, ou `null` si l'exemplaire n'existe plus.
 */
export async function takeItemInstance(tx: Prisma.TransactionClient, rpgProfileId: string, instanceId: string) {
  const instance = await tx.rpgItemInstance.findFirst({
    where: { id: instanceId, rpgProfileId },
    include: { item: true },
  });
  if (!instance) return null;
  if (instance.equipped) {
    // Le drapeau seul ne suffit pas : un emplacement vidé par un autre chemin (remise à
    // zéro, retrait d'un administrateur) peut laisser un exemplaire marqué porté.
    const profile = await tx.rpgProfile.findUniqueOrThrow({
      where: { id: rpgProfileId },
      select: { weaponId: true, armorId: true, accessoryId: true, accessory2Id: true, accessory3Id: true },
    });
    if (equippedItemIds(profile).includes(instance.itemId)) {
      throw new Error(`Cet exemplaire de ${instance.item.name} est équipé : retirez-le d'abord.`);
    }
  }

  const removed = await tx.rpgInventoryItem.updateMany({
    where: { rpgProfileId, itemId: instance.itemId, quantity: { gte: 1 } },
    data: { quantity: { decrement: 1 } },
  });
  if (removed.count === 0) return null;
  await tx.rpgInventoryItem.deleteMany({ where: { rpgProfileId, itemId: instance.itemId, quantity: { lte: 0 } } });
  await tx.rpgItemInstance.delete({ where: { id: instance.id } });

  return {
    item: instance.item,
    upgrade: instance.upgrade,
    enchants: parseEnchants(instance.enchants),
  };
}

/**
 * Ajoute un exemplaire individualisé : un objet forgé acheté au marché ou rendu par une
 * annonce retirée garde sa progression au lieu de rejoindre la pile ordinaire.
 */
export async function addItemInstance(
  tx: Prisma.TransactionClient,
  rpgProfileId: string,
  itemId: string,
  progression: { upgrade: number; enchants: EnchantStack[] },
): Promise<void> {
  await addInventoryQuantity(tx, rpgProfileId, itemId, 1);
  if (isBlankProgression(progression)) return;
  await tx.rpgItemInstance.create({
    data: { rpgProfileId, itemId, upgrade: progression.upgrade, enchants: progression.enchants },
  });
}
