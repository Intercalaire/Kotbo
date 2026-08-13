/**
 * Nommé zz-* : bun exécute les fichiers par ordre alphabétique et mock.module
 * est global au process. Ce fichier mocke utils/logger, ce qui casserait
 * logger.test.ts s'il tournait avant lui.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';

const guildId = '987654321098765432';

const prismaMock = {
  guild: {
    findUnique: mock(async () => ({
      wordStatsEnabled: true,
      messageLoggingEnabled: true,
      wordStatsBackfillStatus: null,
    })),
    update: mock(async (_args?: unknown) => ({})),
  },
  messageLog: {
    count: mock(async () => 0),
    findMany: mock(async (_args?: unknown) => [] as Array<{ id: string; content: string; createdAt: Date }>),
  },
  guildWordStat: {
    upsert: mock(() => ({})),
    deleteMany: mock(async () => ({ count: 0 })),
  },
  $transaction: mock(async (ops: unknown[]) => ops),
  $executeRaw: mock(async () => 0),
};

const moduleMocks: Array<[string, () => Record<string, unknown>]> = [
  ['../../utils/db', () => ({ default: prismaMock, prisma: prismaMock, prismaRead: prismaMock })],
  ['../../utils/logger', () => ({
    logger: {
      info: mock(() => undefined), warn: mock(() => undefined),
      error: mock(() => undefined), debug: mock(() => undefined), success: mock(() => undefined),
    },
  })],
];

for (const [relativePath, factory] of moduleMocks) {
  mock.module(path.resolve(import.meta.dir, `${relativePath}.ts`), factory);
  mock.module(path.resolve(import.meta.dir, `${relativePath}.js`), factory);
}

const { startWordStatsBackfill } = await import('../../services/analytics/wordStatsBackfillService.js');

/** Laisse tourner la tâche de fond lancée en void. */
const settle = () => new Promise((r) => setTimeout(r, 30));

function setGuild(config: Record<string, unknown>) {
  prismaMock.guild.findUnique = mock(async () => config as never);
}

/** Simule une table message_logs paginée par curseur d'id. */
function setMessages(messages: Array<{ id: string; content: string; createdAt: Date }>) {
  prismaMock.messageLog.count = mock(async () => messages.length);
  prismaMock.messageLog.findMany = mock(async (args?: any) => {
    const after = args?.where?.id?.gt as string | undefined;
    return messages
      .filter((m) => (after ? m.id > after : true))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, args?.take ?? 2000);
  });
}

beforeEach(() => {
  prismaMock.guild.update = mock(async () => ({}));
  prismaMock.guildWordStat.upsert = mock(() => ({}));
  prismaMock.guildWordStat.deleteMany = mock(async () => ({ count: 0 }));
  prismaMock.$transaction = mock(async (ops: unknown[]) => ops);
  setMessages([]);
});

/** Dernier statut écrit via guild.update. */
function lastStatus(): any {
  const calls = prismaMock.guild.update.mock.calls;
  return (calls.at(-1)?.[0] as any)?.data?.wordStatsBackfillStatus;
}

describe('startWordStatsBackfill - garde-fous', () => {
  test('ne fait rien si les stats de mots sont désactivées', async () => {
    setGuild({ wordStatsEnabled: false, messageLoggingEnabled: true, wordStatsBackfillStatus: null });

    await startWordStatsBackfill(guildId);
    await settle();

    expect(prismaMock.guild.update).not.toHaveBeenCalled();
  });

  test('marque SKIPPED sans journalisation : aucun historique à indexer', async () => {
    setGuild({ wordStatsEnabled: true, messageLoggingEnabled: false, wordStatsBackfillStatus: null });

    await startWordStatsBackfill(guildId);
    await settle();

    expect(lastStatus().status).toBe('SKIPPED');
    expect(prismaMock.messageLog.findMany).not.toHaveBeenCalled();
  });

  test('ne relance pas une indexation déjà terminée (protège du double comptage)', async () => {
    setGuild({
      wordStatsEnabled: true, messageLoggingEnabled: true,
      wordStatsBackfillStatus: { status: 'COMPLETED' },
    });

    await startWordStatsBackfill(guildId);
    await settle();

    expect(prismaMock.messageLog.findMany).not.toHaveBeenCalled();
  });

  test('ne relance pas une indexation en cours', async () => {
    setGuild({
      wordStatsEnabled: true, messageLoggingEnabled: true,
      wordStatsBackfillStatus: { status: 'IN_PROGRESS' },
    });

    await startWordStatsBackfill(guildId);
    await settle();

    expect(prismaMock.messageLog.findMany).not.toHaveBeenCalled();
  });

  test('force efface les compteurs existants avant de réindexer', async () => {
    setGuild({
      wordStatsEnabled: true, messageLoggingEnabled: true,
      wordStatsBackfillStatus: { status: 'COMPLETED' },
    });

    await startWordStatsBackfill(guildId, true);
    await settle();

    // Sans purge, la réindexation s'additionnerait aux compteurs déjà en place.
    expect(prismaMock.guildWordStat.deleteMany).toHaveBeenCalledWith({ where: { guildId } });
  });
});

