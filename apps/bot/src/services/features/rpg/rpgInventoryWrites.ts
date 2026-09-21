/**
 * Écritures d'inventaire sûres face aux clics concurrents.
 *
 * Deux fenêtres de `/rpg` ouvertes côte à côte, ou un double clic, lisaient la même
 * quantité puis la dépensaient chacune : potion bue deux fois, objet vendu deux fois,
 * fabrication payée une fois et livrée deux. Ces fonctions s'utilisent dans une transaction
 * qui a d'abord verrouillé le profil avec `lockRpgProfile`.
 */

import type { Prisma } from '@prisma/client';

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
 * Retire des exemplaires de l'inventaire, dans une transaction qui a verrouillé le profil.
 *
 * Renvoie la ligne telle qu'elle était avant le retrait, ou `null` si le joueur n'en
 * possède pas assez. Une ligne vidée est supprimée, et sa progression avec elle quand
 * `dropInstance` le demande.
 */
export async function takeInventoryQuantity(
  tx: Prisma.TransactionClient,
  rpgProfileId: string,
  itemId: string,
  quantity: number,
  options: { dropInstance?: boolean } = {},
) {
  const entry = await tx.rpgInventoryItem.findUnique({
    where: { rpgProfileId_itemId: { rpgProfileId, itemId } },
    include: { item: true }
  });
  if (!entry || entry.quantity < quantity) return null;

  const removed = await tx.rpgInventoryItem.updateMany({
    where: { id: entry.id, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } }
  });
  if (removed.count === 0) return null;

  // Décidé sur la quantité en base et non sur celle lue : un butin de combat s'ajoute sans
  // passer par le verrou, et supprimer la ligne d'après la lecture l'emporterait avec elle.
  const emptied = await tx.rpgInventoryItem.deleteMany({ where: { id: entry.id, quantity: { lte: 0 } } });
  if (emptied.count > 0 && options.dropInstance) {
    await tx.rpgItemInstance.deleteMany({ where: { rpgProfileId, itemId } });
  }

  return entry;
}
