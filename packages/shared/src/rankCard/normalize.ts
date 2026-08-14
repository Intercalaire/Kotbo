import { DEFAULT_RANK_CARD_BACKGROUND_ID, RANK_CARD_BACKGROUNDS } from './presets.js';
import { DEFAULT_RANK_CARD_FONT_ID, RANK_CARD_FONTS } from './fonts.js';
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
};

/**
 * Ramène une entrée quelconque (corps de requête, colonne Json) à une
 * personnalisation sûre à dessiner. Toute valeur inconnue est écartée au lieu
 * de faire échouer le rendu : une carte par défaut vaut mieux qu'un `/rank`
 * cassé.
 */
export function normalizeRankCardCustomization(raw: unknown): RankCardCustomization {
  const candidate = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const backgroundId = typeof candidate.backgroundId === 'string'
    && RANK_CARD_BACKGROUNDS.some((preset) => preset.id === candidate.backgroundId)
    ? candidate.backgroundId
    : DEFAULT_RANK_CARD_BACKGROUND_ID;

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

  return { backgroundId, fontId, emojis };
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
