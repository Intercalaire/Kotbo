/**
 * La Tour : accès base du mode roguelite.
 *
 * Le profil Tour est distinct du profil RPG. Une partie vit en base et chaque action est
 * écrite sous condition de version : deux clics sur le même bouton ne jouent qu'un tour, et
 * un vieux message ne peut rien rejouer. Rien de ce que la partie contient (stats, objets,
 * or, bénédictions) ne rejoint le profil RPG ; seuls les éclats restent, et ce qu'ils achètent.
 */

import { EmbedBuilder, type Client } from 'discord.js';
import { Prisma, type RpgTowerReward, type RpgTowerRun } from '@prisma/client';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { resolveGuildLocale } from '../../../utils/i18n.js';
import * as m from '../../../lib/paraglide/messages.js';
import { checkLevelUp, getOrCreateEconomyConfig, getOrCreateRpgProfile } from '../economyService.js';
import { loadAvailableSkills, loadEffectiveStats, seedDefaultMonsters } from '../combatService.js';
import { getRpgClass } from './rpgClasses.js';
import { nodesForClass } from './rpgSkillTree.js';
import { TOWER_SIM_RUNS_MAX, simulateTowerRuns, type TowerSimResult } from './rpgTowerSim.js';
import { listGuildMonsters } from './rpgBestiaryService.js';
import { assertGuildTitle, grantTitle } from './rpgTitleService.js';
import { assertFirstKillRole, grantRpgRewardRole } from './rpgFirstKillService.js';
import { addInventoryQuantity, lockRpgProfile } from './rpgInventoryWrites.js';
import { awardRpgTeamPoints } from './rpgTeamRewards.js';
import { trackRpgObjective } from './rpgObjectiveTracker.js';
import {
  applyTowerAction,
  createTowerState,
  towerRoomsExplored,
  type TowerAction,
  type TowerActionError,
  TowerActionRefused,
  type TowerFoePool,
  type TowerGhost,
  type TowerRules,
  type TowerState,
} from './rpgTowerEngine.js';
import {
  STARTING_POTIONS,
  TOWER_DEFAULTS,
  TOWER_RARITIES,
  TOWER_RANGES,
  TOWER_REWARDS_PER_GUILD_MAX,
  applyWeeklyCap,
  computeTowerEntryStats,
  newTowerSeed,
  normalizeTowerReward,
  normalizeTowerSettings,
  parseTowerUpgrades,
  settleShards,
  towerUpgradeBonus,
  towerDailySeed,
  towerDayKey,
  towerFoeShape,
  towerSkill,
  towerSkillPrice,
  towerSkillTier,
  towerUpgradeCost,
  towerWeekStart,
  type TowerCoreStats,
  type TowerEntryMode,
  type TowerGear,
  type TowerOutcome,
  type TowerSettings,
  type TowerSkill,
  type TowerUpgradeDef,
} from './rpgTowerPolicy.js';
import {
  TOWER_FLOORS_MAX,
  TOWER_MAP_ROOMS_MAX,
  TOWER_MAP_SIZE,
  entryRooms,
  floorLayout,
  normalizeTowerFloors,
  normalizeTowerLayout,
  roomNeighbors,
  startRoom,
  towerCardTags,
  towerFloorLabel,
  towerLayoutKey,
  visibleRooms,
  type TowerLayout,
} from './rpgTowerMap.js';
import { heatsFromMask } from './rpgTowerContent.js';
import { towerFloorLayout } from './rpgTowerGen.js';
import { renderTowerImage } from './rpgTowerRender.js';

export class TowerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'TowerError';
  }
}

export type TowerRefusal =
  | { kind: 'disabled' }
  | { kind: 'active_run' }
  | { kind: 'no_run' }
  | { kind: 'stale' }
  | { kind: 'in_combat' }
  | { kind: 'action'; reason: TowerActionError }
  | { kind: 'shards'; price: number; balance: number }
  | { kind: 'owned' }
  | { kind: 'unavailable' }
  | { kind: 'upgrade_max' }
  | { kind: 'daily_disabled' }
  | { kind: 'daily_done' };

/** Refus d'une action de joueur, traduit par le panneau dans la langue du joueur. */
export class TowerRefused extends Error {
  constructor(readonly refusal: TowerRefusal) {
    super(`Tour refusée : ${refusal.kind}`);
    this.name = 'TowerRefused';
  }
}

export type TowerConfigView = TowerSettings & {
  seasonStartedAt: Date;
  /** Étages dessinés dans l'ordre de la montée, relus et validés ; vide si aucun ne passe. */
  floors: TowerLayout[];
  /** Réserve d'or de la source commune. */
  fountainGold: number;
};

export type TowerSettlement = {
  outcome: TowerOutcome;
  floorsCleared: number;
  kills: number;
  /** Éclats réellement versés. */
  shards: number;
  /** Éclats perdus à la mort. */
  lostToDeath: number;
  /** Éclats laissés en quittant hors palier sûr. */
  lostToLeave: number;
  /** Éclats retenus par le plafond hebdomadaire. */
  lostToCap: number;
  newBest: boolean;
  milestones: TowerRewardView[];
  /** Vrai quand la partie a été close par inactivité. */
  expired: boolean;
  /** Vrai quand un autre appel l'avait déjà soldée : rien n'a été versé cette fois. */
  alreadySettled?: boolean;
  /** Salles explorées, qui départagent le classement. Absent des bilans d'avant ce champ. */
  roomsExplored?: number;
  /** Monstre qui a fait tomber le joueur. */
  killedBy?: string | null;
  /** Équipement porté à la fin, par nom. */
  gear?: string[];
  /** Ascension du jour. */
  daily?: boolean;
};

export type ActiveTowerRun = { run: RpgTowerRun; state: TowerState };

/** Récompense accompagnée du nom de son titre, pour l'afficher sans autre lecture. */
export type TowerRewardView = RpgTowerReward & { titleName: string | null };

