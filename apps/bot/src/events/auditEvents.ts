import {
  AuditLogEvent,
  Events,
  OverwriteType,
  type Client,
  type GuildMember,
  type NonThreadGuildBasedChannel,
  type Message,
  type PartialGuildMember,
  type PartialMessage,
  type PermissionOverwrites,
  type Role,
} from 'discord.js';
import prisma from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { isGuildActivated } from '../utils/activation.js';
import {
  diffChannels,
  diffMembers,
  diffMessages,
  diffRoles,
  getAuditConfig,
  permissionNames,
  recordAuditEvent,
  resolveExecutor,
  type ChannelSnapshot,
  type MemberSnapshot,
  type MessageSnapshot,
  type PermissionOverwriteSnapshot,
  type RoleSnapshot,
} from '../services/analytics/auditDiffService.js';

/**
 * Interactive Audit Logger - écoute des modifications structurelles du serveur.
 *
 * Listener autonome, séparé de `advancedLogs` : celui-ci envoie des embeds dans
 * un salon Discord, celui-là archive des états comparables pour le dashboard.
 * Aucun des deux ne dépend de l'autre.
 */

// ============================================================================
// CONSTRUCTION DES INSTANTANÉS
// ============================================================================

function snapshotMessage(message: Message | PartialMessage): MessageSnapshot {
  return {
    content: message.content ?? '',
    pinned: message.pinned ?? false,
    embedCount: message.embeds?.length ?? 0,
    attachments: [...(message.attachments?.values() ?? [])].map((a) => a.name || a.url),
  };
}

function snapshotMember(member: GuildMember | PartialGuildMember): MemberSnapshot {
  return {
    nickname: member.nickname ?? null,
    avatarUrl: member.avatarURL() ?? null,
    timeoutUntil: member.communicationDisabledUntil?.toISOString() ?? null,
    pending: member.pending ?? false,
    roles: [...member.roles.cache.values()].map((role) => ({ id: role.id, name: role.name })),
  };
}

function snapshotRole(role: Role): RoleSnapshot {
  return {
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    position: role.position,
    permissions: permissionNames(role.permissions.bitfield),
  };
}

/**
 * Résout le nom lisible d'une cible de surclassement : un identifiant brut
 * serait illisible dans le diff.
 */
function overwriteTargetName(channel: NonThreadGuildBasedChannel, overwrite: PermissionOverwrites): string {
  if (overwrite.type === OverwriteType.Role) {
    return channel.guild.roles.cache.get(overwrite.id)?.name ?? overwrite.id;
  }
  const member = channel.guild.members.cache.get(overwrite.id);
  return member?.user.tag ?? member?.displayName ?? overwrite.id;
}

function snapshotOverwrites(channel: NonThreadGuildBasedChannel): PermissionOverwriteSnapshot[] {
  return [...channel.permissionOverwrites.cache.values()].map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type === OverwriteType.Role ? 'role' : 'member',
    name: overwriteTargetName(channel, overwrite),
    allow: permissionNames(overwrite.allow.bitfield),
    deny: permissionNames(overwrite.deny.bitfield),
  }));
}

function snapshotChannel(channel: NonThreadGuildBasedChannel): ChannelSnapshot {
  return {
    name: channel.name,
    topic: 'topic' in channel ? channel.topic ?? null : null,
    nsfw: 'nsfw' in channel ? channel.nsfw ?? null : null,
    rateLimitPerUser: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser ?? null : null,
    parentName: channel.parent?.name ?? null,
    bitrate: 'bitrate' in channel ? channel.bitrate ?? null : null,
    userLimit: 'userLimit' in channel ? channel.userLimit ?? null : null,
    overwrites: snapshotOverwrites(channel),
  };
}

// ============================================================================
// GARDES
// ============================================================================

interface CaptureGate {
  captureMessages: boolean;
  captureMembers: boolean;
  captureRoles: boolean;
  captureChannels: boolean;
  ignoredChannelIds: string[];
  ignoredUserIds: string[];
}

/**
 * Vérifie qu'un événement doit être capturé pour ce serveur : module actif,
 * serveur activé, catégorie autorisée et cible non exclue.
 */
async function shouldCapture(
  guildId: string,
  category: keyof Pick<CaptureGate, 'captureMessages' | 'captureMembers' | 'captureRoles' | 'captureChannels'>,
  options: { channelId?: string | null; userId?: string | null } = {},
): Promise<boolean> {
  if (!isGuildActivated(guildId)) return false;

  const config = await getAuditConfig(guildId);
  if (!config.enabled || !config[category]) return false;

  if (options.channelId && config.ignoredChannelIds.includes(options.channelId)) return false;
  if (options.userId && config.ignoredUserIds.includes(options.userId)) return false;

  return true;
}

/**
 * Contenu précédent d'un message que Discord n'avait plus en cache.
 *
 * Sans ce repli, toute édition d'un message ancien serait inexploitable : le
 * module de journalisation des messages conserve justement le dernier contenu vu.
 */
async function recoverPreviousContent(guildId: string, messageId: string): Promise<string | null> {
  try {
    const logged = await prisma.messageLog.findUnique({
      where: { messageId },
      select: { content: true, guildId: true },
    });
    if (!logged || logged.guildId !== guildId) return null;
    return logged.content;
  } catch {
    return null;
  }
}

