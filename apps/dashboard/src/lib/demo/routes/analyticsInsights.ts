/**
 * Analytics avancées de la démo : séries enrichies, pas horaire, classements,
 * ventilation par salon, annotations. Formes reprises de
 * `activityInsightsService` côté bot. Déclarées avant `registerAnalyticsRoutes`
 * : la route /activity enrichie passe devant l'ancienne.
 */
import { route } from '../backend';
import { demoDb, demoId } from '../db';
import { channelMessages, dateKey, memberSeries, memberTotals, serverSeries, voiceChannelMinutes, CHANNEL_SHARE, VOICE_SHARE } from '../activity';
import { CATEGORIES, CHANNELS, MEMBERS, VOICE_CHANNELS, avatarOf, sessionUser } from '../fixtures';
import { CATEGORY_OF } from './analytics';

const DAY_MS = 86_400_000;
const sum = <T>(list: T[], pick: (item: T) => number) => list.reduce((s, item) => s + pick(item), 0);

export function periodOf(query: URLSearchParams): number {
  const start = query.get('startDate');
  const end = query.get('endDate');
  if (start) {
    const days = Math.ceil((new Date(end ?? Date.now()).getTime() - new Date(start).getTime()) / DAY_MS);
    return Math.min(365, Math.max(1, days));
  }
  return Math.min(365, Math.max(1, Number(query.get('period') || query.get('days')) || 30));
}

const range = (days: number) => ({ start: dateKey(days - 1), end: dateKey(0), prevStart: dateKey(days * 2 - 1), prevEnd: dateKey(days), days });

export function bucketize(values: number[], max = 30): number[] {
  if (values.length <= max) return values;
  const size = Math.ceil(values.length / max);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += size) out.push(sum(values.slice(i, i + size), (v) => v));
  return out;
}

// ── Activité enrichie ──────────────────────────────────────────────────

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function anomalies(days: number) {
  const history = serverSeries(days + 28);
  const out: Array<Record<string, unknown>> = [];
  for (const metric of ['messages', 'voiceMinutes'] as const) {
    for (let i = 28; i < history.length; i += 1) {
      const ref = [7, 14, 21, 28].map((lag) => history[i - lag]![metric]);
      const expected = median(ref);
      const value = history[i]![metric];
      if (value >= expected * 1.45 && value - expected > 40) {
        out.push({
          dateKey: history[i]!.dateKey, metric, value, expected: Math.round(expected), direction: 'up',
          driver: metric === 'messages' ? { channelId: CHANNELS[3]!.id, name: 'général', share: 58.4 } : { channelId: VOICE_CHANNELS[0]!.id, name: 'Squad', share: 81.2 },
        });
      }
    }
  }
  return out.slice(-6);
}

function activity(days: number) {
  const current = serverSeries(days);
  const previous = serverSeries(days, days);
  const totals = memberTotals(days);
  const active = totals.filter((t) => t.activeDays > 0).length;
  return {
    range: range(days),
    voiceAvailable: true,
    joinsFiltered: false,
    kpis: {
      messages: { value: sum(current, (d) => d.messages), previous: sum(previous, (d) => d.messages) },
      activeMembers: { value: active, previous: Math.round(active * 0.92) },
      voiceMinutes: { value: sum(current, (d) => d.voiceMinutes), previous: sum(previous, (d) => d.voiceMinutes) },
      netJoins: { value: sum(current, (d) => d.membersJoined - d.membersLeft), previous: sum(previous, (d) => d.membersJoined - d.membersLeft) },
      joined: sum(current, (d) => d.membersJoined),
      left: sum(current, (d) => d.membersLeft),
      memberCount: MEMBERS.length,
    },
    series: current.map((d, i) => {
      const p = previous[i];
      return {
        dateKey: d.dateKey,
        messages: d.messages,
        voiceMinutes: d.voiceMinutes,
        prevMessages: p?.messages ?? 0,
        prevVoiceMinutes: p?.voiceMinutes ?? 0,
        activeMembers: d.activeMembers,
        prevActiveMembers: p?.activeMembers ?? 0,
        joined: d.membersJoined,
        left: d.membersLeft,
        prevJoined: p?.membersJoined ?? 0,
        prevLeft: p?.membersLeft ?? 0,
      };
    }),
    topChannels: channelMessages(days).map((c) => ({ channelId: c.channel.id, name: c.channel.name, messages: c.messages })),
    anomalies: anomalies(days),
  };
}