async function withTitleNames(rewards: RpgTowerReward[]): Promise<TowerRewardView[]> {
  const titleIds = [...new Set(rewards.map((reward) => reward.titleId).filter((id): id is string => id !== null))];
  const titles = titleIds.length > 0
    ? await prisma.rpgTitle.findMany({ where: { id: { in: titleIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(titles.map((title) => [title.id, title.name]));
  return rewards.map((reward) => ({ ...reward, titleName: reward.titleId ? nameById.get(reward.titleId) ?? null : null }));
}

// ─────────────────────────────────────────────────────────────
// Lecture
// ─────────────────────────────────────────────────────────────

export async function getTowerConfig(guildId: string): Promise<TowerConfigView> {
  const row = await prisma.rpgTowerConfig.findUnique({ where: { guildId } });
  if (!row) return { ...TOWER_DEFAULTS, seasonStartedAt: new Date(0), floors: [], fountainGold: 0 };
  const normalized = normalizeTowerSettings(row as unknown as Record<string, unknown>);
  const settings = normalized.ok ? normalized.value : TOWER_DEFAULTS;
  return {
    ...settings,
    enabled: row.enabled,
    seasonStartedAt: row.seasonStartedAt,
    floors: readFloors(row.layouts, row.layout),
    fountainGold: row.fountainGold,
  };
}

/**
 * Étages enregistrés. Un étage qui ne passe plus la validation est écarté plutôt que de
 * fermer toute la tour ; l'ancienne carte unique, d'avant les étages, sert de premier étage.
 */
function readFloors(layouts: Prisma.JsonValue, legacy: Prisma.JsonValue | null): TowerLayout[] {
  const source = Array.isArray(layouts) && layouts.length > 0 ? layouts : legacy ? [legacy] : [];
  return source
    .map((entry) => normalizeTowerLayout(entry))
    .filter((result): result is { ok: true; value: TowerLayout } => result.ok)
    .map((result) => result.value);
}



/** La Tour n'ouvre que si le module économie, le RPG et la Tour elle-même sont actifs. */
export async function isTowerOpen(guildId: string): Promise<boolean> {
  const [economy, tower] = await Promise.all([getOrCreateEconomyConfig(guildId), getTowerConfig(guildId)]);
  return economy.enabled && economy.rpgEnabled && tower.enabled;
}

export async function getOrCreateTowerProfile(guildId: string, userId: string) {
  return prisma.rpgTowerProfile.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: {},
    create: { guildId, userId },
  });
}

function rulesOf(settings: TowerSettings): TowerRules {
  return {
    floorGrowthPercent: settings.floorGrowthPercent,
    bossEvery: settings.bossEvery,
    blessingEvery: settings.blessingEvery,
    maxBlessings: settings.maxBlessings,
    shardsPerFloor: settings.shardsPerFloor,
    shardsPerRoom: settings.shardsPerRoom,
    merchant: settings.merchant,
    floorsAfter: settings.floorsAfter,
    generatedFog: settings.generatedFog,
  };
}

async function loadFoes(guildId: string): Promise<TowerFoePool> {
  await seedDefaultMonsters();
  // Désactivés compris : une salle peut imposer une créature retirée du bestiaire, comme un
  // donjon réserve ses boss. Le tirage au hasard, lui, ne pioche que dans les actives.
  const monsters = await listGuildMonsters(guildId, { includeDisabled: true });
  const enabled = monsters.filter((monster) => monster.enabled);
  // Chaque créature garde le profil de sa fiche : robuste, rapide ou brutale, à force égale.
  const foe = (monster: (typeof monsters)[number]) => ({ name: monster.name, emoji: monster.emoji, shape: towerFoeShape(monster) });
  return {
    monsters: enabled.filter((monster) => !monster.isBoss).map(foe),
    bosses: enabled.filter((monster) => monster.isBoss).map(foe),
    byName: Object.fromEntries(monsters.map((monster) => [monster.name, foe(monster)])),
  };
}

/** Créatures proposées au dashboard pour les salles qui imposent la leur. */
export async function listTowerFoeChoices(guildId: string) {
  await seedDefaultMonsters();
  const monsters = await listGuildMonsters(guildId, { includeDisabled: true });
  return monsters.map((monster) => ({ name: monster.name, emoji: monster.emoji, isBoss: monster.isBoss, enabled: monster.enabled }));
}

function parseState(value: Prisma.JsonValue): TowerState {
  return value as unknown as TowerState;
}

/** Démarrage du processus : le temps où le bot était coupé ne compte pas comme inactivité. */
const PROCESS_STARTED_AT = Date.now() - process.uptime() * 1000;

/**
 * Partie restée inactive au-delà du délai. L'inactivité ne court qu'à partir du démarrage du
 * bot : sans cela, un redémarrage plus long que le délai tuait tous les joueurs en combat.
 */
function isExpired(run: RpgTowerRun, idleTimeoutMinutes: number, now = Date.now()): boolean {
  const since = Math.max(run.lastActionAt.getTime(), PROCESS_STARTED_AT);
  return now - since > idleTimeoutMinutes * 60 * 1000;
}

export type TowerEntryPreview = {
  mode: TowerEntryMode;
  stats: TowerCoreStats;
  /** Stats effectives du RPG, pour montrer ce que la compression en a fait. */
  main: { attack: number; defense: number; speed: number; maxHealth: number };
  /**
   * Compétences du RPG que le joueur peut acheter pour l'ascension, déjà ramenées à la Tour.
   * Vide pour l'ascension du jour, qui se joue sans.
   */
  skills: TowerSkill[];
  potions: number;
  gold: number;
  titleName: string | null;
  className: string | null;
};

/**
 * Ce avec quoi le joueur entrerait dans la Tour : ses stats compressées, les compétences de
 * sa classe et de son arbre qu'il peut acheter, et ses potions de départ.
 */
export async function previewTowerEntry(guildId: string, userId: string, options: { daily?: boolean } = {}): Promise<TowerEntryPreview> {
  const [settings, rpgProfile, towerProfile] = await Promise.all([
    getTowerConfig(guildId),
    getOrCreateRpgProfile(guildId, userId),
    getOrCreateTowerProfile(guildId, userId),
  ]);

  const [main, skills, title] = await Promise.all([
    loadEffectiveStats(rpgProfile),
    loadAvailableSkills(rpgProfile),
    rpgProfile.activeTitleId ? prisma.rpgTitle.findUnique({ where: { id: rpgProfile.activeTitleId } }) : Promise.resolve(null),
  ]);

  const rpgClass = getRpgClass(rpgProfile.className);
  // L'ascension du jour se joue à armes égales : ni héritage du RPG, ni titre, ni amélioration,
  // ni compétence. Seule la classe distingue les joueurs.
  const daily = options.daily === true;
  const bonus = daily ? null : towerUpgradeBonus(settings.upgrades, parseTowerUpgrades(towerProfile.upgrades, settings.upgrades));
  const mode: TowerEntryMode = daily ? 'RESET' : settings.entryMode;

  const stats = computeTowerEntryStats({
    mode,
    inheritCapPercent: settings.inheritCapPercent,
    titleCapPercent: daily ? 0 : settings.titleCapPercent,
    main: { attack: main.attack, defense: main.defense, speed: main.speed, maxHealth: main.maxHealth },
    title: {
      attack: daily ? 0 : title?.attackBonus ?? 0,
      defense: daily ? 0 : title?.defenseBonus ?? 0,
      speed: daily ? 0 : title?.speedBonus ?? 0,
      maxHealth: daily ? 0 : title?.healthBonus ?? 0,
      critPercent: daily ? 0 : title?.critBonus ?? 0,
    },
    classModifiers: rpgClass?.modifiers ?? { attack: 1, defense: 1, speed: 1, maxHealth: 1 },
    classPassive: rpgClass?.passive ?? {},
    upgradeBonus: bonus ?? undefined,
  });

  return {
    mode,
    stats,
    main: { attack: main.attack, defense: main.defense, speed: main.speed, maxHealth: main.maxHealth },
    skills: daily ? [] : skills.map((skill) => towerSkill({
      id: skill.id,
      name: skill.name,
      emoji: skill.emoji,
      cooldownTurns: skill.cooldownTurns,
      effect: skill.effect,
      tier: towerSkillTier(skill),
    })),
    potions: STARTING_POTIONS + (bonus?.potions ?? 0),
    gold: bonus?.gold ?? 0,
    titleName: daily ? null : title?.name ?? null,
    className: rpgClass ? `${rpgClass.emoji} ${rpgClass.name}` : null,
  };
}

/**
 * Partie en cours du joueur. Une partie restée inactive trop longtemps est soldée ici :
 * en plein combat comme une mort (sinon fermer Discord suffirait à fuir un combat perdu),
 * ailleurs comme un abandon.
 */
export async function getActiveTowerRun(
  client: Client | null,
  guildId: string,
  userId: string,
): Promise<{ active: ActiveTowerRun | null; expired: TowerSettlement | null }> {
  const run = await prisma.rpgTowerRun.findFirst({
    where: { guildId, userId, status: 'ACTIVE' },
    orderBy: { startedAt: 'desc' },
  });
  if (!run) return { active: null, expired: null };

  const settings = await getTowerConfig(guildId);
  const state = parseState(run.state);
  if (!isExpired(run, settings.idleTimeoutMinutes)) return { active: { run, state }, expired: null };

  const settlement = await settleRun(client, run, state, state.phase === 'COMBAT' ? 'DEAD' : 'LEFT', settings, true);
  return { active: null, expired: settlement };
}

// ─────────────────────────────────────────────────────────────
// Partie
// ─────────────────────────────────────────────────────────────

/** Compétences choisies : le bit `i` de `mask` désigne la i-ème compétence de l'aperçu. */
export function pickTowerSkills(skills: readonly TowerSkill[], mask: number): TowerSkill[] {
  return skills.filter((_, index) => (mask & (1 << index)) !== 0);
}

/**
 * Ouvre une ascension. `daily` : l'ascension du jour, même graine pour tout le serveur et une
 * seule tentative par joueur et par jour ; elle a son propre classement et ne compte ni pour
 * la saison ni pour les paliers. `skillMask` : compétences achetées pour cette ascension,
 * payées en éclats à l'entrée. `heatMask` : malédictions choisies, chacune contre plus
 * d'éclats ; l'ascension du jour s'en passe, pour rester la même pour tous.
 */
export async function startTowerRun(
  client: Client | null,
  guildId: string,
  userId: string,
  options: { daily?: boolean; skillMask?: number; heatMask?: number } = {},
): Promise<ActiveTowerRun> {
  if (!(await isTowerOpen(guildId))) throw new TowerRefused({ kind: 'disabled' });
  const daily = options.daily === true;

  const { active } = await getActiveTowerRun(client, guildId, userId);
  if (active) throw new TowerRefused({ kind: 'active_run' });

  const [settings, preview, towerProfile] = await Promise.all([
    getTowerConfig(guildId),
    previewTowerEntry(guildId, userId, { daily }),
    getOrCreateTowerProfile(guildId, userId),
  ]);
  if (daily && !settings.dailyEnabled) throw new TowerRefused({ kind: 'daily_disabled' });

  const dayKey = towerDayKey(new Date());
  const seed = daily ? towerDailySeed(guildId, dayKey) : newTowerSeed();
  const skills = pickTowerSkills(preview.skills, options.skillMask ?? 0);
  const skillCost = skills.reduce((sum, skill) => sum + towerSkillPrice(settings.skillPrice, skill), 0);
  const state = createTowerState({
    base: preview.stats,
    skills,
    // Les compétences laissées au départ restent à la portée d'un mentor, contre de l'or.
    skillPool: preview.skills.filter((skill) => !skills.includes(skill)),
    heat: daily ? [] : heatsFromMask(options.heatMask ?? 0),
    potions: preview.potions,
    gold: preview.gold,
    seed,
    rules: rulesOf(settings),
    // Toujours un étage : les étages dessinés d'abord, générés ensuite ou à défaut.
    layout: towerFloorLayout(settings.floors, 1, settings.floorsAfter, seed, settings.generatedFog),
  });
  await attachGhosts(guildId, userId, state, daily);

  return prisma.$transaction(async (tx) => {
    // Le verrou du profil Tour sérialise deux clics « Entrer » : sans lui, les deux passaient
    // le contrôle de partie active et ouvraient chacun une ascension.
    await tx.$queryRaw`SELECT 1 FROM "rpg_tower_profiles" WHERE "id" = ${towerProfile.id} FOR UPDATE`;
    const running = await tx.rpgTowerRun.count({ where: { profileId: towerProfile.id, status: 'ACTIVE' } });
    if (running > 0) throw new TowerRefused({ kind: 'active_run' });
    if (daily) {
      const played = await tx.rpgTowerRun.count({ where: { profileId: towerProfile.id, mode: 'DAILY', dailyKey: dayKey } });
      if (played > 0) throw new TowerRefused({ kind: 'daily_done' });
    }
    if (skillCost > 0) {
      const fresh = await tx.rpgTowerProfile.findUniqueOrThrow({ where: { id: towerProfile.id }, select: { shards: true } });
      if (fresh.shards < skillCost) throw new TowerRefused({ kind: 'shards', price: skillCost, balance: fresh.shards });
    }

    const run = await tx.rpgTowerRun.create({
      data: {
        profileId: towerProfile.id,
        guildId,
        userId,
        state: state as unknown as Prisma.InputJsonValue,
        mode: daily ? 'DAILY' : 'CLASSIC',
        dailyKey: daily ? dayKey : null,
      },
    });
    await tx.rpgTowerProfile.update({
      where: { id: towerProfile.id },
      data: { totalRuns: { increment: 1 }, ...(skillCost > 0 ? { shards: { decrement: skillCost } } : {}) },
    });
    return { run, state };
  });
}

type LoadedRun = { kind: 'expired'; settlement: TowerSettlement } | { kind: 'active'; active: ActiveTowerRun };

async function loadRunForAction(client: Client | null, guildId: string, userId: string, version: number): Promise<LoadedRun> {
  const { active, expired } = await getActiveTowerRun(client, guildId, userId);
  if (expired) return { kind: 'expired', settlement: expired };
  if (!active) throw new TowerRefused({ kind: 'no_run' });
  if (active.run.version !== version) throw new TowerRefused({ kind: 'stale' });
  return { kind: 'active', active };
}

export type TowerActResult = { active: ActiveTowerRun | null; settlement: TowerSettlement | null };

export async function actTowerRun(
  client: Client | null,
  guildId: string,
  userId: string,
  version: number,
  action: TowerAction,
): Promise<TowerActResult> {
  const loaded = await loadRunForAction(client, guildId, userId, version);
  if (loaded.kind === 'expired') return { active: null, settlement: loaded.settlement };
  const { run, state } = loaded.active;

  const [settings, foes] = await Promise.all([getTowerConfig(guildId), loadFoes(guildId)]);

  // La source commune se lit au moment de l'action : d'autres joueurs y puisent et y versent.
  state.fountainPool = settings.fountainGold;
  let step: ReturnType<typeof applyTowerAction>;
  try {
    step = applyTowerAction(state, run.floor, action, rulesOf(settings), foes, settings.floors);
  } catch (err) {
    if (err instanceof TowerActionRefused) throw new TowerRefused({ kind: 'action', reason: err.reason });
    throw err;
  }
  // Nouvel étage : on y pose les fantômes des joueurs tombés sur la même carte.
  if (step.state.map && (!state.map || towerLayoutKey(step.state.map.layout) !== towerLayoutKey(state.map.layout))) {
    await attachGhosts(guildId, userId, step.state, run.mode === 'DAILY');
  }
  const ghostTaken = step.state.ghostTaken ?? null;
  step.state.ghostTaken = null;
  const fountainDelta = step.state.fountainDelta ?? 0;
  step.state.fountainDelta = 0;

  const written = await prisma.rpgTowerRun.updateMany({
    where: { id: run.id, status: 'ACTIVE', version: run.version },
    data: {
      state: step.state as unknown as Prisma.InputJsonValue,
      floor: step.floor,
      version: { increment: 1 },
      lastActionAt: new Date(),
      shardsEarned: step.state.shards,
    },
  });
  if (written.count === 0) throw new TowerRefused({ kind: 'stale' });
  if (ghostTaken) await claimGhost(ghostTaken, userId).catch((err) => logger.warn('RpgTower', `Fantôme ${ghostTaken} non marqué comme repris :`, err));
  if (fountainDelta !== 0) {
    await moveFountainGold(guildId, fountainDelta).catch((err) => logger.warn('RpgTower', `Source commune non mise à jour sur ${guildId} :`, err));
  }
  // Quêtes de la Tour : étages franchis, monstres et gardiens vaincus, à part de ceux du RPG.
  if (client) {
    const climbed = step.state.floorsCleared - state.floorsCleared;
    const bosses = (step.state.bossKills ?? 0) - (state.bossKills ?? 0);
    const monsters = step.state.kills - state.kills - bosses;
    if (climbed > 0) await trackRpgObjective(client, guildId, userId, 'TOWER_FLOORS', climbed);
    if (monsters > 0) await trackRpgObjective(client, guildId, userId, 'TOWER_MONSTER_KILLS', monsters);
    if (bosses > 0) await trackRpgObjective(client, guildId, userId, 'TOWER_BOSS_KILLS', bosses);
  }

  const updated: RpgTowerRun = {
    ...run,
    state: step.state as unknown as Prisma.JsonValue,
    floor: step.floor,
    version: run.version + 1,
    lastActionAt: new Date(),
    shardsEarned: step.state.shards,
  };

  if (step.dead) {
    const settlement = await settleRun(client, updated, step.state, 'DEAD', settings, false);
    return { active: null, settlement };
  }
  return { active: { run: updated, state: step.state }, settlement: null };
}

/** Quitter la Tour garde tous les éclats. Impossible en plein combat : on ne fuit pas un étage. */
export async function abandonTowerRun(client: Client | null, guildId: string, userId: string, version: number): Promise<TowerSettlement> {
  const loaded = await loadRunForAction(client, guildId, userId, version);
  if (loaded.kind === 'expired') return loaded.settlement;
  const { run, state } = loaded.active;
  if (state.phase === 'COMBAT') throw new TowerRefused({ kind: 'in_combat' });
  return settleRun(client, run, state, 'LEFT', await getTowerConfig(guildId), false);
}

/** Objet du catalogue désigné par son nom : celui du serveur l'emporte sur le livré du même nom. */
async function findGuildItem(client: Prisma.TransactionClient, guildId: string, name: string) {
  const items = await client.rpgItem.findMany({
    where: { name, OR: [{ guildId: null }, { guildId }] },
    select: { id: true, emoji: true, guildId: true },
  });
  return items.find((candidate) => candidate.guildId !== null) ?? items[0] ?? null;
}

/**
 * Verse une récompense de Tour au profil RPG. Chaque versement est isolé : un incident sur
 * le rôle ou les points de clan ne prive pas le joueur du reste, qu'il ne pourra plus réclamer.
 */
async function grantRewardToPlayer(client: Client | null, guildId: string, userId: string, reward: RpgTowerReward, reason: string): Promise<void> {
  const settle = <T>(step: string, run: () => Promise<T>): Promise<T | null> => run().catch((err) => {
    logger.warn('RpgTower', `${step} de « ${reward.name} » non versé à ${userId} sur ${guildId} :`, err);
    return null;
  });

  const itemName = reward.itemName;
  if (reward.coins > 0 || reward.xp > 0 || reward.titleId || itemName) {
    const rpgProfile = await getOrCreateRpgProfile(guildId, userId);
    if (reward.coins > 0 || reward.xp > 0 || itemName) {
      await settle('Pièces, XP et objet', () => prisma.$transaction(async (tx) => {
        await lockRpgProfile(tx, rpgProfile.id);
        if (reward.coins > 0 || reward.xp > 0) {
          await tx.rpgProfile.update({
            where: { id: rpgProfile.id },
            data: { balance: { increment: reward.coins }, xp: { increment: reward.xp } },
          });
        }
        if (itemName) {
          const item = await findGuildItem(tx, guildId, itemName);
          if (item) await addInventoryQuantity(tx, rpgProfile.id, item.id, 1);
          else logger.warn('RpgTower', `Objet « ${itemName} » introuvable pour la récompense ${reward.id} sur ${guildId}.`);
        }
      }));
      if (reward.xp > 0) await settle('Passage de niveau', () => checkLevelUp(guildId, userId));
    }
    const titleId = reward.titleId;
    if (titleId) await settle('Titre', () => grantTitle(rpgProfile.id, titleId));
  }

  if (!client) return;
  const discord = client;
  if (reward.clanPoints > 0) {
    await settle('Points de clan', () => awardRpgTeamPoints({
      client: discord,
      guildId,
      userId,
      amount: reward.clanPoints,
      source: 'RPG_TOWER',
      reason,
    }));
  }
  const roleId = reward.roleId;
  if (roleId) await settle('Rôle', () => grantRpgRewardRole(discord, guildId, userId, roleId, reason));
}

/**
 * Solde une partie : éclats (moins la pénalité de mort et le plafond hebdomadaire), record
 * de la saison et paliers atteints. La partie est close en premier, sous condition de statut :
 * une partie ne peut être soldée qu'une fois, même si l'expiration et un clic se croisent.
 * Une partie commencée avant l'ouverture de la saison ne compte pas pour son classement.
 */
async function settleRun(
  client: Client | null,
  run: RpgTowerRun,
  state: TowerState,
  outcome: TowerOutcome,
  settings: TowerConfigView,
  expired: boolean,
): Promise<TowerSettlement> {
  const kept = settleShards(state.shards, outcome, settings.deathShardPercent, settings.leaveShardPercent, state.safeLeave === true);
  const now = new Date();
  const weekStart = towerWeekStart(now);
  const daily = run.mode === 'DAILY';
  const rooms = towerRoomsExplored(state);
  const killedBy = outcome === 'DEAD' ? state.encounter?.name ?? null : null;
  const ghostGear = bestGhostGear(state);
  const death = outcome === 'DEAD' && state.map
    ? {
      deathRoom: state.map.pos,
      deathFloorKey: towerLayoutKey(state.map.layout),
      ...(ghostGear ? { ghostGear: ghostGear as unknown as Prisma.InputJsonValue } : {}),
    }
    : {};
  const gear = (['weapon', 'armor', 'relic'] as const)
    .map((slot) => state.gear[slot]?.name)
    .filter((name): name is string => Boolean(name));

  const result = await prisma.$transaction(async (tx) => {
    const closed = await tx.rpgTowerRun.updateMany({
      where: { id: run.id, status: 'ACTIVE' },
      data: { status: outcome, endedAt: now, shardsEarned: kept, floorsCleared: state.floorsCleared, roomsExplored: rooms, killedBy, ...death },
    });
    if (closed.count === 0) return null;

    await tx.$queryRaw`SELECT 1 FROM "rpg_tower_profiles" WHERE "id" = ${run.profileId} FOR UPDATE`;
    const profile = await tx.rpgTowerProfile.findUniqueOrThrow({ where: { id: run.profileId } });
    const sameWeek = profile.weekStart !== null && profile.weekStart.getTime() === weekStart.getTime();
    const weekSoFar = sameWeek ? profile.weekShards : 0;
    const granted = applyWeeklyCap(kept, weekSoFar, settings.weeklyShardCap);
    // L'ascension du jour, à stats égales, a son propre classement : elle ne touche ni à la
    // saison, ni aux records, ni aux paliers.
    const inSeason = !daily && run.startedAt.getTime() >= settings.seasonStartedAt.getTime();
    // À étages égaux, les salles explorées départagent : sur carte, les égalités sont fréquentes.
    const newBest = inSeason && (state.floorsCleared > profile.bestFloor
      || (state.floorsCleared === profile.bestFloor && state.floorsCleared > 0 && rooms > profile.bestRooms));
    const top = newBest
      ? await tx.rpgTowerProfile.aggregate({ where: { guildId: run.guildId, id: { not: profile.id } }, _max: { bestFloor: true } })
      : null;
    const serverRecord = newBest && state.floorsCleared > (top?._max.bestFloor ?? 0);

    const milestones = daily ? [] : await tx.rpgTowerReward.findMany({
      where: {
        guildId: run.guildId,
        kind: 'MILESTONE',
        enabled: true,
        floor: { lte: state.floorsCleared },
        id: { notIn: profile.claimedRewardIds },
      },
      orderBy: { floor: 'asc' },
    });
    const milestoneShards = milestones.reduce((sum, reward) => sum + reward.shards, 0);

    await tx.rpgTowerProfile.update({
      where: { id: profile.id },
      data: {
        shards: { increment: granted + milestoneShards },
        lifetimeShards: { increment: granted + milestoneShards },
        weekShards: weekSoFar + granted,
        weekStart,
        ...(newBest ? { bestFloor: state.floorsCleared, bestRooms: rooms, bestFloorAt: now } : {}),
        ...(!daily && state.floorsCleared > profile.bestFloorAllTime ? { bestFloorAllTime: state.floorsCleared } : {}),
        ...(milestones.length > 0 ? { claimedRewardIds: { push: milestones.map((reward) => reward.id) } } : {}),
      },
    });

    return { granted, newBest, serverRecord, milestones };
  });

  if (!result) {
    // Déjà soldée par un appel concurrent : on relit ce qui a été versé, sans rien reverser.
    const done = await prisma.rpgTowerRun.findUnique({ where: { id: run.id } });
    return {
      outcome: (done?.status as TowerOutcome) ?? outcome,
      floorsCleared: state.floorsCleared,
      kills: state.kills,
      shards: done?.shardsEarned ?? 0,
      lostToDeath: 0,
      lostToLeave: 0,
      lostToCap: 0,
      newBest: false,
      milestones: [],
      expired,
      alreadySettled: true,
      roomsExplored: rooms,
      killedBy,
      gear,
      daily,
    };
  }

  if (result.serverRecord && client && settings.announceChannelId) {
    await announceRecord(client, run.guildId, settings, run.userId, state.floorsCleared).catch((err) => {
      logger.warn('RpgTower', `Annonce du record non envoyée sur ${run.guildId} :`, err);
    });
  }

  for (const reward of result.milestones) {
    await grantRewardToPlayer(client, run.guildId, run.userId, reward, `Tour : palier ${reward.floor}`).catch((err) => {
      logger.error('RpgTower', `Palier ${reward.id} non versé à ${run.userId} :`, err);
    });
  }

  return {
    outcome,
    floorsCleared: state.floorsCleared,
    kills: state.kills,
    shards: result.granted,
    lostToDeath: outcome === 'DEAD' ? state.shards - kept : 0,
    lostToLeave: outcome === 'LEFT' ? state.shards - kept : 0,
    lostToCap: kept - result.granted,
    newBest: result.newBest,
    milestones: await withTitleNames(result.milestones),
    expired,
    roomsExplored: rooms,
    killedBy,
    gear,
    daily,
  };
}

/** Nouveau record de la saison sur le serveur : annoncé dans le salon choisi, sans notifier personne. */
async function announceRecord(client: Client, guildId: string, settings: TowerConfigView, userId: string, floors: number): Promise<void> {
  const channel = await client.channels.fetch(settings.announceChannelId!).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    logger.warn('RpgTower', `Salon d'annonce de la Tour injoignable pour ${guildId}.`);
    return;
  }
  const locale = await resolveGuildLocale(guildId);
  const image = await renderTowerImage({
    kind: 'shaft',
    title: settings.name,
    floor: Math.max(1, floors),
    bossEvery: settings.bossEvery,
    floorLabel: (value) => m.tower_floor({ floor: value }, { locale }),
  });
  const embed = new EmbedBuilder()
    .setTitle(m.tower_announce_title({ name: settings.name }, { locale }))
    .setDescription(m.tower_announce_desc({ user: `<@${userId}>`, floors }, { locale }))
    .setColor(0x8b5cf6);
  if (image) embed.setImage('attachment://tour.png');
  await channel.send({
    embeds: [embed],
    files: image ? [{ attachment: image, name: 'tour.png' }] : [],
    allowedMentions: { parse: [] },
  });
}

const IDLE_SWEEP_BATCH = 200;

/**
 * Solde les parties restées inactives au-delà du délai de leur serveur. Sans ce balayage,
 * une partie n'était close qu'à la réouverture de la Tour : celle d'un joueur qui ne revenait
 * pas restait en cours pour toujours, sans record ni paliers versés.
 */
export async function expireIdleTowerRuns(client: Client | null): Promise<number> {
  const now = Date.now();
  const candidates = await prisma.rpgTowerRun.findMany({
    where: {
      status: 'ACTIVE',
      lastActionAt: { lt: new Date(now - TOWER_RANGES.idleTimeoutMinutes.min * 60 * 1000) },
    },
    orderBy: { lastActionAt: 'asc' },
    take: IDLE_SWEEP_BATCH,
  });

  const configs = new Map<string, TowerConfigView>();
  let closed = 0;
  for (const run of candidates) {
    let settings = configs.get(run.guildId);
    if (!settings) {
      settings = await getTowerConfig(run.guildId);
      configs.set(run.guildId, settings);
    }
    if (!isExpired(run, settings.idleTimeoutMinutes, now)) continue;
    const state = parseState(run.state);
    try {
      const settlement = await settleRun(client, run, state, state.phase === 'COMBAT' ? 'DEAD' : 'LEFT', settings, true);
      // Soldée entre-temps par le joueur lui-même : il a déjà vu son bilan.
      if (settlement.alreadySettled) continue;
      // Le joueur n'était pas là : son bilan l'attend à sa prochaine visite.
      await prisma.rpgTowerProfile.update({
        where: { id: run.profileId },
        // Aller-retour JSON : les dates des récompenses deviennent du texte, comme à la relecture.
        data: { pendingSettlement: JSON.parse(JSON.stringify(settlement)) as Prisma.InputJsonValue },
      });
      closed += 1;
    } catch (err) {
      logger.error('RpgTower', `Partie ${run.id} expirée non soldée :`, err);
    }
  }
  if (closed > 0) logger.info('RpgTower', `${closed} ascension(s) inactive(s) soldée(s).`);
  return closed;
}

/**
 * Bilan d'une partie close par le balayage, rendu une seule fois : la lecture l'efface sous
 * condition, si bien que deux écrans ouverts en même temps ne l'affichent pas deux fois.
 */
export async function takePendingTowerSettlement(guildId: string, userId: string): Promise<TowerSettlement | null> {
  const profile = await prisma.rpgTowerProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { id: true, pendingSettlement: true },
  });
  if (!profile?.pendingSettlement) return null;
  const taken = await prisma.rpgTowerProfile.updateMany({
    where: { id: profile.id, pendingSettlement: { not: Prisma.DbNull } },
    data: { pendingSettlement: Prisma.DbNull },
  });
  return taken.count > 0 ? (profile.pendingSettlement as unknown as TowerSettlement) : null;
}

