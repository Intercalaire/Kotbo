/**
 * Relais Discord du flux des gains de points de clan.
 *
 * Les mouvements arrivent en rafale : la fin d'un raid ou la clôture du Daily Algo crédite
 * tout un serveur d'un coup. Un message par mouvement dépasserait vite la limite d'envoi
 * du salon, alors ils sont retenus quelques secondes et publiés ensemble : détaillés quand
 * la rafale est courte, résumés par clan dans un seul embed quand elle est grosse.
 */

import { EmbedBuilder, Routes, type Client } from 'discord.js';
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

type FeedSender = (embed: EmbedBuilder) => Promise<unknown>;

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
    select: { id: true, name: true, roleId: true },
  });
  const clanById = new Map(clans.map((c) => [c.id, c]));

  // La couleur suit le clan quand toute la rafale le concerne : c'est le cas courant
  // d'un gain isolé, et le salon se lit alors d'un coup d'oeil.
  const onlyClan = clans.length === 1 ? clans[0] : null;
  const color = (onlyClan && client.guilds.cache.get(guildId)?.roles.cache.get(onlyClan.roleId)?.color) || 0x6366F1;

  if (entry.events.length > DETAILED_FEED_MAX_EVENTS) {
    const total = entry.events.length + entry.dropped;
    const embed = new EmbedBuilder()
      .setTitle(`${total.toLocaleString('fr-FR')} mouvements de points de clan`)
      .addFields(summarizeFeed(entry.events, new Map(clans.map((c) => [c.id, c.name]))))
      .setColor(color)
      .setTimestamp();
    if (entry.dropped > 0) {
      embed.setFooter({ text: `${entry.dropped.toLocaleString('fr-FR')} mouvements non détaillés` });
    }
    await send(embed);
    return;
  }

  const lines = entry.events.map((event) => formatFeedLine(event, clanById.get(event.clanId)?.name ?? null));
  const embeds = chunkFeedLines(lines).map((description) =>
    new EmbedBuilder().setDescription(description).setColor(color)
  );
  embeds[embeds.length - 1]?.setTimestamp();

  // Un embed par message : Discord plafonne à 6000 caractères la somme des embeds d'un
  // même message, soit moins de deux descriptions pleines.
  for (const embed of embeds) {
    await send(embed);
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
    return (embed) => target.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  const data = await client.rest.get(Routes.channel(channelId)).catch(() => null) as { guild_id?: string } | null;
  if (data?.guild_id !== guildId) return null;
  return (embed) => client.rest.post(Routes.channelMessages(channelId), {
    body: { embeds: [embed.toJSON()], allowed_mentions: { parse: [] } },
  });
}
