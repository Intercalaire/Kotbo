/**
 * assetSourceService.ts
 *
 * D'où viennent les emojis et stickers utilisés sur un serveur ? Un message ne
 * porte que `<:nom:id>` : Discord ne dit pas à quel serveur appartient un emoji
 * externe. On le sait sans appel quand Kotbo est lui-même sur ce serveur
 * (`client.emojis.cache`). Sinon :
 *
 *  - sticker : `GET /stickers/{id}` (documenté) donne son `guild_id`, et
 *    `GET /guilds/{id}/preview` son nom quand le serveur est découvrable ;
 *  - emoji : `GET /emojis/{id}/source`, route NON documentée (celle de la
 *    fenêtre « infos emoji » du client Discord). Elle peut refuser les bots ou
 *    disparaître : elle passe derrière un disjoncteur.
 *
 * Garde-fous : chaque id est stocké dans `discord_asset_sources` et n'est
 * demandé qu'une fois, même quand la réponse est « inconnu » (nouvel essai au
 * bout de 30 jours). Les appels sont plafonnés par minute, et trois échecs de
 * suite (401, 403, 429, 5xx, réseau) coupent les appels pendant une heure,
 * puis deux, quatre… jusqu'à 24 h. Discord bannit temporairement une IP qui
 * enchaîne les 401/403/429 : le disjoncteur est là pour ne jamais s'en approcher.
 */

import { DiscordAPIError, StickerType, type Client } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getClient } from '../../utils/client.js';

export interface AssetSighting {
  kind: 'emoji' | 'sticker';
  id: string;
  name: string;
  animated: boolean;
  /** Serveur propriétaire quand il est connu au moment où on le voit. */
  guildId: string | null;
  standard?: boolean;
}

const SNOWFLAKE_RE = /^\d{17,20}$/;
const SEEN_CAP = 200_000;
const RESOLVE_PER_MINUTE =
  Number.parseInt(process.env.CONTENT_ASSET_RESOLVE_PER_MIN ?? '20', 10) || 20;
const RESOLVE_INTERVAL_MS = 60_000;
const UNKNOWN_RETRY_MS = 30 * 24 * 3600 * 1000;
const STANDARD_STICKERS_TTL_MS = 24 * 3600 * 1000;

const BREAKER_THRESHOLD = 3;
const BREAKER_BASE_MS = 3600 * 1000;
const BREAKER_MAX_MS = 24 * 3600 * 1000;

/** Ids déjà enregistrés depuis le démarrage : évite une écriture par message. */
const seen = new Set<string>();
const pending = new Map<string, AssetSighting>();

function tryGetClient(): Client | null {
  try {
    return getClient();
  } catch {
    return null;
  }
}

export function noteAssets(sightings: AssetSighting[]): void {
  for (const sighting of sightings) {
    if (!SNOWFLAKE_RE.test(sighting.id) || seen.has(sighting.id)) continue;
    if (seen.size >= SEEN_CAP) seen.clear();
    seen.add(sighting.id);
    pending.set(sighting.id, sighting);
  }
}

interface SourceGuild {
  id: string | null;
  name: string | null;
  icon: string | null;
}

function guildFromCache(client: Client | null, guildId: string | null | undefined): SourceGuild | null {
  if (!client || !guildId) return null;
  const guild = client.guilds.cache.get(guildId);
  return guild ? { id: guild.id, name: guild.name, icon: guild.icon } : null;
}

/** Crée les lignes des ids vus pour la première fois, résolues d'office quand c'est possible. */
export async function flushPendingAssets(): Promise<void> {
  if (pending.size === 0) return;
  const sightings = [...pending.values()];
  pending.clear();

  const client = tryGetClient();
  const now = new Date();
  const rows = sightings.map((s) => {
    const owner = s.kind === 'emoji'
      ? guildFromCache(client, s.guildId ?? client?.emojis.cache.get(s.id)?.guild?.id)
      : guildFromCache(client, s.guildId);
    const resolved = Boolean(owner) || Boolean(s.standard);
    return {
      id: s.id,
      kind: s.kind,
      name: s.name.slice(0, 64),
      animated: s.animated,
      sourceGuildId: owner?.id ?? null,
      sourceGuildName: owner?.name ?? null,
      sourceGuildIcon: owner?.icon ?? null,
      status: resolved ? 'resolved' : 'pending',
      checkedAt: resolved ? now : null,
    };
  });

  for (let i = 0; i < rows.length; i += 500) {
    await prisma.discordAssetSource
      .createMany({ data: rows.slice(i, i + 500), skipDuplicates: true })
      .catch((err) => logger.warn('AssetSource', 'Enregistrement des provenances impossible :', err));
  }
}

// ── Stickers officiels de Discord ──────────────────────────────────────────

let standardStickerIds = new Set<string>();
let standardStickersFetchedAt = 0;

export function isStandardSticker(id: string): boolean {
  return standardStickerIds.has(id);
}

export async function refreshStandardStickers(client: Client): Promise<void> {
  if (Date.now() - standardStickersFetchedAt < STANDARD_STICKERS_TTL_MS) return;
  standardStickersFetchedAt = Date.now();
  try {
    const packs = await client.fetchStickerPacks();
    const ids = new Set<string>();
    for (const pack of packs.values()) for (const id of pack.stickers.keys()) ids.add(id);
    standardStickerIds = ids;
  } catch (err) {
    logger.warn('AssetSource', 'Liste des stickers Discord indisponible :', err);
  }
}

