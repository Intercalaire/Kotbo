/** Transcripts et pieces jointes de preuve. */
import { authStore } from '../stores/auth.svelte';
import { API_BASE_URL, dashboardMutation, dashboardRequest } from './client';

// ─────────────────────────────────────────────────────────────
// Transcripts
// ─────────────────────────────────────────────────────────────

export interface TranscriptSummary {
  id: string;
  guildId: string;
  channelId: string;
  channelName: string;
  startMessageId: string | null;
  endMessageId: string | null;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
}

export interface TranscriptListResult {
  transcripts: TranscriptSummary[];
  total: number | null;
  limit: number;
  offset: number;
}

export async function fetchTranscripts(
  params: { q?: string; from?: string; to?: string; limit?: number; offset?: number; includeTotal?: boolean } = {},
  guildId = authStore.selectedGuildId,
): Promise<TranscriptListResult> {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  if (params.includeTotal === false) search.set('includeTotal', 'false');
  const qs = search.toString();
  const data = await dashboardRequest(`/tickets/transcripts${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Transcripts):',
  });
  return data || { transcripts: [], total: 0, limit: 50, offset: 0 };
}

export async function deleteTranscript(transcriptId: string, guildId = authStore.selectedGuildId): Promise<boolean> {
  return dashboardMutation(`/tickets/transcripts/${transcriptId}`, {
    method: 'DELETE',
    guildId,
    errorContext: 'API Error (Delete Transcript):',
  });
}

export async function uploadEvidenceFile(
  fileName: string,
  mimeType: string,
  data: string, // base64
  sanctionId: string | null = null,
  guildId = authStore.selectedGuildId,
): Promise<{ id: string } | null> {
  return await dashboardRequest(`/sanctions/evidence-files`, {
    method: 'POST',
    payload: { sanctionId, fileName, mimeType, data },
    guildId,
    errorContext: 'API Error (Upload Evidence):',
  });
}

export async function deleteEvidenceFile(
  fileId: string,
  guildId = authStore.selectedGuildId,
): Promise<boolean> {
  return await dashboardMutation(`/sanctions/evidence-files/${fileId}`, {
    method: 'DELETE',
    guildId,
    errorContext: 'API Error (Delete Evidence):',
  });
}

export async function fetchEvidenceFileSignedUrl(
  fileId: string,
  guildId = authStore.selectedGuildId,
): Promise<string | null> {
  const data = await dashboardRequest(`/sanctions/evidence-files/${fileId}/signed-url`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Evidence URL):',
    silent: true,
  });
  return data?.signedUrl ? `${API_BASE_URL}${data.signedUrl}` : null;
}
