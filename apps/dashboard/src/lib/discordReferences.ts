/**
 * Une reference Discord enregistree - salon, role, categorie - qui ne
 * correspond plus a rien dans la liste du serveur : supprimee, ou devenue
 * invisible au bot.
 *
 * Le reglage reste en base et sera reenregistre tel quel, alors qu'il ne
 * s'applique plus a personne. Les selecteurs ne peuvent pas le dire : faute de
 * retrouver la valeur dans leurs options, ils affichent leur texte d'invite
 * comme si le champ etait vide.
 */
export function isMissingReference(id: string, options: Array<{ id: string }>): boolean {
  // Une liste vide veut dire « pas encore chargee », pas « reference perdue » :
  // sans cette garde, toute la page s'alarmerait a chaque chargement.
  return !!id && options.length > 0 && !options.some((option) => option.id === id);
}
