/**
 * Annuaire des guildes et édition de sa propre guilde.
 *
 * Les guildes n'étaient visibles que de l'intérieur : sans connaître le nom exact d'une
 * guilde, il était impossible d'en trouver une à rejoindre, et impossible de savoir ce
 * qu'on rejoignait. L'annuaire rend la fiche de n'importe quelle guilde consultable, qu'on
 * en soit membre ou non.
 */

import prisma from '../../../utils/db.js';
import { RPG_GUILD_NAME_MIN, RPG_GUILD_NAME_MAX } from '../economyService.js';
import { rpgGuildXpNeeded } from '../economyPolicy.js';
import { aggregateGuildPerks, type GuildPerks } from './rpgGuildBuildings.js';

/** Description : assez pour se présenter, pas assez pour faire déborder un embed. */
export const RPG_GUILD_DESCRIPTION_MAX = 300;

/**
 * Places d'une guilde : dix, plus deux par niveau.
 * Dupliqué de `joinRpgGuild`, qui l'applique à l'inscription ; l'annuaire doit afficher
 * exactement la limite qui sera opposée au joueur au moment de rejoindre.
 */
export function guildMemberCapacity(level: number): number {
  return 10 + level * 2;
}

export type GuildDirectoryEntry = {
  id: string;
  name: string;
  emoji: string;
  description: string | null;
  level: number;
  ownerId: string;
  memberCount: number;
  capacity: number;
  full: boolean;
  /** `true` quand c'est la guilde du lecteur. */
  isMine: boolean;
};

/**
 * Toutes les guildes du serveur, les plus fournies d'abord.
 *
 * Le tri met en tête celles qui vivent : une guilde de niveau élevé et bien remplie est
 * celle qu'un nouveau venu a le plus de raisons de rejoindre. Les guildes complètes
 * restent listées — savoir qu'elles existent fait partie du paysage du serveur.
 */
export async function listRpgGuilds(guildId: string, viewerId: string, limit = 25): Promise<GuildDirectoryEntry[]> {
  const [profile, guilds] = await Promise.all([
    prisma.rpgProfile.findUnique({
      where: { guildId_userId: { guildId, userId: viewerId } },
      select: { rpgGuildId: true },
    }),
    prisma.rpgGuild.findMany({
      where: { guildId },
      orderBy: [{ level: 'desc' }, { xp: 'desc' }],
      take: limit,
      include: { _count: { select: { members: true } } },
    }),
  ]);

  return guilds.map((rpgGuild) => {
    const capacity = guildMemberCapacity(rpgGuild.level);
    return {
      id: rpgGuild.id,
      name: rpgGuild.name,
      emoji: rpgGuild.emoji,
      description: rpgGuild.description,
      level: rpgGuild.level,
      ownerId: rpgGuild.ownerId,
      memberCount: rpgGuild._count.members,
      capacity,
      full: rpgGuild._count.members >= capacity,
      isMine: profile?.rpgGuildId === rpgGuild.id,
    };
  });
}

export type GuildProfileView = GuildDirectoryEntry & {
  xp: number;
  xpNeeded: number;
  /** Le trésor n'est chiffré que pour les membres : c'est une information interne. */
  treasury: number | null;
  members: { userId: string; level: number }[];
  perks: GuildPerks;
  builtCount: number;
  /** `true` quand le lecteur peut rejoindre cette guilde tout de suite. */
  canJoin: boolean;
};

/**
 * Fiche publique d'une guilde.
 *
 * Tout est visible sauf le montant du trésor, réservé aux membres : c'est la caisse
 * commune, l'exposer inviterait à cibler les guildes riches en guerre de clans.
 */
export async function getGuildProfile(
  guildId: string,
  rpgGuildId: string,
  viewerId: string,
): Promise<GuildProfileView | null> {
  const [profile, rpgGuild] = await Promise.all([
    prisma.rpgProfile.findUnique({
      where: { guildId_userId: { guildId, userId: viewerId } },
      select: { rpgGuildId: true },
    }),
    prisma.rpgGuild.findUnique({
      where: { id: rpgGuildId },
      include: {
        members: { select: { userId: true, level: true }, orderBy: { level: 'desc' }, take: 30 },
        buildings: { select: { buildingId: true, level: true } },
        _count: { select: { members: true } },
      },
    }),
  ]);

  // Une guilde d'un autre serveur Discord n'existe pas pour ce lecteur : on répond
  // « introuvable » plutôt que d'en révéler l'existence.
  if (!rpgGuild || rpgGuild.guildId !== guildId) return null;

  const capacity = guildMemberCapacity(rpgGuild.level);
  const isMine = profile?.rpgGuildId === rpgGuild.id;
  const full = rpgGuild._count.members >= capacity;

  return {
    id: rpgGuild.id,
    name: rpgGuild.name,
    emoji: rpgGuild.emoji,
    description: rpgGuild.description,
    level: rpgGuild.level,
    ownerId: rpgGuild.ownerId,
    memberCount: rpgGuild._count.members,
    capacity,
    full,
    isMine,
    xp: rpgGuild.xp,
    xpNeeded: rpgGuildXpNeeded(rpgGuild.level),
    treasury: isMine ? rpgGuild.treasury : null,
    members: rpgGuild.members,
    perks: aggregateGuildPerks(rpgGuild.buildings),
    builtCount: rpgGuild.buildings.length,
    canJoin: !isMine && !full && !profile?.rpgGuildId,
  };
}

