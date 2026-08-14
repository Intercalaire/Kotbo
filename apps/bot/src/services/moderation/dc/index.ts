/**
 * dc/index.ts - Orchestrateur de l'analyse profonde de double comptes.
 *
 * Combine tous les analyseurs "intelligents" (comportemental, technique, vocal,
 * pattern quotidien) pour une paire candidat ↔ alts suspectés. Toutes les
 * sources sont en base (aucune dépendance à un objet Discord `member`), ce qui
 * permet de réutiliser l'analyse aussi bien à l'arrivée qu'au recalcul dashboard.
 */

import prisma from '../../../utils/db.js';
import type { DcSignal } from './types.js';
import { getBehavioralProfile } from './behavioralProfile.js';
import { comparePair } from './pairwiseSignals.js';
import { computeTechnicalSignals } from './technicalSignals.js';
import { computeVoiceSignals } from './voiceSignals.js';

export * from './types.js';
export { computeWeightedScore, loadSignalWeights, classify } from './scoring.js';
export type { ScoreResult, Severity } from './scoring.js';
export { logDetectionSample, recordDecision, recalibrateWeights } from './learning.js';
export { getBehavioralProfile, invalidateBehavioralProfile } from './behavioralProfile.js';

const MAX_ALTS_ANALYZED = 8;

// ─── Pattern d'activité quotidienne (MemberDailyStat) ──────────────────────────
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n === 0) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / (Math.sqrt(va) * Math.sqrt(vb));
}

async function computeDailyPatternSignals(
  guildId: string,
  userId: string,
  altIds: string[],
): Promise<DcSignal[]> {
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const dateKeyFloor = since.toISOString().slice(0, 10);

  const rows = await prisma.memberDailyStat
    .findMany({
      where: { guildId, userId: { in: [userId, ...altIds] }, dateKey: { gte: dateKeyFloor } },
      select: { userId: true, dateKey: true, messagesCount: true },
    })
    .catch(() => [] as { userId: string; dateKey: string; messagesCount: number }[]);

  const byUser = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = byUser.get(r.userId) ?? new Map<string, number>();
    m.set(r.dateKey, r.messagesCount);
    byUser.set(r.userId, m);
  }

  const mine = byUser.get(userId);
  if (!mine || mine.size < 10) return [];

  const signals: DcSignal[] = [];
  for (const altId of altIds) {
    const theirs = byUser.get(altId);
    if (!theirs || theirs.size < 10) continue;

    const allDays = new Set([...mine.keys(), ...theirs.keys()]);
    const va: number[] = [];
    const vb: number[] = [];
    for (const day of allDays) {
      va.push(mine.get(day) ?? 0);
      vb.push(theirs.get(day) ?? 0);
    }
    const corr = pearson(va, vb);
    if (corr >= 0.8) {
      signals.push({
        type: 'daily_pattern',
        score: Math.round((corr - 0.8) / 0.2 * 20),
        label: `Volume d'activité quotidien très corrélé à <@${altId}> (${Math.round(corr * 100)}%)`,
        matchedUserId: altId,
        detail: `Corrélation de Pearson des messages/jour = ${corr.toFixed(3)} sur ${allDays.size} jours.`,
      });
    }
  }
  return signals;
}

/**
 * Analyse profonde d'une paire candidat ↔ alts suspectés.
 * Retourne l'ensemble des signaux "intelligents" détectés (peut être vide).
 */
export async function runDeepAnalysis(
  guildId: string,
  userId: string,
  altIds: string[],
): Promise<DcSignal[]> {
  const alts = [...new Set(altIds.filter((id) => id && id !== userId))].slice(0, MAX_ALTS_ANALYZED);
  if (alts.length === 0) return [];

  const signals: DcSignal[] = [];

  // ── Comportemental (stylométrie, heatmap, cadence, mentions…) ──────────────
  const myProfile = await getBehavioralProfile(guildId, userId).catch(() => null);
  if (myProfile) {
    for (const altId of alts) {
      const altProfile = await getBehavioralProfile(guildId, altId).catch(() => null);
      if (altProfile) signals.push(...comparePair(myProfile, altProfile));
    }
  }

  // ── Technique, vocal, pattern quotidien (en parallèle) ─────────────────────
  const [tech, voice, daily] = await Promise.all([
    computeTechnicalSignals(guildId, userId, alts).catch(() => [] as DcSignal[]),
    computeVoiceSignals(guildId, userId, alts).catch(() => [] as DcSignal[]),
    computeDailyPatternSignals(guildId, userId, alts).catch(() => [] as DcSignal[]),
  ]);

  signals.push(...tech, ...voice, ...daily);
  return signals;
}
