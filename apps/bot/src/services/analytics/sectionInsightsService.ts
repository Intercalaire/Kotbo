/**
 * sectionInsightsService.ts
 *
 * Analyses poussées des sections Croissance, Modération, Staff et Contenu :
 *   - croissance : arrivées par source jour par jour, départs selon
 *     l'ancienneté, part des arrivés repartis en moins de 24 h ;
 *   - modération : sanctions par type dans le temps, par modérateur, récidive,
 *     délai entre l'incident rapporté et la sanction ;
 *   - staff : délai de première réponse et de résolution des tickets, charge
 *     par membre du staff, heures où les tickets attendent le plus ;
 *   - contenu : mots qui montent ou baissent par rapport à la période d'avant.
 */

import { SanctionType } from '@prisma/client';
import type { Client } from 'discord.js';
import { prismaRead } from '../../utils/db.js';
import { dayKeys, type DateRange } from './contentAnalyticsService.js';
import { BucketZoner } from './zonedBuckets.js';

const DAY_MS = 24 * 3600 * 1000;
const rangeDates = (range: DateRange) => ({
  gte: new Date(`${range.start}T00:00:00Z`),
  lte: new Date(`${range.end}T23:59:59.999Z`),
});
const prevDates = (range: DateRange) => ({
  gte: new Date(`${range.prevStart}T00:00:00Z`),
  lte: new Date(`${range.prevEnd}T23:59:59.999Z`),
});

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// ── Croissance ─────────────────────────────────────────────────────────────

export const TENURE_BUCKETS = [
  { key: 'under1d', maxDays: 1 },
  { key: 'under7d', maxDays: 7 },
  { key: 'under30d', maxDays: 30 },
  { key: 'under180d', maxDays: 180 },
  { key: 'over180d', maxDays: Number.POSITIVE_INFINITY },
] as const;

export function tenureBucket(days: number): (typeof TENURE_BUCKETS)[number]['key'] {
  return TENURE_BUCKETS.find((b) => days < b.maxDays)?.key ?? 'over180d';
}

export async function getGrowthInsights(client: Client, guildId: string, range: DateRange) {
  const guild = client.guilds.cache.get(guildId) ?? null;
  const [leavers, joiners, prevJoiners, invites, guildInvites] = await Promise.all([
    prismaRead.memberProfile.findMany({
      where: { guildId, isBot: false, guildLeftAt: rangeDates(range) },
      select: { guildJoinedAt: true, guildLeftAt: true },
      take: 50_000,
    }),
    prismaRead.memberProfile.findMany({
      where: { guildId, isBot: false, guildJoinedAt: rangeDates(range) },
      select: { guildJoinedAt: true, guildLeftAt: true },
      take: 50_000,
    }),
    prismaRead.memberProfile.findMany({
      where: { guildId, isBot: false, guildJoinedAt: prevDates(range) },
      select: { guildJoinedAt: true, guildLeftAt: true },
      take: 50_000,
    }),
    prismaRead.memberInvite.findMany({
      where: { guildId, joinedAt: rangeDates(range) },
      select: { inviteCode: true, inviterTag: true, joinedAt: true },
      take: 50_000,
    }),
    prismaRead.guildInvite.findMany({ where: { guildId }, select: { code: true, sourceLabel: true } }),
  ]);

  const tenure = Object.fromEntries(TENURE_BUCKETS.map((b) => [b.key, 0])) as Record<(typeof TENURE_BUCKETS)[number]['key'], number>;
  let unknownTenure = 0;
  for (const p of leavers) {
    if (!p.guildJoinedAt || !p.guildLeftAt) {
      unknownTenure += 1;
      continue;
    }
    tenure[tenureBucket((p.guildLeftAt.getTime() - p.guildJoinedAt.getTime()) / DAY_MS)] += 1;
  }

  const quick = (rows: Array<{ guildJoinedAt: Date | null; guildLeftAt: Date | null }>) =>
    rows.filter((p) => p.guildJoinedAt && p.guildLeftAt && p.guildLeftAt.getTime() - p.guildJoinedAt.getTime() < DAY_MS).length;

  // Arrivées par source, jour par jour : les cinq sources principales, le reste en « autres ».
  const labelOf = new Map(guildInvites.map((g) => [g.code, g.sourceLabel]));
  const vanity = guild?.vanityURLCode ?? null;
  const sourceOf = (code: string | null, tag: string | null) =>
    !code ? 'unknown' : vanity && code === vanity ? 'vanity' : labelOf.get(code) ? `label:${labelOf.get(code)}` : `code:${code}${tag ? ` (${tag})` : ''}`;
  const days = dayKeys(range.start, range.end);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const bySource = new Map<string, number[]>();
  for (const inv of invites) {
    const key = sourceOf(inv.inviteCode, inv.inviterTag);
    const arr = bySource.get(key) ?? new Array<number>(days.length).fill(0);
    const i = dayIndex.get(inv.joinedAt.toISOString().slice(0, 10));
    if (i !== undefined) arr[i] = (arr[i] ?? 0) + 1;
    bySource.set(key, arr);
  }
  const ordered = [...bySource.entries()].map(([key, values]) => ({ key, values, total: values.reduce((s, v) => s + v, 0) })).sort((a, b) => b.total - a.total);
  const other = new Array<number>(days.length).fill(0);
  for (const s of ordered.slice(5)) s.values.forEach((v, i) => { other[i] = (other[i] ?? 0) + v; });

  return {
    range,
    departures: { total: leavers.length, unknownTenure, byTenure: TENURE_BUCKETS.map((b) => ({ key: b.key, count: tenure[b.key] })) },
    quickLeave: {
      joined: joiners.length,
      left24h: quick(joiners),
      rate: pct(quick(joiners), joiners.length),
      previousRate: pct(quick(prevJoiners), prevJoiners.length),
    },
    sources: {
      dates: days,
      groups: ordered.slice(0, 5).map((s) => ({
        key: s.key,
        kind: s.key === 'unknown' ? 'unknown' : s.key === 'vanity' ? 'vanity' : s.key.startsWith('label:') ? 'label' : 'code',
        label: s.key === 'unknown' ? null : s.key === 'vanity' ? vanity : s.key.replace(/^(label|code):/, ''),
        total: s.total,
        values: s.values,
      })),
      other,
    },
  };
}

