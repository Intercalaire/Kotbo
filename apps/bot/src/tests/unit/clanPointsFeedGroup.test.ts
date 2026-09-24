import { describe, expect, mock, test } from 'bun:test';
import path from 'node:path';

const sent: string[] = [];

const channel = {
  isTextBased: () => true,
  isSendable: () => true,
  send: mock(async ({ content }: { content: string }) => { sent.push(content); }),
};

const client = {
  guilds: { cache: new Map([['guild-1', { channels: { cache: new Map([['feed', channel]]), fetch: async () => channel } }]]) },
  rest: { get: async () => null, post: async () => null },
};

const mockDb = {
  guild: { findUnique: mock(async () => ({ clansEnabled: true, clanPointsFeedChannelId: 'feed' })) },
  clan: { findMany: mock(async () => [{ id: 'clan-a', name: 'Alpha' }, { id: 'clan-b', name: 'Beta' }]) },
};

for (const file of ['../../utils/db.ts', '../../utils/db.js']) {
  mock.module(path.resolve(import.meta.dir, file), () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
}
for (const file of ['../../utils/client.ts', '../../utils/client.js']) {
  mock.module(path.resolve(import.meta.dir, file), () => ({ getClient: () => client }));
}

const { queueClanPointsFeed, flushClanPointsFeedGroup } = await import('../../services/community/clanPointsFeedService.js');

const flushed = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('flux des points de clan — gagnants d\'un drop', () => {
  test('tous les gagnants du drop partent dans un seul message à sa clôture', async () => {
    sent.length = 0;
    const group = { key: 'drop:1', flushAt: new Date(Date.now() + 60 * 60 * 1000) };

    queueClanPointsFeed('guild-1', { clanId: 'clan-a', userId: 'u1', amount: 50, source: 'DROP', credit: null }, group);
    queueClanPointsFeed('guild-1', { clanId: 'clan-b', userId: 'u2', amount: 50, source: 'DROP', credit: null }, group);
    queueClanPointsFeed('guild-1', { clanId: 'clan-a', userId: 'u3', amount: 50, source: 'DROP', credit: null }, group);

    // Rien ne part tant que le drop est ouvert.
    await flushed();
    expect(sent).toHaveLength(0);

    flushClanPointsFeedGroup('guild-1', 'drop:1');
    await flushed();

    expect(sent).toHaveLength(1);
    for (const user of ['<@u1>', '<@u2>', '<@u3>']) expect(sent[0]).toContain(user);
  });

  test('une clôture sans gagnant ne publie rien', async () => {
    sent.length = 0;
    flushClanPointsFeedGroup('guild-1', 'drop:vide');
    await flushed();
    expect(sent).toHaveLength(0);
  });
});
