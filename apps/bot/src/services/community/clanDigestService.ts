/**
 * Bilan hebdomadaire d'un clan, publié dans son QG.
 *
 * Le salon de QG ne recevait rien du bot entre deux saisons - donc pendant des mois - alors
 * que le journal des contributions a de quoi raconter chaque semaine : qui a porté le clan,
 * d'où viennent les points, et si la place au classement a bougé.
 *
 * C'est un salon de discussion, pas un tableau de bord. Le bilan y est donc publié une fois
 * par semaine et jamais réécrit : un message qui se met à jour se perdrait dans la
 * conversation, et republier après un redémarrage y laisserait deux rapports à la suite.
 */

import { EmbedBuilder, type Client, type Guild as DiscordGuild } from 'discord.js';
import { formatWallClockInTimezone } from '@kotbo/contracts';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { resolveGuildTimezone } from '../../utils/timezone.js';
import { joinFieldEntries } from '../../utils/embeds.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Le bilan porte sur les sept derniers jours, et paraît le lundi matin. */
const DIGEST_WEEKDAY = 1;
const DIGEST_HOUR = 10;
const TOP_CONTRIBUTORS = 5;

/** Gains attribués au clan entier plutôt qu'à quelqu'un : ils faussent un palmarès. */
const CLAN_WIDE_AUTHOR = 'system_manual_points';

const SOURCE_LABELS: Record<string, string> = {
  XP: 'Progression',
  ADMIN: 'Attribué par le staff',
  DROP: 'Drops',
  RPG: 'RPG',
};

interface WeekPosition {
  /** Lundi de la semaine en cours, sur le fuseau du serveur. Sert de clé de publication. */
  weekKey: string;
  /** Vrai tant que l'heure de parution n'est pas passée. */
  tooEarly: boolean;
}

/**
 * Où l'on se situe dans la semaine locale du serveur.
 *
 * La clé est la date du lundi plutôt qu'un numéro de semaine ISO : elle est aussi unique,
 * se lit sans conversion, et sert telle quelle de repère dans le message.
 */
function weekPosition(timezone: string, now: Date): WeekPosition {
  const [datePart, timePart] = formatWallClockInTimezone(now, timezone).split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const hour = Number.parseInt(timePart.slice(0, 2), 10) || 0;

  const today = new Date(Date.UTC(year, month - 1, day));
  // `getUTCDay` place dimanche en tête ; la semaine du bilan commence un lundi.
  const weekday = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
  const monday = new Date(today.getTime() - (weekday - 1) * MS_PER_DAY);

  return {
    weekKey: monday.toISOString().slice(0, 10),
    tooEarly: weekday === DIGEST_WEEKDAY && hour < DIGEST_HOUR,
  };
}

export interface ClanWeekStats {
  clanId: string;
  points: number;
  contributors: Array<{ userId: string; points: number }>;
  bySource: Array<{ source: string; points: number }>;
  rank: number;
  previousRank: number;
}

/**
 * Ce que chaque clan a gagné sur la période, et la place que ça lui vaut.
 *
 * Le rang d'avant se déduit du total de saison moins les points de la semaine, sans
 * instantané à conserver : la comparaison porte sur le même journal pour tous les clans,
 * donc l'ordre reste juste même si le journal et l'agrégat divergeaient d'un point.
 */
export async function computeClanWeekStats(
  guildId: string,
  season: number,
  clanIds: string[],
  since: Date,
): Promise<Map<string, ClanWeekStats>> {
  const [weekEvents, seasonTotals] = await Promise.all([
    prisma.clanContributionEvent.findMany({
      where: { guildId, season, clanId: { in: clanIds }, createdAt: { gte: since } },
      select: { clanId: true, userId: true, amount: true, source: true },
    }),
    prisma.clanMemberContribution.groupBy({
      by: ['clanId'],
      where: { guildId, season, clanId: { in: clanIds } },
      _sum: { xp: true },
    }),
  ]);

  const totals = new Map(clanIds.map((id) => [id, 0]));
  for (const row of seasonTotals) totals.set(row.clanId, row._sum.xp ?? 0);

  const weekPoints = new Map(clanIds.map((id) => [id, 0]));
  const contributors = new Map<string, Map<string, number>>();
  const sources = new Map<string, Map<string, number>>();

  for (const event of weekEvents) {
    weekPoints.set(event.clanId, (weekPoints.get(event.clanId) ?? 0) + event.amount);

    if (event.userId !== CLAN_WIDE_AUTHOR) {
      const byUser = contributors.get(event.clanId) ?? new Map<string, number>();
      byUser.set(event.userId, (byUser.get(event.userId) ?? 0) + event.amount);
      contributors.set(event.clanId, byUser);
    }

    const bySource = sources.get(event.clanId) ?? new Map<string, number>();
    bySource.set(event.source, (bySource.get(event.source) ?? 0) + event.amount);
    sources.set(event.clanId, bySource);
  }

  const rankOf = (score: (clanId: string) => number) => {
    const order = [...clanIds].sort((a, b) => score(b) - score(a));
    return new Map(order.map((clanId, index) => [clanId, index + 1]));
  };

  const ranks = rankOf((clanId) => totals.get(clanId) ?? 0);
  const previousRanks = rankOf((clanId) => (totals.get(clanId) ?? 0) - (weekPoints.get(clanId) ?? 0));

  const stats = new Map<string, ClanWeekStats>();
  for (const clanId of clanIds) {
    stats.set(clanId, {
      clanId,
      points: weekPoints.get(clanId) ?? 0,
      contributors: [...(contributors.get(clanId) ?? new Map())]
        .map(([userId, points]) => ({ userId, points }))
        .filter((entry) => entry.points > 0)
        .sort((a, b) => b.points - a.points)
        .slice(0, TOP_CONTRIBUTORS),
      bySource: [...(sources.get(clanId) ?? new Map())]
        .map(([source, points]) => ({ source, points }))
        .filter((entry) => entry.points !== 0)
        .sort((a, b) => b.points - a.points),
      rank: ranks.get(clanId) ?? clanIds.length,
      previousRank: previousRanks.get(clanId) ?? clanIds.length,
    });
  }

  return stats;
}

