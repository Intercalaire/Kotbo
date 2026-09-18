/** Quetes. */
import { authStore } from '../stores/auth.svelte';
import { dashboardMutation, dashboardRequest } from './client';

import { m } from '../i18n';
// ============================================================================
// QUESTS
// ============================================================================

export async function fetchQuestsData(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/quests', { method: 'GET', guildId, errorContext: 'API Error (Quests):' });
}

export async function createQuest(data: { name: string; description: string; type: string; frequency: string; target: number; rewardCoins: number; rewardXp: number }, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/quests', { method: 'POST', successMessage: m.api_ok_create_quest(), payload: data, guildId, errorContext: 'API Error (Create Quest):' });
}

export async function updateQuest(questId: string, data: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/quests/${questId}`, { method: 'PATCH', successMessage: m.api_ok_update_quest(), payload: data, guildId, errorContext: 'API Error (Update Quest):' });
}

export async function deleteQuest(questId: string, guildId = authStore.selectedGuildId) {
  return dashboardMutation(`/quests/${questId}`, { method: 'DELETE', guildId, errorContext: 'API Error (Delete Quest):' });
}
