import { describe, expect, test } from 'bun:test';
import { marketplaceTax } from '../../services/economy/marketplacePolicy.js';

describe('taxe du marché', () => {
  test('retient le pourcentage du prix, arrondi à l’unité inférieure', () => {
    expect(marketplaceTax(1000, 5)).toBe(50);
    expect(marketplaceTax(19, 5)).toBe(0);
    expect(marketplaceTax(199, 10)).toBe(19);
  });

  test('0 % ne retient rien', () => {
    expect(marketplaceTax(1000, 0)).toBe(0);
  });

  test('un taux hors bornes est ramené entre 0 et 50 %', () => {
    expect(marketplaceTax(1000, 90)).toBe(500);
    expect(marketplaceTax(1000, -5)).toBe(0);
  });
});
