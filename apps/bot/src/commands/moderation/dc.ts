import type { SlashCommandDefinition } from '../../commands.js';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import * as altAccountService from '../../services/moderation/altAccountService.js';
import prisma from '../../utils/db.js';
import { COLORS, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { scanGuildMembersForYoungAccounts } from '../../services/moderation/dcDetectionService.js';

const data = new SlashCommandBuilder()
  .setName('dc')
  .setDescription('Gestion des doubles comptes et liaisons.')
  .addSubcommand((sub) =>
    sub
      .setName('link')
      .setDescription('Lier deux comptes entre eux.')
      .addUserOption((opt) => opt.setName('compte1').setDescription('Premier compte').setRequired(true))
      .addUserOption((opt) => opt.setName('compte2').setDescription('Deuxième compte').setRequired(true))
      .addStringOption((opt) => opt.setName('raison').setDescription('Raison (obligatoire si non-admin)').setRequired(false))
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Lister les comptes liés à un utilisateur.')
      .addUserOption((opt) => opt.setName('cible').setDescription('Utilisateur à vérifier').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('report')
      .setDescription('Déclarer que vous avez un autre compte (bonne foi).')
      .addUserOption((opt) => opt.setName('principal').setDescription('Votre compte principal').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('unlink')
      .setDescription('Supprimer le lien entre deux comptes.')
      .addUserOption((opt) => opt.setName('compte1').setDescription('Premier compte').setRequired(true))
      .addUserOption((opt) => opt.setName('compte2').setDescription('Deuxième compte').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('scan')
      .setDescription("Scanner les membres et signaler ceux dont le compte est trop récent à l'arrivée.")
      .addIntegerOption((opt) =>
        opt
          .setName('seuil_jours')
          .setDescription('Nombre de jours maximum entre création du compte et arrivée')
          .setMinValue(1)
          .setMaxValue(30)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('rescan')
      .setDescription('Relancer le scan des membres pour détecter les comptes suspects.')
      .addIntegerOption((opt) =>
        opt
          .setName('seuil_jours')
          .setDescription('Nombre de jours maximum entre création du compte et arrivée')
          .setMinValue(1)
          .setMaxValue(30)
          .setRequired(false)
      )
  );

async function canUseModerationTools(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const guild = interaction.guild;
  if (!guild || !interaction.guildId) return false;

  const isStaffDb = await prisma.staffMember.findUnique({ where: { guildId_userId: { guildId: guild.id, userId: interaction.user.id } } });
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;

  return isAdmin || !!isStaffDb || interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) || false;
}

async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'scan' || subcommand === 'rescan') {
    const guild = interaction.guild;
    if (!guild || !interaction.guildId) {
      return interaction.reply({ content: '❌ Cette commande doit être utilisée dans un serveur.', flags: [MessageFlags.Ephemeral] });
    }

    if (!(await canUseModerationTools(interaction))) {
      return interaction.reply({ content: "❌ Tu n'as pas les permissions nécessaires pour lancer ce scan.", flags: [MessageFlags.Ephemeral] });
    }

    const thresholdDays = interaction.options.getInteger('seuil_jours') ?? 3;
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const result = await scanGuildMembersForYoungAccounts(guild, thresholdMs);
    const preview = result.matches.slice(0, 10).map((match) => `• <@${match.userId}> - compte créé ${match.accountAgeLabel} avant l'arrivée`).join('\n');

    const summaryLines = [
      `Membres analysés : **${result.scannedCount}**`,
      `Membres signalés : **${result.flaggedCount}**`,
      `Seuil : **${thresholdDays} jour${thresholdDays > 1 ? 's' : ''}**`,
    ];

    if (result.flaggedCount > 0) {
      summaryLines.push('');
      summaryLines.push('Premiers signalements :');
      summaryLines.push(preview);
      if (result.matches.length > 10) {
        summaryLines.push(`… et ${result.matches.length - 10} autre(s).`);
      }
    }

    await interaction.editReply({
      embeds: [
        infoEmbed(
          'Scan DC terminé',
          summaryLines.join('\n')
        )
      ]
    });
    return;
  }

  if (subcommand === 'link') {
    const u1 = interaction.options.getUser('compte1', true);
    const u2 = interaction.options.getUser('compte2', true);
    const reason = interaction.options.getString('raison');

    if (u1.id === u2.id) {
      return interaction.reply({ content: '❌ Impossible de lier un compte à lui-même.', flags: [MessageFlags.Ephemeral] });
    }

    const guild = interaction.guild;
    if (!guild) return;

    const dbGuild = await prisma.guild.findUnique({ where: { id: guild.id } });
    const isStaffDb = await prisma.staffMember.findUnique({ where: { guildId_userId: { guildId: guild.id, userId: interaction.user.id } } });
    
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;
    // We consider staff if they are in the staff_members table, or have the mod permission
    const isStaff = isAdmin || !!isStaffDb || interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) || false;

    if (!isStaff) {
      // Non-staff: Can only link their own account
      if (u1.id !== interaction.user.id && u2.id !== interaction.user.id) {
        return interaction.reply({ content: '❌ Tu ne peux lier que ton propre compte.', flags: [MessageFlags.Ephemeral] });
      }

      await altAccountService.linkAccounts({
        guildId: interaction.guildId!,
        user1Id: u1.id,
        user2Id: u2.id,
        type: 'MANUAL',
        status: 'PENDING',
        reason: reason || "Déclaration de bonne foi par l'utilisateur",
        linkedByUserId: interaction.user.id,
        metadata: { linkedBy: interaction.user.id, at: new Date().toISOString() }
      });

      // Send log to staff
      const logChannelId = dbGuild?.logChannelId;
      if (logChannelId) {
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel && logChannel.isTextBased()) {
          const staffPing = dbGuild.baseStaffRoleId ? `<@&${dbGuild.baseStaffRoleId}>` : 'Staff';
          const embed = new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle('🛡️ Déclaration de compte secondaire (En attente)')
            .setDescription(`${staffPing} | <@${interaction.user.id}> a déclaré un lien entre <@${u1.id}> et <@${u2.id}>.\n\n*Cette demande est aussi visible sur le Dashboard dans l'onglet Doubles Comptes.*`)
            .addFields(
              { name: 'Compte 1', value: `<@${u1.id}> (${u1.id})`, inline: true },
              { name: 'Compte 2', value: `<@${u2.id}> (${u2.id})`, inline: true },
              { name: 'Raison', value: reason || 'Non fournie', inline: false }
            )
            .setTimestamp();

          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`dc_validate_link:${u1.id}:${u2.id}`)
              .setLabel('Valider la liaison')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`dc_reject_link:${u1.id}:${u2.id}`)
              .setLabel('Rejeter')
              .setStyle(ButtonStyle.Danger)
          );

          await logChannel.send({ content: `${staffPing} <@${u1.id}> <@${u2.id}>`, embeds: [embed], components: [row], allowedMentions: { parse: [] } });
        }
      }

      return interaction.reply({
        content: '✅ Ta demande de liaison a été envoyée aux modérateurs pour validation.',
        flags: [MessageFlags.Ephemeral]
      });
    }

    // Staff Logic
    if (!isAdmin && !reason) {
      return interaction.reply({ content: '❌ En tant que membre du staff, tu dois obligatoirement fournir une raison pour lier ces comptes.', flags: [MessageFlags.Ephemeral] });
    }

    await altAccountService.linkAccounts({
      guildId: interaction.guildId!,
      user1Id: u1.id,
      user2Id: u2.id,
      type: 'MANUAL',
      status: 'VALIDATED',
      reason: reason || 'Action Administrateur',
      linkedByUserId: interaction.user.id,
      metadata: { linkedBy: interaction.user.id, at: new Date().toISOString() }
    });

    const dmEmbed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('🔗 Comptes liés officiellement')
      .setDescription(`Vos comptes **<@${u1.id}>** et **<@${u2.id}>** ont été reliés sur **${guild.name}**.`)
      .addFields({ name: 'Raison / Notes', value: reason || 'Liaison validée par le staff.', inline: false })
      .setTimestamp()
      .setFooter({ text: `Serveur : ${guild.name}` });

    try {
      await u1.send({ embeds: [dmEmbed], allowedMentions: { parse: [] } }).catch(() => null);
    } catch { /* ignored */ }
    try {
      await u2.send({ embeds: [dmEmbed], allowedMentions: { parse: [] } }).catch(() => null);
    } catch { /* ignored */ }

    return interaction.reply({
      embeds: [successEmbed('Comptes liés', `Les comptes <@${u1.id}> et <@${u2.id}> sont désormais liés. Les utilisateurs ont été prévenus par MP.`) ]
    });
  }

  if (subcommand === 'list') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: "❌ Tu n'as pas la permission de modération requise.", flags: [MessageFlags.Ephemeral] });
    }

    const target = interaction.options.getUser('cible', true);
    const linkedIds = await altAccountService.getAllLinkedUserIds(interaction.guildId!, target.id);

    if (linkedIds.length <= 1) {
      return interaction.reply({ content: `ℹ️ Aucun compte lié trouvé pour <@${target.id}>.`, flags: [MessageFlags.Ephemeral] });
    }

    const others = linkedIds.filter(id => id !== target.id);
    const embed = infoEmbed('Comptes liés', `Liste des comptes associés à <@${target.id}> :`)
      .addFields({ name: 'Comptes associés', value: others.map(id => `<@${id}> (${id})`).join('\n') });

    return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  }

  if (subcommand === 'report') {
    const mainAccount = interaction.options.getUser('principal', true);

    if (mainAccount.id === interaction.user.id) {
      return interaction.reply({ content: '❌ Tu ne peux pas te signaler toi-même comme ton propre compte principal.', flags: [MessageFlags.Ephemeral] });
    }

    // Send to staff for validation
    const guild = interaction.guild;
    if (!guild) return;

    const dbGuild = await prisma.guild.findUnique({ where: { id: guild.id } });
    const logChannelId = dbGuild?.logChannelId;

    if (!logChannelId) {
      return interaction.reply({ content: "❌ Le système de logs n'est pas configuré. Contacte un administrateur.", flags: [MessageFlags.Ephemeral] });
    }

    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
    if (!logChannel || !logChannel.isTextBased()) {
      return interaction.reply({ content: '❌ Salon de logs introuvable.', flags: [MessageFlags.Ephemeral] });
    }

    await altAccountService.linkAccounts({
      guildId: interaction.guildId!,
      user1Id: interaction.user.id,
      user2Id: mainAccount.id,
      type: 'MANUAL',
      status: 'PENDING',
      reason: "Déclaration de bonne foi par l'utilisateur",
      linkedByUserId: interaction.user.id,
      metadata: { linkedBy: interaction.user.id, at: new Date().toISOString() }
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('🛡️ Déclaration de compte secondaire (Bonne foi)')
      .setDescription(`<@${interaction.user.id}> déclare que son compte principal est <@${mainAccount.id}>.\n\n*Cette demande est aussi visible sur le Dashboard dans l'onglet Doubles Comptes.*`)
      .addFields(
        { name: 'Compte secondaire', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: true },
        { name: 'Compte principal', value: `<@${mainAccount.id}> (${mainAccount.id})`, inline: true }
      )
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`dc_validate_link:${interaction.user.id}:${mainAccount.id}`)
        .setLabel('Valider la liaison')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`dc_reject_link:${interaction.user.id}:${mainAccount.id}`)
        .setLabel('Rejeter')
        .setStyle(ButtonStyle.Danger)
    );

    await logChannel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });

    return interaction.reply({
      content: '✅ Ta déclaration a été envoyée aux modérateurs pour validation. Merci de ta bonne foi !',
      flags: [MessageFlags.Ephemeral]
    });
  }

  if (subcommand === 'unlink') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: "❌ Tu n'as pas la permission de modération requise.", flags: [MessageFlags.Ephemeral] });
    }

    const u1 = interaction.options.getUser('compte1', true);
    const u2 = interaction.options.getUser('compte2', true);

    await altAccountService.unlinkAccounts(interaction.guildId!, u1.id, u2.id);

    const dmEmbed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('🔗 Comptes déliés')
      .setDescription(`Vos comptes **<@${u1.id}>** et **<@${u2.id}>** ont été séparés sur **${interaction.guild?.name || 'le serveur'}**.`)
      .setTimestamp()
      .setFooter({ text: `Serveur : ${interaction.guild?.name || 'Kotbo'}` });

    try {
      await u1.send({ embeds: [dmEmbed], allowedMentions: { parse: [] } }).catch(() => null);
    } catch { /* ignored */ }
    try {
      await u2.send({ embeds: [dmEmbed], allowedMentions: { parse: [] } }).catch(() => null);
    } catch { /* ignored */ }

    return interaction.reply({
      embeds: [successEmbed('Comptes déliés', `Le lien entre <@${u1.id}> et <@${u2.id}> a été supprimé. Les utilisateurs ont été prévenus par MP.`)]
    });
  }
}

export const dcCommand = { data, execute } satisfies SlashCommandDefinition;
