import { IncomingMessage, ServerResponse } from 'node:http';
import { Client, TextChannel, EmbedBuilder, type ColorResolvable } from 'discord.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BannedWord } from '@prisma/client';
import prisma from '../../utils/db.js';
import { cache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { activateGuild, deactivateGuild, reconcileStaffGuildActivation } from '../../utils/activation.js';
import { announceAccessRevoked, announceTrialStart, extendAccess, formatDuration, normalizeAccessGrant, MAX_ACCESS_DURATION_MINUTES } from '../../services/system/accessService.js';
import { E, resolveEmojiShortcodes, resolveEmojiShortcodesToUnicode, UNICODE_FALLBACKS } from '../../utils/emojis.js';
import { isReservedByNicknameModeration } from '../../services/moderation/nicknameModerationService.js';
import { INVITE_SOURCE, recordBotInvite, tagInviteSource } from '../../services/analytics/inviteService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const servicePath = path.resolve(__dirname, '../../services/analytics/messageScraperService.js');
const guildDataSyncServicePath = path.resolve(__dirname, '../../services/analytics/guildDataSyncService.js');
import { json, verifyAuth, resolveAdminAccess, collectShardSnapshots, collectShardGuilds, loadShardingConfig, saveShardingConfig, requestContainerRestart, requestShardRespawn, normalizeGlobalBannedWord, normalizeGlobalBannedWordCategory, cleanupGlobalBannedWords, getGuildName, readJsonBody, DISCORD_CLIENT_OWNER_ID, ShardSnapshot, ShardingMode, ShardingConfig } from '../shared.js';
import {
  getModuleActivationStats,
  getModuleUsageStats,
  getModulePerformanceStats,
  getModuleStatsSummary,
  KOTBO_MODULES,
  type KotboModule,
} from '../../services/analytics/moduleStatsService.js';
import { collectUserData } from '../../services/system/gdprExportService.js';
import { buildGdprZip } from '../../services/system/gdprZip.js';

/**
 * `readJsonBody` refuse (415) toute requête sans Content-Type JSON. Les endpoints
 * dont le corps est facultatif s'en servent pour ne le lire que s'il existe, et
 * rester compatibles avec les appels historiques sans corps.
 */
function isJsonRequest(req: IncomingMessage): boolean {
  return req.headers['content-type']?.includes('application/json') ?? false;
}

export async function handleAdminRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client
): Promise<boolean> {
  const method = req.method;

  if (parts[0] !== 'api' || parts[1] !== 'admin') {
    return false;
  }

  const user = await verifyAuth(req);
  if (!user) {
    json(res, 401, { error: 'Non authentifié' });
    return true;
  }

  // Verification 1: Is bot admin (needed for all /api/admin endpoints)
  const isBotAdmin = await resolveAdminAccess(client, user.userId);
  if (!isBotAdmin) {
    json(res, 403, { error: 'Accès administrateur requis' });
    return true;
  }

  // GET /api/admin/stats
  if (parts[2] === 'stats' && method === 'GET') {
    try {
      const shardSnapshots = await collectShardSnapshots(client);
      const guilds = await collectShardGuilds(client);
      const guildCount = guilds.length;
      const userCount = guilds.reduce((acc: number, guild: { memberCount: number }) => acc + guild.memberCount, 0);
      const activeSanctions = await prisma.sanction.count({ where: { status: 'ACTIVE' } });
      const dailyAlgoSubmissions = await prisma.dailyAlgoSubmission.count();

      json(res, 200, {
        guildCount,
        userCount,
        activeSanctions,
        dailyAlgoSubmissions,
        uptime: Math.floor(process.uptime()),
        memoryUsage: process.memoryUsage(),
        shardCount: shardSnapshots.length,
        onlineShardCount: shardSnapshots.filter((snapshot) => snapshot.status !== 'offline').length,
        averageShardPing: shardSnapshots.length > 0
          ? Math.round(shardSnapshots.reduce((acc: number, snapshot: ShardSnapshot) => acc + snapshot.ping, 0) / shardSnapshots.length)
          : 0,
      });
    } catch (err) {
      logger.error('AdminAPI', 'Error fetching admin stats:', err);
      json(res, 500, { error: 'Erreur interne du serveur' });
    }
    return true;
  }

  // GET /api/admin/stats/modules - Module statistics
  if (parts[2] === 'stats' && parts[3] === 'modules' && method === 'GET') {
    try {
      const guildId = url.searchParams.get('guildId') || undefined;
      const moduleNameRaw = url.searchParams.get('moduleName') || undefined;
      const moduleName = (moduleNameRaw && (KOTBO_MODULES as readonly string[]).includes(moduleNameRaw)) ? (moduleNameRaw as KotboModule) : undefined;
      const startDate = url.searchParams.get('startDate') || undefined;
      const endDate = url.searchParams.get('endDate') || undefined;
      const periodDays = url.searchParams.get('period') ? parseInt(url.searchParams.get('period')!) : 30;
      const summary = url.searchParams.get('summary') === 'true';

      if (summary) {
        const data = await getModuleStatsSummary({ guildId, periodDays });
        json(res, 200, data);
      } else {
        const [activation, usage, performance] = await Promise.all([
          getModuleActivationStats(guildId),
          getModuleUsageStats({ guildId, moduleName, startDate, endDate, periodDays }),
          getModulePerformanceStats({ guildId, moduleName, startDate, endDate, periodDays }),
        ]);

        json(res, 200, {
          modules: KOTBO_MODULES,
          activation,
          usage,
          performance,
        });
      }
    } catch (err) {
      logger.error('AdminAPI', 'Error fetching module stats:', err);
      json(res, 500, { error: 'Erreur interne du serveur' });
    }
    return true;
  }

  // GET /api/admin/guilds
  if (parts[2] === 'guilds' && parts.length === 3 && method === 'GET') {
    try {
      const dbGuilds = await prisma.guild.findMany({
        select: {
          id: true,
          activated: true,
          activationCode: true,
          statsConfig: true,
          serverTemplateAppliedAt: true,
          serverTemplateAppliedBy: true,
        }
      });
      const dbGuildsMap = new Map(dbGuilds.map((guild) => [guild.id, guild] as const));

      const shardGuilds = await collectShardGuilds(client);
      interface ShardGuild {
        id: string;
        name: string;
        icon: string | null;
        memberCount: number;
        joinedAt: string | null;
        shardId: number;
      }
      const guilds = shardGuilds.map((g: ShardGuild) => {
        const dbGuild = dbGuildsMap.get(g.id);
        return {
          id: g.id,
          name: g.name,
          icon: g.icon,
          memberCount: g.memberCount,
          joinedAt: g.joinedAt,
          activated: dbGuild?.activated ?? false,
          activationCode: dbGuild?.activationCode ?? null,
          statsConfig: dbGuild?.statsConfig ?? null,
          serverTemplateAppliedAt: dbGuild?.serverTemplateAppliedAt?.toISOString() ?? null,
          serverTemplateAppliedBy: dbGuild?.serverTemplateAppliedBy ?? null,
          shardId: g.shardId ?? 0,
        };
      });

      json(res, 200, { guilds });
    } catch (err) {
      logger.error('AdminAPI', 'Error listing admin guilds:', err);
      json(res, 500, { error: 'Erreur interne du serveur' });
    }
    return true;
  }

  // Shards management
  if (parts[2] === 'shards') {
    // GET /api/admin/shards
    if (method === 'GET' && parts.length === 3) {
      try {
        const config = await loadShardingConfig();
        const shardSnapshots = await collectShardSnapshots(client);
        json(res, 200, {
          config,
          shards: shardSnapshots,
          onlineShardCount: shardSnapshots.filter((snapshot) => snapshot.status !== 'offline').length,
        });
      } catch (err) {
        logger.error('AdminAPI', 'Error loading shards config:', err);
        json(res, 500, { error: 'Erreur interne' });
      }
      return true;
    }

    // POST /api/admin/shards/restart-all
    if (method === 'POST' && parts.length === 4 && parts[3] === 'restart-all') {
      requestContainerRestart();
      json(res, 200, { ok: true, restart: 'container' });
      return true;
    }

    // POST /api/admin/shards/:shardId/restart
    if (method === 'POST' && parts.length === 5 && parts[4] === 'restart') {
      const shardId = Number(parts[3]);
      if (!Number.isInteger(shardId) || shardId < 0) {
        json(res, 400, { error: 'Identifiant de shard invalide.' });
        return true;
      }

      try {
        requestShardRespawn(shardId);
        json(res, 200, { ok: true, restart: 'shard', targetShard: shardId });
      } catch (err) {
        requestContainerRestart();
        json(res, 200, { ok: true, restart: 'container', targetShard: shardId });
      }
      return true;
    }

    // POST /api/admin/shards/reconfigure
    if (method === 'POST' && parts.length === 4 && parts[3] === 'reconfigure') {
      try {
        const body = await readJsonBody<{ mode?: ShardingMode; shardCount?: number }>(req);
        const nextMode: ShardingMode = body?.mode === 'fixed' ? 'fixed' : 'auto';
        const nextShardCount = Number(body?.shardCount);

        if (nextMode === 'fixed' && (!Number.isInteger(nextShardCount) || nextShardCount < 1)) {
          json(res, 400, { error: 'Un nombre de shards supérieur à zéro est requis en mode fixe.' });
          return true;
        }

        const nextConfig: ShardingConfig = {
          mode: nextMode,
          shardCount: nextMode === 'fixed' ? nextShardCount : null,
        };

        await saveShardingConfig(nextConfig);
        json(res, 200, { ok: true, config: nextConfig, restartRequired: true });
        requestContainerRestart();
      } catch (err) {
        logger.error('AdminAPI', 'Error reconfiguring shards:', err);
        json(res, 500, { error: 'Erreur lors de la reconfiguration' });
      }
      return true;
    }
  }

  // Guild specific invite/leave
  if (parts[2] === 'guilds' && parts.length === 5 && (parts[4] === 'invite' || parts[4] === 'leave')) {
    const guildId = parts[3];

    let guildExists = false;
    // Check if guild exists across shards
    if (client.shard) {
      const results = await client.shard.broadcastEval<boolean, string>((c, id) => c.guilds.cache.has(id), { context: guildId });
      guildExists = results.some((r) => r);
    } else {
      guildExists = client.guilds.cache.has(guildId) || !!(await client.guilds.fetch(guildId).catch(() => null));
    }

    if (!guildExists) {
      json(res, 404, { error: 'Serveur introuvable' });
      return true;
    }

    // POST /api/admin/guilds/:guildId/invite
    if (parts[4] === 'invite' && method === 'POST') {
      if (client.shard) {
        const results = await client.shard.broadcastEval<{ error?: string; url?: string; code?: string } | null, { guildId: string }>(async (shardClient, context) => {
          const guild = shardClient.guilds.cache.get(context.guildId);
          if (!guild) return null;
          const channel = guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(shardClient.user!)?.has('CreateInstantInvite'));
          if (!channel) return { error: 'NO_CHANNEL' };
          try {
            if (channel && 'createInvite' in channel && typeof channel.createInvite === 'function') {
              const invite = await channel.createInvite({ maxAge: 86400, maxUses: 1 });
              return { url: invite.url, code: invite.code };
            }
            return { error: 'CREATE_FAILED' };
          } catch {
            return { error: 'CREATE_FAILED' };
          }
        }, { context: { guildId } });

        const result = results.find(r => r !== null);
        if (!result) {
          json(res, 404, { error: 'Serveur introuvable' });
        } else if (result.error === 'NO_CHANNEL') {
          json(res, 400, { error: 'Impossible de créer une invitation (pas de salon textuel ou pas la permission)' });
        } else if (result.error === 'CREATE_FAILED') {
          json(res, 500, { error: "Erreur lors de la création de l'invitation" });
        } else if (result.url) {
          // L'invitation est créée sur un autre shard : on la trace depuis ici, la base est partagée.
          if (result.code) {
            await tagInviteSource({
              guildId,
              code: result.code,
              sourceLabel: INVITE_SOURCE.supportAdmin(),
              inviterId: client.user?.id ?? null,
              inviterTag: client.user?.tag ?? null,
              maxUses: 1,
              expiresAt: new Date(Date.now() + 86400 * 1000),
            });
          }
          json(res, 200, { url: result.url });
        }
      } else {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
          json(res, 404, { error: 'Serveur introuvable' });
          return true;
        }
        const channel = guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(guild.members.me!)?.has('CreateInstantInvite'));
        if (!channel) {
          json(res, 400, { error: 'Impossible de créer une invitation (pas de salon textuel ou pas la permission)' });
          return true;
        }
        try {
          const invite = await (channel as TextChannel).createInvite({ maxAge: 86400, maxUses: 1 });
          await recordBotInvite(invite, INVITE_SOURCE.supportAdmin());
          json(res, 200, { url: invite.url });
        } catch (err) {
          json(res, 500, { error: "Erreur lors de la création de l'invitation" });
        }
      }
      return true;
    }

    // POST /api/admin/guilds/:guildId/leave
    if (parts[4] === 'leave' && method === 'POST') {
      if (client.shard) {
        const results = await client.shard.broadcastEval<{ success: boolean } | null, { guildId: string }>(async (shardClient, context) => {
          const guild = shardClient.guilds.cache.get(context.guildId);
          if (!guild) return null;
          try {
            await guild.leave();
            return { success: true };
          } catch {
            return { success: false };
          }
        }, { context: { guildId } });

        const result = results.find(r => r !== null);
        if (!result) {
          json(res, 404, { error: 'Serveur introuvable' });
        } else if (result.success) {
          json(res, 200, { success: true });
        } else {
          json(res, 500, { error: 'Impossible de quitter le serveur' });
        }
      } else {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
          json(res, 404, { error: 'Serveur introuvable' });
          return true;
        }
        try {
          await guild.leave();
          json(res, 200, { success: true });
        } catch (err) {
          json(res, 500, { error: 'Impossible de quitter le serveur' });
        }
      }
      return true;
    }
  }

  // Global Admins CRUD
  if (parts[2] === 'admins') {
    // GET /api/admin/admins
    if (method === 'GET' && parts.length === 3) {
      try {
        const admins = await prisma.globalAdmin.findMany({
          orderBy: { createdAt: 'desc' }
        });
        const enrichedAdmins = await Promise.all(admins.map(async (admin) => {
          try {
            const discordUser = await client.users.fetch(admin.userId);
            return { ...admin, username: discordUser.username, avatarUrl: discordUser.displayAvatarURL() };
          } catch {
            return { ...admin, username: 'Inconnu', avatarUrl: null };
          }
        }));
        json(res, 200, { admins: enrichedAdmins });
      } catch (err) {
        json(res, 500, { error: 'Erreur de base de données' });
      }
      return true;
    }

    // POST /api/admin/admins
    if (method === 'POST' && parts.length === 3) {
      try {
         const body = await readJsonBody<{userId: string}>(req);
         if (!body || !body.userId) {
           json(res, 400, { error: 'ID Discord requis' }); 
           return true;
         }
         try {
            const discordUser = await client.users.fetch(body.userId);
            if (!discordUser) throw new Error();
            await prisma.globalAdmin.upsert({
              where: { userId: body.userId },
              update: {},
              create: { userId: body.userId, addedBy: user.userId }
            });
            json(res, 201, { success: true });
         } catch {
            json(res, 400, { error: 'Utilisateur Discord introuvable' });
         }
      } catch (err) {
        json(res, 500, { error: 'Erreur lors du traitement' });
      }
      return true;
    }

    // DELETE /api/admin/admins/:userId
    if (method === 'DELETE' && parts.length === 4) {
       const targetId = parts[3];
       if (DISCORD_CLIENT_OWNER_ID && targetId === DISCORD_CLIENT_OWNER_ID) {
         json(res, 403, { error: 'Impossible de supprimer le créateur' }); 
         return true;
       }
       try {
         await prisma.globalAdmin.delete({ where: { userId: targetId } }).catch(() => {});
         json(res, 200, { success: true });
       } catch (err) {
         json(res, 500, { error: 'Erreur de base de données' });
       }
       return true;
    }
  }

  // Global Blacklist CRUD
  if (parts[2] === 'blacklist') {
    // GET /api/admin/blacklist
    if (method === 'GET') {
      try {
        const blacklist = await prisma.globalBlacklist.findMany({
          orderBy: { createdAt: 'desc' }
        });
        const enriched = await Promise.all(blacklist.map(async (entry) => {
          try {
            const discordUser = await client.users.fetch(entry.userId);
            return { ...entry, username: discordUser.username, avatarUrl: discordUser.displayAvatarURL() };
          } catch {
            return { ...entry, username: 'Inconnu', avatarUrl: null };
          }
        }));
        json(res, 200, { blacklist: enriched });
      } catch (err) {
        json(res, 500, { error: 'Erreur de base de données' });
      }
      return true;
    }

    // POST /api/admin/blacklist
    if (method === 'POST') {
      try {
         const body = await readJsonBody<{userId: string, reason?: string}>(req);
         if (!body || !body.userId) {
           json(res, 400, { error: 'ID Discord requis' });
           return true;
         }
         try {
            const discordUser = await client.users.fetch(body.userId);
            if (!discordUser) throw new Error();
            await prisma.globalBlacklist.upsert({
              where: { userId: body.userId },
              update: { reason: body.reason },
              create: { userId: body.userId, reason: body.reason, addedBy: user.userId }
            });

            const blacklistSet: Set<string> = globalThis.KOTBO_BLACKLIST || new Set();
            blacklistSet.add(body.userId);
            globalThis.KOTBO_BLACKLIST = blacklistSet;

            json(res, 201, { success: true });
         } catch (err) {
            logger.error('AdminAPI', 'Error adding to blacklist:', err);
            json(res, 400, { error: 'Utilisateur Discord introuvable' });
         }
      } catch (err) {
        json(res, 500, { error: 'Erreur lors du traitement' });
      }
      return true;
    }

    // DELETE /api/admin/blacklist/:userId
    if (method === 'DELETE' && parts.length === 4) {
       const targetId = parts[3];
       try {
         await prisma.globalBlacklist.delete({ where: { userId: targetId } }).catch(() => {});
         
         const blacklistSet: Set<string> = globalThis.KOTBO_BLACKLIST;
         if (blacklistSet) {
           blacklistSet.delete(targetId);
         }

         json(res, 200, { success: true });
       } catch (err) {
         json(res, 500, { error: 'Erreur de base de données' });
       }
       return true;
    }
  }

  // Global Banned Words (blacklist of nicknames/words across servers)
  if (parts[2] === 'banned-words') {
    // GET /api/admin/banned-words
    if (method === 'GET' && parts.length === 3) {
      try {
        const words = await prisma.bannedWord.findMany({
          where: { guildId: null },
          orderBy: [{ word: 'asc' }],
        });
        json(res, 200, { words });
      } catch (err) {
        json(res, 500, { error: 'Erreur interne' });
      }
      return true;
    }

    // POST /api/admin/banned-words
    if (method === 'POST' && parts.length === 3) {
      try {
        const body = await readJsonBody<{ words?: Array<{ word: string; category?: string; enabled?: boolean }> }>(req);
        const entries = Array.isArray(body?.words) ? body.words : [];

        if (entries.length === 0) {
          json(res, 400, { error: 'Aucun mot à enregistrer' });
          return true;
        }

        const seen = new Map<string, { word: string; category: string; enabled: boolean }>();
        for (const entry of entries) {
          const word = normalizeGlobalBannedWord(entry?.word);
          if (!word) continue;

          if (isReservedByNicknameModeration(word)) {
            continue;
          }

          seen.set(word, {
            word,
            category: normalizeGlobalBannedWordCategory(entry?.category),
            enabled: typeof entry?.enabled === 'boolean' ? entry.enabled : true,
          });
        }

        if (seen.size === 0) {
          json(res, 400, { error: 'Aucun mot valide à enregistrer' });
          return true;
        }

        const created: BannedWord[] = [];
        const updated: BannedWord[] = [];

        for (const entry of seen.values()) {
          const existing = await prisma.bannedWord.findFirst({ where: { guildId: null, word: entry.word } });
          if (existing) {
            const next = await prisma.bannedWord.update({
              where: { id: existing.id },
              data: { category: entry.category, enabled: entry.enabled },
            });
            updated.push(next);
          } else {
            const next = await prisma.bannedWord.create({
              data: {
                guildId: null,
                word: entry.word,
                category: entry.category,
                enabled: entry.enabled,
              },
            });
            created.push(next);
          }
        }

        const words = await prisma.bannedWord.findMany({
          where: { guildId: null },
          orderBy: [{ word: 'asc' }],
        });

        json(res, 200, {
          ok: true,
          createdCount: created.length,
          updatedCount: updated.length,
          words,
        });
      } catch (err) {
        logger.error('AdminAPI', 'Error registering banned words:', err);
        json(res, 500, { error: 'Erreur serveur' });
      }
      return true;
    }

    // POST /api/admin/banned-words/cleanup
    if (method === 'POST' && parts.length === 4 && parts[3] === 'cleanup') {
      try {
        const result = await cleanupGlobalBannedWords();
        json(res, 200, { ok: true, ...result });
      } catch (err) {
        logger.error('BannedWordsAPI', 'POST banned-words cleanup error:', err);
        json(res, 500, { error: 'Erreur lors du nettoyage des mots globaux' });
      }
      return true;
    }

    // Operations on a specific banned word
    if (parts.length === 4) {
      const wordId = parts[3];

      // PATCH /api/admin/banned-words/:wordId
      if (method === 'PATCH') {
        try {
          const body = await readJsonBody<{ enabled?: boolean; word?: string; category?: string }>(req);
          const hasEnabled = typeof body?.enabled === 'boolean';
          const hasWord = typeof body?.word === 'string';
          const hasCategory = typeof body?.category === 'string';

          if (!hasEnabled && !hasWord && !hasCategory) {
            json(res, 400, { error: 'Au moins un champ doit être fourni' });
            return true;
          }

          const existing = await prisma.bannedWord.findFirst({ where: { id: wordId, guildId: null } });
          if (!existing) {
            json(res, 404, { error: 'Mot global introuvable' });
            return true;
          }

          const nextWord = hasWord ? normalizeGlobalBannedWord(body.word) : existing.word;
          const nextCategory = hasCategory ? normalizeGlobalBannedWordCategory(body.category) : existing.category;
          const nextEnabled = hasEnabled ? body.enabled : existing.enabled;

          if (!nextWord) {
            json(res, 400, { error: 'Le mot ne peut pas être vide' });
            return true;
          }

          if (isReservedByNicknameModeration(nextWord)) {
            json(res, 400, { error: 'Ce mot ne peut pas être banni (réservé par le système de modération)' });
            return true;
          }

          const duplicate = await prisma.bannedWord.findFirst({
            where: {
              guildId: null,
              word: nextWord,
              NOT: { id: wordId },
            },
          });

          if (duplicate) {
            json(res, 409, { error: 'Ce mot global existe déjà' });
            return true;
          }

          const updated = await prisma.bannedWord.update({
            where: { id: wordId },
            data: { word: nextWord, category: nextCategory, enabled: nextEnabled },
          });

          json(res, 200, { ok: true, word: updated });
        } catch (err) {
          logger.error('BannedWordsAPI', 'PATCH global banned-word error:', err);
          json(res, 500, { error: 'Erreur lors de la mise à jour' });
        }
        return true;
      }

      // DELETE /api/admin/banned-words/:wordId
      if (method === 'DELETE') {
        try {
          const existing = await prisma.bannedWord.findFirst({ where: { id: wordId, guildId: null } });
          if (!existing) {
            json(res, 404, { error: 'Mot global introuvable' });
            return true;
          }

          await prisma.bannedWord.delete({ where: { id: wordId } });
          json(res, 200, { ok: true });
        } catch (err) {
          logger.error('BannedWordsAPI', 'DELETE global banned-word error:', err);
          json(res, 500, { error: 'Erreur lors de la suppression' });
        }
        return true;
      }
    }
  }

  // Global Config (Maintenance toggle)
  if (parts[2] === 'config') {
    // GET /api/admin/config
    if (method === 'GET') {
       try {
         const config = await prisma.botGlobalConfig.findUnique({ where: { key: 'MAINTENANCE_MODE' } });
         json(res, 200, { maintenance: config?.value === 'true' });
       } catch (err) {
         json(res, 500, { error: 'Erreur interne' });
       }
       return true;
    }

    // POST /api/admin/config
    if (method === 'POST') {
       try {
         const body = await readJsonBody<{maintenance: boolean}>(req);
         if (!body || typeof body.maintenance !== 'boolean') {
           json(res, 400, { error: 'Valeur maintenance (boolean) requise' }); 
           return true;
         }
         await prisma.botGlobalConfig.upsert({
           where: { key: 'MAINTENANCE_MODE' },
           update: { value: body.maintenance ? 'true' : 'false' },
           create: { key: 'MAINTENANCE_MODE', value: body.maintenance ? 'true' : 'false' }
         });
         globalThis.KOTBO_MAINTENANCE_MODE = body.maintenance;
         json(res, 200, { success: true });
       } catch (err) {
         json(res, 500, { error: 'Erreur de base de données' });
       }
       return true;
    }
  }

  // Bot error logs listing/clear
  if (parts[2] === 'errors') {
    // GET /api/admin/errors
    if (method === 'GET') {
       try {
         const errors = await prisma.botErrorLog.findMany({
           orderBy: { createdAt: 'desc' },
           take: 50
         });
         json(res, 200, { errors });
       } catch (err) {
         json(res, 500, { error: 'Erreur de base de données' });
       }
       return true;
    }

    // DELETE /api/admin/errors
    if (method === 'DELETE') {
       try {
         await prisma.botErrorLog.deleteMany({});
         json(res, 200, { success: true });
       } catch (err) {
         json(res, 500, { error: 'Erreur de base de données' });
       }
       return true;
    }
  }

  // ============================================================================
  // BROADCAST SYSTEM
  // ============================================================================

  if (parts[2] === 'broadcast') {
    // GET /api/admin/broadcast/emojis - Available custom emojis for the editor
    if (method === 'GET' && parts[3] === 'emojis' && parts.length === 4) {
      const emojiList = Object.entries(E)
        .filter(([, v]) => v && v.startsWith('<'))
        .map(([key, formatted]) => {
          const match = formatted.match(/^<a?:(\w+):\d+>$/);
          return {
            key,
            discordName: match?.[1] || key,
            formatted,
            unicode: UNICODE_FALLBACKS[key] || '❓',
          };
        });
      json(res, 200, { emojis: emojiList });
      return true;
    }

    // GET /api/admin/broadcast/channels - Per-guild broadcast channel configuration
    if (method === 'GET' && parts[3] === 'channels' && parts.length === 4) {
      try {
        interface ShardGuildChannels {
          id: string;
          name: string;
          icon: string | null;
          memberCount: number;
          channels: { id: string; name: string; category: string | null; position: number }[];
        }

        let shardGuildChannels: ShardGuildChannels[];
        if (client.shard) {
          const results = await client.shard.broadcastEval<ShardGuildChannels[]>((shardClient) =>
            shardClient.guilds.cache.map((guild) => ({
              id: guild.id,
              name: guild.name,
              icon: guild.iconURL(),
              memberCount: guild.memberCount,
              channels: guild.channels.cache
                .filter((ch): ch is import('discord.js').TextChannel | import('discord.js').NewsChannel =>
                  (ch.type === 0 || ch.type === 5) && !!ch.permissionsFor(shardClient.user!)?.has(['ViewChannel', 'SendMessages']))
                .map((ch) => ({ id: ch.id, name: ch.name, category: ch.parent?.name ?? null, position: ch.rawPosition }))
                .sort((a, b) => a.position - b.position),
            }))
          );
          shardGuildChannels = results.flat();
        } else {
          shardGuildChannels = client.guilds.cache.map((guild) => ({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL(),
            memberCount: guild.memberCount,
            channels: guild.channels.cache
              .filter((ch): ch is import('discord.js').TextChannel | import('discord.js').NewsChannel =>
                (ch.type === 0 || ch.type === 5) && !!ch.permissionsFor(client.user!)?.has(['ViewChannel', 'SendMessages']))
              .map((ch) => ({ id: ch.id, name: ch.name, category: ch.parent?.name ?? null, position: ch.rawPosition }))
              .sort((a, b) => a.position - b.position),
          }));
        }

        const dbGuilds = await prisma.guild.findMany({
          select: { id: true, activated: true, broadcastChannelId: true },
        });
        const dbMap = new Map(dbGuilds.map((g) => [g.id, g] as const));

        const guilds = shardGuildChannels.map((g) => {
          const dbG = dbMap.get(g.id);
          const configuredId = dbG?.broadcastChannelId ?? null;
          const configured = configuredId ? g.channels.find((ch) => ch.id === configuredId) ?? null : null;
          return {
            id: g.id,
            name: g.name,
            icon: g.icon,
            memberCount: g.memberCount,
            activated: dbG?.activated ?? false,
            broadcastChannelId: configuredId,
            broadcastChannelName: configured?.name ?? null,
            channelStatus: (!configuredId ? 'UNSET' : configured ? 'OK' : 'MISSING') as 'UNSET' | 'OK' | 'MISSING',
            channels: g.channels,
          };
        }).sort((a, b) => a.name.localeCompare(b.name));

        json(res, 200, { guilds });
      } catch (err) {
        logger.error('AdminAPI', 'GET broadcast channels error:', err);
        json(res, 500, { error: 'Erreur lors de la récupération des salons' });
      }
      return true;
    }

    // PUT /api/admin/broadcast/channels/:guildId - Set the broadcast channel for a guild
    if (method === 'PUT' && parts[3] === 'channels' && parts.length === 5) {
      const guildId = parts[4];
      try {
        const body = await readJsonBody<{ channelId?: string | null }>(req);
        const channelId = body?.channelId?.trim() || null;

        if (channelId) {
          let check: { ok: boolean; reason?: string } | null = null;
          if (client.shard) {
            const results = await client.shard.broadcastEval<{ ok: boolean; reason?: string } | null, { guildId: string; channelId: string }>((shardClient, ctx) => {
              const guild = shardClient.guilds.cache.get(ctx.guildId);
              if (!guild) return null;
              const ch = guild.channels.cache.get(ctx.channelId);
              if (!ch || (ch.type !== 0 && ch.type !== 5)) return { ok: false, reason: 'NOT_FOUND' };
              const canSend = !!ch.permissionsFor(shardClient.user!)?.has(['ViewChannel', 'SendMessages']);
              return canSend ? { ok: true } : { ok: false, reason: 'NO_PERMS' };
            }, { context: { guildId, channelId } });
            check = results.find((r) => r !== null) ?? null;
          } else {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
              const ch = guild.channels.cache.get(channelId);
              if (!ch || (ch.type !== 0 && ch.type !== 5)) check = { ok: false, reason: 'NOT_FOUND' };
              else check = ch.permissionsFor(client.user!)?.has(['ViewChannel', 'SendMessages']) ? { ok: true } : { ok: false, reason: 'NO_PERMS' };
            }
          }

          if (!check) {
            json(res, 404, { error: 'Serveur introuvable' });
            return true;
          }
          if (!check.ok) {
            json(res, 400, { error: check.reason === 'NO_PERMS' ? "Le bot ne peut pas écrire dans ce salon" : 'Salon introuvable sur ce serveur' });
            return true;
          }
        }

        await prisma.guild.upsert({
          where: { id: guildId },
          update: { broadcastChannelId: channelId },
          create: { id: guildId, broadcastChannelId: channelId },
        });

        json(res, 200, { ok: true, guildId, channelId });
      } catch (err) {
        logger.error('AdminAPI', 'PUT broadcast channel error:', err);
        json(res, 500, { error: 'Erreur lors de la configuration du salon' });
      }
      return true;
    }

    // GET /api/admin/broadcast - Broadcast history
    if (method === 'GET' && parts.length === 3) {
      try {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
        const logs = await prisma.broadcastLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: limit,
        });
        const enriched = await Promise.all(logs.map(async (log) => {
          try {
            const discordUser = await client.users.fetch(log.sentBy);
            return { ...log, username: discordUser.username, avatarUrl: discordUser.displayAvatarURL() };
          } catch {
            return { ...log, username: 'Inconnu', avatarUrl: null };
          }
        }));
        json(res, 200, { logs: enriched });
      } catch (err) {
        logger.error('AdminAPI', 'GET broadcast history error:', err);
        json(res, 500, { error: "Erreur lors de la récupération de l'historique" });
      }
      return true;
    }

    // DELETE /api/admin/broadcast/:id - Delete a broadcast log entry
    if (method === 'DELETE' && parts.length === 4) {
      try {
        await prisma.broadcastLog.delete({ where: { id: parts[3] } }).catch(() => {});
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 500, { error: 'Erreur lors de la suppression' });
      }
      return true;
    }

    // POST /api/admin/broadcast - Send configurable broadcast
    if (method === 'POST' && parts.length === 3) {
      try {
        interface BroadcastBody {
          title?: string;
          message: string;
          color?: string;
          thumbnailUrl?: string;
          imageUrl?: string;
          footerText?: string;
          target?: 'ALL' | 'ACTIVATED' | 'CUSTOM';
          targetGuilds?: string[];
          channelPref?: 'AUTO' | 'NEWS' | 'PUBLIC' | 'STAFF' | 'FALLBACK';
          dryRun?: boolean;
        }

        const body = await readJsonBody<BroadcastBody>(req);
        if (!body || !body.message?.trim()) {
          json(res, 400, { error: 'Message requis' });
          return true;
        }

        const title = resolveEmojiShortcodesToUnicode(body.title?.trim() || '📢 Annonce Globale Kotbo');
        const message = resolveEmojiShortcodes(body.message.trim());
        const color = (body.color || '#5865F2') as ColorResolvable;
        const thumbnailUrl = body.thumbnailUrl?.trim() || null;
        const imageUrl = body.imageUrl?.trim() || null;
        const footerText = resolveEmojiShortcodesToUnicode(body.footerText?.trim() || "Système d'annonce globale Kotbo");
        const target = body.target || 'ALL';
        const targetGuilds = Array.isArray(body.targetGuilds) ? body.targetGuilds : [];
        const channelPref = body.channelPref || 'AUTO';
        const dryRun = body.dryRun === true;

        const dbGuilds = await prisma.guild.findMany({
          select: {
            id: true,
            activated: true,
            broadcastChannelId: true,
            newsChannelId: true,
            publicChannelId: true,
            staffAnnouncementChannelId: true,
          },
        });

        const guildChannelMap: Record<string, {
          broadcastChannelId: string | null;
          newsChannelId: string | null;
          publicChannelId: string | null;
          staffAnnouncementChannelId: string | null;
        }> = Object.create(null);

        const allowedGuildIds = new Set<string>();

        for (const guild of dbGuilds) {
          guildChannelMap[guild.id] = {
            broadcastChannelId: guild.broadcastChannelId,
            newsChannelId: guild.newsChannelId,
            publicChannelId: guild.publicChannelId,
            staffAnnouncementChannelId: guild.staffAnnouncementChannelId,
          };

          if (target === 'ALL') {
            allowedGuildIds.add(guild.id);
          } else if (target === 'ACTIVATED' && guild.activated) {
            allowedGuildIds.add(guild.id);
          } else if (target === 'CUSTOM' && targetGuilds.includes(guild.id)) {
            allowedGuildIds.add(guild.id);
          }
        }

        if (target === 'ALL') {
          const shardGuilds = await collectShardGuilds(client);
          for (const g of shardGuilds) {
            allowedGuildIds.add(g.id);
          }
        }

        const totalTargeted = allowedGuildIds.size;

        if (dryRun) {
          json(res, 200, { dryRun: true, totalTargeted, target, channelPref });
          return true;
        }

        let successCount = 0;
        let failCount = 0;

        const embedData = { title, message, color: typeof color === 'string' ? color : '#5865F2', thumbnailUrl, imageUrl, footerText };
        const allowedIds = [...allowedGuildIds];

        if (client.shard) {
          const results = await client.shard.broadcastEval<
            { successCount: number; failCount: number },
            {
              embedData: typeof embedData;
              guildChannelMap: typeof guildChannelMap;
              allowedIds: string[];
              channelPref: string;
              COLORS_PRIMARY: number;
            }
          >(async (shardClient, ctx) => {
            let sc = 0;
            let fc = 0;

            for (const [id, guild] of shardClient.guilds.cache) {
              if (!ctx.allowedIds.includes(id)) continue;
              try {
                const dbG = ctx.guildChannelMap[id];
                let channel;

                // Per-guild configured broadcast channel always wins
                const prefOrder: string[] = [dbG?.broadcastChannelId || ''];
                if (ctx.channelPref === 'NEWS') prefOrder.push(dbG?.newsChannelId || '', dbG?.publicChannelId || '');
                else if (ctx.channelPref === 'PUBLIC') prefOrder.push(dbG?.publicChannelId || '', dbG?.newsChannelId || '');
                else if (ctx.channelPref === 'STAFF') prefOrder.push(dbG?.staffAnnouncementChannelId || '', dbG?.newsChannelId || '');
                else prefOrder.push(dbG?.newsChannelId || '', dbG?.publicChannelId || '', dbG?.staffAnnouncementChannelId || '');

                for (const chId of prefOrder) {
                  if (chId) {
                    const found = guild.channels.cache.get(chId);
                    if (found && (found.type === 0 || found.type === 5)) { channel = found; break; }
                  }
                }

                if (!channel) {
                  channel = guild.channels.cache.find((c) => c.type === 0 && c.permissionsFor(shardClient.user!)?.has('SendMessages'));
                }

                if (channel && channel.isTextBased()) {
                  const { EmbedBuilder: ShardEmbed } = await import('discord.js');
                  const embed = new ShardEmbed()
                    .setTitle(ctx.embedData.title)
                    .setDescription(ctx.embedData.message)
                    .setColor(parseInt((ctx.embedData.color || '#5865F2').replace('#', ''), 16))
                    .setFooter({ text: ctx.embedData.footerText || '' })
                    .setTimestamp();
                  if (ctx.embedData.thumbnailUrl) embed.setThumbnail(ctx.embedData.thumbnailUrl);
                  if (ctx.embedData.imageUrl) embed.setImage(ctx.embedData.imageUrl);
                  await channel.send({ embeds: [embed] });
                  sc++;
                } else {
                  fc++;
                }
              } catch {
                fc++;
              }
            }
            return { successCount: sc, failCount: fc };
          }, {
            context: {
              embedData,
              guildChannelMap,
              allowedIds,
              channelPref,
              COLORS_PRIMARY: 0x5865f2,
            },
          });

          for (const r of results) {
            successCount += r.successCount;
            failCount += r.failCount;
          }
        } else {
          for (const [id, guild] of client.guilds.cache) {
            if (!allowedGuildIds.has(id)) continue;
            try {
              const dbG = guildChannelMap[id];
              let channel;

              // Per-guild configured broadcast channel always wins
              const prefOrder: (string | null | undefined)[] = [dbG?.broadcastChannelId];
              if (channelPref === 'NEWS') prefOrder.push(dbG?.newsChannelId, dbG?.publicChannelId);
              else if (channelPref === 'PUBLIC') prefOrder.push(dbG?.publicChannelId, dbG?.newsChannelId);
              else if (channelPref === 'STAFF') prefOrder.push(dbG?.staffAnnouncementChannelId, dbG?.newsChannelId);
              else prefOrder.push(dbG?.newsChannelId, dbG?.publicChannelId, dbG?.staffAnnouncementChannelId);

              for (const chId of prefOrder) {
                if (chId) {
                  const found = guild.channels.cache.get(chId);
                  if (found && (found.type === 0 || found.type === 5)) { channel = found; break; }
                }
              }

              if (!channel) {
                channel = guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(client.user!)?.has('SendMessages'));
              }

              if (channel && channel.isTextBased()) {
                const embed = new EmbedBuilder()
                  .setTitle(title)
                  .setDescription(message)
                  .setColor(color)
                  .setFooter({ text: footerText })
                  .setTimestamp();
                if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
                if (imageUrl) embed.setImage(imageUrl);
                await channel.send({ embeds: [embed] });
                successCount++;
              } else {
                failCount++;
              }
            } catch {
              failCount++;
            }
          }
        }

        await prisma.broadcastLog.create({
          data: {
            sentBy: user.userId,
            title,
            message: body.message.trim(),
            color: typeof color === 'string' ? color : '#5865F2',
            thumbnailUrl,
            imageUrl,
            footerText,
            target,
            targetGuilds,
            channelPref,
            successCount,
            failCount,
            totalTargeted,
          },
        });

        json(res, 200, { success: true, successCount, failCount, totalTargeted });
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        logger.error('AdminAPI', `Broadcast error: ${errMessage}`);
        json(res, 500, { error: "Erreur lors de l'envoi du broadcast" });
      }
      return true;
    }
  }

  // --- GLOBAL ADMIN CODES AND DEACTIVATION ---
  const isGlobalAdmin = await resolveAdminAccess(client, user.userId);
  if (!isGlobalAdmin) {
    json(res, 403, { error: 'Accès réservé aux administrateurs globaux Kotbo.' });
    return true;
  }

  // GET /api/admin/activation-codes
  if (parts.length === 3 && parts[2] === 'activation-codes' && method === 'GET') {
    try {
      const guildNames = new Map((await collectShardGuilds(client)).map((g: { id: string; name: string }) => [g.id, g.name] as const));
      const codes = await prisma.activationCode.findMany({
        orderBy: { createdAt: 'desc' }
      });
      // État d'accès des serveurs ayant consommé un code, pour afficher
      // l'échéance et le temps restant à côté du code.
      const usedGuildIds = codes.map((c) => c.usedByGuildId).filter((id): id is string => !!id);
      const accessRows = usedGuildIds.length
        ? await prisma.guild.findMany({
            where: { id: { in: usedGuildIds } },
            select: { id: true, activated: true, accessType: true, accessExpiresAt: true, accessExpiredAt: true },
          })
        : [];
      const accessByGuild = new Map(accessRows.map((g) => [g.id, g] as const));

      const enrichedCodes = await Promise.all(codes.map(async (c) => {
        let guildName = null;
        if (c.usedByGuildId) {
          guildName = guildNames.get(c.usedByGuildId) ?? getGuildName(client, c.usedByGuildId);
        }
        const access = c.usedByGuildId ? accessByGuild.get(c.usedByGuildId) : null;
        return {
          ...c,
          guildName,
          guildActivated: access?.activated ?? null,
          accessExpiresAt: access?.accessExpiresAt ?? null,
          accessExpiredAt: access?.accessExpiredAt ?? null,
        };
      }));
      json(res, 200, enrichedCodes);
    } catch (err) {
      logger.error('AdminAPI', 'Erreur lors de la récupération des codes :', err);
      json(res, 500, { error: "Erreur lors de la récupération des codes d'activation." });
    }
    return true;
  }

  // POST /api/admin/activation-codes
  if (parts.length === 3 && parts[2] === 'activation-codes' && method === 'POST') {
    try {
      // Corps optionnel : sans lui, on retombe sur un code permanent, le
      // comportement historique de cet endpoint.
      const body = isJsonRequest(req)
        ? await readJsonBody<{ accessType?: string; durationMinutes?: number | null; label?: string | null }>(req)
        : null;
      const access = normalizeAccessGrant(body?.accessType, body?.durationMinutes);
      if ('error' in access) {
        json(res, 400, { error: access.error });
        return true;
      }

      const code = `KB-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      const newCode = await prisma.activationCode.create({
        data: {
          code,
          createdById: user.userId,
          isActive: true,
          accessType: access.accessType,
          durationMinutes: access.durationMinutes,
          label: body?.label?.trim() || null,
        }
      });

      json(res, 201, newCode);
    } catch (err) {
      logger.error('AdminAPI', "Erreur lors de la création d'un code :", err);
      json(res, 500, { error: "Erreur lors de la création du code d'activation." });
    }
    return true;
  }

  // DELETE /api/admin/activation-codes/:id
  if (parts.length === 4 && parts[2] === 'activation-codes' && method === 'DELETE') {
    const codeId = parts[3];
    try {
      const codeRow = await prisma.activationCode.findUnique({
        where: { id: codeId }
      });

      if (!codeRow) {
        json(res, 404, { error: 'Code introuvable.' });
        return true;
      }

      if (codeRow.usedByGuildId) {
        await deactivateGuild(codeRow.usedByGuildId);
        // Le serveur perd tout sur décision humaine : il faut le lui dire.
        // Jamais bloquant, une notification ratée ne doit pas annuler la révocation.
        await announceAccessRevoked(client, codeRow.usedByGuildId).catch((err) =>
          logger.warn('AdminAPI', `Impossible de prévenir ${codeRow.usedByGuildId} de la révocation :`, err),
        );
      }

      await prisma.activationCode.delete({
        where: { id: codeId }
      });

      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('AdminAPI', 'Erreur lors de la suppression du code :', err);
      json(res, 500, { error: "Erreur lors de la suppression du code d'activation." });
    }
    return true;
  }

  // POST /api/admin/staff-servers/reconcile - resynchronise l'activation de tous les serveurs staff liés
  if (parts.length === 4 && parts[2] === 'staff-servers' && parts[3] === 'reconcile' && method === 'POST') {
    try {
      const links = await prisma.staffServerLink.findMany({
        where: { enabled: true },
        select: { staffGuildId: true },
        distinct: ['staffGuildId'],
      });

      const counts = { checked: 0, activated: 0, deactivated: 0, unchanged: 0 };

      for (const link of links) {
        counts.checked++;
        try {
          const result = await reconcileStaffGuildActivation(link.staffGuildId);
          counts[result]++;
        } catch (err) {
          logger.error('AdminAPI', `Erreur de réconciliation du serveur staff ${link.staffGuildId} :`, err);
          counts.unchanged++;
        }
      }

      json(res, 200, { ok: true, ...counts });
    } catch (err) {
      logger.error('AdminAPI', 'Erreur lors de la synchronisation des serveurs staff :', err);
      json(res, 500, { error: 'Erreur lors de la synchronisation des serveurs staff.' });
    }
    return true;
  }

  // POST /api/admin/guilds/:guildId/deactivate
  if (parts.length === 5 && parts[2] === 'guilds' && parts[4] === 'deactivate' && method === 'POST') {
    const guildId = parts[3];
    try {
      await deactivateGuild(guildId);
      await announceAccessRevoked(client, guildId).catch((err) =>
        logger.warn('AdminAPI', `Impossible de prévenir ${guildId} de la désactivation :`, err),
      );
      json(res, 200, { ok: true, message: 'Le serveur a été désactivé.' });
    } catch (err) {
      logger.error('AdminAPI', 'Erreur lors de la désactivation du serveur :', err);
      json(res, 500, { error: 'Erreur lors de la désactivation du serveur.' });
    }
    return true;
  }

  // POST /api/admin/guilds/:guildId/activate-auto
  if (parts.length === 5 && parts[2] === 'guilds' && parts[4] === 'activate-auto' && method === 'POST') {
    const guildId = parts[3];
    try {
      // Corps optionnel : sans lui, l'activation reste permanente comme avant.
      const body = isJsonRequest(req)
        ? await readJsonBody<{ accessType?: string; durationMinutes?: number | null }>(req)
        : null;
      const access = normalizeAccessGrant(body?.accessType, body?.durationMinutes);
      if ('error' in access) {
        json(res, 400, { error: access.error });
        return true;
      }

      const code = `KB-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      await prisma.activationCode.create({
        data: {
          code,
          createdById: user.userId,
          isActive: true,
          accessType: access.accessType,
          durationMinutes: access.durationMinutes,
        }
      });

      const result = await activateGuild(guildId, code);

      if (result.expiresAt && result.durationMinutes) {
        await announceTrialStart(client, guildId, result.expiresAt, result.durationMinutes).catch((err) =>
          logger.warn('AdminAPI', `Impossible d'annoncer le démarrage de l'essai sur ${guildId} :`, err),
        );
      }

      json(res, 200, {
        ok: true,
        code,
        accessType: result.accessType,
        accessExpiresAt: result.expiresAt,
        message: result.expiresAt
          ? `Le serveur a été activé pour ${formatDuration(result.durationMinutes!)}.`
          : 'Le serveur a été activé automatiquement.',
      });
    } catch (err) {
      logger.error('AdminAPI', 'Erreur lors de la génération et affectation du code :', err);
      json(res, 500, { error: "Erreur lors de l'activation automatique du serveur." });
    }
    return true;
  }

  // POST /api/admin/guilds/:guildId/access/extend : prolonge un accès à durée limitée
  if (parts.length === 6 && parts[2] === 'guilds' && parts[4] === 'access' && parts[5] === 'extend' && method === 'POST') {
    const guildId = parts[3];
    try {
      const body = await readJsonBody<{ minutes?: number; accessType?: string }>(req);
      const minutes = typeof body?.minutes === 'number' ? body.minutes : Number(body?.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_ACCESS_DURATION_MINUTES) {
        json(res, 400, { error: `La durée doit être un nombre entier de minutes entre 1 et ${MAX_ACCESS_DURATION_MINUTES}.` });
        return true;
      }

      const type = body?.accessType ? normalizeAccessGrant(body.accessType, minutes) : null;
      if (type && 'error' in type) {
        json(res, 400, { error: type.error });
        return true;
      }

      const status = await extendAccess(guildId, minutes, type ? { type: type.accessType } : {});
      if (!status) {
        json(res, 404, { error: "Ce serveur n'est pas enregistré." });
        return true;
      }

      json(res, 200, {
        ok: true,
        accessType: status.accessType,
        accessExpiresAt: status.accessExpiresAt,
        minutesLeft: status.minutesLeft,
        message: status.accessExpiresAt
          ? `Accès prolongé jusqu'au ${status.accessExpiresAt.toLocaleString('fr-FR')}.`
          : 'Ce serveur dispose déjà d\'un accès permanent.',
      });
    } catch (err) {
      logger.error('AdminAPI', "Erreur lors de la prolongation de l'accès :", err);
      json(res, 500, { error: "Erreur lors de la prolongation de l'accès." });
    }
    return true;
  }

  // POST /api/admin/guilds/:guildId/rescan-stats
  if (parts.length === 5 && parts[2] === 'guilds' && parts[4] === 'rescan-stats' && method === 'POST') {
    const guildId = parts[3];

    // Check if guild exists across shards
    let guildExists = false;
    if (client.shard) {
      const results = await client.shard.broadcastEval<boolean, string>((c, id) => c.guilds.cache.has(id), { context: guildId });
      guildExists = results.some(r => r);
    } else {
      guildExists = client.guilds.cache.has(guildId) || !!(await client.guilds.fetch(guildId).catch(() => null));
    }

    if (!guildExists) {
      json(res, 404, { error: 'Serveur introuvable' });
      return true;
    }

    try {
      const body = await readJsonBody<{ force?: boolean; forcer?: boolean }>(req);
      const force = !!(body?.force || body?.forcer);

      if (client.shard) {
        const results = await client.shard.broadcastEval<{ status: string; error?: string } | null, { guildId: string; force: boolean; servicePath: string }>(async (shardClient, context) => {
          const guild = shardClient.guilds.cache.get(context.guildId);
          if (!guild) return null;
          try {
            const { startHistoricalScraping } = await import(context.servicePath);
            const result = await startHistoricalScraping(shardClient, context.guildId, context.force);
            return { status: result.status };
          } catch (err) {
            return { status: 'FAILED', error: err instanceof Error ? err.message : String(err) };
          }
        }, { context: { guildId, force, servicePath } });

        const result = results.find(r => r !== null);
        if (!result) {
          json(res, 404, { error: 'Serveur introuvable' });
        } else if (result.status === 'STARTED') {
          json(res, 200, { ok: true, message: 'Scraping historique lancé avec succès.' });
        } else if (result.status === 'ALREADY_COMPLETED') {
          json(res, 200, { ok: true, message: "L'historique est déjà entièrement synchronisé." });
        } else if (result.status === 'ALREADY_RUNNING') {
          json(res, 409, { error: 'Une synchronisation est déjà en cours sur ce serveur.' });
        } else {
          json(res, 500, { error: result.error || 'Erreur lors du lancement du scraping' });
        }
      } else {
        const { startHistoricalScraping } = await import('../../services/analytics/messageScraperService.js');
        const result = await startHistoricalScraping(client, guildId, force);
        if (result.status === 'ALREADY_RUNNING') {
          json(res, 409, { error: 'Une synchronisation est déjà en cours sur ce serveur.' });
        } else {
          json(res, 200, {
            ok: true,
            message: result.status === 'ALREADY_COMPLETED'
              ? "L'historique est déjà entièrement synchronisé."
              : 'Scraping historique lancé avec succès.',
          });
        }
      }
    } catch (err) {
      logger.error('AdminAPI', 'POST rescan-stats error:', err);
      json(res, 500, { error: 'Erreur lors du lancement du scraping' });
    }
    return true;
  }

  // POST /api/admin/guilds/:guildId/resync-all
  if (parts.length === 5 && parts[2] === 'guilds' && parts[4] === 'resync-all' && method === 'POST') {
    const guildId = parts[3];

    try {
      if (client.shard) {
        const results = await client.shard.broadcastEval<
          { status: string; error?: string } | null,
          { guildId: string; servicePath: string }
        >(async (shardClient, context) => {
          if (!shardClient.guilds.cache.has(context.guildId)) return null;
          try {
            const { startGuildDataSync } = await import(context.servicePath);
            const result = await startGuildDataSync(shardClient, context.guildId);
            return { status: result.status };
          } catch (error) {
            return { status: 'FAILED', error: error instanceof Error ? error.message : String(error) };
          }
        }, { context: { guildId, servicePath: guildDataSyncServicePath } });

        const result = results.find((entry) => entry !== null);
        if (!result) {
          json(res, 404, { error: 'Serveur introuvable' });
        } else if (result.status === 'STARTED') {
          json(res, 202, { ok: true, status: result.status, message: 'Synchronisation complète lancée.' });
        } else if (result.status === 'ALREADY_RUNNING') {
          json(res, 409, { error: 'Une synchronisation est déjà en cours sur ce serveur.' });
        } else if (result.status === 'NOT_ACTIVATED') {
          json(res, 400, { error: "Le serveur doit être activé avant d'être synchronisé." });
        } else {
          json(res, 500, { error: result.error || 'Impossible de lancer la synchronisation complète.' });
        }
      } else {
        if (!client.guilds.cache.has(guildId) && !(await client.guilds.fetch(guildId).catch(() => null))) {
          json(res, 404, { error: 'Serveur introuvable' });
          return true;
        }

        const { startGuildDataSync } = await import('../../services/analytics/guildDataSyncService.js');
        const result = await startGuildDataSync(client, guildId);
        if (result.status === 'STARTED') {
          json(res, 202, { ok: true, status: result.status, message: 'Synchronisation complète lancée.' });
        } else if (result.status === 'ALREADY_RUNNING') {
          json(res, 409, { error: 'Une synchronisation est déjà en cours sur ce serveur.' });
        } else if (result.status === 'NOT_ACTIVATED') {
          json(res, 400, { error: "Le serveur doit être activé avant d'être synchronisé." });
        } else {
          json(res, 404, { error: 'Serveur introuvable' });
        }
      }
    } catch (error) {
      logger.error('AdminAPI', 'POST resync-all error:', error);
      json(res, 500, { error: 'Erreur lors du lancement de la synchronisation complète.' });
    }
    return true;
  }

  // POST /api/admin/guilds/:guildId/reset-server-template
  if (parts.length === 5 && parts[2] === 'guilds' && parts[4] === 'reset-server-template' && method === 'POST') {
    const guildId = parts[3];

    try {
      const guildRow = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { serverTemplateAppliedAt: true, serverTemplateAppliedBy: true },
      });
      if (!guildRow) {
        json(res, 404, { error: 'Serveur introuvable' });
        return true;
      }
      if (!guildRow.serverTemplateAppliedAt) {
        json(res, 409, { error: "La mise en place du serveur n'a jamais été lancée sur ce serveur." });
        return true;
      }

      // `serverTemplateRefs` survit a la remise a zero : les salons deja crees
      // existent toujours, et c'est cette trace qui evite qu'une seconde mise
      // en place les double.
      await prisma.guild.update({
        where: { id: guildId },
        data: {
          serverTemplateAppliedAt: null,
          serverTemplateAppliedBy: null,
          serverTemplateSections: [],
        },
      });
      await cache.invalidateGuild(guildId).catch(() => null);

      json(res, 200, {
        ok: true,
        message: `Mise en place rouverte (précédemment faite par ${guildRow.serverTemplateAppliedBy ?? 'un administrateur'}).`,
      });
    } catch (error) {
      logger.error('AdminAPI', 'POST reset-server-template error:', error);
      json(res, 500, { error: 'Erreur lors de la réinitialisation de la mise en place.' });
    }
    return true;
  }

  // POST /api/admin/guilds/:guildId/rescan-members
  if (parts.length === 5 && parts[2] === 'guilds' && parts[4] === 'rescan-members' && method === 'POST') {
    const guildId = parts[3];

    let guildExists = false;
    if (client.shard) {
      const results = await client.shard.broadcastEval<boolean, string>((c, id) => c.guilds.cache.has(id), { context: guildId });
      guildExists = results.some(r => r);
    } else {
      guildExists = client.guilds.cache.has(guildId) || !!(await client.guilds.fetch(guildId).catch(() => null));
    }

    if (!guildExists) {
      json(res, 404, { error: 'Serveur introuvable' });
      return true;
    }

    try {
      const body = await readJsonBody<{ force?: boolean }>(req);
      const force = !!body?.force;

      const memberServicePath = path.resolve(__dirname, '../../services/analytics/memberScraperService.js');

      if (client.shard) {
        const results = await client.shard.broadcastEval<{ status: string; error?: string } | null, { guildId: string; force: boolean; servicePath: string }>(async (shardClient, context) => {
          const guild = shardClient.guilds.cache.get(context.guildId);
          if (!guild) return null;
          try {
            const { startMemberScraping } = await import(context.servicePath);
            const result = await startMemberScraping(shardClient, context.guildId, context.force);
            return { status: result.status };
          } catch (err) {
            return { status: 'FAILED', error: err instanceof Error ? err.message : String(err) };
          }
        }, { context: { guildId, force, servicePath: memberServicePath } });

        const result = results.find(r => r !== null);
        if (!result) {
          json(res, 404, { error: 'Serveur introuvable' });
        } else if (result.status === 'STARTED') {
          json(res, 200, { ok: true, message: 'Scraping des membres lancé avec succès.' });
        } else if (result.status === 'ALREADY_COMPLETED') {
          json(res, 200, { ok: true, message: 'Les membres sont déjà synchronisés.' });
        } else if (result.status === 'ALREADY_RUNNING') {
          json(res, 409, { error: 'Une synchronisation est déjà en cours sur ce serveur.' });
        } else {
          json(res, 500, { error: result.error || 'Erreur lors du lancement du scraping membres' });
        }
      } else {
        const { startMemberScraping } = await import('../../services/analytics/memberScraperService.js');
        const result = await startMemberScraping(client, guildId, force);
        if (result.status === 'ALREADY_RUNNING') {
          json(res, 409, { error: 'Une synchronisation est déjà en cours sur ce serveur.' });
        } else {
          json(res, 200, {
            ok: true,
            message: result.status === 'ALREADY_COMPLETED'
              ? 'Les membres sont déjà synchronisés.'
              : 'Scraping des membres lancé avec succès.',
          });
        }
      }
    } catch (err) {
      logger.error('AdminAPI', 'POST rescan-members error:', err);
      json(res, 500, { error: 'Erreur lors du lancement du scraping membres' });
    }
    return true;
  }

  // ============================================================================
  // WHITE-LABEL INSTANCE MANAGEMENT
  // ============================================================================

  // GET /api/admin/whitelabel - List all instances
  if (parts[2] === 'whitelabel' && parts.length === 3 && method === 'GET') {
    try {
      const instances = await prisma.whiteLabelInstance.findMany({
        include: { _count: { select: { guilds: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const safe = instances.map(inst => ({
        id: inst.id,
        slug: inst.slug,
        name: inst.name,
        enabled: inst.enabled,
        discordClientId: inst.discordClientId,
        dashboardUrl: inst.dashboardUrl,
        apiPort: inst.apiPort,
        brandName: inst.brandName,
        brandColor: inst.brandColor,
        brandLogoUrl: inst.brandLogoUrl,
        brandFaviconUrl: inst.brandFaviconUrl,
        brandFooterText: inst.brandFooterText,
        ownerId: inst.ownerId,
        maxGuilds: inst.maxGuilds,
        guildCount: inst._count.guilds,
        createdAt: inst.createdAt,
        updatedAt: inst.updatedAt,
      }));

      json(res, 200, { instances: safe });
    } catch (err) {
      logger.error('AdminAPI', 'GET whitelabel error:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des instances' });
    }
    return true;
  }

  // POST /api/admin/whitelabel - Create instance
  if (parts[2] === 'whitelabel' && parts.length === 3 && method === 'POST') {
    try {
      // Creation d'une instance marque blanche : tous les champs viennent du
      // corps de requete, valides juste en dessous.
      const body = await readJsonBody<Partial<{
        slug: string;
        name: string;
        discordToken: string;
        discordClientId: string;
        discordClientSecret: string;
        discordRedirectUri: string;
        dashboardUrl: string;
        apiPort: string | number;
        brandName: string;
        brandColor: string;
        brandLogoUrl: string;
        brandFaviconUrl: string;
        brandFooterText: string;
        ownerId: string;
        maxGuilds: string | number;
      }>>(req);
      if (!body) { json(res, 400, { error: 'Body JSON requis' }); return true; }

      const { slug, name, discordToken, discordClientId, discordClientSecret,
        discordRedirectUri, dashboardUrl, apiPort, brandName, brandColor,
        brandLogoUrl, brandFaviconUrl, brandFooterText, ownerId, maxGuilds } = body;

      if (!slug || !name || !discordToken || !discordClientId || !discordClientSecret || !ownerId) {
        json(res, 400, { error: 'Champs requis: slug, name, discordToken, discordClientId, discordClientSecret, ownerId' });
        return true;
      }

      const existing = await prisma.whiteLabelInstance.findUnique({ where: { slug } });
      if (existing) {
        json(res, 409, { error: `Le slug "${slug}" est déjà utilisé.` });
        return true;
      }

      const instance = await prisma.whiteLabelInstance.create({
        data: {
          slug,
          name,
          discordToken,
          discordClientId,
          discordClientSecret,
          discordRedirectUri: discordRedirectUri || null,
          dashboardUrl: dashboardUrl || null,
          apiPort: apiPort ? Number(apiPort) : null,
          brandName: brandName || null,
          brandColor: brandColor || '#5865F2',
          brandLogoUrl: brandLogoUrl || null,
          brandFaviconUrl: brandFaviconUrl || null,
          brandFooterText: brandFooterText || null,
          ownerId,
          maxGuilds: maxGuilds ? Number(maxGuilds) : 1,
        },
      });

      json(res, 201, { instance: { id: instance.id, slug: instance.slug, name: instance.name } });
    } catch (err) {
      logger.error('AdminAPI', 'POST whitelabel error:', err);
      json(res, 500, { error: 'Erreur lors de la création de l\'instance' });
    }
    return true;
  }

  // GET /api/admin/whitelabel/:id - Get instance details
  if (parts[2] === 'whitelabel' && parts[3] && parts.length === 4 && method === 'GET') {
    try {
      const instance = await prisma.whiteLabelInstance.findUnique({
        where: { id: parts[3] },
        include: {
          guilds: { select: { id: true, activated: true } },
        },
      });

      if (!instance) {
        json(res, 404, { error: 'Instance introuvable' });
        return true;
      }

      json(res, 200, {
        instance: {
          ...instance,
          discordToken: '••••' + instance.discordToken.slice(-6),
          discordClientSecret: '••••' + instance.discordClientSecret.slice(-4),
          jwtSecret: instance.jwtSecret ? '••••' : null,
        },
      });
    } catch (err) {
      logger.error('AdminAPI', 'GET whitelabel/:id error:', err);
      json(res, 500, { error: 'Erreur lors de la récupération de l\'instance' });
    }
    return true;
  }

  // PATCH /api/admin/whitelabel/:id - Update instance
  if (parts[2] === 'whitelabel' && parts[3] && parts.length === 4 && method === 'PATCH') {
    try {
      const body = await readJsonBody(req);
      if (!body) { json(res, 400, { error: 'Body JSON requis' }); return true; }

      const existing = await prisma.whiteLabelInstance.findUnique({ where: { id: parts[3] } });
      if (!existing) {
        json(res, 404, { error: 'Instance introuvable' });
        return true;
      }

      const allowedFields = [
        'name', 'slug', 'enabled', 'discordToken', 'discordClientId',
        'discordClientSecret', 'discordRedirectUri', 'dashboardUrl', 'apiPort',
        'brandName', 'brandColor', 'brandLogoUrl', 'brandFaviconUrl',
        'brandFooterText', 'jwtSecret', 'ownerId', 'maxGuilds',
      ] as const;

      const updateData: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          if (field === 'apiPort' || field === 'maxGuilds') {
            updateData[field] = body[field] === null ? null : Number(body[field]);
          } else if (field === 'enabled') {
            updateData[field] = Boolean(body[field]);
          } else {
            updateData[field] = body[field];
          }
        }
      }

      const dashboardUrl = typeof updateData.dashboardUrl === 'string' ? updateData.dashboardUrl : null;
      if (dashboardUrl) {
        try {
          updateData.dashboardOrigin = new URL(dashboardUrl).origin;
        } catch {
          updateData.dashboardOrigin = dashboardUrl.replace(/\/$/, '');
        }
      }

      const updated = await prisma.whiteLabelInstance.update({
        where: { id: parts[3] },
        data: updateData,
      });

      json(res, 200, { instance: { id: updated.id, slug: updated.slug, name: updated.name } });
    } catch (err) {
      logger.error('AdminAPI', 'PATCH whitelabel/:id error:', err);
      json(res, 500, { error: 'Erreur lors de la mise à jour de l\'instance' });
    }
    return true;
  }

  // DELETE /api/admin/whitelabel/:id - Delete instance
  if (parts[2] === 'whitelabel' && parts[3] && parts.length === 4 && method === 'DELETE') {
    try {
      const existing = await prisma.whiteLabelInstance.findUnique({
        where: { id: parts[3] },
        include: { _count: { select: { guilds: true } } },
      });

      if (!existing) {
        json(res, 404, { error: 'Instance introuvable' });
        return true;
      }

      if (existing._count.guilds > 0) {
        json(res, 409, { error: `Impossible de supprimer : ${existing._count.guilds} guild(s) rattachée(s). Détachez-les d'abord.` });
        return true;
      }

      await prisma.whiteLabelInstance.delete({ where: { id: parts[3] } });
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('AdminAPI', 'DELETE whitelabel/:id error:', err);
      json(res, 500, { error: 'Erreur lors de la suppression de l\'instance' });
    }
    return true;
  }

  // POST /api/admin/whitelabel/:id/guilds - Bind a guild to an instance
  if (parts[2] === 'whitelabel' && parts[3] && parts[4] === 'guilds' && parts.length === 5 && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!body?.guildId) { json(res, 400, { error: 'guildId requis' }); return true; }

      const instance = await prisma.whiteLabelInstance.findUnique({
        where: { id: parts[3] },
        include: { _count: { select: { guilds: true } } },
      });

      if (!instance) {
        json(res, 404, { error: 'Instance introuvable' });
        return true;
      }

      if (instance._count.guilds >= instance.maxGuilds) {
        json(res, 409, { error: `Limite atteinte : ${instance.maxGuilds} guild(s) maximum pour cette instance.` });
        return true;
      }

      await prisma.guild.update({
        where: { id: String(body.guildId) },
        data: { instanceId: instance.id },
      });

      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('AdminAPI', 'POST whitelabel/:id/guilds error:', err);
      json(res, 500, { error: 'Erreur lors du rattachement de la guild' });
    }
    return true;
  }

  // DELETE /api/admin/whitelabel/:id/guilds/:guildId - Unbind a guild
  if (parts[2] === 'whitelabel' && parts[3] && parts[4] === 'guilds' && parts[5] && parts.length === 6 && method === 'DELETE') {
    try {
      await prisma.guild.update({
        where: { id: parts[5] },
        data: { instanceId: null },
      });

      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('AdminAPI', 'DELETE whitelabel guild unbind error:', err);
      json(res, 500, { error: 'Erreur lors du détachement de la guild' });
    }
    return true;
  }

  // ── RGPD : export des données d'un utilisateur ──────────────────
  // GET /api/admin/gdpr/:userId/preview - résumé (catégories + décomptes)
  // GET /api/admin/gdpr/:userId/export  - archive ZIP complète
  if (parts[2] === 'gdpr' && parts[3] && parts.length === 5 && method === 'GET') {
    const userId = parts[3];
    const action = parts[4];

    if (!/^\d{5,25}$/.test(userId)) {
      json(res, 400, { error: 'Identifiant Discord invalide.' });
      return true;
    }

    if (action !== 'preview' && action !== 'export') {
      return false;
    }

    try {
      const data = await collectUserData(client, userId);

      if (action === 'preview') {
        json(res, 200, {
          meta: data.meta,
          identity: data.identity,
          categories: data.categories.map((c) => ({
            key: c.key,
            label: c.label,
            description: c.description,
            count: c.count,
            tables: c.tables.map((t) => ({ key: t.key, label: t.label, count: t.count })),
          })),
        });
        return true;
      }

      // action === 'export'
      const zip = buildGdprZip(data);
      const safeName = (data.meta.username ?? userId).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `kotbo_rgpd_${safeName}_${new Date().toISOString().slice(0, 10)}.zip`;
      const buffer = Buffer.from(zip);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.statusCode = 200;
      res.end(buffer);
      logger.info('AdminAPI', `Export RGPD généré pour ${userId} (${data.meta.totalRecords} enregistrements) par ${user.userId}`);
      return true;
    } catch (err) {
      logger.error('AdminAPI', 'GDPR export error:', err);
      json(res, 500, { error: "Erreur lors de la génération de l'export RGPD." });
      return true;
    }
  }

  return false;
}
