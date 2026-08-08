import { Client, Events, type Message, type PartialMessage, type MessageReaction, type PartialMessageReaction, type User, type PartialUser, type Typing, type ThreadChannel } from 'discord.js';
import type { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';
import { relayMessage, relayMessageEdit, relayMessageDelete, relayReactionAdd, relayTyping, relayThreadCreate, relayThreadMessage, relayThreadDelete, relayPollMessage } from '../services/features/channelLinkService.js';
import { linkRelayBus } from '../services/features/channelLinkGuestService.js';

/**
 * Branche les écouteurs de relais sur un émetteur donné.
 *
 * Ils sont posés deux fois : sur le client, pour les serveurs activés, et sur
 * `linkRelayBus`, seul canal par lequel arrivent les événements des serveurs en
 * mode liaison seule (voir channelLinkGuestService). Les handlers sont
 * identiques : côté relais, un serveur invité est un serveur comme un autre -
 * c'est en amont, dans la garde d'activation, que tout le reste a été écarté.
 */
function attachRelayHandlers(emitter: EventEmitter, client: Client): void {
  emitter.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.guild) return;
    try {
      if (message.channel.isThread()) {
        await relayThreadMessage(message, client);
      } else {
        await relayMessage(message, client);
        if (message.poll) {
          await relayPollMessage(message, client);
        }
      }
    } catch (err) {
      logger.error('ChannelLink', `Erreur relay messageCreate ${message.id}`, err);
    }
  });

  emitter.on(Events.MessageUpdate, async (_old: Message | PartialMessage, newMessage: Message | PartialMessage) => {
    if (newMessage.partial) {
      try { newMessage = await newMessage.fetch(); } catch { return; }
    }
    if (newMessage.author?.bot || !newMessage.guild) return;
    try {
      await relayMessageEdit(newMessage as Message, client);
    } catch (err) {
      logger.error('ChannelLink', `Erreur relay messageUpdate ${newMessage.id}`, err);
    }
  });

  emitter.on(Events.MessageDelete, async (message: Message | PartialMessage) => {
    if (!message.guild || message.author?.bot) return;
    try {
      await relayMessageDelete(message as Message, client);
    } catch (err) {
      logger.error('ChannelLink', `Erreur relay messageDelete ${message.id}`, err);
    }
  });

  emitter.on(Events.MessageReactionAdd, async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
    if (user.bot) return;
    if (reaction.partial) {
      try { reaction = await reaction.fetch(); } catch { return; }
    }
    if (!reaction.message.guild) return;
    try {
      await relayReactionAdd(reaction as MessageReaction, user as User, client);
    } catch (err) {
      logger.error('ChannelLink', `Erreur relay reactionAdd`, err);
    }
  });

  emitter.on(Events.TypingStart, async (typing: Typing) => {
    if (typing.user.bot || !typing.guild) return;
    try {
      await relayTyping(typing.channel.id, typing.guild.id, typing.user.id, client);
    } catch {
      // Silent
    }
  });

  emitter.on(Events.ThreadCreate, async (thread: ThreadChannel) => {
    if (!thread.guild || !thread.parent) return;
    try {
      await relayThreadCreate(thread, client);
    } catch (err) {
      logger.error('ChannelLink', `Erreur relay threadCreate ${thread.id}`, err);
    }
  });

  emitter.on(Events.ThreadDelete, async (thread: ThreadChannel) => {
    if (!thread.guild || !thread.parent) return;
    try {
      await relayThreadDelete(thread, client);
    } catch (err) {
      logger.error('ChannelLink', `Erreur relay threadDelete ${thread.id}`, err);
    }
  });
}

export function registerChannelLinkListener(client: Client): void {
  attachRelayHandlers(client, client);
  attachRelayHandlers(linkRelayBus, client);

  logger.success('ChannelLink', 'Écouteurs ChannelLink enregistrés (create/update/delete/reaction/typing/thread/poll) + bus liaison seule');
}
