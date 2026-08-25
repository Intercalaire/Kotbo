import { describe, expect, test } from 'bun:test';
import {
  hasModuleReward,
  isBlackMarketEligible,
  isShopItemAvailable,
  isShopItemUnlocked,
} from '../../services/features/economyPolicy.js';

const ALL_MODULES = { levelingEnabled: true, clanPointsEnabled: true };

describe('economy shop item availability', () => {
  test('accepts purchasable global and same-guild items', () => {
    expect(isShopItemAvailable({ purchasable: true, guildId: null }, 'guild-a', ALL_MODULES)).toBe(true);
    expect(isShopItemAvailable({ purchasable: true, guildId: 'guild-a' }, 'guild-a', ALL_MODULES)).toBe(true);
  });

  test('rejects non-purchasable items', () => {
    expect(isShopItemAvailable({ purchasable: false, guildId: null }, 'guild-a', ALL_MODULES)).toBe(false);
    expect(isShopItemAvailable({ purchasable: false, guildId: 'guild-a' }, 'guild-a', ALL_MODULES)).toBe(false);
  });

  test('rejects items owned by another guild', () => {
    expect(isShopItemAvailable({ purchasable: true, guildId: 'guild-b' }, 'guild-a', ALL_MODULES)).toBe(false);
  });

  test('rejects a missing item', () => {
    expect(isShopItemAvailable(null, 'guild-a', ALL_MODULES)).toBe(false);
  });
});

describe('récompenses de modules en boutique', () => {
  test('un objet sans récompense de module reste vendable partout', () => {
    const plain = { levelXpReward: 0, clanPointsReward: 0 };
    expect(isShopItemUnlocked(plain, { levelingEnabled: false, clanPointsEnabled: false })).toBe(true);
    expect(isShopItemUnlocked({}, { levelingEnabled: false, clanPointsEnabled: false })).toBe(true);
  });

  test("l'XP ne se vend que si le module Niveaux tourne", () => {
    const scroll = { levelXpReward: 500, clanPointsReward: 0 };
    expect(isShopItemUnlocked(scroll, ALL_MODULES)).toBe(true);
    expect(isShopItemUnlocked(scroll, { levelingEnabled: false, clanPointsEnabled: true })).toBe(false);
  });

  test('les points de clan ne se vendent que si le pont clans est ouvert', () => {
    const banner = { levelXpReward: 0, clanPointsReward: 50 };
    expect(isShopItemUnlocked(banner, ALL_MODULES)).toBe(true);
    expect(isShopItemUnlocked(banner, { levelingEnabled: true, clanPointsEnabled: false })).toBe(false);
  });

  test('un objet mixte exige les deux modules', () => {
    const mixed = { levelXpReward: 100, clanPointsReward: 10 };
    expect(isShopItemUnlocked(mixed, { levelingEnabled: true, clanPointsEnabled: false })).toBe(false);
    expect(isShopItemUnlocked(mixed, { levelingEnabled: false, clanPointsEnabled: true })).toBe(false);
    expect(isShopItemUnlocked(mixed, ALL_MODULES)).toBe(true);
  });

  test('la disponibilité en boutique retire aussi ces objets', () => {
    const scroll = { purchasable: true, guildId: null, levelXpReward: 500, clanPointsReward: 0 };
    expect(isShopItemAvailable(scroll, 'guild-a', { levelingEnabled: false, clanPointsEnabled: true })).toBe(false);
  });
});

describe('tirage du marché noir', () => {
  const item = { purchasable: true, guildId: null, levelXpReward: 0, clanPointsReward: 0 };

  test('un objet ordinaire reste tirable', () => {
    expect(isBlackMarketEligible(item, ALL_MODULES)).toBe(true);
  });

  test('un objet explicitement retiré ne sort jamais', () => {
    expect(isBlackMarketEligible({ ...item, blackMarketEligible: false }, ALL_MODULES)).toBe(false);
  });

  test('un objet dont le module est éteint ne sort pas non plus', () => {
    const scroll = { ...item, levelXpReward: 500 };
    expect(isBlackMarketEligible(scroll, { levelingEnabled: false, clanPointsEnabled: true })).toBe(false);
  });

  test('une récompense de module se reconnaît quel que soit le module', () => {
    expect(hasModuleReward({ levelXpReward: 0, clanPointsReward: 0 })).toBe(false);
    expect(hasModuleReward({ levelXpReward: 1, clanPointsReward: 0 })).toBe(true);
    expect(hasModuleReward({ levelXpReward: 0, clanPointsReward: 1 })).toBe(true);
    expect(hasModuleReward({})).toBe(false);
  });
});
