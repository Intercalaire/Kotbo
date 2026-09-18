import { describe, test, expect, mock } from 'bun:test';

/**
 * `tabRouting.ts` importe `tinro` uniquement pour `router.goto`, qui delegue
 * a `history.pushState`. On mock le module plutot que d'ajouter jsdom comme
 * dependance de test : `gotoTab` est verifiee par ce qu'elle passe a
 * `router.goto`, jamais par un vrai changement d'URL DOM.
 *
 * IMPORTANT : un mock qui se contente d'enregistrer la chaine brute passee a
 * `goto()` ne prouve RIEN sur ce bug. Le bug n'existe que parce qu'un vrai
 * navigateur re-encode le pathname entre l'ecriture (`history.pushState`) et
 * la lecture (`window.location.pathname`) : tout caractere hors de l'espace
 * "path-safe" de l'URL (non-ASCII, espace...) est percent-encode en UTF-8,
 * un `%XY` deja valide etant lui laisse intact. `browserNormalizePathname`
 * simule ce comportement pour que le mock reproduise fidelement la panne.
 */
function browserNormalizePathname(raw: string): string {
  const SAFE = /[A-Za-z0-9\-_.~!$&'()*+,;=:@/]/;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '%' && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      out += raw.slice(i, i + 3);
      i += 2;
      continue;
    }
    out += SAFE.test(ch) ? ch : encodeURIComponent(ch);
  }
  return out;
}

const lastUrl = { value: '' };
const gotoMock = mock((path: string) => {
  lastUrl.value = browserNormalizePathname(path);
});
mock.module('tinro', () => ({
  router: { goto: gotoMock },
}));

// Import dynamique : le mock doit etre enregistre avant que `tabRouting.ts`
// (qui fait `import { router } from 'tinro'`) ne soit charge.
const { resolveTabFromUrl, gotoTab } = await import('./tabRouting');

const BASE = '/inbox';
// Libelles reels de l'Inbox (Inbox.svelte) : ce sont les valeurs qui
// transitent par l'URL, pas seulement des libelles d'affichage traduits.
const INBOX_TABS = ['tous', 'modération', 'recrutement', 'staff', 'système'] as const;

/** Chemin tel qu'un vrai navigateur le rendrait dans `window.location.pathname`
 *  apres le dernier appel de `gotoTab`. */
function lastGotoPath(): string {
  expect(gotoMock.mock.calls.length).toBeGreaterThan(0);
  return lastUrl.value;
}

describe('tabRouting: aller-retour URL par onglet', () => {
  test('onglet accentue « modération » : aller-retour identique (LE cas rouge avant correctif)', () => {
    gotoTab(BASE, 'modération', 'tous');
    const path = lastGotoPath();
    const resolved = resolveTabFromUrl(BASE, INBOX_TABS, 'tous', path);
    expect(resolved).toBe('modération');
  });

  test('onglet accentue « système » : aller-retour identique (LE cas rouge avant correctif)', () => {
    gotoTab(BASE, 'système', 'tous');
    const path = lastGotoPath();
    const resolved = resolveTabFromUrl(BASE, INBOX_TABS, 'tous', path);
    expect(resolved).toBe('système');
  });

  test('onglet ASCII pur : continue de fonctionner (temoin de non-regression)', () => {
    gotoTab(BASE, 'staff', 'tous');
    const path = lastGotoPath();
    expect(path).toBe('/inbox/staff');
    const resolved = resolveTabFromUrl(BASE, INBOX_TABS, 'tous', path);
    expect(resolved).toBe('staff');
  });

  test('onglet inconnu : retombe sur la valeur par defaut', () => {
    const resolved = resolveTabFromUrl(BASE, INBOX_TABS, 'tous', '/inbox/nexistepas');
    expect(resolved).toBe('tous');
  });

  test('URL malformee (sequence de pourcentage invalide) : ne jette pas, retombe sur le defaut', () => {
    // %E9 est un octet UTF-8 isole invalide : decodeURIComponent leve
    // normalement une URIError ("URI malformed"). resolveTabFromUrl doit
    // l'avaler et retomber proprement, jamais laisser l'exception remonter.
    expect(() => resolveTabFromUrl(BASE, INBOX_TABS, 'tous', '/inbox/%E9')).not.toThrow();
    const resolved = resolveTabFromUrl(BASE, INBOX_TABS, 'tous', '/inbox/%E9');
    expect(resolved).toBe('tous');
  });

  test("libelle contenant une barre oblique : l'encodage empeche la coupure du chemin", () => {
    // CASSE SI: `gotoTab` cesse d'encoder le libelle. C'est le seul cas ou
    // l'encodage est porteur : un navigateur percent-encode de lui-meme les
    // accents et les espaces, mais PAS la barre oblique, qui est un separateur
    // de chemin legitime. Sans encodage, « signalements/urgents » devient deux
    // segments et `resolveTabFromUrl` ne verrait que « signalements ».
    const tabs = ['tous', 'signalements/urgents'] as const;
    gotoTab(BASE, 'signalements/urgents', 'tous');
    const path = lastGotoPath();
    expect(path).toBe('/inbox/signalements%2Furgents');
    const resolved = resolveTabFromUrl(BASE, tabs, 'tous', path);
    expect(resolved).toBe('signalements/urgents');
  });

  test('libelle avec espace : aller-retour identique', () => {
    const tabs = ['tous', 'sous menu'] as const;
    gotoTab(BASE, 'sous menu', 'tous');
    const path = lastGotoPath();
    const resolved = resolveTabFromUrl(BASE, tabs, 'tous', path);
    expect(resolved).toBe('sous menu');
  });

  test('libelle avec accent ET espace : aller-retour identique', () => {
    const tabs = ['tous', 'système avancé'] as const;
    gotoTab(BASE, 'système avancé', 'tous');
    const path = lastGotoPath();
    const resolved = resolveTabFromUrl(BASE, tabs, 'tous', path);
    expect(resolved).toBe('système avancé');
  });

  test('onglet = defaut : gotoTab ecrit le basePath nu, sans segment', () => {
    gotoTab(BASE, 'tous', 'tous');
    const path = lastGotoPath();
    expect(path).toBe('/inbox');
    const resolved = resolveTabFromUrl(BASE, INBOX_TABS, 'tous', path);
    expect(resolved).toBe('tous');
  });
});
