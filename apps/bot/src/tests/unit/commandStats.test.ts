import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';

const mockDb = {};
const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { commandLabel } = await import('../../services/analytics/commandStatsService');

describe('commandLabel', () => {
  test('commande, groupe et sous-commande, dans l’ordre', () => {
    expect(commandLabel('rank', null, null)).toBe('rank');
    expect(commandLabel('ticket', null, 'ouvrir')).toBe('ticket ouvrir');
    expect(commandLabel('config', 'logs', 'salon')).toBe('config logs salon');
  });
});
