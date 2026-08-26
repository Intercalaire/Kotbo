/**
 * Raid hebdomadaire : cycle de vie, assauts et récompenses.
 *
 * Chaque équipe affronte **sa propre instance** du boss, dont la réserve de points de vie
 * suit son effectif. Une réserve unique partagée par tout le serveur laisserait les petites
 * équipes sans rien à frapper, et ferait du raid une course au clic plutôt qu'une épreuve
 * comparable d'une équipe à l'autre.
 *
 * Les instances sont créées au premier assaut d'une équipe et non à l'ouverture : compter
 * l'effectif de chaque clan coûte un `members.fetch()` du serveur, qu'il serait absurde de
 * payer pour des équipes qui ne viendront jamais.
 */

import type { Client, GuildMember } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { checkLevelUp, getOrCreateEconomyConfig, getOrCreateRpgProfile } from '../economyService.js';
import { loadEffectiveStats } from '../combatService.js';
import { getAvailableSkills } from './rpgClasses.js';
import { resolveGuildTimezone } from '../../../utils/timezone.js';
import { buildSeedBoss, RAID_BOSSES } from './rpgRaidContent.js';
import {
  asRaidTeamMode,
  clampInt,
  computeTeamHealth,
  normalizeRaidBossInput,
  parseRaidSpells,
  planNextRaidWindow,
  splitRaidRewards,
  RAID_ASSAULTS_RANGE,
  RAID_CLAN_POINTS_RANGE,
  RAID_DURATION_RANGE,
  RAID_ENERGY_RANGE,
  RAID_HEALTH_BOUND_RANGE,
  RAID_HEALTH_PER_MEMBER_RANGE,
  RAID_HOUR_RANGE,
  RAID_REWARD_RANGE,
  RAID_WEEKDAY_RANGE,
  type RaidBossInput,
  type RaidTeamMode,
} from './rpgRaidPolicy.js';
import { runRaidAssault, type RaidAssaultResult } from './rpgRaidCombat.js';

type EconomyConfig = Awaited<ReturnType<typeof getOrCreateEconomyConfig>>;

export class RaidError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
    this.name = 'RaidError';
  }
}

/** Part de l'enveloppe versée à une équipe qui n'a pas abattu son boss. */
export const RAID_CONSOLATION_SHARE = 0.25;

// ── Catalogue de boss du serveur ──────────────────────────────────────────

/**
 * Dépose les boss livrés de base qui manquent encore au serveur.
 *
 * Seuls les noms absents sont ajoutés, comme le fait le seed du bestiaire : un serveur qui
 * a supprimé ou réécrit un boss ne doit pas le voir revenir à chaque redémarrage, mais un
 * boss ajouté au catalogue plus tard doit lui parvenir.
 */
export async function seedGuildRaidBosses(guildId: string): Promise<number> {
  const existing = await prisma.rpgRaidBoss.findMany({ where: { guildId }, select: { name: true } });
  const known = new Set(existing.map((boss) => boss.name));
  const missing = RAID_BOSSES.filter((boss) => !known.has(boss.name));
  if (missing.length === 0) return 0;

  await prisma.rpgRaidBoss.createMany({
    data: missing.map((seed) => {
      const boss = buildSeedBoss(seed);
      return {
        guildId,
        name: boss.name,
        description: boss.description,
        emoji: boss.emoji,
        level: boss.level,
        attack: boss.attack,
        defense: boss.defense,
        speed: boss.speed,
        spells: boss.spells,
      };
    }),
    skipDuplicates: true,
  });

  return missing.length;
}

export async function listGuildRaidBosses(guildId: string) {
  const bosses = await prisma.rpgRaidBoss.findMany({
    where: { guildId },
    orderBy: [{ level: 'asc' }, { name: 'asc' }],
  });
  return bosses.map((boss) => ({ ...boss, spells: parseRaidSpells(boss.spells) }));
}

