/** Analytics et profils publics. */
import { authStore } from '../stores/auth.svelte';
import { timezoneStore } from '../stores/timezone.svelte';
import { API_BASE_URL, JSON_HEADERS, getGuildId, dashboardRequest } from './client';

import { DashboardApiError, kindFromStatus } from './errors';
/**
 * Fuseau de lecture joint a toute requete qui renvoie des creneaux horaires.
 *
 * Les agregats sont stockes en UTC : sans ce parametre, l'API repondait avec
 * des heures UTC et le dashboard affichait a minuit un pic reellement observe
 * a 14h. Le serveur retombe sur le fuseau du serveur Discord si le parametre
 * manque ou n'est pas un identifiant IANA connu.
 */
function appendViewTimezone(params: URLSearchParams) {
  params.append('tz', timezoneStore.displayTimezone);
  return params;
}

export async function fetchAnalytics(options: { period?: number, startDate?: string, endDate?: string, granularity?: string } = {}, guildId = authStore.selectedGuildId) {
  const params = new URLSearchParams();
  if (options.period) params.append('period', options.period.toString());
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);
  if (options.granularity) params.append('granularity', options.granularity);
  appendViewTimezone(params);

  return dashboardRequest(`/analytics?${params.toString()}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Analytics):'
  });
}

export async function fetchInviteAnalytics(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/analytics/invites', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Invite Analytics):'
  });
}

export async function fetchChannelDetails(channelId: string, options: { days?: number } = {}, guildId = authStore.selectedGuildId) {
  const params = new URLSearchParams();
  if (options.days) params.append('days', options.days.toString());
  appendViewTimezone(params);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return dashboardRequest(`/analytics/channels/${channelId}${suffix}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Channel Details):'
  });
}

export async function fetchMemberDetailedAnalytics(userId, period = 30, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/analytics/members?userId=${userId}&period=${period}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Member Detailed Analytics):'
  });
}

export async function fetchPublicProfile(userId: string) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authStore.token) {
    headers.Authorization = `Bearer ${authStore.token}`;
  }

  const response = await fetch(`${API_BASE_URL}/api/public/profile/${userId}`, { headers });
  if (!response.ok) {
    throw new DashboardApiError({
      kind: kindFromStatus(response.status),
      status: response.status,
      path: response.url,
    });
  }

  return response.json();
}

export async function updatePublicProfile(userId: string, payload: { bio?: string | null; isProfilePrivate?: boolean }) {
  if (!authStore.token) {
    throw new Error('No auth token available');
  }

  const response = await fetch(`${API_BASE_URL}/api/public/profile/${userId}`, {
    method: 'PATCH',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${authStore.token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new DashboardApiError({
      kind: kindFromStatus(response.status),
      status: response.status,
      path: response.url,
    });
  }

  return response.json();
}

export async function fetchStaffProfile(userId: string, guildId = authStore.selectedGuildId) {
  const selectedGuildId = getGuildId(guildId);
  if (!selectedGuildId) return null;

  if (!authStore.token) {
    throw new Error('No auth token available');
  }

  const response = await fetch(`${API_BASE_URL}/api/dashboard/users/${userId}/profile?guildId=${selectedGuildId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authStore.token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new DashboardApiError({
      kind: kindFromStatus(response.status),
      status: response.status,
      path: response.url,
    });
  }

  return response.json();
}

export async function fetchHourlyHeatmap(options: { days?: number, startDate?: string, endDate?: string } = {}, guildId = authStore.selectedGuildId) {
  const params = new URLSearchParams();
  if (options.days) params.append('days', options.days.toString());
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);
  appendViewTimezone(params);

  return dashboardRequest(`/analytics/heatmap?${params.toString()}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Hourly Heatmap):'
  });
}

export type AdvancedAnalyticsSection =
  | 'retention' | 'activity' | 'churn' | 'channels' | 'social' | 'words' | 'moderation';

export async function fetchAdvancedAnalytics(section: AdvancedAnalyticsSection, guildId = authStore.selectedGuildId) {
  const params = appendViewTimezone(new URLSearchParams({ section }));
  return dashboardRequest(`/analytics/advanced?${params.toString()}`, {
    method: 'GET',
    guildId,
    errorContext: `API Error (Advanced Analytics ${section}):`
  });
}

