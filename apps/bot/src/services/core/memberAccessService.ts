/**
 * Rattrapage du role d'acces pose par la mise en place guidee du serveur.
 *
 * Cette mise en place ferme tous les salons a @everyone et les rouvre au seul
 * role Membre. Tout ce qui empeche un membre de recevoir ce role le laisse donc
 * devant une liste de salons vide, sans message et sans recours :
 *
 * - les membres deja presents quand la mise en place a tourne, que rien ne
 *   distribue puisque l'auto-role ne joue qu'a l'arrivee ;
 * - ceux qui rejoignent pendant que le bot est hors ligne, Discord ne rejouant
 *   pas les arrivees manquees ;
 * - ceux dont l'attribution a echoue, hierarchie de roles ou permission perdue ;
 * - ceux qui ont reussi le captcha sans pouvoir recevoir leur role.
 *
 * Quatre chemins, un seul symptome. Plutot que quatre correctifs, une passe qui
 * repere le symptome - ni role Membre, ni verification en cours - et le repare.
 */
import { PermissionFlagsBits, type Client, type Guild, type GuildMember } from 'discord.js';
import { Prisma } from '@prisma/client';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errors.js';

/**
 * Attributions par passe et par serveur.
 *
 * Chaque attribution est un appel REST. Un serveur de plusieurs milliers de
 * membres mis en place d'un coup saturerait le plafond de discord.js et ferait
 * attendre tout le trafic ordinaire du bot derriere. Le reste passe a la suivante.
 */
const MAX_GRANTS_PER_RUN = 200;

export type MemberAccessOutcome = {
  granted: number;
  /** Membres remis dans le parcours de verification. */
  restarted: number;
  /** Ce qui reste a faire, la passe s'arretant au plafond. */
  remaining: number;
  /** Empechement de fond : rien n'a pu etre fait, et il faut le dire. */
  blocked: string | null;
};

const EMPTY: MemberAccessOutcome = { granted: 0, restarted: 0, remaining: 0, blocked: null };

function readRef(value: Prisma.JsonValue | null | undefined, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>)[key];
  return typeof id === 'string' ? id : null;
}

/**
 * Le role Membre d'un serveur, ou `null` s'il n'y en a pas.
 *
 * Lu dans la trace de la mise en place, seule source qui dise que c'est bien
 * *ce* role qui ouvre les salons. Un auto-role choisi a la main par l'admin ne
 * porte pas cette promesse : le redistribuer serait s'inviter dans sa
 * configuration.
 */
export async function resolveMemberRoleId(guildId: string): Promise<string | null> {
  const guildRow = await prisma.guild.findUnique({
    where: { id: guildId },
    select: { serverTemplateRefs: true },
  });
  return readRef(guildRow?.serverTemplateRefs, 'role.member');
}

/**
 * Rend le role Membre a qui ne l'a pas et n'a rien a verifier.
 *
 * `backfill` sert au seul appel qui suit la mise en place : les membres deja
 * presents a ce moment-la etaient sur le serveur avant que le captcha existe,
 * leur imposer une verification qu'ils n'avaient pas a passer les enfermerait
 * dehors. Hors de ce cas, un membre sans role qui doit se verifier est renvoye
 * dans le parcours plutot que servi.
 */
