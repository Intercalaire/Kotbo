import type { Client, User } from 'discord.js';
import prisma from '../../utils/db.js';
import { touchMemberProfileFromMember, touchMemberProfileFromUser } from '../moderation/memberCaseService.js';

/**
 * Fiches de membre creees sans attendre un premier message.
 *
 * Une fiche (`MemberProfile`) existe par serveur, mais la description et la
 * visibilite que le membre regle depuis « Mon espace » sont les siennes, pas
 * celles d'un serveur : elles sont recopiees sur chaque fiche. Sans cela, la
 * fiche la plus recemment touchee - donc le serveur ou il a ecrit en dernier -
 * s'affichait sans la description enregistree ailleurs.
 */

// La synchronisation part de l'ouverture du dashboard : sans ce delai, chaque
// rechargement de page relancerait la liste OAuth et un fetch par serveur.
const SYNC_COOLDOWN_MS = 10 * 60_000;
const SYNC_COOLDOWN_MAX_ENTRIES = 5_000;
const nextSyncAt = new Map<string, number>();

function claimSync(userId: string, force: boolean): boolean {
  const now = Date.now();
  if (!force && (nextSyncAt.get(userId) ?? 0) > now) return false;
  if (nextSyncAt.size >= SYNC_COOLDOWN_MAX_ENTRIES) {
    for (const [key, until] of nextSyncAt) {
      if (until <= now) nextSyncAt.delete(key);
    }
    if (nextSyncAt.size >= SYNC_COOLDOWN_MAX_ENTRIES) nextSyncAt.clear();
  }
  nextSyncAt.set(userId, now + SYNC_COOLDOWN_MS);
  return true;
}

/**
 * Cree la fiche manquante de `userId` sur chacun des `guildIds` - des serveurs
 * ou le bot est present, a l'appelant de le garantir.
 *
 * Un serveur du fragment courant est verifie : si la personne n'en est plus
 * membre, aucune fiche n'y est ouverte. Un serveur d'un autre fragment ne peut
 * pas l'etre d'ici ; la liste OAuth dont il vient fait alors foi, et la fiche
 * est remplie avec le seul compte Discord, completee au premier evenement.
 */
export async function ensureMemberProfiles(
  client: Client,
  userId: string,
  guildIds: Iterable<string>,
  options: { force?: boolean } = {},
): Promise<number> {
  const wanted = [...new Set(guildIds)];
  if (wanted.length === 0 || !claimSync(userId, options.force ?? false)) return 0;

  const existing = await prisma.memberProfile.findMany({
    where: { userId },
    select: { guildId: true, bio: true, isProfilePrivate: true },
    orderBy: { updatedAt: 'desc' },
  });
  const known = new Set(existing.map((profile) => profile.guildId));
  const missing = wanted.filter((guildId) => !known.has(guildId));
  if (missing.length === 0) return 0;

  let user: User | null = null;
  const created: string[] = [];
  for (const guildId of missing) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      await touchMemberProfileFromMember(member);
    } else {
      user ??= await client.users.fetch(userId).catch(() => null);
      if (!user) break;
      await touchMemberProfileFromUser(guildId, user);
    }
    created.push(guildId);
  }

  const source = existing.find((profile) => profile.bio) ?? existing[0];
  if (source && created.length > 0) {
    await prisma.memberProfile.updateMany({
      where: { userId, guildId: { in: created } },
      data: { bio: source.bio, isProfilePrivate: source.isProfilePrivate },
    });
  }
  return created.length;
}

/**
 * Reprend la description et la visibilite deja reglees ailleurs sur la fiche
 * d'un serveur qui n'en a pas encore - a l'arrivee sur un nouveau serveur.
 */
export async function inheritSharedProfileFields(userId: string, guildId: string): Promise<void> {
  const [target, source] = await Promise.all([
    prisma.memberProfile.findUnique({
      where: { guildId_userId: { guildId, userId } },
      select: { bio: true },
    }),
    prisma.memberProfile.findFirst({
      where: { userId, guildId: { not: guildId }, bio: { not: null } },
      select: { bio: true, isProfilePrivate: true },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);
  if (!target || target.bio !== null || !source) return;

  await prisma.memberProfile.update({
    where: { guildId_userId: { guildId, userId } },
    data: { bio: source.bio, isProfilePrivate: source.isProfilePrivate },
  });
}
