/** Clans. */
import { authStore } from '../stores/auth.svelte';
import { API_BASE_URL, dashboardMutation, dashboardRequest } from './client';

// ─────────────────────────────────────────────────────────────
// Clans
// ─────────────────────────────────────────────────────────────

export interface ClanEntry {
  id: string;
  name: string;
  description: string | null;
  roleId: string;
  generalChannelId: string | null;
  leaderRoleId: string | null;
  memberCount: number;
  totalXp: number;
}

export interface ClansDataResult {
  clansEnabled: boolean;
  clanAutoAssignOnJoin: boolean;
  currentClanSeason: number;
  clanXpFromLevelUp: boolean;
  clanXpPerLevelUp: number;
  clanXpLevelUpProportional: boolean;
  clanXpReferenceLevel: number;
  clanXpFromBoost: boolean;
  clanXpPerBoost: number;
  clanAnnouncementChannelId: string | null;
  clanRewardGiveaway: boolean;
  clanRewardXpBoost: boolean;
  clanRewardXpBoostRate: number;
  clanRewardLeaderRole: boolean;
  lastWinningClanId: string | null;
  clanSeasonStartsAt: string | null;
  clanSeasonEndsAt: string | null;
  betsEnabled: boolean;
  betChannelId: string | null;
  betAnnouncementChannelId: string | null;
  betMinStake: number;
  betMaxStake: number;
  betMaxOpenPerMember: number;
  betAcceptWindowHours: number;
  betAllowDebt: boolean;
  betMaxDebt: number;
  betDebtResetOnSeason: boolean;
  betResolverRoleIds: string[];
  clans: ClanEntry[];
  taskInProgress: { type: 'distribute' | 'clear' | 'dedupe'; processed: number; total: number } | null;
}

export async function fetchClansData(guildId = authStore.selectedGuildId): Promise<ClansDataResult | null> {
  return dashboardRequest('/clans', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Fetch Clans):',
    silent: true,
  });
}

export async function updateClanSettings(
  payload: {
    clansEnabled?: boolean;
    clanAutoAssignOnJoin?: boolean;
    clanXpFromLevelUp?: boolean;
    clanXpPerLevelUp?: number;
    clanXpLevelUpProportional?: boolean;
    clanXpReferenceLevel?: number;
    clanXpFromBoost?: boolean;
    clanXpPerBoost?: number;
    clanAnnouncementChannelId?: string | null;
    clanRewardGiveaway?: boolean;
    clanRewardLeaderRole?: boolean;
    clanRewardXpBoost?: boolean;
    clanRewardXpBoostRate?: number;
    clanSeasonStartsAt?: string | null;
    clanSeasonEndsAt?: string | null;
    betsEnabled?: boolean;
    betChannelId?: string | null;
    betAnnouncementChannelId?: string | null;
    betMinStake?: number;
    betMaxStake?: number;
    betMaxOpenPerMember?: number;
    betAcceptWindowHours?: number;
    betAllowDebt?: boolean;
    betMaxDebt?: number;
    betDebtResetOnSeason?: boolean;
    betResolverRoleIds?: string[];
  },
  guildId = authStore.selectedGuildId,
): Promise<{
  clansEnabled: boolean;
  clanAutoAssignOnJoin: boolean;
  clanXpFromLevelUp: boolean;
  clanXpPerLevelUp: number;
  clanXpLevelUpProportional: boolean;
  clanXpReferenceLevel: number;
  clanXpFromBoost: boolean;
  clanXpPerBoost: number;
  clanAnnouncementChannelId: string | null;
  clanRewardGiveaway: boolean;
  clanRewardLeaderRole: boolean;
  clanRewardXpBoost: boolean;
  clanRewardXpBoostRate: number;
  clanSeasonStartsAt: string | null;
  clanSeasonEndsAt: string | null;
  betsEnabled: boolean;
  betChannelId: string | null;
  betAnnouncementChannelId: string | null;
  betMinStake: number;
  betMaxStake: number;
  betMaxOpenPerMember: number;
  betAcceptWindowHours: number;
  betAllowDebt: boolean;
  betMaxDebt: number;
  betDebtResetOnSeason: boolean;
  betResolverRoleIds: string[];
} | null> {
  return dashboardRequest('/clans', {
    method: 'PATCH',
    payload,
    guildId,
    errorContext: 'API Error (Update Clans Settings):',
  });
}

