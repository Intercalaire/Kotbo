/** Recherche dans les journaux de messages. */
import { authStore } from '../stores/auth.svelte';
import { dashboardMutation, dashboardRequest } from './client';

// ─────────────────────────────────────────────────────────────
// Message logs - global message search
// ─────────────────────────────────────────────────────────────

export interface MessageLogEntry {
  id: string;
  guildId: string;
  channelId: string;
  channelName: string;
  messageId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  isBot: boolean;
  content: string;
  attachments: { name: string; url: string; contentType: string | null }[] | null;
  embedCount: number;
  hasAttachment: boolean;
  mentionedUserIds: string[];
  repliedToAuthorId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface MessageSearchResult {
  messages: MessageLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface MessageSearchParams {
  q?: string;
  channelId?: string;
  authorId?: string;
  isBot?: 'true' | 'false';
  hasAttachment?: 'true';
  includeDeleted?: boolean;
  from?: string;
  to?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export async function searchMessages(
  params: MessageSearchParams = {},
  guildId = authStore.selectedGuildId,
): Promise<MessageSearchResult> {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.channelId) search.set('channelId', params.channelId);
  if (params.authorId) search.set('authorId', params.authorId);
  if (params.isBot) search.set('isBot', params.isBot);
  if (params.hasAttachment) search.set('hasAttachment', params.hasAttachment);
  if (params.includeDeleted) search.set('includeDeleted', 'true');
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.order) search.set('order', params.order);
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  const qs = search.toString();
  const data = await dashboardRequest(`/message-logs/search${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Message Search):',
  });
  return data || { messages: [], total: 0, limit: 50, offset: 0 };
}

export async function fetchMessageLogChannels(
  guildId = authStore.selectedGuildId,
  authorId?: string,
): Promise<{ channelId: string; channelName: string; count: number }[]> {
  const qs = authorId ? `?authorId=${encodeURIComponent(authorId)}` : '';
  const data = await dashboardRequest(`/message-logs/channels${qs}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Message Channels):',
    silent: true,
  });
  return data?.channels || [];
}

export async function fetchMessageLogStats(
  guildId = authStore.selectedGuildId,
): Promise<{
  total: number;
  enabled: boolean;
  retentionDays: number;
  ignoredChannels: string[];
  status: {
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    error: string | null;
    scrapedChannelsCount: number;
    totalChannelsCount: number;
    scrapedMessagesCount: number;
    currentChannelName: string;
    startedAt: string;
    completedAt?: string;
  } | null;
} | null> {
  return dashboardRequest('/message-logs/stats', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Message Stats):',
    silent: true,
  });
}

export async function deleteMessageLog(id: string, guildId = authStore.selectedGuildId): Promise<boolean> {
  return dashboardMutation(`/message-logs/${id}`, {
    method: 'DELETE',
    guildId,
    errorContext: 'API Error (Delete Message):',
  });
}

export async function updateMessageLogConfig(
  payload: { enabled?: boolean; retentionDays?: number; ignoredChannels?: string[] },
  guildId = authStore.selectedGuildId,
): Promise<{ enabled: boolean; retentionDays: number; ignoredChannels: string[] } | null> {
  return dashboardRequest('/message-logs/config', {
    method: 'PATCH',
    payload,
    guildId,
    errorContext: 'API Error (Message Config):',
  });
}
