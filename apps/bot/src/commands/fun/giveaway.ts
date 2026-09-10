import type { SlashCommandDefinition } from '../../commands.js';
import { SlashCommandBuilder, MessageFlags, type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { createGiveaway, endGiveaway, rerollGiveaway } from '../../services/features/giveawayService.js';
import { canManageGiveaways } from '../../services/features/giveawayConfigService.js';
import { findGiveawayTemplateByName, listGiveawayTemplates } from '../../services/features/giveawayTemplateService.js';
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
      .addStringOption((o) => o.setName('prix').setDescription('Le prix à gagner').setRequired(false))
      .addIntegerOption((o) => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(false))
      .addIntegerOption((o) => o.setName('duree').setDescription('Durée en minutes').setRequired(false))
      .addStringOption((o) =>
        o
          .setName('modele')
          .setDescription('Modèle de concours à reprendre (les autres options le complètent)')
          .setRequired(false)
          .setAutocomplete(true)
      )
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
    const templateName = interaction.options.getString('modele');
    const template = templateName ? await findGiveawayTemplateByName(guildId, templateName) : null;
    if (templateName && !template) {
      await interaction.reply({ content: `❌ Aucun modèle nommé « ${templateName} » sur ce serveur.`, flags: [MessageFlags.Ephemeral] });
      return;
    }

    // Les options saisies priment sur le modèle : il sert de point de départ,
    // pas de carcan. Prix, gagnants et durée ne sont plus obligatoires pour
    // Discord, puisqu'un modèle peut les porter : c'est donc ici qu'on exige
    // qu'ils viennent de l'une des deux sources.
    const prize = interaction.options.getString('prix') ?? template?.prize;
    const winners = interaction.options.getInteger('gagnants') ?? template?.winnerCount;
    const duration = interaction.options.getInteger('duree') ?? template?.durationMinutes;
    if (!prize || !winners || !duration) {
      await interaction.reply({
        content: '❌ Renseigne le prix, le nombre de gagnants et la durée, ou choisis un modèle qui les porte.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const description = interaction.options.getString('description') ?? template?.description ?? undefined;
    const rpgXp = interaction.options.getInteger('xp') ?? template?.rpgXp ?? 0;
    const rpgCoins = interaction.options.getInteger('pieces') ?? template?.rpgCoins ?? 0;
    const rpgItemId = interaction.options.getString('objet') ?? template?.rpgItemId ?? null;
    const needValidation = interaction.options.getBoolean('validation') ?? template?.needValidation ?? false;

    // On ne résout que l'identifiant : `createGiveaway` vérifie déjà que le
    // salon existe et que le bot peut y écrire, et le dit mieux que nous.
    const channelId = interaction.options.getChannel('salon')?.id
      ?? template?.channelId
      ?? interaction.channelId;
    if (!channelId) {
      await interaction.reply({ content: '❌ Salon invalide.', flags: [MessageFlags.Ephemeral] });
      return;
    }

    await interaction.reply({ content: '⏳ Création du giveaway...', flags: [MessageFlags.Ephemeral] });
    try {
      const giveaway = await createGiveaway(
        interaction.client,
        guildId,
        channelId,
        prize,
        winners,
        duration,
        description,
        rpgXp,
        rpgCoins,
        rpgItemId,
        needValidation,
        interaction.user.id,
        template?.styleOverrides ?? {}
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

/**
 * Propose les modèles du serveur : leur nom est la seule clef de saisie, une
 * faute de frappe renverrait « modèle introuvable ».
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const query = interaction.options.getFocused().toLowerCase();
  const templates = await listGiveawayTemplates(interaction.guildId).catch(() => []);
  const matches = templates
    .filter((template) => template.name.toLowerCase().includes(query))
    .slice(0, 25)
    .map((template) => ({ name: `${template.name} — ${template.prize}`.slice(0, 100), value: template.name }));

  await interaction.respond(matches).catch(() => undefined);
}

export const giveawayCommand = { data, execute, autocomplete } satisfies SlashCommandDefinition;
