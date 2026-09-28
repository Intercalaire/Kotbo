/**
 * Chargement paresseux des pages du dashboard.
 *
 * Avant, `App.svelte` importait statiquement les ~120 pages : tout finissait
 * dans un unique chunk d'entree de 8,6 Mo, telecharge et parse avant le premier
 * rendu, quelle que soit la page demandee.
 *
 * Ici, chaque route ne connait que son `import()`. Le chunk correspondant n'est
 * telecharge qu'a la premiere visite, puis conserve en memoire pour que les
 * navigations suivantes soient instantanees (pas de re-affichage du squelette).
 */

import { trackJsError, trackRouteLoad } from './telemetry/telemetry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PageComponent = any;
export type RouteLoader = () => Promise<{ default: PageComponent }>;

/** Pages deja resolues, par motif de route. */
const componentCache = new Map<string, PageComponent>();
/** Chargements en cours, pour ne pas lancer deux fois le meme import. */
const inflight = new Map<string, Promise<PageComponent>>();
/** Motif de route -> loader, alimente par chaque <LazyRoute> a la construction. */
const loaderRegistry = new Map<string, RouteLoader>();

export function getCachedPage(pattern: string): PageComponent | null {
  return componentCache.get(pattern) ?? null;
}

export function registerRouteLoader(pattern: string, load: RouteLoader): void {
  loaderRegistry.set(pattern, load);
}

export function loadPage(pattern: string, load: RouteLoader): Promise<PageComponent> {
  const cached = componentCache.get(pattern);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(pattern);
  if (pending) return pending;

  const startedAt = performance.now();
  const request = load()
    .then((module) => {
      componentCache.set(pattern, module.default);
      inflight.delete(pattern);
      trackRouteLoad(performance.now() - startedAt);
      return module.default;
    })
    .catch((error) => {
      trackJsError('chunk_load');
      // On retire l'entree pour qu'un nouvel essai (navigation, reseau revenu)
      // puisse relancer l'import au lieu de rejouer l'echec en boucle.
      inflight.delete(pattern);
      throw error;
    });

  inflight.set(pattern, request);
  return request;
}

/**
 * Vrai si `target` (une URL concrete) correspond au motif de route `pattern`,
 * qui peut contenir des segments `:param` et se terminer par `*`.
 */
export function patternMatches(pattern: string, target: string): boolean {
  const patternParts = pattern.split('/').filter(Boolean);
  const targetParts = target.split('/').filter(Boolean);

  for (let i = 0; i < patternParts.length; i += 1) {
    const segment = patternParts[i];
    if (segment === '*') return true;
    if (targetParts[i] === undefined) return false;
    if (segment.startsWith(':')) continue;
    if (segment !== targetParts[i]) return false;
  }

  return patternParts.length === targetParts.length;
}

/**
 * Precharge le chunk de la page correspondant a un lien, sans l'afficher.
 * Appele au survol / focus des liens de navigation : au clic, le chunk est deja
 * la et la page s'affiche sans temps d'attente.
 *
 * Volontairement silencieux : un prefetch qui echoue ne doit rien casser, la
 * navigation reelle refera la tentative et affichera l'erreur si besoin.
 */
export function prefetchRoute(target: string | null | undefined): void {
  if (!target) return;

  const path = target.split('?')[0].split('#')[0];
  if (!path.startsWith('/')) return;

  const exact = loaderRegistry.get(path);
  if (exact) {
    void loadPage(path, exact).catch(() => {});
    return;
  }

  for (const [pattern, load] of loaderRegistry) {
    if (patternMatches(pattern, path)) {
      void loadPage(pattern, load).catch(() => {});
      return;
    }
  }
}
