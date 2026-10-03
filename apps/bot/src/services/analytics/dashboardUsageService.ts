/**
 * dashboardUsageService.ts
 *
 * Lecture de la télémétrie du dashboard pour /admin/analytics (onglet « Usage
 * du dashboard ») : pages et modules les plus consultés, temps passé,
 * enregistrements, onglets, sources de navigation, appareils, santé.
 *
 * Les visiteurs se lisent en visiteurs-jours : le hash change chaque jour, une
 * personne revenue trois jours compte trois fois. C'est voulu (voir
 * dashboardTelemetryService.ts) et l'écran le dit.
 */

import { Prisma } from '@prisma/client';
import type {
  DashboardUsageDailyRow,
  DashboardUsageDimensionRow,
  DashboardUsageFeatureRow,
  DashboardUsagePageRow,
  DashboardUsageResult,
  DashboardUsageRow,
  DashboardUsageTabRow,
} from '@kotbo/contracts';
import prisma from '../../utils/db.js';
import { cache } from '../../utils/cache.js';

const DAY_MS = 24 * 3600 * 1000;
const CACHE_TTL_SECONDS = 300;
const GUILD_ID_RE = /^\d{17,20}$/;

type StatRow = { page: string; feature: string; event: string; dimension: string; count: bigint | number; valueSum: bigint | number };
type GuildCountRow = { key: string; guilds: bigint | number };
type ScopeRow = { scope: string; visitors: bigint | number };

function toNumber(value: bigint | number | null | undefined): number {
  return typeof value === 'bigint' ? Number(value) : value ?? 0;
}

function dateKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveUsageRange(from?: string | null, to?: string | null, now: Date = new Date()): { fromKey: string; toKey: string; days: number } {
  const toDate = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : now;
  const fromDate = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(toDate.getTime() - 29 * DAY_MS);
  const fromKey = dateKeyOf(fromDate);
  const toKey = dateKeyOf(toDate);
  const days = Math.max(1, Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY_MS) + 1);
  return { fromKey, toKey, days };
}

function emptyRow(): DashboardUsageRow {
  return { views: 0, visitorDays: 0, guilds: 0, activeMs: 0, timeSamples: 0, saves: 0, saveErrors: 0, apiErrors: 0, blocked: 0, exits: 0 };
}

/** Répartit une ligne d'agrégat sur les compteurs d'une ligne d'usage. */
function accumulate(row: DashboardUsageRow, event: string, count: number, valueSum: number): void {
  switch (event) {
    case 'page_view': row.views += count; break;
    case 'page_time': row.activeMs += valueSum; row.timeSamples += count; break;
    case 'save': row.saves += count; break;
    case 'save_error': row.saveErrors += count; break;
    case 'api_error': row.apiErrors += count; break;
    case 'blocked': row.blocked += count; break;
    case 'page_exit': row.exits += count; break;
  }
}

function guildFilter(guildId: string | null): Prisma.Sql {
  return guildId ? Prisma.sql`AND "guildId" = ${guildId}` : Prisma.empty;
}

async function readTotals(fromKey: string, toKey: string, guildId: string | null): Promise<DashboardUsageRow & { sessions: number }> {
  const [stats, visitors, guilds] = await Promise.all([
    prisma.$queryRaw<Array<{ event: string; count: bigint; valueSum: bigint }>>`
      SELECT "event", SUM("count")::bigint AS "count", SUM("valueSum")::bigint AS "valueSum"
      FROM "dashboard_telemetry_daily_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} ${guildFilter(guildId)}
      GROUP BY "event"`,
    prisma.$queryRaw<Array<{ visitors: bigint }>>`
      SELECT COUNT(DISTINCT "dateKey" || ':' || "visitorHash")::bigint AS "visitors"
      FROM "dashboard_telemetry_visitors"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "scope" = 'all' ${guildFilter(guildId)}`,
    prisma.$queryRaw<Array<{ guilds: bigint }>>`
      SELECT COUNT(DISTINCT "guildId")::bigint AS "guilds"
      FROM "dashboard_telemetry_daily_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "event" = 'page_view' AND "guildId" <> '' ${guildFilter(guildId)}`,
  ]);

  const totals = { ...emptyRow(), sessions: 0 };
  for (const s of stats) {
    accumulate(totals, s.event, toNumber(s.count), toNumber(s.valueSum));
    if (s.event === 'session_start') totals.sessions += toNumber(s.count);
  }
  totals.visitorDays = toNumber(visitors[0]?.visitors);
  totals.guilds = toNumber(guilds[0]?.guilds);
  return totals;
}