export async function saveGuildRaidBoss(guildId: string, input: RaidBossInput, bossId?: string) {
  const normalized = normalizeRaidBossInput(input);
  if (!normalized.ok) throw new RaidError(normalized.error, 400);
  const data = normalized.value;

  const twin = await prisma.rpgRaidBoss.findFirst({
    where: { guildId, name: data.name, ...(bossId ? { NOT: { id: bossId } } : {}) },
    select: { id: true },
  });
  if (twin) throw new RaidError(`Un boss de raid se nomme déjà « ${data.name} ».`, 409);

  const payload = {
    name: data.name,
    description: data.description,
    emoji: data.emoji,
    level: data.level,
    attack: data.attack,
    defense: data.defense,
    speed: data.speed,
    spells: data.spells,
    enabled: data.enabled,
  };

  if (!bossId) {
    return { boss: await prisma.rpgRaidBoss.create({ data: { guildId, ...payload } }), created: true };
  }

  const existing = await prisma.rpgRaidBoss.findUnique({ where: { id: bossId }, select: { guildId: true } });
  if (!existing) throw new RaidError('Boss de raid introuvable.', 404);
  if (existing.guildId !== guildId) throw new RaidError('Ce boss appartient à un autre serveur.', 403);

  return { boss: await prisma.rpgRaidBoss.update({ where: { id: bossId }, data: payload }), created: false };
}

export async function deleteGuildRaidBoss(guildId: string, bossId: string) {
  const existing = await prisma.rpgRaidBoss.findUnique({ where: { id: bossId }, select: { guildId: true, name: true } });
  if (!existing) throw new RaidError('Boss de raid introuvable.', 404);
  if (existing.guildId !== guildId) throw new RaidError('Ce boss appartient à un autre serveur.', 403);

  // Les raids passés gardent leur instantané : la relation est mise à null, pas en cascade,
  // pour qu'un palmarès ne disparaisse pas avec la fiche qui l'a produit.
  await prisma.rpgRaidBoss.delete({ where: { id: bossId } });
  return { name: existing.name };
}

// ── Planification ─────────────────────────────────────────────────────────

export async function getOpenRaid(guildId: string) {
  return prisma.rpgRaid.findFirst({
    where: { guildId, status: 'OPEN' },
    orderBy: { opensAt: 'desc' },
  });
}

export async function getScheduledRaid(guildId: string) {
  return prisma.rpgRaid.findFirst({
    where: { guildId, status: 'SCHEDULED' },
    orderBy: { opensAt: 'asc' },
  });
}

/** État du raid tel que le panneau `/rpg` et le dashboard doivent l'afficher. */
export async function getRaidState(guildId: string) {
  const [config, open, scheduled] = await Promise.all([
    getOrCreateEconomyConfig(guildId),
    getOpenRaid(guildId),
    getScheduledRaid(guildId),
  ]);

  return {
    enabled: config.enabled && config.raidEnabled,
    teamMode: asRaidTeamMode(config.raidTeamMode),
    open,
    nextOpensAt: scheduled?.opensAt ?? null,
  };
}

/**
 * Choisit le boss du prochain raid.
 *
 * Un nom fixé qui ne correspond plus à rien - fiche renommée ou supprimée - ne doit pas
 * empêcher le raid d'ouvrir : on retombe alors sur le tirage au sort, faute de quoi le
 * serveur perdrait ses raids sans le moindre signal.
 */
async function pickRaidBoss(guildId: string, config: EconomyConfig) {
  const bosses = await prisma.rpgRaidBoss.findMany({ where: { guildId, enabled: true } });
  if (bosses.length === 0) return null;

  if (config.raidBossName) {
    const chosen = bosses.find((boss) => boss.name === config.raidBossName);
    if (chosen) return chosen;
  }

  return bosses[Math.floor(Math.random() * bosses.length)];
}

