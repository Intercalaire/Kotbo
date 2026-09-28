/**
 * moduleUsageBuffer.ts
 *
 * Suivi d'usage et de performance de toutes les commandes, par module, sans
 * écriture sur le chemin de la commande.
 *
 * `wrapModuleTracking` (utils/moduleTracking.ts) fait cinq allers-retours en
 * base par exécution, en lecture-modification-écriture, et n'équipait qu'une
 * poignée de commandes : l'onglet Modules de l'administration restait presque
 * vide. Ici, chaque exécution s'ajoute à un tampon mémoire, vidé toutes les
 * 60 s en deux `INSERT … ON CONFLICT` groupés (usage, performance).
 *
 * Les utilisateurs uniques sont comptés une fois par serveur × module × jour :
 * le tampon garde les ID vus du jour en mémoire (jamais en base) et n'ajoute
 * au compteur que les nouveaux. Suit `analyticsEnabled`, comme l'usage
 * historique ; la performance, sans identité, tourne partout.
 */

import crypto from 'node:crypto';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { isAnalyticsCollectionEnabled } from './analyticsConsent.js';
import type { KotboModule } from './moduleStatsService.js';

const SEP = '\u0001';
const FLUSH_INTERVAL_MS =
  Number.parseInt(process.env.ANALYTICS_FLUSH_INTERVAL_MS ?? '60000', 10) || 60000;
const CHUNK_SIZE = 200;
/** Au-delà, on cesse de retenir les ID du jour : le compteur d'uniques sature, rien ne casse. */
const MAX_SEEN_USERS = 200_000;

type UsageCounters = { commands: number; apiCalls: number; events: number; newUsers: number };
type PerfCounters = { executions: number; totalMs: number; maxMs: number; minMs: number; errors: number };

const usageBuffer = new Map<string, UsageCounters>();
const perfBuffer = new Map<string, PerfCounters>();
const seenUsers = new Set<string>();
let seenDay = '';
let timer: ReturnType<typeof setInterval> | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export type ModuleExecution = {
  guildId: string;
  moduleName: KotboModule;
  actionType: 'command' | 'api' | 'event';
  userId?: string;
  durationMs: number;
  success: boolean;
};

/** Enregistre une exécution. Ne lève jamais, ne fait attendre personne. */
export async function recordModuleExecution(execution: ModuleExecution): Promise<void> {
  try {
    ensureModuleUsageFlusher();
    const dateKey = today();
    if (dateKey !== seenDay) {
      seenUsers.clear();
      seenDay = dateKey;
    }
    const key = [execution.guildId, execution.moduleName, dateKey].join(SEP);

    const perf = perfBuffer.get(key) ?? { executions: 0, totalMs: 0, maxMs: 0, minMs: Number.POSITIVE_INFINITY, errors: 0 };
    const ms = Math.max(0, Math.round(execution.durationMs));
    perf.executions += 1;
    perf.totalMs += ms;
    perf.maxMs = Math.max(perf.maxMs, ms);
    perf.minMs = Math.min(perf.minMs, ms);
    if (!execution.success) perf.errors += 1;
    perfBuffer.set(key, perf);

    if (!(await isAnalyticsCollectionEnabled(execution.guildId))) return;

    const usage = usageBuffer.get(key) ?? { commands: 0, apiCalls: 0, events: 0, newUsers: 0 };
    if (execution.actionType === 'command') usage.commands += 1;
    else if (execution.actionType === 'api') usage.apiCalls += 1;
    else usage.events += 1;
    if (execution.userId && seenUsers.size < MAX_SEEN_USERS) {
      const userKey = `${key}${SEP}${execution.userId}`;
      if (!seenUsers.has(userKey)) {
        seenUsers.add(userKey);
        usage.newUsers += 1;
      }
    }
    usageBuffer.set(key, usage);
  } catch (error) {
    logger.warn('ModuleUsage', 'Exécution non comptée :', error);
  }
}

async function flushUsage(entries: Array<[string, UsageCounters]>): Promise<void> {
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const params: unknown[] = [];
    const tuples = chunk.map(([key, c]) => {
      const [guildId, moduleName, dateKey] = key.split(SEP);
      const base = params.length;
      params.push(crypto.randomUUID(), guildId, moduleName, dateKey, c.commands, c.apiCalls, c.events, c.newUsers);
      return `($${base + 1}::text, $${base + 2}::text, $${base + 3}::text, $${base + 4}::text, $${base + 5}::int, $${base + 6}::int, $${base + 7}::int, $${base + 8}::int)`;
    });
    // La jointure sur `guilds` écarte un serveur absent de la base : sans
    // elle, sa clé étrangère ferait échouer tout le lot.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "module_usage_stats" ("id", "guildId", "moduleName", "dateKey", "commandExecutions", "apiCalls", "eventTriggers", "uniqueUsers", "createdAt", "updatedAt")
       SELECT v.id, v."guildId", v."moduleName", v."dateKey", v.c, v.a, v.e, v.u, NOW(), NOW()
       FROM (VALUES ${tuples.join(', ')}) AS v(id, "guildId", "moduleName", "dateKey", c, a, e, u)
       JOIN "guilds" g ON g."id" = v."guildId"
       ON CONFLICT ("guildId", "moduleName", "dateKey") DO UPDATE SET
         "commandExecutions" = "module_usage_stats"."commandExecutions" + EXCLUDED."commandExecutions",
         "apiCalls" = "module_usage_stats"."apiCalls" + EXCLUDED."apiCalls",
         "eventTriggers" = "module_usage_stats"."eventTriggers" + EXCLUDED."eventTriggers",
         "uniqueUsers" = "module_usage_stats"."uniqueUsers" + EXCLUDED."uniqueUsers",
         "updatedAt" = NOW()`,
      ...params,
    ).catch((error) => logger.error('ModuleUsage', `Flush de l'usage des modules en échec (offset ${i}) :`, error));
  }
}

