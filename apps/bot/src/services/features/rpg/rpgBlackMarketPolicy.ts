/**
 * Règles pures du marché noir : planification de la fenêtre d'ouverture et tirage des
 * offres. Aucun accès base ni Discord ici, pour que ces décisions - les seules qui
 * pèsent sur l'équilibrage - restent vérifiables en test unitaire.
 */

export interface BlackMarketWindowConfig {
  blackMarketIntervalDays: number;
  blackMarketDurationMin: number;
}

export interface BlackMarketOfferConfig {
  blackMarketOfferCount: number;
  blackMarketMaxQuantity: number;
  blackMarketDiscountMin: number;
  blackMarketDiscountMax: number;
}

export interface BlackMarketWindow {
  opensAt: Date;
  closesAt: Date;
}

export interface DrawnOffer<T> {
  item: T;
  price: number;
  discount: number;
  stock: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/** Bornes de sécurité : une config saisie de travers ne doit pas figer ou emballer le cycle. */
export const INTERVAL_DAYS_RANGE = { min: 1, max: 365 } as const;
export const DURATION_MIN_RANGE = { min: 15, max: 24 * 60 } as const;
export const OFFER_COUNT_RANGE = { min: 1, max: 25 } as const;
export const MAX_QUANTITY_RANGE = { min: 1, max: 99 } as const;
export const DISCOUNT_RANGE = { min: 1, max: 90 } as const;

export function clampInt(value: number, range: { min: number; max: number }, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(value)));
}

/**
 * Tire la prochaine fenêtre d'ouverture.
 *
 * L'ouverture n'est volontairement pas un créneau fixe : elle tombe quelque part entre
 * une demi-période et une période et demie après la précédente fermeture. L'écart moyen
 * vaut donc exactement la périodicité configurée (une fois par semaine par défaut), mais
 * ni le jour ni l'heure ne sont devinables - ce qui est tout l'intérêt d'un marché noir.
 *
 * @param since Fin de la fenêtre précédente, ou « maintenant » pour la toute première.
 */
export function planNextBlackMarketWindow(
  since: Date,
  config: BlackMarketWindowConfig,
  random: () => number = Math.random,
): BlackMarketWindow {
  const intervalDays = clampInt(config.blackMarketIntervalDays, INTERVAL_DAYS_RANGE, 7);
  const durationMin = clampInt(config.blackMarketDurationMin, DURATION_MIN_RANGE, 120);

  const periodMs = intervalDays * MS_PER_DAY;
  const offsetMs = periodMs / 2 + random() * periodMs;

  const opensAt = new Date(since.getTime() + Math.round(offsetMs));
  const closesAt = new Date(opensAt.getTime() + durationMin * MS_PER_MINUTE);
  return { opensAt, closesAt };
}

/** Prix remisé, jamais gratuit : une remise de 90 % laisse au moins 1 pièce à payer. */
export function discountedPrice(price: number, discountPercent: number): number {
  const kept = (100 - discountPercent) / 100;
  return Math.max(1, Math.round(price * kept));
}

/**
 * Tire la vitrine personnelle d'un membre parmi les objets achetables.
 *
 * Chaque membre a son propre tirage : deux joueurs qui ouvrent le marché à la même
 * seconde ne voient pas les mêmes objets, donc personne ne peut « rafler » l'offre
 * d'un autre. Le prix est figé ici et recopié en base.
 */
export function drawBlackMarketOffers<T extends { id: string; price: number }>(
  items: readonly T[],
  config: BlackMarketOfferConfig,
  random: () => number = Math.random,
): DrawnOffer<T>[] {
  const offerCount = clampInt(config.blackMarketOfferCount, OFFER_COUNT_RANGE, 4);
  const stock = clampInt(config.blackMarketMaxQuantity, MAX_QUANTITY_RANGE, 3);

  let minDiscount = clampInt(config.blackMarketDiscountMin, DISCOUNT_RANGE, 20);
  let maxDiscount = clampInt(config.blackMarketDiscountMax, DISCOUNT_RANGE, 50);
  // Une plage saisie à l'envers dans le dashboard donnerait sinon un `random` négatif.
  if (minDiscount > maxDiscount) [minDiscount, maxDiscount] = [maxDiscount, minDiscount];

  // Mélange de Fisher-Yates sur une copie : la source reste intacte pour l'appelant.
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, offerCount).map((item) => {
    const discount = minDiscount + Math.floor(random() * (maxDiscount - minDiscount + 1));
    return { item, price: discountedPrice(item.price, discount), discount, stock };
  });
}
