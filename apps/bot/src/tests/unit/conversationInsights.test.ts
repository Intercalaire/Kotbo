import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';

const mockDb = {};
const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { medianFromBuckets, gini, concentrationOf, channelHealth, communities } = await import('../../services/analytics/conversationInsightsService');

const counts = (o: Partial<Record<string, number>>) => ({ answered: 0, unanswered: 0, delaySumSec: 0, under1m: 0, under5m: 0, under15m: 0, under1h: 0, under6h: 0, ...o });

describe('medianFromBuckets', () => {
  test('interpole dans la tranche qui contient la médiane', () => {
    // 10 réponses : 4 sous la minute, 6 entre 1 et 5 min → médiane à 1/6 de la 2e tranche.
    expect(medianFromBuckets(counts({ under1m: 4, under5m: 6 }))).toBe(100);
  });

  test('rien de répondu : pas de médiane', () => {
    expect(medianFromBuckets(counts({ unanswered: 3 }))).toBeNull();
  });
});

describe('gini et concentration', () => {
  test('tout le monde pareil : 0 ; un seul qui parle beaucoup : proche de 1', () => {
    expect(gini([5, 5, 5, 5])).toBe(0);
    expect(gini([1, 1, 1, 1, 1, 1, 1, 1, 1, 1000])).toBeGreaterThan(0.85);
  });

  test('part des plus actifs et nombre de membres pour la moitié', () => {
    const c = concentrationOf([50, 30, 10, 5, 5]);
    expect(c.top10Share).toBe(50);
    expect(c.membersForHalf).toBe(1);
    expect(c.lorenz[0]).toEqual({ members: 0, activity: 0 });
    expect(c.lorenz[20]).toEqual({ members: 100, activity: 100 });
  });
});

describe('channelHealth', () => {
  const base = { messages: 300, prevMessages: 280, authors: 12, days: 30, lastActiveDaysAgo: 0, medianResponseSec: 120, unansweredRate: 10 };

  test('un salon muet depuis plus d’un mois est mort, à archiver', () => {
    expect(channelHealth({ ...base, messages: 0, prevMessages: 0, lastActiveDaysAgo: 60 })).toMatchObject({ status: 'dead', score: 0, suggestion: 'archive' });
  });

  test('une chute de moitié est un déclin, à relancer', () => {
    expect(channelHealth({ ...base, messages: 100, prevMessages: 300 })).toMatchObject({ status: 'declining', suggestion: 'revive' });
  });

  test('un salon très chargé avec beaucoup d’auteurs est saturé, à découper', () => {
    expect(channelHealth({ ...base, messages: 12_000, prevMessages: 11_000, authors: 60 })).toMatchObject({ status: 'saturated', suggestion: 'split' });
  });

  test('un salon régulier est sain, avec un score correct', () => {
    const h = channelHealth(base);
    expect(h.status).toBe('healthy');
    expect(h.score).toBeGreaterThan(40);
  });
});

describe('communities', () => {
  test('deux groupes reliés par un seul lien faible restent séparés', () => {
    const e = (a: string, b: string, weight: number) => ({ a, b, weight, replies: 0, mentions: 0, ab: 0, ba: 0 });
    const label = communities(['a', 'b', 'c', 'x', 'y', 'z'], [
      e('a', 'b', 10), e('b', 'c', 10), e('a', 'c', 10),
      e('x', 'y', 10), e('y', 'z', 10), e('x', 'z', 10),
      e('c', 'x', 1),
    ]);
    expect(label.get('a')).toBe(label.get('b'));
    expect(label.get('b')).toBe(label.get('c'));
    expect(label.get('x')).toBe(label.get('z'));
    expect(label.get('a')).not.toBe(label.get('x'));
  });
});
