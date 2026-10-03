/**
 * conversationInsightsService.ts
 *
 * Salons et conversation d'Analytics :
 *   - temps de réponse : délai médian avant qu'un autre membre réponde, part
 *     des prises de parole restées sans réponse, par salon et jour par jour ;
 *   - concentration : part de l'activité faite par les 1 % / 10 % les plus
 *     actifs, indice de Gini, courbe de Lorenz ;
 *   - santé des salons : morts, en déclin, saturés, avec un score et une
 *     suggestion (archiver, relancer, découper) ;
 *   - réseau : groupes de membres qui se parlent, membres « ponts » entre
 *     groupes, paires les plus liées, membres actifs que personne ne relance.
 */

import { Prisma } from '@prisma/client';
import { ChannelType, type Client, type Guild } from 'discord.js';
import { prismaRead } from '../../utils/db.js';
import { addDays, dayKeys, hasUserScope, scopeSql, type AnalyticsScope, type DateRange } from './contentAnalyticsService.js';

const DAY_MS = 24 * 3600 * 1000;

function channelParent(guild: Guild | null, id: string): string {
  const channel = guild?.channels.cache.get(id);
  return channel?.isThread() && channel.parentId ? channel.parentId : id;
}

// ── Temps de réponse ───────────────────────────────────────────────────────

export interface ResponseCounts {
  answered: number;
  unanswered: number;
  delaySumSec: number;
  under1m: number;
  under5m: number;
  under15m: number;
  under1h: number;
  under6h: number;
}

const BUCKETS: Array<{ key: keyof ResponseCounts; from: number; to: number }> = [
  { key: 'under1m', from: 0, to: 60 },
  { key: 'under5m', from: 60, to: 300 },
  { key: 'under15m', from: 300, to: 900 },
  { key: 'under1h', from: 900, to: 3600 },
  { key: 'under6h', from: 3600, to: 21600 },
];

const empty = (): ResponseCounts => ({ answered: 0, unanswered: 0, delaySumSec: 0, under1m: 0, under5m: 0, under15m: 0, under1h: 0, under6h: 0 });

function addCounts(a: ResponseCounts, b: ResponseCounts): ResponseCounts {
  const out = { ...a };
  for (const k of Object.keys(out) as Array<keyof ResponseCounts>) out[k] += b[k];
  return out;
}

/** Médiane estimée en secondes, par interpolation dans la tranche qui la contient. */
export function medianFromBuckets(c: ResponseCounts): number | null {
  const total = BUCKETS.reduce((s, b) => s + c[b.key], 0);
  if (total === 0) return null;
  const half = total / 2;
  let seen = 0;
  for (const b of BUCKETS) {
    const n = c[b.key];
    if (seen + n >= half && n > 0) return Math.round(b.from + ((half - seen) / n) * (b.to - b.from));
    seen += n;
  }
  return BUCKETS[BUCKETS.length - 1]!.to;
}

function summary(c: ResponseCounts) {
  const turns = c.answered + c.unanswered;
  return {
    turns,
    answered: c.answered,
    unanswered: c.unanswered,
    unansweredRate: turns > 0 ? Math.round((c.unanswered / turns) * 1000) / 10 : null,
    medianSec: medianFromBuckets(c),
    avgSec: c.answered > 0 ? Math.round(c.delaySumSec / c.answered) : null,
    buckets: BUCKETS.map((b) => ({ key: b.key, count: c[b.key] })),
  };
}

const RESPONSE_SUM = Prisma.sql`
  SUM("answered")::int AS "answered", SUM("unanswered")::int AS "unanswered", SUM("delaySumSec")::int AS "delaySumSec",
  SUM("under1m")::int AS "under1m", SUM("under5m")::int AS "under5m", SUM("under15m")::int AS "under15m",
  SUM("under1h")::int AS "under1h", SUM("under6h")::int AS "under6h"`;

