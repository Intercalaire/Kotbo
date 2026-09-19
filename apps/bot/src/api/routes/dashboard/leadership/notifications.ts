import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Client } from 'discord.js';
import type { AuthClaims, DashboardAccess } from '../../../shared.js';
import { logger } from '../../../../utils/logger.js';
import { jsonFailure } from '../../../shared/failure.js';
import {
  json,
  
  
  
  
  
  
  
  
} from '../../../shared.js';
import {
  
  
  
  
  
  
  
  
  
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
} from '../../../../services/staff/staffLeadershipService.js';

export async function handleNotificationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
  _access: DashboardAccess
): Promise<boolean> {
  const method = req.method;

    // 8. Notifications routes
    if (parts[4] === 'notifications') {
      // GET /api/dashboard/guilds/:guildId/notifications
      if (method === 'GET' && !parts[5]) {
        try {
          const notifs = await getNotifications(guildId, user.userId);
          json(res, 200, { notifications: notifs });
        } catch (err) {
          logger.error('StaffAPI', 'Error getting notifications:', err);
          jsonFailure(res, err, 'Erreur récupération notifications', 'StaffAPI');
        }
        return true;
      }

      // PATCH /api/dashboard/guilds/:guildId/notifications/:id/read
      if (method === 'PATCH' && parts[5] && parts[6] === 'read') {
        try {
          await markNotificationRead(parts[5], user.userId);
          json(res, 200, { ok: true });
        } catch (err) {
          logger.error('StaffAPI', 'Error marking notification as read:', err);
          jsonFailure(res, err, 'Erreur update notification', 'StaffAPI');
        }
        return true;
      }

      // POST /api/dashboard/guilds/:guildId/notifications/mark-all-read
      if (method === 'POST' && parts[5] === 'mark-all-read') {
        try {
          await markAllNotificationsRead(guildId, user.userId);
          json(res, 200, { ok: true });
        } catch (err) {
          logger.error('StaffAPI', 'Error marking all as read:', err);
          jsonFailure(res, err, 'Erreur update notifications', 'StaffAPI');
        }
        return true;
      }
    }

  return false;
}
