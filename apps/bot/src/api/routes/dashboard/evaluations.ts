import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { json, type AuthClaims, type DashboardAccess } from '../../shared.js';
import { jsonFailure } from '../../shared/failure.js';
import {
  getEvaluationsDashboardData,
  generateStaffEvaluation,
  generateAllStaffEvaluations,
  updateEvaluationNote,
} from '../../../services/staff/staffEvaluationService.js';

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

export async function handleEvaluationRoutes(
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
  if (parts[4] !== 'evaluations') return false;

  // GET /api/dashboard/guilds/:guildId/evaluations
  if (parts.length === 5 && method === 'GET') {
    try {
      const data = await getEvaluationsDashboardData(guildId);
      json(res, 200, data);
    } catch (err) {
      logger.error('EvaluationsAPI', 'Error fetching evaluations:', err);
      jsonFailure(res, err, 'Erreur lors de la récupération des évaluations', 'EvaluationsAPI');
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/evaluations/generate
  if (parts.length === 6 && parts[5] === 'generate' && method === 'POST') {
    try {
      const body = await parseBody(req) as { staffUserId?: string; periodDays?: number };
      if (body.staffUserId) {
        const evaluation = await generateStaffEvaluation(guildId, body.staffUserId, body.periodDays ?? 30);
        json(res, 200, evaluation);
      } else {
        const evaluations = await generateAllStaffEvaluations(guildId, body.periodDays ?? 30);
        json(res, 200, { evaluations, count: evaluations.length });
      }
    } catch (err) {
      logger.error('EvaluationsAPI', 'Error generating evaluation:', err);
      jsonFailure(res, err, 'Erreur lors de la génération', 'EvaluationsAPI');
    }
    return true;
  }

  // PATCH /api/dashboard/guilds/:guildId/evaluations/:evaluationId
  if (parts.length === 6 && method === 'PATCH') {
    try {
      const body = await parseBody(req) as { managerNote?: string };
      if (body.managerNote !== undefined) {
        const updated = await updateEvaluationNote(parts[5], body.managerNote);
        json(res, 200, updated);
      } else {
        json(res, 400, { error: 'managerNote requis' });
      }
    } catch (err) {
      logger.error('EvaluationsAPI', 'Error updating evaluation:', err);
      jsonFailure(res, err, 'Erreur lors de la mise à jour', 'EvaluationsAPI');
    }
    return true;
  }

  return false;
}
