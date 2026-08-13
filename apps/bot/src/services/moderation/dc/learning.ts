/**
 * dc/learning.ts - Boucle d'apprentissage.
 *
 * Chaque détection enregistre son vecteur de features (DcDetectionSample).
 * La décision staff (lier = vrai positif / faux positif) fournit le label.
 * À partir d'assez d'échantillons labellisés, on recalibre les poids par signal
 * (DcSignalWeight) : un signal qui apparaît surtout dans les vrais positifs voit
 * son poids monter ; un signal fréquent dans les faux positifs voit le sien baisser.
 */

import { Prisma } from '@prisma/client';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import type { DcSignal } from './types.js';
import { invalidateWeightsCache } from './scoring.js';

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

  if (idsToUpdate.length > 0) {
    await prisma.dcDetectionSample
      .updateMany({
        where: { id: { in: idsToUpdate } },
        data: { label, decidedByUserId: moderatorId, decidedAt: new Date() },
      })
      .catch((err) => logger.debug('DcLearning', `recordDecision échec: ${String(err)}`));
  }

  // Recalibrage asynchrone (ne bloque pas la décision).
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
