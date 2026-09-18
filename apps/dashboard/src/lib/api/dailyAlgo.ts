/** Daily Algo : problemes, planning, soumissions. */
import { authStore } from '../stores/auth.svelte';
import { dashboardMutation, dashboardRequest } from './client';

import { m } from '../i18n';
export async function fetchDailyAlgoProblems(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/daily-algo-problems', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Fetch Daily Algo Problems):'
  });
}

export async function createDailyAlgoProblem(problem, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/daily-algo-problems', {
    method: 'POST',
    successMessage: m.api_ok_create_daily_algo_problem(),
    payload: problem,
    guildId,
    errorContext: 'API Error (Create Daily Algo Problem):'
  });
}

export async function updateDailyAlgoProblem(problemId, problem, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/daily-algo-problems/${problemId}`, {
    method: 'PATCH',
    successMessage: m.api_ok_update_daily_algo_problem(),
    payload: problem,
    guildId,
    errorContext: 'API Error (Update Daily Algo Problem):'
  });
}

export async function deleteDailyAlgoProblem(problemId, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/daily-algo-problems/${problemId}`, {
    method: 'DELETE',
    successMessage: m.api_ok_delete_daily_algo_problem(),
    guildId,
    errorContext: 'API Error (Delete Daily Algo Problem):'
  });
}

export async function fetchDailyAlgoSchedule(daysBack = 7, daysForward = 21, guildId = authStore.selectedGuildId) {
  const safeDaysBack = Math.max(0, Math.trunc(daysBack || 0));
  const safeDaysForward = Math.max(0, Math.trunc(daysForward || 0));
  return dashboardRequest(`/daily-algo-runs/schedule?daysBack=${safeDaysBack}&daysForward=${safeDaysForward}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Fetch Daily Algo Schedule):'
  });
}

/**
 * `silent` : cette route est aussi appelee automatiquement a l'ouverture de la
 * page Daily Algo. Une generation de planning declenchee par personne n'a pas a
 * afficher un « Operation reussie » ; on ne le garde que pour le bouton explicite.
 */
export async function ensureDailyAlgoSchedule(daysForward = 21, guildId = authStore.selectedGuildId, silent = false) {
  const safeDaysForward = Math.max(1, Math.trunc(daysForward || 1));
  return dashboardRequest('/daily-algo-runs/schedule/ensure', {
    method: 'POST',
    successMessage: m.api_ok_ensure_daily_algo_schedule(),
    payload: { daysForward: safeDaysForward },
    guildId,
    silent,
    errorContext: 'API Error (Ensure Daily Algo Schedule):'
  });
}

export async function fetchCurrentDailyAlgoWeek(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/daily-algo-weeks/current', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Fetch Current Daily Algo Week):'
  });
}

export async function fetchDailyAlgoWeekHistory(limit = 10, guildId = authStore.selectedGuildId) {
  const safeLimit = Math.max(1, Math.min(52, Math.trunc(limit || 1)));
  return dashboardRequest(`/daily-algo-weeks/history?limit=${safeLimit}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Fetch Daily Algo Week History):'
  });
}

/**
 * Clôture une semaine sans attendre le cron du lundi.
 * Sans `weekKey`, clôture la semaine en cours. Geste non annulable.
 */
export async function closeDailyAlgoWeek(weekKey = null, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/daily-algo-weeks/close', {
    method: 'POST',
    successMessage: m.api_ok_close_daily_algo_week(),
    payload: weekKey ? { weekKey } : {},
    guildId,
    errorContext: 'API Error (Close Daily Algo Week):'
  });
}

export async function swapTodayDailyAlgoProblem(problemId, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/daily-algo-runs/today/problem', {
    method: 'PATCH',
    successMessage: m.api_ok_swap_today_daily_algo_problem(),
    payload: { problemId },
    guildId,
    errorContext: 'API Error (Swap Today Daily Algo Problem):'
  });
}

export async function fetchMyApiKeys(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/api-keys', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Fetch API Keys):'
  });
}

export async function createOrResetDailyAlgoApiKey(name = 'Kotbo Daily Algo', guildId = authStore.selectedGuildId) {
  return dashboardRequest('/api-keys', {
    method: 'POST',
    successMessage: m.api_ok_create_or_reset_daily_algo_api_key(),
    payload: {
      name,
      permissions: [
        'daily_algo:read_exercise',
        'daily_algo:create_exercise',
        'daily_algo:update_exercise',
        'daily_algo:manage_exercises'
      ]
    },
    guildId,
    errorContext: 'API Error (Create or Reset API Key):'
  });
}

export async function deleteMyApiKey(keyId, guildId = authStore.selectedGuildId) {
  return dashboardMutation(`/api-keys/${keyId}`, {
    method: 'DELETE',
    guildId,
    errorContext: 'API Error (Delete API Key):'
  });
}

export async function fetchTodayDailyAlgoSubmissions(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/daily-algo-submissions/today', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Fetch Daily Algo Submissions):'
  });
}

export async function fetchDailyAlgoSubmissionHistory(limit = 7, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/daily-algo-submissions/history?limit=${Math.max(1, Math.trunc(limit || 1))}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Fetch Daily Algo Submission History):'
  });
}

export async function reviewDailyAlgoSubmission(submissionId, review, guildId = authStore.selectedGuildId) {
  return dashboardMutation(`/daily-algo-submissions/${submissionId}`, {
    method: 'PATCH',
    payload: review,
    guildId,
    errorContext: 'API Error (Review Daily Algo Submission):'
  });
}

export async function fetchDailyAlgoSubmission(submissionId, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/daily-algo-submissions/${submissionId}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Fetch Daily Algo Submission):'
  });
}
