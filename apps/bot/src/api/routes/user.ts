import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { isGuildActivated } from '../../utils/activation.js';
import {
  json,
  readJsonBody,
  checkRateLimit,
  rankCardPreviewRateLimiter,
  verifyAuth,
  resolveAdminAccess,
  resolveDashboardAccess,
  hasDashboardAdminPermission,
  DashboardAccessLevel,
} from '../shared.js';
import { getCurrentInstance, isWhiteLabelInstance } from '../../utils/instanceContext.js';
import prisma from '../../utils/db.js';
import { fetchExternal } from '../../utils/http.js';
import { normalizeRankCardCustomization, type LevelCurve } from '@kotbo/shared';
import { getRankCardCustomization, saveRankCardCustomization } from '../../services/progression/rankCardService.js';
import { getGuildLevelCurve, getLevelFromXp, renderRankCard } from '../../services/progression/levelingService.js';

// Repli de l'aperçu quand aucune progression réelle n'est disponible : la
// personnalisation est globale, la progression dépend du serveur.
const PREVIEW_LEVEL = 12;
const PREVIEW_XP = 16_800;
const PREVIEW_RANK = 7;

/**
 * Progression du membre dans le serveur sélectionné, pour que l'aperçu montre
 * la carte telle qu'elle sortira de `/rank`.
 *
 * Contrairement à `getMemberRankData`, on ne charge pas tout le classement de
 * la guilde : deux requêtes indexées suffisent, et l'aperçu est rendu à chaque
 * pause de frappe. L'absence de ligne vaut absence de progression, donc repli
 * sur les valeurs d'exemple - c'est aussi ce qui empêche de sonder un serveur
 * où le membre n'a jamais écrit.
 *
 * À XP égal, compter les membres strictement devant donne le même rang à tous
 * les ex æquo, là où `getMemberRankData` les départage par l'ordre que rend la
 * base. L'aperçu peut donc afficher un rang inférieur d'un cran à celui de
 * `/rank` sur une égalité : le classement de `/rank` n'étant lui-même pas
 * déterministe dans ce cas, mieux vaut ici une valeur stable.
 */
