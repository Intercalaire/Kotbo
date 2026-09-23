import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { resolveMemberAvatarUrl } from '../../../services/moderation/memberIdentityService.js';
import { logger } from '../../../utils/logger.js';
import { getOrCreateEconomyConfig, adminDeleteShopItem } from '../../../services/features/economyService.js';
import { json, readJsonBody, getGuildName, pushAudit, type AuthClaims, type DashboardAccess } from '../../shared.js';
import {
  BestiaryError,
  deleteGuildMonster,
  listGuildMonsters,
  saveGuildMonster,
  setGuildMonsterEnabled,
} from '../../../services/features/rpg/rpgBestiaryService.js';
import { parseMonsterDrops, type MonsterInput } from '../../../services/features/rpg/rpgBestiaryPolicy.js';
import { assertFirstKillRole, listFirstKills } from '../../../services/features/rpg/rpgFirstKillService.js';
import {
  deleteGuildTitle,
  grantTitle,
  listGuildTitles,
  revokeTitle,
  saveGuildTitle,
  TitleError,
} from '../../../services/features/rpg/rpgTitleService.js';
import type { TitleInput } from '../../../services/features/rpg/rpgTitlePolicy.js';
import type { RpgItemPayload } from '@kotbo/contracts';
import { saveGuildShopItem, ShopItemError } from '../../../services/features/rpg/rpgShopItemService.js';
import {
  adminGrantItem,
  adminTakeItem,
  adminUpdatePlayerStats,
  getPlayerInventory,
  PlayerAdminError,
  type PlayerStatsInput,
} from '../../../services/features/rpg/rpgPlayerAdminService.js';
import {
  EconomyConfigError,
  updateEconomySettings,
  withModuleFlags,
  type EconomySettingsInput,
} from '../../../services/features/rpg/rpgEconomyConfigService.js';
import {
  asDifficulty,
  isDifficulty,
  recommendDifficulty,
} from '../../../services/features/rpg/rpgDifficultyPolicy.js';
import {
  applyBestiaryDifficulty,
  applyShopDifficulty,
  findDifficultyDrift,
  getBestiaryBattleStats,
  summarizeBattles,
} from '../../../services/features/rpg/rpgDifficultyService.js';
import {
  exportGuildBestiary,
  importGuildBestiary,
} from '../../../services/features/rpg/rpgBestiaryTransferService.js';
import {
  deleteGuildRaidBoss,
  getOpenRaid,
  getRaidRecap,
  getRaidState,
  listGuildRaidBosses,
  listRaidHistory,
  listRaidTeams,
  RaidError,
  resyncScheduledRaidBoss,
  saveGuildRaidBoss,
  seedGuildRaidBosses,
  startRaidNow,
} from '../../../services/features/rpg/rpgRaidService.js';
import { announceOpenRaid } from '../../../services/features/rpg/rpgRaidPanel.js';
import {
  deleteGuildRecipe,
  listGuildRecipes,
  RecipeError,
  saveGuildRecipe,
} from '../../../services/features/rpg/rpgRecipeService.js';
import { RAID_SPELLS } from '../../../services/features/rpg/rpgRaidContent.js';
import {
  deleteGuildQuest,
  listGuildQuests,
  QuestError,
  saveGuildQuest,
} from '../../../services/features/rpg/rpgQuestService.js';
import {
  questWindowBounds,
  RPG_QUEST_OBJECTIVES,
  RPG_QUEST_SCOPES,
  type RpgQuestInput,
} from '../../../services/features/rpg/rpgQuestPolicy.js';
import type { RaidBossInput } from '../../../services/features/rpg/rpgRaidPolicy.js';
import type { RecipeInput } from '../../../services/features/rpg/rpgRecipePolicy.js';
import {
  ADVENTURE_CHOICE_TEXT_MAX,
  ADVENTURE_CHOICES_MAX,
  ADVENTURE_DESCRIPTION_MAX,
  ADVENTURE_TITLE_MAX,
  AdventureEventError,
  deleteGuildAdventureEvent,
  listGuildAdventureEvents,
  saveGuildAdventureEvent,
  setGlobalAdventureEventEnabled,
  type AdventureEventInput,
} from '../../../services/features/rpg/rpgAdventureEventService.js';
import {
  adminDissolveRpgGuild,
  adminRemoveRpgGuildMember,
  adminUpdateRpgGuild,
  listRpgGuildsForAdmin,
  RpgGuildAdminError,
  type RpgGuildAdminEdit,
} from '../../../services/features/rpg/rpgGuildAdminService.js';
import { jsonFailure } from '../../shared/failure.js';
import {
  normalizeCommandRestrictions,
  readCommandChannels,
  RPG_CHANNEL_COMMANDS,
  withCommandChannels,
} from '../../../utils/commandAccess.js';
import type { Prisma } from '@prisma/client';

/** Le type du corps de requête ne vaut qu'à la compilation : la valeur reçue est vérifiée. */
const RESET_COMPONENTS = new Set(['all', 'profiles', 'items', 'config', 'guilds', 'bestiary']);

/** Fenêtre d'observation des combats : assez large pour un petit serveur, assez courte pour
 *  qu'un réglage récent ne reste pas jugé sur l'ancien équilibrage. */
const BATTLE_STATS_DAYS = 30;

