import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommandDefinition } from '../../commands.js';
import { COLORS, successEmbed, errorEmbed } from '../../utils/embeds.js';
import {
  getRaidProtectionConfig,
  upsertRaidProtectionConfig,
  activateRaidMode,
  deactivateRaidMode,
  enableJoinLock,
  disableJoinLock,
  enableDmLock,
  disableDmLock,
} from '../../services/moderation/raidProtectionService.js';
import { rescanGuildTagRoles } from '../../services/moderation/tagRoleService.js';
import { getReportStats } from '../../services/moderation/reportService.js';

const data = new SlashCommandBuilder()
  .setName('protection')
  .setDescription('🛡️ Protection anti-raid : captcha, raid mode, locks, reports, anti-scam')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommandGroup((group) =>
    group
      .setName('captcha')
      .setDescription('Vérification des nouveaux membres par captcha')
      .addSubcommand((sub) =>
        sub
          .setName('activer')
          .setDescription('Active le captcha à l\'arrivée')
          .addChannelOption((opt) =>
            opt.setName('salon').setDescription('Salon de vérification').addChannelTypes(ChannelType.GuildText).setRequired(true))
          .addRoleOption((opt) =>
            opt.setName('role').setDescription('Rôle @Non-vérifié appliqué à l\'arrivée').setRequired(true))
          .addIntegerOption((opt) =>
            opt.setName('delai').setDescription('Minutes avant expiration (défaut 10)').setMinValue(2).setMaxValue(60))
          .addIntegerOption((opt) =>
            opt.setName('tentatives').setDescription('Tentatives max (défaut 3)').setMinValue(1).setMaxValue(10))
          .addStringOption((opt) =>
            opt.setName('sanction').setDescription('Action en cas d\'échec').addChoices(
              { name: 'Expulsion (kick)', value: 'KICK' },
              { name: 'Bannissement', value: 'BAN' },
            ))
          .addChannelOption((opt) =>
            opt.setName('salon-logs').setDescription('Salon de logs captcha').addChannelTypes(ChannelType.GuildText)))
      .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactive le captcha')))
  .addSubcommandGroup((group) =>
    group
      .setName('antiraid')
      .setDescription('Détection automatique des vagues d\'arrivées')
      .addSubcommand((sub) =>
        sub
          .setName('activer')
          .setDescription('Active la détection de raid')
          .addIntegerOption((opt) =>
            opt.setName('seuil').setDescription('Nombre d\'arrivées déclenchant l\'alerte (défaut 10)').setMinValue(3).setMaxValue(100))
          .addIntegerOption((opt) =>
            opt.setName('fenetre').setDescription('Fenêtre en secondes (défaut 60)').setMinValue(10).setMaxValue(600))
          .addStringOption((opt) =>
            opt.setName('action').setDescription('Action automatique en cas de raid').addChoices(
              { name: 'Bloquer les arrivées (join lock)', value: 'LOCK' },
              { name: 'Captcha forcé', value: 'CAPTCHA' },
              { name: 'Expulsion automatique', value: 'KICK' },
            ))
          .addChannelOption((opt) =>
            opt.setName('salon-alertes').setDescription('Salon des alertes de raid').addChannelTypes(ChannelType.GuildText))
          .addIntegerOption((opt) =>
            opt.setName('duree').setDescription('Minutes avant désactivation auto du raid mode (défaut 30)').setMinValue(5).setMaxValue(1440)))
      .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactive la détection de raid')))
  .addSubcommandGroup((group) =>
    group
      .setName('raidmode')
      .setDescription('Activation manuelle du mode raid')
      .addSubcommand((sub) => sub.setName('on').setDescription('Active immédiatement le mode raid'))
      .addSubcommand((sub) => sub.setName('off').setDescription('Désactive le mode raid')))
  .addSubcommandGroup((group) =>
    group
      .setName('joinlock')
      .setDescription('Blocage des nouvelles arrivées sur le serveur')
      .addSubcommand((sub) =>
        sub
          .setName('on')
          .setDescription('Bloque les nouvelles arrivées')
          .addIntegerOption((opt) =>
            opt.setName('duree').setDescription('Durée en heures (vide = permanent)').setMinValue(1).setMaxValue(720)))
      .addSubcommand((sub) => sub.setName('off').setDescription('Réautorise les arrivées')))
  .addSubcommandGroup((group) =>
    group
      .setName('dmlock')
      .setDescription('Blocage des messages privés entre membres (dépasse la limite native de 24h)')
      .addSubcommand((sub) =>
        sub
          .setName('on')
          .setDescription('Bloque les MP issus du serveur')
          .addIntegerOption((opt) =>
            opt.setName('duree').setDescription('Durée en heures (vide = permanent)').setMinValue(1).setMaxValue(720)))
      .addSubcommand((sub) => sub.setName('off').setDescription('Réautorise les MP')))
  .addSubcommandGroup((group) =>
    group
      .setName('reports')
      .setDescription('Signalements communautaires vers un salon staff')
      .addSubcommand((sub) =>
        sub
          .setName('activer')
          .setDescription('Active les signalements')
          .addChannelOption((opt) =>
            opt.setName('salon').setDescription('Salon staff recevant les signalements').addChannelTypes(ChannelType.GuildText).setRequired(true))
          .addIntegerOption((opt) =>
            opt.setName('cooldown').setDescription('Secondes entre deux signalements par membre (défaut 60)').setMinValue(0).setMaxValue(3600))
          .addBooleanOption((opt) =>
            opt.setName('anonyme').setDescription('Masquer l\'auteur du signalement au staff')))
      .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactive les signalements')))
  .addSubcommandGroup((group) =>
    group
      .setName('tagrole')
      .setDescription('Rôle automatique pour les membres arborant le tag du serveur')
      .addSubcommand((sub) =>
        sub
          .setName('activer')
          .setDescription('Active le rôle tag')
          .addRoleOption((opt) => opt.setName('role').setDescription('Rôle attribué').setRequired(true)))
      .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactive le rôle tag'))
      .addSubcommand((sub) => sub.setName('rescan').setDescription('Resynchronise le rôle pour tous les membres')))
  .addSubcommandGroup((group) =>
    group
      .setName('scam')
      .setDescription('Filtre des liens d\'arnaques (faux Nitro, phishing)')
      .addSubcommand((sub) =>
        sub
          .setName('activer')
          .setDescription('Active le filtre anti-scam')
          .addStringOption((opt) =>
            opt.setName('action').setDescription('Action appliquée').addChoices(
              { name: 'Supprimer uniquement', value: 'DELETE' },
              { name: 'Supprimer + avertir', value: 'DELETE_AND_WARN' },
              { name: 'Supprimer + timeout', value: 'DELETE_AND_TIMEOUT' },
              { name: 'Supprimer + bannir', value: 'DELETE_AND_BAN' },
            ))
          .addChannelOption((opt) =>
            opt.setName('salon-alertes').setDescription('Salon des alertes').addChannelTypes(ChannelType.GuildText))
          .addBooleanOption((opt) =>
            opt.setName('images').setDescription('Bloquer aussi les images scam connues (base alimentée par le honeypot)')))
      .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactive le filtre anti-scam')))
  .addSubcommandGroup((group) =>
    group
      .setName('invites')
      .setDescription('Contrôle des invitations : urgence, règle unitaire, validation, anti-spam')
      .addSubcommand((sub) =>
        sub
          .setName('activer')
          .setDescription('Active le contrôle des invitations')
          .addBooleanOption((opt) =>
            opt.setName('unitaire').setDescription('Supprimer toute invitation non unitaire (≠ 1 usage, pas de ∞)'))
          .addBooleanOption((opt) =>
            opt.setName('validation').setDescription('Toute invitation doit être validée par le staff'))
          .addIntegerOption((opt) =>
            opt.setName('seuil-spam').setDescription('Nombre de créations déclenchant une alerte (défaut 5)').setMinValue(2).setMaxValue(50))
          .addIntegerOption((opt) =>
            opt.setName('fenetre-spam').setDescription('Fenêtre anti-spam en secondes (défaut 60)').setMinValue(10).setMaxValue(3600))
          .addChannelOption((opt) =>
            opt.setName('salon-alertes').setDescription('Salon des alertes et validations').addChannelTypes(ChannelType.GuildText))
          .addRoleOption((opt) =>
            opt.setName('role-exempt').setDescription('Rôle exempté des règles d\'invitation')))
      .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactive le contrôle des invitations'))
      .addSubcommand((sub) =>
        sub
          .setName('urgence')
          .setDescription('Mode urgence : supprime TOUTES les invitations (existantes et futures)')
          .addBooleanOption((opt) =>
            opt.setName('actif').setDescription('true = activer, false = désactiver').setRequired(true))))
  .addSubcommand((sub) => sub.setName('status').setDescription('État de tous les modules de protection'));

async function execute(interaction: ChatInputCommandInteraction) {
  const guild = interaction.guild;
  if (!guild) return;

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  // ── /protection status ──────────────────────────────────────────────────────
  if (!group && sub === 'status') {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const config = await getRaidProtectionConfig(guild.id);
    const reportStats = config?.reportsEnabled ? await getReportStats(guild.id) : null;

    const on = '🟢 Activé';
    const off = '🔴 Désactivé';
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('🛡️ Protection anti-raid - État des modules')
      .addFields(
        {
          name: '🔐 Captcha',
          value: config?.captchaEnabled
            ? `${on} - salon <#${config.captchaChannelId}>, ${config.captchaTimeoutMinutes} min, ${config.captchaMaxAttempts} tentatives, échec = ${config.captchaFailAction}`
            : off,
        },
        {
          name: '🚨 Anti-raid',
          value: config?.antiRaidEnabled
            ? `${on} - ${config.antiRaidJoinThreshold} joins / ${config.antiRaidJoinWindowSec}s → ${config.antiRaidAction}`
            : off,
        },
        {
          name: '⚡ Raid mode',
          value: config?.raidModeActive
            ? `🟠 **ACTIF** depuis <t:${Math.floor((config.raidModeActivatedAt?.getTime() ?? Date.now()) / 1000)}:R> (${config.raidModeManual ? 'manuel' : 'auto'})`
            : 'Inactif',
        },
        {
          name: '🔒 Join lock',
          value: config?.joinLockEnabled
            ? `${on}${config.joinLockUntil ? ` - jusqu'à <t:${Math.floor(config.joinLockUntil.getTime() / 1000)}:f>` : ' - permanent'}`
            : off,
        },
        {
          name: '✉️ DM lock',
          value: config?.dmLockEnabled
            ? `${on}${config.dmLockUntil ? ` - jusqu'à <t:${Math.floor(config.dmLockUntil.getTime() / 1000)}:f>` : ' - permanent'}`
            : off,
        },
        {
          name: '🚩 Signalements',
          value: config?.reportsEnabled
            ? `${on} - salon <#${config.reportsChannelId}>${reportStats ? ` · ${reportStats.pending} en attente, ${reportStats.resolved} traités` : ''}`
            : off,
        },
        {
          name: '🏷️ Tag role',
          value: config?.tagRoleEnabled ? `${on} - rôle <@&${config.tagRoleId}>` : off,
        },
        {
          name: '🎣 Anti-scam',
          value: config?.scamFilterEnabled
            ? `${on} - action ${config.scamFilterAction}${config.scamImageFilterEnabled ? ' · images scam bloquées 🖼️' : ''}`
            : off,
        },
        {
          name: '🔗 Contrôle des invitations',
          value: config?.inviteGuardEnabled
            ? `${on}${config.inviteEmergencyEnabled ? ' - 🚨 **MODE URGENCE**' : ''} - unitaire: ${config.inviteRequireUnitary ? '✅' : '❌'} · validation: ${config.inviteValidationEnabled ? '✅' : '❌'} · spam: ${config.inviteSpamThreshold}/${config.inviteSpamWindowSec}s`
            : off,
        },
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── captcha ─────────────────────────────────────────────────────────────────
  if (group === 'captcha') {
    if (sub === 'activer') {
      const channel = interaction.options.getChannel('salon', true);
      const role = interaction.options.getRole('role', true);
      await upsertRaidProtectionConfig(guild.id, {
        captchaEnabled: true,
        captchaChannelId: channel.id,
        captchaUnverifiedRoleId: role.id,
        captchaTimeoutMinutes: interaction.options.getInteger('delai') ?? 10,
        captchaMaxAttempts: interaction.options.getInteger('tentatives') ?? 3,
        captchaFailAction: interaction.options.getString('sanction') ?? 'KICK',
        captchaLogChannelId: interaction.options.getChannel('salon-logs')?.id ?? null,
      });
      await interaction.reply({
        embeds: [successEmbed('Captcha activé', `Les nouveaux membres recevront le rôle ${role} et devront résoudre un captcha dans ${channel}.\n\n⚠️ Vérifie que le rôle ${role} n'a accès **qu'à** ${channel}.`)],
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await upsertRaidProtectionConfig(guild.id, { captchaEnabled: false });
      await interaction.reply({ embeds: [successEmbed('Captcha désactivé')], flags: [MessageFlags.Ephemeral] });
    }
    return;
  }

  // ── antiraid ────────────────────────────────────────────────────────────────
  if (group === 'antiraid') {
    if (sub === 'activer') {
      await upsertRaidProtectionConfig(guild.id, {
        antiRaidEnabled: true,
        antiRaidJoinThreshold: interaction.options.getInteger('seuil') ?? 10,
        antiRaidJoinWindowSec: interaction.options.getInteger('fenetre') ?? 60,
        antiRaidAction: interaction.options.getString('action') ?? 'LOCK',
        antiRaidAlertChannelId: interaction.options.getChannel('salon-alertes')?.id ?? null,
        antiRaidAutoDisableMinutes: interaction.options.getInteger('duree') ?? 30,
      });
      const config = await getRaidProtectionConfig(guild.id);
      await interaction.reply({
        embeds: [successEmbed('Anti-raid activé', `Détection : **${config?.antiRaidJoinThreshold} arrivées** en **${config?.antiRaidJoinWindowSec}s** → action **${config?.antiRaidAction}**.`)],
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await upsertRaidProtectionConfig(guild.id, { antiRaidEnabled: false });
      await interaction.reply({ embeds: [successEmbed('Anti-raid désactivé')], flags: [MessageFlags.Ephemeral] });
    }
    return;
  }

  // ── raidmode ────────────────────────────────────────────────────────────────
  if (group === 'raidmode') {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const config = await getRaidProtectionConfig(guild.id);
    if (sub === 'on') {
      if (config?.raidModeActive) {
        await interaction.editReply({ embeds: [errorEmbed('Mode raid déjà actif')] });
        return;
      }
      const base = config ?? (await upsertRaidProtectionConfig(guild.id, {}));
      await activateRaidMode(guild, base, true, interaction.user.id);
      await interaction.editReply({ embeds: [successEmbed('Mode raid activé', `Action appliquée : **${base.antiRaidAction}**. Désactivation manuelle uniquement.`)] });
    } else {
      if (!config?.raidModeActive) {
        await interaction.editReply({ embeds: [errorEmbed('Le mode raid n\'est pas actif')] });
        return;
      }
      await deactivateRaidMode(guild, config);
      await interaction.editReply({ embeds: [successEmbed('Mode raid désactivé')] });
    }
    return;
  }

  // ── joinlock / dmlock ───────────────────────────────────────────────────────
  if (group === 'joinlock' || group === 'dmlock') {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const hours = interaction.options.getInteger('duree');
    const until = hours ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;
    const isJoin = group === 'joinlock';

    if (sub === 'on') {
      if (isJoin) await enableJoinLock(guild, until);
      else await enableDmLock(guild, until);
      await interaction.editReply({
        embeds: [successEmbed(
          isJoin ? 'Join lock activé' : 'DM lock activé',
          `${isJoin ? 'Les nouvelles arrivées sont bloquées' : 'Les messages privés issus du serveur sont bloqués'}${until ? ` jusqu'à <t:${Math.floor(until.getTime() / 1000)}:f>` : ' **en permanence** (renouvellement automatique)'}.`
        )],
      });
    } else {
      if (isJoin) await disableJoinLock(guild);
      else await disableDmLock(guild);
      await interaction.editReply({ embeds: [successEmbed(isJoin ? 'Join lock désactivé' : 'DM lock désactivé')] });
    }
    return;
  }

  // ── reports ─────────────────────────────────────────────────────────────────
  if (group === 'reports') {
    if (sub === 'activer') {
      const channel = interaction.options.getChannel('salon', true);
      await upsertRaidProtectionConfig(guild.id, {
        reportsEnabled: true,
        reportsChannelId: channel.id,
        reportsCooldownSec: interaction.options.getInteger('cooldown') ?? 60,
        reportsAnonymous: interaction.options.getBoolean('anonyme') ?? false,
      });
      await interaction.reply({
        embeds: [successEmbed('Signalements activés', `Les membres peuvent signaler via \`/report\` ou le clic droit sur un message. Les signalements arrivent dans ${channel}.`)],
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await upsertRaidProtectionConfig(guild.id, { reportsEnabled: false });
      await interaction.reply({ embeds: [successEmbed('Signalements désactivés')], flags: [MessageFlags.Ephemeral] });
    }
    return;
  }

  // ── tagrole ─────────────────────────────────────────────────────────────────
  if (group === 'tagrole') {
    if (sub === 'activer') {
      const role = interaction.options.getRole('role', true);
      await upsertRaidProtectionConfig(guild.id, { tagRoleEnabled: true, tagRoleId: role.id });
      await interaction.reply({
        embeds: [successEmbed('Tag role activé', `Les membres arborant le tag du serveur recevront automatiquement ${role}.`)],
        flags: [MessageFlags.Ephemeral],
      });
    } else if (sub === 'desactiver') {
      await upsertRaidProtectionConfig(guild.id, { tagRoleEnabled: false });
      await interaction.reply({ embeds: [successEmbed('Tag role désactivé')], flags: [MessageFlags.Ephemeral] });
    } else {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      const result = await rescanGuildTagRoles(interaction.client, guild.id);
      if (!result) {
        await interaction.editReply({ embeds: [errorEmbed('Tag role non configuré', 'Active-le d\'abord avec `/protection tagrole activer`.')] });
      } else {
        await interaction.editReply({ embeds: [successEmbed('Rescan terminé', `➕ ${result.added} rôle(s) ajouté(s) · ➖ ${result.removed} retiré(s).`)] });
      }
    }
    return;
  }

  // ── scam ────────────────────────────────────────────────────────────────────
  if (group === 'scam') {
    if (sub === 'activer') {
      await upsertRaidProtectionConfig(guild.id, {
        scamFilterEnabled: true,
        scamFilterAction: interaction.options.getString('action') ?? 'DELETE_AND_TIMEOUT',
        scamFilterAlertChannelId: interaction.options.getChannel('salon-alertes')?.id ?? null,
        scamImageFilterEnabled: interaction.options.getBoolean('images') ?? true,
      });
      await interaction.reply({
        embeds: [successEmbed('Filtre anti-scam activé', 'Les liens d\'arnaques connus (faux Nitro, phishing Steam/Discord) seront supprimés automatiquement.')],
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await upsertRaidProtectionConfig(guild.id, { scamFilterEnabled: false });
      await interaction.reply({ embeds: [successEmbed('Filtre anti-scam désactivé')], flags: [MessageFlags.Ephemeral] });
    }
    return;
  }

  // ── invites ─────────────────────────────────────────────────────────────────
  if (group === 'invites') {
    if (sub === 'activer') {
      const exemptRole = interaction.options.getRole('role-exempt');
      const current = await getRaidProtectionConfig(guild.id);
      const bypassRoleIds = exemptRole
        ? [...new Set([...(current?.inviteBypassRoleIds ?? []), exemptRole.id])]
        : current?.inviteBypassRoleIds ?? [];

      await upsertRaidProtectionConfig(guild.id, {
        inviteGuardEnabled: true,
        inviteRequireUnitary: interaction.options.getBoolean('unitaire') ?? current?.inviteRequireUnitary ?? false,
        inviteValidationEnabled: interaction.options.getBoolean('validation') ?? current?.inviteValidationEnabled ?? false,
        inviteSpamThreshold: interaction.options.getInteger('seuil-spam') ?? current?.inviteSpamThreshold ?? 5,
        inviteSpamWindowSec: interaction.options.getInteger('fenetre-spam') ?? current?.inviteSpamWindowSec ?? 60,
        inviteAlertChannelId: interaction.options.getChannel('salon-alertes')?.id ?? current?.inviteAlertChannelId ?? null,
        inviteBypassRoleIds: bypassRoleIds,
      });
      const updated = await getRaidProtectionConfig(guild.id);
      await interaction.reply({
        embeds: [successEmbed('Contrôle des invitations activé',
          `• Règle unitaire (1 usage) : ${updated?.inviteRequireUnitary ? '✅' : '❌'}\n` +
          `• Validation staff : ${updated?.inviteValidationEnabled ? '✅' : '❌'}\n` +
          `• Alerte spam : ${updated?.inviteSpamThreshold} créations / ${updated?.inviteSpamWindowSec}s\n` +
          `• Rôles exemptés : ${bypassRoleIds.length > 0 ? bypassRoleIds.map((id) => `<@&${id}>`).join(', ') : 'aucun (admins toujours exemptés)'}`)],
        flags: [MessageFlags.Ephemeral],
      });
    } else if (sub === 'desactiver') {
      await upsertRaidProtectionConfig(guild.id, { inviteGuardEnabled: false, inviteEmergencyEnabled: false });
      await interaction.reply({ embeds: [successEmbed('Contrôle des invitations désactivé')], flags: [MessageFlags.Ephemeral] });
    } else if (sub === 'urgence') {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      const actif = interaction.options.getBoolean('actif', true);
      const { enableInviteEmergency, disableInviteEmergency } = await import('../../services/moderation/inviteGuardService.js');
      if (actif) {
        const deleted = await enableInviteEmergency(guild);
        await interaction.editReply({
          embeds: [successEmbed('🚨 Mode urgence invitations activé',
            `**${deleted} invitation(s) existante(s) supprimée(s).**\nToute nouvelle invitation sera supprimée immédiatement jusqu'à désactivation.`)],
        });
      } else {
        await disableInviteEmergency(guild);
        await interaction.editReply({ embeds: [successEmbed('Mode urgence invitations désactivé', 'Les règles normales du contrôle des invitations s\'appliquent à nouveau.')] });
      }
    }
    return;
  }
}

export const protectionCommand: SlashCommandDefinition = { data, execute };
