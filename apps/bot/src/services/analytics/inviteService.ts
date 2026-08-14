import { type Client, type Guild, type Invite } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';

export type InviteStats = {
  inviterId: string;
  inviterTag: string;
  totalJoined: number;
  totalLeft: number;
  totalStayed: number;
};

/**
 * Synchronise les invitations Discord avec la base de données
 */
export async function syncGuildInvites(guild: Guild): Promise<void> {
  try {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return;

    for (const invite of invites.values()) {
      await prisma.guildInvite.upsert({
        where: { code: invite.code },
        update: {
          uses: invite.uses ?? 0,
          maxUses: invite.maxUses ?? null,
          expiresAt: invite.expiresAt ? new Date(invite.expiresAt) : null,
          inviterId: invite.inviter?.id ?? null,
          inviterTag: invite.inviter?.tag ?? invite.inviter?.username ?? null,
          isTemporary: invite.temporary ?? false,
          isDeleted: false,
        },
        create: {
          guildId: guild.id,
          code: invite.code,
          uses: invite.uses ?? 0,
          maxUses: invite.maxUses ?? null,
          expiresAt: invite.expiresAt ? new Date(invite.expiresAt) : null,
          inviterId: invite.inviter?.id ?? null,
          inviterTag: invite.inviter?.tag ?? invite.inviter?.username ?? null,
          isTemporary: invite.temporary ?? false,
          isDeleted: false,
        },
      });
    }

    logger.debug('Invites', `Synchronisation terminée pour le serveur ${guild.id} (${invites.size} invitations)`);
  } catch (error) {
    logger.warn('Invites', `Erreur lors de la synchronisation des invitations pour ${guild.id}: ${String(error)}`);
  }
}

// ── Provenance automatique des invitations créées par Kotbo ──────────────────

/** Longueur max d'une provenance, alignée sur la limite du tableau de bord. */
const SOURCE_LABEL_MAX_LENGTH = 60;

/**
 * Construit une provenance au format `Fonctionnalité-Détail` (ex. `Link-Les nerds`)
 * pour que les invitations d'une même fonctionnalité restent regroupables.
 */
export function buildInviteSourceLabel(prefix: string, detail?: string | null): string {
  const cleaned = detail?.trim().replace(/\s+/g, ' ') ?? '';
  const label = cleaned ? `${prefix}-${cleaned}` : prefix;
  return label.length > SOURCE_LABEL_MAX_LENGTH
    ? `${label.slice(0, SOURCE_LABEL_MAX_LENGTH - 1)}…`
    : label;
}

/**
 * Provenances posées automatiquement sur les invitations que le bot crée lui-même.
 * Les invitations créées par les membres restent sans provenance tant qu'elle
 * n'est pas nommée depuis le tableau de bord.
 */
export const INVITE_SOURCE = {
  /** Invitation affichée dans le topic du salon lié : elle amène les membres de l'autre serveur. */
  channelLink: (linkedGuildName?: string | null) => buildInviteSourceLabel('Link', linkedGuildName),
  /** Invitation partagée pour appairer deux salons (serveur distant encore inconnu). */
  channelLinkPairing: () => buildInviteSourceLabel('Link', 'Appairage'),
  /** Onboarding d'un staff vers le serveur staff. */
  staffOnboarding: (mainGuildName?: string | null) => buildInviteSourceLabel('Staff', mainGuildName),
  /** Réinvitation automatique après un déclenchement du honeypot. */
  honeypot: () => buildInviteSourceLabel('Honeypot', 'Réinvitation'),
  /** Retour d'un membre dont l'appel de bannissement a été accepté. */
  banAppeal: () => buildInviteSourceLabel('Appel', 'Ban'),
  /** Candidature partenariat / bêta-test acceptée. */
  partnership: () => buildInviteSourceLabel('Partenariat'),
  /** Invitation recréée après validation staff (garde-invitations). */
  inviteApproval: () => buildInviteSourceLabel('Validation', 'Staff'),
  /** Invitation générée depuis le panneau d'administration Kotbo. */
  supportAdmin: () => buildInviteSourceLabel('Support', 'Kotbo'),
  /** Invitation créée via un outil MCP, tracée par nom de clé quand il est connu. */
  mcp: (keyName?: string | null) => buildInviteSourceLabel('MCP', keyName),
} as const;

/**
 * Attribue une provenance à une invitation, en créant l'enregistrement si la
 * synchronisation Discord n'est pas encore passée dessus.
 */
