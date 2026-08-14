import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type TextChannel,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  BaseInteraction,
} from 'discord.js';
import prisma from '../utils/db.js';
import { COLORS, categoryEmoji, feedStatusEmoji, truncate } from '../utils/embeds.js';
import { acknowledgeInteraction, renderPanelTarget } from '../utils/interactionResponses.js';

export async function sendConfigPanel(
  client: Client,
  guildId: string,
  target: TextChannel | BaseInteraction,
): Promise<void> {
  if (target instanceof BaseInteraction) {
    await acknowledgeInteraction(target);
  }
  const guild = await prisma.guild.findUnique({
    where: { id: guildId },
    include: { feeds: { orderBy: { category: 'asc' } } },
  });
  
  if (!guild) return;

  const feedCount = guild.feeds.length;
  const activeFeeds = guild.feeds.filter((f) => f.enabled).length;

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('⚙️ Kotbo - Panneau de Configuration')
    .setDescription(
      '> Gérez les flux RSS, YouTube, le digest et la traduction via les boutons ci-dessous.',
    )
    .addFields(
      { name: '📡 Flux RSS', value: `${activeFeeds}/${feedCount} actifs`, inline: true },
      { name: '▶️ YouTube', value: guild.youtubeEnabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '📅 Digest', value: guild.digestEnabled ? `🟢 ${guild.digestTime} (${guild.digestFrequency === 'WEEKLY' ? 'Hebdo' : 'Quotidien'})` : '🔴 Désactivé', inline: true },
      { name: '🌐 Traduction', value: guild.translationEnabled ? `🟢 → ${guild.defaultTranslateTo}` : '🔴 Désactivée', inline: true },
      { name: '📰 Salon public', value: guild.publicChannelId ? `<#${guild.publicChannelId}>` : '❌ Non défini', inline: true },
      { name: '📊 Salon digest', value: guild.digestChannelId ? `<#${guild.digestChannelId}>` : `<#${guild.publicChannelId ?? '?'}>`, inline: true },
      { name: '📺 Salon YouTube', value: guild.youtubeChannelId ? `<#${guild.youtubeChannelId}>` : (guild.nathanChannelId ? `<#${guild.nathanChannelId}>` : '❌ Par défaut'), inline: true },
      { name: '🛡️ Modérateurs', value: guild.moderatorRoleId ? `<@&${guild.moderatorRoleId}>` : '❌ Admin uniquement', inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'Kotbo · Réservé aux administrateurs' });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('config:feeds').setLabel('📡 Gérer les flux').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('config:youtube_panel').setLabel('▶️ YouTube').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:digest').setLabel('📅 Digest').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:translation').setLabel('🌐 Traduction').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:channels').setLabel('📌 Salons').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('config:keywords').setLabel('🔑 Mots-clés globaux').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:set_mod_role').setLabel('🛡️ Rôle Mod').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:set_yt_channel').setLabel('📺 Salon YT').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:refresh').setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
  );

  await renderPanelTarget(target, { embeds: [embed], components: [row1, row2] });
}

export async function sendFeedsPanel(
  client: Client,
  guildId: string,
  target: TextChannel | BaseInteraction,
): Promise<void> {
  if (target instanceof BaseInteraction) {
    await acknowledgeInteraction(target);
  }
  const feeds = await prisma.feed.findMany({ where: { guildId }, orderBy: { category: 'asc' } });

  if (feeds.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('📡 Flux RSS')
      .setDescription('Aucun flux configuré. Utilisez `/feed add` ou le bouton ci-dessous.');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('config:feed:add').setLabel('➕ Ajouter un flux').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cfg:back:main').setLabel('◀ Retour').setStyle(ButtonStyle.Secondary),
    );
    await renderPanelTarget(target, { embeds: [embed], components: [row] });
    return;
  }

  const byCategory = new Map<string, typeof feeds>();
  for (const f of feeds) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category)!.push(f);
  }

  const allAutoPublish = feeds.every((f) => f.autoPublish);
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`📡 Gestion des Flux RSS (${feeds.length})`)
    .setDescription(
      `Cliquez sur un flux pour le configurer, ou utilisez les boutons rapides.\n` +
      `Statut de l'auto-publication globale : ${allAutoPublish ? '🟢 Activée pour tous' : '🔴 Désactivée / partielle'}`,
    );

  for (const [cat, catFeeds] of byCategory) {
    embed.addFields({
      name: `${categoryEmoji(cat)} ${cat}`,
      value: catFeeds.map((f) => `${feedStatusEmoji(f.enabled)} **${f.name}**${f.autoPublish ? ' ⚡' : ''}`).join('\n'),
    });
  }

  const selectOptions = feeds.slice(0, 25).map((f) => ({
    label: truncate(f.name, 100),
    value: f.id,
    description: `${f.category} · ${f.enabled ? 'Activé' : 'Désactivé'}`,
    emoji: feedStatusEmoji(f.enabled),
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('config:feed:select')
    .setPlaceholder('Sélectionner un flux à gérer...')
    .addOptions(selectOptions);

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('config:feed:autopub_all')
      .setLabel(allAutoPublish ? "⚡ Désactiver l'auto-publication (tous)" : "⚡ Activer l'auto-publication (tous)")
      .setStyle(allAutoPublish ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('config:feed:add').setLabel('➕ Ajouter').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cfg:back:main').setLabel('◀ Retour').setStyle(ButtonStyle.Secondary),
  );

  await renderPanelTarget(target, { embeds: [embed], components: [row1, row2] });
}

export async function sendRoleSelectionPanel(
  client: Client,
  guildId: string,
  target: TextChannel | BaseInteraction,
): Promise<void> {
  if (target instanceof BaseInteraction) {
    await acknowledgeInteraction(target);
  }
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🛡️ Configuration du Rôle Modérateur')
    .setDescription('Sélectionnez le rôle qui sera autorisé à valider, rejeter et épingler les actualités.\n\n*Les administrateurs conservent toujours ces droits.*');

  const select = new RoleSelectMenuBuilder()
    .setCustomId('config:select_mod_role')
    .setPlaceholder('Choisir un rôle...')
    .setMinValues(1)
    .setMaxValues(1);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select);
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('cfg:back:main').setLabel('◀ Retour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:reset_mod_role').setLabel('🗑️ Réinitialiser').setStyle(ButtonStyle.Danger),
  );

  await renderPanelTarget(target, { embeds: [embed], components: [row1, row2] });
}

