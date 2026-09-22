/**
 * Comparaison d'un objet avec l'équipement porté.
 *
 * Seules les stats brutes sont comparées, forge comprise : les enchantements suivent
 * l'exemplaire et non l'objet, et ceux en pourcentage dépendent de tout le reste du
 * personnage. Les inclure donnerait un écart faux dès qu'on change d'arme.
 */

import type { PieceStats } from './rpgStats.js';

export const PIECE_STAT_KEYS = ['atk', 'def', 'spd', 'hp'] as const;

export type StatComparison = { stat: (typeof PIECE_STAT_KEYS)[number]; value: number; delta: number };

/**
 * Écart stat par stat entre l'objet regardé et celui qu'il remplacerait. `worn` vaut
 * `null` pour un emplacement libre : tout ce que l'objet apporte est alors un gain.
 * Une stat nulle des deux côtés est omise.
 */
export function compareStats(candidate: PieceStats, worn: PieceStats | null): StatComparison[] {
  return PIECE_STAT_KEYS
    .map((stat) => ({ stat, value: candidate[stat], delta: candidate[stat] - (worn?.[stat] ?? 0) }))
    .filter((line) => line.value !== 0 || line.delta !== 0);
}
