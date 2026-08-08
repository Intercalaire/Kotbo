import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { json, readJsonBody, getGuildName, safePushAudit, type AuthClaims, type DashboardAccess } from '../../shared.js';
import {
  AUDIT_EVENT_TYPES,
  getAuditConfig,
  getAuditExecutors,
  searchAuditEvents,
  sanitizeAuditConfigPatch,
  upsertAuditConfig,
  type AuditEventType,
} from '../../../services/analytics/auditDiffService.js';

function parseEventType(raw: string | null): AuditEventType | undefined {
  if (!raw) return undefined;
  return AUDIT_EVENT_TYPES.includes(raw as AuditEventType) ? (raw as AuditEventType) : undefined;
}

/** Ignore une date invalide plutôt que de renvoyer une erreur pour un filtre optionnel. */
function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseSnowflake(raw: string | null): string | undefined {
  if (!raw || !/^\d{5,25}$/.test(raw)) return undefined;
  return raw;
}

export async function handleAuditEventRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
  _access: DashboardAccess,
): Promise<boolean> {
  if (parts[4] !== 'audit-events') return false;

  const method = req.method;
  const sub = parts[5];

  // GET /audit-events - recherche filtrée et paginée
  if (!sub && method === 'GET') {
    try {
      const result = await searchAuditEvents(guildId, {
        eventType: parseEventType(url.searchParams.get('eventType')),
        executorId: parseSnowflake(url.searchParams.get('executorId')),
        channelId: parseSnowflake(url.searchParams.get('channelId')),
        targetId: parseSnowflake(url.searchParams.get('targetId')),
        search: url.searchParams.get('search') ?? undefined,
        from: parseDate(url.searchParams.get('from')),
        to: parseDate(url.searchParams.get('to')),
        page: Number(url.searchParams.get('page')) || 1,
        pageSize: Number(url.searchParams.get('pageSize')) || 25,
      });
      json(res, 200, result);
    } catch (err) {
      logger.error('AuditEventsAPI', 'Erreur GET événements:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des événements' });
    }
    return true;
  }

  // GET /audit-events/config
  if (sub === 'config' && method === 'GET') {
    try {
      json(res, 200, { config: await getAuditConfig(guildId) });
    } catch (err) {
      logger.error('AuditEventsAPI', 'Erreur GET config:', err);
      json(res, 500, { error: 'Erreur lors de la récupération de la configuration' });
    }
    return true;
  }

  // PATCH /audit-events/config
  if (sub === 'config' && method === 'PATCH') {
    try {
      const body = await readJsonBody<Record<string, unknown>>(req);
      if (!body) {
        json(res, 400, { error: 'Corps de requête manquant' });
        return true;
      }

      const patch = sanitizeAuditConfigPatch(body);
      if (Object.keys(patch).length === 0) {
        json(res, 400, { error: 'Aucun champ valide à mettre à jour' });
        return true;
      }

      const config = await upsertAuditConfig(guildId, patch);
      await safePushAudit(guildId, {
        user: `${user.username ?? 'Inconnu'} (${user.userId})`,
        action: 'Mise à jour Audit structurel',
        context: getGuildName(client, guildId),
        module: 'Audit Logger',
        eventType: 'Manuel',
        details: `Actif: ${config.enabled}, rétention: ${config.retentionDays} jour(s).`,
        channelId: null,
      }, 'Mise à jour Audit structurel');

      json(res, 200, { config });
    } catch (err) {
      logger.error('AuditEventsAPI', 'Erreur PATCH config:', err);
      json(res, 500, { error: 'Erreur lors de la mise à jour de la configuration' });
    }
    return true;
  }

  // GET /audit-events/executors - alimente le filtre « modérateur »
  if (sub === 'executors' && method === 'GET') {
    try {
      json(res, 200, { executors: await getAuditExecutors(guildId) });
    } catch (err) {
      logger.error('AuditEventsAPI', 'Erreur GET auteurs:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des auteurs' });
    }
    return true;
  }

  return false;
}
