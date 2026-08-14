/** Classement compétitif (RP, paliers, séries, decay, événements). */
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

export async function fetchRankedOverview(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/ranked', { method: 'GET', guildId, errorContext: 'API Error (Ranked):' });
}

export async function updateRankedConfig(patch: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/ranked/config', { method: 'PATCH', payload: patch, guildId, errorContext: 'API Error (Ranked Config):' });
}

export async function fetchRankedLeaderboard(limit = 25, offset = 0, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/ranked/leaderboard?limit=${limit}&offset=${offset}`, { method: 'GET', guildId, errorContext: 'API Error (Ranked Leaderboard):' });
}

export async function fetchRankedGlobalLeaderboard(limit = 25, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/ranked/global?limit=${limit}`, { method: 'GET', guildId, errorContext: 'API Error (Ranked Global):' });
}

export async function fetchRankedMember(userId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/ranked/members/${encodeURIComponent(userId)}`, { method: 'GET', guildId, errorContext: 'API Error (Ranked Member):' });
}

export async function adjustRankedMember(userId: string, delta: number, reason?: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/ranked/members/${encodeURIComponent(userId)}/adjust`, {
    method: 'POST',
    payload: { delta, reason },
    guildId,
    errorContext: 'API Error (Ranked Adjust):',
  });
}

export async function setRankedTierRole(tierKey: string, roleId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/ranked/tier-roles/${encodeURIComponent(tierKey)}`, {
    method: 'PUT',
    payload: { roleId },
    guildId,
    errorContext: 'API Error (Ranked Tier Role):',
  });
}

export async function removeRankedTierRole(tierKey: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/ranked/tier-roles/${encodeURIComponent(tierKey)}`, {
    method: 'DELETE',
    guildId,
    errorContext: 'API Error (Ranked Tier Role):',
  });
}

/** Répartition des membres sur une échelle proposée, avant enregistrement. */
export async function fetchRankedLadderImpact(
  payload: { curve?: Record<string, unknown>; ladder?: unknown },
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest('/ranked/ladder/impact', {
    method: 'POST',
    payload,
    guildId,
    silent: true,
    errorContext: 'API Error (Ranked Ladder Impact):',
  });
}

/** Crée sur Discord les rôles manquants de l'échelle et les associe. */
export async function provisionRankedTierRoles(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/ranked/tier-roles/provision', {
    method: 'POST',
    guildId,
    silent: true,
    errorContext: 'API Error (Ranked Tier Roles Provision):',
  });
}

export async function fetchRankedTierRoleSync(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/ranked/tier-roles/sync', {
    method: 'GET',
    guildId,
    silent: true,
    errorContext: 'API Error (Ranked Tier Role Sync):',
  });
}

export async function runRankedTierRoleSync(
  options: { stop?: boolean } = {},
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest('/ranked/tier-roles/sync', {
    method: 'POST',
    payload: options,
    guildId,
    silent: true,
    errorContext: 'API Error (Ranked Tier Role Sync):',
  });
}

export async function createRankedEvent(
  data: { type: string; name: string; multiplier: number; durationMinutes: number; startsAt?: string; announceChannelId?: string },
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest('/ranked/events', { method: 'POST', payload: data, guildId, errorContext: 'API Error (Ranked Event):' });
}

export async function cancelRankedEvent(eventId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/ranked/events/${eventId}`, { method: 'DELETE', guildId, errorContext: 'API Error (Cancel Ranked Event):' });
}

export async function previewRankedDecay(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/ranked/decay/preview', { method: 'GET', guildId, errorContext: 'API Error (Decay Preview):' });
}

export async function runRankedDecay(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/ranked/decay/run', { method: 'POST', guildId, errorContext: 'API Error (Decay Run):' });
}
