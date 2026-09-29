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
 *
 * Deux vocabulaires cohabitent dans les tables : l'ancien (`ticket`,
 * `sanction`, écrit par `setModuleActivation` et les premières lignes
 * d'usage) et les clés du registre (`tickets`, `sanctions`), qu'écrit le suivi
 * central des interactions. Tout est replié ici sur la clé du registre.
 */

import { MODULE_REGISTRY } from '@kotbo/contracts';
import prisma from '../../utils/db.js';
import { cache } from '../../utils/cache.js';
import { resolveModuleKey } from '../core/moduleActivationService.js';
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

type UsageRow = { moduleName: string; guildId: string; commands: bigint; apiCalls: bigint; events: bigint; userDays: bigint };
type PerfRow = { moduleName: string; executions: bigint; weightedMs: number | null; maxMs: number | null; errors: bigint };

const n = (value: bigint | number | null | undefined) => (typeof value === 'bigint' ? Number(value) : value ?? 0);
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Clé du registre pour un nom lu en base ; `core` et les inconnus restent tels quels. */
export function fleetModuleKey(name: string): string {
  if (name === 'core') return name;
  return resolveModuleKey(name) ?? name;
}

function emptyRow(module: string): ModuleFleetRow & { guildSet: Set<string>; weightedMs: number } {
  return {
    module, enabledGuilds: 0, activationRate: 0, usedGuilds: 0, commands: 0, apiCalls: 0, events: 0,
    totalUsage: 0, previousUsage: 0, userDays: 0, executions: 0, avgExecutionMs: 0, maxExecutionMs: 0,
    errors: 0, errorRate: 0, guildSet: new Set(), weightedMs: 0,
  };
}

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
      SELECT "moduleName", "guildId",
             SUM("commandExecutions")::bigint AS "commands",
             SUM("apiCalls")::bigint AS "apiCalls",
             SUM("eventTriggers")::bigint AS "events",
             SUM("uniqueUsers")::bigint AS "userDays"
      FROM "module_usage_stats"
      WHERE "dateKey" BETWEEN ${fromKey} AND ${toKey} AND "guildId" IS NOT NULL
      GROUP BY "moduleName", "guildId"`,
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

  const rows = new Map<string, ReturnType<typeof emptyRow>>();
  const rowFor = (name: string) => {
    const key = fleetModuleKey(name);
    let row = rows.get(key);
    if (!row) {
      row = emptyRow(key);
      rows.set(key, row);
    }
    return row;
  };

  for (const mod of MODULE_REGISTRY) {
    if (!mod.core) rowFor(mod.key);
  }

  // Deux anciens noms peuvent désigner le même module (vocaux temporaires et
  // honeypot dans « Gestion des salons ») : on garde le plus grand plutôt que
  // de compter deux fois les mêmes serveurs.
  for (const a of activations) {
    const row = rowFor(a.moduleName);
    row.enabledGuilds = Math.max(row.enabledGuilds, a._count._all);
  }

  for (const u of usage) {
    const row = rowFor(u.moduleName);
    row.commands += n(u.commands);
    row.apiCalls += n(u.apiCalls);
    row.events += n(u.events);
    row.userDays += n(u.userDays);
    row.guildSet.add(u.guildId);
  }

  for (const p of previous) rowFor(p.moduleName).previousUsage += n(p.usage);

  for (const p of perf) {
    const row = rowFor(p.moduleName);
    row.executions += n(p.executions);
    row.weightedMs += p.weightedMs ?? 0;
    row.maxExecutionMs = Math.max(row.maxExecutionMs, Math.round(p.maxMs ?? 0));
    row.errors += n(p.errors);
  }

  const modules: ModuleFleetRow[] = [...rows.values()].map(({ guildSet, weightedMs, ...row }) => ({
    ...row,
    activationRate: totalGuilds > 0 ? round1((row.enabledGuilds / totalGuilds) * 100) : 0,
    usedGuilds: guildSet.size,
    totalUsage: row.commands + row.apiCalls + row.events,
    avgExecutionMs: row.executions > 0 ? Math.round(weightedMs / row.executions) : 0,
    errorRate: row.executions > 0 ? round1((row.errors / row.executions) * 100) : 0,
  }));
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
