/** Routes dashboard du module `nickname-moderation`. */
import { invalidateNicknameModerationCache } from '../../../../events/nicknameModeration.js';
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { broadcastDashboardStateChange, getGuildName, json, pushAudit, readJsonBody } from '../../../shared.js';
import { type ModuleRouteContext } from './_shared.js';

export async function handleNicknameModerationRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, guildId, method, auditUser, moduleKey } = ctx;

  // GET/PATCH /api/dashboard/guilds/:guildId/nickname-moderation
  if (moduleKey === 'nickname-moderation' && parts.length === 5) {
    if (method === 'GET') {
      try {
        const guild = await prisma.guild.findUnique({
          where: { id: guildId },
          select: {
            autoNicknameModerationEnabled: true,
            nicknameModerationWhitelist: true,
            nicknameModerationBypass: true,
            nickModOnJoin: true,
            nickModOnUpdate: true,
            nickModCheckInvisible: true,
            nickModCheckGlobal: true,
            nickModCheckCustom: true,
            nickModDiscordAutoModSync: true,
          },
        }).catch(async (dbErr) => {
          logger.warn('NicknameAPI', 'Failed to fetch bypass list, retrying without it:', dbErr);
          return prisma.guild.findUnique({
            where: { id: guildId },
            select: {
              autoNicknameModerationEnabled: true,
              nicknameModerationWhitelist: true,
            },
          });
        });
        if (!guild) {
          json(res, 404, { error: 'Serveur introuvable' });
          return true;
        }
        // Le repli ci-dessus ne selectionne que deux colonnes (base pas encore
        // migree) : les autres sont donc optionnelles a la lecture.
        const nickConfig = guild as typeof guild & Partial<{
          nicknameModerationBypass: string[];
          nickModOnJoin: boolean;
          nickModOnUpdate: boolean;
          nickModCheckInvisible: boolean;
          nickModCheckGlobal: boolean;
          nickModCheckCustom: boolean;
          nickModDiscordAutoModSync: boolean;
        }>;
        json(res, 200, {
          enabled: guild.autoNicknameModerationEnabled,
          whitelist: guild.nicknameModerationWhitelist,
          bypass: nickConfig.nicknameModerationBypass ?? [],
          onJoin: nickConfig.nickModOnJoin ?? true,
          onUpdate: nickConfig.nickModOnUpdate ?? true,
          checkInvisible: nickConfig.nickModCheckInvisible ?? true,
          checkGlobal: nickConfig.nickModCheckGlobal ?? true,
          checkCustom: nickConfig.nickModCheckCustom ?? true,
          discordAutoModSync: nickConfig.nickModDiscordAutoModSync ?? false,
        });
      } catch (err) {
        logger.error('NicknameAPI', 'GET nickname-moderation error:', err);
        json(res, 500, { error: 'Erreur lors de la récupération de la configuration' });
      }
      return true;
    }

    if (method === 'PATCH') {
      try {
        const body = await readJsonBody<{ enabled?: boolean; whitelist?: string[]; bypass?: string[]; onJoin?: boolean; onUpdate?: boolean; checkInvisible?: boolean; checkGlobal?: boolean; checkCustom?: boolean; discordAutoModSync?: boolean }>(req);

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          json(res, 400, { error: 'Payload invalide' });
          return true;
        }

        const allowedFields = new Set([
          'enabled',
          'whitelist',
          'bypass',
          'onJoin',
          'onUpdate',
          'checkInvisible',
          'checkGlobal',
          'checkCustom',
          'discordAutoModSync',
        ]);
        const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
        if (unknownFields.length > 0) {
          json(res, 400, { error: `Champs inconnus : ${unknownFields.join(', ')}` });
          return true;
        }

        const updateData: Record<string, unknown> = {};
        if (body && Object.prototype.hasOwnProperty.call(body, 'enabled')) {
          if (typeof body.enabled !== 'boolean') {
            json(res, 400, { error: 'Le champ enabled doit être un booléen' });
            return true;
          }
          updateData.autoNicknameModerationEnabled = body.enabled;
        }
        // Toggles granulaires
        const toggleFields = [
          { key: 'onJoin', dbKey: 'nickModOnJoin' },
          { key: 'onUpdate', dbKey: 'nickModOnUpdate' },
          { key: 'checkInvisible', dbKey: 'nickModCheckInvisible' },
          { key: 'checkGlobal', dbKey: 'nickModCheckGlobal' },
          { key: 'checkCustom', dbKey: 'nickModCheckCustom' },
          { key: 'discordAutoModSync', dbKey: 'nickModDiscordAutoModSync' },
        ] as const;
        for (const { key, dbKey } of toggleFields) {
          if (body && Object.prototype.hasOwnProperty.call(body, key)) {
            if (typeof body[key] !== 'boolean') {
              json(res, 400, { error: `Le champ ${key} doit être un booléen` });
              return true;
            }
            updateData[dbKey] = body[key];
          }
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'whitelist')) {
          if (!Array.isArray(body.whitelist) || body.whitelist.some(item => typeof item !== 'string')) {
            json(res, 400, { error: 'Format whitelist invalide (doit être un tableau de chaînes)' });
            return true;
          }
          const cleanedWhitelist = [...new Set(body.whitelist.map((w: string) => w.trim().toLowerCase()).filter(Boolean))];
          if (cleanedWhitelist.length > 250) {
            json(res, 400, { error: 'La whitelist ne peut pas contenir plus de 250 pseudos' });
            return true;
          }
          if (cleanedWhitelist.some(w => w.length > 32)) {
            json(res, 400, { error: 'Les pseudos autorisés ne peuvent pas dépasser 32 caractères' });
            return true;
          }
          updateData.nicknameModerationWhitelist = cleanedWhitelist;
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'bypass')) {
          if (!Array.isArray(body.bypass) || body.bypass.some(item => typeof item !== 'string')) {
            json(res, 400, { error: 'Format bypass invalide (doit être un tableau de chaînes)' });
            return true;
          }
          const cleanedBypass = [...new Set(body.bypass.map((id: string) => id.trim()).filter(Boolean))];
          if (cleanedBypass.length > 250) {
            json(res, 400, { error: 'La liste des membres exemptés ne peut pas contenir plus de 250 IDs' });
            return true;
          }
          if (cleanedBypass.some(id => !/^\d{17,20}$/.test(id))) {
            json(res, 400, { error: 'Format bypass invalide : certains IDs sont incorrects (doivent être de 17 à 20 chiffres)' });
            return true;
          }
          updateData.nicknameModerationBypass = cleanedBypass;
        }

        if (Object.keys(updateData).length === 0) {
          json(res, 400, { error: 'Payload invalide - aucun champ à mettre à jour fourni' });
          return true;
        }

        if (updateData.nicknameModerationWhitelist) {
          const activeBannedWords = await prisma.bannedWord.findMany({
            where: {
              guildId,
              enabled: true,
            },
            select: { word: true },
          });
          const bannedSet = new Set(
            activeBannedWords.map((b) => b.word.trim().toLowerCase())
          );

          const whitelistToCheck = (updateData.nicknameModerationWhitelist ?? []) as string[];
          const invalidItems = whitelistToCheck.filter((item) => bannedSet.has(item));
          if (invalidItems.length > 0) {
            json(res, 400, {
              error: `Impossible d'autoriser ces pseudos car ils font partie de la liste des mots bannis personnalisés : ${invalidItems.join(', ')}`,
            });
            return true;
          }
        }

        await prisma.guild.update({
          where: { id: guildId },
          data: updateData,
        });

        invalidateNicknameModerationCache(guildId);

        // La configuration locale est déjà persistée. La synchronisation Discord
        // reste best-effort et ne doit pas bloquer la réponse HTTP ni figer les
        // boutons du dashboard quand Discord répond lentement.
        void import('../../../../services/moderation/autoModService.js')
          .then(({ syncDiscordAutoModProfileRule }) => syncDiscordAutoModProfileRule(client, guildId))
          .catch((syncErr) => {
            logger.error('NicknameAPI', `Erreur lors de la synchronisation AutoMod Pseudos pour ${guildId}:`, syncErr);
          });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Mise à jour modération pseudos',
          context: getGuildName(client, guildId),
          module: 'Modération des pseudos',
          eventType: 'Manuel',
          details: `Modifications appliquées: ${Object.keys(updateData).join(', ')}`,
          channelId: null,
        });

        broadcastDashboardStateChange(guildId, 'nickname_moderation_updated');

        json(res, 200, { ok: true });
      } catch (err) {
        logger.error('NicknameAPI', 'PATCH nickname-moderation error:', err);
        json(res, 500, { error: 'Erreur lors de la mise à jour' });
      }
      return true;
    }
  }

  return false;
}
