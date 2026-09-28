import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';

/**
 * Modules sur le parc : activation rapportée au nombre de serveurs, usage
 * cumulé des trois canaux, latence pondérée par le nombre d'exécutions.
 */

function sqlOf(query: unknown): string {
  return Array.isArray(query) ? (query as string[]).join('?') : String(query);
}

const queryRaw = mock((query: unknown) => {
  const sql = sqlOf(query);
  if (sql.includes('"module_performance_stats"')) {
    return Promise.resolve([{ moduleName: 'ticket', executions: 10n, weightedMs: 1500, maxMs: 900.4, errors: 1n }]);
  }
  if (sql.includes('GROUP BY "dateKey"')) return Promise.resolve([{ dateKey: '2026-09-28', usage: 42n }]);
  if (sql.includes('COUNT(DISTINCT "guildId")')) {
    return Promise.resolve([{ moduleName: 'ticket', commands: 30n, apiCalls: 10n, events: 2n, userDays: 12n, guilds: 3n }]);
  }
  // Période précédente.
  return Promise.resolve([{ moduleName: 'ticket', usage: 21n }]);
});

const mockDb = {
  $queryRaw: queryRaw,
  guild: { count: mock(() => Promise.resolve(8)) },
  moduleActivationStat: { groupBy: mock(() => Promise.resolve([{ moduleName: 'ticket', _count: { _all: 4 } }])) },
};

const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { getModuleFleetStats } = await import('../../services/analytics/moduleFleetStatsService');

describe('getModuleFleetStats', () => {
  test('agrège activation, usage et performance par module', async () => {
    const result = await getModuleFleetStats({ from: '2026-09-28', to: '2026-09-28' });
    expect(result.totalGuilds).toBe(8);
    expect(result.daily).toEqual([{ dateKey: '2026-09-28', usage: 42 }]);

    const ticket = result.modules[0]!;
    expect(ticket).toMatchObject({
      module: 'ticket',
      enabledGuilds: 4,
      activationRate: 50,
      usedGuilds: 3,
      totalUsage: 42,
      previousUsage: 21,
      avgExecutionMs: 150,
      maxExecutionMs: 900,
      errorRate: 10,
    });
    // Les modules sans aucune donnée restent listés, à zéro, après ceux qui servent.
    expect(result.modules.find((m) => m.module === 'giveaway')).toMatchObject({ totalUsage: 0, enabledGuilds: 0 });
  });
});
