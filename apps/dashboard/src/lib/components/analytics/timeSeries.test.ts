import { describe, expect, test } from 'bun:test';
import {
  aggregate,
  bucketDays,
  daysLeftInMonth,
  forecast,
  movingAverage,
  resolveGranularity,
  trendPct,
  weekStart,
} from './timeSeries';

function days(start: string, count: number): string[] {
  const t = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(t + i * 86_400_000).toISOString().slice(0, 10));
}

describe('resolveGranularity', () => {
  test('auto : l’heure sur 24 h quand elle existe, le jour jusqu’à trois mois, la semaine au-delà', () => {
    expect(resolveGranularity('auto', 1, true)).toBe('hour');
    expect(resolveGranularity('auto', 1, false)).toBe('day');
    expect(resolveGranularity('auto', 30, true)).toBe('day');
    expect(resolveGranularity('auto', 365, false)).toBe('week');
  });

  test('l’heure demandée sans données horaires retombe sur le jour', () => {
    expect(resolveGranularity('hour', 7, false)).toBe('day');
  });
});

describe('bucketDays', () => {
  test('les semaines commencent le lundi et signalent les bouts incomplets', () => {
    // 2026-09-30 est un mercredi.
    const buckets = bucketDays(days('2026-09-30', 10), 'week');
    expect(buckets.map((b) => b.key)).toEqual(['2026-09-28', '2026-10-05']);
    expect(buckets.map((b) => b.indices.length)).toEqual([5, 5]);
    expect(buckets.every((b) => b.partial)).toBe(true);
  });

  test('les mois regroupent par mois civil', () => {
    const buckets = bucketDays(days('2026-09-01', 45), 'month');
    expect(buckets.map((b) => b.key)).toEqual(['2026-09-01', '2026-10-01']);
    expect(buckets[0]!.partial).toBe(false);
    expect(buckets[1]!.partial).toBe(true);
  });

  test('weekStart d’un dimanche est le lundi d’avant', () => {
    expect(weekStart('2026-10-04')).toBe('2026-09-28');
  });
});

describe('aggregate', () => {
  test('somme les messages, moyenne les effectifs', () => {
    const buckets = bucketDays(days('2026-09-28', 7), 'week');
    expect(aggregate([1, 2, 3, 4, 5, 6, 7], buckets, 'sum')).toEqual([28]);
    expect(aggregate([1, 2, 3, 4, 5, 6, 7], buckets, 'avg')).toEqual([4]);
  });
});

describe('movingAverage', () => {
  test('moyenne arrière sur la fenêtre disponible', () => {
    expect(movingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
  });
});

describe('trendPct', () => {
  test('compare la fin au début de la période', () => {
    expect(trendPct([10, 10, 10, 20, 20, 20])).toBe(100);
  });

  test('pas de verdict sur trop peu de points', () => {
    expect(trendPct([1, 2])).toBeNull();
  });
});

describe('forecast', () => {
  test('reproduit le rythme de la semaine quand rien ne bouge', () => {
    const pattern = [10, 20, 30, 40, 50, 5, 5];
    const daily = Array.from({ length: 35 }, (_, i) => pattern[i % 7]!);
    const out = forecast(daily, days('2026-08-01', 35), 7)!;
    expect(out.values).toEqual([pattern[0], pattern[1], pattern[2], pattern[3], pattern[4], pattern[5], pattern[6]]);
    expect(out.dates[0]).toBe('2026-09-05');
    expect(out.low).toEqual(out.values);
  });

  test('refuse de prévoir avec moins de quatre semaines', () => {
    expect(forecast([1, 2, 3], days('2026-09-01', 3), 7)).toBeNull();
  });

  test('ne prévoit jamais de valeur négative', () => {
    const daily = Array.from({ length: 28 }, (_, i) => (i % 2 ? 100 : 0));
    const out = forecast(daily, days('2026-09-01', 28), 3)!;
    expect(out.low.every((v) => v >= 0)).toBe(true);
  });
});

describe('daysLeftInMonth', () => {
  test('compte les jours après la date', () => {
    expect(daysLeftInMonth('2026-10-03')).toBe(28);
    expect(daysLeftInMonth('2026-02-28')).toBe(0);
  });
});
