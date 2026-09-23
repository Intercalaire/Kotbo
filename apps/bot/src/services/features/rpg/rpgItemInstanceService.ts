/**
 * Exemplaires d'objets : les exemplaires forgés ou enchantés, distincts de la pile.
 *
 * `RpgInventoryItem.quantity` compte tous les exemplaires d'un objet. Chaque instance en
 * désigne un seul, porteur de sa progression (forge, enchantements) ; les exemplaires
 * ordinaires sont la différence. Forger son épée ne rend donc plus +2 les épées ramassées
 * ensuite, et un exemplaire +1 ne s'empile ni avec un +2 ni avec un ordinaire.
 *
 * Invariants :
 * - au plus autant d'instances que d'exemplaires ;
 * - au plus une instance `equipped` par (profil, objet), un objet n'occupant qu'un
 *   emplacement. Sans instance marquée, l'objet porté est un exemplaire ordinaire ;
 * - une instance revenue à +0 sans enchantement est supprimée : l'exemplaire redevient
 *   ordinaire et rejoint la pile.
 *
 * Ce module est volontairement sans dépendance métier : la forge, l'autel d'enchantement
 * et le service d'économie s'en servent tous, un module partagé évite les cycles d'imports.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../../../utils/db.js';
import { parseEnchants, type EnchantStack } from './rpgEnchantments.js';

export type ItemProgression = {
  id: string;
  itemId: string;
  upgrade: number;
  enchants: EnchantStack[];
  equipped: boolean;
};

type InstanceRow = { id: string; itemId: string; upgrade: number; enchants: unknown; equipped: boolean };

function toProgression(instance: InstanceRow): ItemProgression {
  return {
    id: instance.id,
    itemId: instance.itemId,
    upgrade: instance.upgrade,
    enchants: parseEnchants(instance.enchants),
    equipped: instance.equipped,
  };
}

/** Un exemplaire sans forge ni enchantement n'a pas à exister : c'est un exemplaire ordinaire. */
export function isBlankProgression(progression: { upgrade: number; enchants: EnchantStack[] }): boolean {
  return progression.upgrade <= 0 && progression.enchants.length === 0;
}

/** Progression de l'exemplaire porté, ou `null` quand l'objet porté est un exemplaire ordinaire. */
export async function getWornInstance(rpgProfileId: string, itemId: string): Promise<ItemProgression | null> {
  const instance = await prisma.rpgItemInstance.findFirst({
    where: { rpgProfileId, itemId, equipped: true },
  });
  return instance ? toProgression(instance) : null;
}

/**
 * Progression des exemplaires portés, indexée par identifiant d'objet. Un seul
 * aller-retour, pour les vues qui décrivent tout l'équipement.
 */
export async function getWornInstances(rpgProfileId: string, itemIds: string[]): Promise<Map<string, ItemProgression>> {
  if (itemIds.length === 0) return new Map();

  const instances = await prisma.rpgItemInstance.findMany({
    where: { rpgProfileId, itemId: { in: itemIds }, equipped: true },
  });
  return new Map(instances.map((instance) => [instance.itemId, toProgression(instance)]));
}

/** Tous les exemplaires individualisés d'un profil, les plus forgés d'abord. */
export async function listItemInstances(rpgProfileId: string, itemIds?: string[]): Promise<ItemProgression[]> {
  const instances = await prisma.rpgItemInstance.findMany({
    where: { rpgProfileId, ...(itemIds ? { itemId: { in: itemIds } } : {}) },
    orderBy: [{ upgrade: 'desc' }, { createdAt: 'asc' }],
  });
  return instances.map(toProgression);
}

export async function getItemInstanceById(rpgProfileId: string, instanceId: string): Promise<ItemProgression | null> {
  const instance = await prisma.rpgItemInstance.findFirst({ where: { id: instanceId, rpgProfileId } });
  return instance ? toProgression(instance) : null;
}

/**
 * Réécrit la progression de l'exemplaire porté d'un objet, dans une transaction qui a
 * verrouillé le profil.
 *
 * `update` reçoit la progression lue sous verrou (zéro pour un exemplaire ordinaire) et
 * renvoie la suivante, ou `null` pour renoncer : c'est là que se placent les gardes contre
 * deux réussites simultanées payées une seule fois. Un exemplaire ordinaire qui gagne une
 * progression se détache de la pile ; un exemplaire qui la perd toute y retourne.
 *
 * Renvoie `false` quand `update` a renoncé et que rien n'a été écrit.
 */
export async function writeWornProgression(
  tx: Prisma.TransactionClient,
  rpgProfileId: string,
  itemId: string,
  update: (current: { upgrade: number; enchants: EnchantStack[] }) => { upgrade: number; enchants: EnchantStack[] } | null,
): Promise<boolean> {
  const worn = await tx.rpgItemInstance.findFirst({ where: { rpgProfileId, itemId, equipped: true } });
  const next = update(worn ? { upgrade: worn.upgrade, enchants: parseEnchants(worn.enchants) } : { upgrade: 0, enchants: [] });
  if (!next) return false;

  if (!worn) {
    if (isBlankProgression(next)) return true;
    await tx.rpgItemInstance.create({
      data: { rpgProfileId, itemId, upgrade: next.upgrade, enchants: next.enchants, equipped: true },
    });
    return true;
  }

  if (isBlankProgression(next)) {
    await tx.rpgItemInstance.delete({ where: { id: worn.id } });
  } else {
    await tx.rpgItemInstance.update({ where: { id: worn.id }, data: { upgrade: next.upgrade, enchants: next.enchants } });
  }
  return true;
}

/**
 * Exemplaires d'un objet, dans une transaction qui a verrouillé le profil : total, forgés,
 * ordinaires, et si l'exemplaire porté est un exemplaire forgé.
 */
export async function countCopies(tx: Prisma.TransactionClient, rpgProfileId: string, itemId: string) {
  const [stock, instances] = await Promise.all([
    tx.rpgInventoryItem.findUnique({
      where: { rpgProfileId_itemId: { rpgProfileId, itemId } },
      select: { quantity: true },
    }),
    tx.rpgItemInstance.findMany({ where: { rpgProfileId, itemId }, select: { equipped: true } }),
  ]);
  const quantity = Math.max(0, stock?.quantity ?? 0);
  const plain = Math.max(0, quantity - instances.length);
  return { quantity, instances: instances.length, plain, wornInstance: instances.some((instance) => instance.equipped) };
}