/** Forme d'une journée : calme la nuit, pic en soirée. */
const HOUR_SHAPE = [2, 1, 1, 0.5, 0.5, 0.5, 1, 2, 3, 4, 4, 5, 6, 5, 5, 5, 6, 7, 8, 9, 10, 9, 6, 4];
const SHAPE_TOTAL = HOUR_SHAPE.reduce((s, v) => s + v, 0);

function hourly(days: number) {
  if (days > 14) return { available: false, timezone: 'Europe/Paris', points: [], prev: [] };
  const nowHour = new Date().getHours();
  const build = (series: ReturnType<typeof serverSeries>, cut: boolean) =>
    series.flatMap((d, di) =>
      HOUR_SHAPE.map((w, h) => ({
        key: `${d.dateKey} ${String(h).padStart(2, '0')}`,
        messages: Math.round((d.messages * w) / SHAPE_TOTAL),
        voiceMinutes: Math.round((d.voiceMinutes * w) / SHAPE_TOTAL),
        activeMembers: Math.round((d.activeMembers * Math.min(1, w / 6)) * 0.6),
      })).filter((_, h) => !cut || di < series.length - 1 || h <= nowHour),
    );
  const points = build(serverSeries(days), true);
  return { available: true, timezone: 'Europe/Paris', points, prev: build(serverSeries(days, days), false).slice(0, points.length) };
}

// ── Classements ────────────────────────────────────────────────────────

function rankings(days: number, metric: 'messages' | 'voice', dimension: 'members' | 'channels', limit: number) {
  if (dimension === 'members') {
    const field = metric === 'messages' ? 'messages' : 'voiceMinutes';
    const now = memberTotals(days).filter((t) => t[field] > 0).sort((a, b) => b[field] - a[field]);
    const before = new Map(memberTotals(days * 2).map((t) => [t.person.id, t[field]]));
    const total = sum(now, (t) => t[field]);
    const items = now.slice(0, limit).map((t) => ({
      id: t.person.id,
      name: t.person.displayName,
      avatarUrl: avatarOf(t.person),
      value: t[field],
      previous: Math.max(0, (before.get(t.person.id) ?? 0) - t[field]),
      share: total > 0 ? Math.round((t[field] / total) * 1000) / 10 : 0,
      spark: bucketize(memberSeries(t.person, days).map((d) => d[field])),
    }));
    return { available: true, metric, dimension, total, prevTotal: Math.round(total * 0.93), items };
  }
  const rows = metric === 'messages'
    ? channelMessages(days).map((c) => ({ channel: c.channel, value: c.messages, share: CHANNEL_SHARE[c.channel.name] ?? 0 }))
    : voiceChannelMinutes(days).map((c) => ({ channel: c.channel, value: c.minutes, share: VOICE_SHARE[c.channel.name] ?? 0 }));
  const before = metric === 'messages' ? channelMessages(days * 2) : [];
  const total = sum(rows, (r) => r.value);
  const daily = serverSeries(days).map((d) => (metric === 'messages' ? d.messages : d.voiceMinutes));
  const items = rows.filter((r) => r.value > 0).slice(0, limit).map((r) => {
    const prevTotal = metric === 'messages' ? (before.find((b) => b.channel.id === r.channel.id)?.messages ?? 0) - r.value : Math.round(r.value * 0.9);
    return {
      id: r.channel.id,
      name: r.channel.name,
      avatarUrl: null,
      value: r.value,
      previous: Math.max(0, prevTotal),
      share: total > 0 ? Math.round((r.value / total) * 1000) / 10 : 0,
      spark: bucketize(daily.map((v) => Math.round(v * r.share))),
    };
  });
  return { available: true, metric, dimension, total, prevTotal: Math.round(total * 0.93), items };
}

