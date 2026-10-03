/**
 * Ramène une URL du dashboard à ce que la télémétrie a le droit de retenir :
 * la page déclarée dans `pages.ts` (préfixe le plus long), l'onglet s'il est
 * déclaré dans `pageTabs.ts`, et le module (`featureKey`) de la page.
 *
 * Tout ce qui dépasse est jeté : identifiants de membre, de salon, jetons des
 * pages publiques. Une URL absente du registre n'est pas tracée du tout, ce
 * qui écarte d'office les pages publiques (/verify, /form, /appeal…) et
 * l'administration globale.
 */

export type TelemetryPageRegistry = {
  pages: ReadonlyArray<{ href: string; featureKey?: string }>;
  tabs: Readonly<Record<string, ReadonlyArray<{ id: string }>>>;
};

export type TelemetryPage = { page: string; tab: string; feature: string };

/** Pages hors barre latérale qui méritent d'être comptées. */
const EXTRA_PAGES: ReadonlyArray<{ href: string; featureKey?: string }> = [
  { href: '/servers', featureKey: 'servers' },
];

/** Minuscules sans accents, seulement [a-z0-9_-] : la forme que le bot accepte. */
export function telemetrySlug(value: string, maxLength = 40): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

type Compiled = Array<{ path: string; featureKey: string; tabIds: Set<string> }>;
const compiledCache = new WeakMap<TelemetryPageRegistry, Compiled>();

function compile(registry: TelemetryPageRegistry): Compiled {
  const cached = compiledCache.get(registry);
  if (cached) return cached;
  const seen = new Set<string>();
  const compiled: Compiled = [];
  for (const page of [...registry.pages, ...EXTRA_PAGES]) {
    const path = page.href.split('?')[0]!;
    if (!path.startsWith('/') || seen.has(path)) continue;
    seen.add(path);
    compiled.push({
      path,
      featureKey: page.featureKey ?? '',
      tabIds: new Set((registry.tabs[page.href] ?? registry.tabs[path] ?? []).map((t) => t.id)),
    });
  }
  compiled.sort((a, b) => b.path.length - a.path.length);
  compiledCache.set(registry, compiled);
  return compiled;
}

export function resolveTelemetryPage(pathname: string, registry: TelemetryPageRegistry): TelemetryPage | null {
  const path = pathname.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';

  for (const entry of compile(registry)) {
    const matches = path === entry.path || (entry.path !== '/' && path.startsWith(`${entry.path}/`));
    if (!matches) continue;

    let tab = '';
    if (path !== entry.path) {
      const segment = safeDecode(path.slice(entry.path.length + 1).split('/')[0] ?? '');
      if (entry.tabIds.has(segment)) tab = telemetrySlug(segment);
    }
    return { page: entry.path, tab, feature: telemetrySlug(entry.featureKey, 48) };
  }
  return null;
}
