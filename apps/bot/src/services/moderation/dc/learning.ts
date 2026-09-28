/**
 * dc/learning.ts - Boucle d'apprentissage.
 *
 * Chaque détection enregistre son vecteur de features (DcDetectionSample).
 * La décision staff (lier = vrai positif / faux positif) fournit le label.
 * Deux apprentissages en découlent :
 *  - les poids par signal (DcSignalWeight) : un signal qui apparaît surtout dans
 *    les vrais positifs voit son poids monter, l'inverse pour les faux positifs ;
 *  - un modèle logistique (logisticModel.ts) qui apprend l'effet conjoint des
 *    signaux et rend une probabilité, mélangée au score heuristique.
 */

import { Prisma } from '@prisma/client';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import type { DcSignal } from './types.js';
import { invalidateWeightsCache } from './scoring.js';
import {
  featurize,
  modelConfidence,
  predict,
  trainLogistic,
  type LabeledVector,
  type LogisticModel,
} from './logisticModel.js';

export type SampleFeatures = {
  signals: Record<string, number>; // type → score brut
  distinctFamilies: number;
  score: number;
};

const MIN_LABELED_FOR_CALIBRATION = 20;

/** Enregistre un échantillon de détection (en attente de décision staff). */
export async function logDetectionSample(
  guildId: string,
  userId: string,
  altUserId: string | null,
  score: number,
  signals: DcSignal[],
  distinctFamilies: number,
): Promise<void> {
  const signalMap: Record<string, number> = {};
  for (const s of signals) {
    // Garde le score max si un type apparaît plusieurs fois (plusieurs alts).
    signalMap[s.type] = Math.max(signalMap[s.type] ?? 0, s.score);
  }
  const features: SampleFeatures = { signals: signalMap, distinctFamilies, score };

  await prisma.dcDetectionSample
    .create({ data: { guildId, userId, altUserId, score, features: features as unknown as Prisma.InputJsonValue } })
    .catch((err) => logger.debug('DcLearning', `logDetectionSample échec: ${String(err)}`));
}

/**
 * Applique un label aux échantillons récents des utilisateurs concernés,
 * puis déclenche un recalibrage (best-effort).
 */
export async function recordDecision(
  guildId: string,
  userIds: string[],
  label: 'TRUE_POSITIVE' | 'FALSE_POSITIVE',
  moderatorId: string,
): Promise<void> {
  // Labellise le dernier échantillon en attente de chaque utilisateur.
  const pending = await prisma.dcDetectionSample
    .findMany({
      where: { guildId, userId: { in: userIds }, label: null },
      orderBy: { createdAt: 'desc' },
    })
    .catch(() => [] as { id: string; userId: string }[]);

  const seen = new Set<string>();
  const idsToUpdate: string[] = [];
  for (const s of pending) {
    if (seen.has(s.userId)) continue;
    seen.add(s.userId);
    idsToUpdate.push(s.id);
  }

  // Un lien posé à la main entre deux comptes jamais signalés n'étiquette
  // rien : pas la peine de tout réapprendre pour autant.
  if (idsToUpdate.length === 0) return;

  const updated = await prisma.dcDetectionSample
    .updateMany({
      where: { id: { in: idsToUpdate } },
      data: { label, decidedByUserId: moderatorId, decidedAt: new Date() },
    })
    .then(() => true)
    .catch((err) => {
      logger.debug('DcLearning', `recordDecision échec: ${String(err)}`);
      return false;
    });
  if (!updated) return;

  onLabelsChanged(guildId);
}

/**
 * Retire le dernier label « faux positif » d'un membre : le staff a annulé le
 * rejet de l'alerte depuis le dashboard, la décision ne doit plus instruire
 * les modèles.
 */
