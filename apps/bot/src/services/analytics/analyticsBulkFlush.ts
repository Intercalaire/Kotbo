import type { Prisma } from '@prisma/client';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';

/**
 * Chaque flush écrivait un `upsert` par ligne bufferisée, le tout dans un
 * `$transaction` unique : un serveur actif ouvrait ainsi une transaction de
 * plusieurs milliers d'instructions toutes les 60 s, et les quatre partaient
 * en parallèle. Le pool saturait, Postgres refusait d'ouvrir la transaction
 * suivante (`P2028`) et le CPU partait en vrille sur des lots rejoués.
 *
 * Ici, une table se flushe en deux instructions par lot, quel que soit le
 * nombre de lignes : `createMany` crée les lignes manquantes à zéro, puis un
 * seul `UPDATE ... FROM (VALUES ...)` applique les compteurs.
 */

export type BulkKeyColumn = { name: string; type: 'text' | 'int' };

export type BulkRow = {
  keys: Array<string | number>;
  counters: Record<string, number>;
  overwrites?: Record<string, number>;
};

export type BulkTarget = {
  label: string;
  table: string;
  keys: BulkKeyColumn[];
  counterColumns: readonly string[];
  overwriteColumns?: readonly string[];
  createMany: (data: Array<Record<string, string | number>>) => Prisma.PrismaPromise<unknown>;
};

const ANALYTICS_CHUNK_SIZE =
  Number.parseInt(process.env.ANALYTICS_CHUNK_SIZE ?? '200', 10) || 200;

/**
 * `maxWait` vaut 2 s par défaut côté Prisma : sous charge, l'attente d'une
 * connexion libre dépassait ce délai et le lot entier était perdu avant même
 * d'avoir touché la base. On laisse au pool le temps de se dégager.
 */
const ANALYTICS_TX_MAX_WAIT_MS =
  Number.parseInt(process.env.ANALYTICS_TX_MAX_WAIT_MS ?? '15000', 10) || 15000;
const ANALYTICS_TX_TIMEOUT_MS =
  Number.parseInt(process.env.ANALYTICS_TX_TIMEOUT_MS ?? '30000', 10) || 30000;

async function flushBulkChunk(target: BulkTarget, chunk: BulkRow[]): Promise<void> {
  const overwriteColumns = target.overwriteColumns ?? [];
  const columnTypes = [
    ...target.keys.map((key) => key.type),
    ...target.counterColumns.map(() => 'int' as const),
    ...overwriteColumns.map(() => 'int' as const),
  ];

  const params: unknown[] = [];
  const tuples = chunk.map((row) => {
    const base = params.length;
    params.push(
      ...row.keys,
      ...target.counterColumns.map((col) => row.counters[col] ?? 0),
      ...overwriteColumns.map((col) => row.overwrites?.[col] ?? 0),
    );
    return `(${columnTypes.map((type, index) => `$${base + 1 + index}::${type}`).join(', ')})`;
  });

  const valueColumns = [
    ...target.keys.map((key) => key.name),
    ...target.counterColumns,
    ...overwriteColumns,
  ]
    .map((col) => `"${col}"`)
    .join(', ');

  const setClause = [
    ...target.counterColumns.map((col) => `"${col}" = m."${col}" + v."${col}"`),
    ...overwriteColumns.map((col) => `"${col}" = v."${col}"`),
  ].join(', ');

  const whereClause = target.keys
    .map((key) => `m."${key.name}" = v."${key.name}"`)
    .join(' AND ');

  await prisma.$transaction(
    [
      // Les lignes absentes sont créées à zéro d'abord : l'UPDATE qui suit n'a
      // alors plus qu'à incrémenter, sans avoir à générer d'`id` cuid ni
      // d'`updatedAt` en SQL brut.
      target.createMany(
        chunk.map((row) => {
          const data: Record<string, string | number> = {};
          target.keys.forEach((key, index) => {
            data[key.name] = row.keys[index]!;
          });
          return data;
        }),
      ),
      prisma.$executeRawUnsafe(
        `UPDATE ${target.table} AS m
       SET ${setClause}, "updatedAt" = NOW()
       FROM (VALUES ${tuples.join(', ')}) AS v(${valueColumns})
       WHERE ${whereClause}`,
        ...params,
      ),
    ],
    { maxWait: ANALYTICS_TX_MAX_WAIT_MS, timeout: ANALYTICS_TX_TIMEOUT_MS },
  );
}

export async function flushBulk(target: BulkTarget, rows: BulkRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += ANALYTICS_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + ANALYTICS_CHUNK_SIZE);
    await flushBulkChunk(target, chunk).catch((error) => {
      logger.error('Analytics', `Error flushing ${target.label} batch (offset ${i}):`, error);
    });
  }
}

/**
 * Une ligne sans aucun compteur non nul ne mérite ni création ni UPDATE : on
 * la laisse tomber ici plutôt que d'alourdir le lot.
 */
export function buildBulkRow(
  keys: Array<string | number>,
  counterColumns: readonly string[],
  data: Record<string, number | undefined>,
  overwrites?: Record<string, number>,
): BulkRow | null {
  const counters: Record<string, number> = {};
  let hasValue = false;

  for (const col of counterColumns) {
    const value = data[col];
    if (value) {
      counters[col] = value;
      hasValue = true;
    } else {
      counters[col] = 0;
    }
  }

  if (overwrites && Object.values(overwrites).some((value) => value > 0)) hasValue = true;
  if (!hasValue) return null;

  return { keys, counters, overwrites };
}
