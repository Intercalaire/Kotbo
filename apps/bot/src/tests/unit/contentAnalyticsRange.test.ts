import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';

const mockDb = {};
const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { parseRange } = await import('../../services/analytics/contentAnalyticsService');

const NOW = new Date('2026-09-28T15:00:00Z');

describe('parseRange', () => {
  test('30 jours se terminent aujourd’hui, la période d’avant les précède sans chevauchement', () => {
    const range = parseRange(new URLSearchParams('period=30'), NOW);
    expect(range).toEqual({ start: '2026-08-30', end: '2026-09-28', prevStart: '2026-07-31', prevEnd: '2026-08-29', days: 30 });
  });

  test('24 h couvre la seule journée en cours', () => {
    const range = parseRange(new URLSearchParams('period=1'), NOW);
    expect(range).toMatchObject({ start: '2026-09-28', end: '2026-09-28', prevStart: '2026-09-27', prevEnd: '2026-09-27', days: 1 });
  });

  test('bornes personnalisées remises dans l’ordre', () => {
    const range = parseRange(new URLSearchParams('startDate=2026-09-10T08:00&endDate=2026-09-01T10:00'), NOW);
    expect(range).toMatchObject({ start: '2026-09-01', end: '2026-09-10', days: 10, prevStart: '2026-08-22', prevEnd: '2026-08-31' });
  });

  test('période invalide ou excessive ramenée dans les bornes', () => {
    expect(parseRange(new URLSearchParams('period=abc'), NOW).days).toBe(30);
    expect(parseRange(new URLSearchParams('period=9999'), NOW).days).toBe(365);
  });
});
