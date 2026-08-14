/**
 * Polices proposées pour le pseudo de la carte `/rank`.
 *
 * Catalogue fermé, pour les mêmes raisons que les emojis : le canvas serveur ne
 * peut dessiner qu'une police qu'il a chargée. Chaque entrée non système
 * correspond à deux fichiers versionnés, `apps/bot/assets/rank-fonts/<id>.ttf`
 * pour le rendu et `apps/dashboard/public/rank-fonts/<id>.woff2` pour l'aperçu
 * du sélecteur. Les deux formats viennent de la même famille et de la même
 * graisse ; ils diffèrent parce que Skia ne lit pas le woff2 et qu'un TTF
 * complet serait dix fois trop lourd à télécharger dans un navigateur.
 *
 * Toutes sont retenues pour leur lisibilité à la taille du pseudo : pas de
 * capitales forcées, pas d'ultra-condensé, et des chiffres distincts des
 * lettres. Elles sont sous licence SIL OFL 1.1, dont le texte accompagne
 * chaque fichier côté bot.
 */
export type RankCardFontPreset = {
  id: string;
  label: { fr: string; en: string };
  /**
   * Nom de famille enregistré auprès du canvas et déclaré en `@font-face`.
   * `null` pour la police système, qui n'a aucun fichier à charger.
   */
  family: string | null;
};

/**
 * Repli commun. DejaVu est la seule police garantie dans l'image Alpine du bot,
 * et sa couverture large rattrape les pseudos que les familles latines
 * ci-dessous ne savent pas dessiner (cyrillique, grec, diacritiques rares).
 */
export const RANK_CARD_FONT_FALLBACK = '"DejaVu Sans", sans-serif';

export const RANK_CARD_FONTS: RankCardFontPreset[] = [
  { id: 'default', label: { fr: 'Par défaut', en: 'Default' }, family: null },
  { id: 'lato', label: { fr: 'Lato', en: 'Lato' }, family: 'Lato' },
  { id: 'poppins', label: { fr: 'Poppins', en: 'Poppins' }, family: 'Poppins' },
  { id: 'barlow', label: { fr: 'Barlow', en: 'Barlow' }, family: 'Barlow' },
  { id: 'kanit', label: { fr: 'Kanit', en: 'Kanit' }, family: 'Kanit' },
  { id: 'ptserif', label: { fr: 'PT Serif', en: 'PT Serif' }, family: 'PT Serif' },
  { id: 'arvo', label: { fr: 'Arvo', en: 'Arvo' }, family: 'Arvo' },
  { id: 'spacemono', label: { fr: 'Space Mono', en: 'Space Mono' }, family: 'Space Mono' },
];

export const DEFAULT_RANK_CARD_FONT_ID = 'default';

export function getRankCardFont(id: string | null | undefined): RankCardFontPreset {
  return RANK_CARD_FONTS.find((preset) => preset.id === id) ?? RANK_CARD_FONTS[0];
}

/** Pile de familles à passer à `ctx.font` ou à une règle CSS. */
export function rankCardFontStack(preset: RankCardFontPreset): string {
  return preset.family ? `"${preset.family}", ${RANK_CARD_FONT_FALLBACK}` : RANK_CARD_FONT_FALLBACK;
}
