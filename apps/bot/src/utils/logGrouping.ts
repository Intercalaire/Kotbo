/**
 * Les règles de regroupement des logs : comment une rafale d'événements
 * devient une ou plusieurs cartes.
 *
 * Trois questions, volontairement séparées — les confondre est ce qui rend un
 * regroupement inutilisable :
 *
 * 1. **Qu'est-ce qui crée une carte distincte ?** (`separerPar`) Deux salons
 *    vocaux, deux cartes — ou une seule, selon le réglage.
 * 2. **Comment est-ce ordonné et découpé à l'intérieur ?** (`sectionnerPar`)
 *    On peut vouloir une carte unique pour tous les salons, tout en gardant le
 *    tri par salon dedans : le premier salon en haut parce que c'est le
 *    premier à avoir bougé, le second en dessous.
 * 3. **Jusqu'où une carte peut-elle grossir ?** (`maxParCarte`, budget de
 *    caractères, fenêtre de temps) Au-delà, une **carte suivante** — jamais une
 *    troncature : un log tronqué est un log perdu, et c'est justement pendant
 *    les rafales qu'on en a besoin.
 *
 * Module feuille, entièrement pur : ni Discord, ni base, ni horloge. Le temps
 * est porté par les événements eux-mêmes.
 */

/** Les axes disponibles, qu'on peut employer pour séparer comme pour sectionner. */
export type AxeDeRegroupement = 'objet' | 'acteur' | 'type';

export interface EvenementAGrouper {
  /** Le type de log : `voice_join`, `message_delete`... */
  type: string;
  /** Ce sur quoi porte l'événement : le salon, le rôle, le message. */
  objetId: string | null;
  /** Qui a agi, quand on le sait. `null` n'est pas une valeur d'attribution. */
  acteurId: string | null;
  /** Instant des faits, en millisecondes. */
  survenuA: number;
  /** La ligne déjà rendue, telle qu'elle apparaîtra. */
  ligne: string;
}

export interface ReglesDeRegroupement {
  /**
   * Axes qui créent des cartes **distinctes**. Liste vide = tout tient dans la
   * même carte, sous réserve des plafonds.
   */
  separerPar: AxeDeRegroupement[];
  /**
   * Axes qui ne séparent **pas** les cartes mais ordonnent et découpent leur
   * contenu. Un axe présent dans `separerPar` y est sans effet : il a déjà
   * séparé, sectionner par lui redonnerait une section unique.
   */
  sectionnerPar: AxeDeRegroupement[];
  /** Nombre maximum de lignes dans une carte. Au-delà : carte suivante. */
  maxParCarte: number;
  /**
   * Durée maximale couverte par une carte. Une carte est close dès qu'un
   * événement survient plus de `fenetreMs` après le **premier** de cette carte.
   *
   * Une fenêtre glissante, et non des tranches fixes (`survenuA / fenetreMs`) :
   * avec des tranches, deux événements séparés d'une milliseconde tombent dans
   * deux cartes différentes s'ils encadrent une frontière.
   */
  fenetreMs?: number;
}

export interface SectionDeCarte {
  /**
   * L'axe qui a produit cette section, ou `null` quand la carte n'est pas
   * sectionnée du tout. `axe: 'objet', valeur: null` (événements sans salon) et
   * `axe: null` (aucun découpage demandé) sont deux choses différentes, et
   * l'appelant doit pouvoir les distinguer pour ne pas afficher un en-tête
   * qui ne veut rien dire.
   */
  axe: AxeDeRegroupement | null;
  /** Sa valeur — `null` quand l'événement ne la porte pas. */
  valeur: string | null;
  lignes: EvenementAGrouper[];
}

export interface CarteDeLogs {
  /** Identifie le groupe, indépendamment du numéro de suite. */
  cle: string;
  /** 1 pour la première carte du groupe, 2 pour son débordement, etc. */
  suite: number;
  sections: SectionDeCarte[];
  /** Nombre de lignes, toutes sections confondues. */
  total: number;
}

/**
 * Plafond imposé par Discord, pas par le réglage : un embed n'accepte pas plus
 * de 25 champs. Un réglage plus haut est ramené ici — silencieusement côté
 * moteur, et c'est à l'interface de le dire à l'administrateur.
 */
export const MAX_LIGNES_ABSOLU = 25;

/**
 * Budget de caractères pour le corps d'une carte. Discord plafonne la
 * description d'un embed à 4096 ; la marge laisse la place au titre, au pied de
 * page et aux en-têtes de section, qui s'ajoutent au même embed.
 */
export const BUDGET_CARACTERES = 3800;

function valeurDeLAxe(evenement: EvenementAGrouper, axe: AxeDeRegroupement): string | null {
  switch (axe) {
    case 'objet': return evenement.objetId;
    case 'acteur': return evenement.acteurId;
    case 'type': return evenement.type;
  }
}

