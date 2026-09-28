import { describe, expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { MODULE_REGISTRY } from '@kotbo/contracts';

// moduleGate ne lit de Guild que `plan` et les `legacyField` du registre. Une
// colonne inexistante ferait echouer la lecture, et tous les modules
// retomberaient silencieusement sur leur etat par defaut.
describe('legacyField du registre des modules', () => {
  test('chaque legacyField est une colonne de Guild', () => {
    const columns = new Set<string>(Object.values(Prisma.GuildScalarFieldEnum));
    const missing = MODULE_REGISTRY
      .map((mod) => mod.legacyField)
      .filter((field): field is string => !!field && !columns.has(field));

    expect(missing).toEqual([]);
    expect(columns.has('plan')).toBeTrue();
  });
});
