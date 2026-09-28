/**
 * La Tour : accès base du mode roguelite.
 *
 * Le profil Tour est distinct du profil RPG. Une partie vit en base et chaque action est
 * écrite sous condition de version : deux clics sur le même bouton ne jouent qu'un tour, et
 * un vieux message ne peut rien rejouer. Rien de ce que la partie contient (stats, objets,
 * or, bénédictions) ne rejoint le profil RPG ; seuls les éclats restent, et ce qu'ils achètent.
 */

import type { Client } from 'discord.js';
import { Prisma, type RpgTowerReward, type RpgTowerRun } from '@prisma/client';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { checkLevelUp, getOrCreateEconomyConfig, getOrCreateRpgProfile } from '../economyService.js';
import { loadAvailableSkills, loadEffectiveStats, seedDefaultMonsters } from '../combatService.js';
import { getRpgClass } from './rpgClasses.js';
import { listGuildMonsters } from './rpgBestiaryService.js';
import { assertGuildTitle, grantTitle } from './rpgTitleService.js';
import { assertFirstKillRole, grantRpgRewardRole } from './rpgFirstKillService.js';
import { addInventoryQuantity, lockRpgProfile } from './rpgInventoryWrites.js';
import { awardRpgTeamPoints } from './rpgTeamRewards.js';
import {
  applyTowerAction,
  createTowerState,
  type TowerAction,
  type TowerActionError,
  TowerActionRefused,
  type TowerFoePool,
  type TowerRules,
  type TowerState,
} from './rpgTowerEngine.js';
import {
  STARTING_POTIONS,
  TOWER_DEFAULTS,
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
  towerUpgradeCost,
  towerWeekStart,
  type TowerCoreStats,
  type TowerEntryMode,
  type TowerOutcome,
  type TowerSettings,
  type TowerSkill,
  type TowerUpgradeDef,
} from './rpgTowerPolicy.js';
import { TOWER_MAP_ROOMS_MAX, TOWER_MAP_SIZE, normalizeTowerLayout, type TowerLayout } from './rpgTowerMap.js';

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
  | { kind: 'upgrade_max' };

/** Refus d'une action de joueur, traduit par le panneau dans la langue du joueur. */
export class TowerRefused extends Error {
  constructor(readonly refusal: TowerRefusal) {
    super(`Tour refusée : ${refusal.kind}`);
    this.name = 'TowerRefused';
  }
}

export type TowerConfigView = TowerSettings & {
  seasonStartedAt: Date;
  layoutEnabled: boolean;
  /** Carte enregistrée, relue et validée ; `null` si elle manque ou ne passe plus la validation. */
  layout: TowerLayout | null;
};

export type TowerSettlement = {
  outcome: TowerOutcome;
  floorsCleared: number;
  kills: number;
  /** Éclats réellement versés. */
  shards: number;
  /** Éclats perdus à la mort. */
  lostToDeath: number;
  /** Éclats retenus par le plafond hebdomadaire. */
  lostToCap: number;
  newBest: boolean;
  milestones: TowerRewardView[];
  /** Vrai quand la partie a été close par inactivité. */
  expired: boolean;
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
  if (!row) return { ...TOWER_DEFAULTS, seasonStartedAt: new Date(0), layoutEnabled: false, layout: null };
  const normalized = normalizeTowerSettings(row as unknown as Record<string, unknown>);
  const settings = normalized.ok ? normalized.value : TOWER_DEFAULTS;
  const layout = row.layout ? normalizeTowerLayout(row.layout) : null;
  return {
    ...settings,
    enabled: row.enabled,
    seasonStartedAt: row.seasonStartedAt,
    layoutEnabled: row.layoutEnabled,
    layout: layout?.ok ? layout.value : null,
  };
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
    merchant: settings.merchant,
  };
}