async function resolvePreviewProgression(
  userId: string,
  rawGuildId: unknown,
): Promise<{ level: number; xp: number; rank: number; curve: LevelCurve } | null> {
  if (typeof rawGuildId !== 'string' || !/^\d{17,20}$/.test(rawGuildId)) return null;

  try {
    const memberLevel = await prisma.memberLevel.findUnique({
      where: { guildId_userId: { guildId: rawGuildId, userId } },
      select: { xp: true },
    });
    if (!memberLevel) return null;

    const ahead = await prisma.memberLevel.count({
      where: { guildId: rawGuildId, xp: { gt: memberLevel.xp } },
    });

    const curve = await getGuildLevelCurve(rawGuildId);
    return { level: getLevelFromXp(memberLevel.xp, curve), xp: memberLevel.xp, rank: ahead + 1, curve };
  } catch (err) {
    logger.warn('API', `Progression d'aperçu illisible pour ${userId}:`, err);
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async () => {
    for (;;) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

type DiscordOAuthGuild = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
};

async function fetchOAuthGuilds(accessToken: string): Promise<DiscordOAuthGuild[]> {
  const guilds: DiscordOAuthGuild[] = [];
  let after: string | null = null;

  for (;;) {
    const params = new URLSearchParams({ limit: '200', with_counts: 'false' });
    if (after) params.set('after', after);
    const response = await fetchExternal(`https://discord.com/api/v10/users/@me/guilds?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Discord guilds API: ${response.status}`);
    const page = await response.json() as DiscordOAuthGuild[];
    guilds.push(...page);
    if (page.length < 200) return guilds;
    after = page[page.length - 1]?.id ?? null;
    if (!after) return guilds;
  }
}

export async function handleUserRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client
): Promise<boolean> {
  const method = req.method;

  if (parts[0] !== 'api' || parts[1] !== 'user') {
    return false;
  }

  const user = await verifyAuth(req);
  if (!user) {
    json(res, 401, { error: 'Non authentifié' });
    return true;
  }

  // GET /api/user/me
  if (parts[2] === 'me' && method === 'GET') {
    const isBotAdmin = await resolveAdminAccess(client, user.userId);
    json(res, 200, { id: user.userId, username: user.username, avatar: user.avatar, isBotAdmin });
    return true;
  }

  // GET /api/user/rank-card - seulement la préférence : le catalogue des fonds
  // et des emojis vient de `@kotbo/shared`, que le dashboard compile déjà.
  if (parts[2] === 'rank-card' && parts.length === 3 && method === 'GET') {
    const customization = await getRankCardCustomization(user.userId);
    json(res, 200, { customization });
    return true;
  }

  // PUT /api/user/rank-card
  if (parts[2] === 'rank-card' && parts.length === 3 && method === 'PUT') {
    try {
      const body = await readJsonBody(req);
      const customization = await saveRankCardCustomization(user.userId, body);
      json(res, 200, { customization });
    } catch (err) {
      logger.error('API', `Erreur de sauvegarde de la carte de rang pour ${user.userId}:`, err);
      json(res, 500, { error: 'Une erreur interne est survenue' });
    }
    return true;
  }

  // POST /api/user/rank-card/preview - rendu réel, pour éviter de réimplémenter
  // le dessin de la carte côté dashboard.
  if (parts[2] === 'rank-card' && parts[3] === 'preview' && parts.length === 4 && method === 'POST') {
    if (!checkRateLimit(rankCardPreviewRateLimiter, user.userId, 120, 60 * 1000)) {
      json(res, 429, { error: "Trop d'aperçus demandés. Patientez une minute avant de réessayer." });
      return true;
    }

    try {
      const body = await readJsonBody(req);
      const customization = normalizeRankCardCustomization(body);
      const progression = await resolvePreviewProgression(user.userId, body?.guildId);
      const buffer = await renderRankCard(
        {
          userId: user.userId,
          displayName: user.username ?? 'Membre',
          username: user.username ?? 'membre',
          discriminator: '0',
          avatarUrl: user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.png?size=256`
            : 'https://cdn.discordapp.com/embed/avatars/0.png',
          status: 'online',
        },
        progression?.level ?? PREVIEW_LEVEL,
        progression?.xp ?? PREVIEW_XP,
        progression?.rank ?? PREVIEW_RANK,
        customization,
        progression?.curve,
      );

      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Rank-Card-Preview': progression ? 'real' : 'sample',
      });
      res.end(buffer);
    } catch (err) {
      logger.error('API', `Erreur d'aperçu de la carte de rang pour ${user.userId}:`, err);
      json(res, 500, { error: 'Une erreur interne est survenue' });
    }
    return true;
  }

  // GET /api/user/guilds
  if (parts[2] === 'guilds' && method === 'GET') {
    try {
      // For white-label instances, only show guilds bound to this instance
      let instanceGuildIds: Set<string> | null = null;
      if (isWhiteLabelInstance()) {
        const instance = getCurrentInstance();
        const boundGuilds = await prisma.guild.findMany({
          where: { instanceId: instance.id },
          select: { id: true },
        });
        instanceGuildIds = new Set(boundGuilds.map(g => g.id));
      }

      const [isGlobalAdmin, staffLinks, oauthGuilds] = await Promise.all([
        resolveAdminAccess(client, user.userId),
        prisma.staffServerLink.findMany({
          where: { enabled: true },
          select: { mainGuildId: true, staffGuildId: true },
        }),
        user.discordToken
          ? fetchOAuthGuilds(user.discordToken).catch((err) => {
              logger.warn('DashboardAPI', `Discord OAuth guild list unavailable: ${String(err)}`);
              return null;
            })
          : Promise.resolve(null),
      ]);

      const accessibleGuildsList: Array<{
        id: string;
        name: string;
        icon: string | null;
        owner: boolean;
        botPresent: boolean;
        accessLevel: Exclude<DashboardAccessLevel, 'none'>;
        isStaffServer: boolean;
        pairedGuildId: string | null;
        billingAccess: boolean;
      }> = [];

      const staffGuildToMain = new Map(staffLinks.map((l) => [l.staffGuildId, l.mainGuildId]));
      const mainGuildToStaff = new Map(staffLinks.map((l) => [l.mainGuildId, l.staffGuildId]));

      const oauthById = new Map((oauthGuilds ?? []).map((guild) => [guild.id, guild]));
      const candidates = Array.from(client.guilds.cache.values()).filter((botGuild) => {
        if (instanceGuildIds && !instanceGuildIds.has(botGuild.id)) return false;
        if (!isGuildActivated(botGuild.id) && !isGlobalAdmin) return false;
        // Un administrateur global conserve la vue de toutes les guildes. Pour
        // les autres, l'intersection OAuth élimine immédiatement les serveurs
        // dont ils ne sont pas membres, sans un appel REST par guilde.
        return isGlobalAdmin || oauthGuilds === null || oauthById.has(botGuild.id);
      });

      const resolved = await mapWithConcurrency(candidates, 8, async (botGuild) => {
        const oauthGuild = oauthById.get(botGuild.id);
        let permissions = BigInt(0);
        try {
          permissions = oauthGuild?.permissions ? BigInt(oauthGuild.permissions) : BigInt(0);
        } catch {
          permissions = BigInt(0);
        }

        if (isGlobalAdmin || hasDashboardAdminPermission(permissions)) {
          return { botGuild, accessLevel: 'admin' as const, owner: oauthGuild?.owner ?? botGuild.ownerId === user.userId };
        }

        // Repli lorsque Discord OAuth est momentanément indisponible : la
        // concurrence est bornée, contrairement à l'ancienne waterfall.
        if (!oauthGuilds) {
          const member = await botGuild.members.fetch(user.userId).catch(() => null);
          if (!member) return null;
          permissions = member.permissions.bitfield;
          if (hasDashboardAdminPermission(permissions)) {
            return { botGuild, accessLevel: 'admin' as const, owner: botGuild.ownerId === user.userId };
          }
        }

        try {
          const access = await resolveDashboardAccess(client, botGuild.id, user.userId, permissions);
          if (!access.canViewDashboard) return null;
          return {
            botGuild,
            accessLevel: access.level === 'admin' ? 'admin' as const : 'moderator' as const,
            owner: oauthGuild?.owner ?? botGuild.ownerId === user.userId,
          };
        } catch (err) {
          logger.warn('DashboardAPI', `Failed to resolve access for guild ${botGuild.id}:`, err);
          return null;
        }
      });

      // Droits de facturation, resolus en une requete pour toute la liste : la
      // page Facturation n est pas une page comme les autres, elle affiche un
      // montant debite et une adresse. Elle est ouverte aux administrateurs, a
      // celui qui paie (`billingOwnerId`, meme s il a perdu ses droits Discord)
      // et au reste du staff seulement si le serveur l a decide.
      const resolvedIds = resolved.filter((entry) => entry !== null).map((entry) => entry!.botGuild.id);
      const billingRows = resolvedIds.length
        ? await prisma.guild.findMany({
            where: { id: { in: resolvedIds } },
            select: { id: true, billingOwnerId: true, billingStaffAccess: true },
          })
        : [];
      const billingById = new Map(billingRows.map((row) => [row.id, row]));

      for (const entry of resolved) {
        if (!entry) continue;
        const { botGuild, accessLevel, owner } = entry;
        const billing = billingById.get(botGuild.id);
        accessibleGuildsList.push({
          id: botGuild.id,
          name: botGuild.name ?? botGuild.id,
          icon: botGuild.icon ?? null,
          owner,
          botPresent: true,
          accessLevel,
          isStaffServer: staffGuildToMain.has(botGuild.id),
          pairedGuildId: staffGuildToMain.get(botGuild.id) ?? mainGuildToStaff.get(botGuild.id) ?? null,
          billingAccess:
            accessLevel === 'admin' ||
            billing?.billingOwnerId === user.userId ||
            Boolean(billing?.billingStaffAccess),
        });
      }

      const payload = accessibleGuildsList.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'fr'));
      json(res, 200, { guilds: payload });
    } catch (err) {
      logger.error('API', 'Unexpected error in /api/user/guilds:', err);
      json(res, 500, { error: 'Une erreur interne est survenue' });
    }
    return true;
  }

  return false;
}
