import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { json, type AuthClaims, type DashboardAccess } from '../../shared.js';
import { getSatisfactionDashboardData, getStaffSatisfactionReviews } from '../../../services/features/ticketSatisfactionService.js';

export async function handleSatisfactionRoutes(
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
  if (parts[4] !== 'satisfaction') return false;

  // GET /api/dashboard/guilds/:guildId/satisfaction
  if (parts.length === 5 && method === 'GET') {
    try {
      const data = await getSatisfactionDashboardData(guildId, client);
      json(res, 200, data);
    } catch (err) {
      logger.error('SatisfactionAPI', 'Error fetching satisfaction data:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des données' });
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/satisfaction/staff/:staffId/reviews
  if (parts.length === 8 && parts[5] === 'staff' && parts[7] === 'reviews' && method === 'GET') {
    const staffId = parts[6];
    if (!/^\d{5,25}$/.test(staffId)) {
      json(res, 400, { error: 'Identifiant staff invalide' });
      return true;
    }

    try {
      const data = await getStaffSatisfactionReviews(
        guildId,
        staffId,
        {
          limit: Number(url.searchParams.get('limit') ?? 20),
          offset: Number(url.searchParams.get('offset') ?? 0),
          commentsOnly: url.searchParams.get('commentsOnly') === 'true',
        },
        client,
      );
      json(res, 200, data);
    } catch (err) {
      logger.error('SatisfactionAPI', 'Error fetching staff reviews:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des avis' });
    }
    return true;
  }

  return false;
}
