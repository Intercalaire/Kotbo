/**
 * moduleFleetStatsService.ts
 *
 * Modules du bot vus sur tout le parc, pour l'onglet « Modules » de
 * /admin/analytics : combien de serveurs les ont allumés, combien s'en servent
 * vraiment sur la période, en commandes, appels API et événements, et avec
 * quelle performance.
 *
 * Remplace ce que lisait l'ancienne page /admin/modules, qui recevait les
 * lignes brutes serveur × jour et attendait des champs que l'API ne renvoyait
 * pas : ses tableaux restaient vides.
 */

import prisma from '../../utils/db.js';
import { cache } from '../../utils/cache.js';
import { KOTBO_MODULES } from './moduleStatsService.js';
import { resolveUsageRange } from './dashboardUsageService.js';

const DAY_MS = 24 * 3600 * 1000;
const CACHE_TTL_SECONDS = 300;

export type ModuleFleetRow = {
  module: string;
  enabledGuilds: number;
  activationRate: number;
  /** Serveurs où le module a servi au moins une fois sur la période. */
  usedGuilds: number;
  commands: number;
  apiCalls: number;
  events: number;
  totalUsage: number;
  previousUsage: number;
  /** Somme des utilisateurs uniques par jour et par serveur. */
  userDays: number;
  executions: number;
  avgExecutionMs: number;
  maxExecutionMs: number;
  errors: number;
  errorRate: number;
};

export type ModuleFleetResult = {
  from: string;
  to: string;
  totalGuilds: number;
  modules: ModuleFleetRow[];
  daily: Array<{ dateKey: string; usage: number }>;
};

type UsageRow = { moduleName: string; commands: bigint; apiCalls: bigint; events: bigint; userDays: bigint; guilds: bigint };
type PerfRow = { moduleName: string; executions: bigint; weightedMs: number | null; maxMs: number | null; errors: bigint };

const n = (value: bigint | number | null | undefined) => (typeof value === 'bigint' ? Number(value) : value ?? 0);
const round1 = (value: number) => Math.round(value * 10) / 10;

async function computeModuleFleetStats(fromKey: string, toKey: string, days: number): Promise<ModuleFleetResult> {
  const prevTo = new Date(Date.parse(fromKey) - DAY_MS).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(fromKey) - days * DAY_MS).toISOString().slice(0, 10);

  const [totalGuilds, activations, usage, previous, perf, daily] = await Promise.all([
    prisma.guild.count(),
    prisma.moduleActivationStat.groupBy({
      by: ['moduleName'],
      where: { enabled: true, guildId: { not: null } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<UsageRow[]>`
      SELECT "moduleName",
             SUM("commandExecutions")::bigint AS "commands",
             SUM("apiCalls")::bigint AS "apiCalls",
             SUM("eventTriggers")::bigint AS "events",
             SUM("uniqueUsers")::bigint AS "userDays",
             COUNT(DISTINCT "guildId")::bigint AS "guilds"
      FROM "module_usage_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "guildId" IS NOT NULL
      GROUP BY "moduleName"`,
    prisma.$queryRaw<Array<{ moduleName: string; usage: bigint }>>`
      SELECT "moduleName", SUM("commandExecutions" + "apiCalls" + "eventTriggers")::bigint AS "usage"
      FROM "module_usage_stats"
      WHERE "dateKey" BETWEEN ${prevFrom} AND ${prevTo} AND "guildId" IS NOT NULL
      GROUP BY "moduleName"`,
    prisma.$queryRaw<PerfRow[]>`
      SELECT "moduleName",
             SUM("totalExecutions")::bigint AS "executions",
             SUM("avgExecutionTimeMs" * "totalExecutions") AS "weightedMs",
             MAX("maxExecutionTimeMs") AS "maxMs",
             SUM("errorCount")::bigint AS "errors"
      FROM "module_performance_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "guildId" IS NOT NULL
      GROUP BY "moduleName"`,
    prisma.$queryRaw<Array<{ dateKey: string; usage: bigint }>>`
      SELECT "dateKey", SUM("commandExecutions" + "apiCalls" + "eventTriggers")::bigint AS "usage"
      FROM "module_usage_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "guildId" IS NOT NULL
      GROUP BY "dateKey"`,
  ]);

  const enabledBy = new Map(activations.map((a) => [a.moduleName, a._count._all]));
  const usageBy = new Map(usage.map((u) => [u.moduleName, u]));
  const previousBy = new Map(previous.map((p) => [p.moduleName, n(p.usage)]));
  const perfBy = new Map(perf.map((p) => [p.moduleName, p]));

  const names = new Set<string>([...KOTBO_MODULES, ...enabledBy.keys(), ...usageBy.keys()]);
  const modules: ModuleFleetRow[] = [...names].map((module) => {
    const u = usageBy.get(module);
    const p = perfBy.get(module);
    const commands = n(u?.commands);
    const apiCalls = n(u?.apiCalls);
    const events = n(u?.events);
    const executions = n(p?.executions);
    const errors = n(p?.errors);
    const enabledGuilds = enabledBy.get(module) ?? 0;
    return {
      module,
      enabledGuilds,
      activationRate: totalGuilds > 0 ? round1((enabledGuilds / totalGuilds) * 100) : 0,
      usedGuilds: n(u?.guilds),
      commands,
      apiCalls,
      events,
      totalUsage: commands + apiCalls + events,
      previousUsage: previousBy.get(module) ?? 0,
      userDays: n(u?.userDays),
      executions,
      avgExecutionMs: executions > 0 ? Math.round((p?.weightedMs ?? 0) / executions) : 0,
      maxExecutionMs: Math.round(p?.maxMs ?? 0),
      errors,
      errorRate: executions > 0 ? round1((errors / executions) * 100) : 0,
    };
  });
  modules.sort((a, b) => b.totalUsage - a.totalUsage || b.enabledGuilds - a.enabledGuilds);

  const dailyBy = new Map(daily.map((d) => [d.dateKey, n(d.usage)]));
  const series: ModuleFleetResult['daily'] = [];
  for (let t = Date.parse(fromKey); t <= Date.parse(toKey); t += DAY_MS) {
    const key = new Date(t).toISOString().slice(0, 10);
    series.push({ dateKey: key, usage: dailyBy.get(key) ?? 0 });
  }

  return { from: fromKey, to: toKey, totalGuilds, modules, daily: series };
}

export async function getModuleFleetStats(options: { from?: string | null; to?: string | null }): Promise<ModuleFleetResult> {
  const { fromKey, toKey, days } = resolveUsageRange(options.from, options.to);
  return cache.wrap(`admin:module-fleet:${fromKey}:${toKey}`, CACHE_TTL_SECONDS, () =>
    computeModuleFleetStats(fromKey, toKey, days),
  );
}
