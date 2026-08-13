/**
 * `/opt-out` - retrait individuel du suivi de présence.
 *
 * Le refus est le pendant Discord des réglages de confidentialité du dashboard :
 * les deux écrivent le même champ sur le `MemberProfile`, et sont donc
 * réversibles depuis l'un comme depuis l'autre. La réponse est éphémère - un
 * choix de confidentialité n'a pas à s'afficher dans le salon.
 */

import type { SlashCommandDefinition } from '../../commands.js';
import {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type GuildMember,
} from 'discord.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embeds.js';
import { getEffectiveLocale, getCommandMetadata, type BotLocale } from '../../utils/i18n.js';
import { logger } from '../../utils/logger.js';
import {
  getPresencePrivacyState,
  setPresenceTrackingOptOut,
} from '../../services/core/presencePrivacyService.js';
import { memberProfileIdentity } from '../../services/moderation/memberIdentityService.js';
import { syncMemberAutoRoles } from '../../services/features/serverTagRoleService.js';
import * as m from '../../lib/paraglide/messages.js';

const meta = getCommandMetadata('optout');
const presenceMeta = getCommandMetadata('optout_presence');

/** Bouton de retour en arrière posé sous la confirmation de retrait. */
export const OPT_OUT_PRESENCE_RESUME_ID = 'optout:presence:resume';

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  .addSubcommand((sub) =>
    sub
      .setName(presenceMeta.name)
      .setNameLocalizations(presenceMeta.nameLocalizations)
      .setDescription(presenceMeta.description)
      .setDescriptionLocalizations(presenceMeta.descriptionLocalizations),
  );

function resumeRow(locale: BotLocale): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(OPT_OUT_PRESENCE_RESUME_ID)
      .setLabel(m.optout_presence_resume_button({}, { locale }))
      .setStyle(ButtonStyle.Secondary),
  );
}

/** `<t:…:D>` : chaque membre lit la date dans son propre fuseau. */
function discordDate(date: Date | null): string {
  if (!date) return '-';
  return `<t:${Math.floor(date.getTime() / 1000)}:D>`;
}

async function resolveMember(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<GuildMember | null> {
  return interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
}

/**
 * Retire les rôles hérités de la présence après un changement de choix.
 *
 * Le scan de statut ne lit plus le membre retiré : sans resynchronisation, le
 * rôle déjà attribué resterait en place jusqu'à un futur événement.
 */
async function resyncAutoRoles(member: GuildMember | null): Promise<void> {
  if (!member) return;
  try {
    await syncMemberAutoRoles(member);
  } catch (err) {
    logger.error('OptOut', `Resynchronisation des auto-rôles impossible pour ${member.id}`, err);
  }
}

async function handlePresence(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const locale = await getEffectiveLocale(interaction);
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const current = await getPresencePrivacyState(guildId, interaction.user.id);
  if (current.optedOut) {
    await interaction.editReply({
      embeds: [
        infoEmbed(
          m.optout_presence_already_title({}, { locale }),
          m.optout_presence_already_desc({ since: discordDate(current.since) }, { locale }),
        ),
      ],
      components: [resumeRow(locale)],
    });
    return;
  }

  const member = await resolveMember(interaction);
  const state = await setPresenceTrackingOptOut(
    guildId,
    interaction.user.id,
    true,
    member ? memberProfileIdentity(member) : undefined,
  );
  await resyncAutoRoles(member);

  await interaction.editReply({
    embeds: [
      successEmbed(
        m.optout_presence_done_title({}, { locale }),
        m.optout_presence_done_desc({ since: discordDate(state.since) }, { locale }),
      ),
    ],
    components: [resumeRow(locale)],
  });
}

/** Clic sur « reprendre le suivi » : le message étant éphémère, seul l'auteur y accède. */
export async function handleOptOutPresenceResume(interaction: ButtonInteraction): Promise<void> {
  const locale = await getEffectiveLocale(interaction);

  if (!interaction.guildId) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          m.optout_guild_only_title({}, { locale }),
          m.optout_guild_only_desc({}, { locale }),
        ),
      ],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.deferUpdate();

  const member = await resolveMember(interaction);
  await setPresenceTrackingOptOut(
    interaction.guildId,
    interaction.user.id,
    false,
    member ? memberProfileIdentity(member) : undefined,
  );
  await resyncAutoRoles(member);

  await interaction.editReply({
    embeds: [
      successEmbed(
        m.optout_presence_resumed_title({}, { locale }),
        m.optout_presence_resumed_desc({}, { locale }),
      ),
    ],
    components: [],
  });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    const locale = await getEffectiveLocale(interaction);
    await interaction.reply({
      embeds: [
        errorEmbed(
          m.optout_guild_only_title({}, { locale }),
          m.optout_guild_only_desc({}, { locale }),
        ),
      ],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (interaction.options.getSubcommand() === presenceMeta.name) {
    await handlePresence(interaction, guildId);
  }
}

export const optOutCommand = { data, execute } satisfies SlashCommandDefinition;
