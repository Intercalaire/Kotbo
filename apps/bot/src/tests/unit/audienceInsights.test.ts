import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';

const mockDb = {};
const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { funnelOf, segmentOf } = await import('../../services/analytics/audienceInsightsService');

const at = (key: string) => new Date(`${key}T10:00:00Z`);

describe('funnelOf', () => {
  test('compte chaque étape et le délai médian avant le premier message', () => {
    const arrivals = [
      { userId: 'a', joinedAt: at('2026-08-01'), leftAt: null },
      { userId: 'b', joinedAt: at('2026-08-01'), leftAt: at('2026-08-02') },
      { userId: 'c', joinedAt: at('2026-08-01'), leftAt: null },
    ];
    const active = new Map([
      ['a', ['2026-08-01', '2026-08-09', '2026-09-05']],
      ['c', ['2026-08-04']],
    ]);
    const first = new Map([['a', '2026-08-01'], ['c', '2026-08-04']]);
    const steps = funnelOf(arrivals, active, first, '2026-10-01');
    expect(steps).toEqual({
      joined: 3, stayed: 2, firstMessage: 2,
      eligible7: 3, active7: 1, eligible30: 3, active30: 1,
      medianDaysToFirstMessage: 1.5,
    });
  });

  test('un arrivé trop récent ne pèse pas sur les étapes à 7 et 30 jours', () => {
    const steps = funnelOf([{ userId: 'x', joinedAt: at('2026-09-28'), leftAt: null }], new Map(), new Map(), '2026-10-01');
    expect(steps.eligible7).toBe(0);
    expect(steps.eligible30).toBe(0);
  });
});

describe('segmentOf', () => {
  const w = (a14: number, a28: number, p28: number, gap28: number, older: number) => ({ a14, a28, p28, gap28, older });

  test('un arrivé de moins de 14 jours est nouveau, quoi qu’il fasse', () => {
    expect(segmentOf(w(10, 10, 0, 0, 0), 3)).toBe('new');
  });

  test('revenu après un mois de silence : réactivé', () => {
    expect(segmentOf(w(3, 3, 0, 0, 12), 200)).toBe('reactivated');
  });

  test('moitié moins de jours actifs que le mois d’avant : en baisse', () => {
    expect(segmentOf(w(1, 4, 12, 3, 30), 200)).toBe('declining');
  });

  test('régulier, occasionnel, dormant, silencieux', () => {
    expect(segmentOf(w(5, 10, 9, 6, 40), 200)).toBe('regular');
    expect(segmentOf(w(1, 2, 2, 1, 5), 200)).toBe('casual');
    expect(segmentOf(w(0, 0, 4, 0, 10), 200)).toBe('dormant');
    expect(segmentOf(undefined, 200)).toBe('silent');
  });
});
