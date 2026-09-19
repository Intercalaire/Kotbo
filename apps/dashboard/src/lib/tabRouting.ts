import { router } from 'tinro';

/**
 * `pathname` est explicite pour les appelants qui doivent recalculer a chaque
 * navigation : lu par defaut sur `window.location`, il echappe alors au suivi
 * de Svelte, et l'onglet reste fige sur celui d'origine pendant que l'URL, elle,
 * change bien. Passer `$router.path` rend la dependance visible et suivie.
 */
export function resolveTabFromUrl(
  basePath: string,
  validTabs: readonly string[],
  defaultTab: string,
  pathname: string = window.location.pathname,
): string {
  const prefix = basePath + '/';
  if (pathname.startsWith(prefix)) {
    const rawSegment = pathname.slice(prefix.length).split('/')[0];
    if (rawSegment) {
      // Le segment est encode par `gotoTab` : le decoder ici est le pendant
      // obligatoire. Une sequence de pourcentage invalide (URL tapee ou
      // tronquee a la main) ne doit jamais faire planter la navigation,
      // seulement retomber sur l'onglet par defaut.
      let segment: string;
      try {
        segment = decodeURIComponent(rawSegment);
      } catch {
        return defaultTab;
      }
      if ((validTabs as readonly string[]).includes(segment)) return segment;
    }
  }
  return defaultTab;
}

export function gotoTab(basePath: string, tab: string, defaultTab: string): void {
  // Encode : un libelle d'onglet accentue ou avec espace doit survivre a
  // l'aller-retour par l'URL. `resolveTabFromUrl` fait le decodage symetrique.
  router.goto(tab === defaultTab ? basePath : `${basePath}/${encodeURIComponent(tab)}`);
}
