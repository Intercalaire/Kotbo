/**
 * Tâches d'entretien du module Ranked appelées par les crons.
 *
 * Séparées des services métier pour que le fichier de crons n'ait à importer
 * qu'un point d'entrée par tâche, sans connaître le découpage interne.
 */

import { prismaRead } from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { refillStreakFreezes } from './rankedService.js';

const LOG_TAG = 'RankedMaintenance';

/**
 * Recharge hebdomadaire des gels de série sur toutes les guildes concernées.
 *
 * Sans cette recharge, les gels ne serviraient qu'une fois : la série
 * deviendrait un tout-ou-rien qui punit une semaine de vacances aussi
 * durement qu'un abandon.
 */
export async function refillAllStreakFreezes(): Promise<number> {
  const configs = await prismaRead.rankedConfig.findMany({
    where: { enabled: true, streakEnabled: true, streakWeeklyFreezes: { gt: 0 } },
    select: { guildId: true },
  });

  let total = 0;
  for (const { guildId } of configs) {
    const count = await refillStreakFreezes(guildId).catch((err) => {
      logger.error(LOG_TAG, `Recharge des gels impossible sur ${guildId}:`, err);
      return 0;
    });
    total += count;
  }

  if (total > 0) logger.info(LOG_TAG, `Gels de série rechargés pour ${total} membres.`);
  return total;
}
