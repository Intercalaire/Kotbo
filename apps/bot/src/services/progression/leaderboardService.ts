import {
  type Client,
  type TextChannel,
  AttachmentBuilder,
} from 'discord.js';
import prisma from '../../utils/db.js';
import { generateLeaderboardImage } from '../core/imageService.js';
import { COLORS_RAW, kotboContainer } from '../../utils/embeds.js';
import { E, rankEmoji, buildProgressBar } from '../../utils/emojis.js';
import { getXpForLevel, getLevelFromXp, getGuildLevelCurve } from './levelingService.js';
import { DEFAULT_LEVEL_CURVE, type LevelCurve } from '@kotbo/shared';
import { logger } from '../../utils/logger.js';
import { mediaGallery, separator, v2Message } from '@arcscord/components';

const MAX_MESSAGES_BEFORE_REPOST = 5;

async function buildLeaderboardData(guildId: string, type: string, periodDays: number) {
  let topMembers: { userId: string; score: number; level?: number }[] = [];
  const curve = await getGuildLevelCurve(guildId);

  if (type === 'xp') {
    const xpStats = await prisma.memberLevel.findMany({
      where: { guildId },
      orderBy: { xp: 'desc' },
      take: 10,
    });
    topMembers = xpStats.map((stat) => ({
      userId: stat.userId,
      score: stat.xp,
      level: getLevelFromXp(stat.xp, curve),
    }));
  } else {
    const now = new Date();
    const startDate = new Date();
    startDate.setDate(now.getDate() - periodDays);
    const startDateKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;

    const dailyStats = await prisma.memberDailyStat.groupBy({
      by: ['userId'],
      where: { guildId, dateKey: { gte: startDateKey } },
      _sum: { messagesCount: true, voiceMinutes: true },
    });

    const sorted = dailyStats.map((stat) => {
      let score = 0;
      if (type === 'messages') score = stat._sum.messagesCount ?? 0;
      else if (type === 'voice') score = stat._sum.voiceMinutes ?? 0;
      else score = (stat._sum.messagesCount ?? 0) + (stat._sum.voiceMinutes ?? 0) * 2;
      return { userId: stat.userId, score };
    }).sort((a, b) => b.score - a.score).slice(0, 10);

    const userIds = sorted.map(m => m.userId);
    const levels = await prisma.memberLevel.findMany({
      where: { guildId, userId: { in: userIds } },
      select: { userId: true, xp: true },
    });
    const levelMap = new Map(levels.map(l => [l.userId, getLevelFromXp(l.xp, curve)]));

    topMembers = sorted.map(m => ({
      ...m,
      level: levelMap.get(m.userId) ?? 0,
    }));
  }

  return topMembers;
}

async function isMessageBuried(channel: TextChannel, messageId: string): Promise<boolean> {
  try {
    const messages = await channel.messages.fetch({ limit: MAX_MESSAGES_BEFORE_REPOST + 1 });
    const ids = [...messages.keys()];
    const idx = ids.indexOf(messageId);
    return idx === -1 || idx >= MAX_MESSAGES_BEFORE_REPOST;
  } catch {
    return true;
  }
}

export async function refreshAllAutoLeaderboards(client: Client): Promise<void> {
  const configs = await prisma.autoLeaderboard.findMany({ where: { enabled: true } });

  for (const config of configs) {
    try {
      await refreshSingleLeaderboard(client, config);
    } catch (error) {
      logger.error('Leaderboard', `Erreur refresh auto-leaderboard ${config.id} (guild ${config.guildId}):`, error);
    }
  }
}

async function refreshSingleLeaderboard(
  client: Client,
  config: { id: string; guildId: string; channelId: string; messageId: string | null; type: string; style: string; periodDays: number },
): Promise<void> {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(config.channelId) as TextChannel | undefined;
  if (!channel || !channel.isTextBased()) return;

  const topMembers = await buildLeaderboardData(config.guildId, config.type, config.periodDays);
  if (topMembers.length === 0) return;

  const curve = await getGuildLevelCurve(config.guildId);

  const formattedTopMembers = await Promise.all(topMembers.map(async (m) => {
    let name = `Utilisateur ${m.userId}`;
    let avatarUrl: string | null = null;
    try {
      const member = await guild.members.fetch(m.userId).catch(() => null);
      if (member) {
        name = member.displayName;
        avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 64 });
      }
    } catch { /* ignore */ }
    return { name, score: m.score, avatarUrl, level: m.level };
  }));

  const type = config.type as 'messages' | 'voice' | 'mixed' | 'xp';
  const themeColor = type === 'messages' ? COLORS_RAW.primary : type === 'voice' ? COLORS_RAW.success : type === 'xp' ? COLORS_RAW.pink : COLORS_RAW.warning;
  const typeLabel = type === 'messages' ? 'Messages' : type === 'voice' ? 'Vocal' : type === 'xp' ? 'XP & Niveaux' : 'Activité Mixte';
  const subTitle = type === 'xp' ? "Classement global d'expérience" : `Les ${config.periodDays} derniers jours`;

  let shouldRepost = !config.messageId;

  if (config.messageId) {
    const buried = await isMessageBuried(channel, config.messageId);
    if (buried) {
      try {
        const oldMsg = await channel.messages.fetch(config.messageId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
      } catch { /* ignore */ }
      shouldRepost = true;
    }
  }

  if (shouldRepost) {
    const sent = await sendLeaderboardMessage(channel, formattedTopMembers, type, config.style, themeColor, typeLabel, subTitle, curve);
    await prisma.autoLeaderboard.update({ where: { id: config.id }, data: { messageId: sent.id } });
  } else {
    try {
      const existingMsg = await channel.messages.fetch(config.messageId!);
      await editLeaderboardMessage(existingMsg, formattedTopMembers, type, config.style, themeColor, typeLabel, subTitle, curve);
    } catch {
      const sent = await sendLeaderboardMessage(channel, formattedTopMembers, type, config.style, themeColor, typeLabel, subTitle, curve);
      await prisma.autoLeaderboard.update({ where: { id: config.id }, data: { messageId: sent.id } });
    }
  }
}