// ─────────────────────────────────────────────────────────────
// Boutique, améliorations, classement
// ─────────────────────────────────────────────────────────────

export async function getTowerShop(guildId: string, userId: string) {
  const [settings, profile, rewards, milestones] = await Promise.all([
    getTowerConfig(guildId),
    getOrCreateTowerProfile(guildId, userId),
    prisma.rpgTowerReward.findMany({ where: { guildId, kind: 'SHOP', enabled: true }, orderBy: [{ price: 'asc' }, { name: 'asc' }] }),
    prisma.rpgTowerReward.findMany({ where: { guildId, kind: 'MILESTONE', enabled: true }, orderBy: { floor: 'asc' } }),
  ]);
  return {
    profile,
    rewards: await withTitleNames(rewards),
    milestones: await withTitleNames(milestones),
    upgrades: settings.upgrades.filter((upgrade) => upgrade.enabled),
    levels: parseTowerUpgrades(profile.upgrades, settings.upgrades),
  };
}

export async function buyTowerReward(client: Client | null, guildId: string, userId: string, rewardId: string): Promise<RpgTowerReward> {
  const reward = await prisma.rpgTowerReward.findUnique({ where: { id: rewardId } });
  if (!reward || reward.guildId !== guildId || reward.kind !== 'SHOP' || !reward.enabled) {
    throw new TowerRefused({ kind: 'unavailable' });
  }
  const profile = await getOrCreateTowerProfile(guildId, userId);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "rpg_tower_profiles" WHERE "id" = ${profile.id} FOR UPDATE`;
    const fresh = await tx.rpgTowerProfile.findUniqueOrThrow({ where: { id: profile.id } });
    if (!reward.repeatable && fresh.claimedRewardIds.includes(reward.id)) throw new TowerRefused({ kind: 'owned' });
    if (fresh.shards < reward.price) throw new TowerRefused({ kind: 'shards', price: reward.price, balance: fresh.shards });
    await tx.rpgTowerProfile.update({
      where: { id: profile.id },
      data: {
        shards: { decrement: reward.price },
        ...(reward.repeatable ? {} : { claimedRewardIds: { push: reward.id } }),
      },
    });
  });

  await grantRewardToPlayer(client, guildId, userId, reward, `Tour : achat de ${reward.name}`);
  return reward;
}

export async function buyTowerUpgrade(guildId: string, userId: string, id: string): Promise<{ upgrade: TowerUpgradeDef; level: number }> {
  const settings = await getTowerConfig(guildId);
  const upgrade = settings.upgrades.find((candidate) => candidate.id === id && candidate.enabled);
  if (!upgrade) throw new TowerRefused({ kind: 'unavailable' });
  const profile = await getOrCreateTowerProfile(guildId, userId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "rpg_tower_profiles" WHERE "id" = ${profile.id} FOR UPDATE`;
    const fresh = await tx.rpgTowerProfile.findUniqueOrThrow({ where: { id: profile.id } });
    const stored = fresh.upgrades && typeof fresh.upgrades === 'object' ? (fresh.upgrades as Record<string, unknown>) : {};
    const level = parseTowerUpgrades(stored, [upgrade])[upgrade.id];
    if (level >= upgrade.maxLevel) throw new TowerRefused({ kind: 'upgrade_max' });
    const cost = towerUpgradeCost(upgrade, level);
    if (fresh.shards < cost) throw new TowerRefused({ kind: 'shards', price: cost, balance: fresh.shards });
    await tx.rpgTowerProfile.update({
      where: { id: profile.id },
      data: {
        shards: { decrement: cost },
        // Les niveaux des améliorations supprimées restent en base : les rétablir sous le
        // même identifiant rendrait ce que le joueur avait payé.
        upgrades: { ...stored, [upgrade.id]: level + 1 } as Prisma.InputJsonValue,
      },
    });
    return { upgrade, level: level + 1 };
  });
}