export async function tagInviteSource(params: {
  guildId: string;
  code: string;
  sourceLabel: string;
  inviterId?: string | null;
  inviterTag?: string | null;
  uses?: number;
  maxUses?: number | null;
  expiresAt?: Date | null;
  isTemporary?: boolean;
}): Promise<void> {
  const sourceLabel = buildInviteSourceLabel(params.sourceLabel);
  try {
    await prisma.guildInvite.upsert({
      where: { code: params.code },
      update: { sourceLabel },
      create: {
        guildId: params.guildId,
        code: params.code,
        sourceLabel,
        inviterId: params.inviterId ?? null,
        inviterTag: params.inviterTag ?? null,
        uses: params.uses ?? 0,
        maxUses: params.maxUses ?? null,
        expiresAt: params.expiresAt ?? null,
        isTemporary: params.isTemporary ?? false,
        isDeleted: false,
      },
    });
  } catch (error) {
    logger.warn('Invites', `Impossible d'attribuer la provenance « ${sourceLabel} » à l'invitation ${params.code}: ${String(error)}`);
  }
}

/**
 * Enregistre une invitation fraîchement créée par le bot avec sa provenance.
 * Ne jette jamais : une provenance manquante ne doit pas casser la fonctionnalité appelante.
 */
export async function recordBotInvite(invite: Invite, sourceLabel: string): Promise<void> {
  const guildId = invite.guild?.id;
  if (!guildId || !invite.code) return;

  await tagInviteSource({
    guildId,
    code: invite.code,
    sourceLabel,
    inviterId: invite.inviter?.id ?? null,
    inviterTag: invite.inviter?.tag ?? invite.inviter?.username ?? null,
    uses: invite.uses ?? 0,
    maxUses: invite.maxUses ?? null,
    expiresAt: invite.expiresAt ? new Date(invite.expiresAt) : null,
    isTemporary: invite.temporary ?? false,
  });
}

/**
 * Marque une invitation comme supprimée
 */
export async function markInviteAsDeleted(code: string): Promise<void> {
  await prisma.guildInvite.updateMany({
    where: { code },
    data: { isDeleted: true },
  }).catch(() => null);
}

/**
 * Récupère le classement des meilleurs inviteurs
 */
export async function getInviteLeaderboard(guildId: string, limit = 10): Promise<InviteStats[]> {
  const stats = await prisma.memberInvite.groupBy({
    by: ['inviterId', 'inviterTag'],
    where: {
      guildId,
      inviterId: { not: null },
    },
    _count: {
      id: true,
    },
  });

  const leaveStats = await prisma.memberInvite.groupBy({
    by: ['inviterId'],
    where: {
      guildId,
      inviterId: { not: null },
      leftAt: { not: null },
    },
    _count: {
      id: true,
    },
  });

  const leaveMap = new Map(leaveStats.map(s => [s.inviterId, s._count.id]));

  return stats
    .map(s => ({
      inviterId: s.inviterId!,
      inviterTag: s.inviterTag ?? 'Inconnu',
      totalJoined: s._count.id,
      totalLeft: leaveMap.get(s.inviterId!) ?? 0,
      totalStayed: s._count.id - (leaveMap.get(s.inviterId!) ?? 0),
    }))
    .sort((a, b) => b.totalStayed - a.totalStayed)
    .slice(0, limit);
}

/**
 * Récupère les stats d'un utilisateur spécifique
 */
export async function getUserInviteStats(guildId: string, userId: string): Promise<InviteStats | null> {
  const joins = await prisma.memberInvite.count({
    where: { guildId, inviterId: userId },
  });

  const leaves = await prisma.memberInvite.count({
    where: { guildId, inviterId: userId, leftAt: { not: null } },
  });

  const user = await prisma.memberInvite.findFirst({
    where: { inviterId: userId },
    select: { inviterTag: true },
  });

  return {
    inviterId: userId,
    inviterTag: user?.inviterTag ?? 'Inconnu',
    totalJoined: joins,
    totalLeft: leaves,
    totalStayed: joins - leaves,
  };
}

/**
 * Met à jour le départ d'un membre invité
 */
export async function recordInvitedMemberLeave(guildId: string, userId: string): Promise<void> {
  await prisma.memberInvite.updateMany({
    where: {
      guildId,
      userId,
      leftAt: null,
    },
    data: {
      leftAt: new Date(),
    },
  }).catch((error) => {
    logger.warn('Invites', `Erreur lors de l'enregistrement du départ de l'invité ${userId}: ${String(error)}`);
  });
}

/**
 * Synchronise toutes les guildes au démarrage
 */
export async function syncAllGuildsInvites(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    await syncGuildInvites(guild);
  }
}
