import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `pageTabs.ts` est tenu a la main, a cote des pages qui declarent leurs
 * onglets. Il avait derive : `titres` (Economie), `modeles` (Concours),
 * `macros` (Tickets), `by-channel` et `access-requests` (Salons) etaient
 * absents, donc introuvables depuis la palette de commandes.
 *
 * Ce test lit les sources plutot que d'importer les pages : chaque page
 * appelle `resolveTabFromUrl('/base', tableau, ...)` avec un tableau litteral
 * de slugs, qu'on compare au registre. Il ne demande pas l'ordre, seulement
 * que chaque onglet d'une page existe dans le registre et inversement.
 */
const SRC = join(import.meta.dir, '..', '..');
const PAGES = join(SRC, 'pages');

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return svelteFiles(path);
    return name.endsWith('.svelte') ? [path] : [];
  });
}

function slugsOf(literal: string): string[] {
  return [...literal.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/** base -> slugs, tels que les pages les declarent. */
function tabsDeclaredByPages(): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  for (const file of svelteFiles(PAGES)) {
    const source = readFileSync(file, 'utf-8');
    for (const call of source.matchAll(/resolveTabFromUrl\(\s*'(\/[^']+)'\s*,\s*(\w+)/g)) {
      const [, base, variable] = call;
      const definition = source.match(
        new RegExp(`(?:const|let)\\s+${variable}\\b[^=]*=\\s*\\[([^\\]]*)\\]`),
      );
      // Un tableau calcule (Analytics derive le sien de ses categories) ne se
      // lit pas dans la source : il reste hors de ce test.
      if (!definition) continue;
      declared.set(base, slugsOf(definition[1]));
    }
  }
  return declared;
}

/** base -> slugs, tels que le registre les connait. */
function tabsInRegistry(): Map<string, string[]> {
  const source = readFileSync(join(SRC, 'lib', 'config', 'pageTabs.ts'), 'utf-8');
  const registry = new Map<string, string[]>();
  for (const entry of source.matchAll(/'(\/[^']+)':\s*\[([\s\S]*?)\n\s*\],/g)) {
    const [, base, body] = entry;
    registry.set(base, [...body.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1]));
  }
  return registry;
}

describe('pageTabs', () => {
  const declared = tabsDeclaredByPages();
  const registry = tabsInRegistry();

  test('les pages declarent bien des onglets (le test lit quelque chose)', () => {
    expect(declared.size).toBeGreaterThan(10);
  });

  for (const [base, slugs] of declared) {
    test(`${base} : le registre connait exactement les onglets de la page`, () => {
      expect(registry.has(base)).toBe(true);
      expect([...(registry.get(base) ?? [])].sort()).toEqual([...slugs].sort());
    });
  }
});
