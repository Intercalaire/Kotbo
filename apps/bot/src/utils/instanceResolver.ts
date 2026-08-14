import prisma from './db.js';
import { logger } from './logger.js';
import crypto from 'node:crypto';

export interface ResolvedInstance {
  id: string;
  slug: string;
  name: string;
  discordToken: string;
  discordClientId: string;
  discordClientSecret: string;
  discordRedirectUri: string | null;
  dashboardUrl: string;
  dashboardOrigin: string;
  apiPort: number;
  brandName: string;
  brandColor: string;
  brandLogoUrl: string | null;
  brandFaviconUrl: string | null;
  brandFooterText: string | null;
  jwtSecret: string;
  ownerId: string;
  maxGuilds: number;
  isDefault: boolean;
}

const DEFAULT_INSTANCE_ID = '__default__';

const instanceCache = new Map<string, ResolvedInstance>();
const instanceByOrigin = new Map<string, ResolvedInstance>();
const instanceByToken = new Map<string, ResolvedInstance>();

function buildOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/$/, '');
  }
}

function buildDefaultInstance(): ResolvedInstance {
  const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';
  const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

  return {
    id: DEFAULT_INSTANCE_ID,
    slug: 'default',
    name: 'Kotbo',
    discordToken: process.env.DISCORD_TOKEN || '',
    discordClientId: process.env.DISCORD_CLIENT_ID || '',
    discordClientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    discordRedirectUri: process.env.DISCORD_REDIRECT_URI || null,
    dashboardUrl,
    dashboardOrigin: buildOrigin(dashboardUrl),
    apiPort: Number(process.env.DASHBOARD_API_PORT ?? 8787),
    brandName: 'Kotbo',
    brandColor: '#5865F2',
    brandLogoUrl: null,
    brandFaviconUrl: null,
    brandFooterText: null,
    jwtSecret,
    ownerId: process.env.DISCORD_CLIENT_OWNER_ID || '',
    maxGuilds: Infinity,
    isDefault: true,
  };
}

export async function loadAllInstances(): Promise<ResolvedInstance[]> {
  instanceCache.clear();
  instanceByOrigin.clear();
  instanceByToken.clear();

  const defaultInstance = buildDefaultInstance();
  instanceCache.set(DEFAULT_INSTANCE_ID, defaultInstance);
  instanceByOrigin.set(defaultInstance.dashboardOrigin, defaultInstance);
  if (defaultInstance.discordToken) {
    instanceByToken.set(defaultInstance.discordToken, defaultInstance);
  }

  try {
    const dbInstances = await prisma.whiteLabelInstance.findMany({
      where: { enabled: true },
    });

    let nextAutoPort = defaultInstance.apiPort + 1;

    for (const inst of dbInstances) {
      const dashboardUrl = inst.dashboardUrl || defaultInstance.dashboardUrl;
      const dashboardOrigin = inst.dashboardOrigin || buildOrigin(dashboardUrl);
      const apiPort = inst.apiPort ?? nextAutoPort++;

      const resolved: ResolvedInstance = {
        id: inst.id,
        slug: inst.slug,
        name: inst.name,
        discordToken: inst.discordToken,
        discordClientId: inst.discordClientId,
        discordClientSecret: inst.discordClientSecret,
        discordRedirectUri: inst.discordRedirectUri,
        dashboardUrl,
        dashboardOrigin,
        apiPort,
        brandName: inst.brandName || inst.name,
        brandColor: inst.brandColor,
        brandLogoUrl: inst.brandLogoUrl,
        brandFaviconUrl: inst.brandFaviconUrl,
        brandFooterText: inst.brandFooterText,
        jwtSecret: inst.jwtSecret || crypto.randomBytes(32).toString('hex'),
        ownerId: inst.ownerId,
        maxGuilds: inst.maxGuilds,
        isDefault: false,
      };

      instanceCache.set(inst.id, resolved);
      instanceByOrigin.set(dashboardOrigin, resolved);
      instanceByToken.set(inst.discordToken, resolved);

      logger.info('WhiteLabel', `Instance "${inst.name}" (${inst.slug}) chargée - port ${apiPort}`);
    }

    logger.success('WhiteLabel', `${dbInstances.length} instance(s) white-label + instance par défaut chargées.`);
  } catch (error) {
    logger.warn('WhiteLabel', 'Impossible de charger les instances white-label (table manquante ?). Mode single-instance.', error);
  }

  return [...instanceCache.values()];
}

export function getDefaultInstance(): ResolvedInstance {
  return instanceCache.get(DEFAULT_INSTANCE_ID) || buildDefaultInstance();
}

export function getInstanceById(id: string): ResolvedInstance | undefined {
  return instanceCache.get(id);
}

export function getInstanceByOrigin(origin: string): ResolvedInstance | undefined {
  return instanceByOrigin.get(origin);
}

export function getInstanceByToken(token: string): ResolvedInstance | undefined {
  return instanceByToken.get(token);
}

export function getInstanceBySlug(slug: string): ResolvedInstance | undefined {
  for (const inst of instanceCache.values()) {
    if (inst.slug === slug) return inst;
  }
  return undefined;
}

export function getAllInstances(): ResolvedInstance[] {
  return [...instanceCache.values()];
}

export function resolveInstanceFromRequest(origin: string | undefined): ResolvedInstance {
  if (origin) {
    let normalizedOrigin: string;
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      normalizedOrigin = origin.replace(/\/$/, '');
    }

    const matched = instanceByOrigin.get(normalizedOrigin);
    if (matched) return matched;
  }

  return getDefaultInstance();
}
