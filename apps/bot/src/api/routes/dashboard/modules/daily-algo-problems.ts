/** Routes dashboard du module `daily-algo-problems`. */
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { broadcastDashboardStateChange, getGuildName, json, pushAudit, readJsonBody, resolveAdminAccess } from '../../../shared.js';
import { Prisma } from '@prisma/client';
import { type ModuleRouteContext } from './_shared.js';

import { jsonFailure } from '../../../shared/failure.js';
export async function handleDailyAlgoProblemsRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, user, guildId, method, auditUser, moduleKey } = ctx;

  // GET/POST /api/dashboard/guilds/:guildId/daily-algo-problems
  if (moduleKey === 'daily-algo-problems') {
    if (parts.length === 5 && method === 'GET') {
      try {
        const problems = await prisma.dailyAlgoProblem.findMany({
          orderBy: [
            { usedAt: { sort: 'asc', nulls: 'first' } },
            { createdAt: 'desc' },
          ]
        });
        json(res, 200, problems);
      } catch (err) {
        logger.error('DailyAlgoAPI', 'Error fetching daily algo problems:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération des exercices', 'DailyAlgoAPI');
      }
      return true;
    }

    if (parts.length === 5 && method === 'POST') {
      const MAIN_GUILD_ID = '1477350874740424986';
      const isBotAdmin = await resolveAdminAccess(client, user.userId);
      
      if (guildId !== MAIN_GUILD_ID && !isBotAdmin) {
        json(res, 403, { error: 'Seul le serveur principal peut ajouter des exercices.' });
        return true;
      }

      try {
        const body = await readJsonBody<{
          title: string;
          description: string;
          solution?: string;
          difficulty?: string;
          language?: string;
          functionName?: string;
          functionArgs?: unknown;
          unitTests?: unknown;
          allowedLanguages?: string[];
        }>(req);
        if (!body || !body.title || !body.description) {
          json(res, 400, { error: 'Payload invalide : champs manquants' });
          return true;
        }

        const problem = await prisma.dailyAlgoProblem.create({
          data: {
            title: body.title,
            description: body.description,
            solution: body.solution || '',
            difficulty: body.difficulty || 'moyen',
            language: body.language || 'fr',
            functionName: body.functionName || 'solve',
            functionArgs: body.functionArgs !== undefined ? (body.functionArgs as Prisma.InputJsonValue) : undefined,
            unitTests: body.unitTests !== undefined ? (body.unitTests as Prisma.InputJsonValue) : undefined,
            allowedLanguages: Array.isArray(body.allowedLanguages) ? body.allowedLanguages.map(String) : undefined,
          }
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Ajout Exercice',
          context: getGuildName(client, guildId),
          module: 'Daily Algo',
          eventType: 'Manuel',
          details: `Ajout d'un nouvel exercice : ${problem.title}`,
          channelId: null
        });

        broadcastDashboardStateChange(guildId, 'daily_algo_problems_updated');

        json(res, 201, problem);
      } catch (err) {
        logger.error('DailyAlgoAPI', 'Error creating daily algo problem:', err);
        jsonFailure(res, err, "Erreur lors de la création de l'exercice", 'DailyAlgoAPI');
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/daily-algo-problems/:problemId
    if (parts.length === 6 && method === 'PATCH') {
      const MAIN_GUILD_ID = '1477350874740424986';
      const isBotAdmin = await resolveAdminAccess(client, user.userId);
      
      if (guildId !== MAIN_GUILD_ID && !isBotAdmin) {
        json(res, 403, { error: 'Seul le serveur principal peut modifier des exercices.' });
        return true;
      }

      const problemId = parts[5];
      try {
        const body = await readJsonBody<{
          title?: string;
          description?: string;
          solution?: string;
          difficulty?: string;
          language?: string;
          functionName?: string;
          functionArgs?: unknown;
          unitTests?: unknown;
          allowedLanguages?: string[];
        }>(req);

        if (!body) {
          json(res, 400, { error: 'Payload invalide' });
          return true;
        }

        const existing = await prisma.dailyAlgoProblem.findUnique({
          where: { id: problemId }
        });

        if (!existing) {
          json(res, 404, { error: 'Exercice introuvable' });
          return true;
        }

        const updated = await prisma.dailyAlgoProblem.update({
          where: { id: problemId },
          data: {
            title: body.title !== undefined ? body.title : undefined,
            description: body.description !== undefined ? body.description : undefined,
            solution: body.solution !== undefined ? body.solution : undefined,
            difficulty: body.difficulty !== undefined ? body.difficulty : undefined,
            language: body.language !== undefined ? body.language : undefined,
            functionName: body.functionName !== undefined ? body.functionName : undefined,
            functionArgs: body.functionArgs !== undefined ? (body.functionArgs as Prisma.InputJsonValue) : undefined,
            unitTests: body.unitTests !== undefined ? (body.unitTests as Prisma.InputJsonValue) : undefined,
            allowedLanguages: Array.isArray(body.allowedLanguages) ? body.allowedLanguages.map(String) : undefined,
          }
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Modification Exercice',
          context: getGuildName(client, guildId),
          module: 'Daily Algo',
          eventType: 'Manuel',
          details: `Exercice "${updated.title}" mis à jour.`,
          channelId: null
        });

        broadcastDashboardStateChange(guildId, 'daily_algo_problems_updated');

        json(res, 200, updated);
      } catch (err) {
        logger.error('DailyAlgoAPI', `Error updating daily algo problem ${problemId}:`, err);
        jsonFailure(res, err, "Erreur lors de la modification de l'exercice", 'DailyAlgoAPI');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/daily-algo-problems/:problemId
    if (parts.length === 6 && method === 'DELETE') {
      const MAIN_GUILD_ID = '1477350874740424986';
      const isBotAdmin = await resolveAdminAccess(client, user.userId);
      
      if (guildId !== MAIN_GUILD_ID && !isBotAdmin) {
        json(res, 403, { error: 'Seul le serveur principal peut supprimer des exercices.' });
        return true;
      }

      const problemId = parts[5];
      try {
        const existing = await prisma.dailyAlgoProblem.findUnique({
          where: { id: problemId }
        });

        if (!existing) {
          json(res, 404, { error: 'Exercice introuvable' });
          return true;
        }

        await prisma.dailyAlgoProblem.delete({
          where: { id: problemId }
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression Exercice',
          context: getGuildName(client, guildId),
          module: 'Daily Algo',
          eventType: 'Manuel',
          details: `Exercice "${existing.title}" supprimé.`,
          channelId: null
        });

        broadcastDashboardStateChange(guildId, 'daily_algo_problems_updated');

        json(res, 200, { success: true });
      } catch (err) {
        logger.error('DailyAlgoAPI', `Error deleting daily algo problem ${problemId}:`, err);
        jsonFailure(res, err, "Erreur lors de la suppression de l'exercice", 'DailyAlgoAPI');
      }
      return true;
    }
  }

  return false;
}