export async function getResponseTimes(client: Client, guildId: string, range: DateRange, scope: AnalyticsScope) {
  const guild = client.guilds.cache.get(guildId) ?? null;
  const channels = scopeSql(scope, { users: false });
  const [byChannel, byDay, prevRows] = await Promise.all([
    prismaRead.$queryRaw<Array<ResponseCounts & { channelId: string }>>`
      SELECT "channelId", ${RESPONSE_SUM} FROM "channel_response_daily_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.start} AND "dateKey" <= ${range.end}${channels}
      GROUP BY "channelId"
    `,
    prismaRead.$queryRaw<Array<ResponseCounts & { dateKey: string }>>`
      SELECT "dateKey", ${RESPONSE_SUM} FROM "channel_response_daily_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.start} AND "dateKey" <= ${range.end}${channels}
      GROUP BY "dateKey"
    `,
    prismaRead.$queryRaw<ResponseCounts[]>`
      SELECT ${RESPONSE_SUM} FROM "channel_response_daily_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.prevStart} AND "dateKey" <= ${range.prevEnd}${channels}
    `,
  ]);

  const folded = new Map<string, ResponseCounts>();
  let total = empty();
  for (const row of byChannel) {
    const id = channelParent(guild, row.channelId);
    const counts = { ...empty(), ...Object.fromEntries(Object.keys(empty()).map((k) => [k, Number(row[k as keyof ResponseCounts] ?? 0)])) } as ResponseCounts;
    folded.set(id, addCounts(folded.get(id) ?? empty(), counts));
    total = addCounts(total, counts);
  }
  const dayMap = new Map(byDay.map((r) => [r.dateKey, r]));
  const prev = prevRows[0] ? ({ ...empty(), ...prevRows[0] } as ResponseCounts) : empty();
  for (const k of Object.keys(prev) as Array<keyof ResponseCounts>) prev[k] = Number(prev[k] ?? 0);

  return {
    range,
    userIgnored: hasUserScope(scope),
    total: summary(total),
    previous: summary(prev),
    daily: dayKeys(range.start, range.end).map((dateKey) => {
      const r = dayMap.get(dateKey);
      const counts = r ? ({ ...empty(), ...r } as ResponseCounts) : empty();
      const s = summary(counts);
      return { dateKey, medianSec: s.medianSec, unansweredRate: s.unansweredRate, turns: s.turns };
    }),
    channels: [...folded.entries()]
      .map(([channelId, counts]) => ({ channelId, name: guild?.channels.cache.get(channelId)?.name ?? null, ...summary(counts) }))
      .filter((c) => c.turns > 0)
      .sort((a, b) => b.turns - a.turns)
      .slice(0, 50),
  };
}

// ── Concentration ──────────────────────────────────────────────────────────

/** Indice de Gini d'une liste de valeurs positives (0 = tout le monde pareil, 1 = un seul fait tout). */
export function gini(values: number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  if (n < 2 || sum === 0) return 0;
  let weighted = 0;
  sorted.forEach((v, i) => { weighted += (i + 1) * v; });
  return Math.round(((2 * weighted) / (n * sum) - (n + 1) / n) * 1000) / 1000;
}

export function concentrationOf(values: number[]) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => b - a);
  const total = sorted.reduce((s, v) => s + v, 0);
  const n = sorted.length;
  const shareOfTop = (k: number) => (total > 0 ? Math.round((sorted.slice(0, k).reduce((s, v) => s + v, 0) / total) * 1000) / 10 : 0);
  let acc = 0;
  let half = 0;
  for (const v of sorted) {
    acc += v;
    half += 1;
    if (acc >= total / 2) break;
  }
  // Lorenz : part cumulée de l'activité selon la part cumulée des membres, des moins actifs aux plus actifs.
  const asc = [...sorted].reverse();
  const lorenz: Array<{ members: number; activity: number }> = [{ members: 0, activity: 0 }];
  let cum = 0;
  for (let step = 1; step <= 20; step += 1) {
    const upto = Math.round((n * step) / 20);
    cum = asc.slice(0, upto).reduce((s, v) => s + v, 0);
    lorenz.push({ members: step * 5, activity: total > 0 ? Math.round((cum / total) * 1000) / 10 : 0 });
  }
  return {
    members: n,
    total,
    top1Share: shareOfTop(Math.max(1, Math.ceil(n * 0.01))),
    top10Share: shareOfTop(Math.max(1, Math.ceil(n * 0.1))),
    top10MembersShare: shareOfTop(10),
    membersForHalf: total > 0 ? half : 0,
    gini: gini(sorted),
    lorenz,
  };
}

