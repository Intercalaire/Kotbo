/**
 * dc/logisticModel.ts - Modèle appris des décisions du staff.
 *
 * Complète les poids par signal (learning.ts) : ceux-ci jugent chaque signal
 * isolément, alors qu'une régression logistique apprend leur effet *conjoint*
 * et rend une probabilité calibrée « c'est bien un double compte ».
 *
 * Le modèle d'un serveur est tiré vers le modèle global (appris sur tous les
 * serveurs) plutôt que vers zéro : un petit serveur hérite de ce que les autres
 * ont appris, puis s'en écarte à mesure que son propre staff tranche.
 *
 * Fonctions pures, sans base ni Discord : le chargement et le cache vivent dans
 * learning.ts.
 */

import { SIGNAL_FAMILY } from './types.js';

const SIGNAL_TYPES = Object.keys(SIGNAL_FAMILY);
const FAMILY_COUNT = new Set(Object.values(SIGNAL_FAMILY)).size;

/** Ordre des features : un score par type de signal, puis le nombre de familles. */
export const MODEL_FEATURES: readonly string[] = [...SIGNAL_TYPES, 'distinct_families'];

export type LabeledVector = { x: number[]; y: 0 | 1 };

export type LogisticModel = {
  coefficients: number[];
  bias: number;
  sampleSize: number;
  positives: number;
  negatives: number;
};

export type TrainOptions = {
  /** Modèle vers lequel les coefficients sont tirés (défaut : zéro). */
  prior?: LogisticModel | null;
  /**
   * Poids du prior, en équivalent d'échantillons : la pénalité L2 vaut
   * `priorStrength / n`, si bien que le modèle s'affirme à mesure que les
   * décisions s'accumulent au lieu de rester bridé à la même force.
   */
  priorStrength?: number;
  epochs?: number;
  learningRate?: number;
};

/**
 * Transforme les signaux d'une détection en vecteur de features dans [0, 1].
 * Un score peut dépasser 100 (bonus cumulés sur un même alt) : il est plafonné.
 */
export function featurize(signals: Record<string, number>, distinctFamilies: number): number[] {
  const x = SIGNAL_TYPES.map((type) => Math.max(0, Math.min(1, (signals[type] ?? 0) / 100)));
  x.push(Math.max(0, Math.min(1, distinctFamilies / FAMILY_COUNT)));
  return x;
}

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

export function predict(model: LogisticModel, x: number[]): number {
  let z = model.bias;
  for (let i = 0; i < x.length; i++) z += (model.coefficients[i] ?? 0) * x[i];
  return sigmoid(z);
}

/**
 * Régression logistique en descente de gradient complète.
 *
 * Les classes sont rééquilibrées : le staff valide en général bien plus de
 * liens qu'il ne rejette d'alertes (ou l'inverse), et un modèle non pondéré
 * apprendrait surtout la proportion. Rend null tant qu'il manque l'une des
 * deux classes, puisqu'il n'y a alors rien à distinguer.
 */
export function trainLogistic(samples: LabeledVector[], options: TrainOptions = {}): LogisticModel | null {
  const positives = samples.filter((s) => s.y === 1).length;
  const negatives = samples.length - positives;
  if (positives === 0 || negatives === 0) return null;

  const dims = MODEL_FEATURES.length;
  const epochs = options.epochs ?? 400;
  const learningRate = options.learningRate ?? 1;
  const prior = options.prior ?? null;

  const anchor = Array.from({ length: dims }, (_, i) => prior?.coefficients[i] ?? 0);
  const coefficients = [...anchor];
  let bias = prior?.bias ?? 0;

  const n = samples.length;
  const l2 = (options.priorStrength ?? 0.3) / n;
  const weightPositive = n / (2 * positives);
  const weightNegative = n / (2 * negatives);

  const gradient = new Array<number>(dims);
  for (let epoch = 0; epoch < epochs; epoch++) {
    gradient.fill(0);
    let gradientBias = 0;

    for (const sample of samples) {
      let z = bias;
      for (let i = 0; i < dims; i++) z += coefficients[i] * (sample.x[i] ?? 0);
      const error = (sigmoid(z) - sample.y) * (sample.y === 1 ? weightPositive : weightNegative);
      for (let i = 0; i < dims; i++) gradient[i] += error * (sample.x[i] ?? 0);
      gradientBias += error;
    }

    let norm = gradientBias * gradientBias;
    for (let i = 0; i < dims; i++) {
      gradient[i] = gradient[i] / n + l2 * (coefficients[i] - anchor[i]);
      norm += gradient[i] * gradient[i];
    }
    gradientBias /= n;

    for (let i = 0; i < dims; i++) coefficients[i] -= learningRate * gradient[i];
    bias -= learningRate * gradientBias;

    if (norm < 1e-10) break;
  }

  return { coefficients, bias, sampleSize: n, positives, negatives };
}

/** Part maximale du score final confiée au modèle, même très entraîné. */
export const MAX_MODEL_SHARE = 0.6;
/** Nombre de décisions pour lequel le modèle atteint la moitié de sa part maximale. */
const HALF_CONFIDENCE_SAMPLES = 40;
/** Une décision prise sur un autre serveur compte pour un quart de décision locale. */
const GLOBAL_SAMPLE_WEIGHT = 0.25;

/** Confiance accordée au modèle selon le volume de décisions qui l'ont formé. */
export function modelConfidence(guildSamples: number, globalSamples: number): number {
  const effective = guildSamples + GLOBAL_SAMPLE_WEIGHT * globalSamples;
  if (effective <= 0) return 0;
  return MAX_MODEL_SHARE * (effective / (effective + HALF_CONFIDENCE_SAMPLES));
}

/** Mélange le score heuristique (0-100) et la probabilité apprise. */
export function blendScore(heuristicScore: number, probability: number, confidence: number): number {
  const blended = (1 - confidence) * heuristicScore + confidence * 100 * probability;
  return Math.max(0, Math.min(100, Math.round(blended)));
}
