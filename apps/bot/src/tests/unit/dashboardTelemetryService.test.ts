import { describe, expect, test, mock, beforeEach } from 'bun:test';
import path from 'node:path';

/**
 * Télémétrie du dashboard : le contrat rejette ce qui pourrait identifier
 * quelqu'un ou polluer la base, le tampon cumule par jour × page × événement,
 * et un visiteur n'est jamais écrit avec son ID Discord.
 */

const statCreateMany = mock((_args?: unknown) => Promise.resolve({ count: 0 }));
const visitorCreateMany = mock((_args?: { data: Array<Record<string, string>> }) => Promise.resolve({ count: 0 }));
const statDeleteMany = mock((_args?: unknown) => Promise.resolve({ count: 3 }));
const visitorDeleteMany = mock((_args?: unknown) => Promise.resolve({ count: 2 }));
const executeRawUnsafe = mock((_sql?: string, ..._params: unknown[]) => Promise.resolve(0));
const transaction = mock((ops: unknown[], _options?: unknown) =>
  Promise.all(ops as Promise<unknown>[]).then(() => undefined),
);

const mockDb = {
  dashboardTelemetryDailyStat: { createMany: statCreateMany, deleteMany: statDeleteMany },
  dashboardTelemetryVisitor: { createMany: visitorCreateMany, deleteMany: visitorDeleteMany },
  $executeRawUnsafe: executeRawUnsafe,
  $transaction: transaction,
};

const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { sanitizeTelemetryEntry, latencyBucketFor } = await import('@kotbo/contracts');
const {
  recordTelemetryBatch,
  flushDashboardTelemetry,
  telemetryBufferSizes,
  pruneDashboardTelemetry,
  visitorHashFor,
} = await import('../../services/analytics/dashboardTelemetryService');

const GUILD = '123456789012345678';
const USER = '987654321098765432';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    guildId: GUILD,
    page: '/security/sanctions',
    tab: '',
    feature: 'sanctions',
    event: 'page_view',
    dimension: 'sidebar',
    count: 1,
    valueSum: 0,
    ...overrides,
  };
}

describe('sanitizeTelemetryEntry', () => {
  test('accepte une entrée conforme', () => {
    expect(sanitizeTelemetryEntry(entry())).toEqual(entry() as never);
  });

  test('refuse un événement hors catalogue', () => {
    expect(sanitizeTelemetryEntry(entry({ event: 'keylogger' }))).toBeNull();
  });

  test('refuse un identifiant Discord resté dans le chemin', () => {
    expect(sanitizeTelemetryEntry(entry({ page: `/members/${USER}` }))).toBeNull();
    expect(sanitizeTelemetryEntry(entry({ page: '/members/:id' }))).not.toBeNull();
  });

  test('refuse un guildId malformé et les chaînes libres', () => {
    expect(sanitizeTelemetryEntry(entry({ guildId: 'abc' }))).toBeNull();
    expect(sanitizeTelemetryEntry(entry({ dimension: 'mot de passe' }))).toBeNull();
    expect(sanitizeTelemetryEntry(entry({ page: 'https://evil.example' }))).toBeNull();
  });

  test('borne compteurs et valeurs', () => {
    const clean = sanitizeTelemetryEntry(entry({ event: 'page_time', count: 2, valueSum: 99_999_999 }));
    expect(clean?.valueSum).toBe(2 * 3_600_000);
    expect(sanitizeTelemetryEntry(entry({ count: 0 }))).toBeNull();
    expect(sanitizeTelemetryEntry(entry({ count: -4 }))).toBeNull();
  });

  test('tranches de latence', () => {
    expect(latencyBucketFor(120)).toBe('lt300');
    expect(latencyBucketFor(800)).toBe('300_1000');
    expect(latencyBucketFor(2500)).toBe('1000_3000');
    expect(latencyBucketFor(9000)).toBe('gt3000');
  });
});

describe('dashboardTelemetryService', () => {
  beforeEach(() => {
    statCreateMany.mockClear();
    visitorCreateMany.mockClear();
    executeRawUnsafe.mockClear();
  });

  test('cumule les entrées identiques et compte le visiteur sur ses portées', async () => {
    const now = new Date('2026-09-28T12:00:00Z');
    const view = sanitizeTelemetryEntry(entry())!;
    const time = sanitizeTelemetryEntry(entry({ event: 'page_time', dimension: '', valueSum: 4000 }))!;
    await recordTelemetryBatch(USER, [view, view, time], now);

    // Deux lignes d'agrégat (vue, temps) ; trois portées visiteur (all, page, module).
    expect(telemetryBufferSizes()).toEqual({ stats: 2, visitors: 3 });

    await flushDashboardTelemetry();
    expect(telemetryBufferSizes()).toEqual({ stats: 0, visitors: 0 });

    const update = executeRawUnsafe.mock.calls.find((call) => String(call[0]).includes('dashboard_telemetry_daily_stats'));
    expect(update).toBeDefined();
    // Les deux vues fusionnées : count = 2 dans les paramètres.
    expect(update!.slice(1)).toContain(2);

    const visitors = visitorCreateMany.mock.calls[0]![0]!.data;
    expect(visitors.map((v) => v.scope).sort()).toEqual(['all', 'feature:sanctions', 'page:/security/sanctions']);
    for (const v of visitors) {
      expect(v.visitorHash).not.toContain(USER);
      expect(v.visitorHash).toHaveLength(32);
    }
  });

  test('le hash visiteur est stable sur la journée et change le lendemain', async () => {
    const a = await visitorHashFor(USER, '2026-09-28');
    const b = await visitorHashFor(USER, '2026-09-28');
    const c = await visitorHashFor(USER, '2026-09-29');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test('purge au-delà de 180 jours', async () => {
    await pruneDashboardTelemetry(new Date('2026-09-28T00:00:00Z'));
    expect(statDeleteMany).toHaveBeenCalledWith({ where: { dateKey: { lt: '2026-04-01' } } });
    expect(visitorDeleteMany).toHaveBeenCalledWith({ where: { dateKey: { lt: '2026-04-01' } } });
  });
});
