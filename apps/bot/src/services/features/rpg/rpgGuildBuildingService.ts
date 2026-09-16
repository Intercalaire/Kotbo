/**
 * Construction et lecture du village d'une guilde.
 *
 * Le trésor est commun : bâtir le débite, et l'avantage obtenu profite à tous les membres.
 * Seul le chef de guilde peut bâtir — à plusieurs décideurs, le premier arrivé viderait le
 * trésor sans que personne n'ait son mot à dire.
 */

import prisma from '../../../utils/db.js';
import {
  NO_GUILD_PERKS,
  RPG_GUILD_BUILDINGS,
  aggregateGuildPerks,
  currentTier,
  getGuildBuilding,
  maxBuildingLevel,
  nextTier,
  type BuildingTier,
  type GuildBuilding,
  type GuildPerks,
} from './rpgGuildBuildings.js';

/** Un bâtiment tel que la guilde le voit : ce qu'il donne, et ce qu'il faut pour l'agrandir. */
export type BuildingView = {
  building: GuildBuilding;
  level: number;
  maxLevel: number;
  /** Effet actuellement actif, `null` tant que rien n'est bâti. */
  active: BuildingTier | null;
  /** Palier suivant, `null` quand le bâtiment est au maximum. */
  next: BuildingTier | null;
  /** `true` quand le palier suivant peut être payé immédiatement. */
  buildable: boolean;
  blockedBy: 'maxed' | 'guildLevel' | 'treasury' | null;
};

export type GuildVillageState = {
  rpgGuildId: string;
  guildName: string;
  guildEmoji: string;
  guildLevel: number;
  treasury: number;
  /** `true` quand le lecteur est le chef, seul habilité à bâtir. */
  isLeader: boolean;
  buildings: BuildingView[];
  perks: GuildPerks;
};

function viewFor(
  building: GuildBuilding,
  level: number,
  guildLevel: number,
  treasury: number,
): BuildingView {
  const next = nextTier(building, level);

  // L'ordre des refus est celui qui aide : « votre guilde est trop jeune » se règle en
  // jouant, « le trésor est vide » se règle en cotisant.
  let blockedBy: BuildingView['blockedBy'] = null;
  if (!next) blockedBy = 'maxed';
  else if (guildLevel < next.guildLevel) blockedBy = 'guildLevel';
  else if (treasury < next.cost) blockedBy = 'treasury';

  return {
    building,
    level,
    maxLevel: maxBuildingLevel(building),
    active: currentTier(building, level),
    next,
    buildable: blockedBy === null,
    blockedBy,
  };
}

export async function getGuildVillageState(rpgGuildId: string, viewerId: string): Promise<GuildVillageState> {
  const rpgGuild = await prisma.rpgGuild.findUnique({
    where: { id: rpgGuildId },
    include: { buildings: { select: { buildingId: true, level: true } } },
  });
  if (!rpgGuild) throw new Error('Guilde introuvable.');

  const levelById = new Map(rpgGuild.buildings.map((entry) => [entry.buildingId, entry.level]));

  return {
    rpgGuildId: rpgGuild.id,
    guildName: rpgGuild.name,
    guildEmoji: rpgGuild.emoji,
    guildLevel: rpgGuild.level,
    treasury: rpgGuild.treasury,
    isLeader: rpgGuild.ownerId === viewerId,
    buildings: RPG_GUILD_BUILDINGS.map((building) =>
      viewFor(building, levelById.get(building.id) ?? 0, rpgGuild.level, rpgGuild.treasury),
    ),
    perks: aggregateGuildPerks(rpgGuild.buildings),
  };
}

/**
 * Avantages du village d'un membre.
 *
 * Renvoie les avantages nuls pour qui n'est dans aucune guilde : c'est le cas courant, et
 * l'appelant ne doit pas avoir à distinguer « pas de guilde » de « village vide ».
 */
export async function loadGuildPerksForMember(guildId: string, userId: string): Promise<GuildPerks> {
  const profile = await prisma.rpgProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { rpgGuildId: true },
  });
  if (!profile?.rpgGuildId) return NO_GUILD_PERKS;

  return loadGuildPerks(profile.rpgGuildId);
}

/** Avantages d'un village, par identifiant de guilde RPG. */
export async function loadGuildPerks(rpgGuildId: string): Promise<GuildPerks> {
  const built = await prisma.rpgGuildBuilding.findMany({
    where: { rpgGuildId },
    select: { buildingId: true, level: true },
  });

  return aggregateGuildPerks(built);
}

export type BuildResult = {
  building: GuildBuilding;
  newLevel: number;
  tier: BuildingTier;
  cost: number;
  remainingTreasury: number;
};

/**
 * Bâtit ou agrandit un bâtiment, aux frais du trésor commun.
 *
 * Tout est revérifié ici : l'écran d'où vient le clic peut dater, et un autre membre a pu
 * vider le trésor entre-temps.
 */
export async function buildGuildBuilding(
  guildId: string,
  userId: string,
  buildingId: string,
): Promise<BuildResult> {
  const building = getGuildBuilding(buildingId);
  if (!building) throw new Error('Bâtiment inconnu.');

  return prisma.$transaction(async (tx) => {
    const profile = await tx.rpgProfile.findUnique({
      where: { guildId_userId: { guildId, userId } },
      select: { rpgGuildId: true },
    });
    if (!profile?.rpgGuildId) throw new Error("Vous n'appartenez à aucune guilde.");

    const rpgGuild = await tx.rpgGuild.findUnique({
      where: { id: profile.rpgGuildId },
      include: { buildings: { where: { buildingId }, select: { level: true } } },
    });
    if (!rpgGuild) throw new Error('Guilde introuvable.');

    if (rpgGuild.ownerId !== userId) {
      throw new Error('Seul le chef de guilde peut bâtir dans le village.');
    }

    const level = rpgGuild.buildings[0]?.level ?? 0;
    const tier = nextTier(building, level);
    if (!tier) {
      throw new Error(`${building.name} est déjà au niveau maximum (${maxBuildingLevel(building)}).`);
    }
    if (rpgGuild.level < tier.guildLevel) {
      throw new Error(
        `${building.name} niveau ${level + 1} demande une guilde de niveau ${tier.guildLevel}. La vôtre est niveau ${rpgGuild.level}.`,
      );
    }

    // Garde atomique sur le trésor : deux constructions simultanées ne peuvent pas être
    // payées une seule fois.
    const paid = await tx.rpgGuild.updateMany({
      where: { id: rpgGuild.id, treasury: { gte: tier.cost } },
      data: { treasury: { decrement: tier.cost } },
    });
    if (paid.count === 0) {
      throw new Error(`${building.name} niveau ${level + 1} coûte ${tier.cost} pièces. Le trésor en contient ${rpgGuild.treasury}.`);
    }

    const newLevel = level + 1;
    await tx.rpgGuildBuilding.upsert({
      where: { rpgGuildId_buildingId: { rpgGuildId: rpgGuild.id, buildingId } },
      create: { rpgGuildId: rpgGuild.id, buildingId, level: newLevel },
      update: { level: newLevel },
    });

    return {
      building,
      newLevel,
      tier,
      cost: tier.cost,
      remainingTreasury: rpgGuild.treasury - tier.cost,
    };
  });
}
