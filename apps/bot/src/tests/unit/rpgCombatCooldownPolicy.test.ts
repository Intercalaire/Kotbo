import { describe, expect, test } from 'bun:test';
import {
  bossCooldownMs,
  fightCooldownMs,
  formatCooldown,
  remainingCooldownMs,
} from '../../services/features/rpg/rpgCombatCooldownPolicy.js';

describe('délais de combat', () => {
  test('convertit les réglages du serveur', () => {
    expect(fightCooldownMs({ fightCooldownSec: 45 })).toBe(45_000);
    expect(bossCooldownMs({ bossCooldownMin: 10 })).toBe(600_000);
  });

  test('borne une valeur hors plage', () => {
    expect(fightCooldownMs({ fightCooldownSec: -5 })).toBe(0);
    expect(bossCooldownMs({ bossCooldownMin: 99_999 })).toBe(1440 * 60_000);
  });

  test('retombe sur le délai historique sans réglage', () => {
    expect(fightCooldownMs({})).toBe(120_000);
    expect(bossCooldownMs({ bossCooldownMin: null })).toBe(120_000);
  });
});

describe('attente restante', () => {
  const now = Date.parse('2026-09-23T12:00:00Z');

  test('aucune attente sans combat précédent ou à délai nul', () => {
    expect(remainingCooldownMs(null, 60_000, now)).toBe(0);
    expect(remainingCooldownMs(new Date(now), 0, now)).toBe(0);
  });

  test('décompte depuis le dernier combat', () => {
    expect(remainingCooldownMs(new Date(now - 20_000), 60_000, now)).toBe(40_000);
    expect(remainingCooldownMs(new Date(now - 90_000), 60_000, now)).toBe(0);
  });
});

describe('affichage de l\'attente', () => {
  test('choisit l\'unité selon la durée', () => {
    expect(formatCooldown(45_000)).toBe('45s');
    expect(formatCooldown(750_000)).toBe('12min 30s');
    expect(formatCooldown(120_000)).toBe('2min');
    expect(formatCooldown(3_900_000)).toBe('1h 05min');
  });

  test('arrondit une fraction de seconde à la seconde supérieure', () => {
    expect(formatCooldown(200)).toBe('1s');
  });
});
