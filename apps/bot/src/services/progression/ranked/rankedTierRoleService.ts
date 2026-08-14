/**
 * Rôles de palier : création automatique, attribution en masse, et remise à
 * niveau des paliers après un changement d'échelle.
 *
 * Associer vingt rôles un par un dans le dashboard était le vrai coût d'entrée
 * du module : les rôles n'existent pas encore, il faut les créer à la main dans
 * Discord, puis les rattacher un par un. Le bot sait faire les deux, et
 * l'attribution rétroactive - que le module ne faisait qu'au prochain gain de
 * RP, donc jamais pour un membre inactif - devient une action explicite.
 */

import { Client, PermissionFlagsBits, type Guild as DiscordGuild } from 'discord.js';
import { rankedTierIndex, type RankedLadder } from '@kotbo/shared';
import prisma, { prismaRead } from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { getGuildLadder, getRankedConfigSafe, getTierRoles, setTierRole } from './rankedConfigService.js';

const LOG_TAG = 'RankedTierRoles';

/** Plafond Discord : 250 rôles par serveur, bots et intégrations compris. */
const DISCORD_ROLE_LIMIT = 250;

/** Rythme de l'attribution en masse, calé sur celui du rangement de niveaux. */
const SYNC_PAUSE_MS = 1_100;

/** Au-delà, une passe oubliée n'a plus de rapport avec l'état de la guilde. */
const SYNC_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Création des rôles
// ---------------------------------------------------------------------------

export type TierRoleProvisionResult = {
  created: number;
  /** Paliers déjà associés à un rôle vivant : rien à faire. */
  kept: number;
  failed: number;
  error?: string;
};

/**
 * Crée les rôles manquants de l'échelle et les associe à leur palier.
 *
 * Un palier déjà associé à un rôle qui existe encore n'est pas touché : la
 * fonction est rejouable après un ajout de paliers sans dupliquer l'existant.
 * Les rôles sont créés du bas vers le haut, ce qui les laisse empilés dans
 * l'ordre de l'échelle dans la liste Discord.
 */
export async function provisionTierRoles(
  guildId: string,
  client: Client,
  options: { reason?: string } = {},
): Promise<TierRoleProvisionResult> {
  const discordGuild = client.guilds.cache.get(guildId)
    || await client.guilds.fetch(guildId).catch(() => null);
  if (!discordGuild) return { created: 0, kept: 0, failed: 0, error: 'guild_unavailable' };

  const me = discordGuild.members.me ?? await discordGuild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { created: 0, kept: 0, failed: 0, error: 'missing_manage_roles' };
  }

  const ladder = await getGuildLadder(guildId);
  const mappings = await getTierRoles(guildId);
  const roleOf = new Map(mappings.map((mapping) => [mapping.tierKey, mapping.roleId]));

  const missing = ladder.filter((tier) => {
    const roleId = roleOf.get(tier.key);
    return !roleId || !discordGuild.roles.cache.has(roleId);
  });
  const kept = ladder.length - missing.length;

  if (missing.length === 0) return { created: 0, kept, failed: 0 };

  // Le plafond est atteint pendant la création, pas après : refuser d'emblée
  // évite de laisser la guilde avec la moitié de son échelle en place.
  if (discordGuild.roles.cache.size + missing.length > DISCORD_ROLE_LIMIT) {
    return { created: 0, kept, failed: missing.length, error: 'role_limit' };
  }

  let created = 0;
  let failed = 0;

  for (const tier of missing) {
    const role = await discordGuild.roles.create({
      name: tier.name,
      color: tier.color as `#${string}`,
      // Aucune permission et pas de mention : un rôle de palier est un badge,
      // pas un droit. Le laisser mentionnable ouvrirait un ping de masse.
      permissions: [],
      mentionable: false,
      hoist: false,
      reason: options.reason ?? 'Rôles de palier du classement de prestige',
    }).catch((err) => {
      logger.warn(LOG_TAG, `Création du rôle « ${tier.name} » impossible sur ${guildId}:`, err);
      return null;
    });

    if (!role) {
      failed++;
      continue;
    }

    await setTierRole(guildId, tier.key, role.id);
    created++;
  }

  logger.info(LOG_TAG, `Rôles de palier sur ${guildId} : ${created} créés, ${kept} conservés, ${failed} en échec.`);
  return { created, kept, failed };
}