/** Flèche de progression au classement, ou rien quand la place n'a pas bougé. */
function rankMove(stats: ClanWeekStats): string {
  const gained = stats.previousRank - stats.rank;
  if (gained === 0) return '';
  return gained > 0 ? ` (▲ ${gained})` : ` (▼ ${Math.abs(gained)})`;
}

function buildDigestEmbed(clanName: string, stats: ClanWeekStats, weekKey: string, total: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Bilan de la semaine - ${clanName}`)
    .setDescription(`Semaine du ${weekKey} · **${stats.points.toLocaleString('fr-FR')}** points marqués`)
    .setColor(0x6366F1)
    .addFields({
      name: 'Classement',
      value: `**${stats.rank}${stats.rank === 1 ? 'er' : 'e'}** sur ${total}${rankMove(stats)}`,
      inline: true,
    })
    .setTimestamp();

  if (stats.contributors.length > 0) {
    embed.addFields({
      name: 'Ils ont porté le clan',
      value: joinFieldEntries(
        stats.contributors.map((entry, index) => `**${index + 1}.** <@${entry.userId}> · ${entry.points.toLocaleString('fr-FR')}`),
        { more: (count) => `… et ${count} autres` },
      ),
    });
  }

  if (stats.bySource.length > 0) {
    embed.addFields({
      name: 'D\'où viennent les points',
      value: stats.bySource
        .map((entry) => `${SOURCE_LABELS[entry.source] ?? entry.source} · ${entry.points.toLocaleString('fr-FR')}`)
        .join('\n'),
    });
  }

  return embed;
}

/**
 * Publie le bilan d'un clan, et rend faux si le QG n'a rien reçu.
 *
 * Le marquage précède l'envoi : au pire le bilan d'une semaine manque, jamais deux ne se
 * suivent dans la conversation après une reprise du cycle.
 */
async function publishClanDigest(
  discordGuild: DiscordGuild,
  clan: { id: string; guildId: string; name: string; generalChannelId: string | null },
  stats: ClanWeekStats,
  weekKey: string,
  total: number,
): Promise<boolean> {
  if (!clan.generalChannelId) return false;

  try {
    await prisma.clanWeeklyDigest.create({
      data: { guildId: clan.guildId, clanId: clan.id, weekKey },
    });
  } catch {
    // Unicité `clanId + weekKey` : le bilan est déjà parti cette semaine.
    return false;
  }

  const channel = discordGuild.channels.cache.get(clan.generalChannelId)
    ?? await discordGuild.channels.fetch(clan.generalChannelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    logger.warn('ClanDigest', `QG injoignable pour le clan ${clan.name} (${clan.guildId}).`);
    return false;
  }

  // Aucune mention : le bilan arrive au milieu d'une conversation, il s'y ajoute sans
  // interrompre personne.
  await channel.send({
    embeds: [buildDigestEmbed(clan.name, stats, weekKey, total)],
    allowedMentions: { parse: [] },
  });

  return true;
}

async function publishGuildDigest(client: Client, guildId: string, season: number): Promise<void> {
  const timezone = await resolveGuildTimezone(guildId);
  const { weekKey, tooEarly } = weekPosition(timezone, new Date());
  if (tooEarly) return;

  const clans = await prisma.clan.findMany({
    where: { guildId },
    select: { id: true, guildId: true, name: true, generalChannelId: true },
    orderBy: { name: 'asc' },
  });
  if (clans.length === 0) return;

  // Rien à publier si la semaine est déjà couverte partout : on s'arrête avant de compter.
  const already = await prisma.clanWeeklyDigest.count({ where: { guildId, weekKey } });
  if (already >= clans.filter((clan) => clan.generalChannelId).length) return;

  const discordGuild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!discordGuild) return;

  const stats = await computeClanWeekStats(guildId, season, clans.map((clan) => clan.id), new Date(Date.now() - 7 * MS_PER_DAY));

  for (const clan of clans) {
    const clanStats = stats.get(clan.id);
    if (!clanStats) continue;

    await publishClanDigest(discordGuild, clan, clanStats, weekKey, clans.length)
      .catch((error: unknown) => {
        logger.error('ClanDigest', `Bilan non publié pour le clan ${clan.name}:`, error);
        return false;
      });
  }
}

/**
 * Publie le bilan de la semaine sur tous les serveurs qui l'ont activé.
 *
 * Le cycle tourne toutes les heures et non une fois par semaine : un serveur dont le bot
 * dormait le lundi matin recevrait sinon un bilan de moins, et l'heure de parution suit le
 * fuseau de chaque serveur plutôt qu'un lundi commun en UTC.
 */
export async function runClanWeeklyDigests(client: Client): Promise<void> {
  const guilds = await prisma.guild.findMany({
    where: { clansEnabled: true, clanWeeklyDigest: true },
    select: { id: true, currentClanSeason: true },
  });

  for (const guild of guilds) {
    try {
      await publishGuildDigest(client, guild.id, guild.currentClanSeason);
    } catch (error) {
      logger.error('ClanDigest', `Bilan hebdomadaire en échec pour ${guild.id}:`, error);
    }
  }
}