export async function createClan(
  payload: {
    name: string;
    description?: string;
    roleId: string;
    generalChannelId?: string | null;
    leaderRoleId?: string | null;
  },
  guildId = authStore.selectedGuildId,
): Promise<{ clan: ClanEntry } | null> {
  return dashboardRequest('/clans', {
    method: 'POST',
    payload,
    guildId,
    errorContext: 'API Error (Create Clan):',
  });
}

export async function updateClan(
  id: string,
  payload: {
    name: string;
    description?: string;
    roleId: string;
    generalChannelId?: string | null;
    leaderRoleId?: string | null;
  },
  guildId = authStore.selectedGuildId,
): Promise<{ clan: ClanEntry } | null> {
  return dashboardRequest(`/clans/${id}`, {
    method: 'PUT',
    payload,
    guildId,
    errorContext: 'API Error (Update Clan):',
  });
}

export async function deleteClan(id: string, guildId = authStore.selectedGuildId): Promise<boolean> {
  return dashboardMutation(`/clans/${id}`, {
    method: 'DELETE',
    guildId,
    errorContext: 'API Error (Delete Clan):',
  });
}

export async function distributeClans(guildId = authStore.selectedGuildId): Promise<{ message: string } | null> {
  return dashboardRequest('/clans/distribute', {
    method: 'POST',
    guildId,
    errorContext: 'API Error (Distribute Clans):',
  });
}

export async function clearClans(guildId = authStore.selectedGuildId): Promise<{ message: string } | null> {
  return dashboardRequest('/clans/clear', {
    method: 'POST',
    guildId,
    errorContext: 'API Error (Clear Clans):',
  });
}

export async function dedupeClans(guildId = authStore.selectedGuildId): Promise<{ message: string } | null> {
  return dashboardRequest('/clans/dedupe', {
    method: 'POST',
    guildId,
    errorContext: 'API Error (Dedupe Clans):',
  });
}

export async function resetClanSeason(guildId = authStore.selectedGuildId): Promise<{ currentClanSeason: number } | null> {
  return dashboardRequest('/clans/reset-season', {
    method: 'POST',
    guildId,
    errorContext: 'API Error (Reset Clan Season):',
  });
}

export async function resetAllClans(guildId = authStore.selectedGuildId): Promise<{ success: boolean } | null> {
  return dashboardRequest('/clans/reset-all', {
    method: 'POST',
    guildId,
    errorContext: 'API Error (Reset All Clans):',
  });
}

export async function rollbackClanSeason(guildId = authStore.selectedGuildId): Promise<{ currentClanSeason: number } | null> {
  return dashboardRequest('/clans/rollback-season', {
    method: 'POST',
    guildId,
    errorContext: 'API Error (Rollback Clan Season):',
  });
}

/** `amount` positif pour un ajout, négatif pour un retrait. */
export async function adjustClanPoints(
  payload: { clanId?: string | null; userId?: string | null; amount: number },
  guildId = authStore.selectedGuildId
): Promise<{ success: boolean; granted?: number; debtRepaid?: number; contribution?: any } | null> {
  return dashboardRequest('/clans/points', {
    method: 'POST',
    guildId,
    payload,
    errorContext: 'API Error (Adjust Clan Points):',
  });
}