function buildTextContent(
  formattedTopMembers: { name: string; score: number; avatarUrl?: string | null; level?: number }[],
  type: 'messages' | 'voice' | 'mixed' | 'xp',
  _typeLabel: string,
  _subTitle: string,
  curve: LevelCurve = DEFAULT_LEVEL_CURVE,
) {
  let description = '';
  for (let i = 0; i < formattedTopMembers.length; i++) {
    const member = formattedTopMembers[i];
    const rank = i + 1;

    if (type === 'xp') {
      const userLevel = member.level ?? 0;
      const prevXpNeeded = getXpForLevel(userLevel - 1, curve);
      const nextXpNeeded = getXpForLevel(userLevel, curve);
      const xpInCurrentLevel = member.score - prevXpNeeded;
      const xpRequiredForNextLevel = nextXpNeeded - prevXpNeeded || 300;
      const percent = Math.min(100, Math.max(0, Math.round((xpInCurrentLevel / xpRequiredForNextLevel) * 100)));
      const bar = buildProgressBar(percent, 8);
      description += `\n${rankEmoji(rank)} **[Niv. ${userLevel}]** ${member.name}\n${bar} \`${percent}%\``;
    } else {
      const maxScore = formattedTopMembers[0].score || 1;
      const percent = Math.min(100, Math.max(0, Math.round((member.score / maxScore) * 100)));
      const bar = buildProgressBar(percent, 8);
      const scoreFmt = type === 'voice' ? `${Math.floor(member.score / 60)}h ${member.score % 60}m` : member.score.toLocaleString('fr-FR');
      description += `\n${rankEmoji(rank)} ${member.name}\n${bar} \`${scoreFmt}\``;
    }
  }
  return description;
}

async function sendLeaderboardMessage(
  channel: TextChannel,
  formattedTopMembers: { name: string; score: number; avatarUrl?: string | null; level?: number }[],
  type: 'messages' | 'voice' | 'mixed' | 'xp',
  style: string,
  themeColor: number,
  typeLabel: string,
  subTitle: string,
  curve: LevelCurve = DEFAULT_LEVEL_CURVE,
) {
  if (style === 'embed') {
    const description = buildTextContent(formattedTopMembers, type, typeLabel, subTitle, curve);

    return channel.send(v2Message(
      kotboContainer({
        color: themeColor,
        title: `${E.trophy} Top 10 - ${typeLabel}`,
        fields: [
          `-# ${subTitle}`,
          separator({ divider: true, spacing: 'small' }),
          description,
        ],
        footerOverwrite: `-# Kotbo Analytics · Mis à jour <t:${Math.floor(Date.now() / 1000)}:R>`,
      }),
    ));
  } else {
    const imageBuffer = await generateLeaderboardImage(formattedTopMembers, type, formattedTopMembers.length > 0 ? 30 : 30);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'leaderboard.png' });

    return channel.send({
      ...v2Message(
        kotboContainer({
          color: themeColor,
          fields: [
            mediaGallery({ items: [{ media: { url: 'attachment://leaderboard.png' } }] }),
            `-# Kotbo Analytics · Mis à jour <t:${Math.floor(Date.now() / 1000)}:R>`,
          ],
        }),
      ),
      files: [attachment],
    });
  }
}

async function editLeaderboardMessage(
  message: import('discord.js').Message,
  formattedTopMembers: { name: string; score: number; avatarUrl?: string | null; level?: number }[],
  type: 'messages' | 'voice' | 'mixed' | 'xp',
  style: string,
  themeColor: number,
  typeLabel: string,
  subTitle: string,
  curve: LevelCurve = DEFAULT_LEVEL_CURVE,
) {
  if (style === 'embed') {
    const description = buildTextContent(formattedTopMembers, type, typeLabel, subTitle, curve);

    await message.edit(v2Message(
      kotboContainer({
        color: themeColor,
        title: `${E.trophy} Top 10 - ${typeLabel}`,
        fields: [
          `-# ${subTitle}`,
          separator({ divider: true, spacing: 'small' }),
          description,
        ],
        footerOverwrite: `-# Kotbo Analytics · Mis à jour <t:${Math.floor(Date.now() / 1000)}:R>`,
      }),
    ));
  } else {
    const imageBuffer = await generateLeaderboardImage(formattedTopMembers, type, 30);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'leaderboard.png' });

    await message.edit({
      ...v2Message(
        kotboContainer({
          color: themeColor,
          fields: [
            mediaGallery({ items: [{ media: { url: 'attachment://leaderboard.png' } }] }),
            `-# Kotbo Analytics · Mis à jour <t:${Math.floor(Date.now() / 1000)}:R>`,
          ],
        }),
      ),
      files: [attachment],
    });
  }
}
