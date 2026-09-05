/** Routes dashboard de la mise en place guidee du serveur. */
import prisma from '../../../../utils/db.js';
import { errorMessage } from '../../../../utils/errors.js';
import { resolveGuildLocale } from '../../../../utils/i18n.js';
import { logger } from '../../../../utils/logger.js';
import { getGuildName, json, pushAudit, readJsonBody } from '../../../shared.js';
import {
  DEFAULT_SELECTION,
  TAKEOVER_SELECTION,
  applyServerTemplate,
  assessServerMaturity,
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
import {
  isOnboardingChannelPurpose,
  parseRoleRequests,
  provisionOnboardingChannel,
  provisionOnboardingRoles,
} from '../../../../services/core/onboardingProvisioningService.js';
import { ChannelType, PermissionFlagsBits, type Guild, type GuildBasedChannel } from 'discord.js';
import { type ModuleRouteContext } from './_shared.js';

/**
 * Ce que le serveur porte deja de la maquette.
 *
 * Sans cette lecture, une reprise n'avait qu'une issue : ne rien poser du tout.
 * `ensureTextChannel` ne reconnait un salon existant que s'il en a l'identifiant
 * en base - ce qui est vrai d'un serveur que Kotbo a monte, jamais d'un serveur
 * arrive avec ses vingt salons et son reglement ecrit a la main. Proposer la
 * maquette complete y aurait double `#reglement`, `#bienvenue` et le reste.
 *
 * On rapproche donc chaque element du plan de ce qui existe : par identifiant
 * enregistre d'abord - c'est le seul rapprochement certain -, par nom
 * normalise ensuite. Le nom est faillible, et c'est assume : se tromper ici
 * fait sauter la creation d'un salon que l'admin peut demander d'un clic, alors
 * que l'inverse laisse un doublon dans un serveur habite, qu'il faudra
 * supprimer a la main en expliquant aux membres lequel des deux compte.
 *
 * Les modules n'y figurent jamais : ils n'ecrivent rien sur Discord, il n'y a
 * donc rien a y reconnaitre.
 */
function detectPresentKeys(
  guild: Guild,
  plan: ReturnType<typeof buildServerTemplatePlan>,
  knownRefs: Record<string, string>,
): string[] {
  // Minuscules, accents retires, emoji et ponctuation de decoration enleves :
  // « 📜・Règlement » et « reglement » designent le meme salon, et c'est
  // exactement le cas ou une reprise doit s'abstenir.
  const normalize = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

  const channelsByName = new Map<string, GuildBasedChannel>();
  for (const channel of guild.channels.cache.values()) {
    const key = normalize(channel.name);
    // Le premier trouve gagne : deux salons homonymes sont deja un probleme du
    // serveur, en ajouter un troisieme ne le reglerait pas.
    if (!channelsByName.has(key)) channelsByName.set(key, channel);
  }

  const rolesByName = new Map<string, string>();
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id) continue; // @everyone n'est la maquette de personne
    const key = normalize(role.name);
    if (!rolesByName.has(key)) rolesByName.set(key, role.id);
  }

  const present: string[] = [];

  for (const item of plan) {
    if (item.kind === 'module') continue;

    const knownId = knownRefs[item.key];
    if (knownId) {
      const found = item.kind === 'role'
        ? guild.roles.cache.has(knownId)
        : guild.channels.cache.has(knownId);
      if (found) {
        present.push(item.key);
        continue;
      }
    }

    if (item.kind === 'role') {
      if (rolesByName.has(normalize(item.name))) present.push(item.key);
      continue;
    }

    const channel = channelsByName.get(normalize(item.name));
    if (!channel) continue;

    // Le type doit concorder : un salon vocal nomme « general » ne dispense pas
    // de creer le salon textuel du meme nom, et une categorie encore moins.
    const matches =
      item.kind === 'category'
        ? channel.type === ChannelType.GuildCategory
        : item.kind === 'voice'
          ? channel.type === ChannelType.GuildVoice
          : channel.isTextBased() && !channel.isThread();

    if (matches) present.push(item.key);
  }

  return present;
}

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
          serverTemplateRefs: true,
          logChannelId: true,
        },
      });

      // Mesurees sur le plan complet : ce sont celles qu'il faut pour tout
      // creer. Une selection reduite peut en demander moins, la page ne bloque
      // donc que sur `canCreateChannels`, sans quoi rien n'est possible.
      const missing = await missingProvisionPermissions(discordGuild, requiredPermissionsFor(DEFAULT_SELECTION))
        .catch(() => [PROVISION_PERMISSION_LABELS[String(PermissionFlagsBits.ManageChannels)]]);
      const me = discordGuild.members.me ?? await discordGuild.members.fetchMe().catch(() => null);

      const maturity = assessServerMaturity({
        createdAt: discordGuild.createdAt,
        memberCount: discordGuild.memberCount,
        channelCount: discordGuild.channels.cache.size,
        // `@everyone` existe sur tous les serveurs et ne prouve rien.
        roleCount: Math.max(0, discordGuild.roles.cache.size - 1),
      });

      const plan = buildServerTemplatePlan(locale);
      const knownRefs =
        guildRow?.serverTemplateRefs && typeof guildRow.serverTemplateRefs === 'object'
          && !Array.isArray(guildRow.serverTemplateRefs)
          ? (guildRow.serverTemplateRefs as Record<string, string>)
          : {};

      json(res, 200, {
        locale,
        plan,
        // Ce que le serveur porte deja, pour qu'une reprise complete au lieu de
        // doubler. Vide sur un serveur neuf, ce qui est le cas le plus courant.
        present: detectPresentKeys(discordGuild, plan, knownRefs),
        // Sur un serveur habite, on ne propose que ce qui n'ecrit rien sur
        // Discord : la maquette complete y doublerait des salons utilises.
        defaultSelection: maturity.maturity === 'established' ? TAKEOVER_SELECTION : DEFAULT_SELECTION,
        missingPermissions: missing,
        canCreateChannels: me?.permissions.has(PermissionFlagsBits.ManageChannels) ?? false,
        // Sert de repli au salon d'alerte de la sante des salons : la page ne
        // met en garde que si ce repli n'existe pas non plus.
        hasLogChannel: !!guildRow?.logChannelId,
        isAdministrator: me?.permissions.has(PermissionFlagsBits.Administrator) ?? false,
        // Serveur neuf a batir ou serveur habite a reprendre. La page l'affiche
        // avec ses motifs : la detection se trompera parfois, et une
        // recommandation dont on ne voit pas la raison se fait ignorer.
        maturity,
        /** Maquette complete, pour le bouton « tout cocher » d'une reprise. */
        fullSelection: DEFAULT_SELECTION,
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
        details: `Créés : ${created.map((entry) => entry.name).join(', ') || 'aucun'}. Repris : ${result.items.filter((entry) => !entry.created).map((entry) => entry.name).join(', ') || 'aucun'}. Modules activés : ${result.modules.join(', ') || 'aucun'}.${result.preparedModules.length ? ` Préparés, en attente d'abonnement : ${result.preparedModules.join(', ')}.` : ''}${result.warnings.length ? ` Avertissements : ${result.warnings.join(' | ')}` : ''}${result.interrupted ? ` Interrompu : ${result.interrupted}` : ''}`,
        channelId: null,
      });

      if (result.interrupted) {
        json(res, 500, {
          error: `Mise en place interrompue : ${result.interrupted}`,
          items: result.items,
          modules: result.modules,
          preparedModules: result.preparedModules,
          warnings: result.warnings,
          panelSent: result.panelSent,
        });
        return true;
      }

      json(res, 200, {
        success: true,
        items: result.items,
        modules: result.modules,
        preparedModules: result.preparedModules,
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

  // POST /api/dashboard/guilds/:guildId/server-template/channel
  //
  // Le parcours demande de designer un salon ; le serveur n'en a pas. Plutot
  // que de renvoyer l'administrateur creer un `#log` sur Discord et revenir
  // rafraichir la page, on le pose ici et l'ecran le selectionne dans la
  // foulee.
  if (parts.length === 6 && parts[5] === 'channel' && method === 'POST') {
    const lockKey = `onboarding-channel:${guildId}`;
    if (!acquireProvisionLock(lockKey)) {
      json(res, 409, { error: 'Un salon est déjà en cours de création sur ce serveur.' });
      return true;
    }

    try {
      const body = await readJsonBody<{ purpose?: unknown; name?: unknown }>(req);
      if (!isOnboardingChannelPurpose(body?.purpose)) {
        json(res, 400, { error: 'Usage de salon inconnu.' });
        return true;
      }

      const locale = await resolveGuildLocale(guildId, discordGuild.preferredLocale);
      // Premier geste possible sur un serveur neuf : la ligne peut ne pas
      // exister encore, et la trace des elements poses s'ecrit par `update`.
      await prisma.guild.upsert({ where: { id: guildId }, update: {}, create: { id: guildId } });

      const channel = await provisionOnboardingChannel({
        guild: discordGuild,
        locale,
        purpose: body.purpose,
        name: body.name,
        auditUser,
      });

      if (channel.created) {
        await pushAudit(guildId, {
          user: auditUser,
          action: 'Salon créé depuis la configuration',
          context: getGuildName(client, guildId),
          module: 'Configuration',
          eventType: 'Manuel',
          details: `#${channel.name}`,
          channelId: channel.id,
        });
      }

      json(res, 200, channel);
    } catch (err) {
      logger.error('ServerTemplateAPI', `Error creating onboarding channel: ${errorMessage(err)}`);
      json(res, 500, { error: errorMessage(err) || "Le salon n'a pas pu être créé." });
    } finally {
      releaseProvisionLock(lockKey);
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/server-template/roles
  //
  // Une hierarchie de staff, ou une echelle de roles de niveau. Les deux
  // ecrans en ont besoin et demandent la meme chose : quelques roles, dans un
  // ordre, avec des pouvoirs choisis dans une liste fermee cote serveur.
  if (parts.length === 6 && parts[5] === 'roles' && method === 'POST') {
    const lockKey = `onboarding-roles:${guildId}`;
    if (!acquireProvisionLock(lockKey)) {
      json(res, 409, { error: 'Des rôles sont déjà en cours de création sur ce serveur.' });
      return true;
    }

    try {
      const body = await readJsonBody<{ roles?: unknown }>(req);
      const roles = parseRoleRequests(body?.roles);
      if (roles.length === 0) {
        json(res, 400, { error: 'Aucun rôle à créer.' });
        return true;
      }

      const locale = await resolveGuildLocale(guildId, discordGuild.preferredLocale);
      await prisma.guild.upsert({ where: { id: guildId }, update: {}, create: { id: guildId } });

      const result = await provisionOnboardingRoles({
        guild: discordGuild,
        locale,
        roles,
        auditUser,
      });

      const created = result.roles.filter((entry) => entry.created);
      if (created.length > 0) {
        await pushAudit(guildId, {
          user: auditUser,
          action: 'Rôles créés depuis la configuration',
          context: getGuildName(client, guildId),
          module: 'Configuration',
          eventType: 'Manuel',
          details: created.map((entry) => entry.name).join(', '),
          channelId: null,
        });
      }

      json(res, 200, result);
    } catch (err) {
      logger.error('ServerTemplateAPI', `Error creating onboarding roles: ${errorMessage(err)}`);
      json(res, 500, { error: errorMessage(err) || "Les rôles n'ont pas pu être créés." });
    } finally {
      releaseProvisionLock(lockKey);
    }
    return true;
  }

  return false;
}