export async function reconcileMemberAccess(
  client: Client,
  guildId: string,
  options: { backfill?: boolean } = {},
): Promise<MemberAccessOutcome> {
  const memberRoleId = await resolveMemberRoleId(guildId);
  if (!memberRoleId) return EMPTY;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return EMPTY;

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ...EMPTY, blocked: 'permission « Gérer les rôles » manquante' };
  }

  const memberRole = guild.roles.cache.get(memberRoleId)
    ?? await guild.roles.fetch(memberRoleId).catch(() => null);
  if (!memberRole) return { ...EMPTY, blocked: 'rôle Membre introuvable, il a été supprimé' };

  // Verifie avant la boucle plutot qu'a chaque membre : le refus serait le meme
  // deux mille fois de suite, et il vaut mieux une phrase que deux mille echecs.
  if (memberRole.position >= me.roles.highest.position) {
    return { ...EMPTY, blocked: `le rôle @${memberRole.name} est au-dessus de celui de Kotbo dans la hiérarchie` };
  }

  const raidConfig = await prisma.raidProtectionConfig.findUnique({ where: { guildId } });
  const captchaOn = !!raidConfig?.captchaEnabled && !options.backfill;
  const unverifiedRoleId = raidConfig?.captchaUnverifiedRoleId ?? null;

  const members = await fetchMembers(guild);
  if (!members) return { ...EMPTY, blocked: 'liste des membres illisible' };

  const candidates = members.filter((member) => {
    if (member.user.bot) return false;
    if (member.roles.cache.has(memberRoleId)) return false;
    // Verification en cours : le captcha s'en occupe, et lui donner le role
    // maintenant reviendrait a la lui epargner.
    if (unverifiedRoleId && member.roles.cache.has(unverifiedRoleId)) return false;
    // Un membre reduit au silence est un membre que le staff a mis a l'ecart :
    // lui rouvrir le serveur defairait une sanction en cours.
    if (member.isCommunicationDisabled()) return false;
    return true;
  });

  if (candidates.length === 0) return EMPTY;

  const verifiedIds = captchaOn ? await verifiedUserIds(guildId, candidates.map((member) => member.id)) : null;
  const pendingIds = captchaOn ? await pendingUserIds(guildId, candidates.map((member) => member.id)) : null;

  let granted = 0;
  let restarted = 0;
  let processed = 0;

  for (const member of candidates) {
    if (processed >= MAX_GRANTS_PER_RUN) break;

    // Hors captcha, et pour les membres deja verifies, le role est simplement du.
    if (!captchaOn || verifiedIds?.has(member.id)) {
      processed++;
      const ok = await member.roles.add(memberRole, "Rattrapage de l'accès au serveur")
        .then(() => true)
        .catch((err) => {
          logger.warn('MemberAccess', `Rôle Membre non attribuable à ${member.id} sur ${guildId} : ${errorMessage(err)}`);
          return false;
        });
      if (ok) granted++;
      continue;
    }

    // Une session en attente veut dire que le parcours a bien demarre : soit le
    // membre y est, soit son role non-verifie n'a pas pu etre pose - et le
    // relancer echouerait pareil, en inondant le salon de verification au
    // passage. La mauvaise configuration, elle, est deja signalee par le captcha.
    if (pendingIds?.has(member.id)) continue;

    processed++;
    const { startCaptchaChallenge } = await import('../moderation/captchaService.js');
    await startCaptchaChallenge(member, raidConfig!).then(() => { restarted++; }).catch((err) => {
      logger.warn('MemberAccess', `Relance du captcha impossible pour ${member.id} sur ${guildId} : ${errorMessage(err)}`);
    });
  }

  if (granted > 0 || restarted > 0) {
    logger.info('MemberAccess', `${guildId} : ${granted} accès rendu(s), ${restarted} vérification(s) relancée(s)`);
  }

  return { granted, restarted, remaining: Math.max(0, candidates.length - processed), blocked: null };
}

/**
 * Passe de fond sur les serveurs mis en place. Ne parcourt que ceux du shard
 * courant : les autres seront vus par le leur.
 */
export async function reconcileAllMemberAccess(client: Client): Promise<void> {
  const guilds = await prisma.guild.findMany({
    where: { serverTemplateAppliedAt: { not: null } },
    select: { id: true },
  });

  for (const row of guilds) {
    if (!client.guilds.cache.has(row.id)) continue;
    try {
      const outcome = await reconcileMemberAccess(client, row.id);
      if (outcome.blocked) {
        logger.warn('MemberAccess', `${row.id} : rattrapage impossible, ${outcome.blocked}`);
      }
    } catch (err) {
      logger.error('MemberAccess', `Rattrapage interrompu sur ${row.id} : ${errorMessage(err)}`);
    }
  }
}

/**
 * Le cache suffit des lors qu'il porte tout le monde : le remplir a chaque passe
 * ferait un aller-retour complet par serveur et par heure pour, le plus souvent,
 * ne rien trouver a faire.
 */
async function fetchMembers(guild: Guild): Promise<GuildMember[] | null> {
  if (guild.members.cache.size >= guild.memberCount) {
    return [...guild.members.cache.values()];
  }
  const fetched = await guild.members.fetch().catch((err) => {
    logger.warn('MemberAccess', `Liste des membres illisible sur ${guild.id} : ${errorMessage(err)}`);
    return null;
  });
  return fetched ? [...fetched.values()] : null;
}

async function verifiedUserIds(guildId: string, userIds: string[]): Promise<Set<string>> {
  const sessions = await prisma.captchaSession.findMany({
    where: { guildId, userId: { in: userIds }, status: 'VERIFIED' },
    select: { userId: true },
    distinct: ['userId'],
  });
  return new Set(sessions.map((session) => session.userId));
}

async function pendingUserIds(guildId: string, userIds: string[]): Promise<Set<string>> {
  const sessions = await prisma.captchaSession.findMany({
    where: { guildId, userId: { in: userIds }, status: 'PENDING' },
    select: { userId: true },
    distinct: ['userId'],
  });
  return new Set(sessions.map((session) => session.userId));
}