function breakdown(days: number, metric: 'messages' | 'voice', dimension: 'channel' | 'category') {
  const series = serverSeries(days);
  const shares = metric === 'messages' ? CHANNEL_SHARE : VOICE_SHARE;
  const channels = metric === 'messages' ? CHANNELS : VOICE_CHANNELS;
  const daily = series.map((d) => (metric === 'messages' ? d.messages : d.voiceMinutes));
  const groups = new Map<string, { id: string; name: string; values: number[] }>();
  for (const c of channels) {
    const share = shares[c.name] ?? 0;
    if (share <= 0) continue;
    const key = dimension === 'channel' ? c.id : (CATEGORY_OF[c.name] ?? 'none');
    const cat = CATEGORIES.find((x) => x.name === key);
    const group = groups.get(key) ?? { id: dimension === 'channel' ? c.id : (cat?.id ?? key), name: dimension === 'channel' ? c.name : key, values: daily.map(() => 0) };
    daily.forEach((v, i) => { group.values[i] = (group.values[i] ?? 0) + Math.round(v * share); });
    groups.set(key, group);
  }
  const ordered = [...groups.values()].map((g) => ({ ...g, total: sum(g.values, (v) => v) })).sort((a, b) => b.total - a.total);
  const other = daily.map(() => 0);
  for (const g of ordered.slice(5)) g.values.forEach((v, i) => { other[i] = (other[i] ?? 0) + v; });
  return { available: true, dates: series.map((d) => d.dateKey), groups: ordered.slice(0, 5), other };
}


// ── Membres et rétention ───────────────────────────────────────────────

function engagement(days: number) {
  const step = days > 92 ? 7 : 1;
  const point = (daysAgo: number) => {
    const d = serverSeries(1, daysAgo)[0]!;
    const week = sum(serverSeries(7, daysAgo), (x) => x.activeMembers);
    const month = sum(serverSeries(30, daysAgo), (x) => x.activeMembers);
    return { dau: d.activeMembers, wau: Math.round(week * 0.42), mau: Math.round(month * 0.16) };
  };
  const points = [];
  for (let i = days - 1; i >= 0; i -= step) {
    const now = point(i);
    const prev = point(i + days);
    points.push({ dateKey: dateKey(i), ...now, prevDau: prev.dau, prevWau: prev.wau, prevMau: prev.mau });
  }
  return { range: range(days), step, channelIgnored: false, points };
}

function cohorts() {
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return {
    weeks: 12,
    channelIgnored: false,
    cohorts: Array.from({ length: 12 }, (_, wi) => {
      const week = new Date(monday.getTime() - (11 - wi) * 7 * DAY_MS).toISOString().slice(0, 10);
      const size = 14 + ((wi * 7) % 11);
      return {
        week,
        size,
        retention: Array.from({ length: 12 }, (_, offset) =>
          offset >= 12 - wi ? null : Math.round((offset === 0 ? 78 : 52 * Math.pow(0.86, offset) + (wi % 3) * 2) * 10) / 10),
      };
    }),
  };
}

function funnelSteps(joined: number, quality: number) {
  return {
    joined,
    stayed: Math.round(joined * (0.7 + quality * 0.2)),
    firstMessage: Math.round(joined * (0.45 + quality * 0.3)),
    eligible7: Math.round(joined * 0.8),
    active7: Math.round(joined * 0.8 * (0.25 + quality * 0.3)),
    eligible30: Math.round(joined * 0.5),
    active30: Math.round(joined * 0.5 * (0.12 + quality * 0.25)),
    medianDaysToFirstMessage: quality > 0.5 ? 0 : 2,
  };
}

function funnel(days: number) {
  const joined = sum(serverSeries(days), (d) => d.membersJoined);
  const parts = [
    { key: 'code:nova', label: 'nova (Arka)', kind: 'code', share: 0.42, quality: 0.7 },
    { key: 'label:TikTok', label: 'TikTok', kind: 'label', share: 0.24, quality: 0.25 },
    { key: 'code:lina-et-cie', label: 'lina-et-cie (Lina)', kind: 'code', share: 0.14, quality: 0.8 },
    { key: 'label:Partenaires', label: 'Partenaires', kind: 'label', share: 0.1, quality: 0.55 },
    { key: 'unknown', label: null, kind: 'unknown', share: 0.1, quality: 0.3 },
  ];
  return {
    range: range(days),
    channelIgnored: false,
    overall: funnelSteps(joined, 0.55),
    bySource: parts.map((p) => ({ key: p.key, label: p.label, kind: p.kind, ...funnelSteps(Math.max(1, Math.round(joined * p.share)), p.quality) })),
  };
}

