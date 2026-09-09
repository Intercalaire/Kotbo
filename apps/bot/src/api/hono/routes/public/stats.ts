import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Client } from 'discord.js';
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { registerBotInstanceStats, cleanUpStaleStats } from '../../../../services/system/statsService.js';
import { isKotboPublicOrigin } from '../../../shared.js';

// Rate limiter for stats pings (memory-based)
const statsPingRateLimiter = new Map<string, number[]>();
const PING_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes
const PING_LIMIT_MAX = 5;

// ===========================================================================
// Schemas
// ===========================================================================

const BotPingPayloadSchema = z.object({
  botClientId: z.string().openapi({ description: 'Discord Client ID of the bot', example: '123456789012345678' }),
  botName: z.string().openapi({ description: 'Username / Display Name of the bot', example: 'Kotbo Bot' }),
  botAvatarUrl: z.string().nullable().openapi({ description: 'URL of the bot avatar', example: 'https://cdn.discordapp.com/avatars/...' }),
  dashboardUrl: z.string().nullable().openapi({ description: 'Custom dashboard URL if any', example: 'https://panel.kotbo.fr' }),
  guildCount: z.number().openapi({ description: 'Number of guilds the bot is on', example: 10 }),
  userCount: z.number().openapi({ description: 'Number of members managed by the bot', example: 500 }),
  version: z.string().nullable().openapi({ description: 'Codebase version of the bot', example: '1.0.0' }),
  isSelfHosted: z.boolean().openapi({ description: 'Whether this is a self-hosted instance', example: false }),
  machineFingerprint: z.string().min(1).max(128).optional().openapi({ description: 'Persistent per-installation identifier', example: 'a1b2c3d4-...' }),
});

const BotStatEntrySchema = z.object({
  botName: z.string(),
  botAvatarUrl: z.string().nullable(),
  dashboardUrl: z.string().nullable(),
  guildCount: z.number(),
  userCount: z.number(),
  isSelfHosted: z.boolean(),
});

const PublicServerStatsSchema = z.object({
  name: z.string(),
  iconUrl: z.string().nullable(),
  memberCount: z.number(),
  description: z.string().nullable(),
});

const StatsResponseSchema = z.object({
  totalGuilds: z.number(),
  totalUsers: z.number(),
  bots: z.array(BotStatEntrySchema),
  servers: z.array(PublicServerStatsSchema),
});

const FEATURED_GUILD_IDS = [
  '506029988680695818', // Minecraft Fr
  '913791560615854120', // Jojo
  '1386848639732809759', // Zenode
  '1477350874740424986'  // Les nerds
];

const GUILD_FALLBACKS: Record<string, { name: string; description: string; iconUrl: string; memberCount: number }> = {
  '506029988680695818': {
    name: "Communauté Minecraft Fr",
    description: "Le plus grand serveur communautaire Minecraft francophone. Survie, mini-jeux et entraide au quotidien.",
    iconUrl: "https://cdn.discordapp.com/icons/506029988680695818/6fbbb2b172d8677d849cee9c80485cf8.webp?size=128",
    memberCount: 7690,
  },
  '913791560615854120': {
    name: "Jojo - Communauté",
    description: "La communauté de Jojo est très accueillante ! Ici, vous pouvez discuter, échanger des idées ou même jouer ensemble.",
    iconUrl: "https://cdn.discordapp.com/icons/913791560615854120/051ac19a35c8692f2ae8889ffa1fe7bf.webp?size=128",
    memberCount: 4375,
  },
  '1386848639732809759': {
    name: "Zenode",
    description: "Zenode - Serveur de Développement De Bots et Serveurs Discord, entraide autour de Discord.",
    iconUrl: "https://cdn.discordapp.com/icons/1386848639732809759/e3e252b02264eb99b526afb1c8d93eb0.webp?size=128",
    memberCount: 1846,
  },
  '1477350874740424986': {
    name: "Les nerds",
    description: "Espace d'échange et d'entraide pour passionnés d'informatique, de programmation et de technologies.",
    iconUrl: "https://cdn.discordapp.com/icons/1477350874740424986/61bd3237903270c5db2581a313f6a701.webp?size=128",
    memberCount: 1109,
  }
};

