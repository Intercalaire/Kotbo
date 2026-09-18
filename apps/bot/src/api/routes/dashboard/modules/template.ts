/** Routes dashboard du module `template`. */
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { getGuildName, getOrCreateRuntime, json, pushAudit, readJsonBody } from '../../../shared.js';
import { type ModuleRouteContext } from './_shared.js';

import { jsonFailure } from '../../../shared/failure.js';
export async function handleTemplateRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, guildId, method, auditUser, moduleKey } = ctx;

  // PUT /api/dashboard/guilds/:guildId/template
  if (moduleKey === 'template' && parts.length === 5 && method === 'PUT') {
    try {
      const body = await readJsonBody<{ messageTemplate: string }>(req);
      const runtime = await getOrCreateRuntime(guildId);
      await prisma.dashboardSettings.update({
        where: { guildId },
        data: { messageTemplate: body?.messageTemplate || runtime.messageTemplate }
      });
      await pushAudit(guildId, {
        user: auditUser,
        action: 'Mise à jour template',
        context: getGuildName(client, guildId),
        module: 'Contenu',
        eventType: 'Manuel',
        details: 'Template de message éditorial mis à jour.',
        channelId: null
      });
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('TemplateAPI', 'Error updating template:', err);
      jsonFailure(res, err, 'Erreur lors de la mise à jour du template', 'TemplateAPI');
    }
    return true;
  }

  return false;
}
