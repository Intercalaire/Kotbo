/**
 * Entonnoir unique des objectifs de jeu.
 *
 * Deux systèmes comptent les mêmes actions — les quêtes et la campagne — et rien ne
 * garantissait qu'ils voient les mêmes. Les brancher séparément à chaque endroit du jeu
 * qui compte quelque chose était la garantie d'en oublier un : une action progresserait
 * dans un écran et pas dans l'autre, sans que rien ne le signale.
 *
 * Tout ce qui compte passe désormais par ici. Chaque destinataire est isolé : la panne de
 * l'un ne prive pas l'autre, et aucun des deux ne fait échouer l'action de jeu déjà
 * accomplie derrière l'appelant.
 */

import type { Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import type { RpgQuestObjective } from './rpgQuestPolicy.js';
import { trackCampaign, type CampaignAdvance } from './rpgCampaignService.js';

const NO_ADVANCE: CampaignAdvance = { completedSteps: [], completedChapters: [], finished: false };

/**
 * Enregistre une action au crédit des quêtes ET de la campagne.
 *
 * Renvoie ce que la campagne a validé, pour que l'écran à l'origine de l'action puisse
 * l'annoncer sur-le-champ — sans quoi le joueur ne découvrirait sa progression qu'en
 * rouvrant l'écran de campagne.
 */
export async function trackRpgObjective(
  client: Client,
  guildId: string,
  userId: string,
  objective: RpgQuestObjective,
  amount = 1,
): Promise<CampaignAdvance> {
  if (amount <= 0) return NO_ADVANCE;

  // Les quêtes avalent déjà leurs propres incidents ; l'import est dynamique pour ne pas
  // tirer le résolveur d'équipe dans des chemins qui n'en ont que faire.
  try {
    const { trackRpgQuest } = await import('./rpgQuestService.js');
    await trackRpgQuest(client, guildId, userId, objective, amount);
  } catch (error) {
    logger.error('RpgObjective', `Quêtes : progression ${objective} en échec pour ${userId} sur ${guildId} :`, error);
  }

  try {
    return await trackCampaign(guildId, userId, objective, amount);
  } catch (error) {
    logger.error('RpgObjective', `Campagne : progression ${objective} en échec pour ${userId} sur ${guildId} :`, error);
    return NO_ADVANCE;
  }
}
