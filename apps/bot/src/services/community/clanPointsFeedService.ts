/**
 * Relais Discord du flux des gains de points de clan.
 *
 * Les mouvements arrivent en rafale : la fin d'un raid ou la clôture du Daily Algo crédite
 * tout un serveur d'un coup. Un message par mouvement dépasserait vite la limite d'envoi
 * du salon, alors ils sont retenus quelques secondes et publiés ensemble : détaillés quand
 * la rafale est courte, résumés par clan dans un seul message quand elle est grosse.
 */

import { Routes, type Client } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getClient } from '../../utils/client.js';
import {
  chunkFeedLines,
  formatFeedLine,
  summarizeFeed,
  DETAILED_FEED_MAX_EVENTS,
  type ClanPointsFeedEvent,
} from './clanPointsFeedPolicy.js';

const FLUSH_DELAY_MS = 5_000;

/** Garde-fou mémoire : au-delà, les mouvements d'une rafale sont seulement comptés. */
const MAX_BUFFERED_EVENTS = 2_000;

type Pending = {
  events: ClanPointsFeedEvent[];
  dropped: number;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

/** Salons déjà signalés comme inutilisables, pour ne pas répéter l'avertissement à chaque rafale. */
const warnedChannels = new Set<string>();

type FeedSender = (content: string) => Promise<unknown>;

export function queueClanPointsFeed(guildId: string, event: ClanPointsFeedEvent): void {
  let entry = pending.get(guildId);
  if (!entry) {
    entry = {
      events: [],
      dropped: 0,
      timer: setTimeout(() => {
        pending.delete(guildId);
        void flushClanPointsFeed(guildId, entry!).catch((err) => {
          logger.error('ClanPointsFeed', `Flux des points de clan non publié pour ${guildId}:`, err);
        });
      }, FLUSH_DELAY_MS),
    };
    entry.timer.unref?.();
    pending.set(guildId, entry);
  }

  if (entry.events.length < MAX_BUFFERED_EVENTS) entry.events.push(event);
  else entry.dropped += 1;
}

async function flushClanPointsFeed(guildId: string, entry: Pending): Promise<void> {
  const guildRow = await prisma.guild.findUnique({
    where: { id: guildId },
    select: { clansEnabled: true, clanPointsFeedChannelId: true },
  });
  if (!guildRow?.clansEnabled || !guildRow.clanPointsFeedChannelId) return;

  const client = getClient();
  const channelId = guildRow.clanPointsFeedChannelId;
  const send = await openFeedChannel(client, guildId, channelId);
  if (!send) {
    const key = `${guildId}:${channelId}`;
    if (!warnedChannels.has(key)) {
      warnedChannels.add(key);
      logger.warn('ClanPointsFeed', `Salon du flux des points de clan introuvable ou fermé au bot (${guildId}, ${channelId}).`);
    }
    return;
  }
  warnedChannels.delete(`${guildId}:${channelId}`);

  const clans = await prisma.clan.findMany({
    where: { guildId, id: { in: [...new Set(entry.events.map((e) => e.clanId))] } },
    select: { id: true, name: true },
  });
  const clanNames = new Map(clans.map((c) => [c.id, c.name]));

  if (entry.events.length > DETAILED_FEED_MAX_EVENTS) {
    await send(summarizeFeed(entry.events, clanNames, entry.dropped));
    return;
  }

  const lines = entry.events.map((event) => formatFeedLine(event, clanNames.get(event.clanId) ?? null));
  for (const content of chunkFeedLines(lines)) {
    await send(content);
  }
}

/**
 * Prépare l'envoi dans le salon du flux, ou renvoie null s'il n'est pas utilisable.
 *
 * Le serveur peut être porté par un autre shard : l'API du dashboard ne tourne que sur le
 * shard 0, et un gain attribué depuis le dashboard ou le MCP y est journalisé quel que soit
 * le serveur. Le cache n'a alors ni le serveur ni le salon, d'où le passage par l'API REST,
 * en vérifiant que le salon appartient bien au serveur.
 */
async function openFeedChannel(client: Client, guildId: string, channelId: string): Promise<FeedSender | null> {
  const discordGuild = client.guilds.cache.get(guildId);

  if (discordGuild) {
    // `fetch` refuse un salon d'un autre serveur : l'erreur tombe dans le catch.
    const channel = discordGuild.channels.cache.get(channelId)
      ?? await discordGuild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !channel.isSendable()) return null;
    const target = channel;
    return (content) => target.send({ content, allowedMentions: { parse: [] } });
  }

  const data = await client.rest.get(Routes.channel(channelId)).catch(() => null) as { guild_id?: string } | null;
  if (data?.guild_id !== guildId) return null;
  return (content) => client.rest.post(Routes.channelMessages(channelId), {
    body: { content, allowed_mentions: { parse: [] } },
  });
}
