import type { SlashCommandDefinition } from '../../commands.js';
import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { separator, v2Message } from '@arcscord/components';
import { COLORS_RAW, kotboContainer } from '../../utils/embeds.js';
import { E, buildProgressBar } from '../../utils/emojis.js';
import { getEffectiveLocale, getCommandMetadata } from '../../utils/i18n.js';
import { extractTrackingInfo, resolveModuleFromCommand, wrapModuleTracking } from '../../utils/moduleTracking.js';
import { getRankedConfigSafe } from '../../services/progression/ranked/rankedConfigService.js';
import { getRankedProfile } from '../../services/progression/ranked/rankedService.js';
import {
  getGlobalLeaderboard,
  getRankedLeaderboard,
  getStreakLeaderboard,
  setGlobalOptOut,
} from '../../services/progression/ranked/rankedLeaderboardService.js';
import * as m from '../../lib/paraglide/messages.js';

const meta = getCommandMetadata('b5_prestige');

/**
 * La couleur d'un palier est stockée en hexadécimal (elle sert aussi au
 * dashboard) ; les conteneurs Discord attendent un entier.
 */
function tierColor(hex: string): number {
  const parsed = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : COLORS_RAW.primary;
}

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  .addSubcommand((sub) =>
    sub
      .setName('rank')
      .setDescription(m.b5_prestige_rank_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestige_rank_desc({}, { locale: 'fr' }) })
      .addUserOption((option) =>
        option
          .setName('membre')
          .setDescription(m.b5_prestige_opt_member({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestige_opt_member({}, { locale: 'fr' }) }),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('top')
      .setDescription(m.b5_prestige_top_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestige_top_desc({}, { locale: 'fr' }) }),
  )
  .addSubcommand((sub) =>
    sub
      .setName('streaks')
      .setDescription(m.b5_prestige_streaks_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestige_streaks_desc({}, { locale: 'fr' }) }),
  )
  .addSubcommand((sub) =>
    sub
      .setName('global')
      .setDescription(m.b5_prestige_global_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestige_global_desc({}, { locale: 'fr' }) }),
  )
  .addSubcommand((sub) =>
    sub
      .setName('global-optout')
      .setDescription(m.b5_prestige_optout_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestige_optout_desc({}, { locale: 'fr' }) })
      .addBooleanOption((option) =>
        option
          .setName('visible')
          .setDescription(m.b5_prestige_opt_optout_state({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestige_opt_optout_state({}, { locale: 'fr' }) })
          .setRequired(true),
      ),
  );

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const { guildId, userId } = extractTrackingInfo(interaction);
  const moduleName = resolveModuleFromCommand('prestige');

  await wrapModuleTracking(moduleName, executeInternal, [interaction], {
    actionType: 'command',
    actionName: `prestige:${interaction.options.getSubcommand(false) ?? 'rank'}`,
    guildId,
    userId,
  });
}

