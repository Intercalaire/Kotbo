import { DiscordAPIError, RESTJSONErrorCodes, Routes, type Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { expectBotRoleChange } from './roleEcho.js';
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
    // Chaque rôle isolément : une panne de base sur l'un ne doit pas bloquer
    // tous ceux qui le suivent, minute après minute.
    try {
      await expireGrant(client, grant);
    } catch (error) {
      logger.error('Workflow', `Retrait du rôle temporaire ${grant.id} impossible :`, error);
    }
  }
}

async function expireGrant(
  client: Client,
  grant: { id: string; guildId: string; userId: string; roleId: string; expiresAt: Date; attempts: number },
): Promise<void> {
  const route = Routes.guildMemberRole(grant.guildId, grant.userId, grant.roleId);

  // Le filtre sur l'échéance lue épargne une prolongation arrivée entre la
  // lecture et le retrait.
  const forget = async () => (await prisma.workflowTemporaryRole.deleteMany({
    where: { id: grant.id, expiresAt: grant.expiresAt },
  })).count > 0;

  // Le retrait revient par la passerelle et doit y être tu : sinon « quand un
  // rôle est retiré, le redonner pour 10 min » se relancerait à chaque
  // échéance, sans fin (cf. roleEcho.ts).
  const forgetRemoval = expectBotRoleChange(grant.guildId, grant.userId, grant.roleId, 'removed', null);
  try {
    await client.rest.delete(route, { reason: 'Automatisation : fin du rôle temporaire' });
  } catch (error) {
    forgetRemoval();
    if (error instanceof DiscordAPIError && GONE_CODES.has(Number(error.code))) {
      await forget();
      return;
    }

    const attempts = grant.attempts + 1;
    if (attempts >= MAX_REMOVAL_ATTEMPTS) {
      logger.warn(
        'Workflow',
        `Rôle temporaire ${grant.roleId} jamais retiré à ${grant.userId} sur ${grant.guildId} après ${attempts} tentatives, abandon :`,
        error,
      );
      await forget();
      return;
    }

    await prisma.workflowTemporaryRole.updateMany({
      where: { id: grant.id, expiresAt: grant.expiresAt },
      data: { attempts, expiresAt: new Date(Date.now() + RETRY_STEP_MS * attempts) },
    });
    return;
  }

  if (await forget()) return;

  // La ligne n'a pas été effacée. Soit un autre processus qui voit le même
  // serveur l'a déjà fait (rien à ajouter), soit le rôle a été prolongé pendant
  // le retrait : la ligne existe encore, et le rôle est rendu, sinon le membre
  // le perdrait avant sa nouvelle échéance.
  const extended = await prisma.workflowTemporaryRole.findUnique({ where: { id: grant.id }, select: { id: true } });
  if (!extended) return;

  // Pour les automatisations, le rôle n'a jamais cessé d'être porté.
  const forgetRestore = expectBotRoleChange(grant.guildId, grant.userId, grant.roleId, 'added', null);
  await client.rest.put(route, { reason: 'Automatisation : rôle temporaire prolongé' }).catch((error) => {
    forgetRestore();
    logger.warn('Workflow', `Rôle temporaire ${grant.roleId} prolongé mais non rendu à ${grant.userId} :`, error);
  });
}
