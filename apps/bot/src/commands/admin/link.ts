import type { SlashCommandDefinition } from '../../commands.js';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { COLORS, successEmbed, errorEmbed } from '../../utils/embeds.js';
import {
  createLinkInvite,
  acceptLinkInvite,
  createDirectLink,
  listLinksForGuild,
  needsMessageMapping,
  removeLink,
  updateLinkConfig,
} from '../../services/features/channelLinkService.js';
import { isGuildActivated } from '../../utils/activation.js';
import { isLinkGuestGuild } from '../../services/features/channelLinkGuestService.js';
import { INVITE_SOURCE, recordBotInvite } from '../../services/analytics/inviteService.js';

const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Gérer les liens entre salons de différents serveurs')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('invite')
      .setDescription('Générer un code d\'invitation pour lier un salon')
      .addChannelOption((opt) =>
        opt
          .setName('salon')
          .setDescription('Le salon à lier')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('direction')
          .setDescription('Direction du lien')
          .addChoices(
            { name: 'Bidirectionnel', value: 'BIDIRECTIONAL' },
            { name: 'Unidirectionnel (ce serveur → autre)', value: 'UNIDIRECTIONAL' },
          ),
      )
      .addStringOption((opt) =>
        opt
          .setName('mode')
          .setDescription('Mode de relay')
          .addChoices(
            { name: 'Webhook (pseudo + avatar miroir)', value: 'WEBHOOK' },
            { name: 'Embed (message dans un embed signé)', value: 'EMBED' },
          ),
      )
      .addBooleanOption((opt) =>
        opt
          .setName('invitation-serveur')
          .setDescription('Créer aussi une invitation Discord pour rejoindre ce serveur'),
      )
      .addBooleanOption((opt) =>
        opt.setName('modifier-topic').setDescription('Mettre à jour la description des salons (défaut: oui)'),
      )
      .addBooleanOption((opt) =>
        opt.setName('lien-dans-topic').setDescription('Inclure un lien cliquable vers le salon lié dans le topic (défaut: oui)'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('accept')
      .setDescription('Accepter une invitation de lien avec un code')
      .addStringOption((opt) =>
        opt.setName('code').setDescription('Le code d\'invitation').setRequired(true),
      )
      .addChannelOption((opt) =>
        opt
          .setName('salon')
          .setDescription('Le salon local à lier')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('salon')
      .setDescription('Lier deux salons du même serveur')
      .addChannelOption((opt) =>
        opt
          .setName('salon-source')
          .setDescription('Le premier salon')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addChannelOption((opt) =>
        opt
          .setName('salon-cible')
          .setDescription('Le second salon')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('direction')
          .setDescription('Direction du lien')
          .addChoices(
            { name: 'Bidirectionnel', value: 'BIDIRECTIONAL' },
            { name: 'Unidirectionnel (source → cible)', value: 'UNIDIRECTIONAL' },
          ),
      )
      .addStringOption((opt) =>
        opt
          .setName('mode')
          .setDescription('Mode de relay')
          .addChoices(
            { name: 'Webhook (pseudo + avatar miroir)', value: 'WEBHOOK' },
            { name: 'Embed (message dans un embed signé)', value: 'EMBED' },
          ),
      )
      .addBooleanOption((opt) =>
        opt.setName('modifier-topic').setDescription('Mettre à jour la description des salons (défaut: oui)'),
      )
      .addBooleanOption((opt) =>
        opt.setName('lien-dans-topic').setDescription('Inclure un lien cliquable vers le salon lié dans le topic (défaut: oui)'),
      )
      .addBooleanOption((opt) =>
        opt.setName('threads').setDescription('Synchroniser les threads et leurs messages (défaut: non)'),
      )
      .addBooleanOption((opt) =>
        opt.setName('sondages').setDescription('Relayer les sondages (défaut: non)'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('direct')
      .setDescription('Créer un lien direct cross-serveur (nécessite d\'être admin des 2 serveurs)')
      .addChannelOption((opt) =>
        opt
          .setName('salon-source')
          .setDescription('Le salon source (ce serveur)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName('serveur-cible').setDescription('ID du serveur cible').setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName('salon-cible').setDescription('ID du salon cible').setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('direction')
          .setDescription('Direction du lien')
          .addChoices(
            { name: 'Bidirectionnel', value: 'BIDIRECTIONAL' },
            { name: 'Unidirectionnel', value: 'UNIDIRECTIONAL' },
          ),
      )
      .addStringOption((opt) =>
        opt
          .setName('mode')
          .setDescription('Mode de relay')
          .addChoices(
            { name: 'Webhook', value: 'WEBHOOK' },
            { name: 'Embed', value: 'EMBED' },
          ),
      )
      .addBooleanOption((opt) =>
        opt.setName('modifier-topic').setDescription('Mettre à jour la description des salons (défaut: oui)'),
      )
      .addBooleanOption((opt) =>
        opt.setName('lien-dans-topic').setDescription('Inclure un lien cliquable vers le salon lié dans le topic (défaut: oui)'),
      )
      .addBooleanOption((opt) =>
        opt.setName('threads').setDescription('Synchroniser les threads et leurs messages (défaut: non)'),
      )
      .addBooleanOption((opt) =>
        opt.setName('sondages').setDescription('Relayer les sondages (défaut: non)'),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('Lister tous les liens de ce serveur'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Voir le mode du bot sur ce serveur et ce qui est réellement enregistré'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Supprimer un lien')
      .addStringOption((opt) =>
        opt.setName('id').setDescription('ID du lien à supprimer').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('config')
      .setDescription('Modifier la configuration d\'un lien')
      .addStringOption((opt) =>
        opt.setName('id').setDescription('ID du lien').setRequired(true),
      )
      .addBooleanOption((opt) => opt.setName('texte').setDescription('Relayer le texte'))
      .addBooleanOption((opt) => opt.setName('images').setDescription('Relayer les images'))
      .addBooleanOption((opt) => opt.setName('embeds').setDescription('Relayer les embeds'))
      .addBooleanOption((opt) => opt.setName('reactions').setDescription('Relayer les réactions'))
      .addBooleanOption((opt) => opt.setName('edits').setDescription('Relayer les modifications'))
      .addBooleanOption((opt) => opt.setName('deletes').setDescription('Relayer les suppressions'))
      .addBooleanOption((opt) => opt.setName('actif').setDescription('Activer/désactiver le lien'))
      .addBooleanOption((opt) => opt.setName('threads').setDescription('Synchroniser les threads'))
      .addBooleanOption((opt) => opt.setName('sondages').setDescription('Relayer les sondages'))
      .addBooleanOption((opt) => opt.setName('epingles').setDescription('Synchroniser les messages épinglés'))
      .addBooleanOption((opt) => opt.setName('modifier-topic').setDescription('Mettre à jour auto le topic des salons')),
  );

/**
 * Sous-commandes accessibles à un serveur sans code d'activation.
 *
 * `/link` franchit la garde d'activation (voir `GATE_EXEMPT_COMMANDS` dans
 * index.ts) pour qu'un serveur invité puisse accepter un pont sans code, puis
 * le consulter et le rompre. Il ne gagne pas pour autant le droit d'ouvrir des
 * ponts pour son propre compte : `invite`, `salon` et `direct` restent réservés
 * aux serveurs disposant d'une licence.
 */
const SUBCOMMANDS_WITHOUT_ACTIVATION = new Set(['accept', 'list', 'remove', 'status']);

async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ ephemeral: true });

  if (
    interaction.guildId &&
    !isGuildActivated(interaction.guildId) &&
    !SUBCOMMANDS_WITHOUT_ACTIVATION.has(sub)
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          'Serveur non activé',
          "Ce serveur n'a pas de clé d'activation Kotbo.\n\n" +
            "Il peut malgré tout être relié à un serveur activé : demandez-y `/link invite`, " +
            'puis lancez ici `/link accept code:<code>`.\n\n' +
            'Utilisez `/link status` pour voir ce que le bot fait - et ne fait pas - sur ce serveur.',
        ),
      ],
    });
    return;
  }

  switch (sub) {
    case 'invite':
      return handleInvite(interaction);
    case 'accept':
      return handleAccept(interaction);
    case 'salon':
      return handleSameServer(interaction);
    case 'direct':
      return handleDirect(interaction);
    case 'list':
      return handleList(interaction);
    case 'status':
      return handleStatus(interaction);
    case 'remove':
      return handleRemove(interaction);
    case 'config':
      return handleConfig(interaction);
  }
}

async function handleInvite(interaction: ChatInputCommandInteraction) {
  const channel = interaction.options.getChannel('salon', true);
  const direction = (interaction.options.getString('direction') ?? 'BIDIRECTIONAL') as 'BIDIRECTIONAL' | 'UNIDIRECTIONAL';
  const relayMode = (interaction.options.getString('mode') ?? 'WEBHOOK') as 'WEBHOOK' | 'EMBED';
  const createServerInvite = interaction.options.getBoolean('invitation-serveur') ?? false;

  const invite = await createLinkInvite({
    guildId: interaction.guildId!,
    channelId: channel.id,
    createdByUserId: interaction.user.id,
    direction,
    relayMode,
  });

  let serverInviteUrl = '';
  if (createServerInvite) {
    try {
      const guild = interaction.guild!;
      const targetChannel = guild.channels.cache.get(channel.id);
      if (targetChannel && 'createInvite' in targetChannel && typeof targetChannel.createInvite === 'function') {
        const discordInvite = await targetChannel.createInvite({
          maxAge: 24 * 60 * 60,
          maxUses: 5,
          reason: `Kotbo Link: Invitation pour lier le salon #${channel.id}`,
        });
        serverInviteUrl = discordInvite.url;
        // Le serveur distant n'est pas encore connu à ce stade de l'appairage.
        await recordBotInvite(discordInvite, INVITE_SOURCE.channelLinkPairing());
      }
    } catch {
      serverInviteUrl = '';
    }
  }

  const description = [
    `**Code :** \`${invite.code}\``,
    `**Salon :** <#${channel.id}>`,
    `**Direction :** ${direction === 'BIDIRECTIONAL' ? 'Bidirectionnel' : 'Unidirectionnel'}`,
    `**Mode :** ${relayMode === 'WEBHOOK' ? 'Webhook (miroir)' : 'Embed'}`,
    `**Expire :** <t:${Math.floor(invite.expiresAt.getTime() / 1000)}:R>`,
    '',
    `Utilisez \`/link accept code:${invite.code}\` sur l'autre serveur pour compléter le lien.`,
  ];

  if (serverInviteUrl) {
    description.push('', `**Invitation serveur :** ${serverInviteUrl}`);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🔗 Invitation de lien créée')
    .setDescription(description.join('\n'))
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleAccept(interaction: ChatInputCommandInteraction) {
  const code = interaction.options.getString('code', true).trim().toUpperCase();
  const channel = interaction.options.getChannel('salon', true);

  const result = await acceptLinkInvite({
    code,
    targetGuildId: interaction.guildId!,
    targetChannelId: channel.id,
    updateTopic: true,
    includeTopicLink: true,
    client: interaction.client,
  });

  if ('error' in result) {
    await interaction.editReply({ embeds: [errorEmbed('Erreur', result.error)] });
    return;
  }

  const sourceGuild = interaction.client.guilds.cache.get(result.link.sourceGuildId);
  const lines = [
    `Le salon <#${channel.id}> est maintenant lié à **#${result.link.sourceChannelId}** ` +
      `sur **${sourceGuild?.name || result.link.sourceGuildId}**.`,
    '',
    `**Direction :** ${result.link.direction === 'BIDIRECTIONAL' ? 'Bidirectionnel' : 'Unidirectionnel'}`,
    `**ID du lien :** \`${result.link.id}\``,
  ];

  // Ce serveur n'a pas de code : le préciser franchement évite qu'on croie
  // avoir activé Kotbo en entier en acceptant un pont.
  if (!isGuildActivated(interaction.guildId!)) {
    lines.push(
      '',
      '🔒 **Mode liaison seule.** Ce serveur reste sans clé d\'activation : le bot n\'y fait ' +
        'circuler que les messages du salon relié. Aucun autre module n\'est actif et aucune ' +
        'donnée d\'activité n\'est enregistrée.',
      'Détail complet : `/link status`.',
    );
  }

  await interaction.editReply({ embeds: [successEmbed('🔗 Lien établi !', lines.join('\n'))] });
}

async function handleSameServer(interaction: ChatInputCommandInteraction) {
  const sourceChannel = interaction.options.getChannel('salon-source', true);
  const targetChannel = interaction.options.getChannel('salon-cible', true);
  const direction = (interaction.options.getString('direction') ?? 'BIDIRECTIONAL') as 'BIDIRECTIONAL' | 'UNIDIRECTIONAL';
  const relayMode = (interaction.options.getString('mode') ?? 'WEBHOOK') as 'WEBHOOK' | 'EMBED';
  const updateTopic = interaction.options.getBoolean('modifier-topic') ?? true;
  const includeTopicLink = interaction.options.getBoolean('lien-dans-topic') ?? true;

  if (sourceChannel.id === targetChannel.id) {
    await interaction.editReply({
      embeds: [errorEmbed('Erreur', 'Impossible de lier un salon à lui-même.')],
    });
    return;
  }

  const relayThreads = interaction.options.getBoolean('threads') ?? false;
  const relayPolls = interaction.options.getBoolean('sondages') ?? false;

  const result = await createDirectLink({
    sourceGuildId: interaction.guildId!,
    sourceChannelId: sourceChannel.id,
    targetGuildId: interaction.guildId!,
    targetChannelId: targetChannel.id,
    createdByUserId: interaction.user.id,
    direction,
    relayMode,
    relayThreads,
    relayPolls,
    updateTopic,
    includeTopicLink,
    client: interaction.client,
  });

  if ('error' in result) {
    await interaction.editReply({ embeds: [errorEmbed('Erreur', result.error)] });
    return;
  }

  const topicInfo = updateTopic ? '\n**Topic :** Mis à jour automatiquement ✅' : '';
  const embed = successEmbed(
    '🔗 Salons liés !',
    `**Source :** <#${sourceChannel.id}>\n` +
    `**Cible :** <#${targetChannel.id}>\n` +
    `**Direction :** ${direction === 'BIDIRECTIONAL' ? 'Bidirectionnel' : 'Unidirectionnel'}\n` +
    `**Mode :** ${relayMode === 'WEBHOOK' ? 'Webhook (miroir)' : 'Embed'}` +
    topicInfo +
    `\n**ID :** \`${result.id}\``,
  );

  await interaction.editReply({ embeds: [embed] });
}

async function handleDirect(interaction: ChatInputCommandInteraction) {
  const sourceChannel = interaction.options.getChannel('salon-source', true);
  const targetGuildId = interaction.options.getString('serveur-cible', true);
  const targetChannelId = interaction.options.getString('salon-cible', true);
  const direction = (interaction.options.getString('direction') ?? 'BIDIRECTIONAL') as 'BIDIRECTIONAL' | 'UNIDIRECTIONAL';
  const relayMode = (interaction.options.getString('mode') ?? 'WEBHOOK') as 'WEBHOOK' | 'EMBED';

  const targetGuild = interaction.client.guilds.cache.get(targetGuildId);
  if (!targetGuild) {
    await interaction.editReply({
      embeds: [errorEmbed('Erreur', 'Le bot n\'est pas présent sur le serveur cible.')],
    });
    return;
  }

  const targetChannel = targetGuild.channels.cache.get(targetChannelId);
  if (!targetChannel || !targetChannel.isTextBased()) {
    await interaction.editReply({
      embeds: [errorEmbed('Erreur', 'Le salon cible est introuvable ou n\'est pas un salon texte.')],
    });
    return;
  }

  const updateTopic = interaction.options.getBoolean('modifier-topic') ?? true;
  const includeTopicLink = interaction.options.getBoolean('lien-dans-topic') ?? true;
  const relayThreads = interaction.options.getBoolean('threads') ?? false;
  const relayPolls = interaction.options.getBoolean('sondages') ?? false;

  const result = await createDirectLink({
    sourceGuildId: interaction.guildId!,
    sourceChannelId: sourceChannel.id,
    targetGuildId,
    targetChannelId,
    createdByUserId: interaction.user.id,
    direction,
    relayMode,
    relayThreads,
    relayPolls,
    updateTopic,
    includeTopicLink,
    client: interaction.client,
  });

  if ('error' in result) {
    await interaction.editReply({ embeds: [errorEmbed('Erreur', result.error)] });
    return;
  }

  const embed = successEmbed(
    '🔗 Lien direct créé !',
    `**Source :** <#${sourceChannel.id}> (${interaction.guild!.name})\n` +
    `**Cible :** #${targetChannel.name} (${targetGuild.name})\n` +
    `**Direction :** ${direction === 'BIDIRECTIONAL' ? 'Bidirectionnel' : 'Unidirectionnel'}\n` +
    `**Mode :** ${relayMode === 'WEBHOOK' ? 'Webhook' : 'Embed'}\n` +
    `**ID :** \`${result.id}\``,
  );

  await interaction.editReply({ embeds: [embed] });
}

async function handleList(interaction: ChatInputCommandInteraction) {
  const links = await listLinksForGuild(interaction.guildId!);

  if (links.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.info).setDescription('Aucun lien de salon configuré.')],
    });
    return;
  }

  const lines = links.map((l) => {
    const isSource = l.sourceGuildId === interaction.guildId;
    const localChannelId = isSource ? l.sourceChannelId : l.targetChannelId;
    const remoteGuildId = isSource ? l.targetGuildId : l.sourceGuildId;
    const remoteChannelId = isSource ? l.targetChannelId : l.sourceChannelId;
    const remoteGuild = interaction.client.guilds.cache.get(remoteGuildId);
    const directionIcon = l.direction === 'BIDIRECTIONAL' ? '↔️' : '→';
    const modeLabel = (isSource ? l.targetRelayMode : l.sourceRelayMode) === 'WEBHOOK' ? 'WH' : 'EM';
    const statusIcon = l.enabled ? '🟢' : '🔴';

    return `${statusIcon} \`${l.id.slice(0, 8)}\` <#${localChannelId}> ${directionIcon} **${remoteGuild?.name || remoteGuildId}** #${remoteChannelId} [${modeLabel}]`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🔗 Liens de salons')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${links.length} lien(s)` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Rend lisible, pour un administrateur du serveur relié, ce que le bot fait
 * réellement chez lui. La question posée par les communautés attachées à leur
 * vie privée n'est pas « quelles options ai-je cochées » mais « qu'est-ce qui
 * est écrit quelque part » : c'est donc à cela que cet écran répond.
 */
async function handleStatus(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const activated = isGuildActivated(guildId);
  const links = await listLinksForGuild(guildId);
  const activeLinks = links.filter((l) => l.enabled);

  if (activated) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('🔓 Serveur activé')
      .setDescription(
        'Ce serveur dispose d\'une clé d\'activation : les modules Kotbo y sont disponibles ' +
          'selon la configuration du dashboard.\n\n' +
          `**Liens de salons :** ${activeLinks.length} actif(s) sur ${links.length}.\n` +
          'La collecte de statistiques d\'activité se coupe depuis le dashboard ' +
          '(Paramètres généraux → *Statistiques d\'activité*) ; une fois désactivée, plus rien ' +
          'n\'est enregistré sur les membres.',
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (!isLinkGuestGuild(guildId)) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('⚪ Bot inactif sur ce serveur')
      .setDescription(
        "Ce serveur n'a ni clé d'activation, ni lien avec un serveur activé : le bot n'y fait " +
          'strictement rien et n\'enregistre rien.\n\n' +
          'Pour ouvrir un pont : demandez `/link invite` sur le serveur activé, puis lancez ici ' +
          '`/link accept code:<code>`.',
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const storesMapping = activeLinks.some((l) => needsMessageMapping(l));
  const bridged = activeLinks
    .map((l) => {
      const isSource = l.sourceGuildId === guildId;
      const localChannelId = isSource ? l.sourceChannelId : l.targetChannelId;
      const remoteGuild = interaction.client.guilds.cache.get(isSource ? l.targetGuildId : l.sourceGuildId);
      return `• <#${localChannelId}> ${l.direction === 'BIDIRECTIONAL' ? '↔️' : '→'} **${remoteGuild?.name ?? 'serveur lié'}**`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🔒 Mode liaison seule')
    .setDescription(
      'Ce serveur **ne possède pas de clé d\'activation**. Le bot y est présent pour une seule ' +
        'raison : faire circuler les messages des salons reliés ci-dessous.\n\n' +
        `${bridged || '*Aucun lien actif.*'}`,
    )
    .addFields(
      {
        name: '✅ Ce que le bot fait',
        value:
          'Recopier les messages des salons reliés, dans les deux sens, avec le pseudo et ' +
          'l\'avatar de leur auteur.',
      },
      {
        name: '🚫 Ce qu\'il ne fait pas',
        value:
          "Aucun module n'est actif ici : ni statistiques, ni niveaux, ni économie, ni " +
          "modération, ni journalisation. Les événements de ce serveur n'atteignent même pas " +
          'ces modules - ils sont écartés avant, et seul le relais les reçoit.',
      },
      {
        name: '💾 Ce qui est enregistré',
        value: storesMapping
          ? "Uniquement la correspondance entre l'identifiant d'un message et celui de sa copie, " +
            'nécessaire pour propager les modifications, suppressions et réactions. Aucun contenu, ' +
            'aucun profil, aucune statistique. Désactivez ces trois relais pour que même cette ' +
            'correspondance cesse d\'être écrite.'
          : 'Rien. Ces liens ne relaient ni modification, ni suppression, ni réaction : aucune ' +
            'ligne n\'est écrite en base pour les messages qui transitent.',
      },
      {
        name: '🚪 Pour tout arrêter',
        value: '`/link remove id:<id>` ou l\'expulsion du bot met fin au pont immédiatement.',
      },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleRemove(interaction: ChatInputCommandInteraction) {
  const linkId = interaction.options.getString('id', true);
  const deleted = await removeLink(linkId, interaction.client);

  if (!deleted) {
    await interaction.editReply({ embeds: [errorEmbed('Erreur', 'Lien introuvable.')] });
    return;
  }

  await interaction.editReply({
    embeds: [successEmbed('🗑️ Lien supprimé', `Le lien \`${linkId}\` a été supprimé.`)],
  });
}

async function handleConfig(interaction: ChatInputCommandInteraction) {
  const linkId = interaction.options.getString('id', true);

  const updates: Record<string, boolean | string | undefined> = {};
  const texte = interaction.options.getBoolean('texte');
  const images = interaction.options.getBoolean('images');
  const embeds = interaction.options.getBoolean('embeds');
  const reactions = interaction.options.getBoolean('reactions');
  const edits = interaction.options.getBoolean('edits');
  const deletes = interaction.options.getBoolean('deletes');
  const actif = interaction.options.getBoolean('actif');
  const threads = interaction.options.getBoolean('threads');
  const sondages = interaction.options.getBoolean('sondages');
  const epingles = interaction.options.getBoolean('epingles');
  const modifierTopic = interaction.options.getBoolean('modifier-topic');

  if (texte !== null) updates.relayText = texte;
  if (images !== null) updates.relayImages = images;
  if (embeds !== null) updates.relayEmbeds = embeds;
  if (reactions !== null) updates.relayReactions = reactions;
  if (edits !== null) updates.relayEdits = edits;
  if (deletes !== null) updates.relayDeletes = deletes;
  if (actif !== null) updates.enabled = actif;
  if (threads !== null) updates.relayThreads = threads;
  if (sondages !== null) updates.relayPolls = sondages;
  if (epingles !== null) updates.relayPins = epingles;
  if (modifierTopic !== null) updates.updateTopic = modifierTopic;

  if (Object.keys(updates).length === 0) {
    await interaction.editReply({
      embeds: [errorEmbed('Erreur', 'Aucune option de configuration spécifiée.')],
    });
    return;
  }

  const updated = await updateLinkConfig(linkId, updates as any);
  if (!updated) {
    await interaction.editReply({ embeds: [errorEmbed('Erreur', 'Lien introuvable.')] });
    return;
  }

  const configLines = [
    `📝 Texte : ${updated.relayText ? '✅' : '❌'}`,
    `🖼️ Images : ${updated.relayImages ? '✅' : '❌'}`,
    `📦 Embeds : ${updated.relayEmbeds ? '✅' : '❌'}`,
    `😀 Réactions : ${updated.relayReactions ? '✅' : '❌'}`,
    `✏️ Éditions : ${updated.relayEdits ? '✅' : '❌'}`,
    `🗑️ Suppressions : ${updated.relayDeletes ? '✅' : '❌'}`,
    `⚡ Actif : ${updated.enabled ? '✅' : '❌'}`,
    `🧵 Threads : ${updated.relayThreads ? '✅' : '❌'}`,
    `📊 Sondages : ${updated.relayPolls ? '✅' : '❌'}`,
    `📌 Épinglages : ${updated.relayPins ? '✅' : '❌'}`,
    `🏷️ Topic auto : ${updated.updateTopic ? '✅' : '❌'}`,
  ];

  const embed = successEmbed(
    '⚙️ Configuration mise à jour',
    `**Lien :** \`${linkId}\`\n\n${configLines.join('\n')}`,
  );

  await interaction.editReply({ embeds: [embed] });
}

export const linkCommand = { data, execute } satisfies SlashCommandDefinition;