async function computeDashboardUsage(options: {
  fromKey: string;
  toKey: string;
  days: number;
  guildId: string | null;
  compare: boolean;
}): Promise<DashboardUsageResult> {
  const { fromKey, toKey, days, guildId } = options;
  const g = guildFilter(guildId);

  const [statRows, pageGuilds, featureGuilds, scopeRows, tabRows, dailyStats, dailyVisitors, totals] = await Promise.all([
    prisma.$queryRaw<StatRow[]>`
      SELECT "page", "feature", "event", "dimension",
             SUM("count")::bigint AS "count", SUM("valueSum")::bigint AS "valueSum"
      FROM "dashboard_telemetry_daily_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} ${g}
      GROUP BY "page", "feature", "event", "dimension"`,
    prisma.$queryRaw<GuildCountRow[]>`
      SELECT "page" AS "key", COUNT(DISTINCT "guildId")::bigint AS "guilds"
      FROM "dashboard_telemetry_daily_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "event" = 'page_view' AND "guildId" <> '' ${g}
      GROUP BY "page"`,
    prisma.$queryRaw<GuildCountRow[]>`
      SELECT "feature" AS "key", COUNT(DISTINCT "guildId")::bigint AS "guilds"
      FROM "dashboard_telemetry_daily_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "event" = 'page_view' AND "guildId" <> '' AND "feature" <> '' ${g}
      GROUP BY "feature"`,
    prisma.$queryRaw<ScopeRow[]>`
      SELECT "scope", COUNT(DISTINCT "dateKey" || ':' || "visitorHash")::bigint AS "visitors"
      FROM "dashboard_telemetry_visitors"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} ${g}
      GROUP BY "scope"`,
    prisma.$queryRaw<Array<{ page: string; tab: string; views: bigint }>>`
      SELECT "page", "tab", SUM("count")::bigint AS "views"
      FROM "dashboard_telemetry_daily_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "event" = 'tab_view' AND "tab" <> '' ${g}
      GROUP BY "page", "tab"
      ORDER BY "views" DESC
      LIMIT 200`,
    prisma.$queryRaw<Array<{ dateKey: string; event: string; count: bigint }>>`
      SELECT "dateKey", "event", SUM("count")::bigint AS "count"
      FROM "dashboard_telemetry_daily_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "event" IN ('page_view', 'session_start', 'save') ${g}
      GROUP BY "dateKey", "event"`,
    prisma.$queryRaw<Array<{ dateKey: string; visitors: bigint }>>`
      SELECT "dateKey", COUNT(DISTINCT "visitorHash")::bigint AS "visitors"
      FROM "dashboard_telemetry_visitors"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "scope" = 'all' ${g}
      GROUP BY "dateKey"`,
    readTotals(fromKey, toKey, guildId),
  ]);

  const visitorsByScope = new Map(scopeRows.map((r) => [r.scope, toNumber(r.visitors)]));
  const guildsByPage = new Map(pageGuilds.map((r) => [r.key, toNumber(r.guilds)]));
  const guildsByFeature = new Map(featureGuilds.map((r) => [r.key, toNumber(r.guilds)]));

  const pages = new Map<string, DashboardUsagePageRow>();
  const features = new Map<string, DashboardUsageFeatureRow & { pageSet: Set<string> }>();
  const dimensions = new Map<string, DashboardUsageDimensionRow>();
  const health = new Map<string, { page: string; latencySamples: number; latencyMs: number; slow: number; apiErrors: number; jsErrors: number; routeLoadMs: number; routeLoads: number }>();

  for (const r of statRows) {
    const count = toNumber(r.count);
    const valueSum = toNumber(r.valueSum);

    // Les événements de session n'appartiennent à aucune page en propre.
    const isSessionEvent = r.event === 'session_start' || r.event === 'session_env' || r.event === 'palette' || r.event === 'web_vital';

    if (!isSessionEvent) {
      const pageRow = pages.get(r.page) ?? { ...emptyRow(), page: r.page, feature: r.feature };
      if (!pageRow.feature && r.feature) pageRow.feature = r.feature;
      accumulate(pageRow, r.event, count, valueSum);
      pages.set(r.page, pageRow);

      if (r.feature) {
        const featureRow = features.get(r.feature) ?? { ...emptyRow(), feature: r.feature, pages: 0, pageSet: new Set<string>() };
        accumulate(featureRow, r.event, count, valueSum);
        if (r.event === 'page_view') featureRow.pageSet.add(r.page);
        features.set(r.feature, featureRow);
      }
    }

    if (r.dimension) {
      const key = `${r.event}\u0001${r.dimension}`;
      const dim = dimensions.get(key) ?? { event: r.event, dimension: r.dimension, count: 0, valueSum: 0 };
      dim.count += count;
      dim.valueSum += valueSum;
      dimensions.set(key, dim);
    }

    if (['api_latency', 'api_error', 'js_error', 'route_load'].includes(r.event)) {
      const h = health.get(r.page) ?? { page: r.page, latencySamples: 0, latencyMs: 0, slow: 0, apiErrors: 0, jsErrors: 0, routeLoadMs: 0, routeLoads: 0 };
      if (r.event === 'api_latency') {
        h.latencySamples += count;
        h.latencyMs += valueSum;
        if (r.dimension === 'gt3000') h.slow += count;
      } else if (r.event === 'api_error') h.apiErrors += count;
      else if (r.event === 'js_error') h.jsErrors += count;
      else if (r.event === 'route_load') {
        h.routeLoads += count;
        h.routeLoadMs += valueSum;
      }
      health.set(r.page, h);
    }
  }

  const pageList = [...pages.values()]
    .map((p) => ({ ...p, visitorDays: visitorsByScope.get(`page:${p.page}`) ?? 0, guilds: guildsByPage.get(p.page) ?? 0 }))
    .filter((p) => p.views > 0 || p.saves > 0 || p.apiErrors > 0)
    .sort((a, b) => b.views - a.views);

  const featureList = [...features.values()]
    .map(({ pageSet, ...f }) => ({
      ...f,
      pages: pageSet.size,
      visitorDays: visitorsByScope.get(`feature:${f.feature}`) ?? 0,
      guilds: guildsByFeature.get(f.feature) ?? 0,
    }))
    .sort((a, b) => b.views - a.views);

  const dailyMap = new Map<string, DashboardUsageDailyRow>();
  for (let t = Date.parse(fromKey); t <= Date.parse(toKey); t += DAY_MS) {
    const key = dateKeyOf(new Date(t));
    dailyMap.set(key, { dateKey: key, views: 0, visitorDays: 0, sessions: 0, saves: 0 });
  }
  for (const d of dailyStats) {
    const row = dailyMap.get(d.dateKey);
    if (!row) continue;
    if (d.event === 'page_view') row.views += toNumber(d.count);
    else if (d.event === 'session_start') row.sessions += toNumber(d.count);
    else if (d.event === 'save') row.saves += toNumber(d.count);
  }
  for (const d of dailyVisitors) {
    const row = dailyMap.get(d.dateKey);
    if (row) row.visitorDays = toNumber(d.visitors);
  }

  let previousTotals: DashboardUsageResult['previousTotals'] = null;
  if (options.compare) {
    const prevTo = dateKeyOf(new Date(Date.parse(fromKey) - DAY_MS));
    const prevFrom = dateKeyOf(new Date(Date.parse(fromKey) - days * DAY_MS));
    previousTotals = await readTotals(prevFrom, prevTo, guildId);
  }

  return {
    from: fromKey,
    to: toKey,
    totals,
    previousTotals,
    daily: [...dailyMap.values()],
    pages: pageList,
    features: featureList,
    tabs: tabRows.map((t): DashboardUsageTabRow => ({ page: t.page, tab: t.tab, views: toNumber(t.views) })),
    dimensions: [...dimensions.values()].sort((a, b) => b.count - a.count),
    health: [...health.values()]
      .map(({ slow, ...h }) => ({ ...h, slowShare: h.latencySamples > 0 ? Math.round((slow / h.latencySamples) * 1000) / 10 : 0 }))
      .sort((a, b) => b.apiErrors + b.jsErrors - (a.apiErrors + a.jsErrors) || b.latencyMs / Math.max(b.latencySamples, 1) - a.latencyMs / Math.max(a.latencySamples, 1))
      .slice(0, 50),
  };
}

export async function getDashboardUsage(options: {
  from?: string | null;
  to?: string | null;
  guildId?: string | null;
  compare?: boolean;
}): Promise<DashboardUsageResult> {
  const { fromKey, toKey, days } = resolveUsageRange(options.from, options.to);
  const guildId = options.guildId && GUILD_ID_RE.test(options.guildId) ? options.guildId : null;
  const compare = options.compare === true;
  const key = `admin:dashboard-usage:${fromKey}:${toKey}:${guildId ?? 'all'}:${compare ? 1 : 0}`;
  return cache.wrap(key, CACHE_TTL_SECONDS, () => computeDashboardUsage({ fromKey, toKey, days, guildId, compare }));
}
