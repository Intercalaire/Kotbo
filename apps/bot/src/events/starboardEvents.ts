/**
 * Starlight : écoute les réactions pour alimenter les highlights.
 *
 * Les réactions sont écoutées directement sur le client plutôt que via le bus :
 * le retrait de réaction n'y transite pas, et le recalcul a besoin du message
 * complet (décompte, images, auteur) que le bus ne transporte pas.
 */

import {
  Client,
  Events,
  type Message,
  type MessageReaction,
  type PartialMessage,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import {
  handleStarboardMessage,
  handleStarboardMessageDelete,
  handleStarboardReaction,
  handleStarboardReactionPurge,
} from '../services/features/starboardService.js';
import { logger } from '../utils/logger.js';

export function registerStarboardListener(client: Client): void {
  const onReaction = async (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ) => {
    // Les réactions du bot sont ses propres amorces : elles ne votent pour rien
    // et le décompte les retire déjà.
    if (user.bot) return;
    if (!reaction.message.guildId) return;

    try {
      await handleStarboardReaction(client, reaction);
    } catch (err) {
      logger.error('Starlight', `Erreur sur la réaction du message ${reaction.message.id}`, err);
    }
  };

  client.on(Events.MessageReactionAdd, onReaction);
  client.on(Events.MessageReactionRemove, onReaction);

  // Purge complète des réactions : le score retombe à zéro d'un coup.
  client.on(Events.MessageReactionRemoveAll, async (message: Message | PartialMessage) => {
    if (!message.guildId) return;
    try {
      await handleStarboardReactionPurge(client, message.guildId, message.channelId, message.id);
    } catch (err) {
      logger.error('Starlight', `Erreur sur la purge des réactions de ${message.id}`, err);
    }
  });

  // Amorçage des salons configurés : pouce haut / pouce bas posés d'office sur
  // chaque nouveau message, pour que le vote démarre sans intervention.
  client.on(Events.MessageCreate, async (message: Message) => {
    if (!message.guildId) return;
    try {
      await handleStarboardMessage(client, message);
    } catch (err) {
      logger.error('Starlight', `Erreur sur l'amorçage du message ${message.id}`, err);
    }
  });

  client.on(Events.MessageDelete, async (message: Message | PartialMessage) => {
    if (!message.guildId) return;
    try {
      await handleStarboardMessageDelete(client, message.guildId, message.channelId, message.id);
    } catch (err) {
      logger.error('Starlight', `Erreur sur la suppression du message ${message.id}`, err);
    }
  });

  logger.info('Modules', 'Module "starlight" enregistré sur les événements de réaction.');
}
