/** Administration du bot (instance globale). */
import { authStore } from '../stores/auth.svelte';
import { API_BASE_URL, BASE_URL, JSON_HEADERS, authorizedFetch, getGuildId, dashboardMutation } from './client';

export async function fetchAdminStats() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/stats`);
  if (!response.ok) throw new Error('Erreur lors du chargement des statistiques admin');
  return response.json();
}

export async function fetchAdminModuleStats(options?: {
  guildId?: string;
  moduleName?: string;
  startDate?: string;
  endDate?: string;
  periodDays?: number;
  summary?: boolean;
}) {
  const params = new URLSearchParams();
  if (options?.guildId) params.set('guildId', options.guildId);
  if (options?.moduleName) params.set('moduleName', options.moduleName);
  if (options?.startDate) params.set('startDate', options.startDate);
  if (options?.endDate) params.set('endDate', options.endDate);
  if (options?.periodDays) params.set('period', options.periodDays.toString());
  if (options?.summary) params.set('summary', 'true');

  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/stats/modules?${params.toString()}`);
  if (!response.ok) throw new Error('Erreur lors du chargement des statistiques de modules');
  return response.json();
}

export async function fetchAdminGuilds() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/guilds`);
  if (!response.ok) throw new Error('Erreur lors du chargement des serveurs');
  return response.json();
}

export async function fetchAdminShards() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/shards`);
  if (!response.ok) throw new Error('Erreur lors du chargement des shards');
  return response.json();
}

export async function restartAdminShard(shardId: number) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/shards/${shardId}/restart`, { method: 'POST' });
  if (!response.ok) throw new Error('Erreur lors du redémarrage du shard');
  return response.json();
}

export async function restartAllAdminShards() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/shards/restart-all`, { method: 'POST' });
  if (!response.ok) throw new Error('Erreur lors du redémarrage global');
  return response.json();
}

export async function reconfigureAdminShards(payload: { mode: 'auto' | 'fixed'; shardCount?: number | null }) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/shards/reconfigure`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Erreur lors de la reconfiguration des shards');
  return response.json();
}

export async function fetchGlobalDailyAlgoLeaderboard() {
  const guildId = getGuildId();
  if (!guildId) return null;
  const response = await authorizedFetch(`${BASE_URL}/guilds/${guildId}/daily-algo-submissions/global-leaderboard`);
  if (!response.ok) return null;
  return response.json();
}

export async function fetchAdminGuildInvite(guildId: string) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/guilds/${guildId}/invite`, { method: 'POST' });
  if (!response.ok) throw new Error("Erreur lors de la création de l'invitation");
  return response.json();
}

export async function leaveAdminGuild(guildId: string) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/guilds/${guildId}/leave`, { method: 'POST' });
  if (!response.ok) throw new Error('Erreur lors du départ du serveur');
  return response.json();
}

export async function fetchGlobalAdmins() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/admins`, { method: 'GET' });
  if (!response.ok) throw new Error('Erreur lors du chargement des admins globaux');
  return response.json();
}

export async function addGlobalAdmin(userId: string) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/admins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Erreur lors de l'ajout de l'admin global");
  }
  return response.json();
}

export async function removeGlobalAdmin(userId: string) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/admins/${userId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error("Erreur lors de la suppression de l'admin global");
  return response.json();
}

export async function fetchGlobalBlacklist() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/blacklist`, { method: 'GET' });
  if (!response.ok) throw new Error('Erreur chargement blacklist');
  return response.json();
}

export async function addGlobalBlacklist(userId: string, reason: string) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/blacklist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, reason })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Erreur d'ajout blacklist");
  }
  return response.json();
}

export async function removeGlobalBlacklist(userId: string) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/blacklist/${userId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Erreur suppression blacklist');
  return response.json();
}

export interface GdprPreviewTable { key: string; label: string; count: number; }
export interface GdprPreviewCategory { key: string; label: string; description: string; count: number; tables: GdprPreviewTable[]; }
export interface GdprPreview {
  meta: { userId: string; username: string | null; globalName: string | null; generatedAt: string; totalRecords: number; guildCount: number; errors: string[]; };
  identity: { discordUser: Record<string, unknown> | null; guilds: { id: string; name: string }[]; staffMemberIds: string[]; };
  categories: GdprPreviewCategory[];
}

export async function fetchGdprPreview(userId: string): Promise<GdprPreview> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/gdpr/${userId}/preview`, { method: 'GET' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Erreur lors de la collecte des données RGPD');
  }
  return response.json();
}

export async function downloadGdprExport(userId: string): Promise<void> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/gdpr/${userId}/export`, {
    method: 'GET',
    headers: { 'Accept': 'application/zip' },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Erreur lors de la génération de l'archive");
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || `kotbo_rgpd_${userId}.zip`;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function fetchMaintenanceConfig() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/config`, { method: 'GET' });
  if (!response.ok) throw new Error('Erreur chargement config');
  return response.json();
}

export async function updateMaintenanceConfig(maintenance: boolean) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maintenance })
  });
  if (!response.ok) throw new Error('Erreur maj maintenance');
  return response.json();
}

export async function fetchBotErrors() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/errors`, { method: 'GET' });
  if (!response.ok) throw new Error('Erreur chargement erreurs');
  return response.json();
}

export async function clearBotErrors() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/errors`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Erreur suppression erreurs');
  return response.json();
}

// ─── Broadcast System ───

