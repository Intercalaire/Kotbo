/**
 * GET /api/dashboard/guilds/:guildId/home-tasks
 *
 * Liste « a traiter » de l'accueil. Le calcul et le filtrage par droit vivent
 * dans `services/core/homeTasksService.ts` ; la route ne fait que resoudre le
 * lecteur.
 */
import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { json, type AuthClaims, type DashboardAccess } from '../../shared.js';
import { jsonFailure } from '../../shared/failure.js';
import { buildHomeTasks } from '../../../services/core/homeTasksService.js';
import { getCachedFeatureAccess } from './featureGate.js';

export async function handleHomeTasksRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  client: Client,
  user: AuthClaims,
  guildId: string,
  access: DashboardAccess,
): Promise<boolean> {
  if (parts[4] !== 'home-tasks') return false;
  if (parts.length !== 5 || req.method !== 'GET') return false;

  try {
    const featureAccess = await getCachedFeatureAccess(client, guildId, access, user.userId);
    const data = await buildHomeTasks(client, guildId, {
      userId: user.userId,
      canManageSettings: access.canManageSettings,
      canView: (featureKey) => featureAccess[featureKey]?.canView !== false,
    });
    json(res, 200, data);
  } catch (err) {
    logger.error('HomeTasksAPI', 'Error building home tasks:', err);
    jsonFailure(res, err, 'Erreur lors du calcul des sujets à traiter', 'HomeTasksAPI');
  }

  return true;
}
