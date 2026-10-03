import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';

const mockDb = {};
const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { accountAgeBucket, sourceKindOf } = await import('../../services/analytics/memberOverviewService');

describe('memberOverview', () => {
  test('âge du compte à l’arrivée', () => {
    expect([0.2, 3, 20, 200, 900].map(accountAgeBucket)).toEqual(['under1d', 'under7d', 'under30d', 'under365d', 'over365d']);
  });

  test('type de source d’une arrivée', () => {
    expect(sourceKindOf(null, 'nova', false)).toBe('unknown');
    expect(sourceKindOf('nova', 'nova', false)).toBe('vanity');
    expect(sourceKindOf('abc', 'nova', true)).toBe('label');
    expect(sourceKindOf('abc', null, false)).toBe('invite');
  });
});