// ── Disjoncteur ────────────────────────────────────────────────────────────

const breaker = { failures: 0, openUntil: 0, backoffMs: BREAKER_BASE_MS };

function breakerOpen(): boolean {
  return Date.now() < breaker.openUntil;
}

function recordSuccess(): void {
  breaker.failures = 0;
  breaker.backoffMs = BREAKER_BASE_MS;
}

function recordFailure(reason: string): void {
  breaker.failures += 1;
  if (breaker.failures < BREAKER_THRESHOLD) return;
  breaker.openUntil = Date.now() + breaker.backoffMs;
  logger.warn('AssetSource', `Disjoncteur ouvert ${Math.round(breaker.backoffMs / 60000)} min (${reason}).`);
  breaker.backoffMs = Math.min(breaker.backoffMs * 2, BREAKER_MAX_MS);
  breaker.failures = 0;
}

/** Réponse « cet id n'existe pas / n'est pas public » : un résultat, pas une panne. */
function isNotFound(err: unknown): boolean {
  return err instanceof DiscordAPIError && (err.status === 404 || err.status === 400);
}

function describe(err: unknown): string {
  return err instanceof DiscordAPIError ? `HTTP ${err.status}` : 'erreur réseau';
}

type Resolution =
  | { status: 'resolved'; guild: SourceGuild }
  | { status: 'unknown' }
  | { status: 'skip' };

interface EmojiSourceResponse {
  type?: string;
  guild?: { id?: string; name?: string; icon?: string | null } | null;
  application?: { name?: string } | null;
}

async function resolveEmoji(client: Client, id: string): Promise<Resolution> {
  const cached = client.emojis.cache.get(id);
  const owner = guildFromCache(client, cached?.guild?.id);
  if (owner) return { status: 'resolved', guild: owner };
  if (breakerOpen()) return { status: 'skip' };

  try {
    const data = (await client.rest.get(`/emojis/${id}/source`)) as EmojiSourceResponse;
    recordSuccess();
    if (data?.guild?.id) {
      return { status: 'resolved', guild: { id: data.guild.id, name: data.guild.name ?? null, icon: data.guild.icon ?? null } };
    }
    if (data?.application?.name) {
      return { status: 'resolved', guild: { id: null, name: data.application.name, icon: null } };
    }
    return { status: 'unknown' };
  } catch (err) {
    if (isNotFound(err)) {
      recordSuccess();
      return { status: 'unknown' };
    }
    recordFailure(describe(err));
    return { status: 'skip' };
  }
}

async function resolveSticker(client: Client, id: string): Promise<Resolution> {
  if (breakerOpen()) return { status: 'skip' };
  try {
    const sticker = await client.fetchSticker(id);
    recordSuccess();
    if (sticker.type === StickerType.Standard) return { status: 'resolved', guild: { id: null, name: null, icon: null } };
    if (!sticker.guildId) return { status: 'unknown' };

    const cached = guildFromCache(client, sticker.guildId);
    if (cached) return { status: 'resolved', guild: cached };
    try {
      const preview = await client.fetchGuildPreview(sticker.guildId);
      return { status: 'resolved', guild: { id: preview.id, name: preview.name, icon: preview.icon } };
    } catch {
      // Serveur non découvrable : on garde son id, sans nom.
      return { status: 'resolved', guild: { id: sticker.guildId, name: null, icon: null } };
    }
  } catch (err) {
    if (isNotFound(err)) {
      recordSuccess();
      return { status: 'unknown' };
    }
    recordFailure(describe(err));
    return { status: 'skip' };
  }
}

async function resolveDueAssets(client: Client): Promise<void> {
  const due = await prisma.discordAssetSource.findMany({
    where: {
      OR: [
        { status: 'pending' },
        { status: 'unknown', checkedAt: { lt: new Date(Date.now() - UNKNOWN_RETRY_MS) } },
      ],
    },
    select: { id: true, kind: true },
    orderBy: { createdAt: 'asc' },
    take: RESOLVE_PER_MINUTE,
  });

  for (const row of due) {
    const result = row.kind === 'sticker'
      ? await resolveSticker(client, row.id)
      : await resolveEmoji(client, row.id);
    if (result.status === 'skip') continue;

    await prisma.discordAssetSource.update({
      where: { id: row.id },
      data: {
        status: result.status,
        attempts: { increment: 1 },
        checkedAt: new Date(),
        ...(result.status === 'resolved'
          ? { sourceGuildId: result.guild.id, sourceGuildName: result.guild.name, sourceGuildIcon: result.guild.icon }
          : {}),
      },
    });
  }
}

let resolverTimer: ReturnType<typeof setInterval> | null = null;
let resolving = false;

export function startAssetSourceResolver(client: Client): void {
  if (resolverTimer) return;
  void refreshStandardStickers(client);
  resolverTimer = setInterval(() => {
    void refreshStandardStickers(client);
    if (resolving) return;
    resolving = true;
    resolveDueAssets(client)
      .catch((err) => logger.warn('AssetSource', 'Résolution des provenances interrompue :', err))
      .finally(() => {
        resolving = false;
      });
  }, RESOLVE_INTERVAL_MS);
  if (typeof resolverTimer.unref === 'function') resolverTimer.unref();
}

/** État du disjoncteur, pour les tests et le diagnostic. */
export function assetBreakerState(): { open: boolean; openUntil: number } {
  return { open: breakerOpen(), openUntil: breaker.openUntil };
}
