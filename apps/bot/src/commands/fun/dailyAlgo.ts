import type { SlashCommandDefinition } from '../../commands.js';
import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  getDailyAlgoUserProfile,
  getGuildDailyAlgoRanking,
  getPreviousDailyAlgoRun,
  formatDailyAlgoDate,
} from '../../services/progression/dailyAlgoService.js';
import { COLORS, truncate, baseEmbed } from '../../utils/embeds.js';
import { extractTrackingInfo, resolveModuleFromCommand, wrapModuleTracking } from '../../utils/moduleTracking.js';
import { getCommandMetadata } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';

const meta = getCommandMetadata('c3_dailyalgo');

const VIEW_KEYS = ['previous', 'scoring', 'ranking', 'profile'] as const;

const viewChoice = (key: (typeof VIEW_KEYS)[number]) => ({
  name: (m as any)[`c3_dailyalgo_choice_${key}`]({}, { locale: 'en' }) as string,
  name_localizations: { fr: (m as any)[`c3_dailyalgo_choice_${key}`]({}, { locale: 'fr' }) as string },
  value: key,
});

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  .addStringOption((option) =>
    option
      .setName('vue')
      .setDescription(m.c3_dailyalgo_opt_vue({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.c3_dailyalgo_opt_vue({}, { locale: 'fr' }) })
      .setRequired(false)
      .addChoices(...VIEW_KEYS.map(viewChoice)),
  )
  .addUserOption((option) =>
    option
      .setName('membre')
      .setDescription(m.c3_dailyalgo_opt_membre({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.c3_dailyalgo_opt_membre({}, { locale: 'fr' }) })
      .setRequired(false),
  );

function formatTierBadge(tier: string): string {
  if (tier === 'Légende') return '👑 Légende';
  if (tier === 'Maître') return '🔥 Maître';
  if (tier === 'Apprenti') return '🛠️ Apprenti';
  return '🌱 Débutant';
}

function rankMedal(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

async function replyPreviousRun(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const previousRun = await getPreviousDailyAlgoRun(guildId);

  if (!previousRun) {
    await interaction.reply({
      content: "ℹ️ Aucun Daily Algo précédent n'a encore été publié sur ce serveur.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const dateLabel = formatDailyAlgoDate(previousRun.dateKey ?? '');

  const embed = baseEmbed(COLORS.info, { user: interaction.user })
    .setTitle(`📚 Daily Algo du ${dateLabel}`)
    .addFields(
      {
        name: '📌 Titre',
        value: truncate(previousRun.problem.title, 256),
        inline: false,
      },
      {
        name: '⚙️ Difficulté',
        value: `\`${truncate(previousRun.problem.difficulty, 32)}\``,
        inline: true,
      },
      {
        name: '🗓️ Date',
        value: dateLabel,
        inline: true,
      },
      {
        name: '❓ Question',
        value: truncate(previousRun.problem.description, 1800),
        inline: false,
      },
    )
    .setFooter({ text: 'Kotbo · Daily Algo' })
    .setTimestamp(previousRun.createdAt);

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

async function replyScoring(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = baseEmbed(COLORS.info, { user: interaction.user })
    .setTitle('🧮 Barème de notation Daily Algo')
    .setDescription(
      'Le score final est la moyenne des 5 critères ci-dessous. La qualité du code prime sur la vitesse de soumission (pas de bonus rapidité).',
    )
    .addFields(
      {
        name: '✅ Exactitude',
        value: 'Le code fonctionne-t-il correctement ? Gère-t-il les cas complexes et les limites (edge cases) ?',
        inline: false,
      },
      {
        name: '💬 Commentaires',
        value: "Le code est-il documenté ? L'approche est-elle expliquée clairement ?",
        inline: false,
      },
      {
        name: '📦 Compacité',
        value: 'Le code est-il efficace et concis ? Y a-t-il du superflu ou des redondances ?',
        inline: false,
      },
      {
        name: '⚡ Optimisation',
        value: 'La complexité temporelle et spatiale est-elle optimale pour le problème ?',
        inline: false,
      },
      {
        name: '🧹 Lisibilité',
        value: 'Le code est-il propre, bien formaté et facile à lire ?',
        inline: false,
      },
      {
        name: '🌱 Progression',
        value:
          'Ton rang global dépend de tes points cumulés et de ta régularité :\n🌱 Débutant · 🛠️ Apprenti · 🔥 Maître · 👑 Légende',
        inline: false,
      },
    )
    .setFooter({ text: 'Kotbo · Daily Algo' })
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

async function replyRanking(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const ranking = await getGuildDailyAlgoRanking(guildId);

  if (ranking.length === 0) {
    await interaction.reply({
      content: 'ℹ️ Aucun classement disponible pour le moment. Il faut au moins une soumission validée.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const top = ranking.slice(0, 10);
  const lines = top.map((entry) => (
    `${rankMedal(entry.rank)} **${entry.authorName}** - ${entry.totalPoints} pts · moyenne ${entry.averageScore.toFixed(1)}/5 · ${formatTierBadge(entry.tier)}`
  ));

  const currentUserRank = ranking.find((entry) => entry.authorId === interaction.user.id) ?? null;
  const userLine = currentUserRank
    ? `Ton rang: **#${currentUserRank.rank}** sur **${ranking.length}** · streak **${currentUserRank.currentStreak}** · ${formatTierBadge(currentUserRank.tier)}`
    : "Tu n'es pas encore classé (aucune soumission validée).";

  const embed = baseEmbed(COLORS.info, { user: interaction.user })
    .setTitle('📊 Classement Daily Algo du serveur')
    .setDescription(lines.join('\n'))
    .addFields({
      name: 'Comparaison Discord',
      value: userLine,
      inline: false,
    })
    .setFooter({ text: 'Kotbo · Daily Algo' })
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

async function replyProfile(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const targetUser = interaction.options.getUser('membre') ?? interaction.user;
  const profile = await getDailyAlgoUserProfile(guildId, targetUser.id);

  if (!profile) {
    await interaction.reply({
      content: `ℹ️ ${targetUser.username} n'a pas encore de soumission validée sur ce serveur.`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const embed = baseEmbed(COLORS.success, { user: interaction.user })
    .setTitle(`🎯 Profil Daily Algo · ${profile.authorName}`)
    .addFields(
      {
        name: 'Classement',
        value: `#${profile.rank}`,
        inline: true,
      },
      {
        name: 'Statut',
        value: formatTierBadge(profile.tier),
        inline: true,
      },
      {
        name: 'Série (streak)',
        value: `${profile.currentStreak} en cours · record ${profile.bestStreak}`,
        inline: true,
      },
      {
        name: 'Performance',
        value: `Points cumulés: **${profile.totalPoints}**\nMoyenne: **${profile.averageScore.toFixed(1)}/5**\nMeilleur score: **${profile.bestScore}**`,
        inline: false,
      },
      {
        name: 'Participation',
        value: `${profile.approvedCount} soumission(s) validée(s)`,
        inline: false,
      },
    )
    .setFooter({ text: 'Kotbo · Daily Algo' })
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const { guildId, userId } = extractTrackingInfo(interaction);
  const moduleName = resolveModuleFromCommand('daily-algo');
  const view = interaction.options.getString('vue') ?? 'previous';

  // Wrapper pour tracker les performances et l'utilisation
  await wrapModuleTracking(
    moduleName,
    executeInternal,
    [interaction],
    {
      actionType: 'command',
      actionName: view,
      guildId,
      userId,
    }
  );
}

async function executeInternal(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: '❌ Cette commande doit être utilisée dans un serveur.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const view = interaction.options.getString('vue') ?? 'previous';

  if (view === 'scoring') {
    await replyScoring(interaction);
    return;
  }

  if (view === 'ranking') {
    await replyRanking(interaction, guildId);
    return;
  }

  if (view === 'profile') {
    await replyProfile(interaction, guildId);
    return;
  }

  await replyPreviousRun(interaction, guildId);
}

export const dailyAlgoCommand = { data, execute } satisfies SlashCommandDefinition;