async function flushPerformance(entries: Array<[string, PerfCounters]>): Promise<void> {
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const params: unknown[] = [];
    const tuples = chunk.map(([key, c]) => {
      const [guildId, moduleName, dateKey] = key.split(SEP);
      const base = params.length;
      params.push(crypto.randomUUID(), guildId, moduleName, dateKey, c.executions, c.totalMs / c.executions, c.maxMs, Number.isFinite(c.minMs) ? c.minMs : 0, c.errors);
      return `($${base + 1}::text, $${base + 2}::text, $${base + 3}::text, $${base + 4}::text, $${base + 5}::int, $${base + 6}::float8, $${base + 7}::float8, $${base + 8}::float8, $${base + 9}::int)`;
    });
    // Moyenne pondérée : l'ancienne moyenne pèse ses exécutions, le lot les siennes.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "module_performance_stats" ("id", "guildId", "moduleName", "dateKey", "totalExecutions", "avgExecutionTimeMs", "maxExecutionTimeMs", "minExecutionTimeMs", "errorCount", "successCount", "errorRate", "successRate", "createdAt", "updatedAt")
       SELECT v.id, v."guildId", v."moduleName", v."dateKey", v.n, v.avg, v.max, v.min, v.err, v.n - v.err,
              (v.err::float8 / v.n) * 100, ((v.n - v.err)::float8 / v.n) * 100, NOW(), NOW()
       FROM (VALUES ${tuples.join(', ')}) AS v(id, "guildId", "moduleName", "dateKey", n, avg, max, min, err)
       JOIN "guilds" g ON g."id" = v."guildId"
       ON CONFLICT ("guildId", "moduleName", "dateKey") DO UPDATE SET
         "avgExecutionTimeMs" = ("module_performance_stats"."avgExecutionTimeMs" * "module_performance_stats"."totalExecutions"
                                 + EXCLUDED."avgExecutionTimeMs" * EXCLUDED."totalExecutions")
                                / NULLIF("module_performance_stats"."totalExecutions" + EXCLUDED."totalExecutions", 0),
         "maxExecutionTimeMs" = GREATEST("module_performance_stats"."maxExecutionTimeMs", EXCLUDED."maxExecutionTimeMs"),
         "minExecutionTimeMs" = CASE WHEN "module_performance_stats"."totalExecutions" = 0 THEN EXCLUDED."minExecutionTimeMs"
                                     ELSE LEAST("module_performance_stats"."minExecutionTimeMs", EXCLUDED."minExecutionTimeMs") END,
         "totalExecutions" = "module_performance_stats"."totalExecutions" + EXCLUDED."totalExecutions",
         "errorCount" = "module_performance_stats"."errorCount" + EXCLUDED."errorCount",
         "successCount" = "module_performance_stats"."successCount" + EXCLUDED."successCount",
         "errorRate" = ("module_performance_stats"."errorCount" + EXCLUDED."errorCount")::float8
                       / NULLIF("module_performance_stats"."totalExecutions" + EXCLUDED."totalExecutions", 0) * 100,
         "successRate" = ("module_performance_stats"."successCount" + EXCLUDED."successCount")::float8
                         / NULLIF("module_performance_stats"."totalExecutions" + EXCLUDED."totalExecutions", 0) * 100,
         "updatedAt" = NOW()`,
      ...params,
    ).catch((error) => logger.error('ModuleUsage', `Flush de la performance des modules en échec (offset ${i}) :`, error));
  }
}

let flushInFlight: Promise<void> | null = null;

export async function flushModuleUsage(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  const usage = [...usageBuffer.entries()];
  usageBuffer.clear();
  const perf = [...perfBuffer.entries()];
  perfBuffer.clear();
  flushInFlight = Promise.all([flushUsage(usage), flushPerformance(perf)])
    .then(() => undefined)
    .finally(() => {
      flushInFlight = null;
    });
  return flushInFlight;
}

export function ensureModuleUsageFlusher(): void {
  if (timer) return;
  timer = setInterval(() => void flushModuleUsage(), FLUSH_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  process.on('beforeExit', () => void flushModuleUsage());
}

/** Taille des tampons, pour les tests. */
export function moduleUsageBufferSizes(): { usage: number; perf: number } {
  return { usage: usageBuffer.size, perf: perfBuffer.size };
}
