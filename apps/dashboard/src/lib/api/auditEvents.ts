/** Interactive Audit Logger - etats avant/apres et diff visuel. */
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

export type AuditEventType =
  | 'MESSAGE_UPDATE'
  | 'MEMBER_UPDATE'
  | 'ROLE_UPDATE'
  | 'CHANNEL_UPDATE'
  | 'CHANNEL_PERMISSIONS_UPDATE';

export type ChangeKind = 'added' | 'removed' | 'modified';

export interface AuditChange {
  field: string;
  label: string;
  kind: ChangeKind;
  before?: unknown;
  after?: unknown;
  added?: string[];
  removed?: string[];
  reset?: string[];
}

export interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  targetType: 'MESSAGE' | 'MEMBER' | 'ROLE' | 'CHANNEL';
  targetId: string;
  targetName: string | null;
  executorId: string | null;
  executorName: string | null;
  channelId: string | null;
  channelName: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changes: AuditChange[];
  changedFields: string[];
  reason: string | null;
  createdAt: string;
}

export interface AuditLoggerConfig {
  guildId: string;
  enabled: boolean;
  retentionDays: number;
  captureMessages: boolean;
  captureMembers: boolean;
  captureRoles: boolean;
  captureChannels: boolean;
  ignoredChannelIds: string[];
  ignoredUserIds: string[];
}

export interface AuditSearchOptions {
  eventType?: AuditEventType;
  executorId?: string;
  channelId?: string;
  targetId?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchAuditEvents(
  options: AuditSearchOptions = {},
  guildId = authStore.selectedGuildId,
): Promise<{ events: AuditEvent[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }

  const query = params.toString();
  return dashboardRequest(`/audit-events${query ? `?${query}` : ''}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Audit Events):',
  });
}

export async function fetchAuditConfig(
  guildId = authStore.selectedGuildId,
): Promise<{ config: AuditLoggerConfig }> {
  return dashboardRequest('/audit-events/config', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Audit Config):',
  });
}

export async function updateAuditConfig(
  payload: Partial<AuditLoggerConfig>,
  guildId = authStore.selectedGuildId,
): Promise<{ config: AuditLoggerConfig }> {
  return dashboardRequest('/audit-events/config', {
    method: 'PATCH',
    payload,
    guildId,
    errorContext: 'API Error (Update Audit Config):',
  });
}

export async function fetchAuditExecutors(
  guildId = authStore.selectedGuildId,
): Promise<{ executors: { id: string; name: string; count: number }[] }> {
  return dashboardRequest('/audit-events/executors', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Audit Executors):',
  });
}