export async function undoFalsePositive(guildId: string, userId: string): Promise<void> {
  const last = await prisma.dcDetectionSample
    .findFirst({
      where: { guildId, userId, label: 'FALSE_POSITIVE' },
      orderBy: { decidedAt: 'desc' },
      select: { id: true },
    })
    .catch(() => null);
  if (!last) return;

  await prisma.dcDetectionSample
    .update({ where: { id: last.id }, data: { label: null, decidedByUserId: null, decidedAt: null } })
    .catch((err) => logger.debug('DcLearning', `undoFalsePositive échec: ${String(err)}`));

  onLabelsChanged(guildId);
}

/** Les labels ont bougé : poids et modèle sont réappris (sans bloquer l'appelant). */
function onLabelsChanged(guildId: string): void {
  invalidateLearnedModels(guildId);
  void recalibrateWeights(guildId).catch((err) =>
    logger.debug('DcLearning', `recalibrateWeights échec: ${String(err)}`),
  );
}

/**
 * Recalibre les poids par signal à partir des échantillons labellisés du serveur.
 * Ne fait rien tant qu'il n'y a pas assez de données (évite le sur-apprentissage).
 */
export async function recalibrateWeights(guildId: string): Promise<void> {
  const labeled = await prisma.dcDetectionSample
    .findMany({
      where: { guildId, label: { not: null } },
      select: { label: true, features: true },
      take: 2000,
      orderBy: { createdAt: 'desc' },
    })
    .catch(() => [] as { label: string | null; features: unknown }[]);

  if (labeled.length < MIN_LABELED_FOR_CALIBRATION) return;

  const tp = labeled.filter((s) => s.label === 'TRUE_POSITIVE');
  const fp = labeled.filter((s) => s.label === 'FALSE_POSITIVE');
  if (tp.length === 0 || fp.length === 0) return;

  // Recense tous les types de signaux rencontrés.
  const types = new Set<string>();
  const presence = (rows: typeof labeled): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const feats = row.features as { signals?: Record<string, number> } | null;
      const sigs = feats?.signals ?? {};
      for (const t of Object.keys(sigs)) {
        types.add(t);
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return counts;
  };
  const tpCounts = presence(tp);
  const fpCounts = presence(fp);

  for (const type of types) {
    const pTp = (tpCounts.get(type) ?? 0) / tp.length; // présence dans vrais positifs
    const pFp = (fpCounts.get(type) ?? 0) / fp.length; // présence dans faux positifs
    // Poids discriminant : >1 si le signal distingue les vrais positifs.
    const weight = Math.max(0.2, Math.min(2.0, 0.9 + (pTp - pFp)));
    const sampleSize = (tpCounts.get(type) ?? 0) + (fpCounts.get(type) ?? 0);

    await prisma.dcSignalWeight
      .upsert({
        where: { guildId_signalType: { guildId, signalType: type } },
        update: { weight, sampleSize },
        create: { guildId, signalType: type, weight, sampleSize },
      })
      .catch(() => null);
  }

  invalidateWeightsCache(guildId);
  logger.info('DcLearning', `Poids DC recalibrés pour ${guildId} (${tp.length} TP / ${fp.length} FP).`);
}

// ─── Modèle logistique appris ──────────────────────────────────────────────────

/** En dessous, le serveur s'en remet au modèle global. */
const MIN_LABELED_FOR_GUILD_MODEL = 10;
const MIN_LABELED_FOR_GLOBAL_MODEL = 20;
const GUILD_SAMPLES_LIMIT = 2000;
const GLOBAL_SAMPLES_LIMIT = 5000;
const MODEL_TTL_MS = 30 * 60 * 1000;

type CachedModel = { model: LogisticModel | null; expiresAt: number };

const guildModels = new Map<string, CachedModel>();
let globalModel: CachedModel | null = null;
// Le dashboard réévalue jusqu'à 200 détections d'un coup : sans ce partage,
// chacune relancerait le même entraînement.
const pendingTrainings = new Map<string, Promise<LogisticModel | null>>();

