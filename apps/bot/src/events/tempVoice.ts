import {
  Client,
  Events,
  VoiceState,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Interaction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
  RoleSelectMenuBuilder,
  GuildMember,
  type OverwriteResolvable
} from 'discord.js';
import prisma from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { getCachedGuild } from '../utils/cache.js';

// Memory cache for active temporary voice channels: channelId -> { creatorId: string }
export const tempChannels = new Map<string, { creatorId: string }>();

interface TempVoiceGenerator {
  channelId: string;
  categoryId?: string;
  nameTemplate?: string;
  requiredRoleId?: string;
}

interface TempVoiceGuildConfig {
  tempVoiceEnabled: boolean;
  tempVoiceChannelId: string | null;
  tempVoiceCategoryId: string | null;
  tempVoiceNameTemplate: string;
  tempVoiceRequiredRoleId?: string | null;
  tempVoiceGenerators?: unknown;
}

function getGenerators(guildConfig: TempVoiceGuildConfig): TempVoiceGenerator[] {
  const generators: TempVoiceGenerator[] = [];

  // Primary generator (backward compatible)
  if (guildConfig.tempVoiceChannelId) {
    generators.push({
      channelId: guildConfig.tempVoiceChannelId,
      categoryId: guildConfig.tempVoiceCategoryId || undefined,
      nameTemplate: guildConfig.tempVoiceNameTemplate || '🔊 Salon de {user}',
      requiredRoleId: guildConfig.tempVoiceRequiredRoleId || undefined,
    });
  }

  // Additional generators from JSON array
  if (Array.isArray(guildConfig.tempVoiceGenerators)) {
    for (const value of guildConfig.tempVoiceGenerators) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const gen = value as Record<string, unknown>;
      if (typeof gen.channelId === 'string') {
        generators.push({
          channelId: gen.channelId,
          categoryId: typeof gen.categoryId === 'string' ? gen.categoryId : undefined,
          nameTemplate: typeof gen.nameTemplate === 'string' ? gen.nameTemplate : '🔊 Salon de {user}',
          requiredRoleId: typeof gen.requiredRoleId === 'string' ? gen.requiredRoleId : undefined,
        });
      }
    }
  }

  return generators;
}