describe('startWordStatsBackfill - indexation', () => {
  test('agrège les mots par jour depuis les messages stockés', async () => {
    setGuild({ wordStatsEnabled: true, messageLoggingEnabled: true, wordStatsBackfillStatus: null });
    setMessages([
      { id: 'a1', content: 'python python discord', createdAt: new Date('2026-07-10T10:00:00Z') },
      { id: 'a2', content: 'python typescript', createdAt: new Date('2026-07-10T18:00:00Z') },
      { id: 'a3', content: 'typescript', createdAt: new Date('2026-07-11T09:00:00Z') },
    ]);

    await startWordStatsBackfill(guildId);
    await settle();

    const upserts = prismaMock.guildWordStat.upsert.mock.calls.map((c: any) => c[0]);
    const find = (dateKey: string, word: string) =>
      upserts.find((u) => u.where.guildId_dateKey_word.dateKey === dateKey && u.where.guildId_dateKey_word.word === word);

    // 3 occurrences de "python" le 10, réparties sur deux messages
    expect(find('2026-07-10', 'python')?.create.count).toBe(3);
    expect(find('2026-07-10', 'discord')?.create.count).toBe(1);
    expect(find('2026-07-10', 'typescript')?.create.count).toBe(1);
    // Le 11 est bien un jour distinct
    expect(find('2026-07-11', 'typescript')?.create.count).toBe(1);

    expect(lastStatus().status).toBe('COMPLETED');
    expect(lastStatus().processedMessages).toBe(3);
  });

  test('n’indexe que les messages antérieurs au cutoff - le tracker live gère le reste', async () => {
    setGuild({ wordStatsEnabled: true, messageLoggingEnabled: true, wordStatsBackfillStatus: null });
    setMessages([{ id: 'a1', content: 'python', createdAt: new Date('2026-07-10T10:00:00Z') }]);

    await startWordStatsBackfill(guildId);
    await settle();

    // La frontière createdAt < cutoff est ce qui empêche de compter deux fois
    // les messages que le tracker live traite déjà.
    const where = (prismaMock.messageLog.findMany.mock.calls[0][0] as any).where;
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    expect(where.isBot).toBe(false);
    expect(where.guildId).toBe(guildId);
  });

  test('utilise un curseur sur id pour paginer sans sauter de message', async () => {
    setGuild({ wordStatsEnabled: true, messageLoggingEnabled: true, wordStatsBackfillStatus: null });
    setMessages([{ id: 'a1', content: 'python', createdAt: new Date('2026-07-10T10:00:00Z') }]);

    await startWordStatsBackfill(guildId);
    await settle();

    const args = prismaMock.messageLog.findMany.mock.calls[0][0] as any;
    expect(args.orderBy).toEqual({ id: 'asc' });
  });

  test('ignore les messages sans mot exploitable sans planter', async () => {
    setGuild({ wordStatsEnabled: true, messageLoggingEnabled: true, wordStatsBackfillStatus: null });
    setMessages([
      { id: 'a1', content: 'les et de', createdAt: new Date('2026-07-10T10:00:00Z') },
      { id: 'a2', content: 'https://example.com', createdAt: new Date('2026-07-10T11:00:00Z') },
    ]);

    await startWordStatsBackfill(guildId);
    await settle();

    expect(prismaMock.guildWordStat.upsert).not.toHaveBeenCalled();
    expect(lastStatus().status).toBe('COMPLETED');
    expect(lastStatus().processedMessages).toBe(2);
  });

  test('marque FAILED si l’indexation casse', async () => {
    setGuild({ wordStatsEnabled: true, messageLoggingEnabled: true, wordStatsBackfillStatus: null });
    prismaMock.messageLog.count = mock(async () => { throw new Error('DB indisponible'); });

    await startWordStatsBackfill(guildId);
    await settle();

    expect(lastStatus().status).toBe('FAILED');
    expect(lastStatus().error).toContain('DB indisponible');
  });
});
