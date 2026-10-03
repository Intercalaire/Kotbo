import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';

const mockDb = {};
const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { ResponseTracker, delayBucket, RESPONSE_WINDOW_MS } = await import('../../services/analytics/conversationStatsService');

const T0 = Date.parse('2026-10-03T10:00:00Z');
const MIN = 60_000;

describe('ResponseTracker', () => {
  test('un autre membre qui écrit répond au tour en cours', () => {
    const t = new ResponseTracker();
    expect(t.onMessage('g', 'c', 'c', 'alice', T0)).toEqual([]);
    expect(t.onMessage('g', 'c', 'c', 'bob', T0 + 3 * MIN)).toEqual([
      { kind: 'answered', guildId: 'g', statsChannelId: 'c', dateKey: '2026-10-03', delaySec: 180 },
    ]);
  });

  test('les messages enchaînés par le même membre prolongent son tour', () => {
    const t = new ResponseTracker();
    t.onMessage('g', 'c', 'c', 'alice', T0);
    expect(t.onMessage('g', 'c', 'c', 'alice', T0 + MIN)).toEqual([]);
    const [event] = t.onMessage('g', 'c', 'c', 'bob', T0 + 2 * MIN);
    expect(event).toMatchObject({ kind: 'answered', delaySec: 120 });
  });

  test('une réponse après six heures ne compte pas : le tour reste sans réponse', () => {
    const t = new ResponseTracker();
    t.onMessage('g', 'c', 'c', 'alice', T0);
    const [event] = t.onMessage('g', 'c', 'c', 'bob', T0 + RESPONSE_WINDOW_MS + MIN);
    expect(event?.kind).toBe('unanswered');
  });

  test('le balayage clôt les tours expirés', () => {
    const t = new ResponseTracker();
    t.onMessage('g', 'c1', 'c1', 'alice', T0);
    t.onMessage('g', 'c2', 'c2', 'bob', T0 + 5 * 3600_000);
    const events = t.sweep(T0 + RESPONSE_WINDOW_MS + MIN);
    expect(events).toEqual([{ kind: 'unanswered', guildId: 'g', statsChannelId: 'c1', dateKey: '2026-10-03' }]);
    expect(t.size).toBe(1);
  });

  test('un fil est suivi à part mais rangé sous son salon', () => {
    const t = new ResponseTracker();
    t.onMessage('g', 'thread', 'parent', 'alice', T0);
    t.onMessage('g', 'parent', 'parent', 'bob', T0 + MIN);
    const [event] = t.onMessage('g', 'thread', 'parent', 'carol', T0 + 2 * MIN);
    expect(event).toMatchObject({ kind: 'answered', statsChannelId: 'parent', delaySec: 120 });
  });
});

describe('delayBucket', () => {
  test('range les délais par tranches', () => {
    expect([30, 120, 600, 1800, 7200].map(delayBucket)).toEqual(['under1m', 'under5m', 'under15m', 'under1h', 'under6h']);
  });
});
