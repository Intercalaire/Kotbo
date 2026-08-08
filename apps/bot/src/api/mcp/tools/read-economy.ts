/** Outils MCP - read economy (permission READ_ECONOMY). */
import prisma from '../../../utils/db.js';
import { z } from 'zod';
import { type McpToolContext, err, ok, resolveMember } from '../toolkit.js';

export function registerReadEconomyTools(ctx: McpToolContext) {
  const { server, guildId, shouldRegister, guard, toolMeta } = ctx;

  if (shouldRegister('READ_ECONOMY')) {
    server.registerTool(
      'get_economy_config',
      {
        description: "Récupère la configuration de l'économie du serveur (monnaie, récompenses, paramètres RPG).",
        inputSchema: {},
        _meta: toolMeta,
      },
      guard('READ_ECONOMY', async () => {
        const config = await prisma.economyConfig.findUnique({ where: { guildId } });
        if (!config) return err("Aucune configuration d'économie trouvée pour ce serveur.");

        return ok({
          currencyName: config.currencyName,
          currencyEmoji: config.currencyEmoji,
          dailyRewardMin: config.dailyRewardMin,
          dailyRewardMax: config.dailyRewardMax,
          maxEnergy: config.maxEnergy,
          energyRecoveryPerHour: config.energyRecoveryPerHour,
        });
      })
    );

    server.registerTool(
      'get_rpg_profile',
      {
        description: "Récupère le profil RPG d'un membre (solde, niveau, stats, équipement).",
        inputSchema: {
          member: z.string().describe('Nom, surnom, @mention ou ID Discord du membre'),
        },
        _meta: toolMeta,
      },
      guard('READ_ECONOMY', async ({ member }) => {
        const resolved = await resolveMember(guildId, member);
        if (!resolved.ok) return resolved.response;

        const profile = await prisma.rpgProfile.findUnique({
          where: { guildId_userId: { guildId, userId: resolved.userId } },
          include: {
            rpgGuild: { select: { name: true, level: true } },
            inventory: { include: { item: { select: { name: true, type: true } } }, take: 30 },
          },
        });

        if (!profile) return err('Aucun profil RPG trouvé pour ce membre.');

        const equipIds = [profile.weaponId, profile.armorId, profile.potionId].filter(Boolean) as string[];
        const equipItems = equipIds.length > 0
          ? await prisma.rpgItem.findMany({ where: { id: { in: equipIds } }, select: { id: true, name: true, type: true, atkBonus: true, defBonus: true, hpRestore: true } })
          : [];
        const equipOf = new Map(equipItems.map((i) => [i.id, i]));

        const weapon = profile.weaponId ? equipOf.get(profile.weaponId) : null;
        const armor = profile.armorId ? equipOf.get(profile.armorId) : null;
        const potion = profile.potionId ? equipOf.get(profile.potionId) : null;

        return ok({
          userId: resolved.userId,
          balance: profile.balance,
          level: profile.level,
          xp: profile.xp,
          health: profile.health,
          maxHealth: profile.maxHealth,
          energy: profile.energy,
          attack: profile.attack,
          defense: profile.defense,
          speed: profile.speed,
          isTraveling: profile.isTraveling,
          travelDestination: profile.travelDestination,
          weapon: weapon ? { name: weapon.name, atkBonus: weapon.atkBonus } : null,
          armor: armor ? { name: armor.name, defBonus: armor.defBonus } : null,
          potion: potion ? { name: potion.name, hpRestore: potion.hpRestore } : null,
          guild: profile.rpgGuild ? { name: profile.rpgGuild.name, level: profile.rpgGuild.level } : null,
          inventory: profile.inventory.map((i) => ({
            itemName: i.item.name,
            itemType: i.item.type,
            quantity: i.quantity,
          })),
        });
      })
    );

    server.registerTool(
      'get_rpg_leaderboard',
      {
        description: 'Classement économique par solde, niveau RPG ou XP RPG.',
        inputSchema: {
          by: z.enum(['balance', 'level', 'xp']).default('balance').describe('Critère du classement'),
          limit: z.number().int().min(1).max(50).default(10),
        },
        _meta: toolMeta,
      },
      guard('READ_ECONOMY', async ({ by, limit }) => {
        const rows = await prisma.rpgProfile.findMany({
          where: { guildId },
          orderBy: { [by]: 'desc' },
          take: limit,
          select: { userId: true, balance: true, level: true, xp: true },
        });

        const profiles = await prisma.memberProfile.findMany({
          where: { guildId, userId: { in: rows.map((r) => r.userId) } },
          select: { userId: true, username: true, displayName: true },
        });
        const nameOf = new Map(profiles.map((p) => [p.userId, p.displayName ?? p.username ?? p.userId]));

        return ok(
          rows.map((r, i) => ({
            rank: i + 1,
            userId: r.userId,
            name: nameOf.get(r.userId) ?? r.userId,
            balance: r.balance,
            level: r.level,
            xp: r.xp,
          }))
        );
      })
    );

    server.registerTool(
      'get_shop_items',
      {
        description: 'Liste les objets disponibles dans la boutique RPG.',
        inputSchema: {
          type: z.string().optional().describe("Filtre par type d'objet (WEAPON, ARMOR, POTION, etc.)"),
          purchasable_only: z.boolean().default(true).describe('Ne retourner que les objets achetables'),
        },
        _meta: toolMeta,
      },
      guard('READ_ECONOMY', async ({ type, purchasable_only }) => {
        const items = await prisma.rpgItem.findMany({
          where: {
            guildId,
            ...(type ? { type } : {}),
            ...(purchasable_only ? { purchasable: true } : {}),
          },
          orderBy: { price: 'asc' },
        });

        return ok(
          items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            type: item.type,
            price: item.price,
            purchasable: item.purchasable,
            atkBonus: item.atkBonus,
            defBonus: item.defBonus,
            hpRestore: item.hpRestore,
            energyRestore: item.energyRestore,
          }))
        );
      })
    );

    server.registerTool(
      'get_marketplace_listings',
      {
        description: 'Liste les offres actives du marché (ventes et enchères entre joueurs).',
        inputSchema: {
          type: z.enum(['FIXED_PRICE', 'AUCTION']).optional().describe("Type d'offre"),
          limit: z.number().int().min(1).max(50).default(20),
        },
        _meta: toolMeta,
      },
      guard('READ_ECONOMY', async ({ type, limit }) => {
        const listings = await prisma.marketplaceListing.findMany({
          where: {
            guildId,
            status: 'ACTIVE',
            ...(type ? { type } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        });

        const itemIds = [...new Set(listings.map((l) => l.itemId))];
        const sellerIds = [...new Set(listings.map((l) => l.sellerId))];

        const [items, profiles] = await Promise.all([
          prisma.rpgItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, name: true, type: true },
          }),
          prisma.memberProfile.findMany({
            where: { guildId, userId: { in: sellerIds } },
            select: { userId: true, username: true, displayName: true },
          }),
        ]);

        const itemOf = new Map(items.map((i) => [i.id, i]));
        const nameOf = new Map(profiles.map((p) => [p.userId, p.displayName ?? p.username ?? p.userId]));

        return ok(
          listings.map((l) => {
            const item = itemOf.get(l.itemId);
            return {
              id: l.id,
              type: l.type,
              status: l.status,
              itemName: item?.name ?? l.itemId,
              itemType: item?.type ?? null,
              quantity: l.quantity,
              price: l.price,
              currentBid: l.currentBid,
              sellerName: nameOf.get(l.sellerId) ?? l.sellerId,
              expiresAt: l.expiresAt?.toISOString() ?? null,
              createdAt: l.createdAt.toISOString(),
            };
          })
        );
      })
    );
  }
}