export type GuildEdit = {
  name?: string;
  description?: string;
  emoji?: string;
};

/**
 * Un emoji d'étendard tient en un seul glyphe.
 *
 * Discord refuse l'embed entier si l'emoji d'un champ est invalide : on préfère refuser
 * la saisie ici, avec un message clair, plutôt que de casser l'écran de guilde ensuite.
 * Le test compte les points de code visibles, séquences ZWJ et modificateurs compris.
 */
export function isSingleEmoji(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 16) return false;

  // Un emoji personnalisé Discord (`<:nom:id>`) est accepté tel quel.
  if (/^<a?:\w{2,32}:\d{17,20}>$/.test(trimmed)) return true;

  const graphemes = [...new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(trimmed)];
  if (graphemes.length !== 1) return false;

  return /\p{Extended_Pictographic}/u.test(trimmed);
}

/**
 * Valide une modification de fiche de guilde, pour le chef comme pour le dashboard.
 *
 * Renvoie seulement les champs à écrire : un champ omis n'est pas touché.
 */
export async function prepareGuildEdit(
  guildId: string,
  rpgGuild: { id: string; name: string },
  edit: GuildEdit,
): Promise<{ name?: string; description?: string | null; emoji?: string }> {
  const data: { name?: string; description?: string | null; emoji?: string } = {};

  if (edit.name !== undefined) {
    const cleanName = edit.name.trim();
    if (cleanName.length < RPG_GUILD_NAME_MIN || cleanName.length > RPG_GUILD_NAME_MAX) {
      throw new Error(`Le nom de la guilde doit faire entre ${RPG_GUILD_NAME_MIN} et ${RPG_GUILD_NAME_MAX} caractères.`);
    }

    if (cleanName.toLowerCase() !== rpgGuild.name.toLowerCase()) {
      // Même contrôle qu'à la création : l'unicité en base est sensible à la casse, la
      // recherche par nom ne l'est pas. Sans ça, « Les Loups » et « les loups »
      // coexisteraient et rejoindre l'une reviendrait à tomber sur l'autre.
      const twin = await prisma.rpgGuild.findFirst({
        where: { guildId, name: { equals: cleanName, mode: 'insensitive' }, id: { not: rpgGuild.id } },
      });
      if (twin) throw new Error(`Une guilde se nomme déjà « ${twin.name} ».`);
    }

    data.name = cleanName;
  }

  if (edit.description !== undefined) {
    const cleanDescription = edit.description.trim();
    if (cleanDescription.length > RPG_GUILD_DESCRIPTION_MAX) {
      throw new Error(`La description ne peut pas dépasser ${RPG_GUILD_DESCRIPTION_MAX} caractères.`);
    }
    data.description = cleanDescription || null;
  }

  if (edit.emoji !== undefined && edit.emoji.trim().length > 0) {
    const cleanEmoji = edit.emoji.trim();
    if (!isSingleEmoji(cleanEmoji)) {
      throw new Error("L'étendard doit être un seul emoji.");
    }
    data.emoji = cleanEmoji;
  }

  return data;
}

/**
 * Modifie le nom, la description ou l'étendard de sa guilde.
 *
 * Réservé au chef : le nom et l'étendard sont l'identité commune, les laisser à n'importe
 * quel membre ferait de chaque départ fâché un renommage.
 */
export async function editRpgGuild(guildId: string, userId: string, edit: GuildEdit) {
  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { rpgGuildId: true },
  });
  if (!profile?.rpgGuildId) throw new Error("Vous n'appartenez à aucune guilde.");

  const rpgGuild = await prisma.rpgGuild.findUnique({ where: { id: profile.rpgGuildId } });
  if (!rpgGuild) throw new Error('Guilde introuvable.');
  if (rpgGuild.ownerId !== userId) throw new Error('Seul le chef de guilde peut modifier la fiche.');

  const data = await prepareGuildEdit(guildId, rpgGuild, edit);
  if (Object.keys(data).length === 0) {
    throw new Error("Rien à modifier : laissez au moins un champ rempli.");
  }

  return prisma.rpgGuild.update({ where: { id: rpgGuild.id }, data });
}
