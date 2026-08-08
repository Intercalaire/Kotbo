import type { SlashCommandDefinition } from '../../commands.js';
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import prisma from '../../utils/db.js';
import { pushWidgetForUser, clearWidgetForUser } from '../../services/integrations/widgetService.js';
import { getStaffMember } from '../../services/staff/staffManagementService.js';
import { errorContainer, kotboContainer, successContainer } from '../../utils/embeds.js';
import { E } from '../../utils/emojis.js';
import { separator, v2Message } from '@arcscord/components';
import { getCommandMetadata } from '../../utils/i18n.js';

const meta = getCommandMetadata('c5_widget');
const activerMeta = getCommandMetadata('c5_widget_activer');
const desactiverMeta = getCommandMetadata('c5_widget_desactiver');
const refreshMeta = getCommandMetadata('c5_widget_refresh');
const infoMeta = getCommandMetadata('c5_widget_info');

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  .addSubcommand((sub) =>
    sub
      .setName(activerMeta.name)
      .setNameLocalizations(activerMeta.nameLocalizations)
      .setDescription(activerMeta.description)
      .setDescriptionLocalizations(activerMeta.descriptionLocalizations),
  )
  .addSubcommand((sub) =>
    sub
      .setName(desactiverMeta.name)
      .setNameLocalizations(desactiverMeta.nameLocalizations)
      .setDescription(desactiverMeta.description)
      .setDescriptionLocalizations(desactiverMeta.descriptionLocalizations),
  )
  .addSubcommand((sub) =>
    sub
      .setName(refreshMeta.name)
      .setNameLocalizations(refreshMeta.nameLocalizations)
      .setDescription(refreshMeta.description)
      .setDescriptionLocalizations(refreshMeta.descriptionLocalizations),
  )
  .addSubcommand((sub) =>
    sub
      .setName(infoMeta.name)
      .setNameLocalizations(infoMeta.nameLocalizations)
      .setDescription(infoMeta.description)
      .setDescriptionLocalizations(infoMeta.descriptionLocalizations),
  );

function getDashboardLoginUrl(): string {
  const baseRedirect = process.env.DISCORD_REDIRECT_URI ?? '';
  if (!baseRedirect) return '';
  const base = new URL(baseRedirect).origin;
  return `${base}/api/auth/discord/widget-login?returnTo=/widget`;
}

async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (!guildId) {
    await interaction.editReply(v2Message(
      errorContainer('Cette commande doit être utilisée dans un serveur.'),
    ));
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'activer') {
    const staffMember = await getStaffMember(guildId, userId);
    if (!staffMember) {
      await interaction.editReply(v2Message(
        errorContainer('Accès refusé', 'Tu dois être membre du staff pour activer le widget.'),
      ));
      return;
    }

    await prisma.widgetSubscription.upsert({
      where: { guildId_userId: { guildId, userId } },
      update: { enabled: true },
      create: { guildId, userId, enabled: true },
    });

    const result = await pushWidgetForUser(guildId, userId);
    if (!result.ok) {
      await interaction.editReply(v2Message(
        kotboContainer({
          color: 'warning',
          title: `${E.warning} Widget - Synchronisation échouée`,
          fields: [
            `Widget activé en base mais la mise à jour Discord a échoué.\n\n` +
              `${E.arrow} **Si tu as retiré l'accès à Kotbo, autorise-le de nouveau.**\n` +
              `${E.dot} [Réautoriser Kotbo](${getDashboardLoginUrl()})`,
            separator({ divider: true, spacing: 'small' }),
            `${E.error} Erreur: \`${result.error}\``,
          ],
          footerTitle: 'Widget',
        }),
      ));
      return;
    }

    await interaction.editReply(v2Message(
      kotboContainer({
        color: 'success',
        title: `${E.success} Widget activé`,
        fields: [
          `Tes stats staff sont synchronisées. Pour ajouter Kotbo à ton Profile Board, ` +
            `[ouvre le dashboard](${getDashboardLoginUrl()}).`,
        ],
        footerTitle: 'Widget',
      }),
    ));
    return;
  }

  if (sub === 'desactiver') {
    await prisma.widgetSubscription.updateMany({
      where: { guildId, userId },
      data: { enabled: false },
    });

    const result = await clearWidgetForUser(userId);
    if (!result.ok) {
      await interaction.editReply(v2Message(
        errorContainer('Erreur partielle', `Widget désactivé en base mais la suppression Discord a échoué: \`${result.error}\``),
      ));
      return;
    }

    await interaction.editReply(v2Message(
      successContainer('Widget désactivé', 'Le widget a été supprimé de ton profil.'),
    ));
    return;
  }

  if (sub === 'refresh') {
    const subscription = await prisma.widgetSubscription.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });

    if (!subscription?.enabled) {
      await interaction.editReply(v2Message(
        errorContainer('Aucun widget actif', 'Utilise `/widget activer` d\'abord.'),
      ));
      return;
    }

    const result = await pushWidgetForUser(guildId, userId);
    if (!result.ok) {
      await interaction.editReply(v2Message(
        errorContainer('Échec du refresh', `\`${result.error}\``),
      ));
      return;
    }

    await interaction.editReply(v2Message(
      successContainer('Widget rafraîchi', 'Tes dernières stats ont été poussées sur ton profil.'),
    ));
    return;
  }

  if (sub === 'info') {
    const subscription = await prisma.widgetSubscription.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });

    const isActive = subscription?.enabled ?? false;
    const since = subscription?.createdAt
      ? subscription.createdAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '-';

    await interaction.editReply(v2Message(
      kotboContainer({
        color: isActive ? 'success' : 'dark',
        title: `${E.profile} Widget Kotbo`,
        titleThumbnail: { url: interaction.user.displayAvatarURL() },
        fields: [
          separator({ divider: true, spacing: 'small' }),
          [
            `${E.arrow} **Statut** · ${isActive ? `${E.online} Actif` : `${E.offline} Inactif`}`,
            `${E.arrow} **Serveur** · ${interaction.guild?.name ?? guildId}`,
            `${E.arrow} **Activé depuis** · ${since}`,
          ].join('\n'),
          separator({ divider: true, spacing: 'small' }),
          `${E.link} [Autoriser Kotbo sur ton profil](${getDashboardLoginUrl()})`,
        ],
        footerTitle: 'Widget',
      }),
    ));
    return;
  }
}

export const widgetCommand: SlashCommandDefinition = { data, execute };