export function registerTempVoiceListener(client: Client): void {
  // Sync memory cache with DB on startup
  prisma.tempVoiceChannel.findMany()
    .then((dbChannels: Array<{ id: string; creatorId: string; guildId: string; roleId: string | null }>) => {
      for (const chan of dbChannels) {
        tempChannels.set(chan.id, { creatorId: chan.creatorId });
      }
      logger.success('TempVoice', `Chargé ${dbChannels.length} salons temporaires depuis la base de données.`);
    })
    .catch((err: unknown) => {
      logger.error('TempVoice', 'Erreur lors du chargement des salons temporaires :', err);
    });

  // Listen to voice state updates to create/delete channels
  client.on(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
    const { member, guild } = newState;
    if (!member || member.user.bot) return;

    try {
      const guildConfig = await getCachedGuild(guild.id);

      if (!guildConfig || !guildConfig.tempVoiceEnabled) {
        return;
      }

      // 1. Creation: Check if user joined any generator channel
      if (newState.channelId) {
        const generators = getGenerators(guildConfig);
        const matchedGenerator = generators.find(g => g.channelId === newState.channelId);

        if (matchedGenerator) {
          // Check role restriction
          if (matchedGenerator.requiredRoleId && !member.roles.cache.has(matchedGenerator.requiredRoleId)) {
            await newState.disconnect('Accès au salon générateur restreint').catch(() => null);
            await member.send(`❌ Vous n'avez pas le rôle requis pour utiliser le salon générateur de salons temporaires sur le serveur **${guild.name}**.`).catch(() => null);
            return;
          }

          const channelName = (matchedGenerator.nameTemplate || '🔊 Salon de {user}')
            .replace('{user}', member.displayName || member.user.username);

          // Le salon reprend les surcharges de sa categorie au lieu de s'ouvrir
          // a @everyone. Poser un `permissionOverwrites` a la creation coupe la
          // synchronisation avec la categorie : sur un serveur ferme, un salon
          // qui se rouvrirait a tous serait le seul visible des non-membres, et
          // le seul ou entrer sans avoir passe la verification.
          //
          // Ce que le proprietaire recoit s'ajoute par-dessus, sans toucher a
          // qui voit le salon : les boutons de verrouillage ne jouent que sur
          // « Se connecter ».
          const parentCategory = guild.channels.cache.get(matchedGenerator.categoryId);
          const inheritedOverwrites: OverwriteResolvable[] = parentCategory
            ? [...parentCategory.permissionOverwrites.cache.values()].map((overwrite) => ({
                id: overwrite.id,
                type: overwrite.type,
                allow: overwrite.allow,
                deny: overwrite.deny,
              }))
            : [];

          const tempChannel = await guild.channels.create({
            name: channelName.slice(0, 100),
            type: ChannelType.GuildVoice,
            parent: matchedGenerator.categoryId,
            permissionOverwrites: [
              ...inheritedOverwrites.filter((overwrite) => overwrite.id !== member.id),
              {
                id: member.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.Connect,
                  PermissionFlagsBits.Speak,
                  PermissionFlagsBits.MuteMembers,
                  PermissionFlagsBits.DeafenMembers,
                  PermissionFlagsBits.MoveMembers
                ],
              }
            ],
            reason: `Création de salon temporaire pour ${member.user.tag}`,
          });

          await newState.setChannel(tempChannel).catch(() => null);

          tempChannels.set(tempChannel.id, { creatorId: member.id });

          // Save in database
          await prisma.tempVoiceChannel.create({
            data: {
              id: tempChannel.id,
              guildId: guild.id,
              creatorId: member.id,
            }
          }).catch((err: unknown) => logger.error('TempVoice', 'Erreur création salon temporaire BDD :', err));

          const embed = new EmbedBuilder()
            .setTitle('⚙️ Gestion de votre salon vocal')
            .setDescription(`Bonjour <@${member.id}> !\nVous venez de créer votre salon temporaire. Utilisez les boutons ci-dessous pour le configurer.\n\n🔒 **Verrouiller** : Interdit l'accès à @everyone\n🔓 **Déverrouiller** : Autorise l'accès à @everyone\n👥 **Limite** : Modifie le nombre maximum de places\n✏️ **Renommer** : Modifie le nom du salon\n👢 **Expulser** : Expulse un membre du salon\n🚫 **Bannir** : Bannit un membre du salon (bypass staffs)\n➕ **Ajouter** : Autorise un membre à rejoindre\n👑 **Transférer** : Transfère la propriété du salon\n🙋 **Récupérer** : Récupère la propriété (si le propriétaire a quitté)\n🛡️ **Réserver** : Réserve le salon pour un rôle spécifique`)
            .setColor('#5865F2')
            .setTimestamp();

          const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('tempvoice:lock').setLabel('Verrouiller').setStyle(ButtonStyle.Secondary).setEmoji('🔒'),
            new ButtonBuilder().setCustomId('tempvoice:unlock').setLabel('Déverrouiller').setStyle(ButtonStyle.Success).setEmoji('🔓'),
            new ButtonBuilder().setCustomId('tempvoice:limit').setLabel('Limite').setStyle(ButtonStyle.Primary).setEmoji('👥'),
            new ButtonBuilder().setCustomId('tempvoice:rename').setLabel('Renommer').setStyle(ButtonStyle.Primary).setEmoji('✏️')
          );

          const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('tempvoice:kick').setLabel('Expulser').setStyle(ButtonStyle.Danger).setEmoji('👢'),
            new ButtonBuilder().setCustomId('tempvoice:ban').setLabel('Bannir').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
            new ButtonBuilder().setCustomId('tempvoice:trust').setLabel('Ajouter').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('tempvoice:transfer').setLabel('Transférer').setStyle(ButtonStyle.Primary).setEmoji('👑'),
            new ButtonBuilder().setCustomId('tempvoice:claim').setLabel('Récupérer').setStyle(ButtonStyle.Secondary).setEmoji('🙋')
          );

          const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('tempvoice:reserve').setLabel('Réserver').setStyle(ButtonStyle.Secondary).setEmoji('🛡️')
          );

          await tempChannel.send({ content: `<@${member.id}>`, embeds: [embed], components: [row1, row2, row3] }).catch(() => null);
          logger.info('TempVoice', `Salon créé : ${tempChannel.name} (${tempChannel.id})`);
        }
      }

      // 2. Deletion: User leaves a voice channel
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const oldChannel = oldState.channel;
        if (oldChannel && oldChannel.type === ChannelType.GuildVoice && tempChannels.has(oldChannel.id)) {
          if (oldChannel.members.size === 0) {
            tempChannels.delete(oldChannel.id);
            await prisma.tempVoiceChannel.delete({ where: { id: oldChannel.id } }).catch(() => null);
            await oldChannel.delete('Salon vocal temporaire vide').catch(() => null);
            logger.info('TempVoice', `Salon supprimé car vide : ${oldChannel.name} (${oldChannel.id})`);
          }
        }
      }
    } catch (err) {
      logger.error('TempVoice', 'Erreur lors de la gestion voiceStateUpdate :', err);
    }
  });

  // Listen to button/modal interactions for temp voice controls
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.guildId) return;

    // Handle Role Select Menu for Reservation
    if (interaction.isRoleSelectMenu() && interaction.customId === 'tempvoice:reserve_select') {
      const { channel, user, guild } = interaction;
      if (!channel || channel.type !== ChannelType.GuildVoice || !guild) return;

      const cache = tempChannels.get(channel.id);
      if (!cache) {
        await interaction.reply({ content: "❌ Ce salon n'est plus enregistré comme temporaire.", flags: [MessageFlags.Ephemeral] }).catch(() => null);
        return;
      }

      if (cache.creatorId !== user.id) {
        await interaction.reply({ content: '❌ Seul le propriétaire du salon peut effectuer cette action.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
        return;
      }

      const selectedRoleId = interaction.values[0] || null;

      if (selectedRoleId) {
        // Lock connect to everyone
        await channel.permissionOverwrites.edit(guild.id, {
          Connect: false
        }).catch(() => null);

        // Explicitly allow creator
        await channel.permissionOverwrites.edit(user.id, {
          Connect: true,
          ViewChannel: true,
          Speak: true
        }).catch(() => null);

        // Explicitly allow selected role
        await channel.permissionOverwrites.edit(selectedRoleId, {
          Connect: true,
          ViewChannel: true,
          Speak: true
        }).catch(() => null);

        // Save in DB
        await prisma.tempVoiceChannel.update({
          where: { id: channel.id },
          data: { roleId: selectedRoleId }
        }).catch(() => null);

        await interaction.reply({ content: `🛡️ Le salon a été réservé pour le rôle <@&${selectedRoleId}>. Seuls ses membres et vous pouvez le rejoindre.`, flags: [MessageFlags.Ephemeral] }).catch(() => null);
      } else {
        // Reset connect for everyone
        await channel.permissionOverwrites.edit(guild.id, {
          Connect: true
        }).catch(() => null);

        // Clear in DB
        await prisma.tempVoiceChannel.update({
          where: { id: channel.id },
          data: { roleId: null }
        }).catch(() => null);

        await interaction.reply({ content: '🔓 Réservation annulée. Tout le monde peut à nouveau rejoindre.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('tempvoice:')) {
      const { member, channel, user } = interaction;
      if (!channel || channel.type !== ChannelType.GuildVoice) return;

      const cache = tempChannels.get(channel.id);
      if (!cache) {
        await interaction.reply({ content: "❌ Ce salon n'est plus enregistré comme temporaire.", flags: [MessageFlags.Ephemeral] }).catch(() => null);
        return;
      }

      const action = interaction.customId.split(':')[1];

      // Verify creator (all actions except claim require being the creator)
      if (action !== 'claim' && cache.creatorId !== user.id) {
        await interaction.reply({ content: '❌ Seul le propriétaire du salon peut effectuer cette action.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
        return;
      }

      if (action === 'lock') {
        await channel.permissionOverwrites.edit(interaction.guildId, {
          Connect: false
        }).catch(() => null);
        await interaction.reply({ content: '🔒 Le salon a été verrouillé. Plus personne ne peut le rejoindre.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
      }

      else if (action === 'unlock') {
        await channel.permissionOverwrites.edit(interaction.guildId, {
          Connect: true
        }).catch(() => null);
        await interaction.reply({ content: '🔓 Le salon a été déverrouillé. Tout le monde peut le rejoindre.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
      }

      else if (action === 'limit') {
        const modal = new ModalBuilder()
          .setCustomId('tempvoice:limit_modal')
          .setTitle("👥 Limite d'utilisateurs");

        const limitInput = new TextInputBuilder()
          .setCustomId('limit_input')
          .setLabel('Nombre max (0 pour illimité, max 99)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 5')
          .setMaxLength(2)
          .setRequired(true);

        const row = new ActionRowBuilder<TextInputBuilder>().addComponents(limitInput);
        modal.addComponents(row);

        await interaction.showModal(modal).catch(() => null);
      }

      else if (action === 'rename') {
        const modal = new ModalBuilder()
          .setCustomId('tempvoice:rename_modal')
          .setTitle('✏️ Renommer le salon');

        const nameInput = new TextInputBuilder()
          .setCustomId('name_input')
          .setLabel('Nouveau nom du salon')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: Blabla Gaming')
          .setMaxLength(50)
          .setRequired(true);

        const row = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
        modal.addComponents(row);

        await interaction.showModal(modal).catch(() => null);
      }

      else if (action === 'kick') {
        const modal = new ModalBuilder()
          .setCustomId('tempvoice:kick_modal')
          .setTitle('Expulser un membre');

        const userInput = new TextInputBuilder()
          .setCustomId('user_input')
          .setLabel('Pseudo, Tag ou ID Discord du membre')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: klaynight ou 123456789012345678')
          .setRequired(true);

        const row = new ActionRowBuilder<TextInputBuilder>().addComponents(userInput);
        modal.addComponents(row);

        await interaction.showModal(modal).catch(() => null);
      }

      else if (action === 'ban') {
        const modal = new ModalBuilder()
          .setCustomId('tempvoice:ban_modal')
          .setTitle('Bannir un membre');

        const userInput = new TextInputBuilder()
          .setCustomId('user_input')
          .setLabel('Pseudo, Tag ou ID Discord du membre')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: klaynight ou 123456789012345678')
          .setRequired(true);

        const row = new ActionRowBuilder<TextInputBuilder>().addComponents(userInput);
        modal.addComponents(row);

        await interaction.showModal(modal).catch(() => null);
      }

      else if (action === 'trust') {
        const modal = new ModalBuilder()
          .setCustomId('tempvoice:trust_modal')
          .setTitle('Autoriser un membre');

        const userInput = new TextInputBuilder()
          .setCustomId('user_input')
          .setLabel('Pseudo, Tag ou ID Discord du membre')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: klaynight ou 123456789012345678')
          .setRequired(true);

        const row = new ActionRowBuilder<TextInputBuilder>().addComponents(userInput);
        modal.addComponents(row);

        await interaction.showModal(modal).catch(() => null);
      }

      else if (action === 'transfer') {
        const modal = new ModalBuilder()
          .setCustomId('tempvoice:transfer_modal')
          .setTitle('Transférer la propriété');

        const userInput = new TextInputBuilder()
          .setCustomId('user_input')
          .setLabel('Pseudo, Tag ou ID Discord du membre')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: klaynight ou 123456789012345678')
          .setRequired(true);

        const row = new ActionRowBuilder<TextInputBuilder>().addComponents(userInput);
        modal.addComponents(row);

        await interaction.showModal(modal).catch(() => null);
      }

      else if (action === 'claim') {
        const ownerIsPresent = channel.members.has(cache.creatorId);
        if (ownerIsPresent) {
          await interaction.reply({ content: '❌ Le propriétaire actuel du salon vocal est toujours présent.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
          return;
        }

        cache.creatorId = user.id;

        await channel.permissionOverwrites.edit(user.id, {
          ViewChannel: true,
          Connect: true,
          Speak: true,
          MuteMembers: true,
          DeafenMembers: true,
          MoveMembers: true
        }).catch(() => null);

        const memberName = (member && 'displayName' in member) ? (member as GuildMember).displayName : user.username;
        await interaction.reply({ content: `👑 **${memberName}** a récupéré la propriété du salon vocal !` }).catch(() => null);
      }

      else if (action === 'reserve') {
        const roleSelect = new RoleSelectMenuBuilder()
          .setCustomId('tempvoice:reserve_select')
          .setPlaceholder('Sélectionnez un rôle pour réserver le salon')
          .setMinValues(0)
          .setMaxValues(1);

        const selectRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect);

        await interaction.reply({
          content: '🛡️ **Réserver le salon pour un rôle** :\nSélectionnez le rôle qui sera autorisé à voir et rejoindre votre salon vocal. Ne sélectionnez rien pour réinitialiser.',
          components: [selectRow],
          flags: [MessageFlags.Ephemeral]
        }).catch(() => null);
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('tempvoice:')) {
      const { channel, user, guild } = interaction;
      if (!channel || channel.type !== ChannelType.GuildVoice || !guild) return;

      const cache = tempChannels.get(channel.id);
      if (!cache) {
        await interaction.reply({ content: "❌ Ce salon n'est plus enregistré comme temporaire.", flags: [MessageFlags.Ephemeral] }).catch(() => null);
        return;
      }

      const modalId = interaction.customId.split(':')[1];

      // Verification of creator for submissions
      if (modalId !== 'claim' && cache.creatorId !== user.id) {
        await interaction.reply({ content: '❌ Action non autorisée.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
        return;
      }

      if (modalId === 'limit_modal') {
        const limitStr = interaction.fields.getTextInputValue('limit_input');
        const limit = parseInt(limitStr, 10);

        if (isNaN(limit) || limit < 0 || limit > 99) {
          await interaction.reply({ content: '❌ Nombre invalide (doit être entre 0 et 99).', flags: [MessageFlags.Ephemeral] }).catch(() => null);
          return;
        }

        await channel.setUserLimit(limit).catch(() => null);
        await interaction.reply({ content: `👥 Limite fixée à ${limit === 0 ? 'illimité' : limit} membres.`, flags: [MessageFlags.Ephemeral] }).catch(() => null);
      }

      else if (modalId === 'rename_modal') {
        const newName = interaction.fields.getTextInputValue('name_input');
        if (!newName.trim()) {
          await interaction.reply({ content: '❌ Le nom ne peut pas être vide.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
          return;
        }

        await channel.setName(newName.trim()).catch(() => null);
        await interaction.reply({ content: `✏️ Salon renommé en : **${newName.trim()}**`, flags: [MessageFlags.Ephemeral] }).catch(() => null);
      }

      else if (modalId === 'kick_modal' || modalId === 'ban_modal' || modalId === 'trust_modal' || modalId === 'transfer_modal') {
        const input = interaction.fields.getTextInputValue('user_input').trim();
        if (!input) {
          await interaction.reply({ content: '❌ Entrée invalide.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
          return;
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const userId = input.replace(/[^0-9]/g, '');
        let targetMember = userId ? await guild.members.fetch(userId).catch(() => null) : null;
        if (!targetMember) {
          const members = await guild.members.fetch({ query: input, limit: 1 }).catch(() => null);
          targetMember = members?.first() ?? null;
        }

        if (!targetMember) {
          await interaction.editReply({ content: '❌ Membre introuvable sur le serveur.' }).catch(() => null);
          return;
        }

        if (modalId === 'transfer_modal' || modalId === 'trust_modal') {
          if (targetMember.id === user.id) {
            await interaction.editReply({ content: '❌ Vous ne pouvez pas vous cibler vous-même.' }).catch(() => null);
            return;
          }

          if (modalId === 'transfer_modal') {
            await channel.permissionOverwrites.edit(targetMember.id, {
              ViewChannel: true,
              Connect: true,
              Speak: true,
              MuteMembers: true,
              DeafenMembers: true,
              MoveMembers: true
            }).catch(() => null);

            cache.creatorId = targetMember.id;
            await interaction.editReply({ content: `👑 La propriété du salon a été transférée à **${targetMember.displayName}**.` }).catch(() => null);
          } else {
            // Trust action
            await channel.permissionOverwrites.edit(targetMember.id, {
              ViewChannel: true,
              Connect: true,
              Speak: true
            }).catch(() => null);

            await interaction.editReply({ content: `➕ **${targetMember.displayName}** a été autorisé à rejoindre le salon.` }).catch(() => null);
          }
          return;
        }

        if (targetMember.id === user.id) {
          await interaction.editReply({ content: '❌ Vous ne pouvez pas vous cibler vous-même.' }).catch(() => null);
          return;
        }

        // Fetch staff roles config from cache
        const guildConfig = await getCachedGuild(guild.id);

        // Check staff bypass
        const isOwner = targetMember.id === process.env.DISCORD_CLIENT_OWNER_ID || targetMember.id === guild.ownerId;
        const isAdmin = targetMember.permissions.has(PermissionFlagsBits.Administrator);
        const hasStaffRole = !!(
          (guildConfig?.baseStaffRoleId && targetMember.roles.cache.has(guildConfig.baseStaffRoleId)) ||
          (guildConfig?.moderatorRoleId && targetMember.roles.cache.has(guildConfig.moderatorRoleId)) ||
          (guildConfig?.testStaffRoleId && targetMember.roles.cache.has(guildConfig.testStaffRoleId))
        );

        if (isOwner || isAdmin || hasStaffRole) {
          await interaction.editReply({ content: '❌ Vous ne pouvez pas exclure ou bannir un membre du staff (bypass).' }).catch(() => null);
          return;
        }

        if (modalId === 'kick_modal') {
          if (targetMember.voice.channelId !== channel.id) {
            await interaction.editReply({ content: "❌ Ce membre n'est pas dans votre salon vocal." }).catch(() => null);
            return;
          }

          await targetMember.voice.disconnect('Expulsé du salon vocal temporaire par le créateur.').catch(() => null);
          await interaction.editReply({ content: `👢 **${targetMember.displayName}** a été expulsé du salon vocal.` }).catch(() => null);
        } else {
          // Ban action
          await channel.permissionOverwrites.edit(targetMember.id, {
            Connect: false
          }).catch(() => null);

          if (targetMember.voice.channelId === channel.id) {
            await targetMember.voice.disconnect('Banni du salon vocal temporaire par le créateur.').catch(() => null);
          }

          await interaction.editReply({ content: `🚫 **${targetMember.displayName}** a été banni du salon vocal.` }).catch(() => null);
        }
      }
    }
  });

  logger.success('TempVoice', 'Écouteur Vocal Temporaire enregistré');
}
