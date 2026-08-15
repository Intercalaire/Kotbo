import { describe, expect, test } from 'bun:test';
import {
  discountedPrice,
  drawBlackMarketOffers,
  planNextBlackMarketWindow,
} from '../../services/features/rpg/rpgBlackMarketPolicy.js';

const WINDOW_CONFIG = { blackMarketIntervalDays: 7, blackMarketDurationMin: 120 };
const OFFER_CONFIG = {
  blackMarketOfferCount: 4,
  blackMarketMaxQuantity: 3,
  blackMarketDiscountMin: 20,
  blackMarketDiscountMax: 50,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const since = new Date('2026-08-15T00:00:00.000Z');

/** Générateur déterministe : chaque appel consomme la valeur suivante, puis boucle. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

function itemsOfPrice(...prices: number[]) {
  return prices.map((price, i) => ({ id: `item-${i}`, price }));
}

describe('black market window planning', () => {
  test('l’ouverture tombe entre une demi-période et une période et demie', () => {
    const earliest = planNextBlackMarketWindow(since, WINDOW_CONFIG, () => 0);
    const latest = planNextBlackMarketWindow(since, WINDOW_CONFIG, () => 1);

    expect(earliest.opensAt.getTime()).toBe(since.getTime() + 3.5 * DAY_MS);
    expect(latest.opensAt.getTime()).toBe(since.getTime() + 10.5 * DAY_MS);
  });

  test('la fermeture suit la durée configurée', () => {
    const window = planNextBlackMarketWindow(since, WINDOW_CONFIG, () => 0.5);
    expect(window.closesAt.getTime() - window.opensAt.getTime()).toBe(120 * 60 * 1000);
  });

  test('une périodicité aberrante retombe sur les bornes au lieu de figer le cycle', () => {
    const zero = planNextBlackMarketWindow(since, { blackMarketIntervalDays: 0, blackMarketDurationMin: 0 }, () => 0);
    // 1 jour minimum : l'ouverture ne peut pas être immédiate ni la fenêtre nulle.
    expect(zero.opensAt.getTime()).toBe(since.getTime() + 0.5 * DAY_MS);
    expect(zero.closesAt.getTime() - zero.opensAt.getTime()).toBe(15 * 60 * 1000);
  });
});

describe('black market pricing', () => {
  test('applique la remise en pourcentage', () => {
    expect(discountedPrice(100, 40)).toBe(60);
    expect(discountedPrice(700, 50)).toBe(350);
  });

  test('ne descend jamais à zéro', () => {
    expect(discountedPrice(1, 90)).toBe(1);
    expect(discountedPrice(5, 90)).toBe(1);
  });
});

describe('black market offer draw', () => {
  test('tire le nombre d’offres demandé sans dépasser le stock d’objets', () => {
    expect(drawBlackMarketOffers(itemsOfPrice(10, 20, 30, 40, 50, 60), OFFER_CONFIG, () => 0.5)).toHaveLength(4);
    expect(drawBlackMarketOffers(itemsOfPrice(10, 20), OFFER_CONFIG, () => 0.5)).toHaveLength(2);
    expect(drawBlackMarketOffers([], OFFER_CONFIG, () => 0.5)).toHaveLength(0);
  });

  test('la remise reste dans la plage configurée', () => {
    const offers = drawBlackMarketOffers(itemsOfPrice(100, 200, 300, 400), OFFER_CONFIG, sequence([0, 0.25, 0.5, 0.99]));
    for (const offer of offers) {
      expect(offer.discount).toBeGreaterThanOrEqual(20);
      expect(offer.discount).toBeLessThanOrEqual(50);
      expect(offer.price).toBe(discountedPrice(offer.item.price, offer.discount));
    }
  });

  test('une plage de remise saisie à l’envers est remise à l’endroit', () => {
    const offers = drawBlackMarketOffers(
      itemsOfPrice(100),
      { ...OFFER_CONFIG, blackMarketDiscountMin: 60, blackMarketDiscountMax: 10 },
      () => 0,
    );
    expect(offers[0].discount).toBe(10);
  });

  test('le stock par offre suit le maximum configuré', () => {
    const offers = drawBlackMarketOffers(itemsOfPrice(100, 200), OFFER_CONFIG, () => 0.5);
    expect(offers.every((offer) => offer.stock === 3)).toBe(true);
  });

  test('ne modifie pas la liste d’objets fournie', () => {
    const items = itemsOfPrice(10, 20, 30, 40, 50);
    const snapshot = items.map((item) => item.id);
    drawBlackMarketOffers(items, OFFER_CONFIG, sequence([0.1, 0.9, 0.4, 0.7, 0.2]));
    expect(items.map((item) => item.id)).toEqual(snapshot);
  });
});