/** Planifie le prochain raid si aucun n'est ni ouvert ni en attente. */
export async function ensureRaidSchedule(guildId: string, config: EconomyConfig): Promise<void> {
  const [open, scheduled] = await Promise.all([getOpenRaid(guildId), getScheduledRaid(guildId)]);
  if (open || scheduled) return;

  await seedGuildRaidBosses(guildId);
  const boss = await pickRaidBoss(guildId, config);
  if (!boss) {
    logger.warn('RpgRaid', `Aucun boss de raid actif pour ${guildId} : planification impossible.`);
    return;
  }

  const timezone = await resolveGuildTimezone(guildId);
  const window = planNextRaidWindow(new Date(), {
    weekday: clampInt(config.raidWeekday, RAID_WEEKDAY_RANGE, 6),
    hour: clampInt(config.raidHour, RAID_HOUR_RANGE, 20),
    durationHours: clampInt(config.raidDurationHours, RAID_DURATION_RANGE, 24),
  }, timezone);

  await prisma.rpgRaid.create({
    data: {
      guildId,
      bossId: boss.id,
      status: 'SCHEDULED',
      teamMode: asRaidTeamMode(config.raidTeamMode),
      // Les caractéristiques sont recopiées dès la planification : modifier la fiche ou
      // appliquer un palier de difficulté en pleine fenêtre changerait l'épreuve en cours
      // de route, et les équipes qui ont frappé en premier n'auraient pas couru la même.
      bossName: boss.name,
      bossEmoji: boss.emoji,
      bossLevel: boss.level,
      bossAttack: boss.attack,
      bossDefense: boss.defense,
      bossSpeed: boss.speed,
      bossSpells: parseRaidSpells(boss.spells),
      healthPerMember: clampInt(config.raidHealthPerMember, RAID_HEALTH_PER_MEMBER_RANGE, 1200),
      healthFloor: clampInt(config.raidHealthFloor, RAID_HEALTH_BOUND_RANGE, 2500),
      healthCap: clampInt(config.raidHealthCap, RAID_HEALTH_BOUND_RANGE, 60_000),
      assaultsPerMember: clampInt(config.raidAssaultsPerMember, RAID_ASSAULTS_RANGE, 3),
      energyCost: clampInt(config.raidEnergyCost, RAID_ENERGY_RANGE, 25),
      xpReward: clampInt(config.raidXpReward, RAID_REWARD_RANGE, 600),
      coinReward: clampInt(config.raidCoinReward, RAID_REWARD_RANGE, 450),
      clanPoints: clampInt(config.raidClanPoints, RAID_CLAN_POINTS_RANGE, 60),
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      announceChannelId: config.raidChannelId,
    },
  });
}

// ── Équipes ───────────────────────────────────────────────────────────────

export interface RaidTeamIdentity {
  key: string;
  name: string;
  /**
   * Effectif de l'équipe, compté seulement au moment d'engager l'instance.
   *
   * Le compte est paresseux parce qu'il coûte cher : en mode clan, il faut peupler le cache
   * des membres du serveur entier, et le payer à chaque clic sur le bouton d'assaut serait
   * absurde alors que la réserve est figée dès le premier.
   */
  countMembers: () => Promise<number>;
}

/**
 * Équipe d'un membre pour le mode en vigueur, ou `null` s'il n'en a pas.
 *
 * En mode clan, l'appartenance se lit sur les rôles Discord, comme partout ailleurs dans le
 * module Clans. En mode guilde RPG, elle se lit sur le profil de jeu.
 */
export async function resolveRaidTeam(
  guildId: string,
  userId: string,
  mode: RaidTeamMode,
  member: GuildMember | null,
): Promise<RaidTeamIdentity | null> {
  if (mode === 'CLAN') {
    if (!member) return null;
    const clans = await prisma.clan.findMany({ where: { guildId }, select: { id: true, name: true, roleId: true } });
    const clan = clans.find((entry) => member.roles.cache.has(entry.roleId));
    if (!clan) return null;

    return {
      key: clan.id,
      name: clan.name,
      countMembers: async () => {
        // Sans `members.fetch()`, l'effectif d'un rôle est celui des membres déjà vus, et
        // une équipe entière peut compter pour une seule personne.
        await member.guild.members.fetch().catch(() => null);
        return Math.max(1, member.guild.roles.cache.get(clan.roleId)?.members.size ?? 1);
      },
    };
  }

  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { rpgGuild: { select: { id: true, name: true } } },
  });
  if (!profile?.rpgGuild) return null;

  const rpgGuildId = profile.rpgGuild.id;
  return {
    key: rpgGuildId,
    name: profile.rpgGuild.name,
    countMembers: async () => Math.max(1, await prisma.rpgProfile.count({ where: { guildId, rpgGuildId } })),
  };
}

async function getOrCreateTeam(raid: { id: string; healthPerMember: number; healthFloor: number; healthCap: number }, identity: RaidTeamIdentity) {
  const existing = await prisma.rpgRaidTeam.findUnique({
    where: { raidId_teamKey: { raidId: raid.id, teamKey: identity.key } },
  });
  if (existing) return existing;

  const memberCount = await identity.countMembers();
  const totalHealth = computeTeamHealth(memberCount, {
    healthPerMember: raid.healthPerMember,
    healthFloor: raid.healthFloor,
    healthCap: raid.healthCap,
  });

  // Deux membres qui frappent en même temps peuvent tenter la création ensemble : l'unicité
  // tranche, et le perdant relit la ligne du gagnant.
  try {
    return await prisma.rpgRaidTeam.create({
      data: {
        raidId: raid.id,
        teamKey: identity.key,
        teamName: identity.name,
        memberCount,
        totalHealth,
        remainingHealth: totalHealth,
      },
    });
  } catch {
    const team = await prisma.rpgRaidTeam.findUnique({
      where: { raidId_teamKey: { raidId: raid.id, teamKey: identity.key } },
    });
    if (!team) throw new RaidError("L'équipe n'a pas pu rejoindre le raid.", 500);
    return team;
  }
}

