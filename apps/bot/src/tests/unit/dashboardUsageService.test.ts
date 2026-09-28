import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';

/**
 * Lecture de la télémétrie : les lignes (page × module × événement ×
 * dimension) se répartissent en pages, modules, répartitions et santé ; les
 * événements de session n'alourdissent aucune page.
 */

function sqlOf(query: unknown): string {
  const q = query as { strings?: string[]; sql?: string } | TemplateStringsArray;
  if (Array.isArray(q)) return q.join('?');
  return (q as { strings?: string[] }).strings?.join('?') ?? (q as { sql?: string }).sql ?? String(query);
}

const queryRaw = mock((query: unknown, ..._values: unknown[]) => {
  const sql = sqlOf(query);
  if (sql.includes('GROUP BY "page", "feature", "event", "dimension"')) {
    return Promise.resolve([
      { page: '/security/sanctions', feature: 'sanctions', event: 'page_view', dimension: 'sidebar', count: 8n, valueSum: 0n },
      { page: '/security/sanctions', feature: 'sanctions', event: 'page_view', dimension: 'palette', count: 2n, valueSum: 0n },
      { page: '/security/sanctions', feature: 'sanctions', event: 'page_time', dimension: '', count: 10n, valueSum: 600000n },
      { page: '/security/sanctions', feature: 'sanctions', event: 'save', dimension: 'post', count: 3n, valueSum: 0n },
      { page: '/security/sanctions/appeals', feature: 'sanctions', event: 'page_view', dimension: 'link', count: 1n, valueSum: 0n },
      { page: '/leveling', feature: 'leveling', event: 'page_view', dimension: 'entry', count: 4n, valueSum: 0n },
      { page: '/leveling', feature: 'leveling', event: 'api_latency', dimension: 'gt3000', count: 1n, valueSum: 4000n },
      { page: '/leveling', feature: 'leveling', event: 'api_latency', dimension: 'lt300', count: 3n, valueSum: 300n },
      { page: '/', feature: 'dashboard', event: 'session_start', dimension: 'mobile', count: 5n, valueSum: 0n },
    ]);
  }
  if (sql.includes('GROUP BY "scope"')) {
    return Promise.resolve([
      { scope: 'all', visitors: 6n },
      { scope: 'page:/security/sanctions', visitors: 4n },
      { scope: 'feature:sanctions', visitors: 5n },
    ]);
  }
  if (sql.includes('AS "key"') && sql.includes('GROUP BY "page"')) return Promise.resolve([{ key: '/security/sanctions', guilds: 2n }]);
  if (sql.includes('AS "key"') && sql.includes('GROUP BY "feature"')) return Promise.resolve([{ key: 'sanctions', guilds: 2n }]);
  if (sql.includes("'tab_view'")) return Promise.resolve([{ page: '/security/sanctions', tab: 'history', views: 3n }]);
  if (sql.includes('GROUP BY "dateKey", "event"')) return Promise.resolve([{ dateKey: '2026-09-28', event: 'page_view', count: 15n }]);
  if (sql.includes('GROUP BY "dateKey"')) return Promise.resolve([{ dateKey: '2026-09-28', visitors: 6n }]);
  if (sql.includes('GROUP BY "event"')) {
    return Promise.resolve([
      { event: 'page_view', count: 15n, valueSum: 0n },
      { event: 'session_start', count: 5n, valueSum: 0n },
    ]);
  }
  if (sql.includes('"visitors"')) return Promise.resolve([{ visitors: 6n }]);
  if (sql.includes('"guilds"')) return Promise.resolve([{ guilds: 2n }]);
  return Promise.resolve([]);
});

const mockDb = { $queryRaw: queryRaw };
const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { getDashboardUsage, resolveUsageRange } = await import('../../services/analytics/dashboardUsageService');

describe('resolveUsageRange', () => {
  test('30 jours par défaut, bornes incluses', () => {
    const range = resolveUsageRange(null, null, new Date('2026-09-28T10:00:00Z'));
    expect(range).toEqual({ fromKey: '2026-08-30', toKey: '2026-09-28', days: 30 });
  });
});

describe('getDashboardUsage', () => {
  test('répartit les agrégats en pages, modules, répartitions et santé', async () => {
    const usage = await getDashboardUsage({ from: '2026-09-28', to: '2026-09-28', compare: true });

    expect(usage.totals.views).toBe(15);
    expect(usage.totals.sessions).toBe(5);
    expect(usage.totals.visitorDays).toBe(6);
    expect(usage.previousTotals).not.toBeNull();

    const sanctions = usage.pages.find((p) => p.page === '/security/sanctions')!;
    expect(sanctions).toMatchObject({ views: 10, saves: 3, activeMs: 600000, timeSamples: 10, visitorDays: 4, guilds: 2, feature: 'sanctions' });
    // Le tri suit les vues ; la page d'accueil n'a que des événements de session et n'apparaît pas.
    expect(usage.pages.map((p) => p.page)).toEqual(['/security/sanctions', '/leveling', '/security/sanctions/appeals']);

    const feature = usage.features.find((f) => f.feature === 'sanctions')!;
    expect(feature).toMatchObject({ views: 11, pages: 2, visitorDays: 5 });

    expect(usage.dimensions).toContainEqual({ event: 'session_start', dimension: 'mobile', count: 5, valueSum: 0 });
    expect(usage.dimensions).toContainEqual({ event: 'page_view', dimension: 'sidebar', count: 8, valueSum: 0 });

    const leveling = usage.health.find((h) => h.page === '/leveling')!;
    expect(leveling).toMatchObject({ latencySamples: 4, latencyMs: 4300, slowShare: 25 });

    expect(usage.tabs).toEqual([{ page: '/security/sanctions', tab: 'history', views: 3 }]);
    expect(usage.daily).toEqual([{ dateKey: '2026-09-28', views: 15, visitorDays: 6, sessions: 0, saves: 0 }]);
  });
});