export async function sendChannelSelectionPanel(
  client: Client,
  guildId: string,
  target: TextChannel | BaseInteraction,
): Promise<void> {
  if (target instanceof BaseInteraction) {
    await acknowledgeInteraction(target);
  }
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📺 Configuration du salon YouTube')
    .setDescription("Sélectionnez le salon où seront envoyées les vidéos YouTube validées.\n\n*Si rien n'est défini, le salon public sera utilisé.*");

  const select = new ChannelSelectMenuBuilder()
    .setCustomId('config:select_yt_channel')
    .setPlaceholder('Choisir un salon...')
    .addChannelTypes(ChannelType.GuildText);

  const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select);
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('cfg:back:main').setLabel('◀ Retour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:reset_yt_channel').setLabel('🗑️ Réinitialiser').setStyle(ButtonStyle.Danger),
  );

  await renderPanelTarget(target, { embeds: [embed], components: [row1, row2] });
}

export async function sendYouTubeConfigPanel(
  client: Client,
  guildId: string,
  target: TextChannel | BaseInteraction,
): Promise<void> {
  if (target instanceof BaseInteraction) {
    await acknowledgeInteraction(target);
  }
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) return;

  const shortRoleId = guild.youtubeShortRoleId;
  const videoRoleId = guild.youtubeVideoRoleId;

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('▶️ Configuration YouTube')
    .setDescription('Gérez les paramètres de diffusion des vidéos YouTube.')
    .addFields(
      { name: 'Statut', value: guild.youtubeEnabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: 'Salon', value: guild.youtubeChannelId ? `<#${guild.youtubeChannelId}>` : (guild.nathanChannelId ? `<#${guild.nathanChannelId}>` : '❌ Par défaut'), inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '🔔 Mention Shorts', value: shortRoleId ? `<@&${shortRoleId}>` : '❌ Aucune', inline: true },
      { name: '🔔 Mention Vidéos', value: videoRoleId ? `<@&${videoRoleId}>` : '❌ Aucune', inline: true },
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('config:youtube_toggle').setLabel(guild.youtubeEnabled ? '🔴 Désactiver' : '🟢 Activer').setStyle(guild.youtubeEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('config:set_yt_channel').setLabel('📺 Salon YouTube').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('config:yt_role_short').setLabel('📱 Rôle Shorts').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:yt_role_video').setLabel('🎥 Rôle Vidéos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cfg:back:main').setLabel('◀ Retour').setStyle(ButtonStyle.Secondary),
  );

  await renderPanelTarget(target, { embeds: [embed], components: [row1, row2] });
}