// ── Assaut ────────────────────────────────────────────────────────────────

export interface RaidAttackOutcome {
  raid: Awaited<ReturnType<typeof getOpenRaid>>;
  team: { name: string; remainingHealth: number; totalHealth: number; memberCount: number };
  result: RaidAssaultResult;
  killingBlow: boolean;
  assaultsLeft: number;
  rewards: { xp: number; coins: number; clanPoints: number } | null;
}

/**
 * Livre un assaut contre l'instance de l'équipe du membre.
 *
 * L'énergie est débitée avant le combat et rendue si celui-ci échoue : sans ce rattrapage,
 * une panne au milieu du calcul volerait l'assaut au joueur.
 */
export async function attackRaid(client: Client, guildId: string, userId: string, member: GuildMember | null): Promise<RaidAttackOutcome> {
  const config = await getOrCreateEconomyConfig(guildId);
  if (!config.enabled || !config.raidEnabled) throw new RaidError("Le raid n'est pas activé sur ce serveur.", 403);

  const raid = await getOpenRaid(guildId);
  if (!raid) throw new RaidError("Aucun raid n'est en cours.", 404);

  const mode = asRaidTeamMode(raid.teamMode);
  const identity = await resolveRaidTeam(guildId, userId, mode, member);
  if (!identity) {
    throw new RaidError(
      mode === 'CLAN'
        ? "Vous n'appartenez à aucun clan : le raid se livre en équipe."
        : "Vous n'appartenez à aucune guilde RPG : le raid se livre en équipe.",
      403,
    );
  }

  const team = await getOrCreateTeam(raid, identity);
  if (team.remainingHealth <= 0) throw new RaidError('Votre équipe a déjà abattu son boss.', 409);

  // Deux clics à la même milliseconde peuvent passer ce contrôle ensemble. Le coût en
  // énergie, lui, est atomique et reste le vrai frein : fermer complètement la fenêtre
  // demanderait de défaire un assaut déjà porté sur la réserve, pour un abus qui coûte
  // plus cher à celui qui le tente qu'au raid.
  const alreadyDone = await prisma.rpgRaidAssault.count({ where: { raidTeamId: team.id, userId } });
  if (alreadyDone >= raid.assaultsPerMember) {
    throw new RaidError(`Vous avez déjà livré vos ${raid.assaultsPerMember} assauts de la semaine.`, 429);
  }

  const spent = await prisma.rpgProfile.updateMany({
    where: { guildId, userId, energy: { gte: raid.energyCost } },
    data: { energy: { decrement: raid.energyCost } },
  });
  if (spent.count === 0) throw new RaidError(`Il vous faut ${raid.energyCost} points d'énergie pour un assaut.`, 409);

  // Une fois l'assaut inscrit, l'énergie est bel et bien dépensée : un incident sur les
  // récompenses ne doit pas la rendre en plus du combat déjà livré.
  let committed = false;
  try {
    const profile = await getOrCreateRpgProfile(guildId, userId);
    const stats = await loadEffectiveStats(profile);

    const result = runRaidAssault({
      stats,
      playerHealth: Math.max(1, profile.health),
      playerSkills: getAvailableSkills(profile.className, profile.level),
      boss: {
        attack: raid.bossAttack,
        defense: raid.bossDefense,
        speed: raid.bossSpeed,
        spells: parseRaidSpells(raid.bossSpells),
      },
      remainingHealth: team.remainingHealth,
      totalHealth: team.totalHealth,
    });

    // La réserve est décrémentée en base et non écrasée avec la valeur calculée : deux
    // assauts simultanés doivent se cumuler, pas s'écraser l'un l'autre.
    const damage = Math.min(result.damageDealt, team.remainingHealth);
    const after = await prisma.rpgRaidTeam.update({
      where: { id: team.id },
      data: { remainingHealth: { decrement: damage } },
    });
    if (after.remainingHealth < 0) {
      await prisma.rpgRaidTeam.update({ where: { id: team.id }, data: { remainingHealth: 0 } });
    }

    // Un seul assaut peut porter le coup de grâce, même si deux arrivent ensemble.
    let killingBlow = false;
    if (after.remainingHealth <= 0) {
      const claimed = await prisma.rpgRaidTeam.updateMany({
        where: { id: team.id, defeatedAt: null },
        data: { defeatedAt: new Date() },
      });
      killingBlow = claimed.count === 1;
    }

    await prisma.rpgRaidAssault.create({
      data: {
        raidTeamId: team.id,
        guildId,
        userId,
        damage,
        killingBlow,
        survived: result.survived,
      },
    });
    committed = true;

    // Le joueur ressort du raid dans l'état où il en sort : les points de vie perdus se
    // reportent sur le profil, comme après un combat de boss.
    const remainingHp = Math.max(1, Math.min(profile.maxHealth, profile.health - result.damageTaken));
    await prisma.rpgProfile.update({
      where: { guildId_userId: { guildId, userId } },
      data: { health: remainingHp },
    });

    const rewards = after.remainingHealth <= 0
      ? await rewardTeam(client, raid, team.id, { victory: true })
      : null;

    return {
      raid,
      team: {
        name: team.teamName,
        remainingHealth: Math.max(0, after.remainingHealth),
        totalHealth: team.totalHealth,
        memberCount: team.memberCount,
      },
      result,
      killingBlow,
      assaultsLeft: Math.max(0, raid.assaultsPerMember - alreadyDone - 1),
      rewards: rewards?.get(userId) ?? null,
    };
  } catch (error) {
    if (!committed) {
      await prisma.rpgProfile.update({
        where: { guildId_userId: { guildId, userId } },
        data: { energy: { increment: raid.energyCost } },
      }).catch(() => null);
    }
    throw error;
  }
}

