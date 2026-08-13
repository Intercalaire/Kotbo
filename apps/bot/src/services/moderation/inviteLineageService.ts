/**
 * inviteLineageService.ts - Graphe de parrainage des invitations.
 *
 * `MemberInvite` enregistre déjà qui a invité qui. Chaîné, cela forme un arbre
 * de parrainage qui répond à deux questions qu'aucune donnée isolée ne permet
 * de trancher :
 *
 *  - « Ce nouveau membre vient-il d'une branche saine ? » Un compte invité par
 *    quelqu'un lui-même banni pour raid mérite plus de méfiance qu'un compte
 *    parrainé par un membre installé depuis deux ans.
 *
 *  - « Qui d'autre est entré par cette porte ? » Quand un raideur est démasqué,
 *    ses invités le sont rarement seuls : pouvoir mettre en quarantaine toute
 *    sa descendance en un geste change la durée d'un incident.
 *
 * Le cœur du module est constitué de fonctions pures sur le graphe : elles se
 * testent sans base et se rejouent sur un incident enregistré.
 */

import { type Guild, PermissionFlagsBits } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';

export type InviteEdge = {
  userId: string;
  inviterId: string | null;
  joinedAt: Date;
};

export type InviteGraph = {
  /** userId → son parrain. */
  inviterOf: Map<string, string>;
  /** userId → membres qu'il a parrainés. */
  invitedBy: Map<string, string[]>;
  joinedAt: Map<string, Date>;
};

/** Profondeur maximale explorée, pour borner le coût et les chaînes absurdes. */
export const MAX_LINEAGE_DEPTH = 8;

// ─── Cœur : fonctions pures sur le graphe ──────────────────────────────────────

export function buildInviteGraph(edges: InviteEdge[]): InviteGraph {
  const inviterOf = new Map<string, string>();
  const invitedBy = new Map<string, string[]>();
  const joinedAt = new Map<string, Date>();

  for (const edge of edges) {
    joinedAt.set(edge.userId, edge.joinedAt);
    if (!edge.inviterId || edge.inviterId === edge.userId) continue;

    inviterOf.set(edge.userId, edge.inviterId);
    const children = invitedBy.get(edge.inviterId) ?? [];
    children.push(edge.userId);
    invitedBy.set(edge.inviterId, children);
  }

  return { inviterOf, invitedBy, joinedAt };
}

/** Chaîne de parrainage remontante, du parrain direct vers la racine. */
export function ancestorsOf(graph: InviteGraph, userId: string, maxDepth = MAX_LINEAGE_DEPTH): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([userId]);

  let current = graph.inviterOf.get(userId);
  while (current && chain.length < maxDepth) {
    // Les données d'invitation peuvent contenir des cycles (comptes qui se
    // parrainent mutuellement après un départ/retour) : on s'arrête net.
    if (seen.has(current)) break;
    seen.add(current);
    chain.push(current);
    current = graph.inviterOf.get(current);
  }

  return chain;
}

export type LineageNode = { userId: string; depth: number; inviterId: string | null };

/** Descendance complète d'un membre, en largeur d'abord. */
export function descendantsOf(graph: InviteGraph, rootId: string, maxDepth = MAX_LINEAGE_DEPTH): LineageNode[] {
  const result: LineageNode[] = [];
  const seen = new Set<string>([rootId]);
  let frontier: string[] = [rootId];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const child of graph.invitedBy.get(parent) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        result.push({ userId: child, depth, inviterId: parent });
        next.push(child);
      }
    }
    frontier = next;
  }

  return result;
}

export type LineageTrust = {
  /** Pénalité 0-100 héritée de la chaîne de parrainage. */
  penalty: number;
  /** Ancêtre problématique le plus proche, s'il y en a un. */
  taintedBy: string | null;
  depth: number;
  chainLength: number;
};

/**
 * Pénalité de confiance héritée de la chaîne de parrainage.
 *
 * L'influence décroît avec la distance : être invité directement par un compte
 * banni pour raid est lourd, l'être par le parrain du parrain l'est beaucoup
 * moins. Au-delà de quelques niveaux, le lien ne veut plus rien dire.
 */
export function inheritedTrustPenalty(chain: string[], taintedUserIds: ReadonlySet<string>): LineageTrust {
  for (let i = 0; i < chain.length; i++) {
    if (!taintedUserIds.has(chain[i])) continue;

    // 60 au premier degré, 30 au deuxième, 15 au troisième, puis négligeable.
    const penalty = Math.round(60 / 2 ** i);
    return { penalty: penalty < 5 ? 0 : penalty, taintedBy: chain[i], depth: i + 1, chainLength: chain.length };
  }

  return { penalty: 0, taintedBy: null, depth: 0, chainLength: chain.length };
}

// ─── Accès aux données ─────────────────────────────────────────────────────────