export async function getConcentration(guildId: string, range: DateRange, scope: AnalyticsScope, metric: 'messages' | 'voice') {
  const read = (start: string, end: string) => {
    if (scope.channelIds) {
      if (metric === 'voice') return Promise.resolve(null);
      return prismaRead.$queryRaw<Array<{ v: number }>>`
        SELECT SUM("messages")::int AS v FROM "message_content_daily_stats"
        WHERE "guildId" = ${guildId} AND "dateKey" >= ${start} AND "dateKey" <= ${end}${scopeSql(scope)}
        GROUP BY "userId"
      `;
    }
    const column = Prisma.raw(metric === 'messages' ? '"messagesCount"' : '"voiceMinutes"');
    return prismaRead.$queryRaw<Array<{ v: number }>>`
      SELECT SUM(${column})::int AS v FROM "member_daily_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${start} AND "dateKey" <= ${end}${scopeSql(scope, { channels: false })}
      GROUP BY "userId"
    `;
  };
  const [now, prev] = await Promise.all([read(range.start, range.end), read(range.prevStart, range.prevEnd)]);
  if (!now || !prev) return { available: false as const, metric };
  return {
    available: true as const,
    metric,
    current: concentrationOf(now.map((r) => r.v)),
    previous: concentrationOf(prev.map((r) => r.v)),
  };
}

// ── Santé des salons ───────────────────────────────────────────────────────

export type ChannelStatus = 'dead' | 'declining' | 'saturated' | 'quiet' | 'healthy' | 'growing';

export interface ChannelHealthInput {
  messages: number;
  prevMessages: number;
  authors: number;
  days: number;
  lastActiveDaysAgo: number | null;
  medianResponseSec: number | null;
  unansweredRate: number | null;
}

/**
 * Statut et score (0-100) d'un salon texte, avec la suggestion qui va avec.
 * Le score mélange volume par jour, diversité des auteurs, réactivité et
 * tendance ; il sert à trier, le statut sert à agir.
 */
export function channelHealth(input: ChannelHealthInput): { status: ChannelStatus; score: number; suggestion: 'archive' | 'revive' | 'split' | 'merge' | null } {
  const perDay = input.messages / Math.max(1, input.days);
  const trend = input.prevMessages > 0 ? (input.messages - input.prevMessages) / input.prevMessages : input.messages > 0 ? 1 : 0;
  let status: ChannelStatus;
  let suggestion: 'archive' | 'revive' | 'split' | 'merge' | null = null;
  if (input.messages === 0 && (input.lastActiveDaysAgo === null || input.lastActiveDaysAgo > 30)) {
    status = 'dead';
    suggestion = 'archive';
  } else if (input.prevMessages >= 30 && trend <= -0.4) {
    status = 'declining';
    suggestion = 'revive';
  } else if (perDay >= 300 && input.authors >= 25) {
    status = 'saturated';
    suggestion = 'split';
  } else if (perDay < 2) {
    status = 'quiet';
    suggestion = input.messages < 10 ? 'merge' : null;
  } else if (trend >= 0.3) {
    status = 'growing';
  } else {
    status = 'healthy';
  }

  const volume = Math.min(1, Math.log10(1 + perDay) / 2); // 100 msg/jour = plein
  const diversity = Math.min(1, input.authors / 20);
  const reactivity = input.medianResponseSec === null ? 0.5 : Math.max(0, 1 - input.medianResponseSec / 3600);
  const answered = input.unansweredRate === null ? 0.5 : 1 - input.unansweredRate / 100;
  const momentum = Math.max(0, Math.min(1, 0.5 + trend / 2));
  const score = Math.round((volume * 0.3 + diversity * 0.25 + reactivity * 0.15 + answered * 0.15 + momentum * 0.15) * 100);
  return { status, score: status === 'dead' ? 0 : score, suggestion };
}

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia]);