export async function getTowerLeaderboard(guildId: string, limit = 10) {
  return prisma.rpgTowerProfile.findMany({
    where: { guildId, bestFloor: { gt: 0 } },
    orderBy: [{ bestFloor: 'desc' }, { bestRooms: 'desc' }, { bestFloorAt: 'asc' }],
    take: limit,
    select: { userId: true, bestFloor: true, bestRooms: true, bestFloorAt: true, totalRuns: true },
  });
}

/** Classement de l'ascension du jour : étages, puis salles explorées, puis le plus tôt fini. */
export async function getTowerDailyLeaderboard(guildId: string, dayKey = towerDayKey(new Date()), limit = 10) {
  return prisma.rpgTowerRun.findMany({
    where: { guildId, mode: 'DAILY', dailyKey: dayKey, status: { not: 'ACTIVE' } },
    orderBy: [{ floorsCleared: 'desc' }, { roomsExplored: 'desc' }, { endedAt: 'asc' }],
    take: limit,
    select: { userId: true, floorsCleared: true, roomsExplored: true, status: true, endedAt: true },
  });
}

/** Le joueur a-t-il déjà joué l'ascension du jour ? */
export async function hasPlayedDaily(guildId: string, userId: string, dayKey = towerDayKey(new Date())): Promise<boolean> {
  return (await prisma.rpgTowerRun.count({ where: { guildId, userId, mode: 'DAILY', dailyKey: dayKey } })) > 0;
}