function lifecycle(days: number) {
  const humans = MEMBERS.filter((p) => !p.bot);
  const totals = memberTotals(28);
  const segOf = (activeDays: number, i: number) =>
    i % 17 === 0 ? 'new' : i % 13 === 0 ? 'reactivated' : i % 11 === 0 ? 'declining' : activeDays >= 8 ? 'regular' : activeDays >= 1 ? 'casual' : i % 2 ? 'dormant' : 'silent';
  const counts: Record<string, number> = { new: 0, regular: 0, casual: 0, reactivated: 0, declining: 0, dormant: 0, silent: 0 };
  const lists: Record<string, Array<Record<string, unknown>>> = { new: [], reactivated: [], declining: [], dormant: [] };
  humans.forEach((person, i) => {
    const t = totals.find((x) => x.person.id === person.id);
    const seg = segOf(t?.activeDays ?? 0, i);
    counts[seg]! += 1;
    lists[seg]?.push({
      userId: person.id, name: person.displayName, avatarUrl: avatarOf(person),
      lastActive: dateKey(seg === 'dormant' ? 35 + (i % 40) : i % 5),
      recentDays: seg === 'dormant' ? 0 : (t?.activeDays ?? 1),
      previousDays: seg === 'declining' ? 14 + (i % 6) : seg === 'dormant' ? 6 + (i % 9) : 3,
      joinedAt: new Date(Date.now() - (seg === 'new' ? i % 13 : 120 + i) * DAY_MS).toISOString(),
    });
  });
  const prevCounts = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.max(0, v + (k === 'declining' ? -3 : k === 'regular' ? 2 : k === 'new' ? -1 : 0))]));
  return {
    asOf: dateKey(0),
    prevAsOf: dateKey(days),
    channelIgnored: false,
    counts,
    prevCounts,
    transitions: [
      { from: 'regular', to: 'declining', count: 4 },
      { from: 'casual', to: 'regular', count: 3 },
      { from: 'new', to: 'casual', count: 3 },
      { from: 'dormant', to: 'reactivated', count: 2 },
      { from: 'casual', to: 'dormant', count: 2 },
    ],
    lists,
  };
}

// ── Annotations ────────────────────────────────────────────────────────

const ANNOTATIONS = 'analytics-annotations';
const annotationsSeed = () => [
  { id: '9100000000000000001', dateKey: dateKey(9), label: 'Tournoi inter-serveurs', authorId: MEMBERS[1]!.id, authorName: MEMBERS[1]!.displayName, createdAt: new Date(Date.now() - 9 * DAY_MS).toISOString() },
  { id: '9100000000000000002', dateKey: dateKey(21), label: 'Partenariat avec un serveur voisin', authorId: MEMBERS[2]!.id, authorName: MEMBERS[2]!.displayName, createdAt: new Date(Date.now() - 21 * DAY_MS).toISOString() },
];

export function registerAnalyticsInsightsRoutes(): void {
  const base = '/api/dashboard/guilds/:guildId/analytics';
  const metricOf = (q: URLSearchParams) => (q.get('metric') === 'voice' ? 'voice' : 'messages');
  route('GET', `${base}/activity`, ({ query }) => activity(periodOf(query)));
  route('GET', `${base}/activity/hourly`, ({ query }) => hourly(periodOf(query)));
  route('GET', `${base}/activity/rankings`, ({ query }) =>
    rankings(periodOf(query), metricOf(query), query.get('dimension') === 'channels' ? 'channels' : 'members', Math.min(500, Number(query.get('limit')) || 10)));
  route('GET', `${base}/activity/breakdown`, ({ query }) =>
    breakdown(periodOf(query), metricOf(query), query.get('dimension') === 'category' ? 'category' : 'channel'));
  route('GET', `${base}/audience/engagement`, ({ query }) => engagement(periodOf(query)));
  route('GET', `${base}/audience/cohorts`, () => cohorts());
  route('GET', `${base}/audience/funnel`, ({ query }) => funnel(periodOf(query)));
  route('GET', `${base}/audience/lifecycle`, ({ query }) => lifecycle(periodOf(query)));
  route('GET', `${base}/annotations`, ({ query }) => {
    const start = range(periodOf(query)).start;
    return demoDb.get(ANNOTATIONS, annotationsSeed).filter((a) => a.dateKey >= start);
  });
  route('POST', `${base}/annotations`, ({ body }) => {
    const me = sessionUser();
    const id = demoId();
    demoDb.update(ANNOTATIONS, annotationsSeed, (list) => [
      ...list,
      { id, dateKey: String(body?.dateKey ?? dateKey(0)), label: String(body?.label ?? '').slice(0, 80), authorId: me.id, authorName: me.username, createdAt: new Date().toISOString() },
    ]);
    return { id };
  });
  route('DELETE', `${base}/annotations/:id`, ({ params }) => {
    demoDb.update(ANNOTATIONS, annotationsSeed, (list) => list.filter((a) => a.id !== params.id));
    return { ok: true };
  });
}
