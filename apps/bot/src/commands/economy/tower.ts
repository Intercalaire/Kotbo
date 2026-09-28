import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommandDefinition } from '../../commands.js';
import { buildTowerHomeView } from '../../services/features/rpg/rpgTowerPanel.js';
import { renderPanelView } from '../../services/features/rpgPanelService.js';
import { getCommandMetadata, getEffectiveLocale } from '../../utils/i18n.js';

/** La Tour : un seul panneau, comme `/rpg` et `/market`. Toute l'ascension se joue aux boutons. */
const meta = getCommandMetadata('tower_cmd');

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations);

async function execute(interaction: ChatInputCommandInteraction) {
  const locale = await getEffectiveLocale(interaction);
  const view = await buildTowerHomeView(interaction.client, interaction.guildId!, interaction.user.id, locale);
  await interaction.reply(renderPanelView(view));
}

export const towerCommand = { data, execute } satisfies SlashCommandDefinition;