export async function getChannelHealthReport(client: Client, guildId: string, range: DateRange) {
  const guild = client.guilds.cache.get(guildId) ?? null;
  if (!guild) return { range, channels: [] };
  const [stats, prevStats, authors, last, responses] = await Promise.all([
    prismaRead.$queryRaw<Array<{ channelId: string; v: number }>>`
      SELECT "channelId", SUM("messagesCount")::int AS v FROM "channel_daily_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.start} AND "dateKey" <= ${range.end} GROUP BY "channelId"
    `,
    prismaRead.$queryRaw<Array<{ channelId: string; v: number }>>`
      SELECT "channelId", SUM("messagesCount")::int AS v FROM "channel_daily_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.prevStart} AND "dateKey" <= ${range.prevEnd} GROUP BY "channelId"
    `,
    prismaRead.$queryRaw<Array<{ channelId: string; n: number }>>`
      SELECT "channelId", COUNT(DISTINCT "userId")::int AS n FROM "message_content_daily_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.start} AND "dateKey" <= ${range.end} AND "messages" > 0 GROUP BY "channelId"
    `,
    prismaRead.$queryRaw<Array<{ channelId: string; last: string }>>`
      SELECT "channelId", MAX("dateKey") AS last FROM "channel_daily_stats"
      WHERE "guildId" = ${guildId} AND "messagesCount" > 0 AND "dateKey" >= ${addDays(range.end, -365)} GROUP BY "channelId"
    `,
    prismaRead.$queryRaw<Array<ResponseCounts & { channelId: string }>>`
      SELECT "channelId", ${RESPONSE_SUM} FROM "channel_response_daily_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.start} AND "dateKey" <= ${range.end} GROUP BY "channelId"
    `,
  ]);

  const fold = <T>(rows: Array<{ channelId: string } & T>, merge: (a: T | undefined, b: T) => T) => {
    const out = new Map<string, T>();
    for (const r of rows) {
      const id = channelParent(guild, r.channelId);
      out.set(id, merge(out.get(id), r));
    }
    return out;
  };
  const msgs = fold<{ v: number }>(stats, (a, b) => ({ v: (a?.v ?? 0) + b.v }));
  const prevMsgs = fold<{ v: number }>(prevStats, (a, b) => ({ v: (a?.v ?? 0) + b.v }));
  const authorMap = fold<{ n: number }>(authors, (a, b) => ({ n: Math.max(a?.n ?? 0, b.n) }));
  const lastMap = fold<{ last: string }>(last, (a, b) => ({ last: !a || b.last > a.last ? b.last : a.last }));
  const respMap = fold<ResponseCounts>(responses as Array<ResponseCounts & { channelId: string }>, (a, b) => addCounts(a ?? empty(), { ...empty(), ...b }));
  const endMs = Date.parse(`${range.end}T00:00:00Z`);

  const channels = [...guild.channels.cache.values()]
    .filter((c) => TEXT_TYPES.has(c.type))
    .map((c) => {
      const lastKey = lastMap.get(c.id)?.last ?? null;
      const resp = respMap.get(c.id);
      const s = resp ? summary(resp) : null;
      const input: ChannelHealthInput = {
        messages: msgs.get(c.id)?.v ?? 0,
        prevMessages: prevMsgs.get(c.id)?.v ?? 0,
        authors: authorMap.get(c.id)?.n ?? 0,
        days: range.days,
        lastActiveDaysAgo: lastKey ? Math.round((endMs - Date.parse(`${lastKey}T00:00:00Z`)) / DAY_MS) : null,
        medianResponseSec: s?.medianSec ?? null,
        unansweredRate: s?.unansweredRate ?? null,
      };
      return {
        channelId: c.id,
        name: c.name,
        categoryId: 'parentId' in c ? (c.parentId ?? null) : null,
        categoryName: 'parent' in c ? (c.parent?.name ?? null) : null,
        ...input,
        lastActiveDate: lastKey,
        ...channelHealth(input),
      };
    })
    .sort((a, b) => a.score - b.score);
  return { range, channels };
}

