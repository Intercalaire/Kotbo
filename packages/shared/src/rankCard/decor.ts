import type { RankCardDecorPreset } from './types.js';

export const RANK_CARD_FRAMES: RankCardDecorPreset[] = [
  { id: 'classic', label: { fr: 'Classique', en: 'Classic' } },
  { id: 'double', label: { fr: 'Double anneau', en: 'Double ring' } },
  { id: 'dashed', label: { fr: 'Segments', en: 'Segments' } },
  { id: 'glow', label: { fr: 'Halo', en: 'Glow' } },
  { id: 'laurel', label: { fr: 'Lauriers', en: 'Laurels' }, unlockedBy: 'level_50' },
  { id: 'prism', label: { fr: 'Prisme', en: 'Prism' }, unlockedBy: 'supporter_6' },
  { id: 'crown', label: { fr: 'Couronne', en: 'Crown' }, unlockedBy: 'kotbo_staff' },
];

export const RANK_CARD_PATTERNS: RankCardDecorPreset[] = [
  { id: 'none', label: { fr: 'Aucun', en: 'None' } },
  { id: 'grid', label: { fr: 'Grille', en: 'Grid' } },
  { id: 'dots', label: { fr: 'Points', en: 'Dots' } },
  { id: 'diagonal', label: { fr: 'Diagonales', en: 'Diagonals' } },
  { id: 'hexagons', label: { fr: 'Hexagones', en: 'Hexagons' } },
  { id: 'stars', label: { fr: 'Constellation', en: 'Constellation' }, unlockedBy: 'starboard_10' },
];

export const RANK_CARD_BAR_STYLES: RankCardDecorPreset[] = [
  { id: 'solid', label: { fr: 'Pleine', en: 'Solid' } },
  { id: 'segmented', label: { fr: 'Segmentée', en: 'Segmented' } },
  { id: 'striped', label: { fr: 'Rayée', en: 'Striped' } },
];

export const DEFAULT_RANK_CARD_FRAME_ID = 'classic';
export const DEFAULT_RANK_CARD_PATTERN_ID = 'none';
export const DEFAULT_RANK_CARD_BAR_STYLE_ID = 'solid';
