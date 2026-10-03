/**
 * Le serveur Discord lui-même : salons, et journal des messages.
 *
 * Formes reprises de `general.ts` (liste des salons) et `messageLogs.ts` côté
 * bot. La recherche filtre le corpus de `demo/activity.ts`.
 */
import { route } from '../backend';
import { demoDb } from '../db';
import { messageCorpus, toMessageLogEntry } from '../activity';
import { CATEGORIES, CHANNELS, VOICE_CHANNELS, ago, channelByName } from '../fixtures';
import { DEMO_GUILD_ID } from '../mode';

const MESSAGE_LOG_CONFIG = 'message-logs/config';
const configSeed = () => ({ enabled: true, retentionDays: 30, ignoredChannels: [channelByName('logs').id] });
const DELETED = 'message-logs/deleted';

export function registerServerRoutes(): void {
  route('GET', '/api/dashboard/guilds/:guildId/channels', () => ({
    textChannels: CHANNELS.map(({ id, name, mention, type }) => ({ id, name, mention, type })),
    voiceChannels: VOICE_CHANNELS.map(({ id, name }) => ({ id, name, mention: `<#${id}>` })),
    categories: CATEGORIES.map(({ id, name }) => ({ id, name, mention: `<#${id}>` })),
  }));

  route('GET', '/api/dashboard/guilds/:guildId/message-logs/channels', ({ query }) => {
    const authorId = query.get('authorId');
    const counts = new Map<string, { channelId: string; channelName: string; count: number }>();
    for (const m of messageCorpus()) {
      if (authorId && m.authorId !== authorId) continue;
      const entry = counts.get(m.channelId) ?? { channelId: m.channelId, channelName: m.channelName, count: 0 };
      entry.count += 1;
      counts.set(m.channelId, entry);
    }
    return { channels: [...counts.values()].sort((a, b) => b.count - a.count) };
  });

  route('GET', '/api/dashboard/guilds/:guildId/message-logs/stats', () => {
    const config = demoDb.get(MESSAGE_LOG_CONFIG, configSeed);
    return {
      total: 48_210,
      ...config,
      status: {
        status: 'COMPLETED',
        error: null,
        scrapedChannelsCount: CHANNELS.length,
        totalChannelsCount: CHANNELS.length,
        scrapedMessagesCount: 48_210,
        currentChannelName: '',
        startedAt: ago(40 * 24 * 60),
        completedAt: ago(40 * 24 * 60 - 34),
      },
    };
  });

  route('PATCH', '/api/dashboard/guilds/:guildId/message-logs/config', ({ body }) =>
    demoDb.update(MESSAGE_LOG_CONFIG, configSeed, (current) => ({ ...current, ...(body ?? {}) })),
  );

  route('GET', '/api/dashboard/guilds/:guildId/message-logs/search', ({ query }) => {
    const deleted = new Set(demoDb.get<string[]>(DELETED, () => []));
    const q = (query.get('q') ?? '').trim().toLowerCase();
    const channelId = query.get('channelId');
    const authorId = query.get('authorId');
    const from = query.get('from');
    const to = query.get('to');
    const includeDeleted = query.get('includeDeleted') === 'true';
    const limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 50));
    const offset = Math.max(0, Number(query.get('offset')) || 0);
    let list = messageCorpus().filter((m) => {
      if (deleted.has(m.id)) return false;
      if (!includeDeleted && m.deletedAt) return false;
      if (channelId && m.channelId !== channelId) return false;
      if (authorId && m.authorId !== authorId) return false;
      if (query.get('hasAttachment') === 'true' && !m.hasAttachment) return false;
      if (query.get('isBot') === 'true') return false;
      if (from && m.createdAt < from) return false;
      if (to && m.createdAt > to) return false;
      if (q && !m.content.toLowerCase().includes(q) && !m.author.displayName.toLowerCase().includes(q)) return false;
      return true;
    });
    if (query.get('order') === 'asc') list = [...list].reverse();
    const page = list.slice(offset, offset + limit);
    return {
      messages: page.map((m) => toMessageLogEntry(m, DEMO_GUILD_ID)),
      total: list.length,
      totalCapped: false,
      hasMore: offset + limit < list.length,
      limit,
      offset,
    };
  });

  route('DELETE', '/api/dashboard/guilds/:guildId/message-logs/:messageId', ({ params }) => {
    demoDb.update<string[]>(DELETED, () => [], (list) => [...list, params.messageId]);
    return { success: true };
  });
}