export async function fetchWeeklyComparison(options: { offset?: number, mode?: 'week' | 'month' } = {}, guildId = authStore.selectedGuildId) {
  const params = new URLSearchParams();
  if (options.offset) params.append('offset', options.offset.toString());
  if (options.mode) params.append('mode', options.mode);
  return dashboardRequest(`/analytics/weekly-comparison?${params.toString()}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Weekly Comparison):'
  });
}

export async function fetchGrowthAndRetention(options: { days?: number, startDate?: string, endDate?: string } = {}, guildId = authStore.selectedGuildId) {
  const params = new URLSearchParams();
  if (options.days) params.append('days', options.days.toString());
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);

  return dashboardRequest(`/analytics/growth-retention?${params.toString()}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Growth & Retention):'
  });
}

export async function fetchDailyAlgoAnalytics(options: { days?: number, startDate?: string, endDate?: string } = {}, guildId = authStore.selectedGuildId) {
  const params = new URLSearchParams();
  if (options.days) params.append('days', options.days.toString());
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);

  return dashboardRequest(`/analytics/daily-algo?${params.toString()}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Daily Algo Analytics):'
  });
}

export async function fetchGlobalInteractions(options: { period?: number, startDate?: string, endDate?: string } = {}, guildId = authStore.selectedGuildId) {
  const params = new URLSearchParams();
  if (options.period) params.append('period', options.period.toString());
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);

  return dashboardRequest(`/analytics/interactions?${params.toString()}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Global Interactions Graph):'
  });
}

// ── Nouvelle page Analytics ────────────────────────────────────────────────

/** Période et filtres partagés par toutes les sections de la page Analytics. */
export interface AnalyticsQuery {
  period?: number;
  startDate?: string;
  endDate?: string;
  /** Salon ou catégorie. */
  channel?: string | null;
  role?: string | null;
  excludeStaff?: boolean;
  includeBots?: boolean;
  userId?: string | null;
}

export interface AnalyticsRange {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  days: number;
}

export interface ComparedValue {
  value: number;
  previous: number;
}

export interface ContentEmoji {
  key: string;
  origin: 'unicode' | 'guild' | 'external';
  count: number;
  name: string | null;
  animated: boolean;
  imageUrl: string | null;
  sourceName: string | null;
}

export interface ContentSticker {
  key: string;
  origin: 'guild' | 'external' | 'standard';
  count: number;
  name: string | null;
  imageUrl: string;
  sourceName: string | null;
}

export interface ContentSourceServer {
  guildId: string | null;
  name: string | null;
  count: number;
  items: number;
}

export interface ContentAnalytics {
  range: AnalyticsRange;
  itemBasis: 'server' | 'channel' | 'member';
  totals: Record<string, number>;
  previous: Record<string, number>;
  emojis: ContentEmoji[];
  reactions: ContentEmoji[];
  emojiServers: ContentSourceServer[];
  reactionServers: ContentSourceServer[];
  stickers: ContentSticker[];
  stickerServers: ContentSourceServer[];
  domains: Array<{ domain: string; family: string; count: number }>;
  gifChannels: Array<{ channelId: string; name: string | null; count: number }>;
  backfill: { status: string; processed: number; total: number } | null;
}

export interface ActivityAnalytics {
  range: AnalyticsRange;
  voiceAvailable: boolean;
  kpis: {
    messages: ComparedValue;
    activeMembers: ComparedValue;
    voiceMinutes: ComparedValue;
    netJoins: ComparedValue;
    joined: number;
    left: number;
    memberCount: number | null;
  };
  series: ActivityDay[];
  topChannels: Array<{ channelId: string; name: string | null; messages: number }>;
  /** Jours inhabituels (pic ou creux) par rapport aux mêmes jours de semaine. */
  anomalies?: ActivityAnomaly[];
}

export interface ActivityDay {
  dateKey: string;
  messages: number;
  voiceMinutes: number;
  prevMessages: number;
  prevVoiceMinutes: number;
  activeMembers?: number;
  prevActiveMembers?: number;
  joined?: number;
  left?: number;
  prevJoined?: number;
  prevLeft?: number;
}

export interface ActivityAnomaly {
  dateKey: string;
  metric: 'messages' | 'voiceMinutes';
  value: number;
  expected: number;
  direction: 'up' | 'down';
  driver: { channelId: string; name: string | null; share: number } | null;
}

export type ActivityMetricKind = 'messages' | 'voice';

export interface ActivityHourPoint { key: string; messages: number; voiceMinutes: number; activeMembers: number }

export interface ActivityHourly {
  available: boolean;
  timezone: string;
  points: ActivityHourPoint[];
  prev: ActivityHourPoint[];
}

export interface ActivityRankingItem {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  value: number;
  previous: number;
  share: number;
  spark: number[];
  deleted?: boolean;
}

export interface ActivityRankings {
  available: boolean;
  metric: ActivityMetricKind;
  dimension: 'members' | 'channels';
  total: number;
  prevTotal: number;
  items: ActivityRankingItem[];
}

