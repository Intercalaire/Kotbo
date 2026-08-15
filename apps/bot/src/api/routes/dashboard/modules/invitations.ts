/** Routes dashboard du module `invitations`. */
import prisma from '../../../../utils/db.js';
import { logger } from '../../../../utils/logger.js';
import { getGuildName, json, pushAudit, readJsonBody } from '../../../shared.js';
import { type ModuleRouteContext } from './_shared.js';

export async function handleInvitationsRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, guildId, access, method, auditUser, moduleKey } = ctx;

  // invitations routes
  if (moduleKey === 'invitations') {
    // GET /api/dashboard/guilds/:guildId/invitations
    if (parts.length === 5 && method === 'GET') {
      try {
        const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (discordGuild) {
          const { syncGuildInvites } = await import('../../../../services/analytics/inviteService.js');
          await syncGuildInvites(discordGuild);
        }

        const invitations = await prisma.guildInvite.findMany({
          where: { guildId }
        });

        const suspendedInviters = await prisma.suspendedInviter.findMany({
          where: { guildId }
        });

        const inviteUsage = await prisma.memberInvite.groupBy({
          by: ['inviteCode'],
          where: { guildId, inviteCode: { not: null } },
          _count: {
            _all: true,
            leftAt: true,
          },
          _max: {
            joinedAt: true,
          }
        });

        const inviterUsage = await prisma.memberInvite.groupBy({
          by: ['inviterId', 'inviterTag'],
          where: { guildId, inviterId: { not: null } },
          _count: {
            _all: true,
            leftAt: true,
          },
          _max: {
            joinedAt: true,
          }
        });

        const totalJoined = await prisma.memberInvite.count({
          where: { guildId }
        });

        const totalLeft = await prisma.memberInvite.count({
          where: { guildId, leftAt: { not: null } }
        });

        json(res, 200, {
          invitations,
          suspendedInviters,
          inviteUsage,
          inviterUsage,
          summary: { totalJoined, totalLeft }
        });
      } catch (err) {
        logger.error('InvitationsAPI', 'Error fetching invitations:', err);
        json(res, 500, { error: 'Erreur lors de la récupération des invitations' });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/invitations/suspended-inviters
    if (parts.length === 6 && parts[5] === 'suspended-inviters' && method === 'POST') {
      if (!access.canModerateContent && !access.canManageSettings) {
        json(res, 403, { error: 'Accès refusé. Permissions de modération requises.' });
        return true;
      }

      try {
        const body = await readJsonBody<{ userId: string; userTag?: string; reason?: string; cascade?: boolean }>(req);
        if (!body || !body.userId) {
          json(res, 400, { error: 'ID utilisateur requis' });
          return true;
        }

        const suspended = await prisma.suspendedInviter.upsert({
          where: { guildId_userId: { guildId, userId: body.userId } },
          create: {
            guildId,
            userId: body.userId,
            userTag: body.userTag || null,
            reason: body.reason || null
          },
          update: {
            userTag: body.userTag || null,
            reason: body.reason || null
          }
        });

        let cascadeResult: { purgedCount: number } | undefined;

        if (body.cascade) {
          const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
          if (discordGuild) {
            const invites = await discordGuild.invites.fetch().catch(() => null);
            if (invites) {
              for (const invite of invites.values()) {
                if (invite.inviter?.id === body.userId) {
                  await invite.delete('Creator suspended').catch(() => null);
                }
              }
            }
          }

          await prisma.guildInvite.updateMany({
            where: { guildId, inviterId: body.userId },
            data: { isSuspended: true }
          });

          const membersToPurge = await prisma.memberInvite.findMany({
            where: { guildId, inviterId: body.userId, leftAt: null }
          });

          let purgedCount = 0;
          if (discordGuild) {
            for (const m of membersToPurge) {
              const memberObj = await discordGuild.members.fetch(m.userId).catch(() => null);
              if (memberObj) {
                await memberObj.kick('Purge en cascade (créateur suspendu)').catch(() => null);
                purgedCount++;
              }
            }
          }

          await prisma.memberInvite.updateMany({
            where: { guildId, inviterId: body.userId, leftAt: null },
            data: { leftAt: new Date() }
          });

          cascadeResult = { purgedCount };
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suspension Créateur',
          context: getGuildName(client, guildId),
          module: 'Invitations',
          eventType: 'Manuel',
          details: `Créateur d'invitations ${body.userId} suspendu.${body.cascade ? ` Cascade purge active.` : ''}`,
          channelId: null
        });

        json(res, 200, { ok: true, suspended, cascade: cascadeResult });
      } catch (err) {
        logger.error('InvitationsAPI', 'Error suspending creator:', err);
        json(res, 500, { error: 'Erreur lors de la suspension du créateur' });
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/invitations/suspended-inviters/:userId
    if (parts.length === 7 && parts[5] === 'suspended-inviters' && method === 'DELETE') {
      if (!access.canModerateContent && !access.canManageSettings) {
        json(res, 403, { error: 'Accès refusé. Permissions de modération requises.' });
        return true;
      }

      const userId = parts[6];
      try {
        await prisma.suspendedInviter.delete({
          where: { guildId_userId: { guildId, userId } }
        });

        await prisma.guildInvite.updateMany({
          where: { guildId, inviterId: userId },
          data: { isSuspended: false }
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Restauration Créateur',
          context: getGuildName(client, guildId),
          module: 'Invitations',
          eventType: 'Manuel',
          details: `Créateur d'invitations ${userId} réhabilité.`,
          channelId: null
        });

        json(res, 200, { ok: true });
      } catch (err) {
        logger.error('InvitationsAPI', `Error removing suspended inviter ${userId}:`, err);
        json(res, 500, { error: 'Erreur lors de la réhabilitation du créateur' });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/invitations/inviters/:userId/purge
    if (parts.length === 8 && parts[5] === 'inviters' && parts[7] === 'purge' && method === 'POST') {
      if (!access.canModerateContent && !access.canManageSettings) {
        json(res, 403, { error: 'Accès refusé. Permissions de modération requises.' });
        return true;
      }

      const userId = parts[6];
      try {
        const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        const membersToPurge = await prisma.memberInvite.findMany({
          where: { guildId, inviterId: userId, leftAt: null }
        });

        let purgedCount = 0;
        if (discordGuild) {
          for (const m of membersToPurge) {
            const memberObj = await discordGuild.members.fetch(m.userId).catch(() => null);
            if (memberObj) {
              await memberObj.kick('Purge en cascade (inviter purge)').catch(() => null);
              purgedCount++;
            }
          }
        }

        await prisma.memberInvite.updateMany({
          where: { guildId, inviterId: userId, leftAt: null },
          data: { leftAt: new Date() }
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Purge Créateur',
          context: getGuildName(client, guildId),
          module: 'Invitations',
          eventType: 'Manuel',
          details: `Membres invités par ${userId} purgés (${purgedCount} exclus).`,
          channelId: null
        });

        json(res, 200, { purgedCount });
      } catch (err) {
        logger.error('InvitationsAPI', `Error purging inviter ${userId} members:`, err);
        json(res, 500, { error: 'Erreur lors de la purge du créateur' });
      }
      return true;
    }

    // PUT /api/dashboard/guilds/:guildId/invitations/:code/suspend
    if (parts.length === 7 && parts[6] === 'suspend' && method === 'PUT') {
      if (!access.canModerateContent && !access.canManageSettings) {
        json(res, 403, { error: 'Accès refusé. Permissions de modération requises.' });
        return true;
      }

      const code = parts[5];
      try {
        const body = await readJsonBody<{ suspended: boolean }>(req);
        if (!body || typeof body.suspended !== 'boolean') {
          json(res, 400, { error: 'Statut de suspension requis' });
          return true;
        }

        await prisma.guildInvite.update({
          where: { code },
          data: { isSuspended: body.suspended }
        });

        if (body.suspended) {
          const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
          if (discordGuild) {
            const inviteObj = await discordGuild.invites.fetch(code).catch(() => null);
            if (inviteObj) {
              await inviteObj.delete('Suspendu depuis le tableau de bord').catch(() => null);
            }
          }
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: body.suspended ? 'Suspension Invitation' : 'Restauration Invitation',
          context: getGuildName(client, guildId),
          module: 'Invitations',
          eventType: 'Manuel',
          details: `L'invitation ${code} a été ${body.suspended ? 'suspendue' : 'restaurée'}.`,
          channelId: null
        });

        json(res, 200, { ok: true });
      } catch (err) {
        logger.error('InvitationsAPI', `Error suspending invite ${code}:`, err);
        json(res, 500, { error: "Erreur lors de la suspension de l'invitation" });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/invitations/:code/purge
    if (parts.length === 7 && parts[6] === 'purge' && method === 'POST') {
      if (!access.canModerateContent && !access.canManageSettings) {
        json(res, 403, { error: 'Accès refusé. Permissions de modération requises.' });
        return true;
      }

      const code = parts[5];
      try {
        const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        const membersToPurge = await prisma.memberInvite.findMany({
          where: { guildId, inviteCode: code, leftAt: null }
        });

        let purgedCount = 0;
        if (discordGuild) {
          for (const m of membersToPurge) {
            const memberObj = await discordGuild.members.fetch(m.userId).catch(() => null);
            if (memberObj) {
              await memberObj.kick('Purge en cascade (code purge)').catch(() => null);
              purgedCount++;
            }
          }
        }

        await prisma.memberInvite.updateMany({
          where: { guildId, inviteCode: code, leftAt: null },
          data: { leftAt: new Date() }
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Purge Invitation',
          context: getGuildName(client, guildId),
          module: 'Invitations',
          eventType: 'Manuel',
          details: `Membres invités via le code ${code} purgés (${purgedCount} exclus).`,
          channelId: null
        });

        json(res, 200, { purgedCount });
      } catch (err) {
        logger.error('InvitationsAPI', `Error purging members of invite ${code}:`, err);
        json(res, 500, { error: "Erreur lors de la purge de l'invitation" });
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/invitations/:code
    if (parts.length === 6 && method === 'DELETE') {
      if (!access.canModerateContent && !access.canManageSettings) {
        json(res, 403, { error: 'Accès refusé. Permissions de modération requises.' });
        return true;
      }

      const code = parts[5];
      try {
        const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (discordGuild) {
          const inviteObj = await discordGuild.invites.fetch(code).catch(() => null);
          if (inviteObj) {
            await inviteObj.delete('Supprimé depuis le tableau de bord').catch(() => null);
          }
        }

        await prisma.guildInvite.update({
          where: { code },
          data: { isDeleted: true }
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression Invitation',
          context: getGuildName(client, guildId),
          module: 'Invitations',
          eventType: 'Manuel',
          details: `L'invitation ${code} a été supprimée.`,
          channelId: null
        });

        json(res, 200, { ok: true });
      } catch (err) {
        logger.error('InvitationsAPI', `Error deleting invite ${code}:`, err);
        json(res, 500, { error: "Erreur lors de la suppression de l'invitation" });
      }
      return true;
    }
  }

  return false;
}
