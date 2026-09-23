import { describe, expect, test } from 'bun:test';
import { parsePositiveInt, suggestedUnitPrice } from '../../services/economy/marketplacePolicy.js';

describe('prix suggéré à la mise en vente', () => {
  test('moyenne des ventes récentes, pondérée par la quantité', () => {
    const suggested = suggestedUnitPrice([{ price: 300, quantity: 3 }, { price: 150, quantity: 1 }], 50, 0);
    expect(suggested).toEqual({ unitPrice: 113, source: 'market', samples: 2 });
  });

  test('sans vente, le prix boutique majoré selon la forge', () => {
    expect(suggestedUnitPrice([], 100, 0)).toEqual({ unitPrice: 100, source: 'shop', samples: 0 });
    expect(suggestedUnitPrice([], 100, 4)).toEqual({ unitPrice: 200, source: 'shop', samples: 0 });
  });

  test('ne propose jamais moins d une pièce', () => {
    expect(suggestedUnitPrice([], 0, 0).unitPrice).toBe(1);
  });
});

describe('lecture des nombres saisis', () => {
  test('tolère espaces et séparateurs de milliers', () => {
    expect(parsePositiveInt(' 12 500 ')).toBe(12_500);
    expect(parsePositiveInt('1.000')).toBe(1_000);
  });

  test('refuse zéro, les négatifs et le texte', () => {
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('-5')).toBeNull();
    expect(parsePositiveInt('abc')).toBeNull();
    expect(parsePositiveInt('')).toBeNull();
  });
});
