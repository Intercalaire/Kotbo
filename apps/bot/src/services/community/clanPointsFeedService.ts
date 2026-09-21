/**
 * Relais Discord du flux des gains de points de clan.
 *
 * Les mouvements arrivent en rafale : la fin d'un raid ou la clôture du Daily Algo crédite
 * tout un serveur d'un coup. Un message par mouvement dépasserait vite la limite d'envoi
 * du salon, alors ils sont retenus quelques secondes et publiés ensemble.
 */

import { EmbedBuilder } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getClient } from '../../utils/client.js';
import {
  chunkFeedLines,
  formatFeedLine,
  type ClanPointsFeedEvent,
} from './clanPointsFeedPolicy.js';

const FLUSH_DELAY_MS = 5_000;

/** Au-delà, les mouvements d'une rafale sont comptés sans être détaillés. */
const MAX_BUFFERED_EVENTS = 200;

type Pending = {
  events: ClanPointsFeedEvent[];
  dropped: number;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

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

  const discordGuild = getClient().guilds.cache.get(guildId);
  if (!discordGuild) return;

  const channelId = guildRow.clanPointsFeedChannelId;
  const channel = discordGuild.channels.cache.get(channelId)
    ?? await discordGuild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    logger.warn('ClanPointsFeed', `Salon du flux des points de clan introuvable ou fermé au bot (${guildId}, ${channelId}).`);
    return;
  }

  const clans = await prisma.clan.findMany({
    where: { guildId, id: { in: [...new Set(entry.events.map((e) => e.clanId))] } },
    select: { id: true, name: true, roleId: true },
  });
  const clanById = new Map(clans.map((c) => [c.id, c]));

  const lines = entry.events.map((event) => formatFeedLine(event, clanById.get(event.clanId)?.name ?? null));
  if (entry.dropped > 0) lines.push(`… et ${entry.dropped} autres mouvements`);

  // La couleur suit le clan quand toute la rafale le concerne : c'est le cas courant
  // d'un gain isolé, et le salon se lit alors d'un coup d'oeil.
  const onlyClan = clans.length === 1 ? clans[0] : null;
  const color = (onlyClan && discordGuild.roles.cache.get(onlyClan.roleId)?.color) || 0x6366F1;

  const embeds = chunkFeedLines(lines).map((description) =>
    new EmbedBuilder().setDescription(description).setColor(color)
  );
  embeds[embeds.length - 1]?.setTimestamp();

  // Un embed par message : Discord plafonne à 6000 caractères la somme des embeds d'un
  // même message, soit moins de deux descriptions pleines.
  for (const embed of embeds) {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }
}
