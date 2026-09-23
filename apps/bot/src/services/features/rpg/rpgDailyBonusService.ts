import { normalizeTimezone } from '@kotbo/contracts';
import prisma from '../../../utils/db.js';
import { getCachedGuild } from '../../../utils/cache.js';
import { zonedDayStartOf } from './rpgDailyBonusPolicy.js';

/**
 * Vrai si le joueur n'a encore gagné aucun combat aujourd'hui, dans le fuseau du serveur.
 *
 * À appeler avant d'écrire la victoire en cours dans le journal, sinon elle se compterait
 * elle-même.
 */
export async function isFirstWinToday(guildId: string, userId: string, now = new Date()): Promise<boolean> {
  const guild = await getCachedGuild(guildId);
  const dayStart = zonedDayStartOf(now, normalizeTimezone(guild?.timezone));
  const wins = await prisma.rpgBattle.count({ where: { guildId, userId, won: true, createdAt: { gte: dayStart } } });
  return wins === 0;
}
