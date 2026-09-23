/**
 * Premier vainqueur d'une créature sur un serveur.
 *
 * Le record s'écrit pour toute créature, prime ou non : c'est lui qui dit, dans le bestiaire
 * et au dashboard, qui a ouvert la voie. La prime et l'annonce n'en sont que des options.
 */

import { EmbedBuilder, type Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { COLORS } from '../../../utils/embeds.js';
import { resolveGuildLocale, type BotLocale } from '../../../utils/i18n.js';
import * as m from '../../../lib/paraglide/messages.js';
import { checkLevelUp, getOrCreateEconomyConfig } from '../economyService.js';
import { hasFirstKillReward, shouldAnnounceFirstKill } from './rpgBestiaryPolicy.js';

export type FirstKillMonster = {
  name: string;
  emoji: string;
  isBoss: boolean;
  firstKillCoinReward: number;
  firstKillXpReward: number;
  firstKillItemName: string | null;
};

export type FirstKillResult = {
  coins: number;
  xp: number;
  itemName: string | null;
  itemEmoji: string | null;
};

export type FirstKillRecord = { userId: string; createdAt: Date };

/**
 * Inscrit le joueur comme premier vainqueur et lui verse la prime.
 *
 * Renvoie `null` si quelqu'un l'a devancé. L'unicité (serveur, nom) tranche entre deux
 * victoires simultanées : seule la première insertion passe, et donc seule elle paie.
 */
export async function claimFirstKill(
  client: Client,
  guildId: string,
  userId: string,
  monster: FirstKillMonster,
): Promise<FirstKillResult | null> {
  try {
    await prisma.rpgMonsterFirstKill.create({ data: { guildId, monsterName: monster.name, userId } });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return null;
    throw err;
  }

  const result: FirstKillResult = { coins: 0, xp: 0, itemName: null, itemEmoji: null };

  if (hasFirstKillReward(monster)) {
    const profile = await prisma.rpgProfile.update({
      where: { guildId_userId: { guildId, userId } },
      data: {
        balance: { increment: monster.firstKillCoinReward },
        xp: { increment: monster.firstKillXpReward },
      },
      select: { id: true },
    });
    result.coins = monster.firstKillCoinReward;
    result.xp = monster.firstKillXpReward;

    if (monster.firstKillItemName) {
      // L'objet du serveur l'emporte sur le livré du même nom, comme pour les butins.
      const items = await prisma.rpgItem.findMany({
        where: { name: monster.firstKillItemName, OR: [{ guildId: null }, { guildId }] },
        select: { id: true, emoji: true, guildId: true },
      });
      const item = items.find((candidate) => candidate.guildId !== null) ?? items[0];
      if (item) {
        await prisma.rpgInventoryItem.upsert({
          where: { rpgProfileId_itemId: { rpgProfileId: profile.id, itemId: item.id } },
          update: { quantity: { increment: 1 } },
          create: { rpgProfileId: profile.id, itemId: item.id, quantity: 1 },
        });
        result.itemName = monster.firstKillItemName;
        result.itemEmoji = item.emoji;
      }
    }

    if (result.xp > 0) await checkLevelUp(guildId, userId);
  }

  await announceFirstKill(client, guildId, userId, monster, result).catch((err) => {
    logger.error('RpgFirstKill', `Annonce du premier vainqueur impossible pour ${guildId}:`, err);
  });

  return result;
}

async function announceFirstKill(
  client: Client,
  guildId: string,
  userId: string,
  monster: FirstKillMonster,
  result: FirstKillResult,
): Promise<void> {
  const config = await getOrCreateEconomyConfig(guildId);
  if (!config.firstKillChannelId || !shouldAnnounceFirstKill(config.firstKillAnnounce, monster.isBoss)) return;

  const channel = await client.channels.fetch(config.firstKillChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    logger.warn('RpgFirstKill', `Salon d'annonce du premier vainqueur injoignable pour ${guildId}.`);
    return;
  }

  const locale: BotLocale = await resolveGuildLocale(guildId);
  const embed = new EmbedBuilder()
    .setTitle(m.rpg_first_kill_announce_title({}, { locale }))
    .setDescription(m.rpg_first_kill_announce_desc({ user: `<@${userId}>`, monster: `${monster.emoji} ${monster.name}` }, { locale }))
    .setColor(COLORS.warning);

  const reward = formatFirstKillReward(result, config.currencyEmoji);
  if (reward) embed.addFields({ name: m.rpg_first_kill_field_reward({}, { locale }), value: reward });

  // Le vainqueur est nommé, pas notifié : une annonce ne doit sonner chez personne.
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

/** Prime lisible, ou chaîne vide s'il n'y en avait pas. */
export function formatFirstKillReward(
  reward: { coins: number; xp: number; itemName: string | null; itemEmoji?: string | null },
  currencyEmoji: string,
): string {
  return [
    reward.coins > 0 ? `${currencyEmoji} +${reward.coins}` : null,
    reward.xp > 0 ? `+${reward.xp} XP` : null,
    reward.itemName ? `${reward.itemEmoji || '📦'} ${reward.itemName}` : null,
  ].filter((part): part is string => part !== null).join('  ·  ');
}

export async function getFirstKill(guildId: string, monsterName: string): Promise<FirstKillRecord | null> {
  return prisma.rpgMonsterFirstKill.findUnique({
    where: { guildId_monsterName: { guildId, monsterName } },
    select: { userId: true, createdAt: true },
  });
}

/** Premiers vainqueurs du serveur, par nom de créature. */
export async function listFirstKills(guildId: string): Promise<Map<string, FirstKillRecord>> {
  const rows = await prisma.rpgMonsterFirstKill.findMany({
    where: { guildId },
    select: { monsterName: true, userId: true, createdAt: true },
  });
  return new Map(rows.map((row) => [row.monsterName, { userId: row.userId, createdAt: row.createdAt }]));
}
