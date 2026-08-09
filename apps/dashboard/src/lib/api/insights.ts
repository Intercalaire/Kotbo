/** Pulse, reputation, satisfaction, saisons, evaluations. */
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

// ============================================================================
// PULSE - SERVER HEALTH SCORE
// ============================================================================

export async function fetchPulseData(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/pulse', { method: 'GET', guildId, errorContext: 'API Error (Pulse):' });
}

export async function refreshPulse(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/pulse/refresh', { method: 'POST', guildId, errorContext: 'API Error (Pulse Refresh):' });
}

// ============================================================================
// REPUTATION - SYSTÈME COMMUNAUTAIRE
// ============================================================================

export async function fetchReputationData(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/reputation', { method: 'GET', guildId, errorContext: 'API Error (Reputation):' });
}

// ============================================================================
// TICKET SATISFACTION
// ============================================================================

export async function fetchSatisfactionData(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/satisfaction', { method: 'GET', guildId, errorContext: 'API Error (Satisfaction):' });
}

export async function fetchStaffSatisfactionReviews(
  staffId: string,
  options: { limit?: number; offset?: number; commentsOnly?: boolean } = {},
  guildId = authStore.selectedGuildId,
) {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  if (options.commentsOnly) params.set('commentsOnly', 'true');
  const query = params.toString();

  return dashboardRequest(
    `/satisfaction/staff/${encodeURIComponent(staffId)}/reviews${query ? `?${query}` : ''}`,
    { method: 'GET', guildId, errorContext: 'API Error (Staff Reviews):' },
  );
}

// ============================================================================
// LEVELING SEASONS
// ============================================================================

export async function fetchSeasonsData(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/seasons', { method: 'GET', guildId, errorContext: 'API Error (Seasons):' });
}

export async function createSeason(data: { name: string; startDate: string; endDate: string; rewards?: any; topRoleId?: string }, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/seasons', { method: 'POST', payload: data, guildId, errorContext: 'API Error (Create Season):' });
}

export async function startSeason(seasonId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/seasons/${seasonId}/start`, { method: 'POST', guildId, errorContext: 'API Error (Start Season):' });
}

export async function endSeason(seasonId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/seasons/${seasonId}/end`, { method: 'POST', guildId, errorContext: 'API Error (End Season):' });
}

export async function fetchSeasonLeaderboard(seasonId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/seasons/${seasonId}/leaderboard`, { method: 'GET', guildId, errorContext: 'API Error (Season Leaderboard):' });
}

// ============================================================================
// ANALYTICS PREDICTIONS
// ============================================================================

export async function fetchPredictions(days = 30, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/predictions?days=${days}`, { method: 'GET', guildId, errorContext: 'API Error (Predictions):' });
}

// ============================================================================
// STAFF EVALUATIONS
// ============================================================================

export async function fetchEvaluations(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/evaluations', { method: 'GET', guildId, errorContext: 'API Error (Evaluations):' });
}

export async function generateEvaluation(staffUserId?: string, periodDays = 30, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/evaluations/generate', { method: 'POST', payload: { staffUserId, periodDays }, guildId, errorContext: 'API Error (Generate Evaluation):' });
}

export async function updateEvaluationNote(evaluationId: string, managerNote: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/evaluations/${evaluationId}`, { method: 'PATCH', payload: { managerNote }, guildId, errorContext: 'API Error (Update Evaluation):' });
}

// ============================================================================
// MARKETPLACE
// ============================================================================

export async function fetchMarketplaceData(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/marketplace', { method: 'GET', guildId, errorContext: 'API Error (Marketplace):' });
}
