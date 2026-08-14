import type { SlashCommandDefinition } from '../../commands.js';
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { separator, v2Message } from '@arcscord/components';
import { DEFAULT_RANKED_LADDER, type RankedEventType } from '@kotbo/shared';
import { COLORS_RAW, kotboContainer } from '../../utils/embeds.js';
import { E } from '../../utils/emojis.js';
import { getEffectiveLocale, getCommandMetadata } from '../../utils/i18n.js';
import { extractTrackingInfo, resolveModuleFromCommand, wrapModuleTracking } from '../../utils/moduleTracking.js';
import {
  getGuildLadder,
  getOrCreateRankedConfig,
  removeTierRole,
  setTierRole,
  updateRankedConfig,
} from '../../services/progression/ranked/rankedConfigService.js';
import { adjustMemberRp } from '../../services/progression/ranked/rankedService.js';
import { createRankedEvent } from '../../services/progression/ranked/rankedEventService.js';
import { getRankedGuildStats } from '../../services/progression/ranked/rankedLeaderboardService.js';
import * as m from '../../lib/paraglide/messages.js';

const meta = getCommandMetadata('b5_prestigeadmin');

const EVENT_CHOICES: Array<{ name: string; value: RankedEventType }> = [
  { name: 'Message Rush', value: 'MESSAGE_RUSH' },
  { name: 'Reaction Storm', value: 'REACTION_STORM' },
  { name: 'Vocal Time', value: 'VOCAL_TIME' },
  { name: 'Custom', value: 'CUSTOM' },
];

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription(m.b5_prestigeadmin_setup_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_setup_desc({}, { locale: 'fr' }) })
      .addBooleanOption((opt) =>
        opt
          .setName('active')
          .setDescription(m.b5_prestigeadmin_opt_enabled({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_enabled({}, { locale: 'fr' }) })
          .setRequired(true),
      )
      .addNumberOption((opt) =>
        opt
          .setName('rp_par_xp')
          .setDescription(m.b5_prestigeadmin_opt_rp_per_xp({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_rp_per_xp({}, { locale: 'fr' }) })
          .setMinValue(0)
          .setMaxValue(10),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('plafond_journalier')
          .setDescription(m.b5_prestigeadmin_opt_daily_cap({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_daily_cap({}, { locale: 'fr' }) })
          .setMinValue(0),
      )
      .addChannelOption((opt) =>
        opt
          .setName('salon_annonces')
          .setDescription(m.b5_prestigeadmin_opt_announce_channel({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_announce_channel({}, { locale: 'fr' }) })
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('decay')
      .setDescription(m.b5_prestigeadmin_decay_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_decay_desc({}, { locale: 'fr' }) })
      .addBooleanOption((opt) =>
        opt
          .setName('active')
          .setDescription(m.b5_prestigeadmin_opt_decay_enabled({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_decay_enabled({}, { locale: 'fr' }) })
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('jours_tolerance')
          .setDescription(m.b5_prestigeadmin_opt_decay_grace({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_decay_grace({}, { locale: 'fr' }) })
          .setMinValue(0)
          .setMaxValue(60),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('rp_par_jour')
          .setDescription(m.b5_prestigeadmin_opt_decay_rp({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_decay_rp({}, { locale: 'fr' }) })
          .setMinValue(0),
      )
      .addStringOption((opt) =>
        opt
          .setName('palier_plancher')
          .setDescription(m.b5_prestigeadmin_opt_decay_floor({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_decay_floor({}, { locale: 'fr' }) })
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('event')
      .setDescription(m.b5_prestigeadmin_event_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_event_desc({}, { locale: 'fr' }) })
      .addStringOption((opt) =>
        opt
          .setName('type')
          .setDescription(m.b5_prestigeadmin_opt_event_type({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_event_type({}, { locale: 'fr' }) })
          .setRequired(true)
          .addChoices(...EVENT_CHOICES),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('duree_minutes')
          .setDescription(m.b5_prestigeadmin_opt_event_minutes({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_event_minutes({}, { locale: 'fr' }) })
          .setRequired(true)
          .setMinValue(5)
          .setMaxValue(1440),
      )
      .addNumberOption((opt) =>
        opt
          .setName('multiplicateur')
          .setDescription(m.b5_prestigeadmin_opt_event_multiplier({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_event_multiplier({}, { locale: 'fr' }) })
          .setMinValue(1)
          .setMaxValue(10),
      )
      .addStringOption((opt) =>
        opt
          .setName('nom')
          .setDescription(m.b5_prestigeadmin_opt_event_name({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_event_name({}, { locale: 'fr' }) }),
      )
      .addChannelOption((opt) =>
        opt
          .setName('salon')
          .setDescription(m.b5_prestigeadmin_opt_event_channel({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_event_channel({}, { locale: 'fr' }) })
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('role')
      .setDescription(m.b5_prestigeadmin_role_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_role_desc({}, { locale: 'fr' }) })
      .addStringOption((opt) =>
        opt
          .setName('palier')
          .setDescription(m.b5_prestigeadmin_opt_tier({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_tier({}, { locale: 'fr' }) })
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addRoleOption((opt) =>
        opt
          .setName('role')
          .setDescription(m.b5_prestigeadmin_opt_role({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_role({}, { locale: 'fr' }) }),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('adjust')
      .setDescription(m.b5_prestigeadmin_adjust_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_adjust_desc({}, { locale: 'fr' }) })
      .addUserOption((opt) =>
        opt
          .setName('membre')
          .setDescription(m.b5_prestigeadmin_opt_member({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_member({}, { locale: 'fr' }) })
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('rp')
          .setDescription(m.b5_prestigeadmin_opt_amount({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_amount({}, { locale: 'fr' }) })
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('motif')
          .setDescription(m.b5_prestigeadmin_opt_reason({}, { locale: 'en' }))
          .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_opt_reason({}, { locale: 'fr' }) }),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription(m.b5_prestigeadmin_status_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.b5_prestigeadmin_status_desc({}, { locale: 'fr' }) }),
  );

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const { guildId, userId } = extractTrackingInfo(interaction);
  const moduleName = resolveModuleFromCommand('prestige-admin');

  await wrapModuleTracking(moduleName, executeInternal, [interaction], {
    actionType: 'command',
    actionName: `prestige-admin:${interaction.options.getSubcommand(false) ?? 'status'}`,
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

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  switch (interaction.options.getSubcommand()) {
    case 'setup':
      return handleSetup(interaction, guildId, locale);
    case 'decay':
      return handleDecay(interaction, guildId, locale);
    case 'event':
      return handleEvent(interaction, guildId, locale);
    case 'role':
      return handleRole(interaction, guildId, locale);
    case 'adjust':
      return handleAdjust(interaction, guildId, locale);
    default:
      return handleStatus(interaction, guildId, locale);
  }
}

async function handleSetup(interaction: ChatInputCommandInteraction, guildId: string, locale: 'fr' | 'en'): Promise<void> {
  const channel = interaction.options.getChannel('salon_annonces');

  await updateRankedConfig(guildId, {
    enabled: interaction.options.getBoolean('active', true),
    rpPerXp: interaction.options.getNumber('rp_par_xp') ?? undefined,
    dailyRpCap: interaction.options.getInteger('plafond_journalier') ?? undefined,
    announceChannelId: channel?.id ?? undefined,
  });

  await interaction.editReply({ content: m.b5_prestigeadmin_saved({}, { locale }) });
}

async function handleDecay(interaction: ChatInputCommandInteraction, guildId: string, locale: 'fr' | 'en'): Promise<void> {
  const enabled = interaction.options.getBoolean('active', true);
  const graceDays = interaction.options.getInteger('jours_tolerance') ?? undefined;
  const rpPerDay = interaction.options.getInteger('rp_par_jour') ?? undefined;
  const floorTier = interaction.options.getString('palier_plancher');

  if (floorTier) {
    const ladder = await getGuildLadder(guildId);
    if (!ladder.some((tier) => tier.key === floorTier)) {
      await interaction.editReply({ content: m.b5_prestigeadmin_unknown_tier({ tier: floorTier }, { locale }) });
      return;
    }
  }

  const config = await updateRankedConfig(guildId, {
    decayEnabled: enabled,
    decayGraceDays: graceDays,
    decayRpPerDay: rpPerDay,
    decayFloorTierKey: floorTier ?? undefined,
  });

  const summary = config.decayEnabled
    ? m.b5_prestigeadmin_status_decay_value({ rp: config.decayRpPerDay, grace: config.decayGraceDays }, { locale })
    : m.b5_prestigeadmin_status_decay_off({}, { locale });

  await interaction.editReply({ content: m.b5_prestigeadmin_decay_saved({ summary }, { locale }) });
}

async function handleEvent(interaction: ChatInputCommandInteraction, guildId: string, locale: 'fr' | 'en'): Promise<void> {
  const type = interaction.options.getString('type', true) as RankedEventType;
  const minutes = interaction.options.getInteger('duree_minutes', true);
  const multiplier = interaction.options.getNumber('multiplicateur') ?? 2;
  const channel = interaction.options.getChannel('salon');

  const defaultName = EVENT_CHOICES.find((choice) => choice.value === type)?.name ?? type;
  const name = interaction.options.getString('nom') ?? defaultName;

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

  const event = await createRankedEvent(guildId, {
    type,
    name,
    multiplier,
    startsAt,
    endsAt,
    announceChannelId: channel?.id ?? null,
    createdBy: interaction.user.id,
  });

  await interaction.editReply({
    content: m.b5_prestigeadmin_event_created({
      name: event.name,
      multiplier: event.multiplier.toFixed(1),
      minutes,
    }, { locale }),
  });
}

async function handleRole(interaction: ChatInputCommandInteraction, guildId: string, locale: 'fr' | 'en'): Promise<void> {
  const tierKey = interaction.options.getString('palier', true);
  const role = interaction.options.getRole('role');

  const ladder = await getGuildLadder(guildId);
  const tier = ladder.find((entry) => entry.key === tierKey);
  if (!tier) {
    await interaction.editReply({ content: m.b5_prestigeadmin_unknown_tier({ tier: tierKey }, { locale }) });
    return;
  }

  if (!role) {
    await removeTierRole(guildId, tierKey);
    await interaction.editReply({ content: m.b5_prestigeadmin_role_removed({ tier: tier.name }, { locale }) });
    return;
  }

  await setTierRole(guildId, tierKey, role.id);
  // Poser un rôle sans activer l'attribution laisserait le staff croire que la
  // récompense est en place alors qu'aucun membre ne la recevrait.
  await updateRankedConfig(guildId, { tierRolesEnabled: true });

  await interaction.editReply({ content: m.b5_prestigeadmin_role_set({ tier: tier.name, role: `<@&${role.id}>` }, { locale }) });
}

async function handleAdjust(interaction: ChatInputCommandInteraction, guildId: string, locale: 'fr' | 'en'): Promise<void> {
  const target = interaction.options.getUser('membre', true);
  const delta = interaction.options.getInteger('rp', true);
  const reason = interaction.options.getString('motif') ?? undefined;

  const result = await adjustMemberRp(guildId, target.id, delta, interaction.client, reason);
  if (!result) {
    await interaction.editReply({ content: m.b5_prestigeadmin_adjust_noop({}, { locale }) });
    return;
  }

  await interaction.editReply({
    content: m.b5_prestigeadmin_adjusted({
      member: `<@${target.id}>`,
      delta: result.granted > 0 ? `+${result.granted}` : String(result.granted),
      total: result.rpAfter.toLocaleString('fr-FR'),
      tier: result.tierAfter.name,
    }, { locale }),
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction, guildId: string, locale: 'fr' | 'en'): Promise<void> {
  const [config, stats] = await Promise.all([
    getOrCreateRankedConfig(guildId),
    getRankedGuildStats(guildId),
  ]);

  const capLabel = config.dailyRpCap > 0
    ? String(config.dailyRpCap)
    : m.b5_prestigeadmin_status_unlimited({}, { locale });

  const decayLine = config.decayEnabled
    ? m.b5_prestigeadmin_status_decay_value({ rp: config.decayRpPerDay, grace: config.decayGraceDays }, { locale })
    : m.b5_prestigeadmin_status_decay_off({}, { locale });

  const lines = [
    `**${m.b5_prestigeadmin_status_state({}, { locale })}** · ${config.enabled
      ? m.b5_prestigeadmin_status_enabled({}, { locale })
      : m.b5_prestigeadmin_status_disabled({}, { locale })}`,
    `**${m.b5_prestigeadmin_status_gains({}, { locale })}** · ${m.b5_prestigeadmin_status_gains_value({
      rpPerXp: config.rpPerXp,
      reactionRp: config.reactionRp,
      cap: capLabel,
    }, { locale })}`,
    `**${m.b5_prestigeadmin_status_streaks({}, { locale })}** · ${m.b5_prestigeadmin_status_streaks_value({
      bonus: Math.round(config.streakBonusPerDay * 100),
      max: Math.round(config.streakMaxBonus * 100),
      grace: config.streakGraceDays,
    }, { locale })}`,
    `**${m.b5_prestigeadmin_status_decay({}, { locale })}** · ${decayLine}`,
    `**${m.b5_prestigeadmin_status_members({}, { locale })}** · ${m.b5_prestigeadmin_status_members_value({
      ranked: stats.rankedMembers,
      streaks: stats.activeStreaks,
    }, { locale })}`,
  ];

  await interaction.editReply(v2Message(
    kotboContainer({
      color: COLORS_RAW.primary,
      title: `${E.trophy} ${m.b5_prestigeadmin_status_title({}, { locale })}`,
      fields: [separator({ divider: true, spacing: 'small' }), lines.join('\n')],
      footerTitle: 'Prestige',
    }),
  ));
}

/**
 * Autocomplétion des paliers. L'échelle de la guilde fait foi ; le repli sur
 * l'échelle par défaut évite une liste vide si sa lecture échoue.
 */
async function autocomplete(interaction: import('discord.js').AutocompleteInteraction): Promise<void> {
  const ladder = interaction.guildId
    ? await getGuildLadder(interaction.guildId).catch(() => DEFAULT_RANKED_LADDER)
    : DEFAULT_RANKED_LADDER;

  const query = interaction.options.getFocused().toLowerCase();
  const matches = ladder
    .filter((tier) => tier.name.toLowerCase().includes(query) || tier.key.toLowerCase().includes(query))
    .slice(0, 25)
    .map((tier) => ({ name: `${tier.name} (${tier.minRp} RP)`, value: tier.key }));

  await interaction.respond(matches).catch(() => null);
}

export const prestigeAdminCommand = { data, execute, autocomplete } satisfies SlashCommandDefinition;
