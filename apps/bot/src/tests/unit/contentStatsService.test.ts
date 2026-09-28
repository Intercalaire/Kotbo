import { describe, expect, test, mock, beforeEach } from 'bun:test';
import path from 'node:path';

/**
 * Le tampon des stats de contenu : un message analysé devient une ligne de
 * compteurs (serveur, jour, salon, membre) et, pour chaque emoji ou domaine,
 * deux lignes de classement (par salon, par membre). Les emojis et stickers
 * vus pour la première fois partent dans discord_asset_sources, une seule fois.
 */

const createMany = mock((_args?: unknown) => Promise.resolve({ count: 0 }));
const assetCreateMany = mock((_args?: unknown) => Promise.resolve({ count: 0 }));
const executeRawUnsafe = mock((_sql?: string, ..._params: unknown[]) => Promise.resolve(0));
const transaction = mock((ops: unknown[], _options?: unknown) =>
  Promise.all(ops as Promise<unknown>[]).then(() => undefined),
);

const mockDb = {
  messageContentDailyStat: { createMany },
  contentItemDailyStat: { createMany },
  discordAssetSource: { createMany: assetCreateMany },
  $executeRawUnsafe: executeRawUnsafe,
  $transaction: transaction,
};

const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { recordMessageAnalysis, flushContentStats, contentBufferSizes } = await import('../../services/analytics/contentStatsService');
const { analyzeMessageContent } = await import('../../services/analytics/messageContentAnalyzer');

const EXTERNAL = '333333333333333333';

function sqlFor(table: string): Array<[string, ...unknown[]]> {
  return executeRawUnsafe.mock.calls.filter((call) => String(call[0]).includes(table)) as Array<[string, ...unknown[]]>;
}

describe('contentStatsService', () => {
  beforeEach(() => {
    createMany.mockClear();
    assetCreateMany.mockClear();
    executeRawUnsafe.mockClear();
  });

  test('cumule les compteurs par salon et membre, double les lignes de classement', async () => {
    const analysis = analyzeMessageContent({
      content: `😂 <:pepe:${EXTERNAL}> https://youtu.be/x`,
      attachments: [],
      stickers: [],
      isGuildEmoji: () => false,
    });
    recordMessageAnalysis('g1', '2026-09-28', 'c1', 'u1', analysis);
    recordMessageAnalysis('g1', '2026-09-28', 'c1', 'u1', analysis);

    // Une ligne de compteurs ; 3 classements (😂, emoji externe, domaine) × 2.
    expect(contentBufferSizes()).toEqual({ counters: 1, items: 6 });

    await flushContentStats();
    expect(contentBufferSizes()).toEqual({ counters: 0, items: 0 });

    const [counterSql] = sqlFor('message_content_daily_stats');
    expect(counterSql).toBeDefined();
    const params = counterSql!.slice(1);
    // Clés puis compteurs dans l'ordre du schéma : messages vient en premier.
    expect(params.slice(0, 5)).toEqual(['g1', '2026-09-28', 'c1', 'u1', 2]);

    const [itemSql] = sqlFor('content_item_daily_stats');
    expect(itemSql).toBeDefined();
    const itemParams = itemSql!.slice(1);
    expect(itemParams).toContain('youtube.com');
    expect(itemParams).toContain(EXTERNAL);

    // L'emoji externe est enregistré une fois, même vu deux fois.
    expect(assetCreateMany).toHaveBeenCalledTimes(1);
    const assetData = (assetCreateMany.mock.calls[0]![0] as { data: Array<{ id: string; status: string }> }).data;
    expect(assetData).toHaveLength(1);
    expect(assetData[0]).toMatchObject({ id: EXTERNAL, status: 'pending' });
  });

  test('un emoji déjà vu ne repart pas en base', async () => {
    const analysis = analyzeMessageContent({
      content: `<:pepe:${EXTERNAL}>`,
      attachments: [],
      stickers: [],
      isGuildEmoji: () => false,
    });
    recordMessageAnalysis('g1', '2026-09-29', 'c1', 'u2', analysis);
    await flushContentStats();
    expect(assetCreateMany).not.toHaveBeenCalled();
  });
});
