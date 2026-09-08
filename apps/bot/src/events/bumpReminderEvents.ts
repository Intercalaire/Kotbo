import { Client, Events, Message } from 'discord.js';
import { handlePotentialBumpMessage } from '../services/integrations/bumpDetectionService.js';
import { logger } from '../utils/logger.js';

export function registerBumpReminderListener(client: Client) {
  client.on(Events.MessageCreate, async (message: Message) => {
    try {
      await handlePotentialBumpMessage(message);
    } catch (err) {
      logger.error('BumpReminder', 'Erreur lors de la détection de bump :', err);
    }
  });

  logger.info('System', 'Écouteur Rappel de bump enregistré.');
}
