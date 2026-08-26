/**
 * Affichage Discord du raid : annonce, barre de progression et bilan.
 *
 * Le message d'annonce est réécrit par le cycle, une fois par minute, et non à chaque
 * assaut : une équipe de vingt personnes qui frappent ensemble produirait autant d'éditions
 * en quelques secondes, et Discord finirait par les refuser. Une minute de retard sur une
 * barre de progression ne se voit pas ; un message figé par une limite de débit, si.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
} from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { COLORS } from '../../../utils/embeds.js';
import { resolveGuildLocale, type BotLocale } from '../../../utils/i18n.js';
import * as m from '../../../lib/paraglide/messages.js';
import { getOrCreateEconomyConfig } from '../economyService.js';
import type { RaidAttackOutcome } from './rpgRaidService.js';

export const RAID_ATTACK_BUTTON = 'rpg_raid_attack';

const BAR_WIDTH = 14;

/** Ce que l'affichage a besoin de savoir d'une équipe engagée. */
export type RpgRaidTeamLike = {
  teamName: string;
  remainingHealth: number;
  totalHealth: number;
};

type RaidLike = {
  id: string;
  guildId: string;
  bossName: string;
  bossEmoji: string;
  bossLevel: number;
  closesAt: Date;
  assaultsPerMember: number;
  energyCost: number;
  announceChannelId: string | null;
  announceMessageId: string | null;
};

/** Barre de progression en caractères pleins : lisible partout, sans emoji à charger. */
export function healthBar(remaining: number, total: number): string {
  const share = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const filled = Math.round(share * BAR_WIDTH);
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}`;
}

export function buildRaidEmbed(raid: RaidLike, teams: RpgRaidTeamLike[], locale: BotLocale): EmbedBuilder {
  const closesUnix = Math.floor(raid.closesAt.getTime() / 1000);

  const lines = teams.map((team) => {
    if (team.remainingHealth <= 0) {
      return m.rpg_raid_team_defeated({ name: team.teamName }, { locale });
    }
    return m.rpg_raid_team_line({
      name: team.teamName,
      bar: healthBar(team.remainingHealth, team.totalHealth),
      remaining: team.remainingHealth.toLocaleString('fr-FR'),
      total: team.totalHealth.toLocaleString('fr-FR'),
    }, { locale });
  });

  return new EmbedBuilder()
    .setTitle(m.rpg_raid_announce_title({}, { locale }))
    .setDescription(m.rpg_raid_announce_desc({
      emoji: raid.bossEmoji,
      boss: raid.bossName,
      level: raid.bossLevel,
      closes: `<t:${closesUnix}:R>`,
    }, { locale }))
    .addFields(
      {
        name: m.rpg_raid_field_teams({}, { locale }),
        value: lines.length > 0 ? lines.join('\n') : m.rpg_raid_no_teams({}, { locale }),
      },
      {
        name: m.rpg_raid_field_rules({}, { locale }),
        value: m.rpg_raid_rules({ assaults: raid.assaultsPerMember, energy: raid.energyCost }, { locale }),
      },
    )
    .setColor(COLORS.danger);
}

function attackRow(locale: BotLocale): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(RAID_ATTACK_BUTTON)
      .setLabel(m.rpg_raid_button_attack({}, { locale }))
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Publie l'annonce d'ouverture.
 *
 * Le marquage précède l'envoi : au pire l'annonce est perdue, jamais republiée à chaque
 * minute si l'envoi échoue en boucle.
 */
export async function announceOpenRaid(client: Client, raid: RaidLike, announce: string, roleId: string | null): Promise<void> {
  if (announce === 'NONE' || !raid.announceChannelId) return;

  const marked = await prisma.rpgRaid.updateMany({
    where: { id: raid.id, announcedAt: null },
    data: { announcedAt: new Date() },
  });
  if (marked.count === 0) return;

  const channel = await client.channels.fetch(raid.announceChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    logger.warn('RpgRaid', `Salon d'annonce injoignable pour ${raid.guildId}.`);
    return;
  }

  const locale: BotLocale = await resolveGuildLocale(raid.guildId);
  const mention = announce === 'CHANNEL_ROLE' && roleId ? `<@&${roleId}>` : undefined;

  const message = await channel.send({
    content: mention,
    embeds: [buildRaidEmbed(raid, [], locale)],
    components: [attackRow(locale)],
    allowedMentions: mention && roleId ? { roles: [roleId] } : { parse: [] },
  }).catch((error: unknown) => {
    logger.error('RpgRaid', `Annonce impossible pour ${raid.guildId}:`, error);
    return null;
  });

  if (message) {
    await prisma.rpgRaid.update({ where: { id: raid.id }, data: { announceMessageId: message.id } });
  }
}

