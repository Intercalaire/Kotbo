/**
 * Pulse & Prédictions : score de santé du serveur, historique et projections.
 *
 * Formes reprises de `routes/dashboard/pulse.ts` et `predictions.ts` côté bot,
 * réduites aux champs que Pulse.svelte lit.
 */
import { route } from '../backend';

const DAY_MS = 86_400_000;

function dateKey(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

// ── Score quotidien fictif, stable entre les visites ──────────────────────────
const SCORE_HISTORY = [62, 65, 70, 68, 72, 75, 71, 74, 78, 80, 77, 82, 79, 83];

function historySnapshot(daysAgo: number, idx: number) {
  const score = SCORE_HISTORY[idx % SCORE_HISTORY.length];
  return {
    dateKey: dateKey(daysAgo),
    score,
    activityScore: Math.round(score * 0.95),
    moderationScore: Math.round(score * 1.1),
    growthScore: Math.round(score * 0.88),
    engagementScore: Math.round(score * 1.05),
    healthScore: Math.round(score * 0.97),
  };
}

const CURRENT_SCORE = 83;

const PULSE_PAYLOAD = {
  hasData: true,
  current: {
    dateKey: dateKey(1),
    score: CURRENT_SCORE,
    activityScore: 81,
    moderationScore: 90,
    growthScore: 75,
    engagementScore: 87,
    healthScore: 83,
    trend: 'up',
    trendDelta: 4,
    alerts: [
      {
        type: 'slow_growth',
        severity: 'info',
        message: 'La croissance ralentit légèrement ce mois-ci.',
      },
    ],
    partial: false,
  },
  today: {
    dateKey: dateKey(0),
    score: 85,
    activityScore: 84,
    moderationScore: 92,
    growthScore: 77,
    engagementScore: 89,
    healthScore: 85,
    trend: 'up',
    trendDelta: 2,
    alerts: [],
    partial: true,
    metrics: {
      totalMessages: 412,
      totalVoiceMinutes: 680,
      activeMembers: 47,
      totalMembers: 1_247,
      membersJoined: 5,
      membersLeft: 1,
      sanctionsCount: 0,
      ticketsResolved: 3,
      ticketsOpen: 2,
      channelsHealthy: 12,
      channelsUnhealthy: 1,
    },
  },
  history: Array.from({ length: 14 }, (_, i) => historySnapshot(14 - i, i)),
  metrics: {
    totalMessages: 8_940,
    totalVoiceMinutes: 14_280,
    activeMembers: 134,
    totalMembers: 1_247,
    membersJoined: 38,
    membersLeft: 12,
    sanctionsCount: 6,
    ticketsResolved: 21,
    ticketsOpen: 4,
    channelsHealthy: 12,
    channelsUnhealthy: 1,
  },
  bumpStatus: null,
};

// ── Tendances membres / messages / voix ───────────────────────────────────────
const MSG_BASE = [612, 548, 701, 655, 830, 1_190, 1_064];

function trendPoints(days: number, base: number[], predicted = false): unknown[] {
  return Array.from({ length: days }, (_, i) => {
    const isPred = predicted && i >= days - 7;
    const value = Math.round(base[i % base.length] * (isPred ? 1.08 : 1));
    return {
      dateKey: dateKey(days - 1 - i),
      value,
      ...(isPred && { predicted: true, lower: Math.round(value * 0.88), upper: Math.round(value * 1.12) }),
    };
  });
}

function predictionPayload(days: number) {
  const d = Math.min(Math.max(days, 7), 90);
  return {
    hasData: true,
    observedDays: d,
    membersTrend: trendPoints(d, [1_183, 1_185, 1_192, 1_198, 1_205, 1_215, 1_232]),
    messagesTrend: trendPoints(d, MSG_BASE, true),
    voiceTrend: trendPoints(d, MSG_BASE.map((v) => Math.round(v * 1.6)), true),
    growthForecast: {
      predicted7d: 28,
      predicted30d: 95,
      confidence: 0.78,
      dailyNet: 3.2,
    },
    anomalies: [
      {
        type: 'spike',
        metric: 'messages',
        message: 'Pic inhabituel d\'activité il y a 6 jours.',
        severity: 'info',
        dateKey: dateKey(6),
        value: 1_190,
        expectedRange: { min: 550, max: 850 },
        deviation: 1.4,
      },
    ],
    seasonality: {
      busiestDay: 'saturday',
      quietestDay: 'tuesday',
      busiestHour: 21,
      quietestHour: 5,
      weekdayAverages: [520, 480, 490, 560, 630, 1_050, 1_020],
      hourlyAverages: [
        40, 25, 18, 12, 8, 10, 20, 45, 80, 110, 140, 160,
        175, 180, 170, 165, 175, 195, 210, 240, 255, 240, 200, 120,
      ],
      lowConfidence: false,
    },
  };
}

export function registerPulseRoutes(): void {
  // Lecture du score Pulse + métriques
  route('GET', '/api/dashboard/guilds/:guildId/pulse', () => PULSE_PAYLOAD);

  // Recalcul (POST) : renvoie le même payload + champ recomputedDays
  route('POST', '/api/dashboard/guilds/:guildId/pulse/refresh', () => ({
    ...PULSE_PAYLOAD,
    recomputedDays: 7,
  }));

  // Prédictions analytiques
  route('GET', '/api/dashboard/guilds/:guildId/predictions', ({ query }) => {
    const days = parseInt(query.get('days') ?? '30', 10);
    return predictionPayload(days);
  });
}