/**
 * Ce que disent les parties terminées : étage moyen, part des morts, monstres qui tuent le
 * plus et étage où l'on tombe le plus. De quoi repérer un étage ou un monstre mal réglé.
 * Un étage à variantes est départagé par variante (« 3-E ») : la carte de la mort est
 * reconnue à son empreinte, tant qu'elle n'a pas été redessinée depuis.
 */
export async function getTowerInsights(guildId: string, floors: readonly TowerLayout[]) {
  const finished = { guildId, mode: 'CLASSIC', status: { in: ['DEAD', 'LEFT'] } };
  const [totals, deaths, killers, deathRows] = await Promise.all([
    prisma.rpgTowerRun.aggregate({ where: finished, _avg: { floorsCleared: true }, _count: { _all: true } }),
    prisma.rpgTowerRun.count({ where: { guildId, mode: 'CLASSIC', status: 'DEAD' } }),
    prisma.rpgTowerRun.groupBy({
      by: ['killedBy'],
      where: { guildId, mode: 'CLASSIC', status: 'DEAD', killedBy: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { killedBy: 'desc' } },
      take: 3,
    }),
    prisma.rpgTowerRun.groupBy({
      by: ['floor', 'deathFloorKey'],
      where: { guildId, mode: 'CLASSIC', status: 'DEAD' },
      _count: { _all: true },
    }),
  ]);
  const count = totals._count._all;

  const tags = towerCardTags(floors);
  const cardByKey = new Map(floors.map((layout, index) => [towerLayoutKey(layout), index]));
  const byLabel = new Map<string, { floor: number; variant: string; label: string; name: string; deaths: number }>();
  for (const row of deathRows) {
    const card = row.deathFloorKey ? cardByKey.get(row.deathFloorKey) : undefined;
    const variant = card === undefined ? '' : tags[card].variant;
    const label = towerFloorLabel(row.floor, variant);
    const entry = byLabel.get(label) ?? { floor: row.floor, variant, label, name: card === undefined ? '' : floors[card].name, deaths: 0 };
    entry.deaths += row._count._all;
    byLabel.set(label, entry);
  }
  const deadliest = [...byLabel.values()].sort((a, b) => b.deaths - a.deaths || a.floor - b.floor)[0] ?? null;
  return {
    finishedRuns: count,
    averageFloor: Math.round((totals._avg.floorsCleared ?? 0) * 10) / 10,
    deathRate: count > 0 ? Math.round((deaths / count) * 100) : 0,
    topKillers: killers.map((row) => ({ name: row.killedBy ?? '', deaths: row._count._all })),
    deadliestFloor: deadliest,
  };
}

