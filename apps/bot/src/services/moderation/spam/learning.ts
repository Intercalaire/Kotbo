/**
 * spam/learning.ts - Poids appris et boucle d'apprentissage du moteur anti-spam.
 *
 * Chaque évaluation au-dessus du seuil de journalisation enregistre son vecteur
 * de features. Quand le staff tranche (vrai positif / faux positif), les poids
 * par signal sont recalibrés : un signal présent surtout dans les vrais
 * positifs monte, un signal fréquent dans les faux positifs descend.
 *
 * C'est ce qui permet de démarrer en mode shadow sur des seuils arbitraires et
 * de converger vers des seuils justifiés par les données du serveur.
 */

import { Prisma } from '@prisma/client';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import type { SpamAction, SpamVerdict } from './types.js';

const WEIGHTS_TTL_MS = 15 * 60 * 1000;
const MIN_LABELED_FOR_CALIBRATION = 25;
const CONTENT_PREVIEW_LENGTH = 280;

type WeightsEntry = { weights: Record<string, number>; expiresAt: number };
const weightsCache = new Map<string, WeightsEntry>();

/** Poids globaux puis surcharge par guilde. */
export async function loadSpamWeights(guildId: string): Promise<Record<string, number>> {
  const cached = weightsCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.weights;

  const rows = await prisma.spamSignalWeight
    .findMany({
      where: { OR: [{ guildId: null }, { guildId }] },
      select: { guildId: true, signalType: true, weight: true },
    })
    .catch(() => [] as { guildId: string | null; signalType: string; weight: number }[]);

  const weights: Record<string, number> = {};
  for (const row of rows) if (row.guildId === null) weights[row.signalType] = row.weight;
  for (const row of rows) if (row.guildId === guildId) weights[row.signalType] = row.weight;

  weightsCache.set(guildId, { weights, expiresAt: Date.now() + WEIGHTS_TTL_MS });
  return weights;
}

export function invalidateSpamWeightsCache(guildId: string): void {
  weightsCache.delete(guildId);
}

export type SampleInput = {
  guildId: string;
  userId: string;
  channelId: string;
  messageId: string | null;
  verdict: SpamVerdict;
  action: SpamAction;
  shadow: boolean;
  content: string;
};

/** Enregistre une évaluation. Best-effort : ne doit jamais bloquer la modération. */
export async function logSpamSample(input: SampleInput): Promise<void> {
  const signals: Record<string, number> = {};
  for (const signal of input.verdict.signals) {
    signals[signal.type] = Math.max(signals[signal.type] ?? 0, signal.score);
  }

  const features = {
    signals,
    distinctFamilies: input.verdict.distinctFamilies,
    familyBreakdown: input.verdict.familyBreakdown,
    corroborationMultiplier: input.verdict.corroborationMultiplier,
    trustMultiplier: input.verdict.trustMultiplier,
    score: input.verdict.score,
  };

  await prisma.spamDetectionSample
    .create({
      data: {
        guildId: input.guildId,
        userId: input.userId,
        channelId: input.channelId,
        messageId: input.messageId,
        score: input.verdict.score,
        action: input.action,
        shadow: input.shadow,
        features: features as unknown as Prisma.InputJsonValue,
        contentPreview: input.content.slice(0, CONTENT_PREVIEW_LENGTH) || null,
      },
    })
    .catch((err) => logger.debug('SpamLearning', `logSpamSample échec: ${String(err)}`));
}

/** Applique un label à un échantillon et relance le recalibrage. */
export async function recordSpamDecision(
  guildId: string,
  sampleId: string,
  label: 'TRUE_POSITIVE' | 'FALSE_POSITIVE',
  moderatorId: string
): Promise<boolean> {
  const updated = await prisma.spamDetectionSample
    .updateMany({
      where: { id: sampleId, guildId },
      data: { label, decidedByUserId: moderatorId, decidedAt: new Date() },
    })
    .catch(() => ({ count: 0 }));

  if (updated.count === 0) return false;

  void recalibrateSpamWeights(guildId).catch((err) =>
    logger.debug('SpamLearning', `recalibrateSpamWeights échec: ${String(err)}`)
  );
  return true;
}

