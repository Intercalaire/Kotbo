/**
 * conversationTracker.ts
 *
 * Alimente les stats de conversation en direct : tours de parole et temps de
 * réponse par salon, réponses et mentions entre membres. Suit
 * `Guild.analyticsEnabled` comme le reste de la collecte. Les bots, messages
 * système et webhooks n'ouvrent ni ne ferment de tour.
 *
 * Un fil est suivi comme une conversation à part (ses tours ne se mêlent pas
 * à ceux du salon), mais ses chiffres sont rangés sous le salon parent.
 */

import { Events, MessageReferenceType, type Client, type Message } from 'discord.js';
import { logger } from '../utils/logger.js';
import { isGuildActivated } from '../utils/activation.js';
import { isAnalyticsCollectionEnabled } from '../services/analytics/analyticsConsent.js';
import {
  queueInteraction,
  queueTurnEvents,
  responseTracker,
  startConversationStatsFlusher,
} from '../services/analytics/conversationStatsService.js';

async function handleMessage(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild || message.author.bot || message.system || message.webhookId) return;
  if (!isGuildActivated(guild.id) || !(await isAnalyticsCollectionEnabled(guild.id))) return;

  const channel = message.channel;
  const statsChannelId = channel.isThread() && channel.parentId ? channel.parentId : message.channelId;
  queueTurnEvents(responseTracker.onMessage(guild.id, message.channelId, statsChannelId, message.author.id, message.createdTimestamp));

  const dateKey = message.createdAt.toISOString().slice(0, 10);
  const isReply = message.reference?.type === MessageReferenceType.Default;
  const repliedTo = isReply ? message.mentions.repliedUser : null;
  if (repliedTo && !repliedTo.bot) queueInteraction(guild.id, dateKey, message.author.id, repliedTo.id, { replies: 1 });
  for (const user of message.mentions.users.values()) {
    // La mention automatique d'une réponse est déjà comptée comme réponse.
    if (user.bot || user.id === repliedTo?.id) continue;
    queueInteraction(guild.id, dateKey, message.author.id, user.id, { mentions: 1 });
  }
}

export function registerConversationTracker(client: Client): void {
  startConversationStatsFlusher();
  client.on(Events.MessageCreate, (message: Message) => {
    void handleMessage(message).catch((err) => logger.error('ConversationStats', 'Suivi de conversation impossible :', err));
  });
  client.on(Events.ChannelDelete, (channel) => {
    responseTracker.forget((turn) => turn.statsChannelId === channel.id);
  });
  client.on(Events.GuildDelete, (guild) => {
    responseTracker.forget((turn) => turn.guildId === guild.id);
  });
}