export interface ClanBetEntry {
  id: string;
  subject: string;
  stake: number;
  season: number;
  status: string;
  challengerId: string;
  challengerName: string | null;
  challengerClanName: string | null;
  opponentId: string;
  opponentName: string | null;
  opponentClanName: string | null;
  pot: number;
  creditUsed: number;
  winnerId: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ClanPointDebtEntry {
  userId: string;
  displayName: string | null;
  amount: number;
  source: string;
  createdAt: string;
}

export async function fetchClanBets(
  guildId = authStore.selectedGuildId,
): Promise<{ bets: ClanBetEntry[]; debts: ClanPointDebtEntry[] } | null> {
  return dashboardRequest('/clans/bets', {
    method: 'GET',
    guildId,
    errorContext: 'API Error (Fetch Clan Bets):',
    silent: true,
  });
}

/** Efface la dette de points de clan d'un membre. */
export async function clearClanPointDebt(
  userId: string,
  guildId = authStore.selectedGuildId,
): Promise<boolean> {
  return dashboardMutation(`/clans/bets/debts/${userId}`, {
    method: 'DELETE',
    guildId,
    errorContext: 'API Error (Clear Clan Debt):',
  });
}

export interface GuildMemberSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isBot: boolean;
  isOnServer: boolean;
}

export async function searchGuildMembers(
  query: string,
  limit = 15,
  guildId = authStore.selectedGuildId
): Promise<GuildMemberSearchResult[]> {
  const params = new URLSearchParams();
  if (query) params.append('q', query);
  params.append('limit', String(limit));
  params.append('botFilter', 'human');
  const res = await dashboardRequest(`/members/search?${params.toString()}`, {
    method: 'GET',
    guildId,
    silent: true,
    errorContext: 'API Error (Search Guild Members):'
  });
  return (res?.members as GuildMemberSearchResult[]) ?? [];
}

export interface PublicDebtor {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  amount: number;
  clanId: string | null;
  clanName: string | null;
  clanColor: string | null;
  since: string;
}

export interface PublicClanDebts {
  total: number;
  debtorCount: number;
  unaffiliated: PublicDebtor[];
  top: PublicDebtor[];
  clans: Array<{
    id: string;
    name: string;
    roleColor: string | null;
    totalDebt: number;
    debtorCount: number;
    debtors: PublicDebtor[];
  }>;
}

export interface PublicBetActor {
  displayName: string;
  avatarUrl: string | null;
}

export interface PublicBetHistoryEntry {
  id: string;
  subject: string;
  stake: number;
  /** Ce que le gagnant empoche en plus de sa mise, jamais le pot. */
  netGain: number;
  creditUsed: number;
  winnerId: string | null;
  winner: PublicBetActor | null;
  winnerClanName: string | null;
  loserId: string;
  loser: PublicBetActor;
  loserClanName: string | null;
  resolvedAt: string;
}

export interface PublicBettorStanding extends PublicBetActor {
  userId: string;
  wins: number;
  losses: number;
  netGain: number;
  bestStreak: number;
  currentStreak: number;
}

export async function fetchPublicClans(guildId: string): Promise<any | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/public/guilds/${guildId}/clans`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.error('API Error (Fetch Public Clans):', err);
    return null;
  }
}

export interface PublicClanSearchResult {
  bets: PublicBetHistoryEntry[];
  bettors: PublicBettorStanding[];
  debts: PublicDebtor[];
  participants: {
    userId: string;
    clanId: string;
    clanName: string | null;
    clanColor: string | null;
    rank: number | null;
    xp: number;
    displayName: string;
    avatarUrl: string | null;
  }[];
  scores: any[];
  matchCounts: Record<string, number>;
}

const EMPTY_CLAN_SEARCH: PublicClanSearchResult = {
  participants: [], scores: [], matchCounts: {}, bets: [], bettors: [], debts: [],
};

export async function searchPublicClans(guildId: string, query: string): Promise<PublicClanSearchResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/public/guilds/${guildId}/clans/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) return EMPTY_CLAN_SEARCH;
    const data = await response.json();
    return {
      participants: data?.participants ?? [],
      scores: data?.scores ?? [],
      matchCounts: data?.matchCounts ?? {},
      bets: data?.bets ?? [],
      bettors: data?.bettors ?? [],
      debts: data?.debts ?? [],
    };
  } catch (err) {
    console.error('API Error (Search Public Clans):', err);
    return EMPTY_CLAN_SEARCH;
  }
}
