import { DEFAULT_RANK_CARD_BACKGROUND_ID, RANK_CARD_BACKGROUNDS } from './presets.js';
import { DEFAULT_RANK_CARD_FONT_ID, RANK_CARD_FONTS } from './fonts.js';
import {
  DEFAULT_RANK_CARD_BAR_STYLE_ID,
  DEFAULT_RANK_CARD_FRAME_ID,
  DEFAULT_RANK_CARD_PATTERN_ID,
  RANK_CARD_BAR_STYLES,
  RANK_CARD_FRAMES,
  RANK_CARD_PATTERNS,
} from './decor.js';
import { getRankCardAchievement, isRankCardItemUnlocked, RANK_CARD_MAX_BADGES } from './achievements.js';
import type { RankCardCustomization } from './types.js';

export const RANK_CARD_MAX_EMOJIS = 3;

/** Dimensions de référence de la carte. */
export const RANK_CARD_WIDTH = 934;
export const RANK_CARD_HEIGHT = 282;

/**
 * Catalogue fermé : le canvas serveur n'a pas de police couleur, chaque emoji
 * doit donc correspondre à un asset Twemoji connu. Les points de code sont
 * figés ici plutôt que dérivés du caractère, pour éviter les surprises des
 * sélecteurs de variante et des séquences ZWJ.
 *
 * Les PNG correspondants (Twemoji 16.0.1) sont versionnés dans les deux
 * applications : `apps/bot/assets/rank-emojis` pour le canvas, et
 * `apps/dashboard/public/rank-emojis` pour la grille de sélection. Ajouter une
 * entrée ici sans y déposer le fichier fait disparaître l'emoji du rendu.
 */
export const RANK_CARD_EMOJIS: Array<{ value: string; codePoint: string }> = [
  { value: '🔥', codePoint: '1f525' },
  { value: '⭐', codePoint: '2b50' },
  { value: '⚡', codePoint: '26a1' },
  { value: '✨', codePoint: '2728' },
  { value: '💎', codePoint: '1f48e' },
  { value: '👑', codePoint: '1f451' },
  { value: '🏆', codePoint: '1f3c6' },
  { value: '🚀', codePoint: '1f680' },
  { value: '🎯', codePoint: '1f3af' },
  { value: '🎮', codePoint: '1f3ae' },
  { value: '🎧', codePoint: '1f3a7' },
  { value: '🌙', codePoint: '1f319' },
  { value: '🪐', codePoint: '1fa90' },
  { value: '🌊', codePoint: '1f30a' },
  { value: '🍀', codePoint: '1f340' },
  { value: '🌸', codePoint: '1f338' },
  { value: '🐺', codePoint: '1f43a' },
  { value: '🦊', codePoint: '1f98a' },
  { value: '🧊', codePoint: '1f9ca' },
  { value: '💀', codePoint: '1f480' },
];

const EMOJI_CODE_POINTS = new Map(RANK_CARD_EMOJIS.map((emoji) => [emoji.value, emoji.codePoint]));

export const DEFAULT_RANK_CARD_CUSTOMIZATION: RankCardCustomization = {
  backgroundId: DEFAULT_RANK_CARD_BACKGROUND_ID,
  fontId: DEFAULT_RANK_CARD_FONT_ID,
  emojis: [],
  frameId: DEFAULT_RANK_CARD_FRAME_ID,
  patternId: DEFAULT_RANK_CARD_PATTERN_ID,
  barStyleId: DEFAULT_RANK_CARD_BAR_STYLE_ID,
  titleId: null,
  badges: [],
};

const NO_ACHIEVEMENTS: ReadonlySet<string> = new Set();

function pickPreset(
  value: unknown,
  presets: Array<{ id: string; unlockedBy?: string }>,
  fallback: string,
  unlocked: ReadonlySet<string>,
): string {
  if (typeof value !== 'string') return fallback;
  const preset = presets.find((entry) => entry.id === value);
  return preset && isRankCardItemUnlocked(preset.unlockedBy, unlocked) ? preset.id : fallback;
}

/**
 * Ramène une entrée quelconque (corps de requête, colonne Json) à une
 * personnalisation sûre à dessiner. Toute valeur inconnue est écartée au lieu
 * de faire échouer le rendu : une carte par défaut vaut mieux qu'un `/rank`
 * cassé.
 *
 * `unlocked` liste les succès acquis. Vide par défaut, pour qu'un appelant qui
 * oublie de le fournir n'ouvre jamais un élément réservé : il le retire.
 */
export function normalizeRankCardCustomization(
  raw: unknown,
  unlocked: ReadonlySet<string> = NO_ACHIEVEMENTS,
): RankCardCustomization {
  const candidate = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const backgroundId = pickPreset(candidate.backgroundId, RANK_CARD_BACKGROUNDS, DEFAULT_RANK_CARD_BACKGROUND_ID, unlocked);
  const frameId = pickPreset(candidate.frameId, RANK_CARD_FRAMES, DEFAULT_RANK_CARD_FRAME_ID, unlocked);
  const patternId = pickPreset(candidate.patternId, RANK_CARD_PATTERNS, DEFAULT_RANK_CARD_PATTERN_ID, unlocked);
  const barStyleId = pickPreset(candidate.barStyleId, RANK_CARD_BAR_STYLES, DEFAULT_RANK_CARD_BAR_STYLE_ID, unlocked);

  const titleId = typeof candidate.titleId === 'string'
    && getRankCardAchievement(candidate.titleId)
    && unlocked.has(candidate.titleId)
    ? candidate.titleId
    : null;

  const fontId = typeof candidate.fontId === 'string'
    && RANK_CARD_FONTS.some((preset) => preset.id === candidate.fontId)
    ? candidate.fontId
    : DEFAULT_RANK_CARD_FONT_ID;

  const seen = new Set<string>();
  const emojis: string[] = [];
  if (Array.isArray(candidate.emojis)) {
    for (const entry of candidate.emojis) {
      if (typeof entry !== 'string' || !EMOJI_CODE_POINTS.has(entry) || seen.has(entry)) continue;
      seen.add(entry);
      emojis.push(entry);
      if (emojis.length >= RANK_CARD_MAX_EMOJIS) break;
    }
  }

  const badges: string[] = [];
  if (Array.isArray(candidate.badges)) {
    for (const entry of candidate.badges) {
      if (typeof entry !== 'string' || !getRankCardAchievement(entry) || !unlocked.has(entry) || badges.includes(entry)) continue;
      badges.push(entry);
      if (badges.length >= RANK_CARD_MAX_BADGES) break;
    }
  }

  return { backgroundId, fontId, emojis, frameId, patternId, barStyleId, titleId, badges };
}

/** Point de code Twemoji, ou `null` si l'emoji n'est pas au catalogue. */
export function rankCardEmojiCodePoint(value: string): string | null {
  return EMOJI_CODE_POINTS.get(value) ?? null;
}

/** Chemin de l'asset servi par le dashboard, ou `null` hors catalogue. */
export function rankCardEmojiImageUrl(value: string): string | null {
  const codePoint = EMOJI_CODE_POINTS.get(value);
  if (!codePoint) return null;
  return `/rank-emojis/${codePoint}.png`;
}
