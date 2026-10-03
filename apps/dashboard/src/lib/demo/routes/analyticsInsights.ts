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
