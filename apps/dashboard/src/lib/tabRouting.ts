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
    const segment = pathname.slice(prefix.length).split('/')[0];
    if (segment && (validTabs as readonly string[]).includes(segment)) return segment;
  }
  return defaultTab;
}

export function gotoTab(basePath: string, tab: string, defaultTab: string): void {
  router.goto(tab === defaultTab ? basePath : `${basePath}/${tab}`);
}
