/** Ghost Members Analyzer - audit de presence silencieuse. */
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

export type GhostStatus = 'ACTIVE' | 'SPECTATOR' | 'INACTIVE' | 'NEW';

export type ProtectionReason = 'STAFF' | 'BOOSTER' | 'PROTECTED_ROLE' | 'GRACE_PERIOD' | 'BOT';

export interface GhostConfig {
  guildId: string;
  enabled: boolean;
  inactiveDays: number;
  spectatorWindowDays: number;
  gracePeriodDays: number;
  protectStaff: boolean;
  protectBoosters: boolean;
  protectedRoleIds: string[];
  maxPruneBatch: number;
  pruneReason: string;
  lastComputedAt: string | null;
}

export interface GhostMemberRow {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: GhostStatus;
  ghostScore: number;
  joinedAt: string | null;
  lastMessageAt: string | null;
  lastSilentActivityAt: string | null;
  lastAnyActivityAt: string | null;
  messageCount: number;
  voiceTimeSeconds: number;
  interactionCount: number;
  protections: ProtectionReason[];
  stillInGuild: boolean;
}

export interface GhostDistribution {
  counts: Record<GhostStatus, number>;
  total: number;
  lastComputedAt: string | null;
}

export interface GhostPrunePreview {
  candidates: GhostMemberRow[];
  protectedCount: number;
  analyzedCount: number;
  truncated: boolean;
  maxPruneBatch: number;
  config: GhostConfig;
}

export interface GhostPruneResult {
  runId: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  totalTargeted: number;
  successCount: number;
  failureCount: number;
  failures: { userId: string; username: string; error: string }[];
}

export interface GhostPruneRun {
  id: string;
  executedByName: string;
  status: string;
  targetStatuses: string[];
  totalTargeted: number;
  successCount: number;
  failureCount: number;
  reason: string | null;
  startedAt: string;
  completedAt: string | null;
}

export async function fetchGhostOverview(
  guildId = authStore.selectedGuildId,
): Promise<{ distribution: GhostDistribution; config: GhostConfig }> {
  return dashboardRequest('/ghost-members', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Ghost Members):',
  });
}

export async function fetchGhostMembers(
  options: { status?: GhostStatus; search?: string; onlyPrunable?: boolean; page?: number; pageSize?: number } = {},
  guildId = authStore.selectedGuildId,
): Promise<{ members: GhostMemberRow[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.search) params.set('search', options.search);
  if (options.onlyPrunable) params.set('onlyPrunable', 'true');
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));

  const query = params.toString();
  return dashboardRequest(`/ghost-members/members${query ? `?${query}` : ''}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Ghost Members List):',
  });
}

export async function updateGhostConfig(
  payload: Partial<GhostConfig>,
  guildId = authStore.selectedGuildId,
): Promise<{ config: GhostConfig }> {
  return dashboardRequest('/ghost-members/config', {
    method: 'PATCH',
    payload,
    guildId,
    errorContext: 'API Error (Update Ghost Config):',
  });
}

export async function recomputeGhostStatuses(
  guildId = authStore.selectedGuildId,
): Promise<{ counts: Record<GhostStatus, number> }> {
  return dashboardRequest('/ghost-members/recompute', {
    method: 'POST',
    guildId,
    errorContext: 'API Error (Recompute Ghost Statuses):',
  });
}

/** Etape 1 du nettoyage : liste exacte des membres qui seraient expulses. */
export async function previewGhostPrune(
  statuses: GhostStatus[],
  guildId = authStore.selectedGuildId,
): Promise<GhostPrunePreview> {
  return dashboardRequest('/ghost-members/prune/preview', {
    method: 'POST',
    payload: { statuses },
    guildId,
    errorContext: 'API Error (Ghost Prune Preview):',
  });
}

/** Etape 2 : expulsion effective, apres confirmation explicite du nombre. */
export async function executeGhostPrune(
  payload: { statuses: GhostStatus[]; userIds: string[]; confirmCount: number; reason?: string },
  guildId = authStore.selectedGuildId,
): Promise<GhostPruneResult> {
  return dashboardRequest('/ghost-members/prune', {
    method: 'POST',
    payload,
    guildId,
    errorContext: 'API Error (Ghost Prune):',
  });
}

export async function fetchGhostPruneRuns(
  guildId = authStore.selectedGuildId,
): Promise<{ runs: GhostPruneRun[] }> {
  return dashboardRequest('/ghost-members/runs', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Ghost Prune Runs):',
  });
}
