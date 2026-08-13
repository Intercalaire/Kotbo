/**
 * spam/scoring.ts - Combinaison des signaux en un score 0-100.
 *
 * Même principe que le moteur de doubles comptes :
 *   1. poids appris par type de signal (recalibrés par la boucle d'apprentissage) ;
 *   2. rendements décroissants à l'intérieur d'une famille (redondance) ;
 *   3. bonus de corroboration entre familles distinctes ;
 *   4. atténuation par la confiance, limitée aux familles qui le méritent.
 */

import type {
  SpamEvaluationContext,
  SpamSignal,
  SpamSignalFamily,
  SpamVerdict,
  TrustContext,
} from './types.js';
import { SPAM_SIGNAL_FAMILY, TRUST_ATTENUATED_FAMILIES } from './types.js';
import { collectSignals } from './signals.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Multiplicateur de confiance dans [0.4, 1].
 *
 * 1 = aucun élément de confiance (compte inconnu), 0.4 = membre installé de
 * longue date. Le plancher est volontairement haut : un membre de confiance
 * dont le compte est volé doit rester détectable.
 */
export function trustMultiplier(trust: TrustContext): number {
  let credit = 0;

  if (trust.accountAgeMs !== null) {
    if (trust.accountAgeMs > 365 * DAY_MS) credit += 0.15;
    else if (trust.accountAgeMs > 90 * DAY_MS) credit += 0.08;
  }

  if (trust.membershipMs !== null) {
    if (trust.membershipMs > 180 * DAY_MS) credit += 0.2;
    else if (trust.membershipMs > 30 * DAY_MS) credit += 0.12;
    else if (trust.membershipMs > 7 * DAY_MS) credit += 0.05;
  }

  if (trust.messageCount > 2000) credit += 0.15;
  else if (trust.messageCount > 500) credit += 0.1;
  else if (trust.messageCount > 100) credit += 0.05;

  if (trust.hasRole) credit += 0.05;
  if (trust.isTrustedRole) credit += 0.05;

  return Math.max(0.4, 1 - Math.min(0.6, credit));
}

/** Bonus multiplicatif quand plusieurs familles indépendantes concordent. */
function corroborationMultiplier(distinctFamilies: number): number {
  if (distinctFamilies >= 4) return 1.3;
  if (distinctFamilies === 3) return 1.18;
  if (distinctFamilies === 2) return 1.07;
  return 1.0;
}

export type ScoreOptions = {
  /** Poids appris par type de signal. Défaut 1.0. */
  weights?: Record<string, number>;
  trust?: TrustContext;
  /** false désactive l'atténuation par la confiance. */
  trustEnabled?: boolean;
};

export function computeSpamScore(signals: SpamSignal[], options: ScoreOptions = {}): SpamVerdict {
  if (signals.length === 0) {
    return {
      score: 0,
      signals: [],
      distinctFamilies: 0,
      familyBreakdown: {},
      corroborationMultiplier: 1,
      trustMultiplier: 1,
    };
  }

  const weights = options.weights ?? {};
  const multiplier = options.trustEnabled !== false && options.trust ? trustMultiplier(options.trust) : 1;

  const byFamily = new Map<SpamSignalFamily, number[]>();
  for (const signal of signals) {
    const family = SPAM_SIGNAL_FAMILY[signal.type];
    const weighted = signal.score * (weights[signal.type] ?? 1);
    // La confiance ne relativise que ce qui est dit, pas la façon dont le
    // message a été produit (voir TRUST_ATTENUATED_FAMILIES).
    const adjusted = TRUST_ATTENUATED_FAMILIES.has(family) ? weighted * multiplier : weighted;
    const bucket = byFamily.get(family) ?? [];
    bucket.push(adjusted);
    byFamily.set(family, bucket);
  }

  const familyBreakdown: Partial<Record<SpamSignalFamily, number>> = {};
  let base = 0;
  for (const [family, scores] of byFamily) {
    scores.sort((a, b) => b - a);
    // Le signal le plus fort compte plein pot, les suivants pour 30 % : deux
    // signaux d'une même famille disent largement la même chose.
    let familyScore = scores[0];
    for (let i = 1; i < scores.length; i++) familyScore += scores[i] * 0.3;
    familyBreakdown[family] = Math.round(familyScore);
    base += familyScore;
  }

  const distinctFamilies = byFamily.size;
  const corroboration = corroborationMultiplier(distinctFamilies);
  const score = Math.max(0, Math.min(100, Math.round(base * corroboration)));

  return {
    score,
    signals,
    distinctFamilies,
    familyBreakdown,
    corroborationMultiplier: corroboration,
    trustMultiplier: multiplier,
  };
}

/**
 * Évaluation complète d'un message : collecte des signaux puis scoring.
 * Fonction pure - c'est le point d'entrée utilisé par les tests et par le
 * rejeu de raids enregistrés.
 */
export function evaluateMessage(ctx: SpamEvaluationContext, weights: Record<string, number> = {}): SpamVerdict {
  const signals = collectSignals(ctx);
  return computeSpamScore(signals, {
    weights,
    trust: ctx.trust,
    trustEnabled: ctx.tuning.trustEnabled,
  });
}
