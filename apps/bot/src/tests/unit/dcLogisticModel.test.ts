import { describe, expect, test } from 'bun:test';
import {
  MAX_MODEL_SHARE,
  MODEL_FEATURES,
  blendScore,
  featurize,
  modelConfidence,
  predict,
  trainLogistic,
  type LabeledVector,
} from '../../services/moderation/dc/logisticModel.js';

const sample = (signals: Record<string, number>, families: number, y: 0 | 1): LabeledVector => ({
  x: featurize(signals, families),
  y,
});

// Le staff valide les alertes portées par l'empreinte d'appareil et rejette
// celles qui ne reposent que sur une arrivée simultanée.
function staffHistory(): LabeledVector[] {
  const history: LabeledVector[] = [];
  for (let i = 0; i < 15; i++) {
    history.push(sample({ device_fingerprint: 55, join_proximity: 15 }, 2, 1));
    history.push(sample({ join_proximity: 15 }, 1, 0));
  }
  return history;
}

describe('featurize', () => {
  test('un score par type de signal plus le nombre de familles, bornés à [0, 1]', () => {
    const x = featurize({ shared_ip: 45, invite_link: 250 }, 3);
    expect(x).toHaveLength(MODEL_FEATURES.length);
    expect(x[MODEL_FEATURES.indexOf('shared_ip')]).toBeCloseTo(0.45);
    expect(x[MODEL_FEATURES.indexOf('invite_link')]).toBe(1);
    expect(x.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe('trainLogistic', () => {
  test('rien à apprendre tant qu\'une des deux classes manque', () => {
    expect(trainLogistic([sample({ shared_ip: 45 }, 1, 1)])).toBeNull();
  });

  test('apprend quel signal distingue les décisions du staff', () => {
    const model = trainLogistic(staffHistory());
    expect(model).not.toBeNull();
    const confirmed = predict(model!, featurize({ device_fingerprint: 55, join_proximity: 15 }, 2));
    const rejected = predict(model!, featurize({ join_proximity: 15 }, 1));
    expect(confirmed).toBeGreaterThan(0.8);
    expect(rejected).toBeLessThan(0.2);
  });

  test('rééquilibre les classes : une majorité de rejets ne suffit pas à tout rejeter', () => {
    const history = [
      ...Array.from({ length: 3 }, () => sample({ shared_ip: 45 }, 1, 1)),
      ...Array.from({ length: 40 }, () => sample({ username_similarity: 30 }, 1, 0)),
    ];
    const model = trainLogistic(history)!;
    expect(predict(model, featurize({ shared_ip: 45 }, 1))).toBeGreaterThan(0.5);
  });

  test('un serveur sans données propres sur un signal hérite du modèle global', () => {
    const global = trainLogistic(staffHistory())!;
    // Le serveur n'a jamais vu d'empreinte d'appareil : seulement deux décisions sur d'autres signaux.
    const local = [sample({ shared_avatar: 25 }, 1, 1), sample({ username_similarity: 30 }, 1, 0)];
    const withPrior = trainLogistic(local, { prior: global })!;
    const withoutPrior = trainLogistic(local)!;
    const x = featurize({ device_fingerprint: 55, join_proximity: 15 }, 2);
    expect(predict(withPrior, x)).toBeGreaterThan(predict(withoutPrior, x));
  });
});

describe('blendScore', () => {
  test('sans confiance, le score heuristique reste intact', () => {
    expect(blendScore(42, 0.99, 0)).toBe(42);
  });

  test('le modèle corrige le score dans la limite de sa part', () => {
    expect(blendScore(80, 0, 0.5)).toBe(40);
    expect(blendScore(20, 1, 0.5)).toBe(60);
  });
});

describe('modelConfidence', () => {
  test('croît avec les décisions sans dépasser la part maximale', () => {
    expect(modelConfidence(0, 0)).toBe(0);
    expect(modelConfidence(10, 0)).toBeLessThan(modelConfidence(100, 0));
    expect(modelConfidence(100_000, 0)).toBeLessThanOrEqual(MAX_MODEL_SHARE);
  });

  test('une décision d\'un autre serveur pèse moins qu\'une décision locale', () => {
    expect(modelConfidence(0, 40)).toBeLessThan(modelConfidence(40, 0));
  });
});
