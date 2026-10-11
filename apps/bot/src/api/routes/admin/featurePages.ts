/**
 * Pages fonctionnalités du site vitrine (`/api/admin/feature-pages/*`).
 *
 * L'accès administrateur bot est vérifié en amont par `handleAdminRoutes`.
 * Chaque écriture passe au journal d'audit : une page publiée engage Kotbo
 * publiquement.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, json, readJsonBody, type AuthClaims } from '../../shared.js';
import { logger } from '../../../utils/logger.js';
import { recordAdminAudit, resolveRequestIp } from '../../../services/system/adminAuditService.js';
import {
  FeaturePageError,
  createFeaturePage,
  deleteFeaturePage,
  importFeaturePages,
  isLandingRebuildConfigured,
  listFeaturePages,
  missingForPublication,
  updateFeaturePage,
  type FeaturePageInput,
} from '../../../services/system/featurePageService.js';
import { modulesWithoutSeed } from '../../../services/system/featurePageSeeds.js';

function sendError(res: ServerResponse, err: unknown, fallback: string): void {
  if (err instanceof FeaturePageError) {
    json(res, err.status, { error: err.message });
    return;
  }
  if (err instanceof HttpError) {
    json(res, err.statusCode, { error: err.message });
    return;
  }
  logger.error('AdminAPI', fallback, err);
  json(res, 500, { error: fallback });
}

export async function handleAdminFeaturePageRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  user: AuthClaims,
): Promise<boolean> {
  const method = req.method;
  const audit = (action: string, targetId: string, summary: string, metadata?: Parameters<typeof recordAdminAudit>[0]['metadata']) =>
    recordAdminAudit({
      actorId: user.userId,
      actorName: user.username,
      action,
      targetType: 'feature_page',
      targetId,
      summary,
      metadata,
      ip: resolveRequestIp(req),
    });

  // GET /api/admin/feature-pages - toutes les pages, brouillons compris
  if (parts.length === 3 && method === 'GET') {
    try {
      const pages = await listFeaturePages();
      json(res, 200, {
        pages: pages.map((page) => ({ ...page, missing: missingForPublication(page.content) })),
        rebuildConfigured: isLandingRebuildConfigured(),
        modulesWithoutSeed: modulesWithoutSeed(),
      });
    } catch (err) {
      sendError(res, err, 'Erreur lors du chargement des pages.');
    }
    return true;
  }

  // POST /api/admin/feature-pages - nouvelle page
  if (parts.length === 3 && method === 'POST') {
    try {
      const body = await readJsonBody<FeaturePageInput>(req);
      const page = await createFeaturePage(body ?? {}, user.userId);
      await audit('feature_page.create', page.id, `Page « ${page.content.fr.name || page.key} » créée`, {
        key: page.key,
        published: page.published,
      });
      json(res, 201, { page: { ...page, missing: missingForPublication(page.content) } });
    } catch (err) {
      sendError(res, err, 'Erreur lors de la création de la page.');
    }
    return true;
  }

  // POST /api/admin/feature-pages/import - pages manquantes du registre
  if (parts[3] === 'import' && parts.length === 4 && method === 'POST') {
    try {
      const result = await importFeaturePages(user.userId);
      await audit('feature_page.import', 'registry', `${result.created} page(s) importée(s)`, result);
      json(res, 200, result);
    } catch (err) {
      sendError(res, err, "Erreur lors de l'import des pages.");
    }
    return true;
  }

  // PUT /api/admin/feature-pages/:id
  if (parts.length === 4 && method === 'PUT') {
    try {
      const body = await readJsonBody<FeaturePageInput>(req);
      const page = await updateFeaturePage(parts[3], body ?? {}, user.userId);
      await audit('feature_page.update', page.id, `Page « ${page.content.fr.name || page.key} » modifiée`, {
        key: page.key,
        published: page.published,
      });
      json(res, 200, { page: { ...page, missing: missingForPublication(page.content) } });
    } catch (err) {
      sendError(res, err, 'Erreur lors de la modification de la page.');
    }
    return true;
  }

  // DELETE /api/admin/feature-pages/:id
  if (parts.length === 4 && method === 'DELETE') {
    try {
      const page = await deleteFeaturePage(parts[3]);
      await audit('feature_page.delete', page.id, `Page « ${page.content.fr.name || page.key} » supprimée`, {
        key: page.key,
        wasPublished: page.published,
      });
      json(res, 200, { ok: true });
    } catch (err) {
      sendError(res, err, 'Erreur lors de la suppression de la page.');
    }
    return true;
  }

  return false;
}