// ─────────────────────────────────────────────────────────────
// Fantômes
// ─────────────────────────────────────────────────────────────

/** Un fantôme ne reste que ce temps : au-delà, l'étage a trop changé de visiteurs. */
const GHOST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Fantômes au plus par étage, pour qu'ils restent une surprise. */
const GHOSTS_PER_FLOOR = 2;

/** La meilleure pièce portée : rareté d'abord, puis la somme des stats. */
function bestGhostGear(state: TowerState): TowerGear | null {
  const pieces = Object.values(state.gear).filter((gear): gear is TowerGear => Boolean(gear));
  const weight = (gear: TowerGear) => TOWER_RARITIES.indexOf(gear.rarity) * 10_000 + gear.attack + gear.defense + gear.speed + gear.maxHealth;
  return pieces.sort((a, b) => weight(b) - weight(a))[0] ?? null;
}

/**
 * Pose sur l'étage en cours les fantômes d'autres joueurs tombés sur la même carte : leur
 * équipement attend le premier qui remportera la salle. L'ascension du jour, à armes égales,
 * n'en reçoit ni n'en laisse.
 */
async function attachGhosts(guildId: string, userId: string, state: TowerState, daily: boolean): Promise<void> {
  const map = state.map;
  if (!map || daily) return;
  const rows = await prisma.rpgTowerRun.findMany({
    where: {
      guildId,
      mode: 'CLASSIC',
      status: 'DEAD',
      deathFloorKey: towerLayoutKey(map.layout),
      ghostClaimedBy: null,
      ghostGear: { not: Prisma.DbNull },
      userId: { not: userId },
      endedAt: { gte: new Date(Date.now() - GHOST_TTL_MS) },
    },
    orderBy: { endedAt: 'desc' },
    take: 10,
    select: { id: true, userId: true, deathRoom: true, ghostGear: true },
  });
  const ghosts: TowerGhost[] = [];
  for (const row of rows) {
    if (ghosts.length >= GHOSTS_PER_FLOOR) break;
    if (!row.deathRoom || map.cleared.includes(row.deathRoom) || ghosts.some((ghost) => ghost.roomId === row.deathRoom)) continue;
    if (!map.layout.rooms.some((room) => room.id === row.deathRoom)) continue;
    ghosts.push({ roomId: row.deathRoom, userId: row.userId, runId: row.id, gear: row.ghostGear as unknown as TowerGear });
  }
  map.ghosts = ghosts;
}

/**
 * Verse dans la source commune ou y puise. Un retrait ne descend jamais sous zéro : deux
 * joueurs qui boivent au même instant ne creusent pas la réserve.
 */
async function moveFountainGold(guildId: string, delta: number): Promise<void> {
  if (delta > 0) {
    await prisma.rpgTowerConfig.upsert({
      where: { guildId },
      update: { fountainGold: { increment: delta } },
      create: { guildId, fountainGold: delta },
    });
    return;
  }
  await prisma.rpgTowerConfig.updateMany({ where: { guildId, fountainGold: { gte: -delta } }, data: { fountainGold: { decrement: -delta } } });
}

/** Marque un fantôme comme repris : un seul joueur récupère son équipement. */
async function claimGhost(runId: string, userId: string): Promise<void> {
  await prisma.rpgTowerRun.updateMany({ where: { id: runId, ghostClaimedBy: null }, data: { ghostClaimedBy: userId } });
}

/**
 * Carte des morts : pour chaque étage dessiné, par son empreinte, le nombre de morts par salle.
 * Seules comptent les morts d'un étage identique à celui enregistré.
 */
