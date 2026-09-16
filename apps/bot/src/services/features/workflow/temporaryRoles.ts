import { DiscordAPIError, RESTJSONErrorCodes, Routes, type Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';

/**
 * Retrait des rôles donnés pour une durée par l'action « Donner un rôle
 * temporaire ». Un balayage à la minute plutôt qu'un minuteur par rôle : il
 * survit aux redémarrages, et rattrape tout seul les échéances manquées.
 */

const BATCH_SIZE = 100;

/** Au-delà, la ligne est abandonnée : environ quatre heures de nouvelles tentatives. */
const MAX_REMOVAL_ATTEMPTS = 10;

/** Délai avant de retenter, multiplié par le nombre d'échecs déjà subis. */
const RETRY_STEP_MS = 5 * 60_000;

/**
 * Refus définitifs : le membre, le rôle ou le serveur n'existent plus. Retenter
 * n'y changera rien, et il n'y a plus de rôle à retirer.
 */
const GONE_CODES = new Set<number>([
  RESTJSONErrorCodes.UnknownGuild,
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.UnknownRole,
  RESTJSONErrorCodes.UnknownUser,
]);

export async function expireTemporaryRoles(client: Client): Promise<void> {
  // Seuls les serveurs de ce processus : un autre shard, ou une instance en
  // marque blanche avec un autre jeton, ne pourrait pas retirer le rôle et
  // prendrait son refus pour une disparition du serveur. Le cron appelle donc
  // cette fonction dans chaque processus, hors file d'attente.
  const guildIds = [...client.guilds.cache.keys()];
  if (guildIds.length === 0) return;

  const due = await prisma.workflowTemporaryRole.findMany({
    where: { expiresAt: { lte: new Date() }, guildId: { in: guildIds } },
    orderBy: { expiresAt: 'asc' },
    take: BATCH_SIZE,
  });

  for (const grant of due) {
    // Le filtre sur l'échéance lue protège une prolongation arrivée entre la
    // lecture et le retrait : la ligne prolongée n'est pas effacée.
    const forget = () => prisma.workflowTemporaryRole.deleteMany({
      where: { id: grant.id, expiresAt: grant.expiresAt },
    });

    try {
      await client.rest.delete(Routes.guildMemberRole(grant.guildId, grant.userId, grant.roleId), {
        reason: 'Automatisation : fin du rôle temporaire',
      });
      await forget();
    } catch (error) {
      if (error instanceof DiscordAPIError && GONE_CODES.has(Number(error.code))) {
        await forget();
        continue;
      }

      const attempts = grant.attempts + 1;
      if (attempts >= MAX_REMOVAL_ATTEMPTS) {
        logger.warn(
          'Workflow',
          `Rôle temporaire ${grant.roleId} jamais retiré à ${grant.userId} sur ${grant.guildId} après ${attempts} tentatives, abandon :`,
          error,
        );
        await forget();
        continue;
      }

      await prisma.workflowTemporaryRole.updateMany({
        where: { id: grant.id, expiresAt: grant.expiresAt },
        data: { attempts, expiresAt: new Date(Date.now() + RETRY_STEP_MS * attempts) },
      });
    }
  }
}