// ── Récompenses ───────────────────────────────────────────────────────────

type RewardMap = Map<string, { xp: number; coins: number; clanPoints: number }>;

/**
 * Verse les récompenses d'une équipe, une seule fois.
 *
 * Une équipe qui n'a pas abattu son boss touche une consolation proportionnelle aux dégâts
 * portés : trois heures d'assauts pour rien ne ramènent personne la semaine suivante, mais
 * l'échec ne doit pas payer autant que la victoire.
 */
async function rewardTeam(
  client: Client,
  raid: { id: string; guildId: string; teamMode: string; xpReward: number; coinReward: number; clanPoints: number },
  teamId: string,
  options: { victory: boolean },
): Promise<RewardMap> {
  const rewards: RewardMap = new Map();

  // Le marquage précède le versement : au pire une équipe n'est pas payée, jamais payée
  // deux fois par deux assauts simultanés ou par une reprise du cycle.
  const claimed = await prisma.rpgRaidTeam.updateMany({
    where: { id: teamId, rewardedAt: null },
    data: { rewardedAt: new Date() },
  });
  if (claimed.count === 0) return rewards;

  const assaults = await prisma.rpgRaidAssault.findMany({
    where: { raidTeamId: teamId },
    select: { userId: true, damage: true },
  });
  if (assaults.length === 0) return rewards;

  const ratio = options.victory ? 1 : RAID_CONSOLATION_SHARE;
  const xpShares = splitRaidRewards(assaults, Math.round(raid.xpReward * ratio));
  const coinShares = splitRaidRewards(assaults, Math.round(raid.coinReward * ratio));
  const pointShares = splitRaidRewards(assaults, Math.round(raid.clanPoints * ratio));

  for (const [userId, xp] of xpShares) {
    const coins = coinShares.get(userId) ?? 0;
    rewards.set(userId, { xp, coins, clanPoints: pointShares.get(userId) ?? 0 });

    try {
      await prisma.rpgProfile.update({
        where: { guildId_userId: { guildId: raid.guildId, userId } },
        data: { xp: { increment: xp }, balance: { increment: coins } },
      });
      await checkLevelUp(raid.guildId, userId);
    } catch (error) {
      logger.error('RpgRaid', `Récompense non versée à ${userId} sur ${raid.guildId}:`, error);
    }
  }

  // Les points de clan ne concernent que le mode clan, et passent par le point d'entrée
  // commun : c'est lui qui porte le remboursement de dette, la saison en cours, le plafond
  // et la gestion des comptes liés.
  if (raid.teamMode === 'CLAN') {
    const awards = [...pointShares.entries()].map(([userId, amount]) => ({ userId, amount }));
    if (awards.some((award) => award.amount > 0)) {
      const { awardClanPointsToMembers } = await import('../../community/clanService.js');
      await awardClanPointsToMembers({
        guildId: raid.guildId,
        client,
        source: 'RPG_RAID',
        awards,
        reason: 'Raid hebdomadaire',
      }).catch((error: unknown) => {
        logger.error('RpgRaid', `Points de clan non versés sur ${raid.guildId}:`, error);
      });
    }
  }

  return rewards;
}