export async function handleEconomyRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  client: Client,
  user: AuthClaims,
  guildId: string,
  _access: DashboardAccess
): Promise<boolean> {
  const method = req.method;
  const auditUser = `${user.username} (${user.userId})`;
  
  // parts[4] === 'economy'
  const subAction = parts[5]; // config | items | monsters | players

  // 1. Economy Configuration Routes
  if (subAction === 'config') {
    // GET /api/dashboard/guilds/:guildId/economy/config
    if (parts.length === 6 && method === 'GET') {
      try {
        const config = await getOrCreateEconomyConfig(guildId);
        json(res, 200, { config: await withModuleFlags(guildId, config) });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching economy config:', err);
        jsonFailure(res, err, "Erreur lors de la récupération de la configuration de l'économie.", 'EconomyAPI');
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/economy/config
    if (parts.length === 6 && method === 'PATCH') {
      try {
        const body = await readJsonBody<EconomySettingsInput>(req);
        const config = await updateEconomySettings(guildId, body);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Mise à jour configuration Économie',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `Config éco mise à jour. Économie active: ${config.enabled}, RPG: ${config.rpgEnabled}`,
          channelId: null
        });

        json(res, 200, { config });
      } catch (err) {
        if (err instanceof EconomyConfigError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error updating economy config:', err);
        jsonFailure(res, err, "Erreur lors de la mise à jour de la configuration de l'économie.", 'EconomyAPI');
      }
      return true;
    }
  }

  // Salons RPG : une vue sur les règles d'accès de /rpg et /raid, stockées avec les autres
  // restrictions de commandes pour que le bot n'ait qu'un seul endroit à consulter.
  if (subAction === 'rpg-channels' && parts.length === 6) {
    if (method === 'GET') {
      try {
        const settings = await prisma.dashboardSettings.findUnique({ where: { guildId }, select: { commandRestrictions: true } });
        const rules = normalizeCommandRestrictions(settings?.commandRestrictions);
        json(res, 200, readCommandChannels(rules, RPG_CHANNEL_COMMANDS));
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching RPG channels:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération des salons RPG.', 'EconomyAPI');
      }
      return true;
    }

    if (method === 'PUT') {
      try {
        const body = await readJsonBody<{ channelIds?: unknown }>(req);
        if (!body || !Array.isArray(body.channelIds)) {
          json(res, 400, { error: 'Liste de salons invalide.' });
          return true;
        }

        const settings = await prisma.dashboardSettings.findUnique({ where: { guildId }, select: { commandRestrictions: true } });
        const rules = withCommandChannels(
          normalizeCommandRestrictions(settings?.commandRestrictions),
          RPG_CHANNEL_COMMANDS,
          body.channelIds as string[],
        );
        const commandRestrictions = rules as unknown as Prisma.InputJsonValue;
        await prisma.dashboardSettings.upsert({
          where: { guildId },
          update: { commandRestrictions },
          create: { guildId, commandRestrictions },
        });
        const { channelIds } = readCommandChannels(rules, RPG_CHANNEL_COMMANDS);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Mise à jour salons RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: channelIds.length > 0 ? `${channelIds.length} salon(s) autorisé(s) pour /rpg et /raid.` : 'RPG autorisé dans tous les salons.',
          channelId: null
        });

        json(res, 200, { channelIds, diverged: false });
      } catch (err) {
        logger.error('EconomyAPI', 'Error updating RPG channels:', err);
        jsonFailure(res, err, 'Erreur lors de la mise à jour des salons RPG.', 'EconomyAPI');
      }
      return true;
    }
  }

  // 2. Shop Items Routes
  if (subAction === 'items') {
    // GET /api/dashboard/guilds/:guildId/economy/items
    if (parts.length === 6 && method === 'GET') {
      try {
        const items = await prisma.rpgItem.findMany({
          where: {
            OR: [
              { guildId: null },
              { guildId }
            ]
          },
          orderBy: { price: 'asc' }
        });
        json(res, 200, { items });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching shop items:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération des objets de la boutique.', 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/items (Create/Update Item)
    if (parts.length === 6 && method === 'POST') {
      try {
        const body = await readJsonBody<RpgItemPayload>(req);
        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        const { item } = await saveGuildShopItem(guildId, body);

        await pushAudit(guildId, {
          user: auditUser,
          action: body.id ? 'Modification objet boutique' : 'Création objet boutique',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `Objet: ${body.name} (${body.type}) - Prix: ${body.price}`,
          channelId: null
        });

        json(res, 200, { item });
      } catch (err) {
        if (err instanceof ShopItemError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error saving shop item:', err);
        jsonFailure(res, err, "Erreur lors de la sauvegarde de l'objet.", 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/items/difficulty
    if (parts.length === 7 && parts[6] === 'difficulty' && method === 'POST') {
      try {
        const body = await readJsonBody<{ difficulty?: string; preview?: boolean }>(req);
        if (!body || !isDifficulty(body.difficulty)) {
          json(res, 400, { error: 'Palier de difficulté inconnu.' });
          return true;
        }

        const config = await getOrCreateEconomyConfig(guildId);
        const from = asDifficulty(config.shopDifficulty);
        const dryRun = body.preview === true;

        const { updated, preview, protectedItems, catalogItems } = await applyShopDifficulty(
          guildId,
          { from, to: body.difficulty, dryRun },
        );

        if (!dryRun) {
          await pushAudit(guildId, {
            user: auditUser,
            action: 'Difficulté des prix RPG',
            context: getGuildName(client, guildId),
            module: 'Économie',
            eventType: 'Manuel',
            details: `Boutique : ${from} vers ${body.difficulty} - ${updated} prix modifié(s)`,
            channelId: null
          });
        }

        json(res, 200, { success: true, difficulty: body.difficulty, updated, preview, protectedItems, catalogItems, dryRun });
      } catch (err) {
        logger.error('EconomyAPI', 'Error applying shop difficulty:', err);
        jsonFailure(res, err, "Erreur lors de l'application de la difficulté.", 'EconomyAPI');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/items/:itemId
    if (parts.length === 7 && method === 'DELETE') {
      const itemId = parts[6];
      try {
        const { item, unequippedCount, cleanedMonsters } = await adminDeleteShopItem(guildId, itemId);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression objet boutique',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `Objet ${item.name} supprimé.${unequippedCount > 0 ? ` Déséquipé de ${unequippedCount} profil(s).` : ''}`
            + `${cleanedMonsters > 0 ? ` Retiré du butin de ${cleanedMonsters} créature(s).` : ''}`,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        if (err instanceof Error && err.message === 'Objet introuvable.') {
          json(res, 404, { error: err.message });
          return true;
        }
        if (err instanceof Error && err.message.startsWith('Vous ne pouvez supprimer')) {
          json(res, 403, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error deleting shop item:', err);
        jsonFailure(res, err, "Erreur lors de la suppression de l'objet.", 'EconomyAPI');
      }
      return true;
    }
  }

  // 3. Bestiaire (monstres et boss)
  if (subAction === 'monsters') {
    // GET /api/dashboard/guilds/:guildId/economy/monsters
    if (parts.length === 6 && method === 'GET') {
      try {
        const [monsters, config] = await Promise.all([
          listGuildMonsters(guildId, { includeDisabled: true }),
          getOrCreateEconomyConfig(guildId),
        ]);
        const difficulty = {
          boss: asDifficulty(config.bossDifficulty),
          monster: asDifficulty(config.monsterDifficulty),
        };

        // Le taux de victoire et la dérive ne servent qu'à la page de réglage : ils
        // accompagnent la liste plutôt que de coûter un aller-retour de plus.
        const [battles, drift, firstKills] = await Promise.all([
          getBestiaryBattleStats(guildId, BATTLE_STATS_DAYS),
          findDifficultyDrift(monsters, difficulty),
          listFirstKills(guildId),
        ]);
        const discordGuild = client.guilds.cache.get(guildId);
        const firstKillOf = (name: string) => {
          const record = firstKills.get(name);
          if (!record) return null;
          const member = discordGuild?.members.cache.get(record.userId);
          return {
            userId: record.userId,
            displayName: member?.displayName ?? client.users.cache.get(record.userId)?.username ?? null,
            at: record.createdAt,
          };
        };

        const samples = {
          boss: summarizeBattles(monsters.filter((monster) => monster.isBoss), battles),
          monster: summarizeBattles(monsters.filter((monster) => !monster.isBoss), battles),
        };

        json(res, 200, {
          monsters: monsters.map((monster) => ({
            ...monster,
            drops: parseMonsterDrops(monster.drops),
            battles: battles[monster.name] ?? { battles: 0, wins: 0 },
            offDifficulty: drift[monster.id] ?? null,
            firstKill: firstKillOf(monster.name),
          })),
          battleStatsDays: BATTLE_STATS_DAYS,
          samples,
          recommendations: {
            boss: recommendDifficulty(samples.boss),
            monster: recommendDifficulty(samples.monster),
          },
        });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching monsters:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération du bestiaire.', 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/monsters (création ou personnalisation)
    if (parts.length === 6 && method === 'POST') {
      try {
        const body = await readJsonBody<MonsterInput & { id?: string }>(req);
        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        // Seul un rôle qui change est contrôlé : une fiche dont le rôle est devenu
        // inutilisable doit rester modifiable, le versement le refusera de toute façon.
        const previous = body.id
          ? await prisma.rpgMonster.findUnique({ where: { id: body.id }, select: { firstKillRoleId: true } })
          : null;
        const roleId = typeof body.firstKillRoleId === 'string' && body.firstKillRoleId ? body.firstKillRoleId : null;
        if (roleId && roleId !== previous?.firstKillRoleId) {
          await assertFirstKillRole(client, guildId, roleId).catch((err: Error) => {
            throw new BestiaryError(err.message, 400);
          });
        }

        const { monster, created, overrode } = await saveGuildMonster(guildId, body, body.id);

        await pushAudit(guildId, {
          user: auditUser,
          action: created ? 'Création monstre RPG' : 'Modification monstre RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${monster.isBoss ? 'Boss' : 'Monstre'} : ${monster.name} (niv. ${monster.level})`
            + `${overrode ? ' - copie propre au serveur du monstre livré de base' : ''}`,
          channelId: null
        });

        json(res, 200, { monster: { ...monster, drops: parseMonsterDrops(monster.drops) } });
      } catch (err) {
        if (err instanceof BestiaryError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error saving monster:', err);
        jsonFailure(res, err, 'Erreur lors de la sauvegarde du monstre.', 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/monsters/difficulty
    if (parts.length === 7 && parts[6] === 'difficulty' && method === 'POST') {
      try {
        const body = await readJsonBody<{ scope?: string; difficulty?: string; preview?: boolean }>(req);
        if (!body || (body.scope !== 'boss' && body.scope !== 'monster')) {
          json(res, 400, { error: "Champ « scope » manquant : « boss » ou « monster »." });
          return true;
        }
        if (!isDifficulty(body.difficulty)) {
          json(res, 400, { error: 'Palier de difficulté inconnu.' });
          return true;
        }

        const isBoss = body.scope === 'boss';
        const config = await getOrCreateEconomyConfig(guildId);
        const from = asDifficulty(isBoss ? config.bossDifficulty : config.monsterDifficulty);
        const dryRun = body.preview === true;

        const { updated, preview, protectedDrops } = await applyBestiaryDifficulty(
          guildId,
          { isBoss, from, to: body.difficulty, dryRun },
        );

        // Un essai à blanc ne change rien : le journaliser noierait les vraies
        // modifications sous les allers-retours de la page de réglage.
        if (!dryRun) {
          await pushAudit(guildId, {
            user: auditUser,
            action: 'Difficulté du bestiaire RPG',
            context: getGuildName(client, guildId),
            module: 'Économie',
            eventType: 'Manuel',
            details: `${isBoss ? 'Boss' : 'Monstres'} : ${from} vers ${body.difficulty}`
              + ` - ${updated} fiche(s) réécrite(s)`,
            channelId: null
          });
        }

        json(res, 200, { success: true, difficulty: body.difficulty, updated, preview, protectedDrops, dryRun });
      } catch (err) {
        if (err instanceof BestiaryError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error applying bestiary difficulty:', err);
        jsonFailure(res, err, "Erreur lors de l'application de la difficulté.", 'EconomyAPI');
      }
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/economy/monsters/export
    if (parts.length === 7 && parts[6] === 'export' && method === 'GET') {
      try {
        json(res, 200, await exportGuildBestiary(guildId));
      } catch (err) {
        logger.error('EconomyAPI', 'Error exporting bestiary:', err);
        jsonFailure(res, err, "Erreur lors de l'export du bestiaire.", 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/monsters/import
    if (parts.length === 7 && parts[6] === 'import' && method === 'POST') {
      try {
        const body = await readJsonBody<unknown>(req);
        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        const report = await importGuildBestiary(guildId, body);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Import du bestiaire RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${report.created} créature(s) ajoutée(s), ${report.updated} remplacée(s)`
            + `${report.droppedLoot > 0 ? ` - ${report.droppedLoot} butin(s) retiré(s), objet inconnu ici` : ''}`,
          channelId: null
        });

        json(res, 200, { success: true, ...report });
      } catch (err) {
        if (err instanceof BestiaryError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error importing bestiary:', err);
        jsonFailure(res, err, "Erreur lors de l'import du bestiaire.", 'EconomyAPI');
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/economy/monsters/:monsterId (activation)
    if (parts.length === 7 && method === 'PATCH') {
      try {
        const body = await readJsonBody<{ enabled?: boolean }>(req);
        if (!body || typeof body.enabled !== 'boolean') {
          json(res, 400, { error: "Champ « enabled » manquant." });
          return true;
        }

        const monster = await setGuildMonsterEnabled(guildId, parts[6], body.enabled);

        await pushAudit(guildId, {
          user: auditUser,
          action: body.enabled ? 'Réactivation monstre RPG' : 'Désactivation monstre RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${monster.isBoss ? 'Boss' : 'Monstre'} : ${monster.name}`,
          channelId: null
        });

        json(res, 200, { monster: { ...monster, drops: parseMonsterDrops(monster.drops) } });
      } catch (err) {
        if (err instanceof BestiaryError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error toggling monster:', err);
        jsonFailure(res, err, "Erreur lors de la mise à jour du monstre.", 'EconomyAPI');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/monsters/:monsterId
    if (parts.length === 7 && method === 'DELETE') {
      try {
        const { monster, restoredGlobal } = await deleteGuildMonster(guildId, parts[6]);

        await pushAudit(guildId, {
          user: auditUser,
          action: restoredGlobal ? 'Restauration monstre RPG par défaut' : 'Suppression monstre RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${monster.isBoss ? 'Boss' : 'Monstre'} : ${monster.name}`,
          channelId: null
        });

        json(res, 200, { success: true, restoredGlobal });
      } catch (err) {
        if (err instanceof BestiaryError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error deleting monster:', err);
        jsonFailure(res, err, 'Erreur lors de la suppression du monstre.', 'EconomyAPI');
      }
      return true;
    }
  }

  // 4. Quêtes RPG
  if (subAction === 'quests') {
    // GET /api/dashboard/guilds/:guildId/economy/quests
    if (parts.length === 6 && method === 'GET') {
      try {
        const quests = await listGuildQuests(guildId);
        json(res, 200, {
          quests: quests.map((quest) => ({
            ...quest,
            // La fin de fenêtre est calculée ici : elle depend de l'heure, pas de la fiche,
            // et le dashboard n'a pas a refaire ce calcul de son cote.
            windowEndsAt: questWindowBounds(quest.windowHours).endsAt,
          })),
          objectives: RPG_QUEST_OBJECTIVES,
          scopes: RPG_QUEST_SCOPES,
        });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching quests:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération des quêtes.', 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/quests
    if (parts.length === 6 && method === 'POST') {
      try {
        const body = await readJsonBody<RpgQuestInput & { id?: string }>(req);
        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        const { quest, created } = await saveGuildQuest(guildId, body, body.id);

        await pushAudit(guildId, {
          user: auditUser,
          action: created ? 'Création quête RPG' : 'Modification quête RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${quest.name} - ${quest.objective} x${quest.target}`
            + `${quest.scope === 'TEAM' ? ' (équipe)' : ''}`,
          channelId: null
        });

        json(res, 200, { quest });
      } catch (err) {
        if (err instanceof QuestError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error saving quest:', err);
        jsonFailure(res, err, 'Erreur lors de la sauvegarde de la quête.', 'EconomyAPI');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/quests/:questId
    if (parts.length === 7 && method === 'DELETE') {
      try {
        const { name } = await deleteGuildQuest(guildId, parts[6]);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression quête RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: name,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        if (err instanceof QuestError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error deleting quest:', err);
        jsonFailure(res, err, 'Erreur lors de la suppression de la quête.', 'EconomyAPI');
      }
      return true;
    }
  }

  // Titres du RPG : catalogue du serveur et attribution à la main.
  if (subAction === 'titles') {
    const titleFailure = (err: unknown, fallback: string) => {
      if (err instanceof TitleError) {
        json(res, err.status, { error: err.message });
        return;
      }
      logger.error('EconomyAPI', fallback, err);
      jsonFailure(res, err, fallback, 'EconomyAPI');
    };

    // GET /api/dashboard/guilds/:guildId/economy/titles
    if (parts.length === 6 && method === 'GET') {
      try {
        const [titles, owners] = await Promise.all([
          listGuildTitles(guildId),
          prisma.rpgProfileTitle.findMany({
            where: { title: { guildId } },
            select: { titleId: true, obtainedAt: true, profile: { select: { userId: true } } },
          }),
        ]);
        const discordGuild = client.guilds.cache.get(guildId);
        const ownersByTitle = new Map<string, { userId: string; displayName: string; obtainedAt: Date }[]>();
        for (const owner of owners) {
          const list = ownersByTitle.get(owner.titleId) ?? [];
          list.push({
            userId: owner.profile.userId,
            displayName: discordGuild?.members.cache.get(owner.profile.userId)?.displayName ?? owner.profile.userId,
            obtainedAt: owner.obtainedAt,
          });
          ownersByTitle.set(owner.titleId, list);
        }
        json(res, 200, { titles: titles.map((title) => ({ ...title, owners: ownersByTitle.get(title.id) ?? [] })) });
      } catch (err) {
        titleFailure(err, 'Erreur lors de la récupération des titres.');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/titles
    if (parts.length === 6 && method === 'POST') {
      try {
        const body = await readJsonBody<TitleInput & { id?: string }>(req);
        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }
        const { title, created } = await saveGuildTitle(guildId, body, body.id);
        await pushAudit(guildId, {
          user: auditUser,
          action: created ? 'Création titre RPG' : 'Modification titre RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: title.name,
          channelId: null
        });
        json(res, 200, { title });
      } catch (err) {
        titleFailure(err, 'Erreur lors de la sauvegarde du titre.');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/titles/:titleId
    if (parts.length === 7 && method === 'DELETE') {
      try {
        const title = await deleteGuildTitle(guildId, parts[6]);
        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression titre RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: title.name,
          channelId: null
        });
        json(res, 200, { success: true });
      } catch (err) {
        titleFailure(err, 'Erreur lors de la suppression du titre.');
      }
      return true;
    }

    // POST   /api/dashboard/guilds/:guildId/economy/titles/:titleId/owners           { userId }
    // DELETE /api/dashboard/guilds/:guildId/economy/titles/:titleId/owners/:userId
    const grantsOwner = method === 'POST' && parts.length === 8;
    const revokesOwner = method === 'DELETE' && parts.length === 9;
    if (parts[7] === 'owners' && (grantsOwner || revokesOwner)) {
      try {
        const titleId = parts[6];
        const title = await prisma.rpgTitle.findUnique({ where: { id: titleId } });
        if (!title || title.guildId !== guildId) {
          json(res, 404, { error: 'Titre introuvable.' });
          return true;
        }

        const userId = grantsOwner
          ? (await readJsonBody<{ userId?: string }>(req))?.userId
          : parts[8];
        if (!userId || !/^\d{17,20}$/.test(userId)) {
          json(res, 400, { error: 'Membre invalide.' });
          return true;
        }
        const profile = await prisma.rpgProfile.findUnique({ where: { guildId_userId: { guildId, userId } }, select: { id: true } });
        if (!profile) {
          json(res, 404, { error: "Ce membre n'a pas encore de personnage RPG." });
          return true;
        }

        if (grantsOwner) {
          const granted = await grantTitle(profile.id, titleId);
          if (!granted) {
            json(res, 409, { error: 'Ce membre possède déjà ce titre.' });
            return true;
          }
        } else {
          await revokeTitle(profile.id, titleId);
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: grantsOwner ? 'Attribution titre RPG' : 'Retrait titre RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${title.name} - membre ${userId}`,
          channelId: null
        });
        json(res, 200, { success: true });
      } catch (err) {
        titleFailure(err, "Erreur lors de l'attribution du titre.");
      }
      return true;
    }
  }

  // 5. Recettes d'artisanat
  if (subAction === 'recipes') {
    // GET /api/dashboard/guilds/:guildId/economy/recipes
    if (parts.length === 6 && method === 'GET') {
      try {
        json(res, 200, { recipes: await listGuildRecipes(guildId) });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching recipes:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération des recettes.', 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/recipes (création ou modification)
    if (parts.length === 6 && method === 'POST') {
      try {
        const body = await readJsonBody<RecipeInput & { id?: string }>(req);
        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        const { recipe, created } = await saveGuildRecipe(guildId, body, body.id);

        await pushAudit(guildId, {
          user: auditUser,
          action: created ? 'Création recette RPG' : 'Modification recette RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: created ? 'Création' : 'Modification',
          details: recipe.id,
          channelId: null
        });

        json(res, 200, { success: true, recipe });
      } catch (err) {
        if (err instanceof RecipeError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error saving recipe:', err);
        jsonFailure(res, err, 'Erreur lors de la sauvegarde de la recette.', 'EconomyAPI');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/recipes/:recipeId
    if (parts.length === 7 && method === 'DELETE') {
      try {
        const { name } = await deleteGuildRecipe(guildId, parts[6]);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression recette RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Suppression',
          details: name,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        if (err instanceof RecipeError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error deleting recipe:', err);
        jsonFailure(res, err, 'Erreur lors de la suppression de la recette.', 'EconomyAPI');
      }
      return true;
    }
  }

  // 6. Raid hebdomadaire
  if (subAction === 'raid') {
    // GET /api/dashboard/guilds/:guildId/economy/raid
    if (parts.length === 6 && method === 'GET') {
      try {
        // Le catalogue livré est déposé à la première consultation : sans ça, une page de
        // réglage vide donnerait l'impression qu'il faut tout écrire soi-même.
        await seedGuildRaidBosses(guildId);
        const [bosses, state, recap, history] = await Promise.all([
          listGuildRaidBosses(guildId),
          getRaidState(guildId),
          // Sans borne d'âge : côté réglages, le bilan de la dernière fenêtre reste tant
          // que la suivante n'a pas ouvert, puisque c'est sur lui qu'on ajuste la prochaine.
          getRaidRecap(guildId),
          // L'historique, lui, ne périme pas : sans lui l'onglet se vidait dès que le
          // bilan expirait, sans plus rien dire des semaines passées.
          listRaidHistory(guildId),
        ]);

        // Le bilan ne porte que des identifiants : la page afficherait sinon une colonne de
        // nombres, là où le classement d'un raid n'a d'intérêt qu'avec des noms.
        // Un raid en cours chasse le bilan du précédent : c'est celui qui tourne qui
        // intéresse, et les deux côte à côte se confondraient.
        const discordGuild = client.guilds.cache.get(guildId);
        const recapWithNames = recap && !state.open && {
          ...recap,
          strikers: recap.strikers.map((striker) => ({
            ...striker,
            displayName: discordGuild?.members.cache.get(striker.userId)?.displayName
              ?? `Utilisateur ${striker.userId}`,
          })),
        };

        json(res, 200, {
          bosses,
          spells: RAID_SPELLS,
          state: {
            enabled: state.enabled,
            teamMode: state.teamMode,
            nextOpensAt: state.nextOpensAt,
            open: state.open,
            teams: state.open ? await listRaidTeams(state.open.id) : [],
          },
          recap: recapWithNames || null,
          history,
        });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching raid:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération du raid.', 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/raid/bosses (création ou modification)
    if (parts.length === 7 && parts[6] === 'bosses' && method === 'POST') {
      try {
        const body = await readJsonBody<RaidBossInput & { id?: string }>(req);
        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        const { boss, created } = await saveGuildRaidBoss(guildId, body, body.id);

        // La fenêtre en attente porte une copie de la fiche : sans cette reprise, retoucher
        // le boss annoncé pour samedi ne se verrait qu'au raid d'après. Le boss est déjà
        // enregistré : un incident ici ne doit pas faire passer la sauvegarde pour un échec.
        await resyncScheduledRaidBoss(guildId, await getOrCreateEconomyConfig(guildId)).catch((err) => {
          logger.error('EconomyAPI', `Boss de la fenêtre en attente non repris pour ${guildId}:`, err);
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: created ? 'Création boss de raid' : 'Modification boss de raid',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${boss.name} (niv. ${boss.level})`,
          channelId: null
        });

        json(res, 200, { boss });
      } catch (err) {
        if (err instanceof RaidError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error saving raid boss:', err);
        jsonFailure(res, err, 'Erreur lors de la sauvegarde du boss de raid.', 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/raid/seed (rétablit les fiches livrées)
    if (parts.length === 7 && parts[6] === 'seed' && method === 'POST') {
      try {
        const restored = await seedGuildRaidBosses(guildId);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Restauration des boss de raid',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${restored} boss livré(s) de base rétabli(s)`,
          channelId: null
        });

        json(res, 200, { success: true, restored });
      } catch (err) {
        logger.error('EconomyAPI', 'Error seeding raid bosses:', err);
        jsonFailure(res, err, 'Erreur lors de la restauration des boss.', 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/raid/start (lancement manuel)
    if (parts.length === 7 && parts[6] === 'start' && method === 'POST') {
      try {
        const config = await getOrCreateEconomyConfig(guildId);
        const { id } = await startRaidNow(guildId, config);

        // L'annonce part tout de suite : le cycle l'aurait publiée, mais jusqu'à une
        // minute plus tard, et un lancement manuel se fait justement parce que l'équipe
        // est là maintenant.
        const raid = await getOpenRaid(guildId);
        if (raid) {
          await announceOpenRaid(client, raid, config.raidAnnounce, config.raidRoleId);
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Lancement manuel du raid',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: raid ? `${raid.bossName} jusqu'au ${raid.closesAt.toISOString()}` : id,
          channelId: null
        });

        json(res, 200, { success: true, raid });
      } catch (err) {
        if (err instanceof RaidError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error starting raid:', err);
        jsonFailure(res, err, 'Erreur lors du lancement du raid.', 'EconomyAPI');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/raid/bosses/:bossId
    if (parts.length === 8 && parts[6] === 'bosses' && method === 'DELETE') {
      try {
        const { name } = await deleteGuildRaidBoss(guildId, parts[7]);
        await resyncScheduledRaidBoss(guildId, await getOrCreateEconomyConfig(guildId)).catch((err) => {
          logger.error('EconomyAPI', `Boss de la fenêtre en attente non repris pour ${guildId}:`, err);
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression boss de raid',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: name,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        if (err instanceof RaidError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error deleting raid boss:', err);
        jsonFailure(res, err, 'Erreur lors de la suppression du boss de raid.', 'EconomyAPI');
      }
      return true;
    }
  }

  // 7. Players / Profiles Routes
  if (subAction === 'players') {
    // GET /api/dashboard/guilds/:guildId/economy/players
    if (parts.length === 6 && method === 'GET') {
      try {
        const players = await prisma.rpgProfile.findMany({
          where: { guildId },
          include: { rpgGuild: true },
          // Même ordre que le classement solo de la page publique.
          orderBy: [{ level: 'desc' }, { xp: 'desc' }]
        });

        const [items, inventoryCounts] = await Promise.all([
          prisma.rpgItem.findMany({ where: { OR: [{ guildId: null }, { guildId }] } }),
          prisma.rpgInventoryItem.groupBy({
            by: ['rpgProfileId'],
            where: { profile: { guildId }, quantity: { gt: 0 } },
            _sum: { quantity: true },
          }),
        ]);
        const itemById = new Map(items.map((item) => [item.id, item]));
        const bagSizeByProfile = new Map(inventoryCounts.map((row) => [row.rpgProfileId, row._sum.quantity ?? 0]));

        // Resolve Discord tags/usernames from cache if possible
        const discordGuild = client.guilds.cache.get(guildId);
        const playerDetails = players.map((player) => {
          const member = discordGuild?.members.cache.get(player.userId);
          const weapon = player.weaponId ? itemById.get(player.weaponId) : undefined;
          const armor = player.armorId ? itemById.get(player.armorId) : undefined;
          // Les trois emplacements d'accessoire étaient absents : un joueur qui en portait
          // paraissait nu sur la page, alors que ses statistiques en dépendaient.
          const accessories = [player.accessoryId, player.accessory2Id, player.accessory3Id]
            .map((id) => (id ? itemById.get(id) : undefined))
            .filter((item): item is NonNullable<typeof item> => Boolean(item))
            .map((item) => ({ name: item.name, emoji: item.emoji }));
          return {
            ...player,
            username: member?.user?.username ?? `Utilisateur ${player.userId}`,
            displayName: member?.displayName ?? `Utilisateur ${player.userId}`,
            avatarUrl: resolveMemberAvatarUrl(member, 128),
            weapon: weapon ? { name: weapon.name, emoji: weapon.emoji, atkBonus: weapon.atkBonus } : null,
            armor: armor ? { name: armor.name, emoji: armor.emoji, defBonus: armor.defBonus } : null,
            accessories,
            bagSize: bagSizeByProfile.get(player.id) ?? 0,
          };
        });

        json(res, 200, { players: playerDetails });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching players:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération des joueurs.', 'EconomyAPI');
      }
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/economy/players/:userId/inventory
    if (parts.length === 8 && parts[7] === 'inventory' && method === 'GET') {
      try {
        json(res, 200, { inventory: await getPlayerInventory(guildId, parts[6]) });
      } catch (err) {
        if (err instanceof PlayerAdminError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error fetching player inventory:', err);
        jsonFailure(res, err, "Erreur lors de la récupération de l'inventaire.", 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/players/:userId/inventory (don d'objets)
    if (parts.length === 8 && parts[7] === 'inventory' && method === 'POST') {
      try {
        const body = await readJsonBody<{ itemId?: string; quantity?: number }>(req);
        if (!body?.itemId) {
          json(res, 400, { error: 'Objet manquant.' });
          return true;
        }

        const { itemName, quantity } = await adminGrantItem(guildId, parts[6], body.itemId, Number(body.quantity ?? 1));

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Don objet RPG joueur',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${quantity} x ${itemName} donné(s) à ${parts[6]}`,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        if (err instanceof PlayerAdminError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error granting inventory item:', err);
        jsonFailure(res, err, "Erreur lors de l'ajout de l'objet.", 'EconomyAPI');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/players/:userId/inventory/:itemId?quantity=N
    if (parts.length === 9 && parts[7] === 'inventory' && method === 'DELETE') {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const result = await adminTakeItem(guildId, parts[6], parts[8], Number(url.searchParams.get('quantity') ?? '1'));

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Retrait objet RPG joueur',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${result.removedQuantity} x ${result.itemName} retiré(s) à ${parts[6]}`,
          channelId: null
        });

        json(res, 200, { success: true, remaining: result.remainingQuantity });
      } catch (err) {
        if (err instanceof PlayerAdminError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error removing inventory item:', err);
        jsonFailure(res, err, "Erreur lors du retrait de l'objet.", 'EconomyAPI');
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/economy/players/:userId
    if (parts.length === 7 && method === 'PATCH') {
      const targetUserId = parts[6];
      try {
        const body = await readJsonBody<PlayerStatsInput>(req);
        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        const updatedProfile = await adminUpdatePlayerStats(guildId, targetUserId, body);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Modification profil RPG joueur',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `Modifié joueur ${targetUserId}. Solde: ${updatedProfile.balance}, Niveau: ${updatedProfile.level}`,
          channelId: null
        });

        json(res, 200, { player: updatedProfile });
      } catch (err) {
        if (err instanceof PlayerAdminError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error updating player profile:', err);
        jsonFailure(res, err, 'Erreur lors de la mise à jour du profil du joueur.', 'EconomyAPI');
      }
      return true;
    }
  }

  // 8. Événements de voyage
  if (subAction === 'events') {
    // GET /api/dashboard/guilds/:guildId/economy/events
    if (parts.length === 6 && method === 'GET') {
      try {
        json(res, 200, {
          events: await listGuildAdventureEvents(guildId),
          limits: {
            titleMax: ADVENTURE_TITLE_MAX,
            descriptionMax: ADVENTURE_DESCRIPTION_MAX,
            choicesMax: ADVENTURE_CHOICES_MAX,
            choiceTextMax: ADVENTURE_CHOICE_TEXT_MAX,
          },
        });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching adventure events:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération des événements.', 'EconomyAPI');
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/events (création, modification, personnalisation)
    if (parts.length === 6 && method === 'POST') {
      try {
        const body = await readJsonBody<AdventureEventInput & { id?: string }>(req);
        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        const { event, created } = await saveGuildAdventureEvent(guildId, body, body.id);

        await pushAudit(guildId, {
          user: auditUser,
          action: created ? 'Création événement de voyage' : 'Modification événement de voyage',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${event.title}${event.overridesGlobal ? ' - version propre au serveur de l’événement livré' : ''}`,
          channelId: null
        });

        json(res, 200, { event });
      } catch (err) {
        if (err instanceof AdventureEventError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error saving adventure event:', err);
        jsonFailure(res, err, "Erreur lors de la sauvegarde de l'événement.", 'EconomyAPI');
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/economy/events/:eventId (activation d'un événement livré)
    if (parts.length === 7 && method === 'PATCH') {
      try {
        const body = await readJsonBody<{ enabled?: boolean }>(req);
        if (!body || typeof body.enabled !== 'boolean') {
          json(res, 400, { error: 'Champ « enabled » manquant.' });
          return true;
        }

        const { title } = await setGlobalAdventureEventEnabled(guildId, parts[6], body.enabled);

        await pushAudit(guildId, {
          user: auditUser,
          action: body.enabled ? 'Réactivation événement de voyage' : 'Désactivation événement de voyage',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: title,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        if (err instanceof AdventureEventError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error toggling adventure event:', err);
        jsonFailure(res, err, "Erreur lors de la mise à jour de l'événement.", 'EconomyAPI');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/events/:eventId
    if (parts.length === 7 && method === 'DELETE') {
      try {
        const { title, restoredGlobal } = await deleteGuildAdventureEvent(guildId, parts[6]);

        await pushAudit(guildId, {
          user: auditUser,
          action: restoredGlobal ? 'Restauration événement de voyage livré' : 'Suppression événement de voyage',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: title,
          channelId: null
        });

        json(res, 200, { success: true, restoredGlobal });
      } catch (err) {
        if (err instanceof AdventureEventError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error deleting adventure event:', err);
        jsonFailure(res, err, "Erreur lors de la suppression de l'événement.", 'EconomyAPI');
      }
      return true;
    }
  }

  // 9. Guildes RPG
  if (subAction === 'guilds') {
    // GET /api/dashboard/guilds/:guildId/economy/guilds
    if (parts.length === 6 && method === 'GET') {
      try {
        const guilds = await listRpgGuildsForAdmin(guildId);
        const discordGuild = client.guilds.cache.get(guildId);
        const nameOf = (userId: string) => discordGuild?.members.cache.get(userId)?.displayName ?? `Utilisateur ${userId}`;

        json(res, 200, {
          guilds: guilds.map((rpgGuild) => ({
            ...rpgGuild,
            ownerName: nameOf(rpgGuild.ownerId),
            members: rpgGuild.members.map((member) => ({ ...member, displayName: nameOf(member.userId) })),
          })),
        });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching RPG guilds:', err);
        jsonFailure(res, err, 'Erreur lors de la récupération des guildes RPG.', 'EconomyAPI');
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/economy/guilds/:rpgGuildId
    if (parts.length === 7 && method === 'PATCH') {
      try {
        const body = await readJsonBody<RpgGuildAdminEdit>(req);
        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        const { before, after } = await adminUpdateRpgGuild(guildId, parts[6], body);

        const changes = [
          before.name !== after.name ? `nom : ${before.name} vers ${after.name}` : null,
          before.treasury !== after.treasury ? `trésor : ${before.treasury} vers ${after.treasury}` : null,
          before.ownerId !== after.ownerId ? `chef : ${before.ownerId} vers ${after.ownerId}` : null,
        ].filter(Boolean).join(', ');

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Modification guilde RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${after.name}${changes ? ` - ${changes}` : ''}`,
          channelId: null
        });

        json(res, 200, { guild: after });
      } catch (err) {
        if (err instanceof RpgGuildAdminError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error updating RPG guild:', err);
        jsonFailure(res, err, 'Erreur lors de la mise à jour de la guilde.', 'EconomyAPI');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/guilds/:rpgGuildId/members/:userId
    if (parts.length === 9 && parts[7] === 'members' && method === 'DELETE') {
      try {
        const { guildName } = await adminRemoveRpgGuildMember(guildId, parts[6], parts[8]);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Exclusion membre guilde RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${parts[8]} retiré de ${guildName}`,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        if (err instanceof RpgGuildAdminError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error removing RPG guild member:', err);
        jsonFailure(res, err, 'Erreur lors du retrait du membre.', 'EconomyAPI');
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/guilds/:rpgGuildId
    if (parts.length === 7 && method === 'DELETE') {
      try {
        const { name, members, treasury } = await adminDissolveRpgGuild(guildId, parts[6]);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Dissolution guilde RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `${name} - ${members} membre(s) détaché(s), trésor de ${treasury} perdu`,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        if (err instanceof RpgGuildAdminError) {
          json(res, err.status, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error dissolving RPG guild:', err);
        jsonFailure(res, err, 'Erreur lors de la dissolution de la guilde.', 'EconomyAPI');
      }
      return true;
    }
  }

  // 10. Reset Economy Route
  if (subAction === 'reset') {
    // POST /api/dashboard/guilds/:guildId/economy/reset
    if (parts.length === 6 && method === 'POST') {
      try {
        const body = await readJsonBody<{
          component: 'all' | 'profiles' | 'items' | 'config' | 'guilds' | 'bestiary';
        }>(req);

        if (!body || !body.component) {
          json(res, 400, { error: 'Composant de réinitialisation manquant.' });
          return true;
        }
        // Sans ce contrôle, un composant inconnu ne réinitialisait rien tout en repartant
        // avec un 200 et une entrée d'audit annonçant une remise à zéro qui n'a pas eu lieu.
        if (!RESET_COMPONENTS.has(body.component)) {
          json(res, 400, { error: 'Composant de réinitialisation inconnu.' });
          return true;
        }

        const { adminResetGuildEconomy } = await import('../../../services/features/economyService.js');
        const { restored } = await adminResetGuildEconomy(guildId, body.component);

        const componentLabels: Record<string, string> = {
          all: 'Global (tout réinitialiser)',
          profiles: 'Profils des joueurs',
          items: 'Objets de la boutique',
          config: 'Configuration',
          guilds: 'Guildes RPG',
          bestiary: 'Bestiaire du serveur'
        };

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Réinitialisation Économie/RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: restored.players > 0
            ? `Composant réinitialisé : ${componentLabels[body.component] || body.component} - ${restored.coins} pièces de niveau restituées à ${restored.players} membre(s)`
            : `Composant réinitialisé : ${componentLabels[body.component] || body.component}`,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        logger.error('EconomyAPI', 'Error resetting guild economy:', err);
        jsonFailure(res, err, "Erreur lors de la réinitialisation de l'économie.", 'EconomyAPI');
      }
      return true;
    }
  }

  return false;
}
