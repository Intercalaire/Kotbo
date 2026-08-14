import type { Prisma } from '@prisma/client';
import type { Client } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { initializeAutoBackup } from '../system/autoBackupService.js';
import { startHistoricalScraping } from './messageScraperService.js';
import { startMemberScraping } from './memberScraperService.js';
import {
  acquireGuildScrapeLock,
  releaseGuildScrapeLock,
} from './guildScrapeLock.js';

export type GuildDataSyncStartStatus =
  | 'STARTED'
  | 'ALREADY_RUNNING'
  | 'NOT_FOUND'
  | 'NOT_ACTIVATED'
  | 'ANALYTICS_DISABLED';

export interface GuildDataSyncStartResult {
  status: GuildDataSyncStartStatus;
  completion?: Promise<void>;
}

async function patchSyncConfig(guildId: string, patch: Record<string, unknown>): Promise<void> {
  const guild = await prisma.guild.findUnique({
    where: { id: guildId },
    select: { statsConfig: true },
  });
  const current = (guild?.statsConfig && typeof guild.statsConfig === 'object' && !Array.isArray(guild.statsConfig))
    ? guild.statsConfig as Record<string, unknown>
    : {};

  await prisma.guild.update({
    where: { id: guildId },
    data: {
      statsConfig: {
        ...current,
        ...patch,
      } as Prisma.InputJsonValue,
    },
  });
}

/**
 * Synchronise les données Discord qui doivent exister dès l'activation.
 *
 * Les étapes restent séquentielles car les deux scrapers partagent encore
 * `Guild.statsConfig`. Le scan membres est un upsert complet et peut être rejoué.
 * Le scan historique reprend uniquement ses curseurs existants afin de ne jamais
 * incrémenter deux fois les mêmes messages.
 */
export async function startGuildDataSync(
  client: Client,
  guildId: string,
): Promise<GuildDataSyncStartResult> {
  const lock = acquireGuildScrapeLock(guildId, 'full');
  if (!lock) return { status: 'ALREADY_RUNNING' };

  const guild = await prisma.guild.findUnique({
    where: { id: guildId },
    select: { activated: true, analyticsEnabled: true },
  }).catch((error) => {
    releaseGuildScrapeLock(lock);
    throw error;
  });

  if (!guild) {
    releaseGuildScrapeLock(lock);
    return { status: 'NOT_FOUND' };
  }
  if (!guild.activated) {
    releaseGuildScrapeLock(lock);
    return { status: 'NOT_ACTIVATED' };
  }
  // C'est ici que se joue l'essentiel : cette synchronisation constitue les
  // profils de membres et rejoue l'historique des salons. Un serveur ayant coupé
  // la collecte ne doit surtout pas la voir démarrer à l'activation.
  if (!guild.analyticsEnabled) {
    releaseGuildScrapeLock(lock);
    logger.info('GuildDataSync', `Synchronisation ignorée pour ${guildId} : collecte analytique désactivée.`);
    return { status: 'ANALYTICS_DISABLED' };
  }

  const discordGuild = client.guilds.cache.get(guildId)
    ?? await client.guilds.fetch(guildId).catch(() => null);
  if (discordGuild) {
    await initializeAutoBackup(discordGuild).catch((error) => {
      logger.warn('GuildDataSync', `Impossible d'initialiser le backup automatique de ${guildId}:`, error);
    });
  }

  await patchSyncConfig(guildId, {
    fullSyncStatus: 'IN_PROGRESS',
    fullSyncStage: 'MEMBERS',
    fullSyncError: null,
    fullSyncStartedAt: new Date().toISOString(),
  }).catch((error) => {
    releaseGuildScrapeLock(lock);
    throw error;
  });

  const completion = (async () => {
    try {
      const members = await startMemberScraping(client, guildId, true, lock);
      if (members.completion) await members.completion;

      const afterMembers = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { statsConfig: true },
      });
      const memberConfig = (afterMembers?.statsConfig ?? {}) as Record<string, unknown>;
      if (memberConfig.memberScrapeStatus !== 'COMPLETED') {
        throw new Error(String(memberConfig.memberScrapeError || 'La synchronisation des membres a échoué.'));
      }

      await patchSyncConfig(guildId, { fullSyncStage: 'HISTORY' });

      // `force=true` ne remet plus les compteurs à zéro : il autorise seulement
      // la reprise d'un IN_PROGRESS orphelin après un redémarrage.
      const history = await startHistoricalScraping(client, guildId, true, lock);
      if (history.completion) await history.completion;

      const afterHistory = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { statsConfig: true },
      });
      const historyConfig = (afterHistory?.statsConfig ?? {}) as Record<string, unknown>;
      if (historyConfig.historicalScrapeStatus === 'FAILED') {
        throw new Error(String(historyConfig.historicalScrapeError || "La synchronisation de l'historique a échoué."));
      }

      await patchSyncConfig(guildId, {
        fullSyncStatus: 'COMPLETED',
        fullSyncStage: null,
        fullSyncError: null,
        fullSyncCompletedAt: new Date().toISOString(),
      });
      logger.success('GuildDataSync', `Synchronisation complète terminée pour ${guildId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('GuildDataSync', `Synchronisation complète échouée pour ${guildId}:`, error);
      await patchSyncConfig(guildId, {
        fullSyncStatus: 'FAILED',
        fullSyncStage: null,
        fullSyncError: message,
      }).catch((patchError) => {
        logger.error('GuildDataSync', `Impossible d'enregistrer l'échec pour ${guildId}:`, patchError);
      });
    } finally {
      releaseGuildScrapeLock(lock);
    }
  })();

  return { status: 'STARTED', completion };
}

export function scheduleGuildDataSync(client: Client, guildId: string): void {
  if (client.shard && !client.guilds.cache.has(guildId)) {
    const servicePath = import.meta.url;
    void client.shard.broadcastEval<
      string | null,
      { guildId: string; servicePath: string }
    >(async (shardClient, context) => {
      if (!shardClient.guilds.cache.has(context.guildId)) return null;
      const { startGuildDataSync } = await import(context.servicePath);
      const result = await startGuildDataSync(shardClient, context.guildId);
      return result.status;
    }, { context: { guildId, servicePath } }).catch((error) => {
      logger.error('GuildDataSync', `Impossible de router la synchronisation de ${guildId} vers son shard:`, error);
    });
    return;
  }

  void startGuildDataSync(client, guildId)
    .then((result) => {
      if (result.status === 'ALREADY_RUNNING') {
        logger.info('GuildDataSync', `Une synchronisation est déjà active pour ${guildId}.`);
      }
    })
    .catch((error) => {
      logger.error('GuildDataSync', `Impossible de démarrer la synchronisation de ${guildId}:`, error);
    });
}
