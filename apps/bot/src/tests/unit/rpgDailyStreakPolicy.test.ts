import { describe, expect, test } from 'bun:test';
import {
  applyDailyStreak,
  dailyStreakBonus,
  DAILY_STREAK_GRACE_MS,
  nextDailyStreak,
} from '../../services/features/rpg/rpgDailyStreakPolicy.js';

const HOUR = 60 * 60 * 1000;
const COOLDOWN = 20 * HOUR;
const now = new Date('2026-09-24T20:00:00Z');

describe('série du daily', () => {
  test('commence à 1 pour une première réclamation', () => {
    expect(nextDailyStreak(null, 0, now, COOLDOWN)).toBe(1);
  });

  test('continue quand la réclamation précédente date de la veille', () => {
    expect(nextDailyStreak(new Date(now.getTime() - 24 * HOUR), 3, now, COOLDOWN)).toBe(4);
  });

  test('pardonne un retard tant qu\'il reste dans la marge', () => {
    const last = new Date(now.getTime() - COOLDOWN - DAILY_STREAK_GRACE_MS);
    expect(nextDailyStreak(last, 5, now, COOLDOWN)).toBe(6);
  });

  test('repart à 1 après un jour manqué', () => {
    const last = new Date(now.getTime() - COOLDOWN - DAILY_STREAK_GRACE_MS - 1);
    expect(nextDailyStreak(last, 9, now, COOLDOWN)).toBe(1);
  });
});

describe('bonus de série', () => {
  test('rien le premier jour, +10 % par jour ensuite', () => {
    expect(dailyStreakBonus(1)).toBe(0);
    expect(dailyStreakBonus(2)).toBe(0.1);
    expect(dailyStreakBonus(5)).toBe(0.4);
  });

  test('plafonne à +100 %', () => {
    expect(dailyStreakBonus(11)).toBe(1);
    expect(dailyStreakBonus(365)).toBe(1);
  });

  test('majore la récompense et arrondit à l\'unité inférieure', () => {
    expect(applyDailyStreak(100, 1)).toBe(100);
    expect(applyDailyStreak(100, 4)).toBe(130);
    expect(applyDailyStreak(55, 2)).toBe(60);
    expect(applyDailyStreak(100, 50)).toBe(200);
  });
});
