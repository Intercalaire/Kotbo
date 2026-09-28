import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { DASHBOARD_TELEMETRY_LIMITS, sanitizeTelemetryEntry, type DashboardTelemetryEntry } from '@kotbo/contracts';
import { logger } from '../../../utils/logger.js';
import {
  checkRateLimit,
  json,
  readJsonBody,
  resolveAdminAccess,
  resolveDashboardAccess,
  type AuthClaims,
} from '../../shared.js';
import { ensureDashboardTelemetryFlusher, recordTelemetryBatch } from '../../../services/analytics/dashboardTelemetryService.js';

/** Un onglet envoie un lot toutes les 30 s, plus un au départ : 20/min laisse de la marge à plusieurs onglets. */
const telemetryRateLimiter = new Map<string, number[]>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function noContent(res: ServerResponse): void {
  res.statusCode = 204;
  res.end();
}

/**
 * POST /api/dashboard/telemetry
 *
 * Reçoit un lot d'événements agrégés par le navigateur. Répond toujours 204
 * quand la requête est bien formée, y compris quand le lot est écarté : la
 * télémétrie ne doit jamais faire apparaître d'erreur dans le dashboard.
 */
export async function handleTelemetryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  client: Client,
  user: AuthClaims,
): Promise<boolean> {
  if (parts.length !== 3 || parts[2] !== 'telemetry') return false;
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Méthode non autorisée' });
    return true;
  }

  if (!checkRateLimit(telemetryRateLimiter, user.userId, RATE_LIMIT, RATE_WINDOW_MS)) {
    json(res, 429, { error: 'Trop de requêtes' });
    return true;
  }

  let body: { entries?: unknown } | null;
  try {
    body = await readJsonBody<{ entries?: unknown }>(req);
  } catch {
    json(res, 400, { error: 'Corps invalide' });
    return true;
  }

  const rawEntries = Array.isArray(body?.entries) ? body.entries : [];
  if (rawEntries.length === 0) {
    noContent(res);
    return true;
  }

  // Les admins globaux parcourent tous les serveurs pour le support : les
  // compter fausserait l'usage réel.
  if (await resolveAdminAccess(client, user.userId)) {
    noContent(res);
    return true;
  }

  const entries: DashboardTelemetryEntry[] = [];
  for (const raw of rawEntries.slice(0, DASHBOARD_TELEMETRY_LIMITS.maxEntriesPerBatch)) {
    const entry = sanitizeTelemetryEntry(raw);
    if (entry) entries.push(entry);
  }

  // Un compteur n'est rattaché qu'à un serveur dont la personne voit le dashboard.
  const allowedGuilds = new Map<string, boolean>();
  for (const guildId of new Set(entries.map((e) => e.guildId))) {
    if (!guildId) {
      allowedGuilds.set(guildId, true);
      continue;
    }
    try {
      const access = await resolveDashboardAccess(client, guildId, user.userId);
      allowedGuilds.set(guildId, access.canViewDashboard);
    } catch {
      allowedGuilds.set(guildId, false);
    }
  }

  const accepted = entries.filter((e) => allowedGuilds.get(e.guildId));
  try {
    ensureDashboardTelemetryFlusher();
    await recordTelemetryBatch(user.userId, accepted);
  } catch (error) {
    logger.error('DashboardTelemetry', 'Lot de télémétrie non enregistré :', error);
  }

  noContent(res);
  return true;
}
