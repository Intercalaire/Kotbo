/**
 * Sticky Message Module - Bus-based subscriber
 *
 * Écoute `message:new` et fait remonter le message collé au bas des salons
 * configurés. Toute la logique de seuil / cooldown vit dans le service.
 */

import type { Client } from 'discord.js';
import { kotboEventBus } from '@kotbo/core';
import { handleStickyMessage } from '../services/features/stickyMessageService.js';
import { logger } from '../utils/logger.js';

const MODULE_NAME = 'sticky-message';

export function registerStickyMessageBusSubscribers(client: Client): void {
  kotboEventBus.subscribe('message:new', async (payload) => {
    if (!payload.guildId) return;
    // Les réponses éphémères d'interaction ne repoussent visuellement rien.
    if (payload.isInteraction) return;

    try {
      await handleStickyMessage(client, payload.guildId, payload.channelId, payload.authorId);
    } catch (err) {
      logger.error('Sticky', `Erreur sur le message ${payload.messageId}`, err);
    }
  }, MODULE_NAME);

  logger.info('Modules', `Module "${MODULE_NAME}" enregistre sur le bus d'events.`);
}