// ── Réseau de conversation ─────────────────────────────────────────────────

export interface Edge { a: string; b: string; weight: number; replies: number; mentions: number; ab: number; ba: number }

/** Propagation d'étiquettes pondérée : chaque membre adopte le groupe le plus lié à lui. */
export function communities(nodes: string[], edges: Edge[], iterations = 20): Map<string, string> {
  const neighbors = new Map<string, Array<{ id: string; w: number }>>();
  for (const e of edges) {
    (neighbors.get(e.a) ?? neighbors.set(e.a, []).get(e.a)!).push({ id: e.b, w: e.weight });
    (neighbors.get(e.b) ?? neighbors.set(e.b, []).get(e.b)!).push({ id: e.a, w: e.weight });
  }
  const label = new Map(nodes.map((n) => [n, n]));
  // Ordre fixe (degré décroissant puis id) : le résultat ne dépend pas du hasard.
  const order = [...nodes].sort((x, y) => (neighbors.get(y)?.length ?? 0) - (neighbors.get(x)?.length ?? 0) || x.localeCompare(y));
  for (let it = 0; it < iterations; it += 1) {
    let changed = false;
    for (const n of order) {
      const scores = new Map<string, number>();
      for (const nb of neighbors.get(n) ?? []) {
        const l = label.get(nb.id)!;
        scores.set(l, (scores.get(l) ?? 0) + nb.w);
      }
      let best = label.get(n)!;
      let bestScore = -1;
      for (const [l, s] of scores) {
        if (s > bestScore || (s === bestScore && l < best)) {
          best = l;
          bestScore = s;
        }
      }
      if (best !== label.get(n)) {
        label.set(n, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return label;
}

export async function getConversationNetwork(client: Client, guildId: string, range: DateRange, scope: AnalyticsScope) {
  const guild = client.guilds.cache.get(guildId) ?? null;
  const [rows, active] = await Promise.all([
    prismaRead.$queryRaw<Array<{ userId: string; targetUserId: string; replies: number; mentions: number }>>`
      SELECT "userId", "targetUserId", SUM("replies")::int AS replies, SUM("mentions")::int AS mentions
      FROM "member_interaction_daily_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.start} AND "dateKey" <= ${range.end}
      GROUP BY "userId", "targetUserId"
    `,
    prismaRead.$queryRaw<Array<{ userId: string; messages: number }>>`
      SELECT "userId", SUM("messagesCount")::int AS messages FROM "member_daily_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.start} AND "dateKey" <= ${range.end}
        AND "messagesCount" > 0${scopeSql(scope, { channels: false })}
      GROUP BY "userId" ORDER BY messages DESC LIMIT 2000
    `,
  ]);

  const allowed = (id: string) => (!scope.userIds || scope.userIds.includes(id)) && !scope.excludeUserIds.includes(id);
  const edgeMap = new Map<string, Edge>();
  for (const r of rows) {
    if (!allowed(r.userId) || !allowed(r.targetUserId)) continue;
    const [a, b] = r.userId < r.targetUserId ? [r.userId, r.targetUserId] : [r.targetUserId, r.userId];
    const key = `${a}|${b}`;
    const e = edgeMap.get(key) ?? { a, b, weight: 0, replies: 0, mentions: 0, ab: 0, ba: 0 };
    const w = r.replies * 2 + r.mentions; // une réponse pèse plus qu'une mention
    e.weight += w;
    e.replies += r.replies;
    e.mentions += r.mentions;
    if (r.userId === a) e.ab += w; else e.ba += w;
    edgeMap.set(key, e);
  }
  const edges = [...edgeMap.values()];
  const nodes = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
  const label = communities(nodes, edges);

  const groups = new Map<string, string[]>();
  for (const [n, l] of label) (groups.get(l) ?? groups.set(l, []).get(l)!).push(n);
  const strength = new Map<string, number>();
  for (const e of edges) {
    strength.set(e.a, (strength.get(e.a) ?? 0) + e.weight);
    strength.set(e.b, (strength.get(e.b) ?? 0) + e.weight);
  }

  const name = (id: string) => guild?.members.cache.get(id)?.displayName ?? null;
  const avatar = (id: string) => guild?.members.cache.get(id)?.displayAvatarURL({ size: 64 }) ?? null;
  const missing = [...new Set([...nodes, ...active.map((a) => a.userId)])].filter((id) => !guild?.members.cache.has(id));
  const profiles = missing.length > 0
    ? await prismaRead.memberProfile.findMany({
        where: { guildId, userId: { in: missing.slice(0, 3000) } },
        select: { userId: true, displayName: true, globalName: true, username: true, avatarUrl: true, isBot: true },
      })
    : [];
  const profileOf = new Map(profiles.map((p) => [p.userId, p]));
  const who = (id: string) => ({
    userId: id,
    name: name(id) ?? profileOf.get(id)?.displayName ?? profileOf.get(id)?.globalName ?? profileOf.get(id)?.username ?? null,
    avatarUrl: avatar(id) ?? profileOf.get(id)?.avatarUrl ?? null,
  });

  const groupList = [...groups.entries()]
    .filter(([, members]) => members.length >= 3)
    .map(([id, members]) => {
      const sorted = members.sort((x, y) => (strength.get(y) ?? 0) - (strength.get(x) ?? 0));
      const set = new Set(members);
      const internal = edges.filter((e) => set.has(e.a) && set.has(e.b)).reduce((s, e) => s + e.weight, 0);
      return { id, size: members.length, internalWeight: internal, leaders: sorted.slice(0, 5).map(who) };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, 12);

  // Ponts : membres liés à plusieurs groupes, classés par poids vers les autres groupes.
  const bridges = nodes
    .map((n) => {
      const own = label.get(n);
      const touched = new Set<string>();
      let outside = 0;
      for (const e of edges) {
        if (e.a !== n && e.b !== n) continue;
        const other = e.a === n ? e.b : e.a;
        const l = label.get(other)!;
        if (l !== own && (groups.get(l)?.length ?? 0) >= 3) {
          touched.add(l);
          outside += e.weight;
        }
      }
      return { ...who(n), groups: touched.size + 1, outsideWeight: outside };
    })
    .filter((b) => b.groups >= 3 || (b.groups >= 2 && b.outsideWeight >= 5))
    .sort((a, b) => b.groups - a.groups || b.outsideWeight - a.outsideWeight)
    .slice(0, 15);

  const linked = new Set(nodes);
  const isolatedAll = active.filter((a) => !linked.has(a.userId) && !profileOf.get(a.userId)?.isBot);
  const isolated = isolatedAll.slice(0, 30).map((a) => ({ ...who(a.userId), messages: a.messages }));

  const reciprocal = edges.filter((e) => e.ab > 0 && e.ba > 0).length;

  return {
    range,
    channelIgnored: scope.channelIds !== null,
    totals: {
      members: nodes.length,
      links: edges.length,
      replies: edges.reduce((s, e) => s + e.replies, 0),
      mentions: edges.reduce((s, e) => s + e.mentions, 0),
      reciprocity: edges.length > 0 ? Math.round((reciprocal / edges.length) * 1000) / 10 : null,
      activeMembers: active.length,
      isolatedCount: isolatedAll.length,
    },
    groups: groupList,
    bridges,
    pairs: edges
      .sort((x, y) => y.weight - x.weight)
      .slice(0, 15)
      .map((e) => ({ a: who(e.a), b: who(e.b), replies: e.replies, mentions: e.mentions, reciprocal: e.ab > 0 && e.ba > 0 })),
    isolated,
  };
}
