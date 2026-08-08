/** Staff Simulator - scenarios d entrainement et rapports de session. */
import type { Difficulty, ScenarioIssue, ScenarioStep } from '@kotbo/shared';
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

export interface SimulationConfig {
  guildId: string;
  enabled: boolean;
  testChannelId: string | null;
  stepTimeoutSeconds: number;
  traineeRoleIds: string[];
}

export interface SimulationScenario {
  id: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  enabled: boolean;
  steps: ScenarioStep[];
  updatedAt: string;
}

export interface SimulationSessionSummary {
  id: string;
  traineeId: string;
  traineeName: string;
  status: 'RUNNING' | 'COMPLETED' | 'ABANDONED';
  score: number;
  maxScore: number;
  scorePercent: number;
  correctCount: number;
  partialCount: number;
  missedCount: number;
  averageResponseMs: number;
  advice: string[];
  startedAt: string;
  completedAt: string | null;
  scenario: { title: string; difficulty: Difficulty };
}

export interface SimulationAnswer {
  id: string;
  stepIndex: number;
  stepKind: string;
  expectedAction: string;
  expectedMinutes: number | null;
  chosenAction: string | null;
  chosenMinutes: number | null;
  correct: boolean;
  partiallyCorrect: boolean;
  points: number;
  maxPoints: number;
  slow: boolean;
  reason: string;
  responseMs: number;
}

export interface SimulationSessionDetail extends SimulationSessionSummary {
  answers: SimulationAnswer[];
}

export interface SaveScenarioPayload {
  title: string;
  description: string;
  difficulty: Difficulty;
  enabled: boolean;
  steps: ScenarioStep[];
}

export async function fetchSimulation(
  guildId = authStore.selectedGuildId,
): Promise<{ config: SimulationConfig; scenarios: SimulationScenario[] }> {
  return dashboardRequest('/simulation', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Simulation):',
  });
}

export async function updateSimulationConfig(
  payload: Partial<SimulationConfig>,
  guildId = authStore.selectedGuildId,
): Promise<{ config: SimulationConfig }> {
  return dashboardRequest('/simulation/config', {
    method: 'PATCH',
    payload,
    guildId,
    errorContext: 'API Error (Simulation Config):',
  });
}

export async function createScenario(
  payload: SaveScenarioPayload,
  guildId = authStore.selectedGuildId,
): Promise<{ scenario: SimulationScenario }> {
  return dashboardRequest('/simulation/scenarios', {
    method: 'POST',
    payload,
    guildId,
    errorContext: 'API Error (Create Scenario):',
  });
}

export async function updateScenario(
  id: string,
  payload: SaveScenarioPayload,
  guildId = authStore.selectedGuildId,
): Promise<{ scenario: SimulationScenario }> {
  return dashboardRequest(`/simulation/scenarios/${id}`, {
    method: 'PUT',
    payload,
    guildId,
    errorContext: 'API Error (Update Scenario):',
  });
}

export async function deleteScenario(
  id: string,
  guildId = authStore.selectedGuildId,
): Promise<{ success: boolean }> {
  return dashboardRequest(`/simulation/scenarios/${id}`, {
    method: 'DELETE',
    guildId,
    errorContext: 'API Error (Delete Scenario):',
  });
}

/** Valide un scenario cote serveur, sans l enregistrer. */
export async function validateScenarioRemote(
  payload: { title: string; steps: ScenarioStep[] },
  guildId = authStore.selectedGuildId,
): Promise<{ issues: ScenarioIssue[] }> {
  return dashboardRequest('/simulation/scenarios', {
    method: 'PATCH',
    payload,
    guildId,
    errorContext: 'API Error (Validate Scenario):',
  });
}

export async function fetchSimulationSessions(
  traineeId?: string,
  guildId = authStore.selectedGuildId,
): Promise<{ sessions: SimulationSessionSummary[] }> {
  const query = traineeId ? `?traineeId=${traineeId}` : '';
  return dashboardRequest(`/simulation/sessions${query}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Simulation Sessions):',
  });
}

export async function fetchSimulationSession(
  sessionId: string,
  guildId = authStore.selectedGuildId,
): Promise<{ session: SimulationSessionDetail }> {
  return dashboardRequest(`/simulation/sessions/${sessionId}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Simulation Session):',
  });
}
