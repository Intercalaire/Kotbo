/**
 * dc/scoring.ts - Moteur de combinaison des signaux.
 *
 * Passe d'une simple somme plafonnée à un scoring qui tient compte de la
 * *structure* des signaux :
 *   1. Poids appris par type de signal (DcSignalWeight, recalibrés par la boucle
 *      d'apprentissage). Défaut = 1.0.
 *   2. Redondance intra-famille : deux signaux de la même famille (ex. IP + sous-
 *      réseau) sont largement redondants → rendements décroissants.
 *   3. Corroboration inter-familles : des signaux de familles *différentes* qui
 *      concordent sont bien plus probants → bonus multiplicatif.
 *   4. Seuil de classification adaptatif selon la taille du serveur.
 */

import prisma from '../../../utils/db.js';
import { type DcSignal, type SignalFamily, SIGNAL_FAMILY } from './types.js';

export type ScoreResult = {
  totalScore: number; // 0-100
  distinctFamilies: number;
  familyBreakdown: Partial<Record<SignalFamily, number>>;
  corroborationMultiplier: number;
};

// ─── Cache des poids appris ─────────────────────────────────────────────────────
type WeightsEntry = { weights: Record<string, number>; expiresAt: number };
const weightsCache = new Map<string, WeightsEntry>();
const WEIGHTS_TTL_MS = 15 * 60 * 1000;

/** Charge les poids appris (global + surcharge par guilde), avec cache. */
export async function loadSignalWeights(guildId: string): Promise<Record<string, number>> {
  const cached = weightsCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.weights;

  const rows = await prisma.dcSignalWeight
    .findMany({
      where: { OR: [{ guildId: null }, { guildId }] },
      select: { guildId: true, signalType: true, weight: true },
    })
    .catch(() => [] as { guildId: string | null; signalType: string; weight: number }[]);

  const weights: Record<string, number> = {};
  // Global d'abord, puis surcharge guilde.
  for (const r of rows) if (r.guildId === null) weights[r.signalType] = r.weight;
  for (const r of rows) if (r.guildId === guildId) weights[r.signalType] = r.weight;

  weightsCache.set(guildId, { weights, expiresAt: Date.now() + WEIGHTS_TTL_MS });
  return weights;
}

export function invalidateWeightsCache(guildId: string): void {
  weightsCache.delete(guildId);
}

/** Multiplicateur de corroboration selon le nombre de familles distinctes. */
function corroborationMultiplier(distinctFamilies: number): number {
  if (distinctFamilies >= 4) return 1.25;
  if (distinctFamilies === 3) return 1.15;
  if (distinctFamilies === 2) return 1.05;
  return 1.0;
}

/**
 * Combine des signaux en un score final 0-100.
 * @param weights poids appris optionnels (défaut 1.0 par type).
 */
export function computeWeightedScore(
  signals: DcSignal[],
  weights: Record<string, number> = {},
): ScoreResult {
  if (signals.length === 0) {
    return { totalScore: 0, distinctFamilies: 0, familyBreakdown: {}, corroborationMultiplier: 1 };
  }

  // Groupe par famille en appliquant les poids.
  const byFamily = new Map<SignalFamily, number[]>();
  for (const s of signals) {
    const w = weights[s.type] ?? 1.0;
    const weighted = s.score * w;
    const fam = SIGNAL_FAMILY[s.type];
    const arr = byFamily.get(fam) ?? [];
    arr.push(weighted);
    byFamily.set(fam, arr);
  }

  // Score par famille : le plus fort + rendements décroissants sur le reste.
  const familyBreakdown: Partial<Record<SignalFamily, number>> = {};
  let base = 0;
  for (const [fam, scores] of byFamily) {
    scores.sort((a, b) => b - a);
    let famScore = scores[0];
    for (let i = 1; i < scores.length; i++) famScore += scores[i] * 0.3;
    familyBreakdown[fam] = Math.round(famScore);
    base += famScore;
  }

  const distinctFamilies = byFamily.size;
  const mult = corroborationMultiplier(distinctFamilies);
  const totalScore = Math.max(0, Math.min(100, Math.round(base * mult)));

  return { totalScore, distinctFamilies, familyBreakdown, corroborationMultiplier: mult };
}

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Classe un score en niveau de gravité, avec un seuil adaptatif :
 * sur les petits serveurs, la proximité de join/création est banale → on relève
 * légèrement les seuils pour limiter les faux positifs.
 */
export function classify(score: number, guildMemberCount: number): Severity {
  let highT = 60;
  let medT = 30;
  if (guildMemberCount < 100) {
    highT = 70;
    medT = 40;
  } else if (guildMemberCount > 5000) {
    highT = 55;
    medT = 25;
  }
  if (score >= highT) return 'HIGH';
  if (score >= medT) return 'MEDIUM';
  return 'LOW';
}