// ── Cycle ─────────────────────────────────────────────────────────────────

/**
 * Fait avancer les raids de tous les serveurs : planification, ouverture, clôture.
 *
 * L'annonce et le rafraîchissement du message sont délégués au panneau, qui sait construire
 * l'embed ; ce module ne décide que des transitions.
 */
export async function runRaidCycle(client: Client): Promise<void> {
  const configs = await prisma.economyConfig.findMany({ where: { enabled: true, raidEnabled: true } });

  for (const config of configs) {
    try {
      await openDueRaid(config.guildId);
      await closeDueRaid(client, config.guildId, config);
      await announceOrRefresh(client, config);
      await ensureRaidSchedule(config.guildId, config);
    } catch (error) {
      logger.error('RpgRaid', `Cycle en échec pour ${config.guildId}:`, error);
    }
  }
}

/**
 * Annonce le raid qui vient d'ouvrir, ou rafraîchit celui qui court.
 *
 * L'affichage est importé à la demande : il tire discord.js, dont la planification et les
 * assauts n'ont pas besoin, et un import statique croisé entre le service et son panneau
 * ferait un cycle.
 */
async function announceOrRefresh(client: Client, config: EconomyConfig): Promise<void> {
  const raid = await getOpenRaid(config.guildId);
  if (!raid) return;

  const panel = await import('./rpgRaidPanel.js');
  if (!raid.announcedAt) {
    await panel.announceOpenRaid(client, raid, config.raidAnnounce, config.raidRoleId);
    return;
  }

  await panel.refreshRaidMessage(client, raid, await listRaidTeams(raid.id));
}

async function openDueRaid(guildId: string): Promise<void> {
  const scheduled = await getScheduledRaid(guildId);
  if (!scheduled || scheduled.opensAt.getTime() > Date.now()) return;

  // Une fenêtre entièrement passée pendant que le bot était éteint n'a plus lieu d'ouvrir :
  // elle est close sur-le-champ, sans équipe ni récompense, et la suivante est planifiée.
  if (scheduled.closesAt.getTime() <= Date.now()) {
    await prisma.rpgRaid.update({
      where: { id: scheduled.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    return;
  }

  await prisma.rpgRaid.updateMany({
    where: { id: scheduled.id, status: 'SCHEDULED' },
    data: { status: 'OPEN' },
  });
}

async function closeDueRaid(client: Client, guildId: string, config: EconomyConfig): Promise<void> {
  const open = await getOpenRaid(guildId);
  if (!open || open.closesAt.getTime() > Date.now()) return;

  const pending = await prisma.rpgRaidTeam.findMany({
    where: { raidId: open.id, rewardedAt: null },
    select: { id: true, remainingHealth: true },
  });

  for (const team of pending) {
    await rewardTeam(client, open, team.id, { victory: team.remainingHealth <= 0 })
      .catch((error: unknown) => logger.error('RpgRaid', `Clôture d'équipe en échec sur ${guildId}:`, error));
  }

  // La clôture est actée avant le bilan : un salon devenu injoignable ne doit pas laisser
  // un raid ouvert pour l'éternité, à accepter des assauts après l'heure.
  const closed = await prisma.rpgRaid.updateMany({
    where: { id: open.id, status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });
  if (closed.count === 0 || config.raidAnnounce === 'NONE') return;

  const panel = await import('./rpgRaidPanel.js');
  await panel.publishRaidSummary(client, open, await listRaidTeams(open.id));
}

/** Classement des équipes d'un raid, la mieux avancée en premier. */
export async function listRaidTeams(raidId: string) {
  const teams = await prisma.rpgRaidTeam.findMany({
    where: { raidId },
    orderBy: [{ remainingHealth: 'asc' }, { teamName: 'asc' }],
    include: { _count: { select: { assaults: true } } },
  });
  return teams;
}
