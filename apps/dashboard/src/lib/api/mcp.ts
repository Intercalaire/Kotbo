/** Cles et journaux MCP. */
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

import { m } from '../i18n';
export async function fetchMcpKeys(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/mcp-keys', { method: 'GET', guildId, errorContext: 'API Error (Fetch MCP Keys):' });
}

export async function createMcpKey(payload: { name: string; permissions: string[] }, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/mcp-keys', { method: 'POST', successMessage: m.api_ok_create_mcp_key(), payload, guildId, errorContext: 'API Error (Create MCP Key):' });
}

export async function deleteMcpKey(keyId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/mcp-keys/${keyId}`, { method: 'DELETE', guildId, errorContext: 'API Error (Delete MCP Key):' });
}

export async function fetchMcpDirectUrl(keyId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/mcp-keys/${keyId}/direct-url`, { method: 'GET', guildId, errorContext: 'API Error (Fetch MCP Direct URL):' });
}

export async function fetchMcpLogs(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/mcp-logs', { method: 'GET', guildId, errorContext: 'API Error (Fetch MCP Logs):' });
}
