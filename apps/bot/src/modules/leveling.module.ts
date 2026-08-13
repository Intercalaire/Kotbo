/**
 * Leveling Module - Bus-based subscriber
 *
 * Subscribes to KotboEventBus events for text XP attribution.
 * Voice XP is handled via the existing interval loop in levelingEvents.ts
 * because it polls client.guilds.cache - not event-driven.
 */

import type { Client } from 'discord.js';
import { subscribeForModule } from '../services/core/moduleScope.js';
import { handleTextXp } from '../services/progression/levelingService.js';
import { handleUserActivity } from '../services/features/economyService.js';
import { logger } from '../utils/logger.js';

const MODULE_NAME = 'leveling';

export function registerLevelingBusSubscribers(client: Client): void {
  subscribeForModule('leveling', 'message:new', async (payload) => {
    if (payload.isBot || payload.isCommand) return;

    const messageLength = (payload.content ?? '').trim().length;
    await handleTextXp(payload.guildId, payload.authorId, client, payload.channelId, messageLength);
    await handleUserActivity(payload.guildId, payload.authorId, 'text').catch(() => null);
  }, MODULE_NAME);

  logger.info('Modules', `Module "${MODULE_NAME}" enregistre sur le bus d'events.`);
}
