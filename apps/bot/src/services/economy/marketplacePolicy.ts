/**
 * Règles du marché sans accès base : prix proposé à la mise en vente et bornes de saisie.
 */

/** Fenêtre des ventes prises en compte pour le prix moyen. */
export const SUGGESTED_PRICE_WINDOW_DAYS = 30;

/** Majoration du prix boutique par niveau de forge, quand le marché n'a encore rien vendu. */
export const UPGRADE_PRICE_BONUS = 0.25;

export const LISTING_PRICE_RANGE = { min: 1, max: 100_000_000 } as const;

export type PriceSample = { price: number; quantity: number };

export type SuggestedPrice = {
  unitPrice: number;
  /** `market` : moyenne des ventes récentes. `shop` : prix boutique, faute de ventes. */
  source: 'market' | 'shop';
  samples: number;
};

/**
 * Prix unitaire proposé : la moyenne des ventes récentes du même objet au même niveau de
 * forge, pondérée par la quantité. Sans vente, le prix boutique majoré selon la forge : un
 * objet +5 ne doit pas se proposer au prix d'un objet neuf.
 */
export function suggestedUnitPrice(samples: PriceSample[], shopPrice: number, upgrade: number): SuggestedPrice {
  const quantity = samples.reduce((sum, sample) => sum + Math.max(0, sample.quantity), 0);
  if (quantity > 0) {
    const total = samples.reduce((sum, sample) => sum + Math.max(0, sample.price), 0);
    return { unitPrice: Math.max(LISTING_PRICE_RANGE.min, Math.round(total / quantity)), source: 'market', samples: samples.length };
  }

  const base = Math.max(LISTING_PRICE_RANGE.min, Math.round(Math.max(0, shopPrice) * (1 + UPGRADE_PRICE_BONUS * Math.max(0, upgrade))));
  return { unitPrice: base, source: 'shop', samples: 0 };
}

/** Lit un entier positif saisi dans une fenêtre, espaces et séparateurs de milliers tolérés. */
export function parsePositiveInt(raw: string | null | undefined): number | null {
  const cleaned = (raw ?? '').replace(/[\s_.,']/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number.parseInt(cleaned, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