// ---------------------------------------------------------------------------
// Paliers des membres après un changement d'échelle
// ---------------------------------------------------------------------------

/**
 * Réaligne la colonne `tierKey` sur la nouvelle échelle.
 *
 * Le RP ne bouge pas : seul le palier qu'il occupe change. Sans ce passage, un
 * membre inactif garderait une clé de palier absente de l'échelle, et son profil
 * afficherait un palier qui n'existe plus.
 */
export async function resyncRankedTiers(guildId: string, ladder: RankedLadder): Promise<number> {
  let changed = 0;

  for (let index = 0; index < ladder.length; index++) {
    const tier = ladder[index];
    const next = ladder[index + 1];
    const result = await prisma.rankedMember.updateMany({
      where: {
        guildId,
        // Le premier palier ramasse aussi un RP négatif, qu'aucun chemin ne
        // produit aujourd'hui mais qu'un ajustement manuel pourrait poser.
        rp: {
          ...(index === 0 ? {} : { gte: tier.minRp }),
          ...(next ? { lt: next.minRp } : {}),
        },
        tierKey: { not: tier.key },
      },
      data: { tierKey: tier.key },
    });
    changed += result.count;
  }

  return changed;
}

export type LadderImpact = {
  total: number;
  /** Membres qui changeraient de palier avec l'échelle proposée. */
  changed: number;
  /** Nombre de membres par palier, dans l'ordre de l'échelle. */
  distribution: number[];
};

/**
 * Répartition des membres sur une échelle proposée, avant enregistrement.
 *
 * Compté par la base, palier par palier, sur l'index `(guildId, rp)` : le
 * dashboard n'a aucune raison de rapatrier une ligne par membre pour dessiner
 * un histogramme.
 */
export async function computeLadderImpact(guildId: string, ladder: RankedLadder): Promise<LadderImpact> {
  const total = await prismaRead.rankedMember.count({ where: { guildId } });

  const perTier = await Promise.all(ladder.map(async (tier, index) => {
    const next = ladder[index + 1];
    const range = {
      ...(index === 0 ? {} : { gte: tier.minRp }),
      ...(next ? { lt: next.minRp } : {}),
    };
    const [count, moved] = await Promise.all([
      prismaRead.rankedMember.count({ where: { guildId, rp: range } }),
      prismaRead.rankedMember.count({ where: { guildId, rp: range, tierKey: { not: tier.key } } }),
    ]);
    return { count, moved };
  }));

  return {
    total,
    changed: perTier.reduce((sum, tier) => sum + tier.moved, 0),
    distribution: perTier.map((tier) => tier.count),
  };
}

// ---------------------------------------------------------------------------
// Attribution en masse
// ---------------------------------------------------------------------------

type TierRoleSyncJob = {
  members: Array<{ userId: string; rp: number }>;
  startedAt: number;
  done: number;
  updated: number;
  running: boolean;
  stopping: boolean;
};

const syncJobs = new Map<string, TierRoleSyncJob>();

export function getTierRoleSyncStatus(guildId: string) {
  const job = syncJobs.get(guildId);
  if (!job) return { pending: 0, done: 0, updated: 0, running: false };
  if (!job.running && Date.now() - job.startedAt > SYNC_TTL_MS) {
    syncJobs.delete(guildId);
    return { pending: 0, done: 0, updated: 0, running: false };
  }
  return { pending: job.members.length, done: job.done, updated: job.updated, running: job.running };
}

/** Interrompt la passe en cours : elle s'arrête au membre suivant. */
export function stopTierRoleSync(guildId: string): boolean {
  const job = syncJobs.get(guildId);
  if (!job?.running) return false;
  job.stopping = true;
  return true;
}

/**
 * Attribue à chaque membre classé le rôle de son palier.
 *
 * Détaché de la requête : sur un serveur peuplé, la passe prend des minutes au
 * rythme imposé par l'API Discord. Le dashboard suit l'avancement par
 * `getTierRoleSyncStatus`, comme pour le rangement des rôles de niveau.
 */
