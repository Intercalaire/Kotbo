/** Sante des salons. */
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

// ============================================================================
// CHANNEL HEALTH MONITOR
// ============================================================================

export async function fetchChannelHealth(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/channel-health', { method: 'GET', guildId, errorContext: 'API Error (Channel Health):' });
}

export async function fetchChannelHealthAnalysis(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/channel-health/analyse', { method: 'GET', guildId, errorContext: 'API Error (Channel Health Analysis):' });
}

export async function updateChannelHealthConfig(data: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/channel-health/config', { method: 'PUT', payload: data, guildId, errorContext: 'API Error (Channel Health Config):' });
}

export async function resolveChannelHealthAlert(alertId: string, action: 'APPLIED' | 'DISMISSED', note?: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/channel-health/alerts/${alertId}/resolve`, { method: 'POST', payload: { action, note }, guildId, errorContext: 'API Error (Resolve Alert):' });
}

export async function splitChannel(channelId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/channel-health/split', { method: 'POST', payload: { channelId }, guildId, errorContext: 'API Error (Split Channel):' });
}

export async function archiveChannel(channelId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/channel-health/archive', { method: 'POST', payload: { channelId }, guildId, errorContext: 'API Error (Archive Channel):' });
}