export interface ActivityBreakdown {
  available: boolean;
  dates: string[];
  groups: Array<{ id: string | null; name: string | null; total: number; values: number[] }>;
  other: number[];
}

export interface AnalyticsAnnotation {
  id: string;
  dateKey: string;
  label: string;
  authorId: string;
  authorName: string | null;
  createdAt: string;
}

export interface ChannelTreeChannel {
  id: string;
  name: string;
  kind: 'text' | 'voice' | 'forum';
  messages: number;
  voiceMinutes: number;
  prevMessages: number;
  prevVoiceMinutes: number;
  authors: number;
  lastActiveDate: string | null;
}

export interface ChannelTreeCategory {
  id: string | null;
  name: string | null;
  messages: number;
  voiceMinutes: number;
  prevMessages: number;
  prevVoiceMinutes: number;
  authors: number;
  channels: ChannelTreeChannel[];
}

export interface ChannelTree {
  range: AnalyticsRange;
  totals: { messages: number; voiceMinutes: number };
  orphan: { messages: number; voiceMinutes: number } | null;
  categories: ChannelTreeCategory[];
}

export interface CategoryDetail {
  range: AnalyticsRange;
  id: string;
  name: string;
  kpis: {
    messages: ComparedValue;
    voiceMinutes: ComparedValue;
    activeMembers: number;
    messageShare: ComparedValue;
    voiceShare: number;
  };
  daily: Array<{ dateKey: string; textOnly: number; voiceOnly: number; both: number }>;
  voiceHistoryDays: number;
  channels: ChannelTreeChannel[];
  topMembers: Array<{ userId: string; name: string | null; avatarUrl: string | null; messages: number; voiceMinutes: number }>;
}

export interface AnalyticsFilterOptions {
  categories: Array<{ id: string | null; name: string | null; channels: Array<{ id: string; name: string; kind: string }> }>;
  roles: Array<{ id: string; name: string; color: string; members: number }>;
}

function analyticsParams(query: AnalyticsQuery): string {
  const params = new URLSearchParams();
  if (query.startDate && query.endDate) {
    params.append('startDate', query.startDate);
    params.append('endDate', query.endDate);
  } else if (query.period) {
    params.append('period', String(query.period));
  }
  if (query.channel) params.append('channel', query.channel);
  if (query.role) params.append('role', query.role);
  if (query.userId) params.append('userId', query.userId);
  if (query.excludeStaff) params.append('excludeStaff', '1');
  if (query.includeBots) params.append('includeBots', '1');
  return params.toString();
}

export async function fetchContentAnalytics(query: AnalyticsQuery, guildId = authStore.selectedGuildId): Promise<ContentAnalytics | null> {
  return dashboardRequest<ContentAnalytics>(`/analytics/content?${analyticsParams(query)}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Content Analytics):'
  });
}

export async function fetchActivityAnalytics(query: AnalyticsQuery, guildId = authStore.selectedGuildId): Promise<ActivityAnalytics | null> {
  return dashboardRequest<ActivityAnalytics>(`/analytics/activity?${analyticsParams(query)}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Activity Analytics):'
  });
}

export async function fetchActivityHourly(query: AnalyticsQuery, guildId = authStore.selectedGuildId): Promise<ActivityHourly | null> {
  const params = new URLSearchParams(analyticsParams(query));
  params.append('tz', timezoneStore.displayTimezone);
  return dashboardRequest<ActivityHourly>(`/analytics/activity/hourly?${params}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Activity Hourly):'
  });
}

export async function fetchActivityRankings(
  query: AnalyticsQuery,
  metric: ActivityMetricKind,
  dimension: 'members' | 'channels',
  limit = 10,
  guildId = authStore.selectedGuildId,
): Promise<ActivityRankings | null> {
  const params = new URLSearchParams(analyticsParams(query));
  params.append('metric', metric);
  params.append('dimension', dimension);
  params.append('limit', String(limit));
  return dashboardRequest<ActivityRankings>(`/analytics/activity/rankings?${params}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Activity Rankings):'
  });
}

export async function fetchActivityBreakdown(
  query: AnalyticsQuery,
  metric: ActivityMetricKind,
  dimension: 'channel' | 'category',
  guildId = authStore.selectedGuildId,
): Promise<ActivityBreakdown | null> {
  const params = new URLSearchParams(analyticsParams(query));
  params.append('metric', metric);
  params.append('dimension', dimension);
  return dashboardRequest<ActivityBreakdown>(`/analytics/activity/breakdown?${params}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Activity Breakdown):'
  });
}

export async function fetchAnalyticsAnnotations(query: AnalyticsQuery, guildId = authStore.selectedGuildId): Promise<AnalyticsAnnotation[] | null> {
  return dashboardRequest<AnalyticsAnnotation[]>(`/analytics/annotations?${analyticsParams({ period: query.period, startDate: query.startDate, endDate: query.endDate })}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Analytics Annotations):'
  });
}