export type LearnedAssessment = {
  /** Probabilité apprise que la détection soit un vrai double compte (0-1). */
  probability: number;
  /** Part du score final confiée au modèle (0 - MAX_MODEL_SHARE). */
  confidence: number;
  /** Décisions du serveur et de l'ensemble des serveurs ayant formé le modèle. */
  guildSamples: number;
  globalSamples: number;
};

function invalidateLearnedModels(guildId: string): void {
  guildModels.delete(guildId);
  // Le modèle global intègre aussi ce serveur : il est réappris au prochain usage.
  globalModel = null;
}

async function loadLabeledVectors(where: Prisma.DcDetectionSampleWhereInput, take: number): Promise<LabeledVector[]> {
  const rows = await prisma.dcDetectionSample
    .findMany({
      where: { ...where, label: { in: ['TRUE_POSITIVE', 'FALSE_POSITIVE'] } },
      select: { label: true, features: true },
      orderBy: { createdAt: 'desc' },
      take,
    })
    .catch(() => [] as { label: string | null; features: unknown }[]);

  return rows.map((row) => {
    const feats = row.features as Partial<SampleFeatures> | null;
    return {
      x: featurize(feats?.signals ?? {}, feats?.distinctFamilies ?? 0),
      y: row.label === 'TRUE_POSITIVE' ? 1 : 0,
    };
  });
}

function shareTraining(key: string, train: () => Promise<LogisticModel | null>): Promise<LogisticModel | null> {
  const pending = pendingTrainings.get(key);
  if (pending) return pending;
  const run = train().finally(() => pendingTrainings.delete(key));
  pendingTrainings.set(key, run);
  return run;
}

async function getGlobalModel(): Promise<LogisticModel | null> {
  if (globalModel && globalModel.expiresAt > Date.now()) return globalModel.model;

  return shareTraining('global', async () => {
    const samples = await loadLabeledVectors({}, GLOBAL_SAMPLES_LIMIT);
    const model = samples.length >= MIN_LABELED_FOR_GLOBAL_MODEL ? trainLogistic(samples) : null;
    globalModel = { model, expiresAt: Date.now() + MODEL_TTL_MS };
    return model;
  });
}

async function getGuildModel(guildId: string, prior: LogisticModel | null): Promise<LogisticModel | null> {
  const cached = guildModels.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.model;

  return shareTraining(`guild:${guildId}`, async () => {
    const samples = await loadLabeledVectors({ guildId }, GUILD_SAMPLES_LIMIT);
    const model = samples.length >= MIN_LABELED_FOR_GUILD_MODEL ? trainLogistic(samples, { prior }) : null;
    guildModels.set(guildId, { model, expiresAt: Date.now() + MODEL_TTL_MS });
    if (model) {
      logger.debug('DcLearning', `Modèle DC réappris pour ${guildId} (${model.positives} TP / ${model.negatives} FP).`);
    }
    return model;
  });
}

/**
 * Évalue une détection avec le modèle appris : celui du serveur s'il a assez de
 * décisions, sinon le modèle global. Null tant qu'aucun des deux n'existe.
 */
export async function assessWithLearnedModel(
  guildId: string,
  signals: DcSignal[],
  distinctFamilies: number,
): Promise<LearnedAssessment | null> {
  const global = await getGlobalModel();
  const local = await getGuildModel(guildId, global);
  const model = local ?? global;
  if (!model) return null;

  const signalMap: Record<string, number> = {};
  for (const s of signals) signalMap[s.type] = Math.max(signalMap[s.type] ?? 0, s.score);

  const guildSamples = local?.sampleSize ?? 0;
  const globalSamples = global?.sampleSize ?? 0;
  return {
    probability: predict(model, featurize(signalMap, distinctFamilies)),
    confidence: modelConfidence(guildSamples, globalSamples),
    guildSamples,
    globalSamples,
  };
}
