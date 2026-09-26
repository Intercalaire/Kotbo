import type { SlashCommandDefinition } from '../../commands.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { kotboContainer } from '../../utils/embeds.js';
import { E } from '../../utils/emojis.js';
import { separator, v2Message } from '@arcscord/components';
import { getEffectiveLocale, getCommandMetadata } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';
import { getCachedDashboardSettings } from '../../utils/cache.js';
import { GAMBLING_COMMANDS, normalizeCommandRestrictions, readCommandsEnabled } from '../../utils/commandAccess.js';

const meta = getCommandMetadata('b5_games');

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations);

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const locale = await getEffectiveLocale(interaction);

  // Le menu ne présente que les jeux ouverts sur le serveur : en citer un coupé enverrait le
  // membre droit sur un refus.
  const settings = interaction.guildId ? await getCachedDashboardSettings(interaction.guildId) : null;
  const open = readCommandsEnabled(normalizeCommandRestrictions(settings?.commandRestrictions), GAMBLING_COMMANDS);
  const games = [
    { name: 'dice', text: m.b5_games_dice({ coins: E.coins, dot: E.dot }, { locale }) },
    { name: 'rps', text: m.b5_games_rps({ coins: E.coins, dot: E.dot }, { locale }) },
    { name: 'roulette', text: m.b5_games_roulette({ coins: E.coins, dot: E.dot }, { locale }) },
    { name: 'guess', text: m.b5_games_guess({ coins: E.coins, dot: E.dot }, { locale }) },
  ].filter((game) => open[game.name]);

  await interaction.reply(v2Message(
    kotboContainer({
      color: 'primary',
      title: `${E.coins} ${m.b5_games_title({}, { locale })}`,
      fields: [
        m.b5_games_intro({}, { locale }),
        ...games.flatMap((game) => [separator({ divider: true, spacing: 'small' }), game.text]),
      ],
      footerOverwrite: `-# ${E.warning} ${m.b5_games_footer({}, { locale })}`,
    }),
  ));
}

export const gamesCommand = { data, execute } satisfies SlashCommandDefinition;
