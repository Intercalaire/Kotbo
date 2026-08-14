/**
 * Discord → KotboEventBus Bridge
 *
 * Listens to raw Discord.js client events and publishes normalized,
 * Discord-agnostic payloads onto the Kotbo Event Bus.
 *
 * Each module then subscribes to bus events instead of `client.on(...)` directly.
 * This is the single point where Discord coupling lives - modules behind the bus
 * only see plain typed objects, making them portable to a multi-process setup.
 */

import { Events, MessageFlags, type Client, type Message, type PartialMessage, type VoiceState, type GuildMember } from 'discord.js';
import { kotboEventBus } from '@kotbo/core';
import { logger } from '../utils/logger.js';

const voiceJoinTimestamps = new Map<string, number>();

export function registerEventBusBridge(client: Client): void {
  // ── MessageCreate ─────────────────────────────────────────────
  client.on(Events.MessageCreate, (message: Message) => {
    if (!message.inGuild()) return;

    kotboEventBus.publish('message:new', {
      guildId: message.guildId,
      channelId: message.channelId,
      authorId: message.author.id,
      authorTag: message.author.tag,
      content: message.content,
      isBot: message.author.bot,
      isCommand: message.content.startsWith('/'),
      hasReference: !!message.reference,
      messageId: message.id,
      attachmentCount: message.attachments.size,
      isInteraction: !!message.interaction || !!message.interactionMetadata || message.flags.has(MessageFlags.Ephemeral),
      timestamp: message.createdTimestamp,
    });
  });

  // ── MessageDelete ─────────────────────────────────────────────
  client.on(Events.MessageDelete, (message: Message | PartialMessage) => {
    if (!message.guildId) return;

    kotboEventBus.publish('message:delete', {
      guildId: message.guildId,
      channelId: message.channelId,
      authorId: message.author?.id ?? null,
      authorTag: message.author?.tag ?? null,
      messageId: message.id,
      content: message.content ?? null,
      timestamp: Date.now(),
    });
  });

  // ── MessageUpdate ─────────────────────────────────────────────
  client.on(Events.MessageUpdate, (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
    if (!newMessage.guildId) return;

    kotboEventBus.publish('message:update', {
      guildId: newMessage.guildId,
      channelId: newMessage.channelId,
      authorId: newMessage.author?.id ?? null,
      messageId: newMessage.id,
      oldContent: oldMessage.content ?? null,
      newContent: newMessage.content ?? null,
      timestamp: Date.now(),
    });
  });

  // ── VoiceStateUpdate ──────────────────────────────────────────
  client.on(Events.VoiceStateUpdate, (oldState: VoiceState, newState: VoiceState) => {
    if (!newState.guild) return;
    if (newState.member?.user.bot) return;

    const guildId = newState.guild.id;
    const userId = newState.id;
    const sessionKey = `${guildId}-${userId}`;
    const now = Date.now();

    const joinedVoice = !oldState.channelId && newState.channelId;
    const leftVoice = oldState.channelId && !newState.channelId;
    const movedVoice = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

    if (joinedVoice) {
      voiceJoinTimestamps.set(sessionKey, now);

      kotboEventBus.publish('voice:join', {
        guildId,
        userId,
        channelId: newState.channelId!,
        channelName: newState.channel?.name ?? null,
        timestamp: now,
      });
    } else if (leftVoice) {
      const joinTime = voiceJoinTimestamps.get(sessionKey) ?? null;
      voiceJoinTimestamps.delete(sessionKey);

      kotboEventBus.publish('voice:leave', {
        guildId,
        userId,
        channelId: oldState.channelId!,
        channelName: oldState.channel?.name ?? null,
        durationMs: joinTime ? now - joinTime : null,
        joinTimestamp: joinTime,
        timestamp: now,
      });
    } else if (movedVoice) {
      const joinTime = voiceJoinTimestamps.get(sessionKey) ?? null;
      voiceJoinTimestamps.set(sessionKey, now);

      kotboEventBus.publish('voice:move', {
        guildId,
        userId,
        fromChannelId: oldState.channelId!,
        fromChannelName: oldState.channel?.name ?? null,
        toChannelId: newState.channelId!,
        toChannelName: newState.channel?.name ?? null,
        joinTimestamp: joinTime,
        timestamp: now,
      });
    }
  });

  // ── GuildMemberAdd ────────────────────────────────────────────
  client.on(Events.GuildMemberAdd, (member: GuildMember) => {
    kotboEventBus.publish('member:join', {
      guildId: member.guild.id,
      userId: member.id,
      userTag: member.user.tag,
      isBot: member.user.bot,
      timestamp: Date.now(),
    });
  });

  // ── GuildMemberRemove ─────────────────────────────────────────
  client.on(Events.GuildMemberRemove, (member) => {
    kotboEventBus.publish('member:leave', {
      guildId: member.guild.id,
      userId: member.id,
      userTag: member.user?.tag ?? 'Unknown',
      isBot: member.user?.bot ?? false,
      timestamp: Date.now(),
    });
  });

  // ── GuildMemberUpdate ─────────────────────────────────────────
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    if (oldMember.partial || newMember.partial) return;

    const addedRoles = newMember.roles.cache
      .filter(r => !oldMember.roles.cache.has(r.id))
      .map(r => r.id);
    const removedRoles = oldMember.roles.cache
      .filter(r => !newMember.roles.cache.has(r.id))
      .map(r => r.id);

    const nicknameChanged = oldMember.nickname !== newMember.nickname;
    const rolesChanged = addedRoles.length > 0 || removedRoles.length > 0;
    const isBoosting = !oldMember.premiumSince && !!newMember.premiumSince;

    if (!nicknameChanged && !rolesChanged && !isBoosting) return;

    kotboEventBus.publish('member:update', {
      guildId: newMember.guild.id,
      userId: newMember.id,
      oldNickname: oldMember.nickname,
      newNickname: newMember.nickname,
      addedRoles,
      removedRoles,
      isBoosting,
      timestamp: Date.now(),
    });
  });

  // ── MessageReactionAdd ────────────────────────────────────────
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    if (!reaction.message.guildId) return;
    if (user.bot) return;

    kotboEventBus.publish('reaction:add', {
      guildId: reaction.message.guildId,
      channelId: reaction.message.channelId,
      userId: user.id,
      messageId: reaction.message.id,
      emoji: reaction.emoji.name ?? reaction.emoji.id ?? '?',
      timestamp: Date.now(),
    });
  });

  // ── ThreadCreate ──────────────────────────────────────────────
  client.on(Events.ThreadCreate, (thread) => {
    if (!thread.guildId) return;

    kotboEventBus.publish('thread:create', {
      guildId: thread.guildId,
      channelId: thread.parentId ?? thread.id,
      threadId: thread.id,
      creatorId: thread.ownerId ?? null,
      timestamp: Date.now(),
    });
  });

  // ── ChannelCreate ─────────────────────────────────────────────
  client.on(Events.ChannelCreate, (channel) => {
    if (!channel.guildId) return;

    kotboEventBus.publish('channel:create', {
      guildId: channel.guildId,
      channelId: channel.id,
      channelName: channel.name,
      channelType: channel.type,
      timestamp: Date.now(),
    });
  });

  // ── ChannelDelete ─────────────────────────────────────────────
  client.on(Events.ChannelDelete, (channel) => {
    if (!('guildId' in channel) || !channel.guildId) return;

    kotboEventBus.publish('channel:delete', {
      guildId: channel.guildId,
      channelId: channel.id,
      channelName: 'name' in channel ? channel.name : 'unknown',
      channelType: channel.type,
      timestamp: Date.now(),
    });
  });

  // ── RoleCreate ────────────────────────────────────────────────
  client.on(Events.GuildRoleCreate, (role) => {
    kotboEventBus.publish('role:create', {
      guildId: role.guild.id,
      roleId: role.id,
      roleName: role.name,
      timestamp: Date.now(),
    });
  });

  // ── RoleDelete ────────────────────────────────────────────────
  client.on(Events.GuildRoleDelete, (role) => {
    kotboEventBus.publish('role:delete', {
      guildId: role.guild.id,
      roleId: role.id,
      roleName: role.name,
      timestamp: Date.now(),
    });
  });

  logger.info('EventBus', 'Bridge Discord -> KotboEventBus enregistre.');
}
