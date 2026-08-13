/**
 * Moderation Audit Module - Bus-based subscriber
 *
 * Captures manual moderation actions (kick/ban/timeout done via Discord UI,
 * not bot commands) by listening to GuildAuditLogEntryCreate.
 *
 * This event is not mapped through the bus bridge because it provides
 * AuditLogEntry objects that are Discord-specific. Instead, this module
 * registers directly on client.on() but is structured as a bus module
 * for consistency and error isolation.
 */

import { AuditLogEvent, Events, type Client, type GuildAuditLogsEntry } from 'discord.js';
import { registerBanSanction, registerKickSanction, registerObservedTimeoutSanction, resolveActiveTimeoutSanction } from '../services/moderation/sanctionService.js';
import { logger } from '../utils/logger.js';

const MODULE_NAME = 'moderation';

type Actor = { id: string; tag: string };
type Target = { id: string; tag: string };

const MANUAL_REASON: Record<'KICK' | 'BAN' | 'TIMEOUT', string> = {
  KICK: 'Kick appliqué manuellement via Discord (hors commande bot).',
  BAN: 'Ban appliqué manuellement via Discord (hors commande bot).',
  TIMEOUT: 'Timeout appliqué manuellement via Discord (hors commande bot).',
};

function readTargetId(entry: GuildAuditLogsEntry): string | null {
  if (typeof entry.targetId === 'string' && entry.targetId.length > 0) return entry.targetId;
  const target = entry.target as { id?: string } | null;
  return target?.id && target.id.length > 0 ? target.id : null;
}

function readTimeoutUntil(entry: GuildAuditLogsEntry): Date | null {
  for (const change of entry.changes) {
    if (change.key !== 'communication_disabled_until') continue;
    const value = change.new;
    const parsed = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }
  return null;
}

async function resolveUserTag(client: Client, userId: string, fallback: string): Promise<string> {
  try {
    const user = client.users.cache.get(userId) ?? await client.users.fetch(userId);
    return user.tag || fallback;
  } catch {
    return fallback;
  }
}

function userFallbackLabel(user: { tag?: string | null; username?: string | null } | null, userId: string): string {
  if (!user) return `Utilisateur ${userId}`;
  return user.tag || user.username || `Utilisateur ${userId}`;
}

export function registerModerationBusSubscribers(client: Client): void {
  client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
    const botUserId = client.user?.id;
    if (!botUserId) return;

    const executorId = entry.executorId;
    if (!executorId || executorId === botUserId) return;

    const targetId = readTargetId(entry);
    if (!targetId || targetId === executorId) return;

    try {
      const action = entry.action;

      // Batch-resolve both user tags in parallel instead of sequential
      const [moderatorTag, targetTag] = await Promise.all([
        resolveUserTag(client, executorId, userFallbackLabel(entry.executor, executorId)),
        resolveUserTag(client, targetId, userFallbackLabel(entry.target as { tag?: string | null; username?: string | null } | null, targetId)),
      ]);

      const moderator: Actor = { id: executorId, tag: moderatorTag };
      const target: Target = { id: targetId, tag: targetTag };

      if (action === AuditLogEvent.MemberKick) {
        await registerKickSanction({ guildId: guild.id, target, moderator, reason: entry.reason?.trim() || MANUAL_REASON.KICK, client });
        return;
      }

      if (action === AuditLogEvent.MemberBanAdd) {
        await registerBanSanction({ guildId: guild.id, target, moderator, reason: entry.reason?.trim() || MANUAL_REASON.BAN, client });
        return;
      }

      if (action === AuditLogEvent.MemberUpdate) {
        const timeoutChange = entry.changes.find((change) => change.key === 'communication_disabled_until');
        if (!timeoutChange) return;

        const timeoutUntil = readTimeoutUntil(entry);
        if (!timeoutUntil || timeoutUntil.getTime() <= Date.now() + 1000) {
          await resolveActiveTimeoutSanction({
            guildId: guild.id,
            targetUserId: targetId,
            resolutionNote: entry.reason?.trim() || 'Retrait du timeout via Discord.',
          });
          return;
        }

        await registerObservedTimeoutSanction({ guildId: guild.id, target, moderator, reason: entry.reason?.trim() || MANUAL_REASON.TIMEOUT, expiresAt: timeoutUntil });
      }
    } catch (error) {
      logger.error(`[EventBus:${MODULE_NAME}]`, `Erreur sync sanctions audit Discord (guilde ${guild.id}):`, error);
    }
  });

  logger.info('Modules', `Module "${MODULE_NAME}" enregistre sur le bus d'events.`);
}
