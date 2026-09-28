import { describe, expect, test, mock, beforeEach } from 'bun:test';
import path from 'node:path';

/**
 * Tampon d'usage des modules : les exécutions s'additionnent en mémoire, un
 * membre ne compte qu'une fois par jour, et le vidage tient en une requête
 * par table. Un serveur sans consentement analytics ne donne que la
 * performance.
 */

const executeRawUnsafe = mock((_sql?: string, ..._params: unknown[]) => Promise.resolve(0));
const mockDb = { $executeRawUnsafe: executeRawUnsafe };
const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const consent = mock((guildId: string) => Promise.resolve(guildId !== 'optout'));
const consentPath = path.resolve(import.meta.dir, '../../services/analytics/analyticsConsent.ts');
const consentJsPath = path.resolve(import.meta.dir, '../../services/analytics/analyticsConsent.js');
mock.module(consentPath, () => ({ isAnalyticsCollectionEnabled: consent }));
mock.module(consentJsPath, () => ({ isAnalyticsCollectionEnabled: consent }));

const { recordModuleExecution, flushModuleUsage, moduleUsageBufferSizes } = await import('../../services/analytics/moduleUsageBuffer');

describe('moduleUsageBuffer', () => {
  beforeEach(() => executeRawUnsafe.mockClear());

  test('cumule, compte chaque membre une fois, vide en une requête par table', async () => {
    await recordModuleExecution({ guildId: 'g1', moduleName: 'ticket', actionType: 'command', userId: 'u1', durationMs: 100, success: true });
    await recordModuleExecution({ guildId: 'g1', moduleName: 'ticket', actionType: 'command', userId: 'u1', durationMs: 300, success: false });
    await recordModuleExecution({ guildId: 'g1', moduleName: 'ticket', actionType: 'command', userId: 'u2', durationMs: 200, success: true });
    expect(moduleUsageBufferSizes()).toEqual({ usage: 1, perf: 1 });

    await flushModuleUsage();
    expect(moduleUsageBufferSizes()).toEqual({ usage: 0, perf: 0 });
    expect(executeRawUnsafe).toHaveBeenCalledTimes(2);

    const usageCall = executeRawUnsafe.mock.calls.find((c) => String(c[0]).includes('"module_usage_stats"'))!;
    // id, guild, module, date, commandes, api, événements, nouveaux membres
    expect(usageCall.slice(2)).toEqual(['g1', 'ticket', expect.any(String), 3, 0, 0, 2]);

    const perfCall = executeRawUnsafe.mock.calls.find((c) => String(c[0]).includes('"module_performance_stats"'))!;
    // exécutions, moyenne, max, min, erreurs
    expect(perfCall.slice(5)).toEqual([3, 200, 300, 100, 1]);
  });

  test('sans consentement : performance seule', async () => {
    await recordModuleExecution({ guildId: 'optout', moduleName: 'giveaway', actionType: 'command', userId: 'u1', durationMs: 50, success: true });
    expect(moduleUsageBufferSizes()).toEqual({ usage: 0, perf: 1 });
    await flushModuleUsage();
  });
});
