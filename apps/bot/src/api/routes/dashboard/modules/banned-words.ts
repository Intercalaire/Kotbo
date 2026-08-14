/** Routes dashboard du module `banned-words`. */
import { invalidateBannedWordsCache } from '../../../../services/moderation/bannedWordsService.js';
import { isReservedByNicknameModeration } from '../../../../services/moderation/nicknameModerationService.js';
import prisma from '../../../../utils/db.js';
import { errorCode } from '../../../../utils/errors.js';
import { logger } from '../../../../utils/logger.js';
import { broadcastDashboardStateChange, getGuildName, json, pushAudit, readJsonBody } from '../../../shared.js';
import { type ModuleRouteContext } from './_shared.js';

export async function handleBannedWordsRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, guildId, method, auditUser, moduleKey } = ctx;

  // GET/POST/PATCH/DELETE /api/dashboard/guilds/:guildId/banned-words
  if (moduleKey === 'banned-words') {
    if (parts.length === 5 && method === 'GET') {
      try {
        const [globalWords, guildWords] = await Promise.all([
          prisma.bannedWord.findMany({
            where: { guildId: null },
            select: { id: true, word: true, category: true, enabled: true, guildId: true },
            orderBy: [{ category: 'asc' }, { word: 'asc' }],
          }),
          prisma.bannedWord.findMany({
            where: { guildId },
            select: { id: true, word: true, category: true, enabled: true, guildId: true },
            orderBy: [{ category: 'asc' }, { word: 'asc' }],
          }),
        ]);
        json(res, 200, { global: globalWords, custom: guildWords });
      } catch (err) {
        logger.error('BannedWordsAPI', 'GET banned-words error:', err);
        json(res, 500, { error: 'Erreur lors de la récupération des mots bannis' });
      }
      return true;
    }

    if (parts.length === 5 && method === 'POST') {
      try {
        const body = await readJsonBody<{ word: string; category?: string }>(req);
        if (!body?.word || typeof body.word !== 'string' || !body.word.trim()) {
          json(res, 400, { error: 'Champ `word` requis' });
          return true;
        }

        const cleanWord = body.word.trim().toLowerCase().slice(0, 100);

        if (isReservedByNicknameModeration(cleanWord)) {
          json(res, 400, { error: 'Ce mot ne peut pas être banni (réservé par le système de modération)' });
          return true;
        }

        const category = ['custom', 'racism', 'threat', 'sexual', 'lgbtphobia', 'hate', 'insult'].includes(body.category ?? '')
          ? body.category!
          : 'custom';

        const guildData = await prisma.guild.findUnique({
          where: { id: guildId },
          select: { nicknameModerationWhitelist: true },
        });
        const whitelist = guildData?.nicknameModerationWhitelist ?? [];
        if (whitelist.includes(cleanWord)) {
          json(res, 400, {
            error: `Impossible de bannir ce mot car il est déjà présent dans la liste des pseudos autorisés (whitelist) : ${cleanWord}`,
          });
          return true;
        }

        const created = await prisma.bannedWord.create({
          data: { guildId, word: cleanWord, category },
        });

        invalidateBannedWordsCache(guildId);

        const guildDb = await prisma.guild.findUnique({
          where: { id: guildId },
          select: { nickModDiscordAutoModSync: true }
        });
        if (guildDb?.nickModDiscordAutoModSync) {
          void import('../../../../services/moderation/autoModService.js')
            .then(({ syncDiscordAutoModProfileRule }) => syncDiscordAutoModProfileRule(client, guildId))
            .catch((syncErr) => {
              logger.error('BannedWordsAPI', `Erreur lors de la synchronisation AutoMod Pseudos pour ${guildId}:`, syncErr);
            });
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Ajout mot banni',
          context: getGuildName(client, guildId),
          module: 'Mots bannis',
          eventType: 'Manuel',
          details: `Mot "${cleanWord}" ajouté (catégorie: ${category})`,
          channelId: null,
        });

        broadcastDashboardStateChange(guildId, 'banned_words_updated');

        json(res, 201, { ok: true, id: created.id });
      } catch (err: unknown) {
        if (errorCode(err) === 'P2002') {
          json(res, 409, { error: 'Ce mot existe déjà sur ce serveur' });
        } else {
          logger.error('BannedWordsAPI', 'POST banned-words error:', err);
          json(res, 500, { error: "Erreur lors de l'ajout du mot" });
        }
      }
      return true;
    }

    if (parts.length === 6 && method === 'PATCH') {
      const wordId = parts[5];
      try {
        const body = await readJsonBody<{ enabled: boolean }>(req);
        if (!body || typeof body.enabled !== 'boolean') {
          json(res, 400, { error: 'Champ `enabled` requis (boolean)' });
          return true;
        }

        const existing = await prisma.bannedWord.findFirst({ where: { id: wordId, guildId } });
        if (!existing) {
          json(res, 404, { error: 'Mot introuvable' });
          return true;
        }

        if (body.enabled) {
          const guildData = await prisma.guild.findUnique({
            where: { id: guildId },
            select: { nicknameModerationWhitelist: true },
          });
          const whitelist = guildData?.nicknameModerationWhitelist ?? [];
          if (whitelist.includes(existing.word.toLowerCase())) {
            json(res, 400, {
              error: `Impossible d'activer ce mot car il est déjà présent dans la liste des pseudos autorisés (whitelist) : ${existing.word}`,
            });
            return true;
          }
        }

        await prisma.bannedWord.update({ where: { id: wordId }, data: { enabled: body.enabled } });

        invalidateBannedWordsCache(guildId);

        const guildDb = await prisma.guild.findUnique({
          where: { id: guildId },
          select: { nickModDiscordAutoModSync: true }
        });
        if (guildDb?.nickModDiscordAutoModSync) {
          void import('../../../../services/moderation/autoModService.js')
            .then(({ syncDiscordAutoModProfileRule }) => syncDiscordAutoModProfileRule(client, guildId))
            .catch((syncErr) => {
              logger.error('BannedWordsAPI', `Erreur lors de la synchronisation AutoMod Pseudos pour ${guildId}:`, syncErr);
            });
        }

        broadcastDashboardStateChange(guildId, 'banned_words_updated');
        json(res, 200, { ok: true });
      } catch (err) {
        logger.error('BannedWordsAPI', 'PATCH banned-words error:', err);
        json(res, 500, { error: 'Erreur lors de la mise à jour' });
      }
      return true;
    }

    if (parts.length === 6 && method === 'DELETE') {
      const wordId = parts[5];
      try {
        const existing = await prisma.bannedWord.findFirst({ where: { id: wordId, guildId } });
        if (!existing) {
          json(res, 404, { error: 'Mot introuvable ou non modifiable' });
          return true;
        }

        await prisma.bannedWord.delete({ where: { id: wordId } });

        invalidateBannedWordsCache(guildId);

        const guildDb = await prisma.guild.findUnique({
          where: { id: guildId },
          select: { nickModDiscordAutoModSync: true }
        });
        if (guildDb?.nickModDiscordAutoModSync) {
          void import('../../../../services/moderation/autoModService.js')
            .then(({ syncDiscordAutoModProfileRule }) => syncDiscordAutoModProfileRule(client, guildId))
            .catch((syncErr) => {
              logger.error('BannedWordsAPI', `Erreur lors de la synchronisation AutoMod Pseudos pour ${guildId}:`, syncErr);
            });
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression mot banni',
          context: getGuildName(client, guildId),
          module: 'Mots bannis',
          eventType: 'Manuel',
          details: `Mot "${existing.word}" supprimé`,
          channelId: null,
        });

        broadcastDashboardStateChange(guildId, 'banned_words_updated');

        json(res, 200, { ok: true });
      } catch (err) {
        logger.error('BannedWordsAPI', 'DELETE banned-words error:', err);
        json(res, 500, { error: 'Erreur lors de la suppression' });
      }
      return true;
    }
  }

  return false;
}
