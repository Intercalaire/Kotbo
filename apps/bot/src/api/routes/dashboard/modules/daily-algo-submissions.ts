/** Routes dashboard du module `daily-algo-submissions`. */
import { getLocalDateKey, reviewDailyAlgoSubmission } from '../../../../services/progression/dailyAlgoService.js';
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { getGuildName, json, pushAudit, readJsonBody, resolveDailyAlgoTotalPoints } from '../../../shared.js';
import { type ModuleRouteContext, resolveDailyAlgoFinalScore } from './_shared.js';

import { jsonFailure } from '../../../shared/failure.js';
export async function handleDailyAlgoSubmissionsRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, url, client, user, guildId, method, auditUser, moduleKey } = ctx;

  // GET/PATCH daily-algo-submissions routes
  if (moduleKey === 'daily-algo-submissions') {
    // GET /api/dashboard/guilds/:guildId/daily-algo-submissions/global-leaderboard
    if (parts.length === 6 && parts[5] === 'global-leaderboard' && method === 'GET') {
      try {
        const dateKey = getLocalDateKey();
        const runs = await prisma.dailyAlgoRun.findMany({
          where: { dateKey },
          select: { id: true, guildId: true }
        });

        const runIds = runs.map(r => r.id);
        const rawSubmissions = await prisma.dailyAlgoSubmission.findMany({
          where: { runId: { in: runIds }, status: 'APPROVED' },
          include: {
            run: {
              select: { guildId: true }
            }
          }
        });

        const submissions = rawSubmissions.map(submission => {
          const finalScore = resolveDailyAlgoFinalScore(submission);
          const totalPoints = resolveDailyAlgoTotalPoints(submission);

          return {
            id: submission.id,
            authorId: submission.authorId,
            authorName: submission.authorName,
            guildId: submission.run.guildId,
            guildName: getGuildName(client, submission.run.guildId),
            scoreFinal: finalScore,
            speedBonusPoints: submission.speedBonusPoints,
            totalPoints,
            submittedAt: submission.submittedAt.toISOString(),
          };
        });

        submissions.sort((a, b) => {
          if ((b.totalPoints ?? 0) !== (a.totalPoints ?? 0)) return (b.totalPoints ?? 0) - (a.totalPoints ?? 0);
          return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
        });

        json(res, 200, { dateKey, submissions });
      } catch (err) {
        logger.error('DailyAlgoAPI', 'Error getting global leaderboard:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération du classement global', 'DailyAlgoAPI');
      }
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/daily-algo-submissions/today
    if (parts.length === 6 && parts[5] === 'today' && method === 'GET') {
      try {
        const dateKey = getLocalDateKey();
        const run = await prisma.dailyAlgoRun.findUnique({
          where: {
            guildId_dateKey: {
              guildId,
              dateKey,
            },
          },
          include: {
            problem: {
              select: {
                id: true,
                title: true,
                description: true,
                difficulty: true,
              },
            },
            submissions: {
              orderBy: {
                submittedAt: 'asc',
              },
            },
          },
        });

        if (!run) {
          json(res, 200, {
            dateKey,
            run: null,
            submissions: [],
          });
          return true;
        }

        const validatedByIds = [...new Set(run.submissions.map((submission) => submission.validatedById).filter((value): value is string => Boolean(value)))];
        const validatedByLabelEntries = await Promise.all(
          validatedByIds.map(async (moderatorId) => {
            const discordUser = await client.users.fetch(moderatorId).catch(() => null);
            return [moderatorId, discordUser?.globalName ?? discordUser?.username ?? `Utilisateur ${moderatorId}`] as const;
          }),
        );
        const validatedByMap = new Map<string, string>(validatedByLabelEntries);

        const submissions = run.submissions.map((submission) => {
          const finalScore = resolveDailyAlgoFinalScore(submission);
          const totalPoints = resolveDailyAlgoTotalPoints(submission);

          return {
            id: submission.id,
            authorId: submission.authorId,
            authorName: submission.authorName,
            solution: submission.solution,
            status: submission.status,
            submittedAt: submission.submittedAt.toISOString(),
            speedRank: submission.speedRank,
            speedBonusPoints: submission.speedBonusPoints,
            scoreCorrectness: submission.scoreCorrectness,
            scoreComments: submission.scoreComments,
            scoreCompactness: submission.scoreCompactness,
            scoreOptimization: submission.scoreOptimization,
            scoreReadability: submission.scoreReadability,
            scoreFinal: finalScore,
            totalPoints,
            reviewFeedback: submission.reviewFeedback,
            validatedById: submission.validatedById,
            validatedByName: submission.validatedById ? validatedByMap.get(submission.validatedById) ?? `Utilisateur ${submission.validatedById}` : null,
            validatedAt: submission.validatedAt?.toISOString() ?? null,
          };
        });

        json(res, 200, {
          dateKey,
          run: {
            id: run.id,
            challengeChannelId: run.challengeChannelId,
            validationChannelId: run.validationChannelId,
            problem: {
              id: run.problem.id,
              title: run.problem.title,
              description: run.problem.description,
              difficulty: run.problem.difficulty,
            },
            createdAt: run.createdAt.toISOString(),
          },
          submissions,
        });
      } catch (err) {
        logger.error('DailyAlgoAPI', 'Error getting today submissions:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération des soumissions du jour', 'DailyAlgoAPI');
      }
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/daily-algo-submissions/history
    if (parts.length === 6 && parts[5] === 'history' && method === 'GET') {
      try {
        const todayKey = getLocalDateKey();
        const limitParam = Number(url.searchParams.get('limit') ?? 7);
        const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(30, Math.trunc(limitParam))) : 7;

        const runs = await prisma.dailyAlgoRun.findMany({
          where: {
            guildId,
            dateKey: {
              lt: todayKey,
            },
          },
          orderBy: {
            dateKey: 'desc',
          },
          take: limit,
          include: {
            problem: {
              select: {
                id: true,
                title: true,
                difficulty: true,
              },
            },
            submissions: {
              orderBy: {
                submittedAt: 'asc',
              },
            },
          },
        });

        const history = runs.map((run) => {
          const approved = run.submissions.filter((submission) => submission.status === 'APPROVED');
          const rejected = run.submissions.filter((submission) => submission.status === 'REJECTED');
          const pending = run.submissions.filter((submission) => submission.status === 'PENDING');

          const topEntries = approved
            .map((submission) => ({
              id: submission.id,
              authorName: submission.authorName,
              totalPoints: resolveDailyAlgoTotalPoints(submission),
              scoreFinal: resolveDailyAlgoFinalScore(submission),
              speedBonusPoints: submission.speedBonusPoints,
              speedRank: submission.speedRank,
            }))
            .filter((entry) => entry.totalPoints !== null)
            .sort((left, right) => {
              if ((right.totalPoints ?? 0) !== (left.totalPoints ?? 0)) return (right.totalPoints ?? 0) - (left.totalPoints ?? 0);
              return (left.speedRank ?? 999) - (right.speedRank ?? 999);
            })
            .slice(0, 3);

          return {
            id: run.id,
            dateKey: run.dateKey,
            createdAt: run.createdAt.toISOString(),
            problem: {
              id: run.problem.id,
              title: run.problem.title,
              difficulty: run.problem.difficulty,
            },
            stats: {
              total: run.submissions.length,
              approved: approved.length,
              rejected: rejected.length,
              pending: pending.length,
            },
            topEntries,
          };
        });

        json(res, 200, {
          todayKey,
          history,
        });
      } catch (err) {
        logger.error('DailyAlgoAPI', 'Error getting submissions history:', err);
        jsonFailure(res, err, "Erreur lors de la récupération de l'historique des soumissions", 'DailyAlgoAPI');
      }
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/daily-algo-submissions/:id
    if (parts.length === 6 && method === 'GET') {
      const submissionId = parts[5];
      try {
        const submission = await prisma.dailyAlgoSubmission.findUnique({
          where: { id: submissionId }
        });

        if (!submission) {
          json(res, 404, { error: 'Soumission introuvable' });
          return true;
        }

        const finalScore = resolveDailyAlgoFinalScore(submission);
        const totalPoints = resolveDailyAlgoTotalPoints(submission);

        json(res, 200, {
          id: submission.id,
          authorId: submission.authorId,
          authorName: submission.authorName,
          solution: submission.solution,
          status: submission.status,
          submittedAt: submission.submittedAt.toISOString(),
          speedRank: submission.speedRank,
          speedBonusPoints: submission.speedBonusPoints,
          scoreCorrectness: submission.scoreCorrectness,
          scoreComments: submission.scoreComments,
          scoreCompactness: submission.scoreCompactness,
          scoreOptimization: submission.scoreOptimization,
          scoreReadability: submission.scoreReadability,
          scoreFinal: finalScore,
          totalPoints,
          reviewFeedback: submission.reviewFeedback,
          validatedById: submission.validatedById,
          validatedAt: submission.validatedAt?.toISOString() ?? null,
        });
      } catch (err) {
        logger.error('DailyAlgoAPI', 'Error getting submission:', err);
        jsonFailure(res, err, 'Erreur récupération soumission', 'DailyAlgoAPI');
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/daily-algo-submissions/:id
    if (parts.length === 6 && method === 'PATCH') {
      const submissionId = parts[5];
      try {
        const body = await readJsonBody<{
          // `dismiss` = hors-sujet : aucun point, mais aucune sanction.
          action?: 'approve' | 'reject' | 'dismiss';
          feedback?: string;
          scores?: {
            correctness?: number;
            comments?: number;
            compactness?: number;
            optimization?: number;
            readability?: number;
          };
        }>(req);

        if (!body?.action || !['approve', 'reject', 'dismiss'].includes(body.action)) {
          json(res, 400, { error: 'Action Daily Algo invalide.' });
          return true;
        }

        let scores:
          | {
              correctness: number;
              comments: number;
              compactness: number;
              optimization: number;
              readability: number;
            }
          | undefined;

        if (body.action === 'approve') {
          const rawScores = body.scores;
          if (!rawScores) {
            json(res, 400, { error: 'Les notes sont requises pour valider une soumission.' });
            return true;
          }

          const parsed = {
            correctness: Number(rawScores.correctness),
            comments: Number(rawScores.comments),
            compactness: Number(rawScores.compactness),
            optimization: Number(rawScores.optimization),
            readability: Number(rawScores.readability),
          };

          const hasInvalidScore = Object.values(parsed).some((value) => !Number.isFinite(value) || value < 1 || value > 5);
          if (hasInvalidScore) {
            json(res, 400, { error: 'Chaque note doit être comprise entre 1 et 5.' });
            return true;
          }

          scores = parsed;
        }

        const success = await reviewDailyAlgoSubmission({
          client,
          submissionId,
          action: body.action,
          moderatorId: user.userId,
          scores,
          feedback: body.feedback,
          allowReviewedUpdate: true,
        });

        if (!success) {
          json(res, 404, { error: 'Soumission Daily Algo introuvable ou déjà traitée.' });
          return true;
        }

        const auditAction = body.action === 'approve'
          ? 'Validation soumission Daily Algo'
          : body.action === 'dismiss'
            ? 'Soumission Daily Algo hors-sujet'
            : 'Rejet soumission Daily Algo';

        const auditDetails = body.action === 'approve'
          ? `Soumission ${submissionId} validée avec notation.`
          : body.action === 'dismiss'
            ? `Soumission ${submissionId} classée hors-sujet (aucun point, aucune sanction).`
            : `Soumission ${submissionId} rejetée.`;

        await pushAudit(guildId, {
          user: auditUser,
          action: auditAction,
          context: getGuildName(client, guildId),
          module: 'Daily Algo',
          eventType: 'Manuel',
          details: auditDetails,
          channelId: null,
        });

        json(res, 200, { ok: true });
      } catch (err) {
        logger.error('DailyAlgoAPI', 'Error reviewing submission:', err);
        jsonFailure(res, err, 'Erreur lors du traitement de la soumission', 'DailyAlgoAPI');
      }
      return true;
    }
  }

  return false;
}
