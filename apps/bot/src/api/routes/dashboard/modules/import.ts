/** Routes dashboard du module `import`. */
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { getGuildName, getOrCreateRuntime, json, pushAudit, readJsonBody } from '../../../shared.js';
import { type ModuleRouteContext } from './_shared.js';

import { jsonFailure } from '../../../shared/failure.js';
export async function handleImportRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, guildId, method, auditUser, moduleKey } = ctx;

  // POST /api/dashboard/guilds/:guildId/import
  if (moduleKey === 'import' && parts.length === 5 && method === 'POST') {
    try {
      const body = await readJsonBody<Record<string, unknown>>(req);
      if (!body) {
        json(res, 400, { error: 'Payload import invalide' });
        return true;
      }

      // Bloc `notifications` du fichier d'import : structure connue, mais le
      // fichier vient de l'utilisateur donc tous les champs sont optionnels.
      const notifications = (body?.notifications ?? {}) as Partial<{
        email: string;
        emailEnabled: boolean;
        cloudBackup: boolean;
        debugLog: boolean;
        killSwitchEnabled: boolean;
        severityByModule: unknown;
      }>;

      const runtime = await getOrCreateRuntime(guildId);
      await prisma.dashboardSettings.update({
        where: { guildId },
        data: {
          email: notifications.email ?? runtime.email,
          emailEnabled: !!notifications.emailEnabled,
          cloudBackup: !!notifications.cloudBackup,
          debugLog: !!notifications.debugLog,
          killSwitchEnabled: !!notifications.killSwitchEnabled,
          severityByModule: notifications.severityByModule ?? runtime.severityByModule,
          messageTemplate: body.messageTemplate ?? runtime.messageTemplate
        }
      });

      await pushAudit(guildId, {
        user: auditUser,
        action: 'Import dashboard',
        context: getGuildName(client, guildId),
        module: 'Dashboard',
        eventType: 'Manuel',
        details: 'Configuration importée depuis un fichier JSON.',
        channelId: null
      });

      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('ImportAPI', 'Error importing state:', err);
      jsonFailure(res, err, "Erreur lors de l'importation de la configuration", 'ImportAPI');
    }
    return true;
  }

  return false;
}
