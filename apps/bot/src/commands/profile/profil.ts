import type { SlashCommandDefinition } from '../../commands.js';
import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getStaffMember, getStaffMemberStats } from '../../services/staff/staffManagementService.js';
import { getStaffProfileSnapshot } from '../../services/progression/profileService.js';
import { kotboContainer, truncate } from '../../utils/embeds.js';
import { E } from '../../utils/emojis.js';
import { logger } from '../../utils/logger.js';
import { ContainerChild, separator, v2Message } from '@arcscord/components';
import { getCommandMetadata } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';

const meta = getCommandMetadata('c2_profil');

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  .addUserOption((option) =>
    option
      .setName('utilisateur')
      .setDescription(m.c2_profil_opt_utilisateur({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.c2_profil_opt_utilisateur({}, { locale: 'fr' }) })
      .setRequired(false),
  );

function formatGrade(grade: string): string {
  const grades: Record<string, string> = {
    HELPER: `${E.shield} Helper`,
    MODERATOR: `${E.moderation} Modérateur`,
    ADMIN: `${E.settings} Admin`,
    OWNER: `${E.crown} Propriétaire`,
  };
  return grades[grade] ?? grade;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDuration(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / 1000 / 60) % 60);
  const hours = Math.floor((ms / 1000 / 60 / 60) % 24);
  const days = Math.floor(ms / 1000 / 60 / 60 / 24);
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatTestingPeriodStatus(status: string): string {
  if (status === 'PASSED') return `${E.success} Validée`;
  if (status === 'FAILED') return `${E.error} Échouée`;
  return `${E.loading} En cours`;
}

async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.editReply({ content: `${E.error} Cette commande ne peut être utilisée que sur un serveur.` });
      return;
    }

    const requesterStaff = await getStaffMember(guildId, interaction.user.id);
    if (!requesterStaff) {
      await interaction.editReply({ content: `${E.error} Cette commande est réservée aux membres du staff connectés sur le dashboard.` });
      return;
    }

    const user = interaction.options.getUser('utilisateur') ?? interaction.user;
    const targetStaff = await getStaffMember(guildId, user.id);

    if (!targetStaff) {
      await interaction.editReply({ content: `${E.error} ${user.username} n'est pas dans le staff.` });
      return;
    }

    const [detailStats, snapshot] = await Promise.all([
      getStaffMemberStats(guildId, user.id),
      getStaffProfileSnapshot(guildId, user.id),
    ]);

    const currentRoleTime = Date.now() - targetStaff.currentRoleStartedAt.getTime();
    const activeTesting = detailStats.testingPeriods.find((p) => p.status === 'ONGOING') ?? detailStats.testingPeriods[0] ?? null;
    const latestGradeChange = snapshot?.gradeHistory?.[0] ?? null;
    const recentWarnings = snapshot?.warnings?.slice(0, 5) ?? [];
    const recentNotes = snapshot?.notesAbout?.slice(0, 5) ?? [];
    const recentActivity = snapshot?.activities?.slice(0, 5) ?? [];

    const accentColor = snapshot?.activeBlacklist ? 'danger' : 'primary';
    const displayName = targetStaff.displayName ?? targetStaff.username ?? user.username;

    const fields: ContainerChild[] = [
      `<@${user.id}>`,
      separator({ divider: true, spacing: 'small' }),
      [
        `${E.arrow} **Grade** · ${formatGrade(targetStaff.grade)}`,
        `${E.arrow} **Depuis ce grade** · ${formatDuration(currentRoleTime)}`,
        `${E.arrow} **Staff depuis** · ${formatDate(targetStaff.joinedStaffAt)}`,
      ].join('\n'),
      [
        `**${E.stats} Activité**`,
        `${E.dot} Messages: **${detailStats.stats.totalMessages.toLocaleString('fr-FR')}**`,
        `${E.dot} Vocal: **${detailStats.stats.totalVoiceMinutes.toLocaleString('fr-FR')} min**`,
        `${E.dot} Warns actifs: **${detailStats.stats.activeWarnings}**`,
        `${E.dot} Sanctions suivies: **${snapshot?.stats.sanctionsIssued ?? detailStats.stats.activeWarnings}**`,
      ].join('\n'),
    ];

    if (snapshot?.publicProfile) {
      fields.push(
        [
          `**${E.info} Contact**`,
          `${E.dot} Pseudo: **${snapshot.publicProfile.displayName ?? snapshot.publicProfile.globalName ?? snapshot.publicProfile.username ?? user.username}**`,
          `${E.dot} Tag: **${snapshot.publicProfile.userTag ?? '-'}**`,
          `${E.dot} Compte: **${formatDate(snapshot.publicProfile.accountCreatedAt)}**`,
          `${E.dot} Arrivé serveur: **${formatDate(snapshot.publicProfile.guildJoinedAt)}**`,
        ].join('\n'),
        [
          `**${E.shield} Signaux staff**`,
          `${E.dot} Notes écrites: **${snapshot.notesWritten.length}** · Reçues: **${snapshot.notesAbout.length}**`,
          `${E.dot} Périodes de test: **${snapshot.testingPeriods.length}** · Clés API: **${snapshot.apiKeys.length}**`,
        ].join('\n'),
      );
    }

    if (snapshot?.activeBlacklist) {
      fields.push(
        separator({ divider: true, spacing: 'small' }),
        [
          `**${E.ban} Blacklist active**`,
          `${E.dot} Raison: **${snapshot.activeBlacklist.reason}**`,
          `${E.dot} Début: **${formatDate(snapshot.activeBlacklist.startDate)}** · Fin: **${formatDate(snapshot.activeBlacklist.endDate)}**`,
        ].join('\n'),
      );
    }

    if (activeTesting) {
      fields.push([
        `**${E.fire} Période de test**`,
        `${E.dot} Statut: ${formatTestingPeriodStatus(activeTesting.status)}`,
        `${E.dot} Mentor: ${activeTesting.mentor ? `<@${activeTesting.mentor.userId}>` : '-'}`,
        `${E.dot} Début: **${formatDate(activeTesting.startDate)}** · Cible: **${activeTesting.targetGrade ?? '-'}**`,
        `${E.dot} Rapports: **${activeTesting.reports?.length ?? 0}**`,
      ].join('\n'));
    }

    if (latestGradeChange) {
      fields.push([
        `**${E.level} Dernier changement de grade**`,
        `${E.dot} ${formatDate(latestGradeChange.dateIso)} - ${latestGradeChange.action}`,
        truncate(latestGradeChange.details, 400),
      ].join('\n'));
    }

    if (recentWarnings.length > 0) {
      fields.push([
        `**${E.warning} Warns récents**`,
        ...recentWarnings.map(w => `${E.dot} ${formatDate(w.createdAt)} - ${truncate(w.reason, 60)}`),
      ].join('\n'));
    }

    if (recentNotes.length > 0) {
      fields.push([
        `**${E.messages} Dernières notes**`,
        ...recentNotes.map(n => `${E.dot} ${formatDate(n.createdAt)} - ${truncate(n.content, 60)}`),
      ].join('\n'));
    }

    if (recentActivity.length > 0) {
      fields.push([
        `**${E.calendar} Activité récente**`,
        ...recentActivity.map(a => `${E.dot} ${formatDate(a.activityDate)} - ${a.messageCount} msg / ${a.voiceMinutes} min`),
      ].join('\n'));
    }

    await interaction.editReply(v2Message(
      kotboContainer({
        color: accentColor,
        title: `${E.profile} Profil Staff · ${displayName}`,
        titleThumbnail: { url: snapshot?.publicProfile?.avatarUrl ?? user.displayAvatarURL() },
        fields,
        footerTitle: 'Profil staff',
      }),
    ));
  } catch (error) {
    logger.error('Profil', `Erreur lors de la récupération du profil: ${String(error)}`);
    await interaction.editReply({ content: `${E.error} Une erreur est survenue lors de la récupération du profil.` });
  }
}

export const profilCommand = { data, execute } satisfies SlashCommandDefinition;