// ============================================================================
// LISTENERS
// ============================================================================

export function registerAuditEventsListener(client: Client): void {
  // ── Messages édités ────────────────────────────────────────────────────────
  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    try {
      const guildId = newMessage.guildId;
      if (!guildId || newMessage.author?.bot) return;
      if (!(await shouldCapture(guildId, 'captureMessages', {
        channelId: newMessage.channelId,
        userId: newMessage.author?.id,
      }))) return;

      const before = snapshotMessage(oldMessage);
      const after = snapshotMessage(newMessage);

      // Message non caché : Discord renvoie un état partiel vide, on tente le
      // dernier contenu connu avant de renoncer.
      if (oldMessage.partial && !before.content) {
        const recovered = await recoverPreviousContent(guildId, newMessage.id);
        if (recovered === null) return;
        before.content = recovered;
      }

      const changes = diffMessages(before, after);
      await recordAuditEvent({
        guildId,
        eventType: 'MESSAGE_UPDATE',
        targetType: 'MESSAGE',
        targetId: newMessage.id,
        targetName: newMessage.author?.tag ?? null,
        // Une édition est toujours le fait de l'auteur du message
        executorId: newMessage.author?.id ?? null,
        executorName: newMessage.author?.tag ?? null,
        channelId: newMessage.channelId,
        channelName: 'name' in newMessage.channel ? newMessage.channel.name : null,
        before,
        after,
        changes,
      });
    } catch (error) {
      logger.error('AuditLogger', 'Erreur lors de la capture d\'une édition de message:', error);
    }
  });

  // ── Membres modifiés ───────────────────────────────────────────────────────
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      const guildId = newMember.guild.id;
      if (!(await shouldCapture(guildId, 'captureMembers', { userId: newMember.id }))) return;

      const before = snapshotMember(oldMember);
      const after = snapshotMember(newMember);
      const changes = diffMembers(before, after);
      if (changes.length === 0) return;

      // Un changement de rôles et un changement de surnom ne sont pas tracés
      // sous le même type d'entrée dans l'audit log Discord.
      const rolesChanged = changes.some((change) => change.field === 'roles');
      const executor = await resolveExecutor(
        newMember.guild,
        rolesChanged ? AuditLogEvent.MemberRoleUpdate : AuditLogEvent.MemberUpdate,
        newMember.id,
      );

      await recordAuditEvent({
        guildId,
        eventType: 'MEMBER_UPDATE',
        targetType: 'MEMBER',
        targetId: newMember.id,
        targetName: newMember.user.tag,
        executorId: executor?.id ?? null,
        executorName: executor?.name ?? null,
        before,
        after,
        changes,
        reason: executor?.reason ?? null,
      });
    } catch (error) {
      logger.error('AuditLogger', 'Erreur lors de la capture d\'une modification de membre:', error);
    }
  });

  // ── Rôles modifiés ─────────────────────────────────────────────────────────
  client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
    try {
      const guildId = newRole.guild.id;
      if (!(await shouldCapture(guildId, 'captureRoles'))) return;

      const before = snapshotRole(oldRole);
      const after = snapshotRole(newRole);
      const changes = diffRoles(before, after);
      if (changes.length === 0) return;

      const executor = await resolveExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

      await recordAuditEvent({
        guildId,
        eventType: 'ROLE_UPDATE',
        targetType: 'ROLE',
        targetId: newRole.id,
        targetName: newRole.name,
        executorId: executor?.id ?? null,
        executorName: executor?.name ?? null,
        before,
        after,
        changes,
        reason: executor?.reason ?? null,
      });
    } catch (error) {
      logger.error('AuditLogger', 'Erreur lors de la capture d\'une modification de rôle:', error);
    }
  });

  // ── Salons modifiés (propriétés et permissions) ────────────────────────────
  client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    try {
      if (!('guild' in newChannel) || !('guild' in oldChannel)) return;
      const guildId = newChannel.guild.id;
      if (!(await shouldCapture(guildId, 'captureChannels', { channelId: newChannel.id }))) return;

      const before = snapshotChannel(oldChannel);
      const after = snapshotChannel(newChannel);
      const changes = diffChannels(before, after);
      if (changes.length === 0) return;

      // Les changements de permissions relèvent d'une entrée d'audit distincte
      // et méritent leur propre type d'événement pour le filtrage.
      const permissionsOnly = changes.every((change) => change.field.startsWith('overwrite:'));
      const executor = await resolveExecutor(
        newChannel.guild,
        permissionsOnly ? AuditLogEvent.ChannelOverwriteUpdate : AuditLogEvent.ChannelUpdate,
        newChannel.id,
      );

      await recordAuditEvent({
        guildId,
        eventType: permissionsOnly ? 'CHANNEL_PERMISSIONS_UPDATE' : 'CHANNEL_UPDATE',
        targetType: 'CHANNEL',
        targetId: newChannel.id,
        targetName: newChannel.name,
        executorId: executor?.id ?? null,
        executorName: executor?.name ?? null,
        channelId: newChannel.id,
        channelName: newChannel.name,
        before,
        after,
        changes,
        reason: executor?.reason ?? null,
      });
    } catch (error) {
      logger.error('AuditLogger', 'Erreur lors de la capture d\'une modification de salon:', error);
    }
  });

  logger.info('AuditLogger', 'Listener d\'audit structurel enregistré.');
}