export async function createAnalyticsAnnotation(payload: { dateKey: string; label: string }, guildId = authStore.selectedGuildId): Promise<{ id: string } | null> {
  return dashboardRequest<{ id: string }>('/analytics/annotations', {
    method: 'POST',
    payload,
    guildId,
    errorContext: 'API Error (Create Annotation):'
  });
}

export async function deleteAnalyticsAnnotation(id: string, guildId = authStore.selectedGuildId): Promise<{ ok: boolean } | null> {
  return dashboardRequest<{ ok: boolean }>(`/analytics/annotations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    guildId,
    errorContext: 'API Error (Delete Annotation):'
  });
}

export interface EngagementAnalytics {
  step: number;
  channelIgnored: boolean;
  points: Array<{ dateKey: string; dau: number; wau: number; mau: number; prevDau: number; prevWau: number; prevMau: number }>;
}

export interface ActivityCohorts {
  weeks: number;
  channelIgnored: boolean;
  cohorts: Array<{ week: string; size: number; retention: Array<number | null> }>;
}

export interface FunnelSteps {
  joined: number;
  stayed: number;
  firstMessage: number;
  eligible7: number;
  active7: number;
  eligible30: number;
  active30: number;
  medianDaysToFirstMessage: number | null;
}

export interface OnboardingFunnel {
  channelIgnored: boolean;
  overall: FunnelSteps;
  bySource: Array<FunnelSteps & { key: string; label: string | null; kind: 'label' | 'vanity' | 'code' | 'unknown' }>;
}

export type LifecycleSegment = 'new' | 'regular' | 'casual' | 'reactivated' | 'declining' | 'dormant' | 'silent';

export interface LifecycleMember {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  lastActive: string | null;
  recentDays: number;
  previousDays: number;
  joinedAt: string | null;
}

export interface LifecycleAnalytics {
  asOf: string;
  prevAsOf: string;
  channelIgnored: boolean;
  counts: Record<LifecycleSegment, number>;
  prevCounts: Record<LifecycleSegment, number>;
  transitions: Array<{ from: LifecycleSegment; to: LifecycleSegment; count: number }>;
  lists: Partial<Record<LifecycleSegment, LifecycleMember[]>>;
}

function audienceRequest<T>(view: string, query: AnalyticsQuery, guildId: typeof authStore.selectedGuildId): Promise<T | null> {
  return dashboardRequest<T>(`/analytics/audience/${view}?${analyticsParams(query)}`, {
    method: 'GET',
    guildId,
    errorContext: `API Error (Audience ${view}):`
  });
}

export const fetchEngagement = (query: AnalyticsQuery, guildId = authStore.selectedGuildId) => audienceRequest<EngagementAnalytics>('engagement', query, guildId);
export const fetchActivityCohorts = (query: AnalyticsQuery, guildId = authStore.selectedGuildId) => audienceRequest<ActivityCohorts>('cohorts', query, guildId);
export const fetchOnboardingFunnel = (query: AnalyticsQuery, guildId = authStore.selectedGuildId) => audienceRequest<OnboardingFunnel>('funnel', query, guildId);
export const fetchLifecycle = (query: AnalyticsQuery, guildId = authStore.selectedGuildId) => audienceRequest<LifecycleAnalytics>('lifecycle', query, guildId);

export async function fetchChannelTree(query: AnalyticsQuery, guildId = authStore.selectedGuildId): Promise<ChannelTree | null> {
  return dashboardRequest<ChannelTree>(`/analytics/channel-tree?${analyticsParams({ period: query.period, startDate: query.startDate, endDate: query.endDate })}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Channel Tree):'
  });
}

export async function fetchCategoryDetail(categoryId: string, query: AnalyticsQuery, guildId = authStore.selectedGuildId): Promise<CategoryDetail | null> {
  return dashboardRequest<CategoryDetail>(`/analytics/categories/${categoryId}?${analyticsParams({ period: query.period, startDate: query.startDate, endDate: query.endDate })}`, {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Category Detail):'
  });
}

export async function fetchAnalyticsFilterOptions(guildId = authStore.selectedGuildId): Promise<AnalyticsFilterOptions | null> {
  return dashboardRequest<AnalyticsFilterOptions>('/analytics/filters', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Analytics Filters):'
  });
}
