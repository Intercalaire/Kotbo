/**
 * Récompenses du carnet de pêche : une par rareté terminée, et une pour le carnet complet.
 *
 * Le versement se fait à la prise qui termine le palier, mais aussi à l'ouverture du carnet :
 * un joueur qui avait déjà tout pêché avant l'arrivée des récompenses les touche sans avoir
 * à relancer sa ligne, et un palier ajouté plus tard par le serveur se rattrape de même.
 */

import type { Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { checkLevelUp, getFishBook } from '../economyService.js';
import { firstKillRoleProblem } from './rpgFirstKillService.js';
import {
  DEFAULT_FISH_BOOK_REWARDS,
  FISH_BOOK_TIERS,
  fishBookProgress,
  hasFishBookReward,
  normalizeFishBookReward,
  type FishBook,
  type FishBookReward,
  type FishBookRewardInput,
  type FishBookTier,
} from './rpgFishBook.js';
import { awardRpgTeamPoints } from './rpgTeamRewards.js';
import { assertGuildTitle, grantTitle } from './rpgTitleService.js';

export type FishBookRewardView = FishBookReward & {
  tier: FishBookTier;
  /** Faux tant que le serveur n'a rien réglé : c'est la récompense par défaut qui vaut. */
  custom: boolean;
  titleName: string | null;
};

export type FishBookPayout = {
  tier: FishBookTier;
  coins: number;
  xp: number;
  /** Points réellement versés : zéro si le joueur n'a ni clan ni guilde. */
  teamPoints: number;
  toGuild: boolean;
  itemName: string | null;
  itemEmoji: string | null;
  roleId: string | null;
  titleName: string | null;
};

export async function getFishBookRewards(guildId: string): Promise<FishBookRewardView[]> {
  const rows = await prisma.rpgFishBookReward.findMany({
    where: { guildId },
    include: { title: { select: { name: true } } },
  });
  const byTier = new Map(rows.map((row) => [row.tier, row]));

  return FISH_BOOK_TIERS.map((tier) => {
    const row = byTier.get(tier);
    if (!row) return { tier, ...DEFAULT_FISH_BOOK_REWARDS[tier], custom: false, titleName: null };
    return {
      tier,
      coinReward: row.coinReward,
      xpReward: row.xpReward,
      clanPoints: row.clanPoints,
      itemName: row.itemName,
      roleId: row.roleId,
      titleId: row.titleId,
      custom: true,
      titleName: row.title?.name ?? null,
    };
  });
}

async function findRewardItem(guildId: string, name: string) {
  // L'objet du serveur l'emporte sur le livré du même nom, comme pour les butins.
  const items = await prisma.rpgItem.findMany({
    where: { name, OR: [{ guildId: null }, { guildId }] },
    select: { id: true, emoji: true, guildId: true },
  });
  return items.find((candidate) => candidate.guildId !== null) ?? items[0] ?? null;
}

export async function saveFishBookReward(
  client: Client | null,
  guildId: string,
  tier: FishBookTier,
  input: FishBookRewardInput,
): Promise<FishBookReward> {
  const reward = normalizeFishBookReward(input);

  if (reward.itemName && !(await findRewardItem(guildId, reward.itemName))) {
    throw new Error(`L'objet « ${reward.itemName} » n'existe pas dans le catalogue.`);
  }
  await assertGuildTitle(guildId, reward.titleId);
  if (reward.roleId) {
    const guild = client ? client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null) : null;
    if (!guild) throw new Error('Serveur introuvable.');
    const role = guild.roles.cache.get(reward.roleId) ?? await guild.roles.fetch(reward.roleId).catch(() => null);
    const problem = firstKillRoleProblem(guild, role);
    if (problem) throw new Error(problem);
  }

  await prisma.rpgFishBookReward.upsert({
    where: { guildId_tier: { guildId, tier } },
    create: { guildId, tier, ...reward },
    update: reward,
  });
  return reward;
}

/** Rend au palier sa récompense par défaut. */
export async function resetFishBookReward(guildId: string, tier: FishBookTier): Promise<void> {
  await prisma.rpgFishBookReward.deleteMany({ where: { guildId, tier } });
}

export async function listFishBookClaims(guildId: string, userId: string): Promise<Set<FishBookTier>> {
  const rows = await prisma.rpgFishBookClaim.findMany({ where: { guildId, userId }, select: { tier: true } });
  return new Set(rows.map((row) => row.tier as FishBookTier));
}

