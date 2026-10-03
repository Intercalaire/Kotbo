import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';

const mockDb = {};
const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { median, tenureBucket, wordTrends } = await import('../../services/analytics/sectionInsightsService');

describe('tenureBucket', () => {
  test('range une ancienneté en jours', () => {
    expect([0.5, 3, 20, 100, 400].map(tenureBucket)).toEqual(['under1d', 'under7d', 'under30d', 'under180d', 'over180d']);
  });
});

describe('median', () => {
  test('pair, impair, vide', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('wordTrends', () => {
  test('un mot qui gagne de la place monte, celui qui en perd baisse', () => {
    const prev = new Map([['tournoi', 10], ['salut', 100]]);
    const cur = new Map([['tournoi', 60], ['salut', 120]]);
    const t = wordTrends(cur, prev);
    expect(t.rising.map((r) => r.word)).toEqual(['tournoi']);
    expect(t.falling.map((r) => r.word)).toEqual(['salut']);
  });

  test('un mot absent avant est nouveau, pas en hausse', () => {
    const t = wordTrends(new Map([['patch', 12], ['salut', 50]]), new Map([['salut', 50]]));
    expect(t.fresh.map((r) => r.word)).toEqual(['patch']);
    expect(t.rising).toEqual([]);
  });

  test('les mots rares sont ignorés', () => {
    const t = wordTrends(new Map([['rare', 3]]), new Map([['rare', 1]]));
    expect(t.rising).toEqual([]);
  });
});
