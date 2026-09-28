/**
 * Outils MCP de la Tour : réglages, récompenses, saisons et profils des joueurs.
 *
 * Comme les autres outils RPG, ils passent par le service utilisé par le dashboard. Lecture
 * sous READ_ECONOMY, écriture sous WRITE_MEMBERS.
 */
import { z } from 'zod';
import { type McpToolContext, err, ok, resolveMember } from '../toolkit.js';
import {
  adjustTowerShards,
  deleteTowerReward,
  getTowerConfig,
  getTowerDashboard,
  getTowerPlayerSummary,
  saveTowerFloors,
  saveTowerReward,
  saveTowerSettings,
  startTowerSeason,
} from '../../../services/features/rpg/rpgTowerService.js';
import {
  TOWER_BLESSINGS,
  TOWER_ENTRY_MODES,
  TOWER_RANGES,
  TOWER_MERCHANT_RANGES,
  TOWER_REWARD_KINDS,
  TOWER_UPGRADES_MAX,
  TOWER_UPGRADE_EFFECTS,
  TOWER_UPGRADE_PER_LEVEL_RANGES,
  TOWER_UPGRADE_RANGES,
} from '../../../services/features/rpg/rpgTowerPolicy.js';
import {
  TOWER_CHEST_KINDS,
  TOWER_FLOORS_MAX,
  TOWER_FLOOR_NAME_MAX,
  TOWER_MAP_ROOMS_MAX,
  TOWER_MAP_SIZE,
  TOWER_OFFER_KINDS,
  TOWER_ROOM_TYPES,
  defaultTowerLayout,
  type TowerLayout,
} from '../../../services/features/rpg/rpgTowerMap.js';

const roomSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  type: z.enum(TOWER_ROOM_TYPES).describe('START départ (un seul), MONSTER, ELITE, BOSS (salle 2×2 ancrée en haut à gauche), CHEST, CAMPFIRE, MERCHANT, SHRINE (bénédiction), EMPTY (couloir)'),
  foe: z.string().nullable().optional().describe('MONSTER/ELITE/BOSS : créature imposée (nom exact du bestiaire), sinon tirée au hasard'),
  chest: z.enum(TOWER_CHEST_KINDS).optional().describe('CHEST : contenu'),
  healPercent: z.number().int().min(5).max(100).optional().describe('CAMPFIRE : soin en % des PV max'),
  offers: z.array(z.enum(TOWER_OFFER_KINDS)).max(4).optional().describe('MERCHANT : articles vendus'),
  pricePercent: z.number().int().min(10).max(500).optional().describe('MERCHANT : prix en % du prix normal'),
});

const floorSchema = z.object({
  name: z.string().max(TOWER_FLOOR_NAME_MAX).optional().describe("Nom de l'étage (« Caserne », « Crypte »…)"),
  width: z.number().int().min(TOWER_MAP_SIZE.min).max(TOWER_MAP_SIZE.max),
  height: z.number().int().min(TOWER_MAP_SIZE.min).max(TOWER_MAP_SIZE.max),
  rooms: z.array(roomSchema).max(TOWER_MAP_ROOMS_MAX),
});

const upgradeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/).describe('Identifiant stable : les niveaux achetés par les joueurs y sont rattachés. Le changer revient à créer une nouvelle amélioration.'),
  enabled: z.boolean().optional().describe('Désactivée : ne se vend plus, les niveaux déjà achetés restent actifs'),
  name: z.string().optional().describe("Vide : nom de l'effet dans la langue du joueur"),
  emoji: z.string().optional().describe("Vide : icône du bot selon l'effet"),
  description: z.string().optional(),
  effect: z.enum(TOWER_UPGRADE_EFFECTS).describe('POTION potions de départ, HEALTH/ATTACK/DEFENSE/SPEED % de la stat, CRIT points de % de critique, GOLD or de départ'),
  perLevel: z.number().int().min(1).describe('Gain par niveau, dans l\'unité de l\'effet'),
  maxLevel: z.number().int().min(TOWER_UPGRADE_RANGES.maxLevel.min).max(TOWER_UPGRADE_RANGES.maxLevel.max),
  baseCost: z.number().int().min(TOWER_UPGRADE_RANGES.baseCost.min).max(TOWER_UPGRADE_RANGES.baseCost.max).describe('Prix du premier niveau, en éclats'),
  costGrowthPercent: z.number().int().min(TOWER_UPGRADE_RANGES.costGrowthPercent.min).max(TOWER_UPGRADE_RANGES.costGrowthPercent.max).optional().describe('Hausse du prix à chaque niveau, en % (100 double le prix)'),
});