export async function getTowerDeathMap(guildId: string, floors: readonly TowerLayout[]): Promise<Record<string, Record<string, number>>> {
  const keys = [...new Set(floors.map((floor) => towerLayoutKey(floor)))];
  if (keys.length === 0) return {};
  const rows = await prisma.rpgTowerRun.groupBy({
    by: ['deathFloorKey', 'deathRoom'],
    where: { guildId, status: 'DEAD', deathFloorKey: { in: keys }, deathRoom: { not: null } },
    _count: { _all: true },
  });
  const map: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (!row.deathFloorKey || !row.deathRoom) continue;
    (map[row.deathFloorKey] ??= {})[row.deathRoom] = row._count._all;
  }
  return map;
}

/**
 * Garde-fous de la simulation : elle ne touche pas la base, mais occupe le processeur du bot.
 * Une seule à la fois par serveur, un délai entre deux, et deux au plus sur tout le bot.
 */
const SIM_COOLDOWN_MS = 30_000;
const SIM_CONCURRENT_MAX = 2;
const simRunning = new Set<string>();
const simLastStart = new Map<string, number>();

/**
 * Simulation d'équilibrage pour le dashboard : un joueur automatique de la classe donnée, aux
 * stats d'entrée sans héritage du RPG ni amélioration (comme l'ascension du jour), joue
 * `runs` ascensions sur la Tour telle qu'enregistrée. `skills` : il emporte toutes les
 * compétences de sa classe et de son arbre, ramenées à la Tour.
 */
export async function simulateTower(guildId: string, input: { className?: unknown; runs?: unknown; skills?: unknown; heatMask?: unknown }): Promise<TowerSimResult> {
  if (simRunning.has(guildId)) throw new TowerError('Une simulation est déjà en cours pour ce serveur.', 429);
  const wait = (simLastStart.get(guildId) ?? 0) + SIM_COOLDOWN_MS - Date.now();
  if (wait > 0) throw new TowerError(`Patientez ${Math.ceil(wait / 1000)} s avant une nouvelle simulation.`, 429);
  if (simRunning.size >= SIM_CONCURRENT_MAX) throw new TowerError('Le bot fait déjà tourner des simulations : réessayez dans un instant.', 429);
  simRunning.add(guildId);
  simLastStart.set(guildId, Date.now());
  try {
    return await runSimulation(guildId, input);
  } finally {
    simRunning.delete(guildId);
  }
}

async function runSimulation(guildId: string, input: { className?: unknown; runs?: unknown; skills?: unknown; heatMask?: unknown }): Promise<TowerSimResult> {
  const rpgClass = getRpgClass(typeof input.className === 'string' ? input.className : null);
  const [settings, foes] = await Promise.all([getTowerConfig(guildId), loadFoes(guildId)]);
  const stats = computeTowerEntryStats({
    mode: 'RESET',
    inheritCapPercent: 0,
    titleCapPercent: 0,
    main: { attack: 0, defense: 0, speed: 0, maxHealth: 0 },
    title: { attack: 0, defense: 0, speed: 0, maxHealth: 0, critPercent: 0 },
    classModifiers: rpgClass?.modifiers ?? { attack: 1, defense: 1, speed: 1, maxHealth: 1 },
    classPassive: rpgClass?.passive ?? {},
  });
  const rpgSkills = input.skills === true && rpgClass
    ? [...rpgClass.skills, ...nodesForClass(rpgClass.id).flatMap((node) => (node.grantsSkill ? [node.grantsSkill] : []))]
    : [];
  const skills = rpgSkills.map((skill) => towerSkill({
    id: skill.id,
    name: skill.name,
    emoji: skill.emoji,
    cooldownTurns: skill.cooldownTurns,
    effect: skill.effect,
    tier: towerSkillTier(skill),
  }));
  const runs = Math.min(TOWER_SIM_RUNS_MAX, Math.max(1, Math.trunc(Number(input.runs) || 50)));
  return simulateTowerRuns({
    base: stats,
    skills,
    potions: STARTING_POTIONS,
    rules: rulesOf(settings),
    foes,
    floors: settings.floors,
    floorsAfter: settings.floorsAfter,
    generatedFog: settings.generatedFog,
    heat: heatsFromMask(Math.trunc(Number(input.heatMask) || 0)),
    deathShardPercent: settings.deathShardPercent,
    runs,
    seed: newTowerSeed(),
  });
}

// ─────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────

export async function getTowerDashboard(guildId: string) {
  const [settings, rewards, players, runs, activeRuns, leaderboard, foes, daily] = await Promise.all([
    getTowerConfig(guildId),
    prisma.rpgTowerReward.findMany({ where: { guildId }, orderBy: [{ kind: 'asc' }, { floor: 'asc' }, { price: 'asc' }] }),
    prisma.rpgTowerProfile.count({ where: { guildId } }),
    prisma.rpgTowerRun.count({ where: { guildId } }),
    prisma.rpgTowerRun.count({ where: { guildId, status: 'ACTIVE' } }),
    getTowerLeaderboard(guildId, 10),
    listTowerFoeChoices(guildId),
    getTowerDailyLeaderboard(guildId),
  ]);
  const [deathMap, insights] = await Promise.all([getTowerDeathMap(guildId, settings.floors), getTowerInsights(guildId, settings.floors)]);
  return {
    settings,
    deathMap,
    rewards,
    foes,
    stats: { players, runs, activeRuns, bestFloor: leaderboard[0]?.bestFloor ?? 0 },
    insights,
    leaderboard,
    daily: { dayKey: towerDayKey(new Date()), leaderboard: daily },
    limits: { rewardsMax: TOWER_REWARDS_PER_GUILD_MAX, mapSize: TOWER_MAP_SIZE, mapRoomsMax: TOWER_MAP_ROOMS_MAX, floorsMax: TOWER_FLOORS_MAX },
  };
}

export async function saveTowerSettings(guildId: string, input: Record<string, unknown>): Promise<TowerConfigView> {
  const normalized = normalizeTowerSettings(input);
  if (!normalized.ok) throw new TowerError(normalized.error, 400);
  const data = {
    ...normalized.value,
    upgrades: normalized.value.upgrades as unknown as Prisma.InputJsonValue,
    merchant: normalized.value.merchant as unknown as Prisma.InputJsonValue,
  };
  await prisma.rpgTowerConfig.upsert({
    where: { guildId },
    update: data,
    create: { guildId, ...data },
  });
  return getTowerConfig(guildId);
}

export async function saveTowerReward(
  client: Client,
  guildId: string,
  input: Record<string, unknown>,
  rewardId?: string,
): Promise<{ reward: RpgTowerReward; created: boolean }> {
  const normalized = normalizeTowerReward(input);
  if (!normalized.ok) throw new TowerError(normalized.error, 400);
  const data = normalized.value;

  await assertGuildTitle(guildId, data.titleId).catch((err: Error) => {
    throw new TowerError(err.message, 400);
  });
  await assertFirstKillRole(client, guildId, data.roleId).catch((err: Error) => {
    throw new TowerError(err.message, 400);
  });
  if (data.itemName && !(await findGuildItem(prisma, guildId, data.itemName))) {
    throw new TowerError(`L'objet « ${data.itemName} » n'existe pas dans le catalogue.`, 400);
  }

  if (!rewardId) {
    const count = await prisma.rpgTowerReward.count({ where: { guildId } });
    if (count >= TOWER_REWARDS_PER_GUILD_MAX) {
      throw new TowerError(`Un serveur ne peut pas avoir plus de ${TOWER_REWARDS_PER_GUILD_MAX} récompenses de Tour.`, 400);
    }
    return { reward: await prisma.rpgTowerReward.create({ data: { guildId, ...data } }), created: true };
  }

  const existing = await prisma.rpgTowerReward.findUnique({ where: { id: rewardId } });
  if (!existing || existing.guildId !== guildId) throw new TowerError('Récompense introuvable.', 404);
  return { reward: await prisma.rpgTowerReward.update({ where: { id: rewardId }, data }), created: false };
}

/**
 * Enregistre les étages dessinés, dans l'ordre de la montée. Un étage invalide fait refuser
 * le tout. Aucun étage : la Tour génère les siens. `layout` seul (une carte) reste accepté.
 * L'étage où se trouve un joueur garde sa carte ; les étages qu'il n'a pas atteints suivent
 * la tour enregistrée.
 */
