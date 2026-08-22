import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommandDefinition } from '../../commands.js';
import { getCommandMetadata } from '../../utils/i18n.js';
import { handleBetCommand } from '../../services/community/clanBetService.js';
import { BET_STAKE_CEILING, BET_STAKE_FLOOR, BET_SUBJECT_MAX_LENGTH } from '@kotbo/shared';
import * as m from '../../lib/paraglide/messages.js';

const meta = getCommandMetadata('c4_paris');

// Pas de `setDefaultMemberPermissions` : la commande s'adresse à tout le monde,
// seul le verdict est réservé aux administrateurs.
export const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  .addUserOption((opt) =>
    opt
      .setName('adversaire')
      .setDescription(m.c4_paris_opt_adversaire({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.c4_paris_opt_adversaire({}, { locale: 'fr' }) })
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName('sujet')
      .setDescription(m.c4_paris_opt_sujet({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.c4_paris_opt_sujet({}, { locale: 'fr' }) })
      .setRequired(true)
      .setMaxLength(BET_SUBJECT_MAX_LENGTH)
  )
  .addIntegerOption((opt) =>
    opt
      .setName('mise')
      .setDescription(m.c4_paris_opt_mise({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.c4_paris_opt_mise({}, { locale: 'fr' }) })
      .setRequired(true)
      // Bornes absolues : les mises mini et maxi du serveur sont vérifiées à
      // l'exécution, Discord ne sachant pas les faire varier par serveur.
      .setMinValue(BET_STAKE_FLOOR)
      .setMaxValue(BET_STAKE_CEILING)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await handleBetCommand(interaction);
}

export const parisCommand = { data, execute } satisfies SlashCommandDefinition;
