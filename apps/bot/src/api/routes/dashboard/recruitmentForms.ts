import { IncomingMessage, ServerResponse } from 'node:http';
import { json, readJsonBody, type AuthClaims, type DashboardAccess } from '../../shared.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { jsonFailure } from '../../shared/failure.js';
import {
  createRecruitmentForm,
  getRecruitmentForms,
  getRecruitmentForm,
  updateRecruitmentForm,
  deleteRecruitmentForm,
  regenerateFormAPIKey,
  generateGoogleAppsScript,
  generateDefaultRecruitmentForm,
  generateSimpleRecruitmentForm,
  type FormStructure,
} from '../../../services/staff/recruitmentFormService.js';

/**
 * Handles recruitment form management endpoints
 */
export async function handleRecruitmentFormRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  _client: unknown,
  user: AuthClaims,
  guildId: string,
  _access: DashboardAccess
): Promise<boolean> {
  const method = req.method;

  if (parts[4] !== 'recruitment' || parts[5] !== 'forms') {
    return false;
  }

  // GET /api/dashboard/guilds/:guildId/recruitment/forms - List all forms
  if (parts.length === 6 && method === 'GET') {
    try {
      const forms = await getRecruitmentForms(guildId);
      json(res, 200, { forms });
    } catch (err) {
      logger.error('RecruitmentFormAPI', 'Error getting forms:', err);
      jsonFailure(res, err, 'Erreur lors de la récupération des formulaires', 'RecruitmentFormAPI');
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/recruitment/forms - Create new form
  if (parts.length === 6 && method === 'POST') {
    try {
      const body = await readJsonBody<{
        name: string;
        description?: string;
        structure?: FormStructure;
        template?: 'default' | 'simple' | 'custom' | 'google';
      }>(req);

      if (!body?.name) {
        json(res, 400, { error: 'Le nom du formulaire est requis' });
        return true;
      }

      // Use template or custom structure
      let structure = body.structure;
      if (body.template === 'default') {
        structure = generateDefaultRecruitmentForm();
        structure.type = 'default';
      } else if (body.template === 'simple') {
        structure = generateSimpleRecruitmentForm();
        structure.type = 'simple';
      } else if (body.template === 'google') {
        if (structure) structure.type = 'google';
      } else if (body.template === 'custom') {
        if (structure) structure.type = 'custom';
      }

      if (!structure) {
        json(res, 400, { error: 'La structure du formulaire est requise' });
        return true;
      }

      // Get staff member for createdByUserId (FK constraint on APIKey)
      let staffMember = await prisma.staffMember.findUnique({
        where: { guildId_userId: { guildId, userId: user.userId } },
      });

      // Fallback: any staff member in the guild (required for FK constraint)
      if (!staffMember) {
        staffMember = await prisma.staffMember.findFirst({
          where: { guildId },
        });
      }

      if (!staffMember) {
        json(res, 403, { error: 'Aucun membre staff trouvé pour ce serveur. Ajoutez au moins un membre staff avant de créer un formulaire.' });
        return true;
      }

      const createdById = staffMember.id;

      const result = await createRecruitmentForm(
        guildId,
        createdById,
        body.name,
        body.description,
        structure
      );

      json(res, 201, {
        form: result.form,
        apiKey: result.apiKey,
        displayKey: result.displayKey,
      });
    } catch (err) {
      logger.error('RecruitmentFormAPI', 'Error creating form:', err);
      jsonFailure(res, err, 'Erreur lors de la création du formulaire', 'RecruitmentFormAPI');
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/recruitment/forms/:formId - Get specific form
  if (parts.length === 7 && method === 'GET') {
    const formId = parts[6];
    try {
      const form = await getRecruitmentForm(formId, guildId);
      if (!form) {
        json(res, 404, { error: 'Formulaire introuvable' });
        return true;
      }
      json(res, 200, { form });
    } catch (err) {
      logger.error('RecruitmentFormAPI', 'Error getting form:', err);
      jsonFailure(res, err, 'Erreur lors de la récupération du formulaire', 'RecruitmentFormAPI');
    }
    return true;
  }

  // PATCH /api/dashboard/guilds/:guildId/recruitment/forms/:formId - Update form
  if (parts.length === 7 && method === 'PATCH') {
    const formId = parts[6];
    try {
      const body = await readJsonBody<{
        name?: string;
        description?: string;
        structure?: FormStructure;
        isActive?: boolean;
      }>(req);

      await updateRecruitmentForm(formId, guildId, body || {});
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('RecruitmentFormAPI', 'Error updating form:', err);
      jsonFailure(res, err, 'Erreur lors de la mise à jour du formulaire', 'RecruitmentFormAPI');
    }
    return true;
  }

  // DELETE /api/dashboard/guilds/:guildId/recruitment/forms/:formId - Delete form
  if (parts.length === 7 && method === 'DELETE') {
    const formId = parts[6];
    try {
      await deleteRecruitmentForm(formId, guildId);
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('RecruitmentFormAPI', 'Error deleting form:', err);
      jsonFailure(res, err, 'Erreur lors de la suppression du formulaire', 'RecruitmentFormAPI');
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/recruitment/forms/:formId/regenerate-key - Regenerate API key
  if (parts.length === 8 && parts[7] === 'regenerate-key' && method === 'POST') {
    const formId = parts[6];
    try {
      // Resolve staff member ID (FK constraint requires a valid StaffMember.id)
      let staffMember = await prisma.staffMember.findUnique({
        where: { guildId_userId: { guildId, userId: user.userId } },
      });

      // Fallback: any staff member in the guild
      if (!staffMember) {
        staffMember = await prisma.staffMember.findFirst({
          where: { guildId },
        });
      }

      if (!staffMember) {
        json(res, 403, { error: 'Aucun membre staff trouvé pour ce serveur.' });
        return true;
      }

      logger.info('RecruitmentFormAPI', `Regenerating key for form ${formId} with staffMember ${staffMember.id}`);
      const result = await regenerateFormAPIKey(formId, guildId, staffMember.id);
      json(res, 200, { apiKey: result.apiKey, displayKey: result.displayKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('RecruitmentFormAPI', 'Error regenerating API key:', err);
      // Include real error in response for debugging (remove in prod)
      jsonFailure(res, err, 'Erreur lors de la régénération de la clé API', 'RecruitmentFormAPI');
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/recruitment/forms/:formId/script - Generate Google Apps Script
  if (parts.length === 8 && parts[7] === 'script' && method === 'GET') {
    const formId = parts[6];
    try {
      const form = await getRecruitmentForm(formId, guildId);
      if (!form) {
        json(res, 404, { error: 'Formulaire introuvable' });
        return true;
      }

      const webhookUrl = `${url.protocol}//${url.host}/api/dashboard/guilds/${guildId}/recruitment/candidatures`;
      const apiKey = form.apiKey?.displayKey || 'YOUR_API_KEY';
      const script = generateGoogleAppsScript(webhookUrl, apiKey, form.name, guildId);

      json(res, 200, { script });
    } catch (err) {
      logger.error('RecruitmentFormAPI', 'Error generating script:', err);
      jsonFailure(res, err, 'Erreur lors de la génération du script', 'RecruitmentFormAPI');
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/recruitment/forms/templates - Get available templates
  if (parts.length === 7 && parts[6] === 'templates' && method === 'GET') {
    try {
      const templates = {
        default: generateDefaultRecruitmentForm(),
        simple: generateSimpleRecruitmentForm(),
      };
      json(res, 200, { templates });
    } catch (err) {
      logger.error('RecruitmentFormAPI', 'Error getting templates:', err);
      jsonFailure(res, err, 'Erreur lors de la récupération des templates', 'RecruitmentFormAPI');
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/recruitment/forms/:formId/responses - List form responses
  if (parts.length === 8 && parts[7] === 'responses' && method === 'GET') {
    const formId = parts[6];
    try {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 250);
      const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
      const form = await prisma.recruitmentForm.findFirst({
        where: { id: formId, guildId },
        select: { id: true },
      });
      if (!form) {
        json(res, 404, { error: 'Formulaire introuvable' });
        return true;
      }

      const [responses, total] = await Promise.all([
        prisma.recruitmentCandidature.findMany({
          where: { formId, guildId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            discordId: true,
            username: true,
            email: true,
            status: true,
            data: true,
            notes: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.recruitmentCandidature.count({ where: { formId, guildId } }),
      ]);

      json(res, 200, { responses, total, limit, offset });
    } catch (err) {
      logger.error('RecruitmentFormAPI', 'Error fetching form responses:', err);
      jsonFailure(res, err, 'Erreur lors de la récupération des réponses', 'RecruitmentFormAPI');
    }
    return true;
  }

  return false;
}