export async function startTierRoleSync(
  guildId: string,
  client: Client,
): Promise<{ started: boolean; pending: number; error?: string }> {
  const existing = syncJobs.get(guildId);
  if (existing?.running) return { started: false, pending: existing.members.length };

  const config = await getRankedConfigSafe(guildId);
  if (!config?.tierRolesEnabled) return { started: false, pending: 0, error: 'tier_roles_disabled' };

  const mappings = await getTierRoles(guildId);
  if (mappings.length === 0) return { started: false, pending: 0, error: 'no_tier_roles' };

  const discordGuild = client.guilds.cache.get(guildId)
    || await client.guilds.fetch(guildId).catch(() => null);
  if (!discordGuild) return { started: false, pending: 0, error: 'guild_unavailable' };

  const me = discordGuild.members.me ?? await discordGuild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { started: false, pending: 0, error: 'missing_manage_roles' };
  }

  const members = await prismaRead.rankedMember.findMany({
    where: { guildId },
    select: { userId: true, rp: true },
    orderBy: { rp: 'desc' },
  });
  if (members.length === 0) return { started: false, pending: 0, error: 'no_members' };

  const job: TierRoleSyncJob = {
    members,
    startedAt: Date.now(),
    done: 0,
    updated: 0,
    running: true,
    stopping: false,
  };
  syncJobs.set(guildId, job);

  void runTierRoleSync(guildId, discordGuild, job);
  return { started: true, pending: members.length };
}

async function runTierRoleSync(guildId: string, discordGuild: DiscordGuild, job: TierRoleSyncJob): Promise<void> {
  try {
    const [config, ladder, mappings] = await Promise.all([
      getRankedConfigSafe(guildId),
      getGuildLadder(guildId),
      getTierRoles(guildId),
    ]);
    const roleOf = new Map(mappings.map((mapping) => [mapping.tierKey, mapping.roleId]));
    const managed = mappings.map((mapping) => mapping.roleId);
    const exclusive = config?.tierRolesExclusive !== false;

    logger.info(LOG_TAG, `Attribution des rôles de palier sur ${guildId} : ${job.members.length} membres.`);

    for (let index = job.done; index < job.members.length; index++) {
      if (job.stopping) {
        logger.info(LOG_TAG, `Attribution interrompue sur ${guildId} après ${job.done} membres.`);
        break;
      }

      const entry = job.members[index];
      const member = await discordGuild.members.fetch(entry.userId).catch(() => null);
      let touched = false;

      if (member) {
        const tier = ladder[rankedTierIndex(entry.rp, ladder)];
        const targetRoleId = roleOf.get(tier.key) ?? null;
        const toAdd = targetRoleId && !member.roles.cache.has(targetRoleId) ? [targetRoleId] : [];
        const toRemove = exclusive
          ? managed.filter((roleId) => roleId !== targetRoleId && member.roles.cache.has(roleId))
          : [];

        if (toRemove.length > 0) await member.roles.remove(toRemove).catch(() => null);
        if (toAdd.length > 0) await member.roles.add(toAdd).catch(() => null);
        touched = toAdd.length > 0 || toRemove.length > 0;
        if (touched) job.updated++;
      }

      job.done++;
      // Un membre déjà en règle n'a coûté aucune écriture : la longue pause est
      // réservée à ceux dont les rôles ont bougé, sinon une guilde déjà à jour
      // mettrait des heures à se relire.
      await new Promise((resolve) => setTimeout(resolve, touched ? SYNC_PAUSE_MS : 60));
    }

    if (!job.stopping) {
      logger.info(LOG_TAG, `Attribution terminée sur ${guildId} : ${job.updated} membres modifiés.`);
    }
  } catch (err) {
    logger.error(LOG_TAG, `Attribution des rôles de palier interrompue sur ${guildId}:`, err);
  } finally {
    job.running = false;
    job.stopping = false;
    if (job.done >= job.members.length) syncJobs.delete(guildId);
  }
}