/** Réécrit le message d'annonce avec l'avancement des équipes. */
export async function refreshRaidMessage(client: Client, raid: RaidLike, teams: RpgRaidTeamLike[]): Promise<void> {
  if (!raid.announceChannelId || !raid.announceMessageId) return;

  const channel = await client.channels.fetch(raid.announceChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(raid.announceMessageId).catch(() => null);
  if (!message) return;

  const locale: BotLocale = await resolveGuildLocale(raid.guildId);
  await message.edit({
    embeds: [buildRaidEmbed(raid, teams, locale)],
    components: [attackRow(locale)],
  }).catch((error: unknown) => {
    logger.error('RpgRaid', `Rafraîchissement impossible pour ${raid.guildId}:`, error);
  });
}

/** Publie le bilan de fin et retire le bouton, le raid n'acceptant plus d'assaut. */
export async function publishRaidSummary(client: Client, raid: RaidLike, teams: RpgRaidTeamLike[]): Promise<void> {
  if (!raid.announceChannelId) return;

  const channel = await client.channels.fetch(raid.announceChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) return;

  const locale: BotLocale = await resolveGuildLocale(raid.guildId);
  const winners = teams.filter((team) => team.remainingHealth <= 0);

  const embed = new EmbedBuilder()
    .setTitle(m.rpg_raid_closed_title({ emoji: raid.bossEmoji, boss: raid.bossName }, { locale }))
    .setDescription(winners.length > 0
      ? m.rpg_raid_closed_winners({ teams: winners.map((team) => team.teamName).join(', ') }, { locale })
      : m.rpg_raid_closed_survivor({ emoji: raid.bossEmoji, boss: raid.bossName }, { locale }))
    .setColor(winners.length > 0 ? COLORS.success : COLORS.dark);

  if (teams.length > 0) {
    embed.addFields({
      name: m.rpg_raid_field_teams({}, { locale }),
      value: teams
        .map((team) => team.remainingHealth <= 0
          ? m.rpg_raid_team_defeated({ name: team.teamName }, { locale })
          : m.rpg_raid_team_line({
            name: team.teamName,
            bar: healthBar(team.remainingHealth, team.totalHealth),
            remaining: team.remainingHealth.toLocaleString('fr-FR'),
            total: team.totalHealth.toLocaleString('fr-FR'),
          }, { locale }))
        .join('\n'),
    });
  }

  if (raid.announceMessageId) {
    const previous = await channel.messages.fetch(raid.announceMessageId).catch(() => null);
    await previous?.edit({ components: [] }).catch(() => null);
  }

  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((error: unknown) => {
    logger.error('RpgRaid', `Bilan impossible pour ${raid.guildId}:`, error);
  });
}

/**
 * Compte rendu d'un assaut, montré au seul joueur qui vient de frapper.
 *
 * Seuls les derniers échanges sont repris : un assaut peut durer trente tours, dont la
 * lecture intégrale n'apprend rien de plus que les six derniers et la réserve qui reste.
 */
export async function buildAssaultEmbed(guildId: string, outcome: RaidAttackOutcome): Promise<EmbedBuilder> {
  const locale: BotLocale = await resolveGuildLocale(guildId);
  const config = await getOrCreateEconomyConfig(guildId);
  const raid = outcome.raid;
  const team = outcome.team;

  const turns = outcome.result.turns.slice(-6).map((turn) => {
    if (turn.attacker === 'player') {
      return turn.damage === 0
        ? m.rpg_raid_turn_stunned({}, { locale })
        : m.rpg_raid_turn_player({ dmg: turn.damage }, { locale });
    }
    return turn.spellName
      ? m.rpg_raid_turn_spell({ emoji: turn.spellEmoji ?? '✨', spell: turn.spellName, dmg: turn.damage }, { locale })
      : m.rpg_raid_turn_boss({ dmg: turn.damage }, { locale });
  });

  const embed = new EmbedBuilder()
    .setTitle(m.rpg_raid_assault_title({ emoji: raid?.bossEmoji ?? '🐲', boss: raid?.bossName ?? '' }, { locale }))
    .setDescription([
      m.rpg_raid_assault_damage({ damage: outcome.result.damageDealt.toLocaleString('fr-FR') }, { locale }),
      m.rpg_raid_assault_progress({
        team: team.name,
        bar: healthBar(team.remainingHealth, team.totalHealth),
        remaining: team.remainingHealth.toLocaleString('fr-FR'),
        total: team.totalHealth.toLocaleString('fr-FR'),
      }, { locale }),
      outcome.result.survived ? '' : m.rpg_raid_assault_ko({}, { locale }),
    ].filter(Boolean).join('\n'))
    .setColor(outcome.killingBlow ? COLORS.success : COLORS.danger);

  if (turns.length > 0) {
    embed.addFields({ name: m.rpg_raid_field_turns({}, { locale }), value: turns.join('\n') });
  }

  if (outcome.killingBlow) {
    embed.addFields({
      name: m.rpg_raid_killed_title({}, { locale }),
      value: m.rpg_raid_killed_desc({ emoji: raid?.bossEmoji ?? '🐲', boss: raid?.bossName ?? '', team: team.name }, { locale }),
    });
  }

  if (outcome.rewards) {
    const lines = [m.rpg_raid_rewards_line({
      xp: outcome.rewards.xp,
      coins: outcome.rewards.coins,
      currency: config.currencyEmoji,
    }, { locale })];
    if (outcome.rewards.clanPoints > 0) {
      lines.push(m.rpg_raid_rewards_points({ points: outcome.rewards.clanPoints }, { locale }));
    }
    embed.addFields({ name: m.rpg_raid_field_rewards({}, { locale }), value: lines.join('\n') });
  }

  embed.setFooter({ text: m.rpg_raid_assault_left({ left: outcome.assaultsLeft }, { locale }) });
  return embed;
}
