import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { json, type AuthClaims, type DashboardAccess } from '../../shared.js';
import {
  getPulseDashboardDataWithToday,
  backfillPulseHistory,
} from '../../../services/analytics/pulseService.js';
import { invalidatePredictionCache } from '../../../services/analytics/predictionService.js';

import { jsonFailure } from '../../shared/failure.js';
/** Nombre de jours reconsolidés par un « Recalculer ». */
const REFRESH_BACKFILL_DAYS = 7;

/**
 * Un recalcul rejoue plusieurs jours et coûte donc bien plus qu'une lecture :
 * on évite qu'un double-clic (ou plusieurs onglets ouverts) le déclenche en
 * rafale sur la même guilde.
 */
const REFRESH_COOLDOWN_MS = 30_000;
const lastRefreshAt = new Map<string, number>();

export async function handlePulseRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
  _access: DashboardAccess,
): Promise<boolean> {
  const method = req.method;
  if (parts[4] !== 'pulse') return false;

  // GET /api/dashboard/guilds/:guildId/pulse
  if (parts.length === 5 && method === 'GET') {
    try {
      const data = await getPulseDashboardDataWithToday(client, guildId);
      json(res, 200, data);
    } catch (err) {
      logger.error('PulseAPI', 'Error fetching pulse data:', err);
      jsonFailure(res, err, 'Erreur lors de la récupération des données Pulse', 'PulseAPI');
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/pulse/refresh
  if (parts.length === 6 && parts[5] === 'refresh' && method === 'POST') {
    const now = Date.now();
    const previous = lastRefreshAt.get(guildId) ?? 0;
    if (now - previous < REFRESH_COOLDOWN_MS) {
      json(res, 429, {
        error: 'Recalcul déjà en cours, réessayez dans quelques secondes.',
        retryAfterMs: REFRESH_COOLDOWN_MS - (now - previous),
      });
      return true;
    }
    lastRefreshAt.set(guildId, now);

    try {
      const written = await backfillPulseHistory(client, guildId, REFRESH_BACKFILL_DAYS);
      invalidatePredictionCache(guildId);

      const data = await getPulseDashboardDataWithToday(client, guildId);
      json(res, 200, { ...data, recomputedDays: written });
    } catch (err) {
      lastRefreshAt.delete(guildId);
      logger.error('PulseAPI', 'Error refreshing pulse:', err);
      jsonFailure(res, err, 'Erreur lors du rafraîchissement', 'PulseAPI');
    }
    return true;
  }

  return false;
}
