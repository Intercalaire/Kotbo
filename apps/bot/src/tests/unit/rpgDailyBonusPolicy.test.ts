import { describe, expect, test } from 'bun:test';
import { applyFirstWinBonus, zonedDayStartOf } from '../../services/features/rpg/rpgDailyBonusPolicy.js';

describe('début de journée', () => {
  test('suit le fuseau du serveur en été', () => {
    // 23 h 30 UTC le 14 juillet vaut déjà 1 h 30 le 15 à Paris.
    expect(zonedDayStartOf(new Date('2026-07-14T23:30:00Z'), 'Europe/Paris').toISOString()).toBe('2026-07-14T22:00:00.000Z');
  });

  test('suit le fuseau du serveur en hiver', () => {
    expect(zonedDayStartOf(new Date('2026-01-10T12:00:00Z'), 'Europe/Paris').toISOString()).toBe('2026-01-09T23:00:00.000Z');
  });

  test('en UTC, la journée commence à minuit UTC', () => {
    expect(zonedDayStartOf(new Date('2026-03-05T08:15:00Z'), 'UTC').toISOString()).toBe('2026-03-05T00:00:00.000Z');
  });
});

describe('bonus de première victoire', () => {
  test('majore l\'XP et les pièces de moitié', () => {
    expect(applyFirstWinBonus(100, 41)).toEqual({ xp: 150, coins: 62 });
  });

  test('ne donne rien sur un butin nul', () => {
    expect(applyFirstWinBonus(0, 0)).toEqual({ xp: 0, coins: 0 });
  });
});
