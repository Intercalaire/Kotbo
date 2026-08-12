import { describe, expect, mock, test } from 'bun:test';
import { Collection, ChannelType } from 'discord.js';
import path from 'node:path';

type TransactionOptions = { timeout?: number };
type GuildUpdateArgs = {
  data?: { statsConfig?: Record<string, unknown> };
};

const transactionCalls: Array<{ operationCount: number; options?: TransactionOptions }> = [];
let transactionError: Error | null = null;
let storedStatsConfig: Record<string, unknown> = {};

const mockDb = {
  guild: {
    findUnique: mock(async () => ({
      activated: true,
      statsConfig: storedStatsConfig,
    })),
    update: mock(async (_args: GuildUpdateArgs) => ({})),
  },
  guildDailyStat: {
    upsert: mock(async () => ({})),
    update: mock(async () => ({})),
  },
  guildHourlyStat: {
    upsert: mock(async () => ({})),
  },
  channelDailyStat: {
    upsert: mock(async () => ({})),
  },
  memberDailyStat: {
    upsert: mock(async () => ({})),
    count: mock(async () => 250),
  },
  $transaction: mock(async (
    operations: Array<Promise<unknown>>,
    options?: TransactionOptions,
  ) => {
    transactionCalls.push({ operationCount: operations.length, options });
    if (transactionError) throw transactionError;
    return Promise.all(operations);
  }),
};

// `debug` compris : `mock.module` remplace le module pour tout le process, et
// un logger amputé d'une méthode fait tomber les suites chargées après celle-ci
// sur un « logger.debug is not a function » sans rapport avec leur sujet.
const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
};

for (const suffix of ['../../utils/db.ts', '../../utils/db.js']) {
  mock.module(path.resolve(__dirname, suffix), () => ({
    default: mockDb,
    prisma: mockDb,
    prismaRead: mockDb,
  }));
}

for (const suffix of ['../../utils/logger.ts', '../../utils/logger.js']) {
  mock.module(path.resolve(__dirname, suffix), () => ({
    logger: silentLogger,
  }));
}

const { startHistoricalScraping } = await import('../../services/analytics/messageScraperService');

function messagePage(offset: number, size: number) {
  const page = new Collection<string, {
    id: string;
    author: { id: string; bot: boolean };
    createdAt: Date;
    reference: null;
  }>();

  for (let index = 0; index < size; index++) {
    const id = `message-${offset + index}`;
    page.set(id, {
      id,
      author: { id: `user-${offset + index}`, bot: false },
      createdAt: new Date('2026-01-15T12:00:00.000Z'),
      reference: null,
    });
  }

  return page;
}

function createScrapeClient(pages: Array<Collection<string, {
  id: string;
  author: { id: string; bot: boolean };
  createdAt: Date;
  reference: null;
}>>) {
  let pageIndex = 0;
  const channel = {
    id: 'channel-1',
    name: 'general',
    type: ChannelType.GuildText,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: mock(async () => pages[pageIndex++] ?? new Collection()),
    },
  };
  const channels = new Collection<string, typeof channel>();
  channels.set(channel.id, channel);

  const guild = {
    id: 'guild-1',
    name: 'Test Guild',
    members: { me: { id: 'bot-1' } },
    channels: { fetch: mock(async () => channels) },
  };
  const client = {
    user: { id: 'bot-1' },
    guilds: {
      cache: new Collection([[guild.id, guild]]),
      fetch: mock(async () => guild),
    },
  };

  return { client, guild };
}

describe('message scraper transaction batching', () => {
  test('flushes every Discord page with a bounded local transaction timeout', async () => {
    transactionCalls.length = 0;
    transactionError = null;
    storedStatsConfig = {
      historicalScrapeStatus: 'NOT_STARTED',
      historicalScrapedChannels: [],
      historicalScrapedMessages: 0,
      scrapingBoundaryDate: '2099-01-01T00:00:00.000Z',
    };
    const { client, guild } = createScrapeClient([
      messagePage(0, 100),
      messagePage(100, 100),
      messagePage(200, 50),
    ]);

    const result = await startHistoricalScraping(client as never, guild.id);
    expect(result.status).toBe('STARTED');
    await result.completion;

    expect(transactionCalls).toHaveLength(3);
    expect(transactionCalls.map((call) => call.operationCount)).toEqual([104, 104, 54]);
    expect(transactionCalls.every((call) => call.options?.timeout === 15_000)).toBe(true);
  });

  test('preserves the last committed cursor when a flush fails', async () => {
    transactionCalls.length = 0;
    mockDb.guild.update.mockClear();
    transactionError = new Error('transaction expired');
    storedStatsConfig = {
      historicalScrapeStatus: 'FAILED',
      historicalScrapedChannels: [],
      historicalScrapedMessages: 100,
      scrapingBoundaryDate: '2099-01-01T00:00:00.000Z',
      historicalScrapeProgress: {
        currentChannelId: 'channel-1',
        currentLastMessageId: 'cursor-before-error',
        scrapedMessagesCount: 100,
      },
    };
    const { client, guild } = createScrapeClient([messagePage(100, 100)]);

    const result = await startHistoricalScraping(client as never, guild.id);
    expect(result.status).toBe('STARTED');
    await result.completion;

    const lastUpdate = mockDb.guild.update.mock.calls.at(-1)?.[0];
    if (!lastUpdate) throw new Error('Expected the failed scrape status to be persisted.');
    expect(lastUpdate.data?.statsConfig?.historicalScrapeStatus).toBe('FAILED');
    expect(lastUpdate.data?.statsConfig?.historicalScrapeProgress).toEqual(
      storedStatsConfig.historicalScrapeProgress,
    );
  });
});
