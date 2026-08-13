import { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { json, type AuthClaims, type DashboardAccess } from '../../shared.js';
import prisma from '../../../utils/db.js';
import {
  pushWidgetForUser,
  clearWidgetForUser,
  refreshAllStaffWidgets,
} from '../../../services/integrations/widgetService.js';

/** Token secret utilisé par les widgets externes (Scriptable, KWGT, widget Edge). */
function generateWidgetToken(): string {
  return `wgt_${crypto.randomBytes(24).toString('hex')}`;
}

export async function handleWidgetRoutes(
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
  if (parts[4] !== 'widget') return false;

  // GET /api/dashboard/guilds/:guildId/widget - liste des subscriptions
  if (parts.length === 5 && method === 'GET') {
    try {
      const subscriptions = await prisma.widgetSubscription.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
      });

      let mySubscription = subscriptions.find((s) => s.userId === user.userId) ?? null;

      // Génération paresseuse du token pour les subscriptions créées avant son introduction
      if (mySubscription && !mySubscription.token) {
        mySubscription = await prisma.widgetSubscription.update({
          where: { id: mySubscription.id },
          data: { token: generateWidgetToken() },
        });
      }

      json(res, 200, {
        // Le token est secret : on ne l'expose jamais pour les autres membres
        subscriptions: subscriptions.map(({ token: _token, ...rest }) => rest),
        mySubscription,
      });
    } catch (err) {
      logger.error('WidgetAPI', 'Error fetching widget data:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des données widget' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/widget/rotate-token - régénérer le token widget
  if (parts.length === 6 && parts[5] === 'rotate-token' && method === 'POST') {
    try {
      const subscription = await prisma.widgetSubscription.update({
        where: { guildId_userId: { guildId, userId: user.userId } },
        data: { token: generateWidgetToken() },
      });
      json(res, 200, { success: true, token: subscription.token });
    } catch (err) {
      logger.error('WidgetAPI', 'Error rotating widget token:', err);
      json(res, 500, { error: 'Erreur lors de la régénération du token' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/widget/activate - activer le widget pour l'utilisateur connecté
  if (parts.length === 6 && parts[5] === 'activate' && method === 'POST') {
    try {
      await prisma.widgetSubscription.upsert({
        where: { guildId_userId: { guildId, userId: user.userId } },
        update: { enabled: true },
        create: { guildId, userId: user.userId, enabled: true, token: generateWidgetToken() },
      });

      const result = await pushWidgetForUser(guildId, user.userId);
      json(res, 200, { success: result.ok, pushResult: result });
    } catch (err) {
      logger.error('WidgetAPI', 'Error activating widget:', err);
      json(res, 500, { error: 'Erreur lors de l\'activation du widget' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/widget/deactivate - désactiver le widget
  if (parts.length === 6 && parts[5] === 'deactivate' && method === 'POST') {
    try {
      await prisma.widgetSubscription.updateMany({
        where: { guildId, userId: user.userId },
        data: { enabled: false },
      });

      const result = await clearWidgetForUser(user.userId);
      json(res, 200, { success: true, clearResult: result });
    } catch (err) {
      logger.error('WidgetAPI', 'Error deactivating widget:', err);
      json(res, 500, { error: 'Erreur lors de la désactivation du widget' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/widget/refresh - rafraîchir le widget de l'utilisateur
  if (parts.length === 6 && parts[5] === 'refresh' && method === 'POST') {
    try {
      const result = await pushWidgetForUser(guildId, user.userId);
      json(res, 200, { success: true, pushResult: result });
    } catch (err) {
      logger.error('WidgetAPI', 'Error refreshing widget:', err);
      json(res, 500, { error: 'Erreur lors du rafraîchissement du widget' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/widget/refresh-all - rafraîchir tous les widgets (admin)
  if (parts.length === 6 && parts[5] === 'refresh-all' && method === 'POST') {
    try {
      const result = await refreshAllStaffWidgets(guildId);
      json(res, 200, result);
    } catch (err) {
      logger.error('WidgetAPI', 'Error refreshing all widgets:', err);
      json(res, 500, { error: 'Erreur lors du rafraîchissement global' });
    }
    return true;
  }

  return false;
}