export async function sendYouTubeRoleSelectionPanel(
  client: Client,
  guildId: string,
  target: TextChannel | BaseInteraction,
  type: 'short' | 'video'
): Promise<void> {
  if (target instanceof BaseInteraction) {
    await acknowledgeInteraction(target);
  }
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(type === 'short' ? '📱 Rôle pour les Shorts' : '🎥 Rôle pour les Vidéos')
    .setDescription(`Sélectionnez le rôle qui sera mentionné lors de la publication d'un **${type === 'short' ? 'Short' : 'vidéo longue'}**.`);

  const select = new RoleSelectMenuBuilder()
    .setCustomId(`config:select_yt_${type}_role`)
      .setPlaceholder('Choisir un rôle...')
    .setMinValues(1)
    .setMaxValues(1);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select);
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('config:youtube_panel').setLabel('◀ Retour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`config:reset_yt_${type}_role`).setLabel('🗑️ Réinitialiser').setStyle(ButtonStyle.Danger),
  );

  await renderPanelTarget(target, { embeds: [embed], components: [row1, row2] });
}


export function buildAddFeedModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('modal:feed:add')
    .setTitle('➕ Ajouter un flux RSS')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('feed_name').setLabel('Nom du flux').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('feed_url').setLabel('URL du flux RSS').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(500),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('feed_category').setLabel('Catégorie (ex: Actualité Tech Générale (France), Cybersécurité & Open Source...)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50).setPlaceholder('Général'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('feed_lang').setLabel('Langue source (ex: fr, en) · Traduction cible (ex: FR)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10).setPlaceholder('ex: en → FR pour auto-traduire'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('feed_autopublish').setLabel('Auto-publier sans validation ? (oui/non)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3).setPlaceholder('non'),
      ),
    );
}

export async function sendDigestPanel(
  client: Client,
  guildId: string,
  target: TextChannel | BaseInteraction,
): Promise<void> {
  if (target instanceof BaseInteraction) {
    await acknowledgeInteraction(target);
  }
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) return;

  const freq = guild.digestFrequency;
  const roleId = guild.digestRoleId;
  const customText = guild.digestCustomText;

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📅 Configuration du digest')
    .setDescription('Configurez le récapitulatif des articles validés.')
    .addFields(
      { name: 'Statut', value: guild.digestEnabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: 'Fréquence', value: freq === 'WEEKLY' ? '📅 Hebdomadaire (dimanche)' : '📆 Quotidien', inline: true },
      { name: 'Heure', value: guild.digestTime, inline: true },
      { name: "Rôle à mentionner", value: roleId ? `<@&${roleId}>` : "❌ Aucun", inline: true },
      { name: "Texte d'introduction", value: customText ? "✅ Défini" : "❌ Non défini", inline: true },
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('config:digest:toggle').setLabel(guild.digestEnabled ? '🔴 Désactiver' : '🟢 Activer').setStyle(guild.digestEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('config:digest:freq').setLabel(freq === 'DAILY' ? 'Passer en hebdomadaire' : 'Passer en quotidien').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('config:digest:text').setLabel('📝 Texte et heure').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('config:digest:role').setLabel('🛡️ Rôle à mentionner').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cfg:back:main').setLabel('◀ Retour Menu').setStyle(ButtonStyle.Secondary),
  );

  await renderPanelTarget(target, { embeds: [embed], components: [row1, row2] });
}

export async function sendDigestRoleSelectionPanel(
  client: Client,
  guildId: string,
  target: TextChannel | BaseInteraction,
): Promise<void> {
  if (target instanceof BaseInteraction) {
    await acknowledgeInteraction(target);
  }
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🛡️ Configuration du rôle pour le digest')
    .setDescription("Sélectionnez le rôle qui sera mentionné lors de l'envoi du digest.");

  const select = new RoleSelectMenuBuilder()
    .setCustomId('config:digest:select_role')
    .setPlaceholder('Choisir un rôle...')
    .setMinValues(1)
    .setMaxValues(1);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select);
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('config:digest:panel').setLabel('◀ Retour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:digest:reset_role').setLabel('🗑️ Réinitialiser').setStyle(ButtonStyle.Danger),
  );

  await renderPanelTarget(target, { embeds: [embed], components: [row1, row2] });
}

export function buildDigestModal(guild?: { digestTime?: string | null, digestCustomText?: string | null } | null): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('modal:digest:config')
    .setTitle('📅 Paramètres du digest')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("digest_time").setLabel("Heure d'envoi (HH:MM)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(guild?.digestTime ?? "08:00"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("digest_text").setLabel("Texte d'introduction (optionnel)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500).setValue(guild?.digestCustomText ?? ""),
      ),
    );
}

