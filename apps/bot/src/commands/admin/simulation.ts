import type { SlashCommandDefinition } from '../../commands.js';
import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getCommandMetadata } from '../../utils/i18n.js';
import {
  SimulationError,
  abandonSession,
  listScenarios,
  startSession,
} from '../../services/staff/simulationService.js';
import { logger } from '../../utils/logger.js';

const meta = getCommandMetadata('sim');
const startMeta = getCommandMetadata('sim_start');
const stopMeta = getCommandMetadata('sim_stop');
const listMeta = getCommandMetadata('sim_list');

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addSubcommand((sub) =>
    sub
      .setName(startMeta.name)
      .setNameLocalizations(startMeta.nameLocalizations)
      .setDescription(startMeta.description)
      .setDescriptionLocalizations(startMeta.descriptionLocalizations)
      // L'autocomplétion évite de faire copier un identifiant depuis le dashboard.
      .addStringOption((option) =>
        option
          .setName('scenario')
          .setDescription('Scénario à jouer')
          .setRequired(true)
          .setAutocomplete(true)))
  .addSubcommand((sub) =>
    sub
      .setName(stopMeta.name)
      .setNameLocalizations(stopMeta.nameLocalizations)
      .setDescription(stopMeta.description)
      .setDescriptionLocalizations(stopMeta.descriptionLocalizations))
  .addSubcommand((sub) =>
    sub
      .setName(listMeta.name)
      .setNameLocalizations(listMeta.nameLocalizations)
      .setDescription(listMeta.description)
      .setDescriptionLocalizations(listMeta.descriptionLocalizations));

const DIFFICULTY_LABELS: Record<string, string> = {
  EASY: 'Facile',
  MEDIUM: 'Intermédiaire',
  HARD: 'Difficile',
};

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const { guild, guildId } = interaction;
  if (!guild || !guildId) return;

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === listMeta.name) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const scenarios = await listScenarios(guildId);
    const enabled = scenarios.filter((s) => s.enabled);

    if (enabled.length === 0) {
      await interaction.editReply('Aucun scénario disponible. Créez-en un depuis le dashboard.');
      return;
    }

    const lines = enabled.map((scenario) => {
      const steps = Array.isArray(scenario.steps) ? scenario.steps.length : 0;
      return `• **${scenario.title}** - ${DIFFICULTY_LABELS[scenario.difficulty] ?? scenario.difficulty}, ${steps} étape(s)`;
    });
    await interaction.editReply(lines.join('\n').slice(0, 1900));
    return;
  }

  if (subcommand === stopMeta.name) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const stopped = await abandonSession(interaction.client, guildId, interaction.user.id);
    await interaction.editReply(
      stopped
        ? 'Session interrompue. Le rapport a été publié dans le salon de test.'
        : 'Vous n\'avez aucune session en cours.',
    );
    return;
  }

  // ── start ────────────────────────────────────────────────────────────────
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const scenarioId = interaction.options.getString('scenario', true);

  try {
    await startSession(
      interaction.client,
      guild,
      scenarioId,
      { id: interaction.user.id, name: interaction.user.tag },
      interaction.channelId,
    );
    await interaction.editReply(
      'Session lancée. Les incidents vont apparaître dans ce salon : réagissez avec les boutons sous chaque message.',
    );
  } catch (error) {
    if (error instanceof SimulationError) {
      await interaction.editReply(`❌ ${error.message}`);
      return;
    }
    logger.error('Simulation', 'Échec du démarrage d\'une session:', error);
    await interaction.editReply('❌ Impossible de démarrer la simulation.');
  }
}

async function autocomplete(interaction: import('discord.js').AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return;

  const focused = interaction.options.getFocused().toLowerCase();
  const scenarios = await listScenarios(interaction.guildId);

  const choices = scenarios
    .filter((s) => s.enabled && s.title.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((s) => ({ name: `${s.title} (${DIFFICULTY_LABELS[s.difficulty] ?? s.difficulty})`.slice(0, 100), value: s.id }));

  await interaction.respond(choices).catch(() => null);
}

export const simulationCommand: SlashCommandDefinition = { data, execute, autocomplete };
