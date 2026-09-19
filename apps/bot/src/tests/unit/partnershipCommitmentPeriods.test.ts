import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { mock } from 'bun:test';

// Le service touche Prisma au chargement. Seules les bornes de période sont
// testées ici : c'est du calendrier pur, et c'est ce qui décide si un
// engagement est tenu ou manqué.
const noop = mock(() => Promise.resolve(null));
const mockDb = new Proxy(
  {},
  {
    get: () =>
      new Proxy(
        {},
        { get: () => noop },
      ),
  },
);

for (const dbPath of ['../../utils/db.ts', '../../utils/db.js']) {
  mock.module(path.resolve(__dirname, dbPath), () => ({
    default: mockDb,
    prisma: mockDb,
    prismaRead: mockDb,
  }));
}

const { currentPeriod } = await import('../../services/partnerships/partnershipCommitmentService.js');

describe('bornes de période des engagements', () => {
  test('la période du jour couvre exactement vingt-quatre heures', () => {
    const { start, end } = currentPeriod('day', null);
    expect(start.getHours()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(24 * 3_600_000);
  });

  test('la semaine commence le lundi', () => {
    const { start, end } = currentPeriod('week', null);
    // `getDay()` renvoie 1 pour lundi. Sans le décalage, une semaine aurait
    // commencé le dimanche et les relevés auraient été décalés d'un jour.
    expect(start.getDay()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(Math.round((end.getTime() - start.getTime()) / 3_600_000)).toBeGreaterThanOrEqual(24 * 7 - 1);
  });

  test('le mois va du premier au premier', () => {
    const { start, end } = currentPeriod('month', null);
    expect(start.getDate()).toBe(1);
    expect(end.getDate()).toBe(1);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  test('le cumul total part du début du partenariat', () => {
    const startedAt = new Date('2026-01-15T10:00:00Z');
    const { start, end } = currentPeriod('total', startedAt);
    expect(start.getTime()).toBe(startedAt.getTime());
    expect(end.getTime()).toBeGreaterThan(Date.now());
  });

  test('un cumul sans date de début ne remonte pas avant le début de l\'année', () => {
    const { start } = currentPeriod('total', null);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
  });

  test('une période inconnue est traitée comme un cumul, jamais comme une erreur', () => {
    const { start, end } = currentPeriod('trimestre', null);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  test('toutes les périodes encadrent l\'instant présent', () => {
    for (const period of ['day', 'week', 'month', 'total']) {
      const { start, end } = currentPeriod(period, new Date('2026-01-01T00:00:00Z'));
      expect(start.getTime()).toBeLessThanOrEqual(Date.now());
      expect(end.getTime()).toBeGreaterThan(Date.now());
    }
  });
});