async function loadFoes(guildId: string): Promise<TowerFoePool> {
  await seedDefaultMonsters();
  // Désactivés compris : une salle peut imposer une créature retirée du bestiaire, comme un
  // donjon réserve ses boss. Le tirage au hasard, lui, ne pioche que dans les actives.
  const monsters = await listGuildMonsters(guildId, { includeDisabled: true });
  const enabled = monsters.filter((monster) => monster.enabled);
  return {
    monsters: enabled.filter((monster) => !monster.isBoss).map(({ name, emoji }) => ({ name, emoji })),
    bosses: enabled.filter((monster) => monster.isBoss).map(({ name, emoji }) => ({ name, emoji })),
    byName: Object.fromEntries(monsters.map(({ name, emoji }) => [name, { name, emoji }])),
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

function isExpired(run: RpgTowerRun, idleTimeoutMinutes: number, now = Date.now()): boolean {
  return now - run.lastActionAt.getTime() > idleTimeoutMinutes * 60 * 1000;
}

export type TowerEntryPreview = {
  mode: TowerEntryMode;
  stats: TowerCoreStats;
  /** Stats effectives du RPG, pour montrer ce que la compression en a fait. */
  main: { attack: number; defense: number; speed: number; maxHealth: number };
  skills: TowerSkill[];
  potions: number;
  gold: number;
  titleName: string | null;
  className: string | null;
};

/**
 * Ce avec quoi le joueur entrerait dans la Tour : ses stats compressées, les compétences de
 * sa classe et de son arbre, et ses potions de départ.
 */
export async function previewTowerEntry(guildId: string, userId: string): Promise<TowerEntryPreview> {
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
  const bonus = towerUpgradeBonus(settings.upgrades, parseTowerUpgrades(towerProfile.upgrades, settings.upgrades));

  const stats = computeTowerEntryStats({
    mode: settings.entryMode,
    inheritCapPercent: settings.inheritCapPercent,
    titleCapPercent: settings.titleCapPercent,
    main: { attack: main.attack, defense: main.defense, speed: main.speed, maxHealth: main.maxHealth },
    title: {
      attack: title?.attackBonus ?? 0,
      defense: title?.defenseBonus ?? 0,
      speed: title?.speedBonus ?? 0,
      maxHealth: title?.healthBonus ?? 0,
      critPercent: title?.critBonus ?? 0,
    },
    classModifiers: rpgClass?.modifiers ?? { attack: 1, defense: 1, speed: 1, maxHealth: 1 },
    classPassive: rpgClass?.passive ?? {},
    upgradeBonus: bonus,
  });

  return {
    mode: settings.entryMode,
    stats,
    main: { attack: main.attack, defense: main.defense, speed: main.speed, maxHealth: main.maxHealth },
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      emoji: skill.emoji,
      cooldownTurns: skill.cooldownTurns,
      effect: skill.effect,
    })),
    potions: STARTING_POTIONS + bonus.potions,
    gold: bonus.gold,
    titleName: title?.name ?? null,
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

export async function startTowerRun(client: Client | null, guildId: string, userId: string): Promise<ActiveTowerRun> {
  if (!(await isTowerOpen(guildId))) throw new TowerRefused({ kind: 'disabled' });

  const { active } = await getActiveTowerRun(client, guildId, userId);
  if (active) throw new TowerRefused({ kind: 'active_run' });

  const [settings, preview, towerProfile] = await Promise.all([
    getTowerConfig(guildId),
    previewTowerEntry(guildId, userId),
    getOrCreateTowerProfile(guildId, userId),
  ]);

  const state = createTowerState({
    base: preview.stats,
    skills: preview.skills,
    potions: preview.potions,
    gold: preview.gold,
    seed: newTowerSeed(),
    rules: rulesOf(settings),
    layout: settings.layoutEnabled ? settings.layout : null,
  });

  return prisma.$transaction(async (tx) => {
    // Le verrou du profil Tour sérialise deux clics « Entrer » : sans lui, les deux passaient
    // le contrôle de partie active et ouvraient chacun une ascension.
    await tx.$queryRaw`SELECT 1 FROM "rpg_tower_profiles" WHERE "id" = ${towerProfile.id} FOR UPDATE`;
    const running = await tx.rpgTowerRun.count({ where: { profileId: towerProfile.id, status: 'ACTIVE' } });
    if (running > 0) throw new TowerRefused({ kind: 'active_run' });

    const run = await tx.rpgTowerRun.create({
      data: {
        profileId: towerProfile.id,
        guildId,
        userId,
        state: state as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.rpgTowerProfile.update({ where: { id: towerProfile.id }, data: { totalRuns: { increment: 1 } } });
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

  let step: ReturnType<typeof applyTowerAction>;
  try {
    step = applyTowerAction(state, run.floor, action, rulesOf(settings), foes);
  } catch (err) {
    if (err instanceof TowerActionRefused) throw new TowerRefused({ kind: 'action', reason: err.reason });
    throw err;
  }

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
  const kept = settleShards(state.shards, outcome, settings.deathShardPercent);
  const now = new Date();
  const weekStart = towerWeekStart(now);

  const result = await prisma.$transaction(async (tx) => {
    const closed = await tx.rpgTowerRun.updateMany({
      where: { id: run.id, status: 'ACTIVE' },
      data: { status: outcome, endedAt: now, shardsEarned: kept },
    });
    if (closed.count === 0) return null;

    await tx.$queryRaw`SELECT 1 FROM "rpg_tower_profiles" WHERE "id" = ${run.profileId} FOR UPDATE`;
    const profile = await tx.rpgTowerProfile.findUniqueOrThrow({ where: { id: run.profileId } });
    const sameWeek = profile.weekStart !== null && profile.weekStart.getTime() === weekStart.getTime();
    const weekSoFar = sameWeek ? profile.weekShards : 0;
    const granted = applyWeeklyCap(kept, weekSoFar, settings.weeklyShardCap);
    const inSeason = run.startedAt.getTime() >= settings.seasonStartedAt.getTime();
    const newBest = inSeason && state.floorsCleared > profile.bestFloor;

    const milestones = await tx.rpgTowerReward.findMany({
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
        ...(newBest ? { bestFloor: state.floorsCleared, bestFloorAt: now } : {}),
        ...(state.floorsCleared > profile.bestFloorAllTime ? { bestFloorAllTime: state.floorsCleared } : {}),
        ...(milestones.length > 0 ? { claimedRewardIds: { push: milestones.map((reward) => reward.id) } } : {}),
      },
    });

    return { granted, newBest, milestones };
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
      lostToCap: 0,
      newBest: false,
      milestones: [],
      expired,
    };
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
    lostToDeath: state.shards - kept,
    lostToCap: kept - result.granted,
    newBest: result.newBest,
    milestones: await withTitleNames(result.milestones),
    expired,
  };
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
      await settleRun(client, run, state, state.phase === 'COMBAT' ? 'DEAD' : 'LEFT', settings, true);
      closed += 1;
    } catch (err) {
      logger.error('RpgTower', `Partie ${run.id} expirée non soldée :`, err);
    }
  }
  if (closed > 0) logger.info('RpgTower', `${closed} ascension(s) inactive(s) soldée(s).`);
  return closed;
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
    orderBy: [{ bestFloor: 'desc' }, { bestFloorAt: 'asc' }],
    take: limit,
    select: { userId: true, bestFloor: true, bestFloorAt: true, totalRuns: true },
  });
}

// ─────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────

export async function getTowerDashboard(guildId: string) {
  const [settings, rewards, players, runs, activeRuns, leaderboard, foes] = await Promise.all([
    getTowerConfig(guildId),
    prisma.rpgTowerReward.findMany({ where: { guildId }, orderBy: [{ kind: 'asc' }, { floor: 'asc' }, { price: 'asc' }] }),
    prisma.rpgTowerProfile.count({ where: { guildId } }),
    prisma.rpgTowerRun.count({ where: { guildId } }),
    prisma.rpgTowerRun.count({ where: { guildId, status: 'ACTIVE' } }),
    getTowerLeaderboard(guildId, 10),
    listTowerFoeChoices(guildId),
  ]);
  return {
    settings,
    rewards,
    foes,
    stats: { players, runs, activeRuns, bestFloor: leaderboard[0]?.bestFloor ?? 0 },
    leaderboard,
    limits: { rewardsMax: TOWER_REWARDS_PER_GUILD_MAX, mapSize: TOWER_MAP_SIZE, mapRoomsMax: TOWER_MAP_ROOMS_MAX },
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
 * Enregistre la carte. Une carte invalide est refusée ; l'activer sans carte aussi. Les
 * parties en cours gardent la carte copiée à leur entrée.
 */
export async function saveTowerLayout(guildId: string, input: { layoutEnabled?: unknown; layout?: unknown }): Promise<TowerConfigView> {
  const enabled = input.layoutEnabled === true;
  let layout: TowerLayout | null = null;
  if (input.layout !== null && input.layout !== undefined) {
    const normalized = normalizeTowerLayout(input.layout);
    if (!normalized.ok) throw new TowerError(normalized.error, 400);
    layout = normalized.value;
  }
  if (enabled && !layout) throw new TowerError('Impossible d\'activer la carte sans carte valide.', 400);

  const data = {
    layoutEnabled: enabled,
    layout: layout ? (layout as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };
  await prisma.rpgTowerConfig.upsert({ where: { guildId }, update: data, create: { guildId, ...data } });
  return getTowerConfig(guildId);
}

export async function deleteTowerReward(guildId: string, rewardId: string): Promise<RpgTowerReward> {
  const existing = await prisma.rpgTowerReward.findUnique({ where: { id: rewardId } });
  if (!existing || existing.guildId !== guildId) throw new TowerError('Récompense introuvable.', 404);
  return prisma.rpgTowerReward.delete({ where: { id: rewardId } });
}

/**
 * Ouvre une nouvelle saison : le classement repart de zéro. Les éclats, les améliorations et
 * le record de tous les temps sont conservés, et les parties en cours continuent.
 */
export async function startTowerSeason(guildId: string): Promise<number> {
  await prisma.rpgTowerConfig.upsert({
    where: { guildId },
    update: { seasonStartedAt: new Date() },
    create: { guildId, seasonStartedAt: new Date() },
  });
  const reset = await prisma.rpgTowerProfile.updateMany({ where: { guildId }, data: { bestFloor: 0, bestFloorAt: null } });
  return reset.count;
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
