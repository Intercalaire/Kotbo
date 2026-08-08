import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { Prisma } from '@prisma/client';
import { logger } from '../../../utils/logger.js';
import { json, readJsonBody, type AuthClaims, type DashboardAccess } from '../../shared.js';
import {
  createCustomForm,
  getCustomForms,
  getCustomForm,
  deleteCustomForm,
  getCustomFormSubmissions,
  type CustomFormStructure,
} from '../../../services/features/customFormService.js';
import { sanitizeCustomCss, sanitizeFormTheme } from '../../../utils/formCustomization.js';
import { getMemberIdentities } from '../../../services/moderation/memberIdentityService.js';

interface CustomFormCreateBody {
  name: string;
  description?: string;
  structure?: CustomFormStructure;
  isRecruitment?: boolean;
  requiresDiscordAuth?: boolean;
  theme?: unknown;
  customCss?: string | null;
  hierarchyId?: string | null;
}

interface CustomFormUpdateBody {
  name?: string;
  description?: string;
  structure?: CustomFormStructure;
  isActive?: boolean;
  isRecruitment?: boolean;
  requiresDiscordAuth?: boolean;
  theme?: unknown;
  customCss?: string | null;
  hierarchyId?: string | null;
}

/**
 * Handles custom form management endpoints
 */
export async function handleCustomFormRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  _client: Client,
  _user: AuthClaims,
  guildId: string,
  _access: DashboardAccess
): Promise<boolean> {
  const method = req.method;

  if (parts[4] !== 'custom-forms') {
    return false;
  }

  // GET /api/dashboard/guilds/:guildId/custom-forms - List all forms
  if (parts.length === 5 && method === 'GET') {
    try {
      const forms = await getCustomForms(guildId, url.searchParams.get('includeStructure') === 'true');
      json(res, 200, { forms });
    } catch (err) {
      logger.error('CustomFormsAPI', 'Error getting custom forms:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des formulaires' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/custom-forms - Create new form
  if (parts.length === 5 && method === 'POST') {
    try {
      const body = await readJsonBody<CustomFormCreateBody>(req);

      if (!body?.name) {
        json(res, 400, { error: 'Le nom du formulaire est requis' });
        return true;
      }

      if (body.hierarchyId) {
        const hierarchy = await prisma.staffHierarchy.findFirst({ where: { id: body.hierarchyId, guildId } });
        if (!hierarchy) {
          json(res, 400, { error: 'Hiérarchie introuvable pour ce serveur' });
          return true;
        }
      }

      const form = await createCustomForm(guildId, {
        name: body.name,
        description: body.description,
        structure: body.structure || { title: body.name, fields: [] },
        isRecruitment: body.isRecruitment,
        requiresDiscordAuth: body.requiresDiscordAuth,
        theme: sanitizeFormTheme(body.theme),
        customCss: sanitizeCustomCss(body.customCss),
        hierarchyId: body.hierarchyId ?? undefined,
      });

      json(res, 201, { form });
    } catch (err) {
      logger.error('CustomFormsAPI', 'Error creating custom form:', err);
      json(res, 500, { error: 'Erreur lors de la création du formulaire' });
    }
    return true;
  }

  // Routes avec :formId
  if (parts[5]) {
    const formId = parts[5];

    // GET /api/dashboard/guilds/:guildId/custom-forms/:formId - Get specific form
    if (parts.length === 6 && method === 'GET') {
      try {
        const form = await getCustomForm(formId, guildId);
        if (!form) {
          json(res, 404, { error: 'Formulaire introuvable' });
          return true;
        }
        json(res, 200, { form });
      } catch (err) {
        logger.error('CustomFormsAPI', 'Error getting custom form:', err);
        json(res, 500, { error: 'Erreur lors de la récupération du formulaire' });
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/custom-forms/:formId - Update form
    if (parts.length === 6 && method === 'PATCH') {
      try {
        const body = await readJsonBody<CustomFormUpdateBody>(req);

        if (!body) {
          json(res, 400, { error: 'Le corps de la requête est vide' });
          return true;
        }

        if (body.hierarchyId) {
          const hierarchy = await prisma.staffHierarchy.findFirst({ where: { id: body.hierarchyId, guildId } });
          if (!hierarchy) {
            json(res, 400, { error: 'Hiérarchie introuvable pour ce serveur' });
            return true;
          }
        }

        // Clean database update
        await prisma.customForm.updateMany({
          where: { id: formId, guildId },
          data: {
            name: body.name,
            description: body.description,
            structure: body.structure ? (body.structure as unknown as Prisma.InputJsonValue) : undefined,
            isActive: body.isActive !== undefined ? body.isActive : undefined,
            isRecruitment: body.isRecruitment !== undefined ? body.isRecruitment : undefined,
            requiresDiscordAuth: body.requiresDiscordAuth !== undefined ? body.requiresDiscordAuth : undefined,
            // Le thème et le CSS sont sanitizés côté serveur : null efface, undefined ignore
            theme: body.theme !== undefined
              ? ((sanitizeFormTheme(body.theme) ?? Prisma.JsonNull) as Prisma.InputJsonValue)
              : undefined,
            customCss: body.customCss !== undefined ? sanitizeCustomCss(body.customCss) : undefined,
            hierarchyId: body.hierarchyId !== undefined ? body.hierarchyId : undefined,
          },
        });

        json(res, 200, { ok: true });
      } catch (err) {
        logger.error('CustomFormsAPI', 'Error updating custom form:', err);
        json(res, 500, { error: 'Erreur lors de la mise à jour du formulaire' });
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/custom-forms/:formId - Delete form
    if (parts.length === 6 && method === 'DELETE') {
      try {
        await deleteCustomForm(formId, guildId);
        json(res, 200, { ok: true });
      } catch (err) {
        logger.error('CustomFormsAPI', 'Error deleting custom form:', err);
        json(res, 500, { error: 'Erreur lors de la suppression du formulaire' });
      }
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/custom-forms/:formId/submissions - Get form submissions
    if (parts.length === 7 && parts[6] === 'submissions' && method === 'GET') {
      try {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 250);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        const [submissions, total] = await Promise.all([
          getCustomFormSubmissions(formId, guildId, limit, offset),
          prisma.customFormSubmission.count({ where: { formId, guildId } }),
        ]);
        // La soumission fige le pseudo au moment de l'envoi et ne stocke aucune
        // photo : on resout l'identite pour que la liste affiche un visage.
        const identities = await getMemberIdentities(
          _client,
          guildId,
          submissions.map((submission) => submission.userId).filter((id): id is string => !!id),
        );
        json(res, 200, {
          submissions: submissions.map((submission) => {
            const identity = submission.userId ? identities.get(submission.userId) : undefined;
            return {
              ...submission,
              username: identity?.displayName || submission.username,
              avatarUrl: identity?.avatarUrl || null,
            };
          }),
          total,
          limit,
          offset,
        });
      } catch (err) {
        logger.error('CustomFormsAPI', 'Error getting custom form submissions:', err);
        json(res, 500, { error: 'Erreur lors de la récupération des soumissions' });
      }
      return true;
    }
  }

  return false;
}
