/** Tutorat. */
import { authStore } from '../stores/auth.svelte';
import { dashboardMutation, dashboardRequest } from './client';

import { m } from '../i18n';
// Tutoring
export async function fetchTutoringConfig(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/tutoring/config', { method: 'GET', guildId });
}

export async function updateTutoringConfig(config, guildId = authStore.selectedGuildId) {
  return dashboardMutation('/tutoring/config', { method: 'PATCH', payload: config, guildId });
}

export async function fetchTutoringItems(hierarchyId?: string | null, guildId = authStore.selectedGuildId) {
  const suffix = hierarchyId !== undefined ? `?hierarchyId=${hierarchyId === null ? 'none' : hierarchyId}` : '';
  return dashboardRequest(`/tutoring/items${suffix}`, { method: 'GET', guildId });
}

export async function upsertTutoringItem(item, guildId = authStore.selectedGuildId) {
  return dashboardMutation('/tutoring/items', { method: 'POST', payload: item, guildId });
}

export async function deleteTutoringItem(itemId, guildId = authStore.selectedGuildId) {
  return dashboardMutation(`/tutoring/items/${itemId}`, { method: 'DELETE', guildId });
}

export async function fetchTutorDashboard(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/tutoring/tutor-dashboard', { method: 'GET', guildId });
}

export async function fetchApprenticeProgress(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/tutoring/apprentice-progress', { method: 'GET', guildId });
}

export async function updateTutoringChecklist(testingPeriodId, itemId, state, guildId = authStore.selectedGuildId) {
  return dashboardMutation('/tutoring/checklist', { method: 'PATCH', payload: { testingPeriodId, itemId, state }, guildId });
}

export async function addTutoringLog(testingPeriodId, content, guildId = authStore.selectedGuildId) {
  return dashboardMutation('/tutoring/logs', { method: 'POST', payload: { testingPeriodId, content }, guildId });
}

export async function deleteTestingPeriod(periodId, guildId = authStore.selectedGuildId) {
  return dashboardMutation(`/tutoring/periods/${periodId}`, { method: 'DELETE', guildId });
}

export async function createTestingPeriod(payload, guildId = authStore.selectedGuildId) {
  return dashboardMutation('/tutoring/periods', { method: 'POST', payload, guildId });
}

export async function addMentorReport(testingPeriodId, type, content, guildId = authStore.selectedGuildId) {
  return dashboardMutation('/mentor-reports', { method: 'POST', payload: { testingPeriodId, type, content }, guildId });
}

export async function endTestingPeriod(periodId, status, notes = '', force = false, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/testing-periods/${periodId}`, { method: 'PATCH', successMessage: m.api_ok_end_testing_period(), payload: { status, notes, force }, guildId });
}
