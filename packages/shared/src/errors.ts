/**
 * Acces sur aux valeurs levees.
 *
 * En TypeScript strict, la variable d'un `catch` est de type `unknown` : c'est
 * exact, puisqu'on peut lever n'importe quoi. Ces helpers evitent d'avoir a
 * repeter le meme test de narrowing a chaque bloc `catch`.
 *
 * Ils vivaient cote bot, et le dashboard, faute de les avoir sous la main,
 * annotait ses `catch` en `any` pour lire `err.message` sans discuter. Comme
 * ils ne dependent de rien, ils sont ici, ou les deux les lisent.
 */

/** Message lisible d'une valeur levee, quelle que soit sa forme. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Pile d'appel si la valeur levee en porte une. */
export function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

/**
 * Code d'erreur porte par la valeur levee (Prisma, Node, Discord...).
 * Ces bibliotheques exposent un `code` qui n'est pas typé sur `Error`.
 */
export function errorCode(err: unknown): string | number | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') return code;
  }
  return undefined;
}

/**
 * Statut HTTP porte par la valeur levee, utilise par les routes du dashboard
 * pour propager le code d'une erreur amont.
 */
export function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}