const merchantRange = (key: keyof typeof TOWER_MERCHANT_RANGES) => z.number().int().min(TOWER_MERCHANT_RANGES[key].min).max(TOWER_MERCHANT_RANGES[key].max).optional();
const merchantSchema = z.object({
  offers: z.array(z.enum(TOWER_OFFER_KINDS)).min(1).optional().describe('Articles du marchand en mode aléatoire (une salle de carte choisit les siens)'),
  potionPrice: merchantRange('potionPrice'),
  potionPricePerFloor: merchantRange('potionPricePerFloor'),
  healPrice: merchantRange('healPrice'),
  healPricePerFloor: merchantRange('healPricePerFloor'),
  healPercent: merchantRange('healPercent').describe('Soin vendu, en % des PV max'),
  gearPrice: merchantRange('gearPrice'),
  gearPricePerFloor: merchantRange('gearPricePerFloor'),
  potionHealPercent: merchantRange('potionHealPercent').describe('Soin de toutes les potions, en % des PV max'),
});

const fail = (e: unknown) => err(e instanceof Error ? e.message : String(e));

function mergeDefined(base: Record<string, unknown>, sent: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [field, value] of Object.entries(sent)) {
    if (value !== undefined) merged[field] = value;
  }
  return merged;
}

const range = (key: keyof typeof TOWER_RANGES) => z.number().int().min(TOWER_RANGES[key].min).max(TOWER_RANGES[key].max).optional();

