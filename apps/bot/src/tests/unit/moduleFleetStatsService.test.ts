import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';

/**
 * Modules sur le parc : activation rapportée au nombre de serveurs, usage
 * cumulé des trois canaux, latence pondérée par le nombre d'exécutions, et
 * l'ancien vocabulaire (`ticket`) replié sur la clé du registre (`tickets`)
 * sans compter deux fois un même serveur.
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
  if (sql.includes('GROUP BY "moduleName", "guildId"')) {
    return Promise.resolve([
      // Le même serveur sous l'ancien et le nouveau nom : un seul serveur utilisateur.
      { moduleName: 'ticket', guildId: 'g1', commands: 20n, apiCalls: 10n, events: 0n, userDays: 8n },
      { moduleName: 'tickets', guildId: 'g1', commands: 10n, apiCalls: 0n, events: 2n, userDays: 4n },
      { moduleName: 'tickets', guildId: 'g2', commands: 0n, apiCalls: 0n, events: 0n, userDays: 0n },
      { moduleName: 'core', guildId: 'g1', commands: 5n, apiCalls: 0n, events: 0n, userDays: 1n },
    ]);
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

const resolveModuleKey = (name: string) => ({ ticket: 'tickets', tickets: 'tickets' } as Record<string, string>)[name];
const activationPath = path.resolve(import.meta.dir, '../../services/core/moduleActivationService.ts');
const activationJsPath = path.resolve(import.meta.dir, '../../services/core/moduleActivationService.js');
mock.module(activationPath, () => ({ resolveModuleKey }));
mock.module(activationJsPath, () => ({ resolveModuleKey }));

const { getModuleFleetStats } = await import('../../services/analytics/moduleFleetStatsService');

describe('getModuleFleetStats', () => {
  test('replie les deux vocabulaires et agrège activation, usage et performance', async () => {
    const result = await getModuleFleetStats({ from: '2026-09-28', to: '2026-09-28' });
    expect(result.totalGuilds).toBe(8);
    expect(result.daily).toEqual([{ dateKey: '2026-09-28', usage: 42 }]);

    const tickets = result.modules[0]!;
    expect(tickets).toMatchObject({
      module: 'tickets',
      enabledGuilds: 4,
      activationRate: 50,
      usedGuilds: 2,
      commands: 30,
      totalUsage: 42,
      previousUsage: 21,
      userDays: 12,
      avgExecutionMs: 150,
      maxExecutionMs: 900,
      errorRate: 10,
    });
    expect(result.modules.find((m) => m.module === 'ticket')).toBeUndefined();
    expect(result.modules.find((m) => m.module === 'core')).toMatchObject({ commands: 5 });
  });
});