/**
 * `null` et la chaîne « null » doivent rester distincts : un salon dont
 * l'identifiant serait littéralement « null » ne doit pas se retrouver mêlé aux
 * événements sans salon.
 */
function cleDesAxes(evenement: EvenementAGrouper, axes: AxeDeRegroupement[]): string {
  return axes
    .map((axe) => {
      const valeur = valeurDeLAxe(evenement, axe);
      return `${axe}=${valeur === null ? '\u0000absent' : `v:${valeur}`}`;
    })
    .join('|');
}

interface GroupeEnCours {
  cle: string;
  evenements: EvenementAGrouper[];
}

/**
 * Ordonne une rafale d'événements en cartes prêtes à rendre.
 *
 * L'ordre de sortie suit la **première apparition** : le groupe dont le premier
 * événement est le plus ancien vient en tête, et il en va de même des sections
 * à l'intérieur d'une carte. C'est ce qui rend la lecture naturelle — on
 * retrouve les choses dans l'ordre où elles se sont produites, pas dans un
 * ordre alphabétique d'identifiants.
 *
 * `maxParCarte: 1` reproduit exactement le comportement d'avant tout
 * regroupement : une carte par événement.
 */
export function grouperLogs(
  evenements: ReadonlyArray<EvenementAGrouper>,
  regles: ReglesDeRegroupement,
): CarteDeLogs[] {
  if (evenements.length === 0) return [];

  const plafond = Math.max(1, Math.min(regles.maxParCarte, MAX_LIGNES_ABSOLU));

  // Tri stable par instant : deux événements de même horodatage gardent l'ordre
  // dans lequel ils sont arrivés, qui est celui de la passerelle Discord.
  const ordonnes = [...evenements]
    .map((evenement, rang) => ({ evenement, rang }))
    .sort((a, b) => (a.evenement.survenuA - b.evenement.survenuA) || (a.rang - b.rang))
    .map(({ evenement }) => evenement);

  // Partition : l'ordre d'insertion d'une Map est celui de la première
  // apparition, c'est exactement l'ordre voulu.
  const groupes = new Map<string, GroupeEnCours>();
  for (const evenement of ordonnes) {
    const cle = cleDesAxes(evenement, regles.separerPar);
    const groupe = groupes.get(cle);
    if (groupe) groupe.evenements.push(evenement);
    else groupes.set(cle, { cle, evenements: [evenement] });
  }

  // Sectionner par un axe qui a déjà séparé ne produirait qu'une section
  // unique par carte : on l'écarte plutôt que de laisser une décoration vide.
  const axesDeSection = regles.sectionnerPar.filter((axe) => !regles.separerPar.includes(axe));

  const cartes: CarteDeLogs[] = [];
  for (const groupe of groupes.values()) {
    let suite = 0;
    let courante: EvenementAGrouper[] = [];
    let poids = 0;
    let debut = groupe.evenements[0].survenuA;

    const cloturer = () => {
      if (courante.length === 0) return;
      suite += 1;
      cartes.push({
        cle: groupe.cle,
        suite,
        sections: sectionner(courante, axesDeSection),
        total: courante.length,
      });
      courante = [];
      poids = 0;
    };

    for (const evenement of groupe.evenements) {
      const depasseLeNombre = courante.length >= plafond;
      const depasseLaFenetre = regles.fenetreMs !== undefined
        && courante.length > 0
        && evenement.survenuA - debut > regles.fenetreMs;
      // Une carte vide accepte toujours sa première ligne, même trop longue :
      // sans ça, une seule ligne démesurée ne serait jamais publiée.
      const depasseLeBudget = courante.length > 0 && poids + evenement.ligne.length > BUDGET_CARACTERES;

      if (depasseLeNombre || depasseLaFenetre || depasseLeBudget) {
        cloturer();
        debut = evenement.survenuA;
      }

      courante.push(evenement);
      poids += evenement.ligne.length;
    }

    cloturer();
  }

  return cartes;
}

/**
 * Découpe le contenu d'une carte. Sans axe de section, une section unique
 * contenant tout — la forme reste la même, l'appelant n'a pas deux cas à
 * traiter.
 */
function sectionner(
  evenements: EvenementAGrouper[],
  axes: AxeDeRegroupement[],
): SectionDeCarte[] {
  if (axes.length === 0) {
    return [{ axe: null, valeur: null, lignes: evenements }];
  }

  // Un seul axe de section : les axes suivants produiraient des sous-sections,
  // que l'embed Discord ne sait pas rendre — il n'a qu'un niveau de titre.
  const axe = axes[0];
  const sections = new Map<string, SectionDeCarte>();

  for (const evenement of evenements) {
    const valeur = valeurDeLAxe(evenement, axe);
    const cle = valeur === null ? '\u0000absent' : `v:${valeur}`;
    const section = sections.get(cle);
    if (section) section.lignes.push(evenement);
    else sections.set(cle, { axe, valeur, lignes: [evenement] });
  }

  return [...sections.values()];
}