// ── Modération ─────────────────────────────────────────────────────────────

export const SANCTION_TYPES = Object.values(SanctionType);

export async function getModerationTrends(client: Client, guildId: string, range: DateRange) {
  const guild = client.guilds.cache.get(guildId) ?? null;
  const [rows, prevRows, reports] = await Promise.all([
    prismaRead.sanction.findMany({
      where: { guildId, createdAt: rangeDates(range), archivedAt: null },
      select: { id: true, type: true, targetUserId: true, targetTag: true, moderatorUserId: true, moderatorTag: true, createdAt: true },
      take: 50_000,
    }),
    prismaRead.sanction.findMany({
      where: { guildId, createdAt: prevDates(range), archivedAt: null },
      select: { type: true, targetUserId: true, moderatorUserId: true },
      take: 50_000,
    }),
    prismaRead.sanctionReport.findMany({
      where: { guildId, createdAt: rangeDates(range), sanctionId: { not: null } },
      select: { sanctionId: true, incidentAt: true },
      take: 20_000,
    }),
  ]);

  const days = dayKeys(range.start, range.end);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const byType = new Map<string, number[]>(SANCTION_TYPES.map((t) => [t, new Array<number>(days.length).fill(0)]));
  for (const r of rows) {
    const i = dayIndex.get(r.createdAt.toISOString().slice(0, 10));
    if (i !== undefined) byType.get(r.type)![i]! += 1;
  }

  const countBy = <T>(list: T[], key: (item: T) => string) => {
    const out = new Map<string, number>();
    for (const item of list) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
    return out;
  };

  const modNow = new Map<string, { count: number; tag: string | null; types: Record<string, number> }>();
  for (const r of rows) {
    const e = modNow.get(r.moderatorUserId) ?? { count: 0, tag: r.moderatorTag, types: {} };
    e.count += 1;
    e.types[r.type] = (e.types[r.type] ?? 0) + 1;
    modNow.set(r.moderatorUserId, e);
  }
  const modPrev = countBy(prevRows, (r) => r.moderatorUserId);

  const targets = countBy(rows, (r) => r.targetUserId);
  const prevTargets = countBy(prevRows, (r) => r.targetUserId);
  const repeat = [...targets.entries()].filter(([, n]) => n >= 2);
  const lastOf = new Map<string, { at: Date; tag: string | null }>();
  for (const r of rows) {
    const cur = lastOf.get(r.targetUserId);
    if (!cur || r.createdAt > cur.at) lastOf.set(r.targetUserId, { at: r.createdAt, tag: r.targetTag });
  }

  const createdOf = new Map(rows.map((r) => [r.id, r.createdAt]));
  const delays = reports
    .map((rep) => {
      const created = rep.sanctionId ? createdOf.get(rep.sanctionId) : undefined;
      return created ? Math.max(0, (created.getTime() - rep.incidentAt.getTime()) / 1000) : null;
    })
    .filter((d): d is number => d !== null && d < 30 * 24 * 3600);

  const name = (id: string, tag: string | null) => guild?.members.cache.get(id)?.displayName ?? tag ?? null;

  return {
    range,
    total: rows.length,
    previousTotal: prevRows.length,
    byType: {
      dates: days,
      series: SANCTION_TYPES.map((t) => ({ type: t, total: byType.get(t)!.reduce((s, v) => s + v, 0), values: byType.get(t)! })).filter((s) => s.total > 0),
    },
    moderators: [...modNow.entries()]
      .map(([userId, e]) => ({ userId, name: name(userId, e.tag), count: e.count, previous: modPrev.get(userId) ?? 0, types: e.types, share: pct(e.count, rows.length) ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
    recidivism: {
      sanctioned: targets.size,
      repeat: repeat.length,
      rate: pct(repeat.length, targets.size),
      previousRate: pct([...prevTargets.values()].filter((n) => n >= 2).length, prevTargets.size),
      offenders: repeat
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([userId, count]) => ({ userId, name: name(userId, lastOf.get(userId)?.tag ?? null), count, last: lastOf.get(userId)?.at.toISOString() ?? null })),
    },
    reportDelay: { reports: delays.length, medianSec: median(delays) },
  };
}

// ── Staff ──────────────────────────────────────────────────────────────────

export async function getStaffInsights(client: Client, guildId: string, range: DateRange, timezone: string) {
  const guild = client.guilds.cache.get(guildId) ?? null;
  const [tickets, prevTickets] = await Promise.all([
    prismaRead.ticket.findMany({
      where: { guildId, createdAt: rangeDates(range) },
      select: { createdAt: true, firstResponseAt: true, firstResponderId: true, closedAt: true, claimedById: true, claimedByName: true, closedById: true, closedByName: true },
      take: 50_000,
    }),
    prismaRead.ticket.findMany({
      where: { guildId, createdAt: prevDates(range) },
      select: { createdAt: true, firstResponseAt: true, closedAt: true },
      take: 50_000,
    }),
  ]);

  const firstDelay = (t: { createdAt: Date; firstResponseAt: Date | null }) =>
    t.firstResponseAt ? Math.max(0, (t.firstResponseAt.getTime() - t.createdAt.getTime()) / 1000) : null;
  const resolution = (t: { createdAt: Date; closedAt: Date | null }) =>
    t.closedAt ? Math.max(0, (t.closedAt.getTime() - t.createdAt.getTime()) / 1000) : null;
  const firsts = tickets.map(firstDelay).filter((d): d is number => d !== null);
  const prevFirsts = prevTickets.map(firstDelay).filter((d): d is number => d !== null);
  const resolutions = tickets.map(resolution).filter((d): d is number => d !== null);
  const prevResolutions = prevTickets.map(resolution).filter((d): d is number => d !== null);

  // Charge : prises en charge, fermetures et premières réponses par membre du staff.
  const staff = new Map<string, { name: string | null; claimed: number; closed: number; firstResponses: number[] }>();
  const entry = (id: string, fallback: string | null) => {
    const e = staff.get(id) ?? { name: guild?.members.cache.get(id)?.displayName ?? fallback, claimed: 0, closed: 0, firstResponses: [] };
    staff.set(id, e);
    return e;
  };
  for (const t of tickets) {
    if (t.claimedById) entry(t.claimedById, t.claimedByName).claimed += 1;
    if (t.closedById) entry(t.closedById, t.closedByName).closed += 1;
    const d = firstDelay(t);
    if (t.firstResponderId && d !== null) entry(t.firstResponderId, null).firstResponses.push(d);
  }
  const handled = [...staff.values()].reduce((s, e) => s + e.claimed, 0);

  // Heures où les tickets attendent : ouverts et délai médian, par jour de semaine et heure locale.
  const zoner = new BucketZoner(timezone);
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ opened: 0, delays: [] as number[] })));
  for (const t of tickets) {
    const b = zoner.fromDate(t.createdAt);
    const cell = grid[(b.weekday + 6) % 7]![b.hour]!;
    cell.opened += 1;
    const d = firstDelay(t);
    if (d !== null) cell.delays.push(d);
  }

  return {
    range,
    timezone,
    measuredSince: tickets.some((t) => t.firstResponseAt) || prevTickets.some((t) => t.firstResponseAt),
    tickets: {
      opened: tickets.length,
      previousOpened: prevTickets.length,
      responded: firsts.length,
      firstResponseMedianSec: median(firsts),
      previousFirstResponseMedianSec: median(prevFirsts),
      within1h: pct(firsts.filter((d) => d <= 3600).length, firsts.length),
      resolutionMedianSec: median(resolutions),
      previousResolutionMedianSec: median(prevResolutions),
      unresolved: tickets.filter((t) => !t.closedAt).length,
    },
    staff: [...staff.entries()]
      .map(([userId, e]) => ({
        userId,
        name: e.name,
        claimed: e.claimed,
        closed: e.closed,
        firstResponses: e.firstResponses.length,
        firstResponseMedianSec: median(e.firstResponses),
        share: pct(e.claimed, handled) ?? 0,
      }))
      .sort((a, b) => b.claimed + b.firstResponses - (a.claimed + a.firstResponses))
      .slice(0, 25),
    coverage: grid.map((row) => row.map((cell) => ({ opened: cell.opened, medianSec: median(cell.delays) }))),
  };
}

