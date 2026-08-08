/**
 * Kotbo Internal Event Bus - Type definitions
 *
 * Each domain module publishes and subscribes to typed events.
 * Phase 1: in-process EventEmitter (same bot instance)
 * Phase 2: Redis Pub/Sub (multi-process, multi-bot split)
 */

// ── Message Events ──────────────────────────────────────────────
export interface MessageNewEvent {
  guildId: string;
  channelId: string;
  authorId: string;
  authorTag: string;
  content: string;
  isBot: boolean;
  isCommand: boolean;
  hasReference: boolean;
  messageId: string;
  attachmentCount: number;
  isInteraction: boolean;
  timestamp: number;
}

export interface MessageDeleteEvent {
  guildId: string;
  channelId: string;
  authorId: string | null;
  authorTag: string | null;
  messageId: string;
  content: string | null;
  timestamp: number;
}

export interface MessageUpdateEvent {
  guildId: string;
  channelId: string;
  authorId: string | null;
  messageId: string;
  oldContent: string | null;
  newContent: string | null;
  timestamp: number;
}

// ── Voice Events ────────────────────────────────────────────────
export interface VoiceJoinEvent {
  guildId: string;
  userId: string;
  channelId: string;
  channelName: string | null;
  timestamp: number;
}

export interface VoiceLeaveEvent {
  guildId: string;
  userId: string;
  channelId: string;
  channelName: string | null;
  durationMs: number | null;
  joinTimestamp: number | null;
  timestamp: number;
}

export interface VoiceMoveEvent {
  guildId: string;
  userId: string;
  fromChannelId: string;
  fromChannelName: string | null;
  toChannelId: string;
  toChannelName: string | null;
  joinTimestamp: number | null;
  timestamp: number;
}

// ── Member Events ───────────────────────────────────────────────
export interface MemberJoinEvent {
  guildId: string;
  userId: string;
  userTag: string;
  isBot: boolean;
  timestamp: number;
}

export interface MemberLeaveEvent {
  guildId: string;
  userId: string;
  userTag: string;
  isBot: boolean;
  timestamp: number;
}

export interface MemberUpdateEvent {
  guildId: string;
  userId: string;
  oldNickname: string | null;
  newNickname: string | null;
  addedRoles: string[];
  removedRoles: string[];
  isBoosting: boolean;
  timestamp: number;
}

// ── Moderation Events ───────────────────────────────────────────
export interface SanctionAppliedEvent {
  guildId: string;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  type: 'BAN' | 'KICK' | 'TIMEOUT' | 'WARN' | 'MUTE';
  reason: string | null;
  duration: number | null;
  sanctionId: string | null;
  timestamp: number;
}

export interface SanctionRevokedEvent {
  guildId: string;
  targetId: string;
  moderatorId: string;
  type: 'UNBAN' | 'UNTIMEOUT' | 'UNMUTE' | 'UNWARN';
  sanctionId: string | null;
  timestamp: number;
}

export interface AutoModTriggeredEvent {
  guildId: string;
  userId: string;
  channelId: string;
  rule: string;
  matchedContent: string | null;
  action: 'DELETE' | 'WARN' | 'TIMEOUT' | 'LOG';
  timestamp: number;
}

// ── Reaction / Thread Events ────────────────────────────────────
export interface ReactionAddEvent {
  guildId: string;
  channelId: string;
  userId: string;
  messageId: string;
  emoji: string;
  timestamp: number;
}

export interface ThreadCreateEvent {
  guildId: string;
  channelId: string;
  threadId: string;
  creatorId: string | null;
  timestamp: number;
}

// ── Channel Events ──────────────────────────────────────────────
export interface ChannelCreateEvent {
  guildId: string;
  channelId: string;
  channelName: string;
  channelType: number;
  timestamp: number;
}

export interface ChannelDeleteEvent {
  guildId: string;
  channelId: string;
  channelName: string;
  channelType: number;
  timestamp: number;
}

// ── Role Events ─────────────────────────────────────────────────
export interface RoleCreateEvent {
  guildId: string;
  roleId: string;
  roleName: string;
  timestamp: number;
}

export interface RoleDeleteEvent {
  guildId: string;
  roleId: string;
  roleName: string;
  timestamp: number;
}

// ── Mapping type → payload ──────────────────────────────────────
export interface KotboEventMap {
  'message:new': MessageNewEvent;
  'message:delete': MessageDeleteEvent;
  'message:update': MessageUpdateEvent;
  'voice:join': VoiceJoinEvent;
  'voice:leave': VoiceLeaveEvent;
  'voice:move': VoiceMoveEvent;
  'member:join': MemberJoinEvent;
  'member:leave': MemberLeaveEvent;
  'member:update': MemberUpdateEvent;
  'sanction:applied': SanctionAppliedEvent;
  'sanction:revoked': SanctionRevokedEvent;
  'automod:triggered': AutoModTriggeredEvent;
  'reaction:add': ReactionAddEvent;
  'thread:create': ThreadCreateEvent;
  'channel:create': ChannelCreateEvent;
  'channel:delete': ChannelDeleteEvent;
  'role:create': RoleCreateEvent;
  'role:delete': RoleDeleteEvent;
}

export type KotboEventName = keyof KotboEventMap;
