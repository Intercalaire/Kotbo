/**
 * dc/pairwiseSignals.ts
 *
 * Compare deux profils comportementaux et produit des signaux :
 *  - stylometry_match      : style d'écriture quasi identique (cosinus des mots-outils)
 *  - ngram_match           : trigrammes de caractères communs (Jaccard)
 *  - activity_heatmap      : corrélation des heatmaps d'activité 7×24
 *  - temporal_exclusivity  : jamais actifs à la même minute (alternance)
 *  - cadence_match         : longueur/rythme/emojis de messages identiques
 *  - mention_network       : mentionnent les mêmes personnes (Jaccard)
 *  - never_interact        : fréquentent les mêmes salons mais ne se parlent jamais
 */

import type { BehavioralProfile, DcSignal } from './types.js';

// ─── Helpers mathématiques ──────────────────────────────────────────────────────
function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k] || 0;
    const vb = b[k] || 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / (Math.sqrt(va) * Math.sqrt(vb));
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function intersectionSize<T>(a: Set<T>, b: Set<T>): number {
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter;
}

function windowsOverlap(a: BehavioralProfile, b: BehavioralProfile): boolean {
  return a.firstMessageAt <= b.lastMessageAt && b.firstMessageAt <= a.lastMessageAt;
}

/**
 * Compare deux profils. `label` référence l'ID du profil B (l'alt suspecté).
 */
export function comparePair(a: BehavioralProfile, b: BehavioralProfile): DcSignal[] {
  const signals: DcSignal[] = [];
  const bId = b.userId;

  // ── Stylométrie (mots-outils) ─────────────────────────────────────────────
  const styleCos = cosine(a.styleVector, b.styleVector);
  if (styleCos >= 0.9) {
    signals.push({
      type: 'stylometry_match',
      score: Math.round((styleCos - 0.9) * 10 * 50), // 0.9→0, 1.0→50
      label: `Style d'écriture quasi identique à <@${bId}> (${Math.round(styleCos * 100)}%)`,
      matchedUserId: bId,
      detail: `Cosinus des fréquences de mots-outils = ${styleCos.toFixed(3)}. Robuste au changement de pseudo/avatar.`,
    });
  }

  // ── N-grammes de caractères ───────────────────────────────────────────────
  const ngramJac = jaccard(a.trigrams, b.trigrams);
  if (ngramJac >= 0.5) {
    signals.push({
      type: 'ngram_match',
      score: Math.round((ngramJac - 0.5) * 2 * 35), // 0.5→0, 1.0→35
      label: `Tics d'écriture (trigrammes) communs avec <@${bId}> (${Math.round(ngramJac * 100)}%)`,
      matchedUserId: bId,
      detail: `Jaccard des trigrammes de caractères = ${ngramJac.toFixed(3)}.`,
    });
  }

  // ── Heatmap d'activité ────────────────────────────────────────────────────
  const heatCorr = pearson(a.heatmap, b.heatmap);
  if (heatCorr >= 0.7) {
    signals.push({
      type: 'activity_heatmap',
      score: Math.round((heatCorr - 0.7) / 0.3 * 30),
      label: `Empreinte horaire (7×24) fortement corrélée à <@${bId}> (${Math.round(heatCorr * 100)}%)`,
      matchedUserId: bId,
      detail: `Corrélation de Pearson des heatmaps = ${heatCorr.toFixed(3)}.`,
    });
  }

  // ── Exclusivité temporelle (alternance) ───────────────────────────────────
  if (windowsOverlap(a, b) && a.activeMinutes.size >= 40 && b.activeMinutes.size >= 40) {
    const collisions = intersectionSize(a.activeMinutes, b.activeMinutes);
    const minActive = Math.min(a.activeMinutes.size, b.activeMinutes.size);
    const collisionRate = collisions / minActive;
    // Presque jamais actifs la même minute alors que les deux sont très actifs.
    if (collisionRate < 0.03) {
      const score = 35 + Math.min(15, Math.floor(minActive / 50)); // plus ils sont actifs, plus c'est fort
      signals.push({
        type: 'temporal_exclusivity',
        score,
        label: `Activité mutuellement exclusive avec <@${bId}> (jamais en ligne en même temps)`,
        matchedUserId: bId,
        detail: `${collisions} minute(s) d'activité commune sur ${minActive} - un humain ne peut pas parler avec ses deux comptes simultanément.`,
      });
    }
  }

  // ── Cadence de messages ───────────────────────────────────────────────────
  const ca = a.cadence;
  const cb = b.cadence;
  const lenSim = 1 - Math.min(1, Math.abs(ca.avgLength - cb.avgLength) / Math.max(1, ca.avgLength, cb.avgLength));
  const emojiSim = 1 - Math.min(1, Math.abs(ca.emojiRate - cb.emojiRate) / Math.max(0.01, ca.emojiRate, cb.emojiRate));
  const capsSim = 1 - Math.min(1, Math.abs(ca.capsRate - cb.capsRate) / Math.max(0.01, ca.capsRate, cb.capsRate));
  const punctSim = 1 - Math.min(1, Math.abs(ca.punctuationRate - cb.punctuationRate) / Math.max(0.01, ca.punctuationRate, cb.punctuationRate));
  const cadenceSim = (lenSim + emojiSim + capsSim + punctSim) / 4;
  if (cadenceSim >= 0.85) {
    signals.push({
      type: 'cadence_match',
      score: Math.round((cadenceSim - 0.85) / 0.15 * 25),
      label: `Cadence de messages identique à <@${bId}> (longueur, emojis, majuscules)`,
      matchedUserId: bId,
      detail: `Similarité de cadence = ${(cadenceSim * 100).toFixed(0)}% (longueur ${lenSim.toFixed(2)}, emojis ${emojiSim.toFixed(2)}, majuscules ${capsSim.toFixed(2)}, ponctuation ${punctSim.toFixed(2)}).`,
    });
  }

  // ── Réseau de mentions ────────────────────────────────────────────────────
  const mentionJac = jaccard(a.mentions, b.mentions);
  if (mentionJac >= 0.4 && intersectionSize(a.mentions, b.mentions) >= 3) {
    signals.push({
      type: 'mention_network',
      score: Math.round(mentionJac * 35),
      label: `Interagit avec les mêmes personnes que <@${bId}> (${Math.round(mentionJac * 100)}%)`,
      matchedUserId: bId,
      detail: `Jaccard des mentions = ${mentionJac.toFixed(3)}. Voisinage social quasi identique.`,
    });
  }

  // ── Ne se parlent jamais malgré des salons communs ───────────────────────
  const sharedChannels = intersectionSize(a.channels, b.channels);
  const aMentionsB = a.mentions.has(b.userId);
  const bMentionsA = b.mentions.has(a.userId);
  if (sharedChannels >= 2 && !aMentionsB && !bMentionsA && windowsOverlap(a, b)) {
    signals.push({
      type: 'never_interact',
      score: 20,
      label: `Fréquente ${sharedChannels} salon(s) commun(s) avec <@${bId}> mais ne lui parle jamais`,
      matchedUserId: bId,
      detail: `Deux comptes actifs dans les mêmes salons qui ne s'adressent jamais la parole - typique d'un compte et son alt.`,
    });
  }

  return signals;
}
