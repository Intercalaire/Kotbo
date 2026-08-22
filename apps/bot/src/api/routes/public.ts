import { IncomingMessage, ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { Client } from 'discord.js';
import { LinkedAccountStatus, Prisma } from '@prisma/client';
import { buildBettorStandings, computeBetNetGain, normalizeLevelCurve } from '@kotbo/shared';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { cache } from '../../utils/cache.js';
import { publicClansRateLimiter, publicClanSearchRateLimiter, publicGiveawaysRateLimiter } from '../limiters.js';
import {
  json,
  verifyAuth,
  getPublicProfileSnapshot,
  resolveProfileRoleDisplay,
  resolveDashboardAccess,
  readJsonBody,
  configRateLimiter,
  checkRateLimit,
  getClientIp,
  getMissingOAuthConfig,
  getDiscordClientId,
  getDashboardOrigin,
  getDashboardUrl,
} from '../shared.js';
import {
  isValidMcpGuildId,
  mcpAuthorizationServerMetadata,
  mcpProtectedResourceMetadata,
} from '../mcp/mcpServer.js';
import { generateRssXml } from '../../services/core/newsService.js';
import { isModuleEnabled } from '../../services/core/moduleGate.js';
import { handleFormTrigger } from '../../services/features/autoResponseService.js';
import { submitCustomForm } from '../../services/features/customFormService.js';
import { sanitizeCustomCss, sanitizeFormTheme } from '../../utils/formCustomization.js';
import { getMemberIdentities, resolveMemberAvatarUrl, resolveUserAvatarUrl } from '../../services/moderation/memberIdentityService.js';
import { getGuildLadder } from '../../services/progression/ranked/rankedConfigService.js';
import { getRankedLeaderboard } from '../../services/progression/ranked/rankedLeaderboardService.js';

const gzipAsync = promisify(gzip);

function mcpBaseFromResource(resource: string | null): string | null {
  if (!resource) return null;

  try {
    const parsed = new URL(resource);
    const standardMatch = parsed.pathname.match(/^\/api\/mcp\/(\d{15,20})\/?$/);
    if (standardMatch) {
      return `${parsed.protocol}//${parsed.host}/api/mcp/${standardMatch[1]}`;
    }

    const directMatch = parsed.pathname.match(/^\/api\/mcp-direct\/(\d{15,20})\/([^/?#]+)\/?$/);
    if (directMatch) {
      return `${parsed.protocol}//${parsed.host}/api/mcp-direct/${directMatch[1]}/${directMatch[2]}`;
    }

    return null;
  } catch {
    return null;
  }
}

function publicBase(req: IncomingMessage, url: URL): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ?? url.protocol.replace(':', '');
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? url.host;
  return `${proto}://${host}`;
}

function guildScopedMcpBase(req: IncomingMessage, url: URL, guildId: string): string {
  return `${publicBase(req, url)}/api/mcp/${guildId}`;
}

const publicFormLimiter = new Map<string, number[]>();
const PUBLIC_FORM_WINDOW_MS = 60_000;
const PUBLIC_FORM_MAX = 5;
const PUBLIC_FORM_MAX_IPS = 10_000;
let publicFormChecks = 0;

/** Gains attribués au clan entier, sans contributeur individuel. */
const CLAN_WIDE_USER_ID = 'system_manual_points';
/**
 * Giveaways terminés encore listés sur la page publique. Les concours en cours
 * sont tous envoyés : il y en a rarement plus d'une poignée, et en masquer un
 * priverait quelqu'un de sa seule chance d'y participer.
 */
const PUBLIC_GIVEAWAYS_ENDED_LIMIT = 30;
/**
 * Court : un compte à rebours et un compteur de participants qui bougent en
 * permanence supportent mal un cache long, mais une page très consultée ne doit
 * pas relire la base à chaque visiteur.
 */
const PUBLIC_GIVEAWAYS_CACHE_TTL_S = 15;
/** Tête de classement envoyée au chargement de la page publique des clans. */
const PUBLIC_CLANS_TOP_LIMIT = 25;
const PUBLIC_CLANS_CACHE_TTL_S = 30;
/** Bornes de la recherche publique, pour qu'une requête très large reste bon marché. */
const SEARCH_MATCH_LIMIT = 200;
const SEARCH_PARTICIPANT_LIMIT = 40;
const SEARCH_POINTLESS_LIMIT = 10;

function checkPublicFormRateLimit(req: IncomingMessage, res: ServerResponse): boolean {
  const ip = getClientIp(req);
  const now = Date.now();
  publicFormChecks++;
  if (publicFormChecks % 256 === 0 || publicFormLimiter.size >= PUBLIC_FORM_MAX_IPS) {
    for (const [key, values] of publicFormLimiter) {
      if (!values.some((timestamp) => now - timestamp < PUBLIC_FORM_WINDOW_MS)) {
        publicFormLimiter.delete(key);
      }
    }
    while (publicFormLimiter.size >= PUBLIC_FORM_MAX_IPS) {
      const oldest = publicFormLimiter.keys().next().value as string | undefined;
      if (!oldest) break;
      publicFormLimiter.delete(oldest);
    }
  }
  const timestamps = publicFormLimiter.get(ip) ?? [];
  const valid = timestamps.filter((t) => now - t < PUBLIC_FORM_WINDOW_MS);
  if (valid.length >= PUBLIC_FORM_MAX) {
    json(res, 429, { error: 'Trop de soumissions. Réessayez dans une minute.' });
    return false;
  }
  valid.push(now);
  publicFormLimiter.delete(ip);
  publicFormLimiter.set(ip, valid);
  return true;
}

/** Colonnes d'un giveaway nécessaires à sa restitution publique. */
interface PublicGiveawayRow {
  id: string;
  channelId: string;
  messageId: string | null;
  prize: string;
  description: string | null;
  winnerCount: number;
  endsAt: Date;
  ended: boolean;
  participants: string[];
  winners: string[];
  pendingWinners: string[];
  needValidation: boolean;
  validationStatus: string;
  rpgXp: number;
  rpgCoins: number;
  rpgItemId: string | null;
  createdById: string | null;
  createdAt: Date;
}

interface PublicIdentity {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Les quatre états que l'embed Discord distingue par sa couleur, repris tels
 * quels : la page et le message doivent raconter la même chose au même moment.
 * ACTIVE (blurple) → PENDING_VALIDATION (ambre) → VALIDATED (vert) / ENDED (rouge).
 */
function giveawayPublicStatus(giveaway: PublicGiveawayRow): 'ACTIVE' | 'PENDING_VALIDATION' | 'VALIDATED' | 'ENDED' {
  if (!giveaway.ended) return 'ACTIVE';
  if (giveaway.validationStatus === 'PENDING') return 'PENDING_VALIDATION';
  if (giveaway.needValidation) return 'VALIDATED';
  return 'ENDED';
}

/**
 * Pseudo et avatar affichables pour un lot d'identifiants Discord. Le membre en
 * cache prime sur le profil en base : il porte le pseudo de serveur et l'avatar
 * à jour.
 */
async function resolvePublicIdentities(
  client: Client,
  guildId: string,
  userIds: Array<string | null | undefined>
): Promise<Map<string, PublicIdentity>> {
  const unique = [...new Set(userIds.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();

  const profiles = await prisma.memberProfile.findMany({
    where: { guildId, userId: { in: unique } },
  });
  const profileMap = new Map(profiles.map((profile) => [profile.userId, profile]));
  const discordGuild = client.guilds.cache.get(guildId);

  return new Map(
    unique.map((userId) => {
      const profile = profileMap.get(userId);
      const member = discordGuild?.members.cache.get(userId);
      return [
        userId,
        {
          userId,
          displayName:
            member?.displayName || profile?.displayName || profile?.globalName || `Utilisateur ${userId}`,
          avatarUrl: resolveMemberAvatarUrl(member, 128) || profile?.avatarUrl || null,
        },
      ];
    })
  );
}

/**
 * Restitution publique d'un giveaway.
 *
 * La liste des participants n'est jamais exposée, seulement son total : l'embed
 * Discord n'en publie pas davantage, et un annuaire de tous les inscrits d'un
 * serveur n'a rien à faire sur une page ouverte à tous. Les gagnants tirés mais
 * pas encore validés, eux, sont déjà annoncés dans le salon par le bot : les
 * taire ici désynchroniserait la page du message.
 */
function serializePublicGiveaway(
  giveaway: PublicGiveawayRow,
  guildId: string,
  identities: Map<string, PublicIdentity>,
  rpgItemName: string | null
) {
  const status = giveawayPublicStatus(giveaway);
  const announced = status === 'PENDING_VALIDATION' ? giveaway.pendingWinners : giveaway.winners;

  return {
    id: giveaway.id,
    prize: giveaway.prize,
    description: giveaway.description,
    status,
    ended: giveaway.ended,
    needValidation: giveaway.needValidation,
    winnerCount: giveaway.winnerCount,
    participantCount: giveaway.participants.length,
    endsAt: giveaway.endsAt.toISOString(),
    createdAt: giveaway.createdAt.toISOString(),
    channelId: giveaway.channelId,
    messageUrl: giveaway.messageId
      ? `https://discord.com/channels/${guildId}/${giveaway.channelId}/${giveaway.messageId}`
      : null,
    creator: giveaway.createdById ? identities.get(giveaway.createdById) ?? null : null,
    winners: announced.map((userId) => identities.get(userId) ?? { userId, displayName: `Utilisateur ${userId}`, avatarUrl: null }),
    /** Les gagnants affichés attendent encore le feu vert d'un administrateur. */
    winnersPending: status === 'PENDING_VALIDATION',
    rewards: {
      xp: giveaway.rpgXp,
      coins: giveaway.rpgCoins,
      itemId: giveaway.rpgItemId,
      itemName: rpgItemName,
    },
  };
}

export async function handlePublicRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client
): Promise<boolean> {
  const method = req.method;

  // GET /health
  if (url.pathname === '/health' && method === 'GET') {
    json(res, 200, { ok: true, service: 'kotbo-dashboard-api' });
    return true;
  }

  // GET /.well-known/oauth-authorization-server
  // Also accept the OIDC alias because some OAuth clients probe it before RFC 8414.
  if ((url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration') && method === 'GET') {
    const resourceBase = mcpBaseFromResource(url.searchParams.get('resource') ?? url.searchParams.get('issuer'));
    if (resourceBase) {
      json(res, 200, mcpAuthorizationServerMetadata(resourceBase));
      return true;
    }

    const base = publicBase(req, url);
    json(res, 400, {
      error: 'guild_scoped_mcp_endpoint_required',
      error_description: 'Utilise l endpoint MCP complet du serveur Discord: /api/mcp/:guildId',
      endpoint_format: `${base}/api/mcp/:guildId`,
    });
    return true;
  }

  // GET /.well-known/oauth-protected-resource?resource=https://host/api/mcp/:guildId
  if (url.pathname === '/.well-known/oauth-protected-resource' && method === 'GET') {
    const resourceBase = mcpBaseFromResource(url.searchParams.get('resource'));
    if (!resourceBase) {
      json(res, 400, {
        error: 'guild_scoped_mcp_endpoint_required',
        error_description: 'Ajoute ?resource=https://host/api/mcp/:guildId ou utilise /.well-known/oauth-protected-resource/api/mcp/:guildId',
      });
      return true;
    }

    json(res, 200, mcpProtectedResourceMetadata(resourceBase));
    return true;
  }

  // RFC 9728 well-known form for an MCP resource at /api/mcp/:guildId.
  if (parts[0] === '.well-known' && parts[1] === 'oauth-protected-resource' && parts[2] === 'api' && parts[3] === 'mcp' && method === 'GET') {
    const guildId = parts[4];
    if (!guildId || !isValidMcpGuildId(guildId) || parts.length !== 5) {
      json(res, 400, { error: 'invalid_guild_id' });
      return true;
    }

    json(res, 200, mcpProtectedResourceMetadata(guildScopedMcpBase(req, url, guildId)));
    return true;
  }

  // RFC 8414 well-known form for an OAuth issuer at /api/mcp/:guildId.
  if (parts[0] === '.well-known' && parts[1] === 'oauth-authorization-server' && parts[2] === 'api' && parts[3] === 'mcp' && method === 'GET') {
    const guildId = parts[4];
    if (!guildId || !isValidMcpGuildId(guildId) || parts.length !== 5) {
      json(res, 400, { error: 'invalid_guild_id' });
      return true;
    }

    json(res, 200, mcpAuthorizationServerMetadata(guildScopedMcpBase(req, url, guildId)));
    return true;
  }

  if (parts[0] === '.well-known' && parts[1] === 'openid-configuration' && parts[2] === 'api' && parts[3] === 'mcp' && method === 'GET') {
    const guildId = parts[4];
    if (!guildId || !isValidMcpGuildId(guildId) || parts.length !== 5) {
      json(res, 400, { error: 'invalid_guild_id' });
      return true;
    }

    json(res, 200, mcpAuthorizationServerMetadata(guildScopedMcpBase(req, url, guildId)));
    return true;
  }

  // GET /api/config
  if (url.pathname === '/api/config' && method === 'GET') {
    const ip = getClientIp(req);
    if (!checkRateLimit(configRateLimiter, ip, 30, 60 * 1000)) {
      json(res, 429, { error: 'Trop de requêtes. Veuillez réessayer plus tard.' });
      return true;
    }

    const missingOAuth = getMissingOAuthConfig();
    if (missingOAuth.length > 0) {
      json(res, 500, {
        error: 'Configuration OAuth invalide côté serveur.',
        missing: missingOAuth,
      });
      return true;
    }

    json(res, 200, { discordClientId: getDiscordClientId() });
    return true;
  }

  // GET /api/branding - white-label branding info for the dashboard
  if (url.pathname === '/api/branding' && method === 'GET') {
    const { getCurrentInstance } = await import('../../utils/instanceContext.js');
    const inst = getCurrentInstance();
    json(res, 200, {
      instanceId: inst.id,
      slug: inst.slug,
      name: inst.brandName,
      color: inst.brandColor,
      logoUrl: inst.brandLogoUrl,
      faviconUrl: inst.brandFaviconUrl,
      footerText: inst.brandFooterText,
      isWhiteLabel: !inst.isDefault,
    });
    return true;
  }

  // Check if it's api/public
  if (parts[0] !== 'api' || parts[1] !== 'public') {
    return false;
  }

  // GET /api/public/profile/:userId
  if (parts[2] === 'profile' && parts[3] && !parts[4] && method === 'GET') {
    const userId = parts[3];
    if (!/^\d{17,19}$/.test(userId)) {
      json(res, 400, { error: 'ID utilisateur invalide' });
      return true;
    }
    try {
      let snapshot = await getPublicProfileSnapshot(userId);
      let profile = snapshot?.memberProfile;

      if (!snapshot || !profile) {
        const discordUser = await client.users.fetch(userId).catch(() => null);
        if (!discordUser) {
          json(res, 404, { error: 'Utilisateur introuvable' });
          return true;
        }

        const sharedGuild = client.guilds.cache.find(g => g.members.cache.has(userId));
        const fallbackGuildId = sharedGuild?.id || client.guilds.cache.first()?.id || '';

        profile = {
          id: `${fallbackGuildId}:${userId}`,
          guildId: fallbackGuildId,
          userId: userId,
          userTag: discordUser.tag,
          username: discordUser.username,
          globalName: discordUser.globalName || null,
          displayName: discordUser.globalName || discordUser.username,
          avatarUrl: resolveUserAvatarUrl(discordUser, 256),
          bannerUrl: null,
          accentColor: discordUser.accentColor || null,
          locale: null,
          isBot: discordUser.bot,
          bio: null,
          isProfilePrivate: false,
          accountCreatedAt: discordUser.createdAt,
          guildJoinedAt: null,
          guildLeftAt: null,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          lastMessageAt: null,
          lastMessageChannelId: null,
          messageCount: 0,
          voiceSessionCount: 0,
          voiceTimeSeconds: 0,
          voiceLastChannelId: null,
          voiceLastJoinedAt: null,
          voiceLastLeftAt: null,
          rolesSnapshot: [],
          isSuspectedDC: false,
          moderatorNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        snapshot = {
          memberProfile: profile,
          invite: null,
          eventParticipations: [],
          dailyAlgoProfile: null,
          dailyAlgoParticipations: [],
        };
      }

      const roleDisplay = await resolveProfileRoleDisplay(client, profile.guildId, profile.rolesSnapshot);
      const authUser = await verifyAuth(req);
      const viewerGuildAccess = authUser
        ? await resolveDashboardAccess(client, profile.guildId, authUser.userId).catch(() => null)
        : null;
      const canViewPrivate = !profile.isProfilePrivate || authUser?.userId === userId || !!viewerGuildAccess?.level && viewerGuildAccess.level !== 'none';

      const response = canViewPrivate
        ? {
            userId: profile.userId,
            username: profile.username,
            globalName: profile.globalName,
            displayName: profile.displayName || profile.globalName || profile.username,
            avatar: profile.avatarUrl,
            banner: profile.bannerUrl,
            bio: profile.bio,
            isPrivate: profile.isProfilePrivate,
            roles: roleDisplay.roles,
            primaryRole: roleDisplay.primaryRole,
            accountCreatedAt: profile.accountCreatedAt,
            guildJoinedAt: profile.guildJoinedAt,
            guildLeftAt: profile.guildLeftAt,
            lastSeenAt: profile.lastSeenAt,
            messageCount: profile.messageCount,
            voiceTimeSeconds: profile.voiceTimeSeconds,
            invite: snapshot.invite,
            points: snapshot.dailyAlgoProfile?.totalPoints || 0,
            tier: snapshot.dailyAlgoProfile?.tier || 'Débutant',
            streak: snapshot.dailyAlgoProfile?.currentStreak || 0,
            rank: snapshot.dailyAlgoProfile ? snapshot.dailyAlgoProfile.rank - 1 : 0,
            recentAlgos: snapshot.dailyAlgoParticipations.map((entry) => ({
              title: entry.problemTitle,
              date: entry.submittedAt ? entry.submittedAt.toISOString() : new Date().toISOString(),
              status: entry.status,
              points: entry.totalPoints,
            })),
            eventParticipations: snapshot.eventParticipations.map((entry) => ({
              id: entry.id,
              eventId: entry.eventId,
              title: entry.eventTitle,
              type: entry.eventType,
              date: entry.createdAt.toISOString(),
              score: entry.score,
            })),
          }
        : {
            userId: profile.userId,
            username: profile.username,
            globalName: profile.globalName,
            displayName: profile.displayName || profile.globalName || profile.username,
            avatar: profile.avatarUrl,
            banner: profile.bannerUrl,
            bio: null,
            isPrivate: true,
            roles: roleDisplay.roles,
            primaryRole: roleDisplay.primaryRole,
            accountCreatedAt: null,
            guildJoinedAt: null,
            guildLeftAt: profile.guildLeftAt,
            lastSeenAt: null,
            messageCount: null,
            voiceTimeSeconds: null,
            invite: null,
            points: 0,
            tier: 'Débutant',
            streak: 0,
            rank: 0,
            recentAlgos: [],
            eventParticipations: [],
          };

      json(res, 200, response);
    } catch (err) {
      logger.error('PublicAPI', `Error fetching public profile for ${userId}:`, err);
      json(res, 500, { error: 'Erreur interne du serveur' });
    }
    return true;
  }

  // PATCH /api/public/profile/:userId
  if (parts[2] === 'profile' && parts[3] && !parts[4] && method === 'PATCH') {
    const userId = parts[3];
    if (!/^\d{17,19}$/.test(userId)) {
      json(res, 400, { error: 'ID utilisateur invalide' });
      return true;
    }
    const authUser = await verifyAuth(req);
    if (!authUser) {
      json(res, 401, { error: 'Non authentifié' });
      return true;
    }

    try {
      const snapshot = await getPublicProfileSnapshot(userId);
      if (!snapshot) {
        json(res, 404, { error: 'Profil introuvable' });
        return true;
      }

      if (authUser.userId !== userId) {
        json(res, 403, { error: 'Seul le propriétaire du profil peut le modifier' });
        return true;
      }

      const body = await readJsonBody<{ bio?: string | null; isProfilePrivate?: boolean }>(req);
      const updatedProfile = await prisma.memberProfile.update({
        where: { id: snapshot.memberProfile.id },
        data: {
          bio: typeof body?.bio === 'string' ? body.bio.trim() : body?.bio === null ? null : snapshot.memberProfile.bio,
          isProfilePrivate: typeof body?.isProfilePrivate === 'boolean'
            ? body.isProfilePrivate
            : snapshot.memberProfile.isProfilePrivate,
        },
      });

      json(res, 200, {
        ok: true,
        profile: {
          bio: updatedProfile.bio,
          isProfilePrivate: updatedProfile.isProfilePrivate,
        },
      });
    } catch (err) {
      logger.error('PublicAPI', `Error updating public profile for ${userId}:`, err);
      json(res, 500, { error: 'Erreur lors de la mise à jour du profil' });
    }
    return true;
  }

  // GET /api/public/profile/:userId/activity-image
  if (parts[2] === 'profile' && parts[3] && parts[4] === 'activity-image' && method === 'GET') {
    const userId = parts[3];
    if (!/^\d{17,19}$/.test(userId)) {
      json(res, 400, { error: 'ID utilisateur invalide' });
      return true;
    }
    const days = parseInt(url.searchParams.get('days') || '14', 10);
    try {
      const since = new Date();
      since.setDate(since.getDate() - days + 1);
      const startKey = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;

      const stats = await prisma.memberDailyStat.findMany({
        where: { userId, dateKey: { gte: startKey } },
        orderBy: { dateKey: 'asc' },
      });

      const map: Record<string, { messages: number; voice: number }> = Object.create(null);
      for (const s of stats) {
        if (!map[s.dateKey]) map[s.dateKey] = { messages: 0, voice: 0 };
        map[s.dateKey].messages += s.messagesCount;
        map[s.dateKey].voice += s.voiceMinutes;
      }

      const dailyData = Object.keys(map)
        .sort()
        .map((date) => ({ date, messages: map[date].messages, voice: map[date].voice }));

      const totalMessages = dailyData.reduce((a, b) => a + b.messages, 0);
      const totalVoice = dailyData.reduce((a, b) => a + b.voice, 0);
      const activeDays = dailyData.length;
      const peakDayMessages = dailyData.reduce((a, b) => Math.max(a, b.messages), 0);

      const { generateMemberStatsImage } = await import('../../services/core/imageService.js');
      const buffer = await generateMemberStatsImage(userId, days, { totalMessages, totalVoice, activeDays, peakDayMessages }, dailyData);

      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
      res.end(buffer);
    } catch (err) {
      logger.error('PublicAPI', `Error generating activity image for ${parts[3]}:`, err);
      json(res, 500, { error: 'Erreur lors de la génération du graphique' });
    }
    return true;
  }

  // GET /api/public/rss/:guildId
  if (parts[2] === 'rss' && parts[3] && method === 'GET') {
    const guildId = parts[3];
    if (!/^\d{17,19}$/.test(guildId)) {
      json(res, 400, { error: 'ID de guilde invalide' });
      return true;
    }
    const category = parts[4] ? decodeURIComponent(parts[4]) : url.searchParams.get('category');
    const subcategory = parts[5] ? decodeURIComponent(parts[5]) : url.searchParams.get('subcategory');
    
    try {
      const guild = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { id: true }
      });
      if (!guild) {
        json(res, 404, { error: 'Guilde introuvable' });
        return true;
      }

      const whereClause: Prisma.NewsArticleWhereInput = { guildId, published: true };
      if (category) {
        whereClause.category = { equals: category, mode: 'insensitive' };
      }
      if (subcategory) {
        whereClause.subcategory = { equals: subcategory, mode: 'insensitive' };
      }

      const articles = await prisma.newsArticle.findMany({
        where: whereClause,
        orderBy: { publishedAt: 'desc' }
      });

      const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      const guildName = discordGuild?.name ?? `Serveur ${guildId}`;
      const dashboardUrl = getDashboardUrl();
      const apiUrl = process.env.VITE_API_URL || '';

      const rssXml = generateRssXml(guildName, guildId, dashboardUrl, apiUrl, articles, category, subcategory);

      res.writeHead(200, {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      });
      res.end(rssXml);
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error('PublicAPI', `Error generating RSS for guild ${guildId}: ${errMessage}`);
      json(res, 500, { error: 'Erreur lors de la génération du flux RSS' });
    }
    return true;
  }

  // GET /api/public/guilds/:guildId/news
  if (parts[2] === 'guilds' && parts[3] && parts[4] === 'news' && method === 'GET') {
    const guildId = parts[3];
    if (!/^\d{17,19}$/.test(guildId)) {
      json(res, 400, { error: 'ID de guilde invalide' });
      return true;
    }

    try {
      const guild = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { id: true },
      });

      if (!guild) {
        json(res, 404, { error: 'Guilde introuvable' });
        return true;
      }

      const articles = await prisma.newsArticle.findMany({
        where: { guildId, published: true },
        orderBy: { publishedAt: 'desc' },
      });

      json(res, 200, articles);
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error('PublicAPI', `Error listing public news for guild ${guildId}: ${errMessage}`);
      json(res, 500, { error: 'Erreur lors de la récupération des actualités publiques' });
    }
    return true;
  }

  // GET /api/public/guilds/:guildId/leveling
  if (parts[2] === 'guilds' && parts[3] && parts[4] === 'leveling' && !parts[5] && method === 'GET') {
    const guildId = parts[3];
    if (!/^\d{17,19}$/.test(guildId)) {
      json(res, 400, { error: 'ID de guilde invalide' });
      return true;
    }

    try {
      const config = await prisma.levelConfig.findUnique({
        where: { guildId },
      });

      if (!config || !config.enabled) {
        json(res, 200, { enabled: false, levels: [], guildName: 'Kotbo Server' });
        return true;
      }

      const levels = await prisma.memberLevel.findMany({
        where: { guildId },
        orderBy: { xp: 'desc' },
      });

      // Charger les profils de membres de la base de données
      const userIds = levels.map(l => l.userId);
      const dbProfiles = await prisma.memberProfile.findMany({
        where: {
          guildId,
          userId: { in: userIds }
        }
      });
      const profileMap = new Map(dbProfiles.map(p => [p.userId, p]));

      // Charger les membres depuis le cache du serveur Discord si présent
      const discordGuild = client.guilds.cache.get(guildId);

      const levelsWithUserData = levels.map(l => {
        const profile = profileMap.get(l.userId);
        const discordMember = discordGuild?.members.cache.get(l.userId);

        const username = discordMember?.user?.username || profile?.username || null;
        const displayName = discordMember?.displayName || profile?.displayName || profile?.globalName || `Utilisateur ${l.userId}`;
        const avatarUrl = resolveMemberAvatarUrl(discordMember, 128) || profile?.avatarUrl || null;

        return {
          userId: l.userId,
          xp: l.xp,
          level: l.level,
          username,
          displayName,
          avatarUrl
        };
      });

      json(res, 200, {
        enabled: true,
        guildName: discordGuild?.name || 'Kotbo Server',
        guildIcon: discordGuild?.iconURL({ size: 128 }) || null,
        // La courbe voyage avec le classement : la page publique en dérive les
        // paliers, elle afficherait sinon la progression d'une autre guilde.
        curve: normalizeLevelCurve({
          baseXp: config.curveBaseXp,
          linearXp: config.curveLinearXp,
          exponent: config.curveExponent,
          maxLevel: config.maxLevel,
        }),
        levels: levelsWithUserData
      });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error('PublicAPI', `Error fetching public leveling for guild ${guildId}: ${errMessage}`);
      json(res, 500, { error: 'Erreur lors du chargement du classement de leveling' });
    }
    return true;
  }

  // GET /api/public/guilds/:guildId/ranked - classement RP public
  if (parts[2] === 'guilds' && parts[3] && parts[4] === 'ranked' && !parts[5] && method === 'GET') {
    const guildId = parts[3];
    if (!/^\d{17,19}$/.test(guildId)) {
      json(res, 400, { error: 'ID de guilde invalide' });
      return true;
    }

    try {
      const config = await prisma.rankedConfig.findUnique({ where: { guildId } });

      // Un module éteint répond « désactivé » plutôt qu'une erreur : le lien a
      // pu être partagé avant, il doit rester lisible.
      if (!config?.enabled) {
        json(res, 200, { enabled: false, entries: [], guildName: 'Kotbo Server' });
        return true;
      }

      const ladder = await getGuildLadder(guildId);
      const rows = await getRankedLeaderboard(guildId, 100);
      const identities = await getMemberIdentities(client, guildId, rows.map((row) => row.userId))
        .catch(() => new Map());
      const discordGuild = client.guilds.cache.get(guildId);

      json(res, 200, {
        enabled: true,
        guildName: discordGuild?.name || 'Kotbo Server',
        guildIcon: discordGuild?.iconURL({ size: 128 }) || null,
        // L'échelle voyage avec le classement : la page publique en dérive les
        // paliers, elle afficherait sinon ceux d'une autre guilde.
        ladder,
        entries: rows.map((row) => ({
          ...row,
          displayName: identities.get(row.userId)?.displayName ?? null,
          avatarUrl: identities.get(row.userId)?.avatarUrl || null,
        })),
      });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error('PublicAPI', `Error fetching public ranked for guild ${guildId}: ${errMessage}`);
      json(res, 500, { error: 'Erreur lors du chargement du classement de prestige' });
    }
    return true;
  }

  // GET /api/public/guilds/:guildId/giveaways
  if (parts[2] === 'guilds' && parts[3] && parts[4] === 'giveaways' && !parts[5] && method === 'GET') {
    const guildId = parts[3];
    if (!/^\d{17,19}$/.test(guildId)) {
      json(res, 400, { error: 'ID de guilde invalide' });
      return true;
    }

    if (!checkRateLimit(publicGiveawaysRateLimiter, getClientIp(req), 90, 60_000)) {
      json(res, 429, { error: 'Trop de requêtes. Veuillez réessayer plus tard.' });
      return true;
    }

    const cacheKey = `guild:${guildId}:public-giveaways`;
    const cachedPayload = await cache.get<unknown>(cacheKey);
    if (cachedPayload) {
      res.setHeader('Cache-Control', `public, max-age=${PUBLIC_GIVEAWAYS_CACHE_TTL_S}`);
      json(res, 200, cachedPayload);
      return true;
    }

    try {
      const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      const guildIdentity = {
        guildName: discordGuild?.name || 'Kotbo Server',
        guildIcon: discordGuild?.iconURL({ size: 128 }) || null,
      };

      // Le module éteint ferme la page : laisser les concours visibles ferait
      // participer des gens à un tirage que le bot ne clôturera plus.
      if (!(await isModuleEnabled(guildId, 'giveaways'))) {
        json(res, 200, { enabled: false, ...guildIdentity, giveaways: [] });
        return true;
      }

      const [active, ended] = await Promise.all([
        prisma.giveaway.findMany({
          where: { guildId, ended: false },
          orderBy: { endsAt: 'asc' },
        }),
        prisma.giveaway.findMany({
          where: { guildId, ended: true },
          orderBy: { endsAt: 'desc' },
          take: PUBLIC_GIVEAWAYS_ENDED_LIMIT,
        }),
      ]);

      const rows = [...active, ...ended] as PublicGiveawayRow[];
      const identities = await resolvePublicIdentities(client, guildId, [
        ...rows.map((row) => row.createdById),
        ...rows.flatMap((row) => (giveawayPublicStatus(row) === 'PENDING_VALIDATION' ? row.pendingWinners : row.winners)),
      ]);

      const payload = {
        enabled: true,
        ...guildIdentity,
        // Le nom de l'objet RPG demande une lecture par giveaway : il n'a
        // d'intérêt que sur la fiche détaillée, la liste s'en tient à l'ID.
        giveaways: rows.map((row) => serializePublicGiveaway(row, guildId, identities, null)),
      };

      await cache.set(cacheKey, payload, PUBLIC_GIVEAWAYS_CACHE_TTL_S);
      res.setHeader('Cache-Control', `public, max-age=${PUBLIC_GIVEAWAYS_CACHE_TTL_S}`);
      json(res, 200, payload);
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error('PublicAPI', `Error fetching public giveaways for guild ${guildId}: ${errMessage}`);
      json(res, 500, { error: 'Erreur lors du chargement des giveaways' });
    }
    return true;
  }

  // GET /api/public/guilds/:guildId/giveaways/:giveawayId
  if (parts[2] === 'guilds' && parts[3] && parts[4] === 'giveaways' && parts[5] && !parts[6] && method === 'GET') {
    const guildId = parts[3];
    const giveawayId = parts[5];
    if (!/^\d{17,19}$/.test(guildId)) {
      json(res, 400, { error: 'ID de guilde invalide' });
      return true;
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(giveawayId)) {
      json(res, 400, { error: 'ID de giveaway invalide' });
      return true;
    }

    if (!checkRateLimit(publicGiveawaysRateLimiter, getClientIp(req), 90, 60_000)) {
      json(res, 429, { error: 'Trop de requêtes. Veuillez réessayer plus tard.' });
      return true;
    }

    const cacheKey = `guild:${guildId}:public-giveaway:${giveawayId}`;
    const cachedPayload = await cache.get<unknown>(cacheKey);
    if (cachedPayload) {
      res.setHeader('Cache-Control', `public, max-age=${PUBLIC_GIVEAWAYS_CACHE_TTL_S}`);
      json(res, 200, cachedPayload);
      return true;
    }

    try {
      const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      const guildIdentity = {
        guildName: discordGuild?.name || 'Kotbo Server',
        guildIcon: discordGuild?.iconURL({ size: 128 }) || null,
      };

      if (!(await isModuleEnabled(guildId, 'giveaways'))) {
        json(res, 200, { enabled: false, ...guildIdentity, giveaway: null });
        return true;
      }

      // Le filtre sur `guildId` est ce qui empêche de lire, depuis l'adresse
      // d'un serveur, le giveaway d'un autre.
      const giveaway = await prisma.giveaway.findFirst({
        where: { id: giveawayId, guildId },
      }) as PublicGiveawayRow | null;

      if (!giveaway) {
        json(res, 404, { error: 'Giveaway introuvable sur ce serveur' });
        return true;
      }

      const status = giveawayPublicStatus(giveaway);
      const identities = await resolvePublicIdentities(client, guildId, [
        giveaway.createdById,
        ...(status === 'PENDING_VALIDATION' ? giveaway.pendingWinners : giveaway.winners),
      ]);

      const rpgItem = giveaway.rpgItemId
        ? await prisma.rpgItem.findUnique({ where: { id: giveaway.rpgItemId }, select: { name: true } }).catch(() => null)
        : null;

      const channel = discordGuild?.channels.cache.get(giveaway.channelId);

      const payload = {
        enabled: true,
        ...guildIdentity,
        giveaway: {
          ...serializePublicGiveaway(giveaway, guildId, identities, rpgItem?.name ?? null),
          channelName: channel?.name ?? null,
        },
      };

      await cache.set(cacheKey, payload, PUBLIC_GIVEAWAYS_CACHE_TTL_S);
      res.setHeader('Cache-Control', `public, max-age=${PUBLIC_GIVEAWAYS_CACHE_TTL_S}`);
      json(res, 200, payload);
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error('PublicAPI', `Error fetching public giveaway ${giveawayId} for guild ${guildId}: ${errMessage}`);
      json(res, 500, { error: 'Erreur lors du chargement du giveaway' });
    }
    return true;
  }

  // GET /api/public/transcripts/:transcriptId/access - délivre un lien signé aux ayants droit
  // (staff du serveur OU participant du ticket associé), sans exiger d'accès au dashboard.
  if (parts[2] === 'transcripts' && parts[3] && parts[4] === 'access' && !parts[5] && method === 'GET') {
    const transcriptId = parts[3];
    if (!/^[a-zA-Z0-9_-]+$/.test(transcriptId)) {
      json(res, 400, { error: 'ID de transcription invalide' });
      return true;
    }

    const auth = await verifyAuth(req);
    if (!auth) {
      json(res, 401, { error: 'Vous devez vous connecter avec Discord pour voir cette transcription.' });
      return true;
    }

    try {
      const transcript = await prisma.transcript.findUnique({
        where: { id: transcriptId },
        select: { id: true, guildId: true },
      });
      if (!transcript) {
        json(res, 404, { error: 'Transcription introuvable' });
        return true;
      }

      // Le staff du serveur voit toutes les transcriptions.
      const access = await resolveDashboardAccess(client, transcript.guildId, auth.userId).catch(() => null);
      let authorized = !!access?.canViewDashboard;

      // Sinon, un participant du ticket associé (ouvreur / staff ayant claim / staff ayant fermé).
      if (!authorized) {
        const ticket = await prisma.ticket.findFirst({
          where: { transcriptId, guildId: transcript.guildId },
          select: { userId: true, claimedById: true, closedById: true },
        });
        if (
          ticket &&
          (ticket.userId === auth.userId ||
            ticket.claimedById === auth.userId ||
            ticket.closedById === auth.userId)
        ) {
          authorized = true;
        }
      }

      if (!authorized) {
        json(res, 403, { error: "Vous n'avez pas accès à cette transcription." });
        return true;
      }

      const { generateTranscriptSignature } = await import('@kotbo/core');
      const { expires, signature } = generateTranscriptSignature(transcriptId, 3600);
      json(res, 200, { signedUrl: `/api/public/transcripts/${transcriptId}?expires=${expires}&sig=${signature}` });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error('PublicAPI', `Error issuing transcript access for ${transcriptId}: ${errMessage}`);
      json(res, 500, { error: 'Erreur interne du serveur' });
    }
    return true;
  }

  // GET /api/public/guilds/:guildId/clans
  if (parts[2] === 'guilds' && parts[3] && parts[4] === 'clans' && !parts[5] && method === 'GET') {
    const guildId = parts[3];
    if (!/^\d{17,19}$/.test(guildId)) {
      json(res, 400, { error: 'ID de guilde invalide' });
      return true;
    }

    if (!checkRateLimit(publicClansRateLimiter, getClientIp(req), 60, 60_000)) {
      json(res, 429, { error: 'Trop de requêtes. Veuillez réessayer plus tard.' });
      return true;
    }

    // La réponse est identique pour tous les visiteurs : un cache court suffit
    // à ce qu'une page très consultée ne coûte qu'une lecture par intervalle.
    // Le préfixe `guild:<id>:` est celui qu'invalide toute écriture du dashboard,
    // donc une action d'admin est répercutée sans attendre l'expiration.
    const cacheKey = `guild:${guildId}:public-clans`;
    const cachedPayload = await cache.get<unknown>(cacheKey);
    if (cachedPayload) {
      res.setHeader('Cache-Control', `public, max-age=${PUBLIC_CLANS_CACHE_TTL_S}`);
      json(res, 200, cachedPayload);
      return true;
    }

    try {
      const guildConfig = await prisma.guild.findUnique({
        where: { id: guildId },
        select: {
          clansEnabled: true,
          currentClanSeason: true,
          clanSeasonStartsAt: true,
          clanSeasonEndsAt: true,
          betsEnabled: true,
          betAllowDebt: true,
        },
      });

      const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);

      if (!guildConfig?.clansEnabled) {
        json(res, 200, {
          enabled: false,
          guildName: discordGuild?.name || 'Kotbo Server',
          guildIcon: discordGuild?.iconURL({ size: 128 }) || null,
          clans: [],
        });
        return true;
      }

      const clans = await prisma.clan.findMany({
        where: { guildId },
        orderBy: { name: 'asc' },
      });

      // Charger toutes les contributions pour la saison en cours
      const contributions = await prisma.clanMemberContribution.findMany({
        where: {
          guildId,
          season: guildConfig.currentClanSeason,
        },
        orderBy: { xp: 'desc' },
      });

      // Charger les profils utilisateur impliqués pour récupérer noms et avatars
      const userIds = [...new Set(contributions.map((c) => c.userId))];
      const dbProfiles = await prisma.memberProfile.findMany({
        where: {
          guildId,
          userId: { in: userIds },
        },
      });
      const profileMap = new Map(dbProfiles.map((p) => [p.userId, p]));

      // Associer les contributions avec les données utilisateur
      const clansData = clans.map((clan) => {
        const role = discordGuild?.roles.cache.get(clan.roleId);
        const memberCount = role?.members.size ?? 0;

        const clanContributions = contributions.filter((c) => c.clanId === clan.id);
        const totalXp = clanContributions.reduce((sum, c) => sum + c.xp, 0);

        // Seule la tête du classement est envoyée : chercher quelqu'un de plus
        // bas passe par /clans/search, qui calcule son rang côté serveur. Servir
        // le classement entier ferait grossir la page avec le nombre de joueurs.
        //
        // Les points attribués au clan entier sont stockés sous un pseudo-membre :
        // ils comptent dans le total du clan mais ne sont pas un participant, et
        // les laisser ici décalerait le rang de tout le monde. Une ligne à zéro
        // (retrait manuel de tout son score) n'est pas non plus un participant.
        //
        // Les ex æquo partagent le même rang, comme dans /clans/search qui le
        // déduit d'un comptage : sans ça, quelqu'un se verrait 5e ici et 4e en
        // se cherchant.
        let rank = 0;
        let previousXp: number | null = null;

        const topParticipants = clanContributions
          .filter((c) => c.userId !== CLAN_WIDE_USER_ID && c.xp > 0)
          .slice(0, PUBLIC_CLANS_TOP_LIMIT)
          .map((c, i) => {
            const profile = profileMap.get(c.userId);
            const discordMember = discordGuild?.members.cache.get(c.userId);

            const displayName = discordMember?.displayName || profile?.displayName || profile?.globalName || `Utilisateur ${c.userId}`;
            const avatarUrl = resolveMemberAvatarUrl(discordMember, 128) || profile?.avatarUrl || null;

            if (c.xp !== previousXp) rank = i + 1;
            previousXp = c.xp;

            return {
              userId: c.userId,
              rank,
              xp: c.xp,
              displayName,
              avatarUrl,
            };
          });

        return {
          id: clan.id,
          name: clan.name,
          description: clan.description,
          roleId: clan.roleId,
          roleColor: role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : null,
          totalXp,
          memberCount,
          topParticipants,
        };
      });

      // ─── Flux « derniers scores » : gains de points les plus récents ──────────
      // Non-bloquant : un souci sur ce flux (ex. migration pas encore appliquée)
      // ne doit jamais empêcher l'affichage du classement principal.
      let recentScores: Array<Record<string, unknown>> = [];
      try {
        const recentEvents = await prisma.clanContributionEvent.findMany({
          where: { guildId, season: guildConfig.currentClanSeason },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });

        const clanById = new Map(clans.map((c) => [c.id, c]));

        // Compléter la table des profils avec les auteurs des événements récents
        const eventUserIds = [...new Set(
          recentEvents
            .map((e) => e.userId)
            .filter((id) => id && id !== 'system_manual_points' && !profileMap.has(id))
        )];
        if (eventUserIds.length > 0) {
          const extraProfiles = await prisma.memberProfile.findMany({
            where: { guildId, userId: { in: eventUserIds } },
          });
          for (const p of extraProfiles) profileMap.set(p.userId, p);
        }

        recentScores = recentEvents.map((e) => {
          const clan = clanById.get(e.clanId);
          const role = clan ? discordGuild?.roles.cache.get(clan.roleId) : null;
          const isClanGlobal = e.userId === 'system_manual_points';

          let displayName: string;
          let avatarUrl: string | null = null;
          if (isClanGlobal) {
            // Gain attribué au clan entier : on affiche le nom du clan
            displayName = clan?.name || 'Clan';
          } else {
            const profile = profileMap.get(e.userId);
            const discordMember = discordGuild?.members.cache.get(e.userId);
            displayName = discordMember?.displayName || profile?.displayName || profile?.globalName || `Utilisateur ${e.userId}`;
            avatarUrl = resolveMemberAvatarUrl(discordMember, 128) || profile?.avatarUrl || null;
          }

          return {
            id: e.id,
            amount: e.amount,
            source: e.source, // 'XP' | 'ADMIN'
            isClan: isClanGlobal,
            userId: isClanGlobal ? null : e.userId,
            displayName,
            avatarUrl,
            clanName: clan?.name || null,
            clanColor: role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : null,
            createdAt: e.createdAt.toISOString(),
          };
        });
      } catch (scoreErr: unknown) {
        const m = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
        logger.warn('PublicAPI', `Flux « derniers scores » indisponible pour ${guildId} (migration appliquée ?) : ${m}`);
        recentScores = [];
      }

      // ── Paris de la saison : historique public et palmarès ────────────────
      //
      // Absents tant que le module est éteint : les tables sont alors vides par
      // construction, et afficher des sections vides promettrait une
      // fonctionnalité que le serveur n'a pas ouverte.
      let recentBets: Array<Record<string, unknown>> = [];
      let bettors: Array<Record<string, unknown>> = [];
      if (guildConfig.betsEnabled) {
        try {
          // Le palmarès agrège toute la saison, l'historique n'en montre que la
          // tête. Le plafond protège d'un serveur qui aurait laissé filer des
          // dizaines de milliers de paris : au-delà, le classement reste juste
          // sur ce qu'il a lu, et personne ne remontera si loin.
          const seasonBets = await prisma.clanBet.findMany({
            where: { guildId, season: guildConfig.currentClanSeason, status: 'RESOLVED' },
            orderBy: { resolvedAt: 'desc' },
            take: 5_000,
          });

          const betUserIds = [...new Set(
            seasonBets.flatMap((bet) => [bet.challengerId, bet.opponentId]).filter((id) => !profileMap.has(id)),
          )];
          if (betUserIds.length > 0) {
            const betProfiles = await prisma.memberProfile.findMany({
              where: { guildId, userId: { in: betUserIds } },
            });
            for (const profile of betProfiles) profileMap.set(profile.userId, profile);
          }

          const nameOf = (userId: string) => {
            const profile = profileMap.get(userId);
            const discordMember = discordGuild?.members.cache.get(userId);
            return {
              displayName: discordMember?.displayName || profile?.displayName || profile?.globalName || `Utilisateur ${userId}`,
              avatarUrl: resolveMemberAvatarUrl(discordMember, 128) || profile?.avatarUrl || null,
            };
          };

          const clanNameById = new Map(clans.map((clan) => [clan.id, clan.name]));

          recentBets = seasonBets.slice(0, 20).map((bet) => {
            const winnerSide = bet.winnerId === bet.challengerId ? 'challenger' : 'opponent';
            const loserId = winnerSide === 'challenger' ? bet.opponentId : bet.challengerId;
            const winnerClanId = winnerSide === 'challenger' ? bet.challengerClanId : bet.opponentClanId;
            const loserClanId = winnerSide === 'challenger' ? bet.opponentClanId : bet.challengerClanId;
            return {
              id: bet.id,
              subject: bet.subject,
              stake: bet.stake,
              // Le gain net, jamais le pot : le gagnant n'a fait que récupérer
              // sa propre mise en plus de celle qu'il a prise.
              netGain: computeBetNetGain(bet, winnerSide),
              creditUsed: bet.challengerDebt + bet.opponentDebt,
              winnerId: bet.winnerId,
              winner: bet.winnerId ? nameOf(bet.winnerId) : null,
              winnerClanName: winnerClanId ? clanNameById.get(winnerClanId) ?? null : null,
              loserId,
              loser: nameOf(loserId),
              loserClanName: loserClanId ? clanNameById.get(loserClanId) ?? null : null,
              resolvedAt: bet.resolvedAt?.toISOString() ?? bet.updatedAt.toISOString(),
            };
          });

          // Un membre qui parie depuis son compte principal et depuis son double
          // compte apparaîtrait deux fois au palmarès, avec ses victoires et sa
          // série coupées en deux. Les liens validés du serveur sont repliés sur
          // un identifiant unique - le plus petit, comme partout ailleurs dans le
          // bot - en une seule requête, quel que soit le nombre de parieurs.
          const links = await prisma.linkedAccount.findMany({
            where: { guildId, status: LinkedAccountStatus.VALIDATED },
            select: { user1Id: true, user2Id: true },
          });
          const parents = new Map<string, string>();
          const rootOf = (id: string): string => {
            const parent = parents.get(id);
            if (!parent || parent === id) return id;
            const root = rootOf(parent);
            parents.set(id, root);
            return root;
          };
          for (const link of links) {
            const a = rootOf(link.user1Id);
            const b = rootOf(link.user2Id);
            if (a === b) continue;
            parents.set(a < b ? b : a, a < b ? a : b);
          }

          bettors = buildBettorStandings(
            seasonBets
              .filter((bet) => bet.winnerId !== null)
              .map((bet) => ({
                challengerId: rootOf(bet.challengerId),
                opponentId: rootOf(bet.opponentId),
                winnerId: rootOf(bet.winnerId as string),
                challengerEscrow: bet.challengerEscrow,
                opponentEscrow: bet.opponentEscrow,
                challengerDebt: bet.challengerDebt,
                opponentDebt: bet.opponentDebt,
                resolvedAt: bet.resolvedAt ?? bet.updatedAt,
              })),
          ).slice(0, 10).map((standing) => ({ ...standing, ...nameOf(standing.userId) }));
        } catch (betErr: unknown) {
          const message = betErr instanceof Error ? betErr.message : String(betErr);
          logger.warn('PublicAPI', `Paris de clan indisponibles pour ${guildId} (migration appliquée ?) : ${message}`);
          recentBets = [];
          bettors = [];
        }
      }

      // Onglet « Dettes » : ouvert seulement si le serveur a réellement ouvert le
      // crédit. Ailleurs, la table est vide par construction et l'onglet
      // n'afficherait qu'une promesse de fonctionnalité.
      let debtsPayload: Record<string, unknown> | null = null;
      if (guildConfig.betsEnabled && guildConfig.betAllowDebt) {
        try {
          const debtRows = await prisma.clanPointDebt.findMany({
            where: { guildId, amount: { gt: 0 } },
            orderBy: { amount: 'desc' },
            take: 200,
          });

          if (debtRows.length > 0) {
            // La dette n'est pas rattachée à un clan : elle suit le membre, qui
            // peut en changer. Le clan affiché est donc celui qu'il porte
            // aujourd'hui, lu sur les rôles Discord.
            const clanByUserId = new Map<string, (typeof clans)[number]>();
            for (const clan of clans) {
              const role = discordGuild?.roles.cache.get(clan.roleId);
              for (const memberId of role?.members.keys() ?? []) clanByUserId.set(memberId, clan);
            }

            const debtorIds = debtRows.map((row) => row.userId).filter((id) => !profileMap.has(id));
            if (debtorIds.length > 0) {
              const debtorProfiles = await prisma.memberProfile.findMany({
                where: { guildId, userId: { in: debtorIds } },
              });
              for (const profile of debtorProfiles) profileMap.set(profile.userId, profile);
            }

            const debtors = debtRows.map((row) => {
              const clan = clanByUserId.get(row.userId) ?? null;
              const role = clan ? discordGuild?.roles.cache.get(clan.roleId) : null;
              const profile = profileMap.get(row.userId);
              const discordMember = discordGuild?.members.cache.get(row.userId);

              return {
                userId: row.userId,
                displayName: discordMember?.displayName || profile?.displayName || profile?.globalName || `Utilisateur ${row.userId}`,
                avatarUrl: resolveMemberAvatarUrl(discordMember, 128) || profile?.avatarUrl || null,
                amount: row.amount,
                clanId: clan?.id ?? null,
                clanName: clan?.name ?? null,
                clanColor: role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : null,
                since: row.createdAt.toISOString(),
              };
            });

            const byClan = clans.map((clan) => {
              const members = debtors.filter((debtor) => debtor.clanId === clan.id);
              const role = discordGuild?.roles.cache.get(clan.roleId);
              return {
                id: clan.id,
                name: clan.name,
                roleColor: role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : null,
                totalDebt: members.reduce((sum, debtor) => sum + debtor.amount, 0),
                debtorCount: members.length,
                debtors: members.slice(0, 10),
              };
            }).sort((a, b) => b.totalDebt - a.totalDebt);

            debtsPayload = {
              total: debtors.reduce((sum, debtor) => sum + debtor.amount, 0),
              debtorCount: debtors.length,
              // Membres sans clan : leur dette existe mais n'est rattachée à
              // aucune colonne, elle serait invisible sans cette liste.
              unaffiliated: debtors.filter((debtor) => !debtor.clanId).slice(0, 10),
              top: debtors.slice(0, 10),
              clans: byClan,
            };
          } else {
            debtsPayload = { total: 0, debtorCount: 0, unaffiliated: [], top: [], clans: [] };
          }
        } catch (debtErr: unknown) {
          const message = debtErr instanceof Error ? debtErr.message : String(debtErr);
          logger.warn('PublicAPI', `Dettes de clan indisponibles pour ${guildId} (migration appliquée ?) : ${message}`);
          debtsPayload = null;
        }
      }

      const payload = {
        enabled: true,
        betsEnabled: guildConfig.betsEnabled,
        recentBets,
        bettors,
        debtsEnabled: debtsPayload !== null,
        debts: debtsPayload,
        currentClanSeason: guildConfig.currentClanSeason,
        clanSeasonStartsAt: guildConfig.clanSeasonStartsAt?.toISOString() ?? null,
        clanSeasonEndsAt: guildConfig.clanSeasonEndsAt?.toISOString() ?? null,
        guildName: discordGuild?.name || 'Kotbo Server',
        guildIcon: discordGuild?.iconURL({ size: 128 }) || null,
        clans: clansData,
        recentScores,
      };

      await cache.set(cacheKey, payload, PUBLIC_CLANS_CACHE_TTL_S);
      res.setHeader('Cache-Control', `public, max-age=${PUBLIC_CLANS_CACHE_TTL_S}`);
      json(res, 200, payload);
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error('PublicAPI', `Error fetching public clans for guild ${guildId}: ${errMessage}`);
      json(res, 500, { error: 'Erreur lors du chargement du classement de clans' });
    }
    return true;
  }

  // GET /api/public/guilds/:guildId/clans/search?q=...
  //
  // Recherche dédiée : le chargement de la page ne contient que la tête de
  // chaque classement et les 20 derniers gains. Ici on retrouve n'importe quel
  // participant, aussi bas soit-il, avec son rang réel et son historique de la
  // saison. Le rang ne demande pas de dérouler le classement : il se déduit du
  // nombre de contributions du même clan ayant plus de points.
  if (parts[2] === 'guilds' && parts[3] && parts[4] === 'clans' && parts[5] === 'search' && !parts[6] && method === 'GET') {
    const guildId = parts[3];
    if (!/^\d{17,19}$/.test(guildId)) {
      json(res, 400, { error: 'ID de guilde invalide' });
      return true;
    }

    if (!checkRateLimit(publicClanSearchRateLimiter, getClientIp(req), 30, 60_000)) {
      json(res, 429, { error: 'Trop de recherches. Veuillez réessayer dans une minute.' });
      return true;
    }

    const query = (url.searchParams.get('q') || '').trim();
    const empty = { participants: [], scores: [], matchCounts: {} };
    if (query.length < 2) {
      json(res, 200, empty);
      return true;
    }

    try {
      const guildConfig = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { clansEnabled: true, currentClanSeason: true },
      });
      if (!guildConfig?.clansEnabled) {
        json(res, 200, empty);
        return true;
      }

      const season = guildConfig.currentClanSeason;
      const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      const normalized = query.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
      const matches = (value: string | null | undefined) =>
        !!value && value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(normalized);

      const userIds = new Set<string>();
      if (/^\d{17,19}$/.test(query)) userIds.add(query);

      // Les pseudos affichés viennent surtout du cache Discord ; la table des
      // profils sert de repli pour les membres absents du cache.
      if (discordGuild) {
        for (const member of discordGuild.members.cache.values()) {
          if (userIds.size >= SEARCH_MATCH_LIMIT) break;
          if (matches(member.displayName) || matches(member.user?.username)) userIds.add(member.id);
        }
      }
      if (userIds.size < SEARCH_MATCH_LIMIT) {
        const profileMatches = await prisma.memberProfile.findMany({
          where: {
            guildId,
            OR: [
              { displayName: { contains: query, mode: Prisma.QueryMode.insensitive } },
              { globalName: { contains: query, mode: Prisma.QueryMode.insensitive } },
            ],
          },
          take: SEARCH_MATCH_LIMIT,
        });
        for (const p of profileMatches) userIds.add(p.userId);
      }

      const clans = await prisma.clan.findMany({ where: { guildId } });
      const clanById = new Map(clans.map((c) => [c.id, c]));
      const matchingClanIds = clans.filter((c) => matches(c.name)).map((c) => c.id);

      if (userIds.size === 0 && matchingClanIds.length === 0) {
        json(res, 200, empty);
        return true;
      }

      const matchedUserIds = [...userIds].slice(0, SEARCH_MATCH_LIMIT);
      const clanColor = (clan: { roleId: string } | undefined) => {
        const role = clan ? discordGuild?.roles.cache.get(clan.roleId) : null;
        return role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : null;
      };

      // ─── Participants trouvés, avec leur rang ────────────────────────────────
      let participants: Array<Record<string, unknown>> = [];
      let matchCountByClanId = new Map<string, number>();

      if (matchedUserIds.length > 0) {
        const [rows, counts] = await Promise.all([
          prisma.clanMemberContribution.findMany({
            where: { guildId, season, userId: { in: matchedUserIds } },
            orderBy: { xp: 'desc' },
            take: SEARCH_PARTICIPANT_LIMIT,
          }),
          prisma.clanMemberContribution.groupBy({
            by: ['clanId'],
            where: { guildId, season, userId: { in: matchedUserIds } },
            _count: { _all: true },
          }),
        ]);

        matchCountByClanId = new Map(counts.map((c) => [c.clanId, c._count._all]));

        const ranked = await Promise.all(
          rows.map(async (row) => {
            // Le pseudo-membre des points de clan n'occupe pas de place au
            // classement : il ne doit pas décaler le rang affiché.
            const ahead = await prisma.clanMemberContribution.count({
              where: {
                guildId,
                season,
                clanId: row.clanId,
                xp: { gt: row.xp },
                userId: { not: CLAN_WIDE_USER_ID },
              },
            });
            return { row, rank: ahead + 1 };
          })
        );

        const rowProfiles = await prisma.memberProfile.findMany({
          where: { guildId, userId: { in: rows.map((r) => r.userId) } },
        });
        const rowProfileMap = new Map(rowProfiles.map((p) => [p.userId, p]));

        participants = ranked.map(({ row, rank }) => {
          const clan = clanById.get(row.clanId);
          const profile = rowProfileMap.get(row.userId);
          const discordMember = discordGuild?.members.cache.get(row.userId);

          return {
            userId: row.userId,
            clanId: row.clanId,
            clanName: clan?.name ?? null,
            clanColor: clanColor(clan),
            rank,
            xp: row.xp,
            displayName: discordMember?.displayName || profile?.displayName || profile?.globalName || `Utilisateur ${row.userId}`,
            avatarUrl: resolveMemberAvatarUrl(discordMember, 128) || profile?.avatarUrl || null,
          };
        });

        // Membre trouvé, dans un clan, mais sans le moindre point : il n'a pas de
        // rang. L'omettre laisserait croire que la recherche n'a rien donné.
        const scoredUserIds = new Set(rows.map((r) => r.userId));
        const pointless = matchedUserIds.filter((id) => !scoredUserIds.has(id) && id !== CLAN_WIDE_USER_ID);
        for (const userId of pointless.slice(0, SEARCH_POINTLESS_LIMIT)) {
          const discordMember = discordGuild?.members.cache.get(userId);
          const clan = discordMember ? clans.find((c) => discordMember.roles.cache.has(c.roleId)) : undefined;
          if (!clan) continue; // Sans clan, il n'a rien à faire dans un classement de clans.

          participants.push({
            userId,
            clanId: clan.id,
            clanName: clan.name,
            clanColor: clanColor(clan),
            rank: null,
            xp: 0,
            displayName: discordMember?.displayName || `Utilisateur ${userId}`,
            avatarUrl: resolveMemberAvatarUrl(discordMember, 128) ?? null,
          });
        }
      }

      // ─── Historique des gains des personnes trouvées ─────────────────────────
      const orConditions: Prisma.ClanContributionEventWhereInput[] = [];
      if (matchedUserIds.length > 0) orConditions.push({ userId: { in: matchedUserIds } });
      if (matchingClanIds.length > 0) {
        orConditions.push({ clanId: { in: matchingClanIds }, userId: CLAN_WIDE_USER_ID });
      }

      const events = await prisma.clanContributionEvent.findMany({
        where: { guildId, season, OR: orConditions },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const eventProfiles = await prisma.memberProfile.findMany({
        where: { guildId, userId: { in: [...new Set(events.map((e) => e.userId))] } },
      });
      const profileMap = new Map(eventProfiles.map((p) => [p.userId, p]));

      const scores = events.map((e) => {
        const clan = clanById.get(e.clanId);
        const isClanGlobal = e.userId === CLAN_WIDE_USER_ID;

        let displayName: string;
        let avatarUrl: string | null = null;
        if (isClanGlobal) {
          displayName = clan?.name || 'Clan';
        } else {
          const profile = profileMap.get(e.userId);
          const discordMember = discordGuild?.members.cache.get(e.userId);
          displayName = discordMember?.displayName || profile?.displayName || profile?.globalName || `Utilisateur ${e.userId}`;
          avatarUrl = resolveMemberAvatarUrl(discordMember, 128) || profile?.avatarUrl || null;
        }

        return {
          id: e.id,
          amount: e.amount,
          source: e.source,
          isClan: isClanGlobal,
          userId: isClanGlobal ? null : e.userId,
          displayName,
          avatarUrl,
          clanName: clan?.name || null,
          clanColor: clanColor(clan),
          createdAt: e.createdAt.toISOString(),
        };
      });

      json(res, 200, {
        participants,
        scores,
        matchCounts: Object.fromEntries(matchCountByClanId),
      });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.warn('PublicAPI', `Recherche de clans indisponible pour ${guildId} : ${errMessage}`);
      json(res, 200, empty);
    }
    return true;
  }

  // GET /api/public/transcripts/:transcriptId?expires=...&sig=...
  if (parts[2] === 'transcripts' && parts[3] && !parts[4] && method === 'GET') {
    const transcriptId = parts[3];
    if (!/^[a-zA-Z0-9_-]+$/.test(transcriptId)) {
      json(res, 400, { error: 'ID de transcription invalide' });
      return true;
    }

    // Vérifier la signature HMAC et l'expiration
    const sig = url.searchParams.get('sig');
    const expires = url.searchParams.get('expires');
    if (!sig || !expires) {
      json(res, 403, { error: 'Lien invalide - signature manquante. Demandez un nouveau lien depuis le dashboard.' });
      return true;
    }

    const { verifyTranscriptSignature } = await import('@kotbo/core');
    if (!verifyTranscriptSignature(transcriptId, expires, sig)) {
      json(res, 403, { error: 'Lien invalide ou expiré. Demandez un nouveau lien depuis le dashboard.' });
      return true;
    }

    const etag = `"transcript-${transcriptId}"`;
    const maxAge = Math.max(0, Math.min(3600, parseInt(expires, 10) - Math.floor(Date.now() / 1000)));
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', `private, max-age=${maxAge}`);
      res.end();
      return true;
    }

    try {
      const transcript = await prisma.transcript.findUnique({
        where: { id: transcriptId },
        select: { html: true },
      });

      if (!transcript) {
        json(res, 404, { error: 'Transcription introuvable' });
        return true;
      }

      res.removeHeader('X-Frame-Options');
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'none'",
          "style-src 'unsafe-inline'",
          'img-src https: data:',
          'media-src https:',
          `frame-ancestors ${getDashboardOrigin()} http://localhost:5173 http://localhost:3000`,
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; ')
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', `private, max-age=${maxAge}`);
      res.setHeader('ETag', etag);
      res.statusCode = 200;

      // Les transcriptions peuvent contenir plusieurs Mo de HTML. La
      // compression générique du pont HTTP ne concernait que le JSON ; on
      // compresse ici de façon asynchrone pour ne pas bloquer l'event loop.
      if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
        const compressed = await gzipAsync(Buffer.from(transcript.html));
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', String(compressed.byteLength));
        res.setHeader('Vary', 'Accept-Encoding');
        res.end(compressed);
      } else {
        res.end(transcript.html);
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error('PublicAPI', `Error fetching public transcript ${transcriptId}: ${errMessage}`);
      json(res, 500, { error: 'Erreur interne du serveur' });
    }
    return true;
  }

  // GET /api/public/sanction-evidence/:fileId?expires=...&sig=...
  if (parts[2] === 'sanction-evidence' && parts[3] && method === 'GET') {
    const fileId = parts[3];
    if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
      json(res, 400, { error: 'ID de fichier invalide' });
      return true;
    }

    const sig = url.searchParams.get('sig');
    const expires = url.searchParams.get('expires');
    if (!sig || !expires) {
      json(res, 403, { error: 'Lien invalide - signature ou expiration manquante.' });
      return true;
    }

    const { verifyEvidenceFileSignature } = await import('@kotbo/core');
    if (!verifyEvidenceFileSignature(fileId, expires, sig)) {
      json(res, 403, { error: 'Lien de preuve invalide ou expiré.' });
      return true;
    }

    try {
      const file = await prisma.sanctionEvidenceFile.findUnique({
        where: { id: fileId }
      });

      if (!file) {
        json(res, 404, { error: 'Fichier de preuve introuvable.' });
        return true;
      }

      res.removeHeader('X-Frame-Options');
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'none'",
          "style-src 'unsafe-inline'",
          'img-src https: data:',
          'media-src https:',
          `frame-ancestors ${getDashboardOrigin()} http://localhost:5173 http://localhost:3000`,
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; ')
      );
      res.setHeader('Content-Type', file.mimeType);
      const safeFilename = file.fileName.replace(/[^\x20-\x7E]/g, '_');
      res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
      res.statusCode = 200;
      res.end(file.data);
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error('PublicAPI', `Error fetching public evidence file ${fileId}: ${errMessage}`);
      json(res, 500, { error: 'Erreur interne du serveur' });
    }
    return true;
  }

  // GET /api/public/forms/:formId - Get form structure (no auth)
  if (parts[2] === 'forms' && parts[3] && !parts[4] && method === 'GET') {
    const formId = parts[3];
    try {
      const form = await prisma.recruitmentForm.findFirst({
        where: { id: formId, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          structure: true,
          guildId: true,
        },
      });

      if (form) {
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
        json(res, 200, {
          id: form.id,
          name: form.name,
          description: form.description,
          structure: form.structure,
          guildId: form.guildId,
          formType: 'recruitment',
          // Les formulaires de recrutement (legacy) exigent systématiquement une connexion Discord.
          requiresDiscordAuth: true,
        });
        return true;
      }

      // Un identifiant public ne contient pas son type. Résoudre les deux
      // familles dans cet endpoint supprime un second aller-retour HTTP.
      const customForm = await prisma.customForm.findFirst({
        where: { id: formId, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          structure: true,
          guildId: true,
          isRecruitment: true,
          requiresDiscordAuth: true,
          theme: true,
          customCss: true,
        },
      });

      if (!customForm) {
        json(res, 404, { error: 'Formulaire introuvable ou inactif' });
        return true;
      }

      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
      json(res, 200, {
        id: customForm.id,
        name: customForm.name,
        description: customForm.description,
        structure: customForm.structure,
        guildId: customForm.guildId,
        formType: 'custom',
        theme: sanitizeFormTheme(customForm.theme),
        customCss: sanitizeCustomCss(customForm.customCss),
        requiresDiscordAuth: Boolean(customForm.isRecruitment || customForm.requiresDiscordAuth),
      });
    } catch (err) {
      logger.error('PublicAPI', `Error fetching public form ${parts[3]}:`, err);
      json(res, 500, { error: 'Erreur lors du chargement du formulaire' });
    }
    return true;
  }

  // POST /api/public/forms/:formId/submit - Submit a form response (no auth, rate limited)
  if (parts[2] === 'forms' && parts[3] && parts[4] === 'submit' && method === 'POST') {
    if (!checkPublicFormRateLimit(req, res)) return true;
    const formId = parts[3];
    try {
      const form = await prisma.recruitmentForm.findFirst({
        where: { id: formId, isActive: true },
      });

      if (!form) {
        json(res, 404, { error: 'Formulaire introuvable ou inactif' });
        return true;
      }

      // Les formulaires de recrutement exigent systématiquement une connexion Discord.
      const auth = await verifyAuth(req);
      if (!auth) {
        json(res, 401, { error: 'Vous devez vous connecter avec Discord pour soumettre ce formulaire.' });
        return true;
      }

      const body = await readJsonBody<{
        data: Record<string, unknown>;
        discordId?: string;
        email?: string;
        username?: string;
      }>(req);

      if (!body?.data || typeof body.data !== 'object') {
        json(res, 400, { error: 'Les données de réponse sont requises' });
        return true;
      }

      body.discordId = auth.userId;
      body.username = auth.username || body.username;

      const [candidature] = await prisma.$transaction([
        prisma.recruitmentCandidature.create({
          data: {
            guildId: form.guildId,
            formId: form.id,
            discordId: body.discordId || null,
            email: body.email || null,
            username: body.username || null,
            data: body.data as Prisma.JsonObject,
            status: 'PENDING',
          },
        }),
        prisma.recruitmentForm.update({
          where: { id: formId },
          data: { submissionsCount: { increment: 1 } },
        }),
      ]);

      // La sauvegarde est terminée : rendre la main immédiatement au navigateur.
      json(res, 201, { ok: true, id: candidature.id });

      queueMicrotask(() => {
        void (async () => {
          try {
            const guildConfig = await prisma.guild.findUnique({
              where: { id: form.guildId },
              select: { recruitmentLogChannelId: true },
            });
            if (guildConfig?.recruitmentLogChannelId) {
              const discordGuild = client.guilds.cache.get(form.guildId)
                || await client.guilds.fetch(form.guildId).catch(() => null);
              const channel = discordGuild?.channels.cache.get(guildConfig.recruitmentLogChannelId);
              if (channel?.isSendable()) {
                await channel.send({
                  embeds: [{
                    title: '📋 Nouvelle candidature reçue',
                    description: `Formulaire: **${form.name}**\n\nDiscord: ${body.discordId ? `<@${body.discordId}>` : 'Non renseigné'}\nEmail: ${body.email || 'Non renseigné'}`,
                    color: 0x6366f1,
                    timestamp: new Date().toISOString(),
                    footer: { text: `Candidature ID: ${candidature.id}` },
                  }],
                });
              }
            }
          } catch (notifErr) {
            logger.warn('PublicAPI', 'Could not send Discord notification for form submission:', notifErr);
          }

          if (body.discordId) {
            await handleFormTrigger(form.guildId, body.discordId, formId, body.data as Record<string, string>, client).catch((err) => {
              logger.error('PublicAPI', `Error executing form trigger for submission ${candidature.id}:`, err);
            });
          }
        })();
      });
      logger.success('PublicAPI', `Form submission for ${formId} from ${body.discordId || 'unknown'}`);
    } catch (err) {
      logger.error('PublicAPI', `Error submitting form ${parts[3]}:`, err);
      json(res, 500, { error: 'Erreur lors de la soumission du formulaire' });
    }
    return true;
  }

  // GET /api/public/custom-forms/:formId - Get custom form structure (no auth)
  if (parts[2] === 'custom-forms' && parts[3] && !parts[4] && method === 'GET') {
    const formId = parts[3];
    try {
      const form = await prisma.customForm.findFirst({
        where: { id: formId, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          structure: true,
          guildId: true,
          isRecruitment: true,
          requiresDiscordAuth: true,
          theme: true,
          customCss: true,
        },
      });

      if (!form) {
        json(res, 404, { error: 'Formulaire introuvable ou inactif' });
        return true;
      }

      // Défense en profondeur : le CSS est déjà sanitizé à la sauvegarde,
      // on le repasse au sanitizer avant de le servir.
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
      json(res, 200, {
        id: form.id,
        name: form.name,
        description: form.description,
        structure: form.structure,
        guildId: form.guildId,
        theme: sanitizeFormTheme(form.theme),
        customCss: sanitizeCustomCss(form.customCss),
        // Un formulaire de recrutement exige systématiquement la connexion Discord.
        requiresDiscordAuth: Boolean(form.isRecruitment || form.requiresDiscordAuth),
      });
    } catch (err) {
      logger.error('PublicAPI', `Error fetching public custom form ${parts[3]}:`, err);
      json(res, 500, { error: 'Erreur lors du chargement du formulaire' });
    }
    return true;
  }

  // POST /api/public/custom-forms/:formId/submit - Submit custom form response (no auth, rate limited)
  if (parts[2] === 'custom-forms' && parts[3] && parts[4] === 'submit' && method === 'POST') {
    if (!checkPublicFormRateLimit(req, res)) return true;
    const formId = parts[3];
    try {
      const form = await prisma.customForm.findFirst({
        where: { id: formId, isActive: true },
      });

      if (!form) {
        json(res, 404, { error: 'Formulaire introuvable ou inactif' });
        return true;
      }

      const authRequired = Boolean(form.isRecruitment || form.requiresDiscordAuth);
      const auth = await verifyAuth(req);
      if (authRequired && !auth) {
        json(res, 401, { error: 'Vous devez vous connecter avec Discord pour soumettre ce formulaire.' });
        return true;
      }

      const body = await readJsonBody<{
        data: Record<string, string>;
        discordId?: string;
        email?: string;
        username?: string;
        userTag?: string;
      }>(req);

      if (!body?.data || typeof body.data !== 'object') {
        json(res, 400, { error: 'Les données de réponse sont requises' });
        return true;
      }

      const submission = await submitCustomForm(
        formId,
        form.guildId,
        auth?.userId || body.discordId || '',
        auth?.username || body.username || undefined,
        body.userTag || undefined,
        body.data,
        client
      );

      json(res, 201, { ok: true, id: submission.id });
    } catch (err) {
      logger.error('PublicAPI', `Error submitting custom form ${parts[3]}:`, err);
      json(res, 500, { error: 'Erreur lors de la soumission du formulaire' });
    }
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // APPELS DE BANNISSEMENT (page publique type appeals.gg)
  // ══════════════════════════════════════════════════════════════════════════

  // GET /api/public/appeal/:guildId - Config + formulaire + état du visiteur connecté
  if (parts[2] === 'appeal' && parts[3] && !parts[4] && method === 'GET') {
    const guildId = parts[3];
    if (!/^\d{15,20}$/.test(guildId)) {
      json(res, 400, { error: 'Identifiant de serveur invalide' });
      return true;
    }
    try {
      const {
        getAppealConfig,
        getAppealEligibility,
      } = await import('../../services/moderation/banAppealService.js');
      const config = await getAppealConfig(guildId);
      if (!config?.enabled) {
        json(res, 404, { error: "Ce serveur n'accepte pas les demandes de débannissement" });
        return true;
      }

      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        json(res, 404, { error: 'Serveur introuvable' });
        return true;
      }

      // État du visiteur si connecté via Discord OAuth
      let viewer: Record<string, unknown> | null = null;
      const auth = await verifyAuth(req);
      if (auth) {
        const eligibility = await getAppealEligibility(client, guildId, auth.userId);
        const latestAppeal = await prisma.banAppeal.findFirst({
          where: { guildId, userId: auth.userId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, status: true, createdAt: true, decidedAt: true,
            decisionReason: true, infoRequest: true, infoResponse: true,
            messages: true,
          },
        });
        viewer = { userId: auth.userId, username: auth.username, eligibility, latestAppeal };
      }

      json(res, 200, {
        guildId,
        guildName: guild.name,
        guildIcon: guild.iconURL({ size: 256 }),
        welcomeText: config.welcomeText || null,
        cooldownDays: config.cooldownDays,
        form: config.form
          ? {
              id: config.form.id,
              structure: config.form.structure,
              theme: sanitizeFormTheme(config.form.theme),
              customCss: sanitizeCustomCss(config.form.customCss),
            }
          : null,
        viewer,
      });
    } catch (err) {
      logger.error('PublicAPI', `Error fetching appeal config for guild ${guildId}:`, err);
      json(res, 500, { error: 'Erreur lors du chargement de la page d\'appel' });
    }
    return true;
  }

  // POST /api/public/appeal/:guildId/submit - Soumettre un appel (OAuth obligatoire, rate limited)
  if (parts[2] === 'appeal' && parts[3] && parts[4] === 'submit' && method === 'POST') {
    if (!checkPublicFormRateLimit(req, res)) return true;
    const guildId = parts[3];
    if (!/^\d{15,20}$/.test(guildId)) {
      json(res, 400, { error: 'Identifiant de serveur invalide' });
      return true;
    }
    try {
      const auth = await verifyAuth(req);
      if (!auth) {
        json(res, 401, { error: 'Vous devez vous connecter avec Discord pour soumettre un appel.' });
        return true;
      }

      const { getAppealConfig, submitAppeal } = await import('../../services/moderation/banAppealService.js');
      const config = await getAppealConfig(guildId);
      if (!config?.enabled) {
        json(res, 404, { error: "Ce serveur n'accepte pas les demandes de débannissement" });
        return true;
      }

      const body = await readJsonBody<{ data: Record<string, unknown> }>(req);
      if (!body?.data || typeof body.data !== 'object') {
        json(res, 400, { error: 'Les réponses du formulaire sont requises' });
        return true;
      }

      const result = await submitAppeal(client, guildId, {
        id: auth.userId,
        tag: auth.username,
        avatar: auth.avatar ?? null,
      }, body.data);

      if (!result.ok) {
        const messages: Record<string, string> = {
          not_banned: "Ce compte Discord n'est pas banni de ce serveur.",
          blacklisted: 'Tu ne peux plus soumettre de demande de débannissement pour ce serveur.',
          active_appeal: 'Tu as déjà une demande en cours de traitement.',
          cooldown: 'Ta dernière demande a été refusée récemment, tu dois attendre avant de réessayer.',
        };
        json(res, 403, { error: messages[result.blockedBy] || 'Soumission impossible', blockedBy: result.blockedBy });
        return true;
      }

      json(res, 201, { ok: true, id: result.appeal.id });
    } catch (err) {
      logger.error('PublicAPI', `Error submitting appeal for guild ${guildId}:`, err);
      json(res, 500, { error: "Erreur lors de la soumission de l'appel" });
    }
    return true;
  }

  // POST /api/public/appeal/:guildId/info-response - Répondre à une demande d'infos du staff
  if (parts[2] === 'appeal' && parts[3] && parts[4] === 'info-response' && method === 'POST') {
    if (!checkPublicFormRateLimit(req, res)) return true;
    const guildId = parts[3];
    try {
      const auth = await verifyAuth(req);
      if (!auth) {
        json(res, 401, { error: 'Vous devez vous connecter avec Discord.' });
        return true;
      }

      const body = await readJsonBody<{ response: string }>(req);
      if (!body?.response || typeof body.response !== 'string' || !body.response.trim()) {
        json(res, 400, { error: 'La réponse est requise' });
        return true;
      }

      const { submitAppealInfoResponse } = await import('../../services/moderation/banAppealService.js');
      const result = await submitAppealInfoResponse(client, guildId, auth.userId, body.response.trim());
      if (!result.ok) {
        json(res, 404, { error: result.error });
        return true;
      }
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('PublicAPI', `Error submitting appeal info response for guild ${guildId}:`, err);
      json(res, 500, { error: 'Erreur lors de l\'envoi de la réponse' });
    }
    return true;
  }

  return false;
}
