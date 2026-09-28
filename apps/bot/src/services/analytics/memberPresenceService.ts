/**
 * Rattrapage de la présence des membres sur les fiches (`guildLeftAt`).
 *
 * La date de départ n'est tenue que par les arrivées et départs vus en direct.
 * Tout ce que le bot ne voit pas la laisse fausse : un membre revenu pendant
 * une coupure reste « parti », un départ manqué le laisse « présent ». Cette
 * passe confronte les fiches à Discord et corrige les deux cas.
 */
import type { Client, Guild } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { isGuildActivated } from '../../utils/activation.js';

// Plafond de la passerelle Discord pour une recherche de membres par identifiant.
const MEMBER_LOOKUP_CHUNK = 100;
const WRITE_CHUNK = 500;
// Laisse respirer la passerelle entre deux serveurs : chaque recherche compte
// dans la limite d'envois du shard, partagée avec tout le reste du bot.
const GUILD_PAUSE_MS = 2_000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface MemberPresenceOutcome {
  returned: number;
  departed: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Identifiants, parmi `userIds`, des membres présents sur le serveur.
 *
 * Interroge Discord pour ces seuls membres plutôt que de charger la liste
 * entière : sur un gros serveur, elle resterait ensuite en cache pour rien.
 * `null` si une recherche échoue, pour ne rien conclure d'une réponse partielle.
 */
async function presentAmong(guild: Guild, userIds: string[]): Promise<Set<string> | null> {
  const present = new Set<string>();
  const unknown: string[] = [];
  for (const userId of userIds) {
    if (guild.members.cache.has(userId)) present.add(userId);
    else unknown.push(userId);
  }

  for (const ids of chunk(unknown, MEMBER_LOOKUP_CHUNK)) {
    try {
      const found = await guild.members.fetch({ user: ids });
      for (const userId of found.keys()) present.add(userId);
    } catch (error) {
      logger.warn('MemberPresence', `Recherche de membres impossible sur ${guild.id} : ${String(error)}`);
      return null;
    }
  }
  return present;
}

export async function reconcileGuildMemberPresence(guild: Guild): Promise<MemberPresenceOutcome> {
  const outcome: MemberPresenceOutcome = { returned: 0, departed: 0 };

  const markedLeft = await prisma.memberProfile.findMany({
    where: { guildId: guild.id, isBot: false, guildLeftAt: { not: null } },
    select: { userId: true },
  });

  if (markedLeft.length > 0) {
    const present = await presentAmong(guild, markedLeft.map((profile) => profile.userId));
    if (present && present.size > 0) {
      for (const ids of chunk([...present], WRITE_CHUNK)) {
        const { count } = await prisma.memberProfile.updateMany({
          where: { guildId: guild.id, userId: { in: ids }, guildLeftAt: { not: null } },
          data: { guildLeftAt: null },
        });
        outcome.returned += count;
      }
    }
  }

  // Un départ ne se déduit que d'une liste complète : un membre absent d'un
  // cache partiel n'est pas pour autant parti.
  if (guild.members.cache.size >= guild.memberCount) {
    const markedPresent = await prisma.memberProfile.findMany({
      where: { guildId: guild.id, isBot: false, guildLeftAt: null },
      select: { userId: true },
    });
    const gone = markedPresent
      .map((profile) => profile.userId)
      .filter((userId) => !guild.members.cache.has(userId));

    const now = new Date();
    for (const ids of chunk(gone, WRITE_CHUNK)) {
      const { count } = await prisma.memberProfile.updateMany({
        where: { guildId: guild.id, userId: { in: ids }, guildLeftAt: null },
        data: { guildLeftAt: now },
      });
      outcome.departed += count;
    }
  }

  return outcome;
}

/**
 * Passe de fond sur les serveurs activés du shard courant : les autres seront
 * vus par le leur.
 */
export async function reconcileAllMemberPresence(client: Client): Promise<void> {
  const guilds = [...client.guilds.cache.values()].filter((guild) => isGuildActivated(guild.id));

  for (const guild of guilds) {
    try {
      const { returned, departed } = await reconcileGuildMemberPresence(guild);
      if (returned > 0 || departed > 0) {
        logger.info('MemberPresence', `${guild.id} : ${returned} membre(s) revenu(s), ${departed} départ(s) rattrapé(s)`);
      }
    } catch (error) {
      logger.error('MemberPresence', `Rattrapage interrompu sur ${guild.id} : ${String(error)}`);
    }
    await delay(GUILD_PAUSE_MS);
  }
}