async function executeInternal(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  const locale = await getEffectiveLocale(interaction);

  if (!guildId) {
    await interaction.reply({ content: `${E.error} ${m.b5_guild_only({}, { locale })}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  // Le classement global est le seul écran consultable sans que *ce* serveur
  // ait activé le module : il agrège d'autres guildes.
  if (subcommand !== 'global') {
    const config = await getRankedConfigSafe(guildId);
    if (!config?.enabled) {
      await interaction.reply({ content: `${E.error} ${m.b5_prestige_disabled({}, { locale })}`, flags: [MessageFlags.Ephemeral] });
      return;
    }
  }

  await interaction.deferReply();

  switch (subcommand) {
    case 'top':
      return renderGuildTop(interaction, guildId, locale);
    case 'streaks':
      return renderStreaks(interaction, guildId, locale);
    case 'global':
      return renderGlobal(interaction, locale);
    case 'global-optout':
      return handleOptOut(interaction, guildId, locale);
    default:
      return renderRankCard(interaction, guildId, locale);
  }
}

async function renderRankCard(interaction: ChatInputCommandInteraction, guildId: string, locale: 'fr' | 'en'): Promise<void> {
  const target = interaction.options.getUser('membre') ?? interaction.user;
  const profile = await getRankedProfile(guildId, target.id);

  const bar = buildProgressBar(profile.percent, 10);
  const flames = profile.streakAlive ? '🔥'.repeat(Math.max(1, profile.streakFlames)) : '💤';

  const streakLine = profile.streakAlive
    ? m.b5_prestige_card_streak_value({ days: profile.streakDays, best: profile.bestStreak }, { locale })
    : m.b5_prestige_card_streak_dead({ best: profile.bestStreak }, { locale });

  const nextLine = profile.nextTier
    ? m.b5_prestige_card_next_value({
        tier: profile.nextTier.name,
        rp: profile.rpRemaining,
        percent: profile.percent,
      }, { locale })
    : m.b5_prestige_card_apex({}, { locale });

  const lines = [
    `## ${profile.tier.name} - ${m.b5_prestige_card_rp({ rp: profile.rp.toLocaleString('fr-FR') }, { locale })}`,
    `${bar} \`${profile.percent}%\``,
    '',
    `**${m.b5_prestige_card_next({}, { locale })}** · ${nextLine}`,
    `**${m.b5_prestige_card_rank({}, { locale })}** · ${m.b5_prestige_card_rank_value({ rank: profile.rank, total: profile.totalRanked }, { locale })}`,
    `**${m.b5_prestige_card_streak({}, { locale })}** · ${flames} ${streakLine}`,
    `**${m.b5_prestige_card_peak({}, { locale })}** · ${profile.peakTier?.name ?? profile.tier.name} (${profile.peakRp.toLocaleString('fr-FR')} RP)`,
  ];

  if (profile.streakFreezes > 0) {
    lines.push(`-# 🧊 ${m.b5_prestige_card_freezes({ count: profile.streakFreezes }, { locale })}`);
  }

  await interaction.editReply(v2Message(
    kotboContainer({
      color: tierColor(profile.tier.color),
      title: `${E.trophy} ${m.b5_prestige_card_title({ user: target.displayName ?? target.username }, { locale })}`,
      fields: [separator({ divider: true, spacing: 'small' }), lines.join('\n')],
      footerTitle: 'Prestige',
    }),
  ));
}

async function renderGuildTop(interaction: ChatInputCommandInteraction, guildId: string, locale: 'fr' | 'en'): Promise<void> {
  const entries = await getRankedLeaderboard(guildId, 10);
  const guildName = interaction.guild?.name ?? '-';

  const body = entries.length === 0
    ? m.b5_prestige_top_empty({}, { locale })
    : entries
        .map((entry) => m.b5_prestige_top_line({
          rank: entry.rank,
          user: entry.userId,
          rp: entry.rp.toLocaleString('fr-FR'),
          tier: entry.tier.name,
        }, { locale }))
        .join('\n');

  await interaction.editReply(v2Message(
    kotboContainer({
      color: COLORS_RAW.primary,
      title: `${E.trophy} ${m.b5_prestige_top_title({ guild: guildName }, { locale })}`,
      fields: [separator({ divider: true, spacing: 'small' }), body],
      footerTitle: 'Prestige',
    }),
  ));
}

async function renderStreaks(interaction: ChatInputCommandInteraction, guildId: string, locale: 'fr' | 'en'): Promise<void> {
  const entries = await getStreakLeaderboard(guildId, 10);
  const guildName = interaction.guild?.name ?? '-';

  const body = entries.length === 0
    ? m.b5_prestige_streaks_empty({}, { locale })
    : entries
        .map((entry) => m.b5_prestige_streaks_line({
          flames: '🔥'.repeat(Math.max(1, entry.flames)),
          days: entry.streakDays,
          user: entry.userId,
          best: entry.bestStreak,
        }, { locale }))
        .join('\n');

  await interaction.editReply(v2Message(
    kotboContainer({
      color: COLORS_RAW.warning,
      title: `🔥 ${m.b5_prestige_streaks_title({ guild: guildName }, { locale })}`,
      fields: [separator({ divider: true, spacing: 'small' }), body],
      footerTitle: 'Prestige',
    }),
  ));
}

async function renderGlobal(interaction: ChatInputCommandInteraction, locale: 'fr' | 'en'): Promise<void> {
  const entries = await getGlobalLeaderboard(10);

  const body = entries.length === 0
    ? m.b5_prestige_global_empty({}, { locale })
    : entries
        .map((entry) => m.b5_prestige_global_line({
          rank: entry.rank,
          user: entry.userId,
          rp: entry.rp.toLocaleString('fr-FR'),
          tier: entry.tier.name,
          guilds: entry.guilds,
        }, { locale }))
        .join('\n');

  await interaction.editReply(v2Message(
    kotboContainer({
      color: COLORS_RAW.pink,
      title: `🌍 ${m.b5_prestige_global_title({}, { locale })}`,
      fields: [separator({ divider: true, spacing: 'small' }), body],
      footerTitle: 'Prestige',
    }),
  ));
}

async function handleOptOut(interaction: ChatInputCommandInteraction, guildId: string, locale: 'fr' | 'en'): Promise<void> {
  const visible = interaction.options.getBoolean('visible', true);
  await setGlobalOptOut(guildId, interaction.user.id, !visible);

  await interaction.editReply({
    content: visible
      ? `${E.success} ${m.b5_prestige_optout_on({}, { locale })}`
      : `${E.success} ${m.b5_prestige_optout_off({}, { locale })}`,
  });
}

export const prestigeCommand = { data, execute } satisfies SlashCommandDefinition;
