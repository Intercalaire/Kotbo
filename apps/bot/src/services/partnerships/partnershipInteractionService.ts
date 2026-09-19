/**
 * Composants Discord du module Partenariats : boutons de décision et
 * formulaire de candidature.
 *
 * Tous les `customId` portent le préfixe `partnership:`, déclaré dans
 * `MODULE_REGISTRY` : c'est ce qui permet à la garde de module de fermer les
 * boutons en même temps que le reste du module, sans que ce fichier ait à le
 * vérifier partout.
 *
 * Les droits sont revérifiés ici et pas seulement à l'affichage : un message
 * éphémère peut rester ouvert longtemps, et rien n'empêche quelqu'un de
 * cliquer après avoir perdu ses permissions.
 */
import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
} from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { isPartnershipsActive } from './partnershipSettings.js';
import { decideApplication, submitApplication } from './partnerApplicationService.js';

export const PARTNERSHIP_PREFIX = 'partnership:';

/** Décisions sur une candidature, depuis `/partenariat demandes`. */
export async function handlePartnershipButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, applicationId] = interaction.customId.split(':');
  if (!interaction.guildId) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'Action réservée au staff.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (action !== 'accept' && action !== 'reject') return;

  // La candidature est relue avec son serveur : un identifiant recopié depuis
  // un autre serveur ne doit rien pouvoir décider ici.
  const application = await prisma.partnerApplication.findFirst({
    where: { id: applicationId, guildId: interaction.guildId },
    select: { id: true, status: true, projectName: true },
  });
  if (!application) {
    await interaction.reply({ content: 'Candidature introuvable.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (application.status !== 'PENDING' && application.status !== 'REVIEWING') {
    await interaction.reply({ content: 'Cette demande a déjà été traitée.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await decideApplication(application.id, action === 'accept' ? 'ACCEPTED' : 'REJECTED', {
      userId: interaction.user.id,
      label: interaction.user.tag,
      source: 'discord',
    });

    await interaction.editReply({
      content:
        action === 'accept'
          ? `**${application.projectName}** acceptée : fiche et dossier créés.`
          : `**${application.projectName}** refusée. Le demandeur a été prévenu.`,
    });
  } catch (error) {
    logger.error('Partenariats', 'Decision de candidature en echec', error);
    await interaction.editReply({ content: "La décision n'a pas pu être enregistrée." });
  }
}

/** Formulaire de candidature envoyé par `/partenariat proposer`. */
export async function handlePartnershipModal(
  interaction: ModalSubmitInteraction,
  _client: Client,
): Promise<void> {
  if (!interaction.customId.endsWith('apply') || !interaction.guildId) return;

  if (!(await isPartnershipsActive(interaction.guildId))) {
    await interaction.reply({ content: "Le module Partenariats n'est pas actif.", flags: MessageFlags.Ephemeral });
    return;
  }

  const name = interaction.fields.getTextInputValue('name').trim();
  const invite = interaction.fields.getTextInputValue('invite').trim();
  const membersRaw = interaction.fields.getTextInputValue('members').trim();
  const pitch = interaction.fields.getTextInputValue('pitch').trim();

  // Un effectif saisi à la main n'est pas une donnée fiable : il est retenu
  // comme déclaration, et le filtrage à la réception le confronte aux seuils.
  const memberCount = /^\d{1,9}$/.test(membersRaw) ? Number(membersRaw) : null;

  const application = await submitApplication({
    guildId: interaction.guildId,
    source: 'command',
    applicantUserId: interaction.user.id,
    applicantTag: interaction.user.tag,
    projectName: name || 'Demande sans nom',
    projectKind: 'SERVER',
    projectGuildId: null,
    inviteUrl: invite || null,
    memberCount,
    description: pitch,
  });

  await interaction.reply({
    content: application
      ? 'Votre demande a été transmise au staff. Vous recevrez une réponse en message privé.'
      : 'Les demandes de partenariat sont fermées sur ce serveur.',
    flags: MessageFlags.Ephemeral,
  });
}