export function registerRpgTowerTools(ctx: McpToolContext) {
  const { server, guildId, client, shouldRegister, guard, audit, toolMeta } = ctx;

  if (shouldRegister('READ_ECONOMY')) {
    server.registerTool(
      'get_rpg_tower',
      {
        description: "Lit la Tour (mode roguelite du RPG). En portes aléatoires, chaque porte franchie est un étage. Avec la carte activée, chaque étage est une carte dessinée (settings.floors, dans l'ordre de la montée, puis la tour reprend au premier en plus dur) : on monte d'un étage en battant son gardien, et la difficulté croît à chaque salle. Contient : étages dessinés (floors, layoutEnabled) et créatures proposables pour leurs salles (foes), réglages (ouverture, mode d'entrée COMPRESSED ou RESET, plafonds d'héritage et de titre, croissance des monstres, boss et bénédictions, éclats par étage, part gardée à la mort et en partant, plafond hebdomadaire, monnaie), récompenses (boutique d'éclats et paliers d'étage), statistiques, classement de la saison, améliorations permanentes (settings.upgrades) et marchand (settings.merchant) réglables, et le catalogue fixe des bénédictions.",
        inputSchema: {},
        _meta: toolMeta,
      },
      guard('READ_ECONOMY', async () => {
        const dashboard = await getTowerDashboard(guildId);
        return ok({
          ...dashboard,
          reference: {
            entryModes: TOWER_ENTRY_MODES,
            rewardKinds: TOWER_REWARD_KINDS,
            ranges: TOWER_RANGES,
            blessings: TOWER_BLESSINGS.map((blessing) => ({ id: blessing.id, name: blessing.name, description: blessing.description, maxRank: blessing.maxRank })),
            upgradeEffects: TOWER_UPGRADE_EFFECTS.map((effect) => ({ effect, perLevel: TOWER_UPGRADE_PER_LEVEL_RANGES[effect] })),
            upgradesMax: TOWER_UPGRADES_MAX,
            merchantRanges: TOWER_MERCHANT_RANGES,
          },
        });
      })
    );

    server.registerTool(
      'get_rpg_tower_player',
      {
        description: "Profil Tour d'un joueur : éclats, records (saison et tous les temps), ascensions, améliorations achetées, récompenses obtenues, et l'ascension en cours s'il y en a une. Le profil Tour est distinct du profil RPG.",
        inputSchema: {
          member: z.string().describe('Nom, @mention ou ID du membre'),
        },
        _meta: toolMeta,
      },
      guard('READ_ECONOMY', async ({ member }) => {
        const resolved = await resolveMember(guildId, member);
        if (!resolved.ok) return resolved.response;
        return ok({ userId: resolved.userId, ...(await getTowerPlayerSummary(guildId, resolved.userId)) });
      })
    );
  }

  if (shouldRegister('WRITE_MEMBERS')) {
    server.registerTool(
      'save_rpg_tower_settings',
      {
        description: "Modifie les réglages de la Tour. Un champ omis garde sa valeur. Ne touche ni aux profils, ni aux éclats, ni aux parties en cours (elles gardent les stats de leur entrée). Requiert WRITE_MEMBERS.",
        inputSchema: {
          enabled: z.boolean().optional().describe('Ouvre ou ferme la Tour. Fermée, les parties en cours peuvent se terminer.'),
          name: z.string().optional(),
          emoji: z.string().optional(),
          description: z.string().optional(),
          entryMode: z.enum(TOWER_ENTRY_MODES).optional().describe('COMPRESSED : stats du RPG compressées et plafonnées. RESET : stats de base pour tous, seul le titre compte.'),
          inheritCapPercent: range('inheritCapPercent').describe('Bonus maximal hérité des stats du RPG, en % des stats de base'),
          titleCapPercent: range('titleCapPercent').describe('Bonus maximal du titre porté, en %'),
          floorGrowthPercent: range('floorGrowthPercent').describe('Force gagnée par les monstres à chaque étage, en %'),
          bossEvery: range('bossEvery').describe('Portes aléatoires : boss tous les N étages, 0 pour aucun. Sans effet sur carte, où chaque étage a son gardien.'),
          blessingEvery: range('blessingEvery').describe('Bénédiction tous les N étages (sur carte : tous les N étages gravis, en plus des autels), 0 pour aucune'),
          maxBlessings: range('maxBlessings'),
          shardsPerFloor: range('shardsPerFloor'),
          deathShardPercent: range('deathShardPercent').describe('Part des éclats gardée à la mort'),
          leaveShardPercent: range('leaveShardPercent').describe('Part des éclats gardée en quittant hors palier sûr ; juste après un boss, quitter garde tout'),
          weeklyShardCap: range('weeklyShardCap').describe('0 pour aucun plafond'),
          idleTimeoutMinutes: range('idleTimeoutMinutes'),
          currencyName: z.string().optional(),
          currencyEmoji: z.string().optional(),
          upgrades: z.array(upgradeSchema).max(TOWER_UPGRADES_MAX).optional().describe('Remplace la liste complète des améliorations permanentes (lire get_rpg_tower avant de modifier)'),
          merchant: merchantSchema.optional().describe('Champs du marchand à modifier ; les autres gardent leur valeur'),
          key_name: z.string().optional(),
        },
        _meta: toolMeta,
      },
      guard('WRITE_MEMBERS', async ({ key_name, ...input }) => {
        try {
          const base: Record<string, unknown> = { ...(await getTowerConfig(guildId)) };
          delete base.seasonStartedAt;
          delete base.floors;
          delete base.layoutEnabled;
          const merged = mergeDefined(base, { ...input, merchant: undefined });
          if (input.merchant) merged.merchant = mergeDefined(base.merchant as Record<string, unknown>, input.merchant);
          const settings = await saveTowerSettings(guildId, merged);
          await audit(key_name, 'Réglages de la Tour MCP', settings.name, `${settings.enabled ? 'ouverte' : 'fermée'}, mode ${settings.entryMode}`);
          return ok({ ok: true, settings });
        } catch (e) {
          return fail(e);
        }
      })
    );

    server.registerTool(
      'save_rpg_tower_layout',
      {
        description: `Dessine les étages de la Tour. Chaque étage est une carte : une grille (${TOWER_MAP_SIZE.min} à ${TOWER_MAP_SIZE.max} cases de côté, ${TOWER_MAP_ROOMS_MAX} salles au plus) où deux salles qui se touchent par un côté communiquent ; une case sans salle est un mur. Il faut un seul départ, au moins un gardien (BOSS), et toutes les salles reliées au départ. Battre le gardien fait monter à l'étage suivant ; les ${TOWER_FLOORS_MAX} étages au plus se jouent dans l'ordre, puis la tour reprend au premier, plus dure. \`floors\` remplace toute la tour ; sinon \`floor\` (1 = rez-de-chaussée) désigne l'étage à modifier ou à ajouter à la suite, avec \`name\`, \`width\`, \`height\`, \`rooms\`, ou \`useDefault: true\` pour la carte d'exemple. \`removeFloor\` retire l'étage \`floor\`. \`layoutEnabled\` joue les cartes au lieu des portes aléatoires. Un joueur garde la carte de l'étage où il se trouve ; les étages suivants suivent la tour enregistrée. Requiert WRITE_MEMBERS.`,
        inputSchema: {
          layoutEnabled: z.boolean().describe('Jouer les cartes (sinon la Tour tire ses portes au hasard)'),
          floors: z.array(floorSchema).max(TOWER_FLOORS_MAX).optional().describe('Remplace tous les étages, dans l\'ordre de la montée'),
          floor: z.number().int().min(1).max(TOWER_FLOORS_MAX).optional().describe('Étage à modifier (1 = premier). Défaut : 1.'),
          removeFloor: z.boolean().optional().describe('Retire l\'étage `floor`'),
          useDefault: z.boolean().optional().describe('Remplacer l\'étage par la carte d\'exemple'),
          name: z.string().max(TOWER_FLOOR_NAME_MAX).optional(),
          width: z.number().int().min(TOWER_MAP_SIZE.min).max(TOWER_MAP_SIZE.max).optional(),
          height: z.number().int().min(TOWER_MAP_SIZE.min).max(TOWER_MAP_SIZE.max).optional(),
          rooms: z.array(roomSchema).max(TOWER_MAP_ROOMS_MAX).optional().describe('Salles de l\'étage. Absent : celles de l\'étage actuel sont gardées.'),
          key_name: z.string().optional(),
        },
        _meta: toolMeta,
      },
      guard('WRITE_MEMBERS', async ({ layoutEnabled, floors, floor, removeFloor, useDefault, name, width, height, rooms, key_name }) => {
        try {
          let next: unknown[];
          if (floors) {
            next = floors;
          } else {
            const current: TowerLayout[] = [...(await getTowerConfig(guildId)).floors];
            const index = (floor ?? 1) - 1;
            if (index > current.length) return err(`La tour n'a que ${current.length} étage(s) : l'étage ${index + 1} ne peut pas être créé.`);
            if (removeFloor) {
              if (index >= current.length) return err('Cet étage n\'existe pas.');
              current.splice(index, 1);
            } else if (useDefault || name !== undefined || width || height || rooms) {
              const base: Partial<TowerLayout> = useDefault ? defaultTowerLayout() : current[index] ?? {};
              current[index] = {
                name: name ?? base.name ?? '',
                width: width ?? base.width ?? TOWER_MAP_SIZE.min,
                height: height ?? base.height ?? TOWER_MAP_SIZE.min,
                rooms: (rooms ?? base.rooms ?? []) as TowerLayout['rooms'],
              };
            }
            next = current;
          }
          const settings = await saveTowerFloors(guildId, { layoutEnabled, floors: next });
          const roomCount = settings.floors.reduce((sum, entry) => sum + entry.rooms.length, 0);
          await audit(key_name, 'Étages de la Tour MCP', 'Carte', `${settings.floors.length} étage(s), ${roomCount} salles, ${settings.layoutEnabled ? 'jouée' : 'inactive'}`);
          return ok({ ok: true, layoutEnabled: settings.layoutEnabled, floors: settings.floors });
        } catch (e) {
          return fail(e);
        }
      })
    );

    server.registerTool(
      'save_rpg_tower_reward',
      {
        description: "Crée une récompense de Tour, ou modifie celle désignée par `id` (voir get_rpg_tower). SHOP : article payé en éclats (`price`), unique par joueur sauf `repeatable` (pièces seulement). MILESTONE : versé une fois au joueur qui franchit `floor` étages, peut offrir des éclats. Chaque récompense combine au choix un titre, un rôle, un objet, des pièces, de l'XP RPG, des points de clan (ou de l'XP de guilde RPG selon le mode d'équipe du serveur) et des éclats (paliers), avec au moins un de ces éléments. Préférer des titres sans bonus de stats. Un champ omis garde sa valeur. Requiert WRITE_MEMBERS.",
        inputSchema: {
          id: z.string().optional().describe('ID de la récompense à modifier. Absent : création.'),
          kind: z.enum(TOWER_REWARD_KINDS).optional().describe('Requis à la création'),
          name: z.string().optional().describe('Requis à la création'),
          description: z.string().optional(),
          emoji: z.string().optional(),
          price: z.number().int().min(1).optional().describe('Prix en éclats (SHOP)'),
          floor: z.number().int().min(1).optional().describe('Étages à franchir (MILESTONE)'),
          repeatable: z.boolean().optional(),
          titleId: z.string().nullable().optional().describe('Titre offert (voir get_rpg_titles), null pour aucun'),
          roleId: z.string().nullable().optional().describe('Rôle Discord offert, null pour aucun'),
          coins: z.number().int().min(0).optional().describe('Pièces du RPG offertes'),
          xp: z.number().int().min(0).optional().describe('XP du RPG offerte'),
          clanPoints: z.number().int().min(0).optional().describe('Points de clan, ou XP de guilde RPG selon le mode d\'équipe du serveur'),
          itemName: z.string().nullable().optional().describe('Objet offert (nom exact du catalogue), null pour aucun'),
          shards: z.number().int().min(0).optional().describe('Éclats offerts (MILESTONE)'),
          enabled: z.boolean().optional(),
          key_name: z.string().optional(),
        },
        _meta: toolMeta,
      },
      guard('WRITE_MEMBERS', async ({ id, key_name, ...input }) => {
        try {
          let base: Record<string, unknown> = {};
          if (id) {
            const existing = (await getTowerDashboard(guildId)).rewards.find((reward) => reward.id === id);
            if (!existing) return err('Récompense introuvable.');
            base = { ...existing };
          }
          const { reward, created } = await saveTowerReward(client, guildId, mergeDefined(base, input), id);
          await audit(key_name, created ? 'Création récompense de Tour MCP' : 'Modification récompense de Tour MCP', reward.name, reward.kind);
          return ok({ ok: true, id: reward.id, created });
        } catch (e) {
          return fail(e);
        }
      })
    );

    server.registerTool(
      'delete_rpg_tower_reward',
      {
        description: "Supprime une récompense de Tour. Les joueurs qui l'ont déjà obtenue la gardent (titre, rôle, pièces). Requiert WRITE_MEMBERS.",
        inputSchema: {
          id: z.string().describe('ID de la récompense (voir get_rpg_tower)'),
          key_name: z.string().optional(),
        },
        _meta: toolMeta,
      },
      guard('WRITE_MEMBERS', async ({ id, key_name }) => {
        try {
          const reward = await deleteTowerReward(guildId, id);
          await audit(key_name, 'Suppression récompense de Tour MCP', reward.name, '');
          return ok({ ok: true });
        } catch (e) {
          return fail(e);
        }
      })
    );

    server.registerTool(
      'start_rpg_tower_season',
      {
        description: "Ouvre une nouvelle saison de la Tour : remet à zéro le meilleur étage de la saison de tous les joueurs (le classement) et, sauf `resetMilestones: false`, rend les paliers de nouveau gagnables. Ne touche PAS aux éclats, aux améliorations, aux articles achetés ni au record de tous les temps ; les parties en cours continuent sans compter pour la nouvelle saison. Irréversible pour le classement : à ne lancer que sur demande explicite. Requiert WRITE_MEMBERS.",
        inputSchema: {
          confirm: z.literal(true).describe('Doit valoir true : confirme la remise à zéro du classement'),
          resetMilestones: z.boolean().optional().describe('Rendre les paliers de nouveau gagnables (défaut : true)'),
          key_name: z.string().optional(),
        },
        _meta: toolMeta,
      },
      guard('WRITE_MEMBERS', async ({ resetMilestones, key_name }) => {
        try {
          const reset = await startTowerSeason(guildId, { resetMilestones });
          await audit(key_name, 'Nouvelle saison de la Tour MCP', 'Classement', `${reset} profil(s) remis à zéro au classement`);
          return ok({ ok: true, reset });
        } catch (e) {
          return fail(e);
        }
      })
    );

    server.registerTool(
      'adjust_rpg_tower_shards',
      {
        description: "Ajoute (positif) ou retire (négatif) des éclats de Tour à un joueur. Le solde ne descend jamais sous zéro. N'affecte ni les records ni le plafond hebdomadaire. Requiert WRITE_MEMBERS.",
        inputSchema: {
          member: z.string().describe('Nom, @mention ou ID du membre'),
          amount: z.number().int().describe('Éclats à ajouter (positif) ou retirer (négatif), non nul'),
          key_name: z.string().optional(),
        },
        _meta: toolMeta,
      },
      guard('WRITE_MEMBERS', async ({ member, amount, key_name }) => {
        const resolved = await resolveMember(guildId, member);
        if (!resolved.ok) return resolved.response;
        try {
          const balance = await adjustTowerShards(guildId, resolved.userId, amount);
          await audit(key_name, 'Ajustement éclats de Tour MCP', resolved.label, `${amount > 0 ? '+' : ''}${amount} (solde ${balance})`);
          return ok({ ok: true, balance });
        } catch (e) {
          return fail(e);
        }
      })
    );
  }
}