// ===========================================================================
// Routes Definition
// ===========================================================================

const getStatsRoute = createRoute({
  method: 'get',
  path: '/api/public/stats',
  summary: 'Retrieve aggregated statistics and active bot instances',
  tags: ['PublicStats'],
  responses: {
    200: {
      description: 'Statistics successfully retrieved',
      content: {
        'application/json': { schema: StatsResponseSchema },
      },
    },
    403: {
      description: 'Access denied due to invalid origin or iframe context',
      content: {
        'application/json': { schema: z.object({ error: z.string() }) },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

const pingStatsRoute = createRoute({
  method: 'post',
  path: '/api/public/stats/ping',
  summary: 'Report statistics from a bot instance',
  tags: ['PublicStats'],
  request: {
    body: {
      content: {
        'application/json': { schema: BotPingPayloadSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Ping received and statistics updated. `banned` reflects an active admin ban on this botClientId or machineFingerprint.',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.boolean(),
            banned: z.boolean().optional(),
            mode: z.enum(['SHUTDOWN', 'DISABLE_FEATURES']).optional(),
            reason: z.string().nullable().optional(),
          }),
        },
      },
    },
    400: {
      description: 'Invalid payload',
      content: {
        'application/json': { schema: z.object({ error: z.string() }) },
      },
    },
    401: {
      description: 'Invalid or missing ping secret',
      content: {
        'application/json': { schema: z.object({ error: z.string() }) },
      },
    },
    429: {
      description: 'Too many pings',
      content: {
        'application/json': { schema: z.object({ error: z.string() }) },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

// ===========================================================================
// Router Factory
// ===========================================================================

export function createPublicStatsRouter(_client: Client) {
  const router = new OpenAPIHono();

  // GET /api/public/stats
  router.openapi(getStatsRoute, async (c) => {
    const origin = c.req.header('origin');
    const referer = c.req.header('referer');
    const secFetchSite = c.req.header('Sec-Fetch-Site');
    const secFetchDest = c.req.header('Sec-Fetch-Dest');

    // 1. Strict Origin & Referer Checks (landing kotbo.fr, dash.kotbo.fr, *.kotbo.fr, localhost)
    let isAllowed = false;

    if (origin) {
      isAllowed = isKotboPublicOrigin(origin);
    } else if (referer) {
      try {
        isAllowed = isKotboPublicOrigin(new URL(referer).origin);
      } catch {
        // Ignore invalid URL format in Referer header
      }
    }

    if (!isAllowed) {
      logger.warn('StatsAPI', `Rejected request due to invalid origin: ${origin || 'none'} (referer: ${referer || 'none'})`);
      return c.json({ error: 'Access forbidden: unauthorized origin' }, 403);
    }

    // 2. Iframe / Clickjacking Prevention
    // Reject direct loading in frame/iframe
    if (secFetchDest === 'iframe' || secFetchDest === 'frame') {
      logger.warn('StatsAPI', `Rejected request with Sec-Fetch-Dest = ${secFetchDest}`);
      return c.json({ error: 'Access forbidden: iframe context blocked' }, 403);
    }

    // Detect if nested in cross-origin iframe (Sec-Fetch-Site is downgraded to cross-site)
    if (secFetchSite === 'cross-site') {
      const isKotboOrigin = origin && isKotboPublicOrigin(origin);
      if (isKotboOrigin) {
        logger.warn('StatsAPI', 'Rejected request: same-site origin detected in cross-site context (iframe check)');
        return c.json({ error: 'Access forbidden: iframe nesting detected' }, 403);
      }
    }

    // Add security headers to prevent framing the response itself
    c.header('X-Frame-Options', 'DENY');
    c.header('Content-Security-Policy', "frame-ancestors 'none'");

    try {
      // Clean up stale stats (older than 48h) on request
      await cleanUpStaleStats().catch((err) => {
        logger.error('StatsAPI', 'Failed to clean up stale stats:', err);
      });

      // Retrieve all active bot stats
      const activeBots = await prisma.botInstanceStats.findMany({
        orderBy: { guildCount: 'desc' },
      });

      // Aggregate totals
      const totalGuilds = activeBots.reduce((sum, b) => sum + b.guildCount, 0);
      const totalUsers = activeBots.reduce((sum, b) => sum + b.userCount, 0);

      // Map to safe public structure
      const bots = activeBots.map((b) => ({
        botName: b.botName,
        botAvatarUrl: b.botAvatarUrl,
        dashboardUrl: b.dashboardUrl,
        guildCount: b.guildCount,
        userCount: b.userCount,
        isSelfHosted: b.isSelfHosted,
      }));

      // Retrieve dynamic server stats
      const servers = FEATURED_GUILD_IDS.map((id) => {
        const guild = _client.guilds.cache.get(id);
        const fallback = GUILD_FALLBACKS[id];
        if (guild) {
          return {
            name: guild.name,
            iconUrl: guild.iconURL({ size: 128 }) || fallback?.iconUrl || null,
            memberCount: guild.memberCount,
            description: guild.description || fallback?.description || "",
          };
        }
        return {
          name: fallback?.name || "Unknown Server",
          iconUrl: fallback?.iconUrl || null,
          memberCount: fallback?.memberCount || 0,
          description: fallback?.description || "",
        };
      });

      return c.json({
        totalGuilds,
        totalUsers,
        bots,
        servers,
      }, 200);
    } catch (err) {
      logger.error('StatsAPI', 'Error returning aggregated stats:', err);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // POST /api/public/stats/ping
  router.openapi(pingStatsRoute, async (c) => {
    // Shared-secret check: if the master has configured STATS_PING_SECRET,
    // require it. This only deters naive spoofing/spam of a public endpoint —
    // the check (and any documented default) lives in this open-source repo,
    // so it is not a cryptographic guarantee against a determined reader of
    // the source. If unset, behavior is unchanged (open, as before).
    const expectedSecret = process.env.STATS_PING_SECRET;
    if (expectedSecret && c.req.header('X-Kotbo-Ping-Secret') !== expectedSecret) {
      logger.warn('StatsAPI', 'Rejected ping due to invalid or missing ping secret');
      return c.json({ error: 'Invalid ping secret' }, 401);
    }

    // Apply IP-based rate limiting
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const now = Date.now();
    const timestamps = statsPingRateLimiter.get(ip) ?? [];
    const validTimestamps = timestamps.filter((t) => now - t < PING_LIMIT_WINDOW);

    if (validTimestamps.length >= PING_LIMIT_MAX) {
      logger.warn('StatsAPI', `Rate limit exceeded for IP: ${ip}`);
      return c.json({ error: 'Too many pings. Please wait before retrying.' }, 429);
    }

    validTimestamps.push(now);
    statsPingRateLimiter.set(ip, validTimestamps);

    // Clean up empty rate limiter entries occasionally
    if (Math.random() < 0.1) {
      for (const [key, list] of statsPingRateLimiter.entries()) {
        const active = list.filter((t) => now - t < PING_LIMIT_WINDOW);
        if (active.length === 0) {
          statsPingRateLimiter.delete(key);
        } else {
          statsPingRateLimiter.set(key, active);
        }
      }
    }

    try {
      const payload = c.req.valid('json');
      await registerBotInstanceStats(payload);

      const ban = await prisma.bannedInstance.findFirst({
        where: {
          unbannedAt: null,
          OR: [
            { botClientId: payload.botClientId },
            ...(payload.machineFingerprint ? [{ machineFingerprint: payload.machineFingerprint }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!ban) {
        return c.json({ ok: true, banned: false }, 200);
      }

      return c.json({
        ok: true,
        banned: true,
        mode: ban.mode as 'SHUTDOWN' | 'DISABLE_FEATURES',
        reason: ban.reason,
      }, 200);
    } catch (err) {
      logger.error('StatsAPI', 'Error storing stats ping:', err);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  return router;
}
