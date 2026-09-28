/**
 * dc/inviteOrigin.ts - Qui a réellement invité un membre.
 *
 * Le créateur Discord d'une invitation n'est pas toujours la personne qui a
 * fait venir le membre. Avec la validation staff du garde-invitations, la
 * demande d'un membre est supprimée puis recréée par Kotbo : l'invitation porte
 * alors le bot comme créateur, et la détection concluait « invité par
 * <@Kotbo> ». Le vrai demandeur (souvent le compte principal) n'était jamais
 * comparé au nouveau venu, et c'est le bot qui finissait proposé comme alt.
 *
 * On remonte donc au demandeur quand l'invitation vient d'une validation, et on
 * écarte les autres invitations de bots (honeypot, appel de ban, bots tiers) :
 * elles ne désignent aucun parrain humain.
 */

import prisma from '../../../utils/db.js';

/** Invitation d'arrivée telle que vue à l'événement Discord (ou relue en base). */
export type JoinInvite = {
  code: string | null;
  inviterId: string | null;
  /** Renseigné quand Discord l'a dit ; sinon lu sur le profil de l'inviteur. */
  inviterIsBot?: boolean;
};

export type InviteSponsor = {
  /** Humain à l'origine de l'arrivée. */
  sponsorId: string;
  /** Vrai quand l'invitation a été recréée par Kotbo après validation staff. */
  viaApproval: boolean;
};

async function isKnownBot(guildId: string, userId: string): Promise<boolean> {
  const profile = await prisma.memberProfile
    .findUnique({ where: { guildId_userId: { guildId, userId } }, select: { isBot: true } })
    .catch(() => null);
  return profile?.isBot === true;
}

export async function resolveInviteSponsor(guildId: string, invite: JoinInvite | null): Promise<InviteSponsor | null> {
  if (!invite) return null;

  // Une invitation validée désigne son demandeur, quel que soit son créateur Discord.
  if (invite.code) {
    const request = await prisma.inviteApprovalRequest
      .findFirst({
        where: { guildId, approvedInviteCode: invite.code, status: 'APPROVED' },
        select: { creatorId: true },
      })
      .catch(() => null);
    if (request?.creatorId) return { sponsorId: request.creatorId, viaApproval: true };
  }

  if (!invite.inviterId) return null;
  const isBot = invite.inviterIsBot ?? (await isKnownBot(guildId, invite.inviterId));
  return isBot ? null : { sponsorId: invite.inviterId, viaApproval: false };
}

/**
 * Membres arrivés grâce à `sponsorId` : par ses propres invitations, ou par
 * celles que Kotbo a recréées pour lui après validation.
 */
export async function listUsersInvitedBy(guildId: string, sponsorId: string): Promise<string[]> {
  const approved = await prisma.inviteApprovalRequest
    .findMany({
      where: { guildId, creatorId: sponsorId, status: 'APPROVED', approvedInviteCode: { not: null } },
      select: { approvedInviteCode: true },
    })
    .catch(() => [] as { approvedInviteCode: string | null }[]);
  const codes = approved.map((r) => r.approvedInviteCode).filter((code): code is string => Boolean(code));

  const rows = await prisma.memberInvite.findMany({
    where: {
      guildId,
      OR: [{ inviterId: sponsorId }, ...(codes.length > 0 ? [{ inviteCode: { in: codes } }] : [])],
    },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

/** Parmi `userIds`, ceux qui sont des bots : ils ne peuvent pas être un double compte. */
export async function findBotIds(guildId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const bots = await prisma.memberProfile
    .findMany({ where: { guildId, userId: { in: userIds }, isBot: true }, select: { userId: true } })
    .catch(() => [] as { userId: string }[]);
  return new Set(bots.map((b) => b.userId));
}
