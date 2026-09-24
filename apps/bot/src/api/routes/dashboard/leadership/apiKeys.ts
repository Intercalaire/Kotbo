import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Client } from 'discord.js';
import type { AuthClaims, DashboardAccess } from '../../../shared.js';
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { jsonFailure } from '../../../shared/failure.js';
import {
  json,
  readJsonBody,
  getGuildName,
  
  pushAudit,
  
  
  
  
} from '../../../shared.js';
import {
  getStaffMember,
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  createAPIKey,
  getAPIKeys,
  deleteAPIKey,
  hashAPIKey,
  generateAPIKey,
  
  
  
  
  
  
  
  
  
} from '../../../../services/staff/staffManagementService.js';

export async function handleApiKeyRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
  access: DashboardAccess
): Promise<boolean> {
  const method = req.method;

    // 4. API Keys routes
    if (parts[4] === 'api-keys') {
      // POST /api/dashboard/guilds/:guildId/api-keys
      if (method === 'POST' && !parts[5]) {
        try {
          const body = await readJsonBody<{
            name?: string;
            permissions?: string[];
          }>(req);

          const { fullKey, displayKey } = generateAPIKey();
          const keyHash = hashAPIKey(fullKey);

          const apiKey = await createAPIKey(
            guildId,
            user.userId,
            keyHash,
            displayKey,
            body?.name || 'Mon clé API',
            body?.permissions || ['daily_algo:create_exercise']
          );

          await pushAudit(guildId, {
            user: user.username ?? `User${user.userId}`,
            action: 'Création clé API',
            context: getGuildName(client, guildId),
            module: 'Staff Management',
            eventType: 'Manuel',
            details: `Clé API créée: ${displayKey}`,
            channelId: null
          });

          json(res, 201, {
            id: apiKey.id,
            fullKey,
            displayKey: apiKey.displayKey,
            name: apiKey.name,
            permissions: apiKey.permissions,
          });
        } catch (err) {
          logger.error('StaffAPI', 'Error creating API key:', err);
          jsonFailure(res, err, 'Erreur lors de la création de la clé API', 'StaffAPI');
        }
        return true;
      }

      // GET /api/dashboard/guilds/:guildId/api-keys
      if (method === 'GET' && !parts[5]) {
        try {
          const keys = await getAPIKeys(guildId, user.userId);
          json(res, 200, { keys });
        } catch (err) {
          logger.error('StaffAPI', 'Error getting API keys:', err);
          jsonFailure(res, err, 'Erreur lors de la récupération des clés API', 'StaffAPI');
        }
        return true;
      }

      // DELETE /api/dashboard/guilds/:guildId/api-keys/:keyId
      if (method === 'DELETE' && parts[5]) {
        const keyId = parts[5];
        try {
          // Filtrée par serveur : un admin d'ici supprimait sinon la clé d'un autre serveur.
          const key = await prisma.aPIKey.findFirst({ where: { id: keyId, guildId } });
          if (!key) {
            json(res, 404, { error: 'Clé API introuvable' });
            return true;
          }
          const requesterStaff = await getStaffMember(guildId, user.userId);
          if (!requesterStaff || (key.createdByUserId !== requesterStaff.id && access.level !== 'admin')) {
            json(res, 403, { error: 'Non autorisé à supprimer cette clé API' });
            return true;
          }

          await deleteAPIKey(guildId, keyId);

          await pushAudit(guildId, {
            user: user.username ?? `User${user.userId}`,
            action: 'Suppression clé API',
            context: getGuildName(client, guildId),
            module: 'Staff Management',
            eventType: 'Manuel',
            details: `Clé API supprimée: ${keyId}`,
            channelId: null
          });

          json(res, 200, { ok: true });
        } catch (err) {
          logger.error('StaffAPI', 'Error deleting API key:', err);
          jsonFailure(res, err, 'Erreur lors de la suppression de la clé API', 'StaffAPI');
        }
        return true;
      }
    }

  return false;
}
