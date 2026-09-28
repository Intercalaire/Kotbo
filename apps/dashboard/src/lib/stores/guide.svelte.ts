/**
 * « Me guider » : emmene le lecteur sur la page d'un reglage et lui montre le
 * champ a remplir.
 *
 * Un lien seul posait le lecteur en haut d'une page de trente reglages, a lui
 * de trouver le bon. Ici, l'appelant designe un repere - un element marque
 * `data-guide="<id>"` dans la page cible - et `GuideSpotlight`, monte une fois
 * dans le layout, le fait defiler jusqu'a lui et l'entoure avec une bulle
 * d'explication.
 *
 * Une page qui range son reglage dans une section repliee lit `guide.target`
 * pour la deplier : le repere n'existe pas tant que la section est fermee.
 */
import { router } from 'tinro';

export type GuideRequest = {
  /** Valeur de `data-guide` sur l'element a montrer. */
  target: string;
  /** Page du reglage, onglet compris : `/logs/config`. */
  href: string;
  title: string;
  body: string;
};

type ActiveGuide = GuideRequest & { path: string; startedAt: number };

let active = $state<ActiveGuide | null>(null);

export const guide = {
  get active(): ActiveGuide | null {
    return active;
  },

  get target(): string | null {
    return active?.target ?? null;
  },

  start(request: GuideRequest) {
    const path = request.href.split(/[?#]/)[0];
    active = { ...request, path, startedAt: Date.now() };
    router.goto(request.href);
  },

  stop() {
    active = null;
  },
};
