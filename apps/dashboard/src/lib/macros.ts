/**
 * Variable insérable dans un gabarit de message.
 *
 * Le type vit ici plutôt que dans le composant : les pages qui dressent leurs
 * listes de variables n'ont pas à importer un composant pour en parler.
 */
export type MacroOption = {
  /** Écriture exacte attendue par le bot, accolades comprises. */
  token: string;
  /** Ce que la variable affiche, montré au survol. */
  label: string;
};
