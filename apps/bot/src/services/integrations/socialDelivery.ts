/**
 * Envoi d'une alerte de suivi social (GitHub, Hugging Face) dans son salon.
 *
 * Le salon choisi sur le suivi prime ; à défaut, le salon public du serveur.
 */
import type { Client, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { allowedMentionsFor } from '../../utils/mentions.js';

export interface FollowTarget {
  guildId: string;
  discordChannelId: string | null;
  mention: string | null;
}

/** Retourne false si le salon est introuvable ou l'envoi refusé. */
export async function sendFollowAlert(
  client: Client,
  follow: FollowTarget,
  fallbackChannelId: string | null,
  message: { content: string; embeds: EmbedBuilder[] },
  logScope: string,
): Promise<boolean> {
  const targetChannelId = follow.discordChannelId || fallbackChannelId;
  if (!targetChannelId) return false;

  const guild = client.guilds.cache.get(follow.guildId)
    ?? await client.guilds.fetch(follow.guildId).catch(() => null);
  const channel = guild
    ? guild.channels.cache.get(targetChannelId) ?? await guild.channels.fetch(targetChannelId).catch(() => null)
    : null;

  if (!channel?.isTextBased()) {
    logger.warn(logScope, `Salon ${targetChannelId} introuvable ou non textuel (guilde ${follow.guildId}).`);
    return false;
  }

  try {
    await channel.send({
      content: follow.mention ? `${follow.mention} ${message.content}` : message.content,
      embeds: message.embeds,
      // Sans consigne explicite, la conversion V2 des embeds neutralise tous
      // les pings : la mention configurée doit être autorisée nommément.
      allowedMentions: allowedMentionsFor(follow.mention),
    });
    return true;
  } catch (error) {
    logger.error(logScope, `Envoi de l'alerte impossible (guilde ${follow.guildId}) :`, error);
    return false;
  }
}