// ── Mots en hausse ─────────────────────────────────────────────────────────

export interface WordTrend { word: string; count: number; previous: number; change: number | null }

/**
 * Mots qui montent : la part du mot dans le total compare à celle de la
 * période d'avant (le volume global du serveur ne doit pas tout faire
 * monter), avec un minimum d'occurrences pour écarter les mots rares.
 */
export function wordTrends(cur: Map<string, number>, prev: Map<string, number>, minCount = 5) {
  const total = [...cur.values()].reduce((s, v) => s + v, 0) || 1;
  const prevTotal = [...prev.values()].reduce((s, v) => s + v, 0) || 1;
  const rows: Array<WordTrend & { score: number }> = [];
  for (const word of new Set([...cur.keys(), ...prev.keys()])) {
    const count = cur.get(word) ?? 0;
    const previous = prev.get(word) ?? 0;
    if (Math.max(count, previous) < minCount) continue;
    const share = count / total;
    const prevShare = previous / prevTotal;
    const change = previous > 0 ? Math.round(((share - prevShare) / prevShare) * 1000) / 10 : null;
    rows.push({ word, count, previous, change, score: (share + 1e-6) / (prevShare + 1e-6) });
  }
  return {
    rising: rows.filter((r) => r.previous > 0 && r.score > 1.2).sort((a, b) => b.score - a.score).slice(0, 25).map(({ score: _s, ...r }) => r),
    falling: rows.filter((r) => r.count > 0 && r.score < 0.8).sort((a, b) => a.score - b.score).slice(0, 25).map(({ score: _s, ...r }) => r),
    fresh: rows.filter((r) => r.previous === 0 && r.count >= minCount).sort((a, b) => b.count - a.count).slice(0, 25).map(({ score: _s, ...r }) => r),
  };
}

export async function getRisingWords(guildId: string, range: DateRange) {
  const [cur, prev, guild] = await Promise.all([
    prismaRead.$queryRaw<Array<{ word: string; n: number }>>`
      SELECT "word", SUM("count")::int AS n FROM "guild_word_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.start} AND "dateKey" <= ${range.end}
      GROUP BY "word" ORDER BY n DESC LIMIT 3000
    `,
    prismaRead.$queryRaw<Array<{ word: string; n: number }>>`
      SELECT "word", SUM("count")::int AS n FROM "guild_word_stats"
      WHERE "guildId" = ${guildId} AND "dateKey" >= ${range.prevStart} AND "dateKey" <= ${range.prevEnd}
      GROUP BY "word" ORDER BY n DESC LIMIT 3000
    `,
    prismaRead.guild.findUnique({ where: { id: guildId }, select: { wordStatsEnabled: true } }),
  ]);
  return {
    range,
    enabled: guild?.wordStatsEnabled ?? false,
    hasData: cur.length > 0,
    ...wordTrends(new Map(cur.map((r) => [r.word, r.n])), new Map(prev.map((r) => [r.word, r.n]))),
  };
}

