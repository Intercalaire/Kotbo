import type { SlashCommandDefinition } from '../../commands.js';
import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { createGiveaway, endGiveaway, rerollGiveaway } from '../../services/features/giveawayService.js';
import { canManageGiveaways } from '../../services/features/giveawayConfigService.js';
import prisma from '../../utils/db.js';
import { extractTrackingInfo, resolveModuleFromCommand, wrapModuleTracking } from '../../utils/moduleTracking.js';

// Pas de `setDefaultMemberPermissions` : Discord masquerait la commande aux
// rôles gestionnaires configurés dans l'onglet Configuration du dashboard, qui
// n'ont pas forcément « Gérer les messages ». Le droit est donc vérifié à
// l'exécution par `canManageGiveaways`.
const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('🎉 Gérer les giveaways/concours')
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription('🎉 Démarrer un nouveau giveaway')
      .addStringOption((o) => o.setName('prix').setDescription('Le prix à gagner').setRequired(true))
      .addIntegerOption((o) => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true))
      .addIntegerOption((o) => o.setName('duree').setDescription('Durée en minutes').setRequired(true))
      .addStringOption((o) => o.setName('description').setDescription('Description additionnelle').setRequired(false))
      .addChannelOption((o) => o.setName('salon').setDescription('Salon de publication (défaut: salon actuel)').setRequired(false))
      .addIntegerOption((o) => o.setName('xp').setDescription('XP RPG bonus à faire gagner').setRequired(false))
      .addIntegerOption((o) => o.setName('pieces').setDescription('KotboCoins bonus à faire gagner').setRequired(false))
      .addStringOption((o) => o.setName('objet').setDescription("ID de l'objet RPG bonus à faire gagner").setRequired(false))
      .addBooleanOption((o) => o.setName('validation').setDescription('Requérir la validation du staff avant de donner le gain').setRequired(false))
  )
  .addSubcommand((sub) =>
    sub
      .setName('end')
      .setDescription('🛑 Terminer un giveaway actif immédiatement')
      .addStringOption((o) => o.setName('id').setDescription('ID du giveaway à terminer').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('reroll')
      .setDescription('🎲 Désigner un nouveau gagnant pour un giveaway terminé')
      .addStringOption((o) => o.setName('id').setDescription('ID du giveaway').setRequired(true))
  );

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const { guildId, userId } = extractTrackingInfo(interaction);
  const moduleName = resolveModuleFromCommand('giveaway');
  const subcommand = interaction.options.getSubcommand();

  // Wrapper pour tracker les performances et l'utilisation
  await wrapModuleTracking(
    moduleName,
    executeInternal,
    [interaction],
    {
      actionType: 'command',
      actionName: subcommand,
      guildId,
      userId,
    }
  );
}

async function executeInternal(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: '❌ Cette commande doit être utilisée sur un serveur.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Administrateurs, « Gérer les messages », ou rôles gestionnaires déclarés
  // dans l'onglet Configuration des giveaways.
  const member = interaction.guild
    ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
    : null;
  if (!(await canManageGiveaways(member, guildId))) {
    await interaction.reply({
      content: "❌ Tu n'as pas la permission de gérer les giveaways de ce serveur.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'start') {
    const prize = interaction.options.getString('prix', true);
    const winners = interaction.options.getInteger('gagnants', true);
    const duration = interaction.options.getInteger('duree', true);
    const description = interaction.options.getString('description') || undefined;
    const channel = interaction.options.getChannel('salon') || interaction.channel;
    const rpgXp = interaction.options.getInteger('xp') || 0;
    const rpgCoins = interaction.options.getInteger('pieces') || 0;
    const rpgItemId = interaction.options.getString('objet') || null;
    const needValidation = interaction.options.getBoolean('validation') || false;

    if (!channel || !('send' in channel)) {
      await interaction.reply({ content: '❌ Salon invalide.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    await interaction.reply({ content: '⏳ Création du giveaway...', flags: [MessageFlags.Ephemeral] });
    try {
      const giveaway = await createGiveaway(
        interaction.client,
        guildId,
        channel.id,
        prize,
        winners,
        duration,
        description,
        rpgXp,
        rpgCoins,
        rpgItemId,
        needValidation,
        interaction.user.id
      );
      await interaction.editReply(`🎉 Giveaway créé avec succès ! (ID : \`${giveaway.id}\`)`);
    } catch (err) {
      await interaction.editReply(`❌ ${err instanceof Error ? err.message : 'Erreur lors de la création du giveaway.'}`);
    }
  }
  
  else if (subcommand === 'end') {
    const id = interaction.options.getString('id', true).trim();
    const giveaway = await prisma.giveaway.findUnique({ where: { id } });

    if (!giveaway || giveaway.guildId !== guildId) {
      await interaction.reply({ content: '❌ Giveaway introuvable.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    if (giveaway.ended) {
      await interaction.reply({ content: '❌ Ce giveaway est déjà terminé.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    await interaction.reply({ content: '⏳ Clôture du giveaway...', flags: [MessageFlags.Ephemeral] });
    await endGiveaway(interaction.client, id, guildId);
    await interaction.editReply(`🛑 Le giveaway \`${id}\` a été clôturé.`);
  } 
  
  else if (subcommand === 'reroll') {
    const id = interaction.options.getString('id', true).trim();
    const giveaway = await prisma.giveaway.findUnique({ where: { id } });

    if (!giveaway || giveaway.guildId !== guildId) {
      await interaction.reply({ content: '❌ Giveaway introuvable.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    if (!giveaway.ended) {
      await interaction.reply({ content: "❌ Ce giveaway n'est pas encore terminé.", flags: [MessageFlags.Ephemeral] });
      return;
    }

    await interaction.reply({ content: "⏳ Tirage d'un nouveau gagnant...", flags: [MessageFlags.Ephemeral] });
    await rerollGiveaway(interaction.client, id, guildId);
    await interaction.editReply(`🎲 Un nouveau gagnant a été tiré au sort pour le giveaway \`${id}\`.`);
  }
}

export const giveawayCommand = { data, execute } satisfies SlashCommandDefinition;