export interface BroadcastPayload {
  title?: string;
  message: string;
  color?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  footerText?: string;
  target?: 'ALL' | 'ACTIVATED' | 'CUSTOM';
  targetGuilds?: string[];
  channelPref?: 'AUTO' | 'NEWS' | 'PUBLIC' | 'STAFF' | 'FALLBACK';
  dryRun?: boolean;
}

export interface BroadcastGuildChannel {
  id: string;
  name: string;
  category: string | null;
  position: number;
}

export interface BroadcastGuildConfig {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
  activated: boolean;
  broadcastChannelId: string | null;
  broadcastChannelName: string | null;
  channelStatus: 'OK' | 'MISSING' | 'UNSET';
  channels: BroadcastGuildChannel[];
}

export interface BroadcastResult {
  success: boolean;
  successCount: number;
  failCount: number;
  totalTargeted: number;
  dryRun?: boolean;
}

export interface BroadcastLogEntry {
  id: string;
  sentBy: string;
  username?: string;
  avatarUrl?: string | null;
  title: string;
  message: string;
  color: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  footerText: string | null;
  target: string;
  targetGuilds: string[];
  channelPref: string;
  successCount: number;
  failCount: number;
  totalTargeted: number;
  createdAt: string;
}

export interface BroadcastEmoji {
  key: string;
  discordName: string;
  formatted: string;
  unicode?: string;
}

export async function sendBroadcast(payload: BroadcastPayload): Promise<BroadcastResult> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Erreur broadcast');
  }
  return response.json();
}

export async function fetchBroadcastHistory(limit = 20): Promise<{ logs: BroadcastLogEntry[] }> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/broadcast?limit=${limit}`);
  if (!response.ok) throw new Error('Erreur chargement historique');
  return response.json();
}

export async function deleteBroadcastLog(id: string): Promise<void> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/broadcast/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Erreur suppression');
}

export async function fetchBroadcastEmojis(): Promise<{ emojis: BroadcastEmoji[] }> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/broadcast/emojis`);
  if (!response.ok) throw new Error('Erreur chargement emojis');
  return response.json();
}

export async function fetchBroadcastChannels(): Promise<{ guilds: BroadcastGuildConfig[] }> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/broadcast/channels`);
  if (!response.ok) throw new Error('Erreur chargement des salons de diffusion');
  return response.json();
}

export async function setBroadcastChannel(guildId: string, channelId: string | null): Promise<void> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/broadcast/channels/${guildId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Erreur lors de la configuration du salon');
  }
}

export async function updateRecruitmentConfig(payload: any, guildId: string = authStore.selectedGuildId) {
  return dashboardMutation('/recruitment/config', {
    method: 'PATCH',
    payload,
    guildId,
    errorContext: 'API Error (Update Recruitment Config):'
  });
}

export async function fetchActivationCodes() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/activation-codes`, { method: 'GET' });
  if (!response.ok) throw new Error("Erreur lors du chargement des codes d'activation");
  return response.json();
}

export interface AccessGrant {
  /** PERMANENT : accès sans expiration. TRIAL/SUBSCRIPTION : nécessite durationMinutes. */
  accessType?: 'PERMANENT' | 'TRIAL' | 'SUBSCRIPTION';
  /** Durée en minutes, l'unité de stockage unique, du test de 30 min à l'essai de 15 jours. */
  durationMinutes?: number | null;
  label?: string | null;
}

export async function createActivationCode(grant: AccessGrant = {}) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/activation-codes`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(grant),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Erreur lors de la génération du code d'activation");
  }
  return response.json();
}

export async function deleteActivationCode(id: string) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/activation-codes/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error("Erreur lors de la suppression du code d'activation");
  return response.json();
}

export async function deactivateAdminGuild(guildId: string) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/guilds/${guildId}/deactivate`, { method: 'POST' });
  if (!response.ok) throw new Error('Erreur lors de la désactivation du serveur');
  return response.json();
}

export async function activateAdminGuildAuto(guildId: string, grant: AccessGrant = {}) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/guilds/${guildId}/activate-auto`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(grant),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Erreur lors de l'activation automatique du serveur");
  }
  return response.json();
}

/** Prolonge l'accès à durée limitée d'un serveur (geste commercial, renouvellement). */
export async function extendAdminGuildAccess(guildId: string, minutes: number, accessType?: AccessGrant['accessType']) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/guilds/${guildId}/access/extend`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ minutes, accessType }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Erreur lors de la prolongation de l'accès");
  }
  return response.json();
}

export async function reconcileStaffServers() {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/staff-servers/reconcile`, { method: 'POST' });
  if (!response.ok) throw new Error('Erreur lors de la synchronisation des serveurs staff');
  return response.json();
}

export async function rescanAdminGuildStats(guildId: string, force = false) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/guilds/${guildId}/rescan-stats`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ force })
  });
  if (!response.ok) throw new Error('Erreur lors du lancement du rescan des statistiques');
  return response.json();
}

export async function resyncAdminGuildData(guildId: string) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/guilds/${guildId}/resync-all`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || 'Erreur lors du lancement de la synchronisation complète');
  }
  return response.json();
}

export async function resetAdminGuildServerTemplate(guildId: string) {
  const response = await authorizedFetch(`${API_BASE_URL}/api/admin/guilds/${guildId}/reset-server-template`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || 'Erreur lors de la réinitialisation de la mise en place');
  }
  return response.json();
}

export async function activateGuildWithCode(code: string, guildId = authStore.selectedGuildId) {
  const token = authStore.token;
  if (!token) {
    throw new Error('No auth token available');
  }
  const response = await fetch(`${BASE_URL}/guilds/${guildId}/activate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ code })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Erreur lors de l'activation du serveur");
  }
  return response.json();
}
