import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_STREAK_CONFIG,
  computeStreakUpdate,
  isStreakAlive,
  rankedDayKey,
  rankedDaysBetween,
  streakFlames,
  streakMultiplier,
  type StreakState,
} from '@kotbo/shared';

const NO_GRACE = { ...DEFAULT_STREAK_CONFIG, graceDays: 0 };

function state(partial: Partial<StreakState> = {}): StreakState {
  return { streakDays: 0, bestStreak: 0, lastActiveDate: null, freezes: 0, ...partial };
}

describe('rankedDayKey / rankedDaysBetween', () => {
  test('produit une cle de jour UTC comparable lexicographiquement', () => {
    expect(rankedDayKey(new Date('2026-08-13T23:59:59.000Z'))).toBe('2026-08-13');
    expect(rankedDayKey(new Date('2026-08-14T00:00:00.000Z'))).toBe('2026-08-14');
    expect('2026-08-13' < '2026-08-14').toBe(true);
  });

  test('compte les jours entre deux cles', () => {
    expect(rankedDaysBetween('2026-08-10', '2026-08-13')).toBe(3);
    expect(rankedDaysBetween('2026-08-13', '2026-08-13')).toBe(0);
  });

  test('renvoie null plutot qu un NaN pour une cle absente ou illisible', () => {
    expect(rankedDaysBetween(null, '2026-08-13')).toBeNull();
    expect(rankedDaysBetween('pas-une-date', '2026-08-13')).toBeNull();
  });
});

describe('computeStreakUpdate', () => {
  test('demarre la serie a 1 a la premiere activite connue', () => {
    const update = computeStreakUpdate(state(), '2026-08-13');
    expect(update.streakDays).toBe(1);
    expect(update.extended).toBe(true);
    expect(update.lastActiveDate).toBe('2026-08-13');
  });

  test('est idempotente dans la journee : elle tourne a chaque message', () => {
    const update = computeStreakUpdate(
      state({ streakDays: 4, bestStreak: 9, lastActiveDate: '2026-08-13' }),
      '2026-08-13',
    );
    expect(update.streakDays).toBe(4);
    expect(update.extended).toBe(false);
  });

  test('avance d un cran le lendemain', () => {
    const update = computeStreakUpdate(
      state({ streakDays: 4, bestStreak: 4, lastActiveDate: '2026-08-12' }),
      '2026-08-13',
    );
    expect(update.streakDays).toBe(5);
    expect(update.bestStreak).toBe(5);
    expect(update.broken).toBe(false);
  });

  test('casse la serie apres un jour manque sans gel disponible', () => {
    const update = computeStreakUpdate(
      state({ streakDays: 12, bestStreak: 12, lastActiveDate: '2026-08-11', freezes: 0 }),
      '2026-08-13',
    );
    expect(update.streakDays).toBe(1);
    expect(update.broken).toBe(true);
    // Le record survit a la rupture : c'est le seul repere qui reste au membre.
    expect(update.bestStreak).toBe(12);
  });

  test('un gel sauve la serie et est bien depense', () => {
    const update = computeStreakUpdate(
      state({ streakDays: 12, bestStreak: 12, lastActiveDate: '2026-08-11', freezes: 2 }),
      '2026-08-13',
      { ...DEFAULT_STREAK_CONFIG, graceDays: 1 },
    );
    expect(update.streakDays).toBe(13);
    expect(update.broken).toBe(false);
    expect(update.freezesSpent).toBe(1);
    expect(update.freezes).toBe(1);
  });

  test('une absence plus longue que la tolerance casse la serie meme avec des gels', () => {
    const update = computeStreakUpdate(
      state({ streakDays: 30, bestStreak: 30, lastActiveDate: '2026-08-05', freezes: 5 }),
      '2026-08-13',
      { ...DEFAULT_STREAK_CONFIG, graceDays: 1 },
    );
    expect(update.streakDays).toBe(1);
    expect(update.broken).toBe(true);
    expect(update.freezes).toBe(5);
  });

  test('une date future ne donne pas de cran gratuit (horloge decalee, restauration)', () => {
    const update = computeStreakUpdate(
      state({ streakDays: 3, bestStreak: 3, lastActiveDate: '2026-08-20' }),
      '2026-08-13',
    );
    expect(update.streakDays).toBe(3);
    expect(update.extended).toBe(false);
  });

  test('sans tolerance, un seul jour manque suffit a casser', () => {
    const update = computeStreakUpdate(
      state({ streakDays: 8, bestStreak: 8, lastActiveDate: '2026-08-11', freezes: 3 }),
      '2026-08-13',
      NO_GRACE,
    );
    expect(update.streakDays).toBe(1);
    expect(update.freezes).toBe(3);
  });
});

describe('streakMultiplier', () => {
  test('le premier jour ne donne aucun bonus', () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(1)).toBe(1);
  });

  test('progresse par jour puis plafonne', () => {
    expect(streakMultiplier(3, { graceDays: 0, bonusPerDay: 0.05, maxBonus: 0.5 })).toBeCloseTo(1.1, 5);
    expect(streakMultiplier(1000, { graceDays: 0, bonusPerDay: 0.05, maxBonus: 0.5 })).toBeCloseTo(1.5, 5);
  });

  test('un bonus desactive laisse le multiplicateur neutre', () => {
    expect(streakMultiplier(50, { graceDays: 0, bonusPerDay: 0, maxBonus: 0 })).toBe(1);
  });
});

describe('streakFlames', () => {
  test('monte par paliers et sature a 5', () => {
    expect(streakFlames(1)).toBe(0);
    expect(streakFlames(3)).toBe(1);
    expect(streakFlames(7)).toBe(2);
    expect(streakFlames(14)).toBe(3);
    expect(streakFlames(30)).toBe(4);
    expect(streakFlames(365)).toBe(5);
  });
});

describe('isStreakAlive', () => {
  test('une serie active hier ou aujourd hui est vivante', () => {
    expect(isStreakAlive('2026-08-13', '2026-08-13')).toBe(true);
    expect(isStreakAlive('2026-08-12', '2026-08-13')).toBe(true);
  });

  test('la tolerance prolonge la fenetre d affichage', () => {
    expect(isStreakAlive('2026-08-11', '2026-08-13', NO_GRACE)).toBe(false);
    expect(isStreakAlive('2026-08-11', '2026-08-13', { ...DEFAULT_STREAK_CONFIG, graceDays: 1 })).toBe(true);
  });

  test('sans activite connue, la serie est eteinte', () => {
    expect(isStreakAlive(null, '2026-08-13')).toBe(false);
  });
});
