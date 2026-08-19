import type { Prisma } from '@prisma/client';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Client, ChannelType, type Guild, type GuildBasedChannel } from 'discord.js';
import pLimit from 'p-limit';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { isGuildActivated, activateGuild } from '../../../utils/activation.js';
import { translate } from '../../../services/integrations/translationService.js';
import { cache } from '../../../utils/cache.js';
import { getGuildLanguageState, normalizeLocale } from '../../../utils/i18n.js';
import { DEFAULT_TIMEZONE, isValidTimezone, listSupportedTimezones, normalizeTimezone } from '@kotbo/contracts';
import { rerenderPersistentPanels } from '../../../services/core/panelRerenderService.js';
import {
  json,
  readJsonBody,
  getGuildName,
  resolveAdminAccess,
  resolveDashboardAccess,
  getGuildState,
  type AuthClaims,
  type DashboardAccess,
} from '../../shared.js';

export async function handleGeneralRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims
): Promise<boolean> {
  const method = req.method;

  // POST /api/dashboard/translate
  if (parts.length === 3 && parts[2] === 'translate' && method === 'POST') {
    try {
      const body = await readJsonBody<{ text: string; targetLang?: string }>(req);
      if (!body?.text) {
        json(res, 400, { error: 'Texte à traduire requis' });
        return true;
      }
      const translatedText = await translate(body.text, body.targetLang || 'fr');
      json(res, 200, { translatedText });
    } catch (err) {
      logger.error('GeneralAPI', 'Error translating text:', err);
      json(res, 500, { error: 'Erreur lors de la traduction' });
    }
    return true;
  }

  // GET|PATCH /api/dashboard/guilds/:guildId/language
  //
  // Expose la carte « Langue du bot » de l'accueil. `language: null` cote base
  // signifie « detection automatique » : la cascade retombe alors sur la langue
  // declaree du serveur Discord, puis sur l'anglais.
  if (parts.length === 5 && parts[2] === 'guilds' && parts[4] === 'language' && (method === 'GET' || method === 'PATCH')) {
    const guildId = parts[3]!;
    try {
      const access = await resolveDashboardAccess(client, guildId, user.userId);
      if (!access.canViewDashboard) {
        json(res, 403, { error: 'Accès refusé' });
        return true;
      }

      const discordGuild = client.guilds.cache.get(guildId) ?? null;
      const detected = normalizeLocale(discordGuild?.preferredLocale ?? null);

      if (method === 'PATCH') {
        if (!access.canManageSettings) {
          json(res, 403, { error: 'Accès refusé' });
          return true;
        }

        const body = await readJsonBody<{ mode?: 'auto' | 'manual'; language?: string | null }>(req);
        const wantsAuto = body?.mode === 'auto' || body?.language === null;
        const requested = wantsAuto ? null : normalizeLocale(body?.language);

        if (!wantsAuto && !requested) {
          json(res, 400, { error: "Langue invalide : utilisez 'fr', 'en', ou mode 'auto'" });
          return true;
        }

        const before = await getGuildLanguageState(guildId, discordGuild?.preferredLocale ?? null);

        await prisma.guild.upsert({
          where: { id: guildId },
          update: { language: requested },
          create: { id: guildId, language: requested },
        });
        await cache.invalidateGuild(guildId);

        const after = await getGuildLanguageState(guildId, discordGuild?.preferredLocale ?? null);

        // Ecrire la langue ne reecrit pas les messages deja publies : sans ce
        // re-rendu, les panneaux persistants restent dans l'ancienne langue et le
        // reglage passe pour inoperant. C'est ce que fait `/languages rerender`,
        // qui reste utile apres une modification de gabarit.
        const rerender = after.locale === before.locale
          ? null
          : await rerenderPersistentPanels(client, guildId);

        json(res, 200, {
          mode: after.mode,
          locale: after.locale,
          detected,
          available: ['fr', 'en'],
          rerender: rerender && {
            updated: rerender.updated,
            skipped: rerender.skipped,
            failed: rerender.failed,
          },
        });
        return true;
      }

      const state = await getGuildLanguageState(guildId, discordGuild?.preferredLocale ?? null);
      json(res, 200, {
        mode: state.mode,
        locale: state.locale,
        detected,
        available: ['fr', 'en'],
        rerender: null,
      });
    } catch (err) {
      logger.error('GeneralAPI', `Error handling language for guild ${guildId}:`, err);
      json(res, 500, { error: 'Erreur lors de la gestion de la langue' });
    }
    return true;
  }

  // GET|PATCH /api/dashboard/guilds/:guildId/timezone
  //
  // Le bot tourne en UTC : sans ce reglage, une reunion saisie a 21h etait
  // enregistree a 23h heure de Paris et annoncee a 19h dans les notifications.
  if (parts.length === 5 && parts[2] === 'guilds' && parts[4] === 'timezone' && (method === 'GET' || method === 'PATCH')) {
    const guildId = parts[3]!;
    try {
      const access = await resolveDashboardAccess(client, guildId, user.userId);
      if (!access.canViewDashboard) {
        json(res, 403, { error: 'Accès refusé' });
        return true;
      }

      if (method === 'PATCH') {
        if (!access.canManageSettings) {
          json(res, 403, { error: 'Accès refusé' });
          return true;
        }

        const body = await readJsonBody<{ timezone?: string | null }>(req);
        const requested = body?.timezone ?? DEFAULT_TIMEZONE;

        if (!isValidTimezone(requested)) {
          json(res, 400, { error: 'Fuseau horaire invalide : utilisez un identifiant IANA (ex. Europe/Paris)' });
          return true;
        }

        await prisma.guild.upsert({
          where: { id: guildId },
          update: { timezone: requested },
          create: { id: guildId, timezone: requested },
        });
        await cache.invalidateGuild(guildId);

        json(res, 200, { timezone: requested, default: DEFAULT_TIMEZONE, available: listSupportedTimezones() });
        return true;
      }

      const guild = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { timezone: true },
      });

      json(res, 200, {
        timezone: normalizeTimezone(guild?.timezone),
        default: DEFAULT_TIMEZONE,
        available: listSupportedTimezones(),
      });
    } catch (err) {
      logger.error('GeneralAPI', `Error handling timezone for guild ${guildId}:`, err);
      json(res, 500, { error: 'Erreur lors de la gestion du fuseau horaire' });
    }
    return true;
  }

  // GET /api/dashboard/guilds
  if (parts.length === 3 && parts[2] === 'guilds' && method === 'GET') {
    try {
      const guilds = await prisma.guild.findMany({
        orderBy: { updatedAt: 'desc' },
        select: { id: true, updatedAt: true }
      });

      const isGlobalAdmin = await resolveAdminAccess(client, user.userId);
      const visibleGuilds = guilds
        .map((guild) => ({ guild, activated: isGuildActivated(guild.id) }))
        .filter(({ activated }) => activated || isGlobalAdmin);

      // Cette route est le chemin critique de l'ecran de connexion : elle
      // s'executait en serie alors que `resolveDashboardAccess` fait un
      // `members.fetch()` Discord par serveur. Sur un compte present dans
      // plusieurs dizaines de serveurs, les allers-retours s'additionnaient.
      //
      // La concurrence est bornee pour ne pas envoyer d'un coup autant de
      // requetes que de serveurs a l'API Discord.
      const limit = pLimit(10);
      const resolved = await Promise.all(
        visibleGuilds.map(({ guild, activated }) =>
          limit(async () => {
            const access = await resolveDashboardAccess(client, guild.id, user.userId);
            if (!access.canViewDashboard) return null;

            return {
              id: guild.id,
              name: getGuildName(client, guild.id),
              updatedAt: guild.updatedAt.toISOString(),
              accessLevel: (access.level === 'admin' ? 'admin' : 'moderator') as 'admin' | 'moderator',
              activated,
            };
          })
        )
      );

      // `Promise.all` preserve l'ordre : le tri par `updatedAt` desc est conserve.
      json(res, 200, { guilds: resolved.filter((entry) => entry !== null) });
    } catch (err) {
      logger.error('GeneralAPI', 'Error listing guilds:', err);
      json(res, 500, { error: 'Erreur lors de la récupération des serveurs' });
    }
    return true;
  }

  // GET /api/dashboard/presets/shared/:token - public access by share token
  if (parts.length === 5 && parts[2] === 'presets' && parts[3] === 'shared' && method === 'GET') {
    const shareToken = parts[4];
    try {
      const preset = await prisma.dashboardLayoutPreset.findUnique({
        where: { shareToken },
        select: { id: true, name: true, description: true, creatorId: true, guildId: true, layout: true, isPublic: true, shareToken: true, createdAt: true, updatedAt: true }
      });
      if (!preset || !preset.isPublic) {
        json(res, 404, { error: 'Preset partagé introuvable.' });
        return true;
      }
      json(res, 200, { preset });
    } catch (err) {
      logger.error('GeneralAPI', `Error fetching shared preset ${shareToken}:`, err);
      json(res, 500, { error: 'Erreur lors de la récupération du preset partagé.' });
    }
    return true;
  }

  return false;
}

