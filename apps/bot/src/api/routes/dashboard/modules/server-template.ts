/** Routes dashboard de la mise en place guidee du serveur. */
import prisma from '../../../../utils/db.js';
import { errorMessage } from '../../../../utils/errors.js';
import { resolveGuildLocale } from '../../../../utils/i18n.js';
import { logger } from '../../../../utils/logger.js';
import { getGuildName, json, pushAudit, readJsonBody } from '../../../shared.js';
import {
  DEFAULT_SELECTION,
  applyServerTemplate,
  buildServerTemplatePlan,
  normalizeSelection,
  requiredPermissionsFor,
} from '../../../../services/core/serverTemplateService.js';
import {
  PROVISION_PERMISSION_LABELS,
  acquireProvisionLock,
  waitForProvisionSlot,
  missingProvisionPermissions,
  releaseProvisionLock,
  releaseProvisionSlot,
} from '../../../../services/core/channelProvisioningService.js';
import { PermissionFlagsBits } from 'discord.js';
import { type ModuleRouteContext } from './_shared.js';

export async function handleServerTemplateRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, guildId, access, method, auditUser, user, moduleKey } = ctx;
  if (moduleKey !== 'server-template') return false;

  // Elle cree des salons, des roles, et ne se lance qu'une fois : elle n'a rien
  // a faire dans les mains d'un moderateur.
  if (access.level !== 'admin') {
    json(res, 403, { error: 'Seuls les administrateurs peuvent mettre le serveur en place.' });
    return true;
  }

  const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!discordGuild) {
    json(res, 404, { error: 'Serveur Discord introuvable.' });
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/server-template
  if (parts.length === 5 && method === 'GET') {
    try {
      // Les noms sont rendus dans la langue du serveur, pas dans celle du
      // dashboard : la previsualisation doit montrer ce qui sera reellement
      // ecrit sur Discord.
      const locale = await resolveGuildLocale(guildId, discordGuild.preferredLocale);
      const guildRow = await prisma.guild.findUnique({
        where: { id: guildId },
        select: {
          serverTemplateAppliedAt: true,
          serverTemplateAppliedBy: true,
          serverTemplateSections: true,
          logChannelId: true,
        },
      });

      // Mesurees sur le plan complet : ce sont celles qu'il faut pour tout
      // creer. Une selection reduite peut en demander moins, la page ne bloque
      // donc que sur `canCreateChannels`, sans quoi rien n'est possible.
      const missing = await missingProvisionPermissions(discordGuild, requiredPermissionsFor(DEFAULT_SELECTION))
        .catch(() => [PROVISION_PERMISSION_LABELS[String(PermissionFlagsBits.ManageChannels)]]);
      const me = discordGuild.members.me ?? await discordGuild.members.fetchMe().catch(() => null);

      json(res, 200, {
        locale,
        plan: buildServerTemplatePlan(locale),
        defaultSelection: DEFAULT_SELECTION,
        missingPermissions: missing,
        canCreateChannels: me?.permissions.has(PermissionFlagsBits.ManageChannels) ?? false,
        // Sert de repli au salon d'alerte de la sante des salons : la page ne
        // met en garde que si ce repli n'existe pas non plus.
        hasLogChannel: !!guildRow?.logChannelId,
        isAdministrator: me?.permissions.has(PermissionFlagsBits.Administrator) ?? false,
        applied: guildRow?.serverTemplateAppliedAt
          ? {
              at: guildRow.serverTemplateAppliedAt.toISOString(),
              by: guildRow.serverTemplateAppliedBy,
              selection: guildRow.serverTemplateSections,
            }
          : null,
      });
    } catch (err) {
      logger.error('ServerTemplateAPI', `Error reading template plan: ${errorMessage(err)}`);
      json(res, 500, { error: 'Erreur lors de la lecture du plan de mise en place.' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/server-template/apply
  if (parts.length === 6 && parts[5] === 'apply' && method === 'POST') {
    const lockKey = `server-template:${guildId}`;
    if (!acquireProvisionLock(lockKey)) {
      json(res, 409, { error: 'Une mise en place est déjà en cours sur ce serveur.' });
      return true;
    }

    // Le verrou ci-dessus ne vaut que pour ce serveur. Celui-ci borne le total :
    // une vingtaine d'appels REST par mise en place, tous derriere le meme
    // plafond global de discord.js, et trop de serveurs a la fois laisseraient
    // chaque requete pendre jusqu'a expirer.
    //
    // L'attente est prise en charge ici : la mise en place ne se lancant qu'une
    // fois par serveur, deux appels simultanes viennent de deux serveurs
    // differents et sont l'un comme l'autre legitimes. Le refus n'arrive qu'au
    // bout d'une minute d'attente, ou si la file est deja pleine.
    if (!(await waitForProvisionSlot())) {
      releaseProvisionLock(lockKey);
      json(res, 429, { error: "Trop de mises en place en cours en ce moment. Réessayez dans quelques minutes." });
      return true;
    }

    try {
      const guildRow = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { serverTemplateAppliedAt: true, serverTemplateAppliedBy: true },
      });
      // Une seule fois par serveur. Le deverrouillage passe par un
      // administrateur du bot, depuis le panneau d'administration.
      if (guildRow?.serverTemplateAppliedAt) {
        json(res, 409, {
          error: `La mise en place a déjà été faite par ${guildRow.serverTemplateAppliedBy ?? 'un administrateur'}. Contactez le support pour la relancer.`,
          appliedAt: guildRow.serverTemplateAppliedAt.toISOString(),
        });
        return true;
      }

      const body = await readJsonBody<{ selection?: unknown }>(req);
      const requested = Array.isArray(body?.selection)
        ? body.selection.filter((key): key is string => typeof key === 'string')
        : DEFAULT_SELECTION;
      const selection = normalizeSelection(requested);
      if (selection.length === 0) {
        json(res, 400, { error: 'Aucun élément sélectionné.' });
        return true;
      }

      const missing = await missingProvisionPermissions(discordGuild, requiredPermissionsFor(selection));
      if (missing.length > 0) {
        json(res, 400, { error: `Kotbo n'a pas les permissions nécessaires : ${missing.join(', ')}.` });
        return true;
      }

      // La mise en place est souvent le premier geste sur un serveur neuf : la
      // ligne peut ne pas encore exister, et tout l'enregistrement au fil de
      // l'eau passe par des `update`.
      await prisma.guild.upsert({ where: { id: guildId }, update: {}, create: { id: guildId } });

      const locale = await resolveGuildLocale(guildId, discordGuild.preferredLocale);
      const result = await applyServerTemplate({ guild: discordGuild, locale, selection, auditUser });

      const created = result.items.filter((entry) => entry.created);
      // Le verrou ne se pose que sur une mise en place allee au bout et qui a
      // cree quelque chose. Une tentative sans effet, ou interrompue a
      // mi-chemin, doit pouvoir etre relancee tout de suite : les identifiants
      // deja enregistres garantissent que la reprise ne doublera rien, et
      // condamner le serveur a un passage par le panneau d'administration pour
      // une coupure reseau serait disproportionne.
      if (created.length > 0 && !result.interrupted) {
        await prisma.guild.update({
          where: { id: guildId },
          data: {
            serverTemplateAppliedAt: new Date(),
            serverTemplateAppliedBy: user.username ?? auditUser,
            serverTemplateSections: selection,
          },
        });
      }

      await pushAudit(guildId, {
        user: auditUser,
        action: 'Mise en place du serveur',
        context: getGuildName(client, guildId),
        module: 'Configuration',
        eventType: 'Manuel',
        details: `Créés : ${created.map((entry) => entry.name).join(', ') || 'aucun'}. Repris : ${result.items.filter((entry) => !entry.created).map((entry) => entry.name).join(', ') || 'aucun'}. Modules activés : ${result.modules.join(', ') || 'aucun'}.${result.warnings.length ? ` Avertissements : ${result.warnings.join(' | ')}` : ''}${result.interrupted ? ` Interrompu : ${result.interrupted}` : ''}`,
        channelId: null,
      });

      if (result.interrupted) {
        json(res, 500, {
          error: `Mise en place interrompue : ${result.interrupted}`,
          items: result.items,
          modules: result.modules,
          warnings: result.warnings,
          panelSent: result.panelSent,
        });
        return true;
      }

      json(res, 200, {
        success: true,
        items: result.items,
        modules: result.modules,
        warnings: result.warnings,
        panelSent: result.panelSent,
      });
    } catch (err) {
      logger.error('ServerTemplateAPI', `Error applying server template: ${errorMessage(err)}`);
      json(res, 500, { error: `Mise en place interrompue : ${errorMessage(err)}` });
    } finally {
      releaseProvisionSlot();
      releaseProvisionLock(lockKey);
    }
    return true;
  }

  return false;
}