export async function sendGlobalKeywordsPanel(
  client: Client,
  guildId: string,
  target: TextChannel | BaseInteraction,
): Promise<void> {
  if (target instanceof BaseInteraction) {
    await acknowledgeInteraction(target);
  }
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) return;

  const formatKws = (kws: string[]) => {
    if (kws.length === 0) return '*Aucun*';
    let str = kws.map((w) => `\`${w}\``).join(', ');
    if (str.length > 1000) {
      str = str.slice(0, 997) + '...';
    }
    return str;
  };

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🔑 Mots-clés Globaux')
    .setDescription("Ces mots-clés s'appliquent à TOUS les flux RSS du serveur.")
    .addFields(
      { name: `✅ Toujours inclure (${guild.globalIncludeKeywords.length})`, value: formatKws(guild.globalIncludeKeywords), inline: false },
      { name: `🚫 Toujours exclure (${guild.globalExcludeKeywords.length})`, value: formatKws(guild.globalExcludeKeywords), inline: false },
      { name: `🗑️ Mots ignorés (${guild.globalIgnoredKeywords.length})`, value: formatKws(guild.globalIgnoredKeywords), inline: false },
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('config:kw:global:include').setLabel('➕ Inclure').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('config:kw:global:exclude').setLabel('➖ Exclure').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('config:kw:global:ignore').setLabel('🗑️ Ignorer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('config:kw:global:clear_confirm').setLabel('🧹 Tout effacer').setStyle(ButtonStyle.Danger),
  );

  const allKeywords = [
    ...guild.globalIncludeKeywords.map(k => ({ label: `[Inclure] ${truncate(k, 50)}`, value: `global:include:${k}` })),
    ...guild.globalExcludeKeywords.map(k => ({ label: `[Exclure] ${truncate(k, 50)}`, value: `global:exclude:${k}` })),
    ...guild.globalIgnoredKeywords.map(k => ({ label: `[Ignorer] ${truncate(k, 50)}`, value: `global:ignore:${k}` })),
  ].slice(0, 25);

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [row1];

  if (allKeywords.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('config:kw:remove')
      .setPlaceholder('Sélectionner un mot-clé à supprimer...')
      .addOptions(allKeywords);
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  const rowBack = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('cfg:back:main').setLabel('◀ Retour Menu').setStyle(ButtonStyle.Secondary),
  );
  components.push(rowBack);

  await renderPanelTarget(target, { embeds: [embed], components });
}

export async function sendFeedKeywordsPanel(
  client: Client,
  guildId: string,
  feedId: string,
  target: TextChannel | BaseInteraction,
): Promise<void> {
  if (target instanceof BaseInteraction) {
    await acknowledgeInteraction(target);
  }
  const feed = await prisma.feed.findUnique({ where: { id: feedId } });
  if (!feed) return;

  const formatKws = (kws: string[]) => {
    if (kws.length === 0) return '*Aucun*';
    let str = kws.map((w) => `\`${w}\``).join(', ');
    if (str.length > 1000) {
      str = str.slice(0, 997) + '...';
    }
    return str;
  };

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`🔑 Mots-clés limités à un flux`)
    .setDescription(`Configuration des mots-clés pour le flux **${feed.name}**.\n*Note : les mots-clés globaux s'ajoutent à ceux-ci.*`)
    .addFields(
      { name: `✅ Inclure (${feed.includeKeywords.length})`, value: formatKws(feed.includeKeywords), inline: false },
      { name: `🚫 Exclure (${feed.excludeKeywords.length})`, value: formatKws(feed.excludeKeywords), inline: false },
      { name: `🗑️ Mots ignorés (${feed.ignoredKeywords.length})`, value: formatKws(feed.ignoredKeywords), inline: false },
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`config:kw:feed:include:${feed.id}`).setLabel('➕ Inclure').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`config:kw:feed:exclude:${feed.id}`).setLabel('➖ Exclure').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`config:kw:feed:ignore:${feed.id}`).setLabel('🗑️ Ignorer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`config:kw:feed:clear_confirm:${feed.id}`).setLabel('🧹 Tout effacer').setStyle(ButtonStyle.Danger),
  );

  const allKeywords = [
    ...feed.includeKeywords.map(k => ({ label: `[Inclure] ${truncate(k, 50)}`, value: `feed:${feed.id}:include:${k}` })),
    ...feed.excludeKeywords.map(k => ({ label: `[Exclure] ${truncate(k, 50)}`, value: `feed:${feed.id}:exclude:${k}` })),
    ...feed.ignoredKeywords.map(k => ({ label: `[Ignorer] ${truncate(k, 50)}`, value: `feed:${feed.id}:ignore:${k}` })),
  ].slice(0, 25);

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [row1];

  if (allKeywords.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('config:kw:remove')
      .setPlaceholder('Sélectionner un mot-clé à supprimer...')
      .addOptions(allKeywords);
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('config:feeds').setLabel('◀ Retour Flux').setStyle(ButtonStyle.Secondary),
  );
  components.push(row2);

  await renderPanelTarget(target, { embeds: [embed], components });
}

export function buildKeywordModal(
  customId: string,
  title: string,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(truncate(title, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('keywords_input')
          .setLabel('Nouveau(x) mot(s) (séparés par ",")')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('ex: appel, iphone, ios\n\n(Ceux-ci seront ajoutés à la liste existante)'),
      ),
    );
}
