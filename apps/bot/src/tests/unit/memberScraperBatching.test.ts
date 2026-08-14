import { describe, expect, mock, test } from 'bun:test';
import { Collection } from 'discord.js';
import path from 'node:path';

type TransactionOptions = { timeout?: number };

const transactionCalls: Array<{ operationCount: number; options?: TransactionOptions }> = [];
let storedStatsConfig: Record<string, unknown> = {};

const mockDb = {
  guild: {
    findUnique: mock(async () => ({
      activated: true,
      statsConfig: storedStatsConfig,
    })),
    update: mock(async () => ({})),
  },
  memberProfile: {
    // Le paramètre est déclaré (même inutilisé) pour que `mock.calls` porte bien
    // l'argument : sans lui le tuple d'appel est vide et `calls[0][0]` ne compile pas.
    upsert: mock(async (_args: unknown) => ({})),
    update: mock(async (_args: unknown) => ({})),
    findMany: mock(async () => []),
  },
  guildDailyStat: {
    upsert: mock(async () => ({})),
    update: mock(async () => ({})),
  },
  guildHourlyStat: {
    upsert: mock(async () => ({})),
  },
  $transaction: mock(async (
    operations: Array<Promise<unknown>>,
    options?: TransactionOptions,
  ) => {
    transactionCalls.push({ operationCount: operations.length, options });
    return Promise.all(operations);
  }),
};

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

type FakeMember = ReturnType<typeof fakeMember>;
let scrapedMembers = new Collection<string, FakeMember>();

for (const suffix of ['../../utils/discord.ts', '../../utils/discord.js']) {
  mock.module(path.resolve(__dirname, suffix), () => ({
    fetchAllMembers: mock(async () => scrapedMembers),
  }));
}

const { startMemberScraping } = await import('../../services/analytics/memberScraperService');

function fakeMember(index: number) {
  return {
    id: `user-${index}`,
    displayName: `Membre ${index}`,
    joinedAt: new Date('2026-01-15T12:00:00.000Z'),
    // `avatarURL` (et non `displayAvatarURL`) : le scraper ne doit plus stocker
    // l'avatar Discord générique des membres sans photo (issue #211).
    avatarURL: () => null,
    user: {
      bot: false,
      tag: `membre${index}`,
      username: `membre${index}`,
      globalName: null,
      accentColor: null,
      createdAt: new Date('2025-01-15T12:00:00.000Z'),
      avatarURL: () => `https://cdn.example/${index}.png`,
      displayAvatarURL: () => `https://cdn.example/${index}.png`,
    },
    roles: { cache: new Collection<string, { id: string }>() },
  };
}

function membersCollection(size: number) {
  const members = new Collection<string, FakeMember>();
  for (let index = 0; index < size; index++) {
    const member = fakeMember(index);
    members.set(member.id, member);
  }
  return members;
}

function createScrapeClient() {
  const guild = {
    id: 'guild-1',
    name: 'Test Guild',
    memberCount: 120,
  };
  const client = {
    guilds: {
      cache: new Collection([[guild.id, guild]]),
      fetch: mock(async () => guild),
    },
  };
  return { client, guild };
}

describe('member scraper transaction batching', () => {
  test('borne le délai des transactions de profils membres', async () => {
    transactionCalls.length = 0;
    storedStatsConfig = { memberScrapeStatus: 'NOT_STARTED' };
    scrapedMembers = membersCollection(120);
    const { client, guild } = createScrapeClient();

    const result = await startMemberScraping(client as never, guild.id, true);
    expect(result.status).toBe('STARTED');
    await result.completion;

    // 120 membres → lots de 50, 50 puis 20.
    const memberBatches = transactionCalls.slice(0, 3);
    expect(memberBatches.map((call) => call.operationCount)).toEqual([50, 50, 20]);
    expect(transactionCalls.every((call) => call.options?.timeout === 15_000)).toBe(true);
  });

  test('marque le scan terminé et enregistre les profils nommés', async () => {
    transactionCalls.length = 0;
    mockDb.guild.update.mockClear();
    mockDb.memberProfile.upsert.mockClear();
    storedStatsConfig = { memberScrapeStatus: 'NOT_STARTED' };
    scrapedMembers = membersCollection(3);
    const { client, guild } = createScrapeClient();

    const result = await startMemberScraping(client as never, guild.id, true);
    await result.completion;

    expect(mockDb.memberProfile.upsert).toHaveBeenCalledTimes(3);
    const firstUpsert = mockDb.memberProfile.upsert.mock.calls[0]?.[0] as unknown as {
      create?: { username?: string; avatarUrl?: string };
    };
    expect(firstUpsert?.create?.username).toBe('membre0');
    expect(firstUpsert?.create?.avatarUrl).toBe('https://cdn.example/0.png');
  });
});