export async function handleGuildGeneralRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  client: Client,
  user: AuthClaims,
  guildId: string,
  access: DashboardAccess
): Promise<boolean> {
  const method = req.method;

  // GET /api/dashboard/guilds/:guildId or /api/dashboard/guilds/:guildId/state
  if ((parts.length === 4 || (parts.length === 5 && parts[4] === 'state')) && method === 'GET') {
    try {
      const state = await getGuildState(client, guildId, access, user.userId, {
        overview: url.searchParams.get('scope') === 'overview',
      });
      if (!state) {
        json(res, 404, { error: 'Guilde introuvable' });
        return true;
      }
      json(res, 200, state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('GeneralAPI', `Error getting guild state for ${guildId}:`, err);
      const hint = /column|sidebarFavorites|commandRestrictions|channelId/i.test(message)
        ? 'Exécutez les migrations Prisma : bun run db:migrate:deploy'
        : undefined;
      json(res, 500, {
        error: "Erreur interne de chargement de l'état de la guilde",
        ...(hint ? { hint } : {}),
      });
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/channels - salons Discord (texte, vocal, catégories)
  if (parts.length === 5 && parts[4] === 'channels' && method === 'GET') {
    try {
      let discordGuild = client.guilds.cache.get(guildId) ?? null;
      if (!discordGuild) {
        discordGuild = await client.guilds.fetch(guildId).catch(() => null) as Guild | null;
      }
      if (!discordGuild) {
        json(res, 404, { error: 'Serveur Discord introuvable' });
        return true;
      }
      if (discordGuild.channels.cache.size === 0) {
        await discordGuild.channels.fetch().catch(() => null);
      }
      const allCh = Array.from(discordGuild.channels.cache.values()) as GuildBasedChannel[];
      const textChannelTypes = new Set([
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildVoice,
        ChannelType.GuildForum,
        ChannelType.GuildMedia,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
      ]);
      const channelTypeLabel = (type: ChannelType) => {
        switch (type) {
          case ChannelType.GuildAnnouncement: return 'announcement';
          case ChannelType.GuildVoice: return 'voice';
          case ChannelType.GuildForum: return 'forum';
          case ChannelType.GuildMedia: return 'media';
          case ChannelType.PublicThread:
          case ChannelType.PrivateThread:
          case ChannelType.AnnouncementThread:
            return 'thread';
          default: return 'text';
        }
      };
      const textChannels = allCh
        .filter((ch) => textChannelTypes.has(ch.type))
        .map((ch) => ({ id: ch.id, name: ch.name, mention: `<#${ch.id}>`, position: 'rawPosition' in ch ? ch.rawPosition : 0, type: channelTypeLabel(ch.type) }))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'))
        .map(({ id, name, mention, type }) => ({ id, name, mention, type }));
      const voiceChannels = allCh
        .filter((ch) => ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)
        .map((ch) => ({ id: ch.id, name: ch.name, mention: `<#${ch.id}>`, position: ch.rawPosition ?? 0 }))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'))
        .map(({ id, name, mention }) => ({ id, name, mention }));
      const categories = allCh
        .filter((ch) => ch.type === ChannelType.GuildCategory)
        .map((ch) => ({ id: ch.id, name: ch.name, mention: `<#${ch.id}>`, position: ch.rawPosition ?? 0 }))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'))
        .map(({ id, name, mention }) => ({ id, name, mention }));

      json(res, 200, { textChannels, voiceChannels, categories });
    } catch (err) {
      logger.error('GeneralAPI', `Error getting guild channels for ${guildId}:`, err);
      json(res, 500, { error: 'Erreur lors de la récupération des salons Discord' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/activate - Activate a guild with a code
  if (parts.length === 5 && parts[4] === 'activate' && method === 'POST') {
    try {
      const isGlobalAdmin = await resolveAdminAccess(client, user.userId);
      const canActivate = isGlobalAdmin || access.level === 'admin';
      if (!canActivate) {
        json(res, 403, { error: 'Seuls les administrateurs du serveur ou les administrateurs globaux peuvent activer ce serveur.' });
        return true;
      }

      const body = await readJsonBody<{ code?: string }>(req);
      const rawCode = body?.code?.trim() || '';
      if (!rawCode) {
        json(res, 400, { error: "Le code d'activation est requis." });
        return true;
      }

      const codeRow = await prisma.activationCode.findUnique({
        where: { code: rawCode.toUpperCase() }
      });

      if (!codeRow) {
        json(res, 404, { error: "Code d'activation introuvable." });
        return true;
      }

      if (!codeRow.isActive || codeRow.usedAt) {
        json(res, 400, { error: "Ce code d'activation a déjà été utilisé ou est désactivé." });
        return true;
      }

      await activateGuild(guildId, rawCode);
      json(res, 200, { ok: true, message: 'Le serveur a été activé avec succès.' });
    } catch (err) {
      logger.error('GeneralAPI', `Error activating guild ${guildId}:`, err);
      json(res, 500, { error: "Erreur lors de l'activation du serveur." });
    }
    return true;
  }

  // GET /api/dashboard/guilds/:guildId/user-settings
  if (parts.length === 5 && parts[4] === 'user-settings' && method === 'GET') {
    try {
      const settings = await prisma.dashboardUserSettings.findUnique({
        where: {
          guildId_userId: {
            guildId,
            userId: user.userId
          }
        }
      });
      
      if (!settings) {
        json(res, 200, {
          bentoLayout: null,
          themeId: 'dark',
          customTheme: null,
          accentColor: 'violet',
          sidebarBehavior: 'auto',
          compactMode: false
        });
        return true;
      }
      
      json(res, 200, {
        bentoLayout: settings.bentoLayout,
        themeId: settings.themeId,
        customTheme: settings.customTheme,
        accentColor: settings.accentColor,
        sidebarBehavior: settings.sidebarBehavior,
        compactMode: settings.compactMode
      });
    } catch (err) {
      logger.error('GeneralAPI', `Error fetching user-settings for ${guildId} / ${user.userId}:`, err);
      json(res, 500, { error: 'Erreur lors de la récupération des préférences.' });
    }
    return true;
  }

  // PUT /api/dashboard/guilds/:guildId/user-settings
  if (parts.length === 5 && parts[4] === 'user-settings' && method === 'PUT') {
    try {
      const body = await readJsonBody<any>(req);
      const settings = await prisma.dashboardUserSettings.upsert({
        where: {
          guildId_userId: {
            guildId,
            userId: user.userId
          }
        },
        create: {
          guildId,
          userId: user.userId,
          bentoLayout: body?.bentoLayout ?? null,
          themeId: body?.themeId ?? 'dark',
          customTheme: body?.customTheme ?? null,
          accentColor: body?.accentColor ?? 'violet',
          sidebarBehavior: body?.sidebarBehavior ?? 'auto',
          compactMode: body?.compactMode ?? false
        },
        update: {
          bentoLayout: body?.bentoLayout !== undefined ? body.bentoLayout : undefined,
          themeId: body?.themeId !== undefined ? body.themeId : undefined,
          customTheme: body?.customTheme !== undefined ? body.customTheme : undefined,
          accentColor: body?.accentColor !== undefined ? body.accentColor : undefined,
          sidebarBehavior: body?.sidebarBehavior !== undefined ? body.sidebarBehavior : undefined,
          compactMode: body?.compactMode !== undefined ? body.compactMode : undefined
        }
      });
      
      json(res, 200, {
        ok: true,
        settings: {
          bentoLayout: settings.bentoLayout,
          themeId: settings.themeId,
          customTheme: settings.customTheme,
          accentColor: settings.accentColor,
          sidebarBehavior: settings.sidebarBehavior,
          compactMode: settings.compactMode
        }
      });
    } catch (err) {
      logger.error('GeneralAPI', `Error updating user-settings for ${guildId} / ${user.userId}:`, err);
      json(res, 500, { error: 'Erreur lors de la mise à jour des préférences.' });
    }
    return true;
  }

  // ============================================================================
  // BENTO LAYOUT PRESETS
  // ============================================================================

  // GET /api/dashboard/guilds/:guildId/layout-presets
  if (parts.length === 5 && parts[4] === 'layout-presets' && method === 'GET') {
    try {
      const presets = await prisma.dashboardLayoutPreset.findMany({
        where: { guildId, creatorId: user.userId },
        orderBy: { updatedAt: 'desc' }
      });
      json(res, 200, { presets });
    } catch (err) {
      logger.error('GeneralAPI', `Error fetching presets for ${guildId}:`, err);
      json(res, 500, { error: 'Erreur lors de la récupération des presets.' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/layout-presets
  if (parts.length === 5 && parts[4] === 'layout-presets' && method === 'POST') {
    try {
      const body = await readJsonBody<{ name: string; description?: string; layout: any[]; isPublic?: boolean }>(req);
      if (!body?.name || !body?.layout) {
        json(res, 400, { error: 'Nom et layout requis.' });
        return true;
      }
      const preset = await prisma.dashboardLayoutPreset.create({
        data: {
          guildId,
          creatorId: user.userId,
          name: body.name,
          description: body.description || '',
          layout: body.layout,
          isPublic: body.isPublic ?? false
        }
      });
      json(res, 201, { preset });
    } catch (err) {
      logger.error('GeneralAPI', `Error creating preset for ${guildId}:`, err);
      json(res, 500, { error: 'Erreur lors de la création du preset.' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/layout-presets/import
  if (parts.length === 6 && parts[4] === 'layout-presets' && parts[5] === 'import' && method === 'POST') {
    try {
      const body = await readJsonBody<{ name: string; description?: string; layout: any[] }>(req);
      if (!body?.name || !body?.layout) {
        json(res, 400, { error: 'Nom et layout requis.' });
        return true;
      }
      const preset = await prisma.dashboardLayoutPreset.create({
        data: {
          guildId,
          creatorId: user.userId,
          name: body.name,
          description: body.description || 'Importé',
          layout: body.layout,
          isPublic: false
        }
      });
      json(res, 201, { preset });
    } catch (err) {
      logger.error('GeneralAPI', `Error importing preset for ${guildId}:`, err);
      json(res, 500, { error: 'Erreur lors de l\'import du preset.' });
    }
    return true;
  }

  // DELETE /api/dashboard/guilds/:guildId/layout-presets/:presetId
  if (parts.length === 6 && parts[4] === 'layout-presets' && method === 'DELETE') {
    const presetId = parts[5];
    try {
      const existing = await prisma.dashboardLayoutPreset.findFirst({
        where: { id: presetId, guildId, creatorId: user.userId }
      });
      if (!existing) {
        json(res, 404, { error: 'Preset introuvable ou accès refusé.' });
        return true;
      }
      await prisma.dashboardLayoutPreset.delete({ where: { id: presetId } });
      json(res, 200, { ok: true });
    } catch (err) {
      logger.error('GeneralAPI', `Error deleting preset ${presetId}:`, err);
      json(res, 500, { error: 'Erreur lors de la suppression du preset.' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/layout-presets/:presetId/share
  if (parts.length === 7 && parts[4] === 'layout-presets' && parts[6] === 'share' && method === 'POST') {
    const presetId = parts[5];
    try {
      const existing = await prisma.dashboardLayoutPreset.findFirst({
        where: { id: presetId, guildId, creatorId: user.userId }
      });
      if (!existing) {
        json(res, 404, { error: 'Preset introuvable ou accès refusé.' });
        return true;
      }
      // Generate a unique share token
      const shareToken = existing.shareToken ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      const updated = await prisma.dashboardLayoutPreset.update({
        where: { id: presetId },
        data: { shareToken, isPublic: true }
      });
      json(res, 200, { shareToken: updated.shareToken, shareUrl: `/?importPreset=${updated.shareToken}` });
    } catch (err) {
      logger.error('GeneralAPI', `Error sharing preset ${presetId}:`, err);
      json(res, 500, { error: 'Erreur lors du partage du preset.' });
    }
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/layout-presets/:presetId/apply
  if (parts.length === 7 && parts[4] === 'layout-presets' && parts[6] === 'apply' && method === 'POST') {
    const presetId = parts[5];
    try {
      // User can apply their own presets or public ones
      const preset = await prisma.dashboardLayoutPreset.findFirst({
        where: { id: presetId, guildId, OR: [{ creatorId: user.userId }, { isPublic: true }] }
      });
      if (!preset) {
        json(res, 404, { error: 'Preset introuvable ou accès refusé.' });
        return true;
      }
      // Apply by updating user settings
      await prisma.dashboardUserSettings.upsert({
        where: { guildId_userId: { guildId, userId: user.userId } },
        create: { guildId, userId: user.userId, bentoLayout: preset.layout as Prisma.InputJsonValue },
        update: { bentoLayout: preset.layout as Prisma.InputJsonValue }
      });
      json(res, 200, { ok: true, layout: preset.layout });
    } catch (err) {
      logger.error('GeneralAPI', `Error applying preset ${presetId}:`, err);
      json(res, 500, { error: 'Erreur lors de l\'application du preset.' });
    }
    return true;
  }

  return false;
}
