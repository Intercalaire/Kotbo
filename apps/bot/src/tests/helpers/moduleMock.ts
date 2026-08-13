import { readFileSync } from 'node:fs';

/**
 * Aide a construire des mocks de module COMPLETS.
 *
 * `mock.module` de bun est global au process et remplace integralement le
 * module vise. Un mock partiel (qui ne declare que les deux ou trois exports
 * dont un test a besoin) fait donc disparaitre tous les autres exports pour
 * l'ensemble des fichiers de test charges ensuite - qui echouent alors au
 * chargement sur un « Export named 'x' not found in module ... », loin du test
 * fautif.
 *
 * On ne peut pas simplement importer le vrai module pour en reprendre les
 * exports : c'est precisement ce qu'on cherche a eviter (redis ouvre une
 * connexion, db exige DATABASE_URL...). On lit donc la liste des exports
 * directement dans le fichier source, sans jamais l'evaluer.
 */

const EXPORT_PATTERNS = [
  // export function foo / export async function foo / export class Foo
  /^export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z0-9_$]+)/gm,
  // export const foo / let / var
  /^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm,
];

/** `export { a, b as c }` - on retient le nom expose (donc `c`). */
const EXPORT_LIST_PATTERN = /^export\s*\{([^}]*)\}/gm;

function readExportNames(sourcePath: string): string[] {
  const source = readFileSync(sourcePath, 'utf8');
  const names = new Set<string>();

  for (const pattern of EXPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      names.add(match[1]);
    }
  }

  for (const match of source.matchAll(EXPORT_LIST_PATTERN)) {
    for (const entry of match[1].split(',')) {
      const cleaned = entry.trim();
      if (!cleaned || cleaned.startsWith('type ')) continue;
      const alias = cleaned.split(/\s+as\s+/).pop();
      if (alias) names.add(alias.trim());
    }
  }

  if (/^export\s+default\s/m.test(source)) {
    names.add('default');
  }

  return [...names];
}

/**
 * Construit le namespace d'un mock de module a partir des exports reellement
 * declares dans `sourcePath`. Les entrees de `overrides` sont utilisees telles
 * quelles ; tous les autres exports recoivent un bouchon qui leve une erreur
 * explicite s'il est appele, afin qu'un usage non prevu soit visible plutot que
 * silencieux.
 *
 * @param sourcePath chemin ABSOLU du fichier source reel (.ts)
 */
export function completeModuleMock(
  sourcePath: string,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const namespace: Record<string, unknown> = {};

  for (const name of readExportNames(sourcePath)) {
    if (name in overrides) continue;
    namespace[name] = () => {
      throw new Error(
        `[mock] ${name}() de ${sourcePath} a ete appele sans avoir ete mocke. ` +
          "Ajoutez-le aux overrides du test si l'appel est attendu.",
      );
    };
  }

  return { ...namespace, ...overrides };
}