export async function saveTowerFloors(guildId: string, input: { floors?: unknown; layout?: unknown }): Promise<TowerConfigView> {
  const raw = Array.isArray(input.floors)
    ? input.floors
    : input.layout !== null && input.layout !== undefined ? [input.layout] : [];
  const normalized = normalizeTowerFloors(raw);
  if (!normalized.ok) throw new TowerError(normalized.error, 400);

  const data = {
    // Les étages se jouent toujours : l'ancien interrupteur « carte jouée » n'a plus d'effet.
    layoutEnabled: true,
    layouts: normalized.value as unknown as Prisma.InputJsonValue,
    // L'ancienne carte unique ne sert plus qu'à relire les tours d'avant les étages.
    layout: Prisma.DbNull,
  };
  await prisma.rpgTowerConfig.upsert({ where: { guildId }, update: data, create: { guildId, ...data } });
  return getTowerConfig(guildId);
}

/**
 * Aperçu de l'image que verront les joueurs en arrivant sur un étage, pour l'éditeur du
 * dashboard. La carte envoyée n'a pas besoin d'être enregistrée ; elle doit être valide.
 */
export async function previewTowerFloor(guildId: string, input: { layout?: unknown; floor?: unknown }): Promise<string> {
  const normalized = normalizeTowerLayout(input.layout);
  if (!normalized.ok) throw new TowerError(normalized.error, 400);
  const layout = normalized.value;
  const floor = Math.max(1, Math.trunc(Number(input.floor) || 1));
  const [settings, locale] = await Promise.all([getTowerConfig(guildId), resolveGuildLocale(guildId)]);
  // Départ, ou la première entrée d'un étage à puits ou à entrées au choix.
  const start = startRoom(layout)!;
  const title = (n: number, name: string) => (name ? m.tower_floor_named({ floor: n, name }, { locale }) : m.tower_floor({ floor: n }, { locale }));
  const nameOf = (n: number) => (n === floor ? layout.name : floorLayout(settings.floors, n)?.name ?? '');
  const ladder = [];
  for (let n = floor + 2; n >= Math.max(1, floor - 2); n--) {
    ladder.push({ label: title(n, nameOf(n)), status: n === floor ? 'current' as const : n > floor ? 'next' as const : 'done' as const });
  }
  // Ce que voit le joueur en arrivant : sous le brouillard, seulement l'entrée et ses voisines ;
  // devant des entrées au choix, seulement ces entrées, sans y être encore.
  const choices = entryRooms(layout).filter((room) => room.type === 'ENTRANCE').map((room) => room.id);
  const cleared = choices.length > 0 ? [] : [start.id];
  const visible = !layout.fog ? null : choices.length > 0 ? new Set(choices) : visibleRooms(layout, start.id, cleared);
  const targets = choices.length > 0 ? choices : roomNeighbors(layout, start.id).map(({ room }) => room.id);
  const image = await renderTowerImage({
    kind: 'map',
    title: title(floor, layout.name),
    layout,
    pos: start.id,
    cleared,
    targets,
    ladder,
    visible: visible ? [...visible] : null,
  });
  if (!image) throw new TowerError('Le rendu de l\'aperçu a échoué.', 500);
  return `data:image/png;base64,${image.toString('base64')}`;
}

export async function deleteTowerReward(guildId: string, rewardId: string): Promise<RpgTowerReward> {
  const existing = await prisma.rpgTowerReward.findUnique({ where: { id: rewardId } });
  if (!existing || existing.guildId !== guildId) throw new TowerError('Récompense introuvable.', 404);
  return prisma.rpgTowerReward.delete({ where: { id: rewardId } });
}

/**
 * Ouvre une nouvelle saison : le classement repart de zéro. Les éclats, les améliorations et
 * le record de tous les temps sont conservés, et les parties en cours continuent sans compter
 * pour la nouvelle saison. Avec `resetMilestones`, les paliers se regagnent : les articles
 * uniques déjà achetés, eux, restent acquis.
 */
export async function startTowerSeason(guildId: string, options: { resetMilestones?: boolean } = {}): Promise<number> {
  const now = new Date();
  await prisma.rpgTowerConfig.upsert({
    where: { guildId },
    update: { seasonStartedAt: now },
    create: { guildId, seasonStartedAt: now },
  });
  const reset = await prisma.rpgTowerProfile.updateMany({ where: { guildId }, data: { bestFloor: 0, bestRooms: 0, bestFloorAt: null } });

  if (options.resetMilestones !== false) {
    const milestones = await prisma.rpgTowerReward.findMany({ where: { guildId, kind: 'MILESTONE' }, select: { id: true } });
    const ids = milestones.map((reward) => reward.id);
    if (ids.length > 0) {
      await prisma.$executeRaw`
        UPDATE "rpg_tower_profiles"
        SET "claimedRewardIds" = ARRAY(SELECT id FROM unnest("claimedRewardIds") AS id WHERE NOT (id = ANY(${ids}::text[])))
        WHERE "guildId" = ${guildId} AND "claimedRewardIds" && ${ids}::text[]`;
    }
  }
  return reset.count;
}

/**
 * Remet la Tour à zéro. Toujours : parties en cours et terminées, éclats, améliorations,
 * records et paliers obtenus de tous les joueurs. Avec `everything`, aussi les réglages, les
 * étages dessinés et les récompenses. Ce qui a déjà été versé au profil RPG (pièces, XP,
 * objets, titres, rôles) n'est pas repris.
 */
export async function resetTower(guildId: string, options: { everything?: boolean } = {}) {
  return prisma.$transaction(async (tx) => {
    const runs = await tx.rpgTowerRun.deleteMany({ where: { guildId } });
    const profiles = await tx.rpgTowerProfile.deleteMany({ where: { guildId } });
    let rewards = 0;
    if (options.everything) {
      rewards = (await tx.rpgTowerReward.deleteMany({ where: { guildId } })).count;
      await tx.rpgTowerConfig.deleteMany({ where: { guildId } });
    }
    return { runs: runs.count, profiles: profiles.count, rewards };
  });
}

/** Fiche Tour d'un joueur, pour les administrateurs. Lecture seule : une partie expirée n'est pas soldée ici. */
export async function getTowerPlayerSummary(guildId: string, userId: string) {
  const [settings, profile, run] = await Promise.all([
    getTowerConfig(guildId),
    prisma.rpgTowerProfile.findUnique({ where: { guildId_userId: { guildId, userId } } }),
    prisma.rpgTowerRun.findFirst({ where: { guildId, userId, status: 'ACTIVE' }, orderBy: { startedAt: 'desc' } }),
  ]);
  const state = run ? parseState(run.state) : null;
  return {
    profile: profile
      ? {
        shards: profile.shards,
        lifetimeShards: profile.lifetimeShards,
        bestFloor: profile.bestFloor,
        bestFloorAllTime: profile.bestFloorAllTime,
        totalRuns: profile.totalRuns,
        weekShards: profile.weekShards,
        upgrades: parseTowerUpgrades(profile.upgrades, settings.upgrades),
        claimedRewardIds: profile.claimedRewardIds,
      }
      : null,
    activeRun: run && state
      ? {
        floor: run.floor,
        phase: state.phase,
        hp: state.hp,
        gold: state.gold,
        potions: state.potions,
        shardsAtStake: state.shards,
        floorsCleared: state.floorsCleared,
        lastActionAt: run.lastActionAt,
      }
      : null,
  };
}

/** Ajoute ou retire des éclats à un joueur. Le solde ne descend jamais sous zéro. */
export async function adjustTowerShards(guildId: string, userId: string, delta: number): Promise<number> {
  if (!Number.isInteger(delta) || delta === 0) throw new TowerError('Le montant doit être un entier non nul.', 400);
  const profile = await getOrCreateTowerProfile(guildId, userId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "rpg_tower_profiles" WHERE "id" = ${profile.id} FOR UPDATE`;
    const fresh = await tx.rpgTowerProfile.findUniqueOrThrow({ where: { id: profile.id } });
    const shards = Math.max(0, fresh.shards + delta);
    await tx.rpgTowerProfile.update({ where: { id: profile.id }, data: { shards } });
    return shards;
  });
}