async function grantRole(client: Client, guildId: string, userId: string, roleId: string, tier: FishBookTier): Promise<string | null> {
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;

  // Le contrôle est refait au versement : le rôle a pu changer depuis son réglage.
  const role = guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null);
  const problem = firstKillRoleProblem(guild, role);
  if (problem || !role) {
    logger.warn('RpgFishBook', `Rôle ${roleId} non offert pour le palier ${tier} sur ${guildId} : ${problem}`);
    return null;
  }
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return null;
  await member.roles.add(role, `Carnet de pêche : palier ${tier}`);
  return role.id;
}

/**
 * Verse chaque palier terminé que le joueur n'a pas encore touché.
 *
 * Renvoie les paliers versés par cet appel, et le carnet lu pour en décider, que l'écran
 * du carnet réutilise plutôt que de le relire.
 */
export async function claimFishBookRewards(
  client: Client,
  guildId: string,
  userId: string,
): Promise<{ book: FishBook; payouts: FishBookPayout[] }> {
  const [book, claimed] = await Promise.all([getFishBook(guildId, userId), listFishBookClaims(guildId, userId)]);
  const pending = fishBookProgress(book).filter((progress) => progress.complete && !claimed.has(progress.tier));
  if (pending.length === 0) return { book, payouts: [] };

  const rewards = new Map((await getFishBookRewards(guildId)).map((reward) => [reward.tier, reward]));
  const payouts: FishBookPayout[] = [];

  for (const { tier } of pending) {
    const reward = rewards.get(tier) ?? { ...DEFAULT_FISH_BOOK_REWARDS[tier], titleName: null };
    const item = reward.itemName ? await findRewardItem(guildId, reward.itemName) : null;

    // Le palier et sa part en base s'écrivent ensemble ; l'unicité (serveur, joueur, palier)
    // arbitre deux ouvertures simultanées du carnet : seule la première paie.
    const paid = await prisma.$transaction(async (tx) => {
      const inserted = await tx.rpgFishBookClaim.createMany({
        data: [{ guildId, userId, tier }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return false;
      if (!hasFishBookReward(reward)) return true;

      const profile = await tx.rpgProfile.update({
        where: { guildId_userId: { guildId, userId } },
        data: { balance: { increment: reward.coinReward }, xp: { increment: reward.xpReward } },
        select: { id: true },
      });
      if (item) {
        await tx.rpgInventoryItem.upsert({
          where: { rpgProfileId_itemId: { rpgProfileId: profile.id, itemId: item.id } },
          update: { quantity: { increment: 1 } },
          create: { rpgProfileId: profile.id, itemId: item.id, quantity: 1 },
        });
      }
      return true;
    });
    if (!paid) continue;

    const payout: FishBookPayout = {
      tier,
      coins: reward.coinReward,
      xp: reward.xpReward,
      teamPoints: 0,
      toGuild: false,
      itemName: item ? reward.itemName : null,
      itemEmoji: item?.emoji ?? null,
      roleId: null,
      titleName: null,
    };

    // Le palier est inscrit : chaque versement qui suit est isolé, pour qu'un incident sur
    // l'un ne prive pas le joueur des autres, qu'il ne pourra plus réclamer.
    const settle = <T>(step: string, run: () => Promise<T>): Promise<T | null> => run().catch((err) => {
      logger.warn('RpgFishBook', `${step} du palier ${tier} en échec pour ${userId} sur ${guildId} :`, err);
      return null;
    });

    if (reward.clanPoints > 0) {
      const team = await settle('Points de clan', () => awardRpgTeamPoints({
        client,
        guildId,
        userId,
        amount: reward.clanPoints,
        source: 'RPG_FISHBOOK',
        reason: `Carnet de pêche : ${tier}`,
      }));
      payout.teamPoints = team?.amount ?? 0;
      payout.toGuild = team?.toGuild ?? false;
    }

    const titleId = reward.titleId;
    if (titleId) {
      const title = await settle('Titre', async () => {
        const profile = await prisma.rpgProfile.findUnique({ where: { guildId_userId: { guildId, userId } }, select: { id: true } });
        return profile ? grantTitle(profile.id, titleId) : null;
      });
      payout.titleName = title?.name ?? null;
    }
    const roleId = reward.roleId;
    if (roleId) payout.roleId = await settle('Rôle', () => grantRole(client, guildId, userId, roleId, tier));

    payouts.push(payout);
  }

  if (payouts.some((payout) => payout.xp > 0)) {
    await checkLevelUp(guildId, userId).catch((err) => {
      logger.warn('RpgFishBook', `Passage de niveau après le carnet en échec pour ${userId} :`, err);
    });
  }

  return { book, payouts };
}
