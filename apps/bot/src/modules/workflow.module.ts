import type { Client } from 'discord.js';
import { kotboEventBus } from '@kotbo/core';
import { dispatchEvent } from '../services/features/workflow/workflowService.js';
import { logger } from '../utils/logger.js';

/**
 * Node Workflow Builder - pont entre le bus d'événements et le moteur.
 *
 * Module indépendant : s'il échoue, aucun autre module n'est affecté. Il ne
 * touche pas au système AutoResponse, qui continue de fonctionner en parallèle.
 */

const MODULE_NAME = 'workflow';

export function registerWorkflowBusSubscribers(client: Client): void {
  kotboEventBus.subscribe('member:join', async (payload) => {
    if (payload.isBot) return;
    await dispatchEvent(client, payload.guildId, 'member:join', payload as never);
  }, MODULE_NAME);

  kotboEventBus.subscribe('member:leave', async (payload) => {
    if (payload.isBot) return;
    await dispatchEvent(client, payload.guildId, 'member:leave', payload as never);
  }, MODULE_NAME);

  /**
   * Discord ne publie pas d'événement dédié aux rôles : `member:update`
   * transporte déjà les rôles gagnés et perdus, on en dérive donc deux
   * déclencheurs distincts plutôt que d'ajouter des publications au bus.
   */
  kotboEventBus.subscribe('member:update', async (payload) => {
    if (payload.addedRoles.length > 0) {
      await dispatchEvent(client, payload.guildId, 'member:role-added', payload as never);
    }
    if (payload.removedRoles.length > 0) {
      await dispatchEvent(client, payload.guildId, 'member:role-removed', payload as never);
    }
  }, MODULE_NAME);

  kotboEventBus.subscribe('message:new', async (payload) => {
    if (payload.isBot) return;
    await dispatchEvent(client, payload.guildId, 'message:new', payload as never);
  }, MODULE_NAME);

  kotboEventBus.subscribe('reaction:add', async (payload) => {
    await dispatchEvent(client, payload.guildId, 'reaction:add', payload as never);
  }, MODULE_NAME);

  kotboEventBus.subscribe('voice:join', async (payload) => {
    await dispatchEvent(client, payload.guildId, 'voice:join', payload as never);
  }, MODULE_NAME);

  kotboEventBus.subscribe('voice:leave', async (payload) => {
    await dispatchEvent(client, payload.guildId, 'voice:leave', payload as never);
  }, MODULE_NAME);

  kotboEventBus.subscribe('sanction:applied', async (payload) => {
    await dispatchEvent(client, payload.guildId, 'sanction:applied', payload as never);
  }, MODULE_NAME);

  logger.info('Modules', `Module "${MODULE_NAME}" enregistré sur le bus d'events.`);
}