/** Nombre maximal d'arêtes chargées : au-delà, le graphe n'apporte plus rien. */
const MAX_EDGES = 50_000;

export async function loadInviteGraph(guildId: string): Promise<InviteGraph> {
  const rows = await prisma.memberInvite.findMany({
    where: { guildId },
    select: { userId: true, inviterId: true, joinedAt: true },
    orderBy: { joinedAt: 'desc' },
    take: MAX_EDGES,
  });
  return buildInviteGraph(rows);
}

/**
 * Membres « à risque » du serveur : bannis, ou sanctionnés lourdement.
 * Sert de source de contamination pour la pénalité héritée.
 */
export async function loadTaintedUserIds(guildId: string): Promise<Set<string>> {
  const sanctions = await prisma.sanction
    .findMany({
      where: { guildId, type: { in: ['BAN', 'SOFTBAN', 'KICK', 'TEMP_BAN'] } },
      select: { targetUserId: true },
      take: 10_000,
    })
    .catch(() => [] as { targetUserId: string }[]);

  return new Set(sanctions.map((s) => s.targetUserId));
}

export type LineageReport = {
  userId: string;
  chain: string[];
  trust: LineageTrust;
  directInvites: number;
  totalDescendants: number;
  /** Descendants ayant déjà été sanctionnés : mesure la toxicité de la branche. */
  taintedDescendants: number;
};

/** Rapport de lignage d'un membre : d'où il vient et ce qu'il a amené. */
export async function getLineageReport(guildId: string, userId: string): Promise<LineageReport> {
  const [graph, tainted] = await Promise.all([loadInviteGraph(guildId), loadTaintedUserIds(guildId)]);

  const chain = ancestorsOf(graph, userId);
  const descendants = descendantsOf(graph, userId);

  return {
    userId,
    chain,
    trust: inheritedTrustPenalty(chain, tainted),
    directInvites: (graph.invitedBy.get(userId) ?? []).length,
    totalDescendants: descendants.length,
    taintedDescendants: descendants.filter((d) => tainted.has(d.userId)).length,
  };
}

export type QuarantineOptions = {
  /** Ne cible que les membres arrivés après cette date. */
  since?: Date;
  /** Profondeur maximale de descendance traitée. */
  maxDepth?: number;
  /** true = ne fait que lister, sans rien appliquer. */
  dryRun?: boolean;
  /** Rôle de quarantaine à appliquer. Sans lui, seul un timeout est posé. */
  quarantineRoleId?: string | null;
  reason: string;
};

export type QuarantineResult = {
  targets: LineageNode[];
  applied: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
};

/**
 * Met en quarantaine la descendance d'un membre.
 *
 * Volontairement non destructif : on pose un rôle de quarantaine ou un timeout,
 * jamais un bannissement. Une erreur de parrainage ne doit pas coûter le compte
 * de quelqu'un — la décision définitive reste humaine.
 */
export async function quarantineLineage(
  guild: Guild,
  rootUserId: string,
  options: QuarantineOptions
): Promise<QuarantineResult> {
  const graph = await loadInviteGraph(guild.id);
  let targets = descendantsOf(graph, rootUserId, options.maxDepth ?? MAX_LINEAGE_DEPTH);

  if (options.since) {
    const since = options.since.getTime();
    targets = targets.filter((node) => (graph.joinedAt.get(node.userId)?.getTime() ?? 0) >= since);
  }

  const result: QuarantineResult = {
    targets,
    applied: 0,
    skipped: 0,
    failed: 0,
    dryRun: Boolean(options.dryRun),
  };

  if (options.dryRun) return result;

  const me = guild.members.me;
  const canModerate = me?.permissions.has(PermissionFlagsBits.ModerateMembers) ?? false;
  const canManageRoles = me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;

  for (const node of targets) {
    const member = await guild.members.fetch(node.userId).catch(() => null);
    if (!member) {
      result.skipped++;
      continue;
    }

    // On ne touche jamais à quelqu'un qui peut modérer : une chaîne de
    // parrainage n'est pas une preuve suffisante pour désarmer un membre du staff.
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      result.skipped++;
      continue;
    }

    try {
      if (options.quarantineRoleId && canManageRoles) {
        await member.roles.add(options.quarantineRoleId, options.reason);
      } else if (canModerate) {
        await member.timeout(24 * 60 * 60 * 1000, options.reason);
      } else {
        result.skipped++;
        continue;
      }
      result.applied++;
    } catch (err) {
      logger.debug('InviteLineage', `Quarantaine impossible pour ${node.userId}: ${String(err)}`);
      result.failed++;
    }
  }

  logger.warn(
    'InviteLineage',
    `Quarantaine de lignage sur ${guild.id} depuis ${rootUserId} : ${result.applied} appliquée(s), ${result.skipped} ignorée(s), ${result.failed} échec(s)`
  );
  return result;
}
