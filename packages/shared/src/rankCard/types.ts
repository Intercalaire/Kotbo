/**
 * Personnalisation de la carte `/rank`.
 *
 * La préférence est globale à l'utilisateur (elle le suit d'un serveur à
 * l'autre) : seules les données de progression affichées dessus (niveau, XP,
 * rang) restent propres au serveur où la commande est lancée.
 */

export type RankCardStopColor = { offset: number; color: string };

export type RankCardGlow = {
  /** Position du centre, en fraction de la largeur / hauteur de la carte. */
  x: number;
  y: number;
  /** Rayon en pixels sur la carte de référence (934x282). */
  radius: number;
  color: string;
};

export type RankCardBackgroundPreset = {
  id: string;
  /** Libellé affiché dans le dashboard, en français puis en anglais. */
  label: { fr: string; en: string };
  /** Dégradé de fond, tracé en diagonale du coin haut-gauche au coin bas-droit. */
  gradient: RankCardStopColor[];
  /** Halos radiaux dessinés par-dessus le dégradé. */
  glows: RankCardGlow[];
  /** Dégradé horizontal des liserés haut et bas. */
  accentBar: RankCardStopColor[];
  /** Couleur de remplissage du disque derrière l'avatar. */
  avatarBackdrop: string;
};

/**
 * Les emojis ne sont pas positionnables : le rendu les aligne lui-même dans la
 * bande décorative sous le pseudo. L'utilisateur choisit seulement lesquels et
 * dans quel ordre.
 */
export type RankCardCustomization = {
  backgroundId: string;
  /** Police du pseudo. Le reste de la carte garde une police neutre. */
  fontId: string;
  emojis: string[];
};
