/**
 * Le parcours de configuration, en un seul point d'entree.
 *
 * Six fichiers, six responsabilites : l'ordre des ecrans (`steps`), ce qu'on
 * choisit de configurer (`tracks`), la matiere qu'ils presentent (`presets`,
 * `modulePresets`), les roles que le parcours sait creer lui-meme (`ladders`),
 * ce que la maquette pose sur Discord (`plan`) et ce qui recompense
 * (`celebrate`). Les ecrans importent d'ici, jamais des fichiers un
 * a un : deplacer une constante d'un fichier a l'autre ne doit pas se payer en
 * imports a corriger dans vingt composants.
 */
export * from './steps';
export * from './tracks';
export * from './presets';
export * from './ladders';
export * from './modulePresets';
export * from './plan';
export * from './celebrate';
