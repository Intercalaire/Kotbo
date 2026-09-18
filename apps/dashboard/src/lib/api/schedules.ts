/** Taches planifiees. */
import { authStore } from '../stores/auth.svelte';
import { dashboardMutation, dashboardRequest } from './client';

import { m } from '../i18n';
// Schedules API functions
export async function fetchSchedules(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/schedules', { method: 'GET', guildId, errorContext: 'API Error (Fetch Schedules):' });
}

export async function createSchedule(payload: {
  name: string;
  type: string;
  cron: string;
  targetId?: string | null;
  enabled?: boolean;
}, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/schedules', { method: 'POST', successMessage: m.api_ok_create_schedule(), payload, guildId, errorContext: 'API Error (Create Schedule):' });
}

export async function updateSchedule(scheduleId: string, payload: {
  name?: string;
  type?: string;
  cron?: string;
  targetId?: string | null;
  enabled?: boolean;
}, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/schedules/${scheduleId}`, { method: 'PATCH', successMessage: m.api_ok_update_schedule(), payload, guildId, errorContext: 'API Error (Update Schedule):' });
}

export async function deleteSchedule(scheduleId: string, guildId = authStore.selectedGuildId) {
  return dashboardMutation(`/schedules/${scheduleId}`, { method: 'DELETE', guildId, errorContext: 'API Error (Delete Schedule):' });
}

export async function runScheduleNow(scheduleId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/schedules/${scheduleId}/run`, { method: 'POST', successMessage: m.api_ok_run_schedule_now(), guildId, errorContext: 'API Error (Run Schedule Now):' });
}