/**
 * Recalibre les poids à partir des échantillons labellisés.
 *
 * Sans vrais positifs *et* faux positifs, il n'y a rien à discriminer : on ne
 * touche à rien plutôt que d'apprendre du bruit.
 */
export async function recalibrateSpamWeights(guildId: string): Promise<void> {
  const labeled = await prisma.spamDetectionSample
    .findMany({
      where: { guildId, label: { not: null } },
      select: { label: true, features: true },
      take: 2000,
      orderBy: { createdAt: 'desc' },
    })
    .catch(() => [] as { label: string | null; features: unknown }[]);

  if (labeled.length < MIN_LABELED_FOR_CALIBRATION) return;

  const truePositives = labeled.filter((s) => s.label === 'TRUE_POSITIVE');
  const falsePositives = labeled.filter((s) => s.label === 'FALSE_POSITIVE');
  if (truePositives.length === 0 || falsePositives.length === 0) return;

  const types = new Set<string>();
  const presence = (rows: typeof labeled): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const feats = row.features as { signals?: Record<string, number> } | null;
      for (const type of Object.keys(feats?.signals ?? {})) {
        types.add(type);
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
    }
    return counts;
  };

  const tpCounts = presence(truePositives);
  const fpCounts = presence(falsePositives);

  for (const type of types) {
    const inTp = (tpCounts.get(type) ?? 0) / truePositives.length;
    const inFp = (fpCounts.get(type) ?? 0) / falsePositives.length;
    // Pouvoir discriminant du signal, ramené dans une plage prudente : même un
    // signal très corrélé ne doit pas pouvoir décider seul.
    const weight = Math.max(0.2, Math.min(2, 0.9 + (inTp - inFp)));
    const sampleSize = (tpCounts.get(type) ?? 0) + (fpCounts.get(type) ?? 0);

    await prisma.spamSignalWeight
      .upsert({
        where: { guildId_signalType: { guildId, signalType: type } },
        update: { weight, sampleSize },
        create: { guildId, signalType: type, weight, sampleSize },
      })
      .catch(() => null);
  }

  invalidateSpamWeightsCache(guildId);
  logger.info(
    'SpamLearning',
    `Poids anti-spam recalibrés pour ${guildId} (${truePositives.length} VP / ${falsePositives.length} FP).`
  );
}

/**
 * Statistiques de calibration : ce que le mode shadow aurait fait, par palier.
 * C'est la vue qui permet de choisir des seuils sur des données réelles.
 */
export async function getCalibrationStats(guildId: string, days = 14) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const samples = await prisma.spamDetectionSample.findMany({
    where: { guildId, createdAt: { gte: since } },
    select: { score: true, shadow: true, action: true, label: true, features: true },
    take: 20_000,
    orderBy: { createdAt: 'desc' },
  });

  // Histogramme par tranche de 10 points : lecture directe du seuil à choisir.
  const histogram = Array.from({ length: 10 }, (_, i) => ({
    from: i * 10,
    to: i * 10 + 9,
    count: 0,
  }));

  const signalCounts = new Map<string, number>();
  let labeledTrue = 0;
  let labeledFalse = 0;

  for (const sample of samples) {
    const bucket = Math.min(9, Math.floor(sample.score / 10));
    histogram[bucket].count++;

    if (sample.label === 'TRUE_POSITIVE') labeledTrue++;
    else if (sample.label === 'FALSE_POSITIVE') labeledFalse++;

    const feats = sample.features as { signals?: Record<string, number> } | null;
    for (const type of Object.keys(feats?.signals ?? {})) {
      signalCounts.set(type, (signalCounts.get(type) ?? 0) + 1);
    }
  }

  const weights = await loadSpamWeights(guildId);

  return {
    total: samples.length,
    shadow: samples.filter((s) => s.shadow).length,
    pendingDecision: samples.filter((s) => s.label === null).length,
    labeledTrue,
    labeledFalse,
    histogram,
    signals: [...signalCounts.entries()]
      .map(([type, count]) => ({ type, count, weight: weights[type] ?? 1 }))
      .sort((a, b) => b.count - a.count),
    /** Nombre d'échantillons manquants avant que le recalibrage puisse tourner. */
    labelsNeeded: Math.max(0, MIN_LABELED_FOR_CALIBRATION - (labeledTrue + labeledFalse)),
  };
}
