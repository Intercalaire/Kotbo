/** Outils MCP - read economy (permission READ_ECONOMY). */
import prisma from '../../../utils/db.js';
import { z } from 'zod';
import { type McpToolContext, err, ok, resolveMember } from '../toolkit.js';
import { withModuleFlags } from '../../../services/features/rpg/rpgEconomyConfigService.js';

export function registerReadEconomyTools(ctx: McpToolContext) {
  const { server, guildId, shouldRegister, guard, toolMeta } = ctx;

  if (shouldRegister('READ_ECONOMY')) {
    server.registerTool(
      'get_economy_config',
      {
        description: "Récupère la configuration complète de l'économie et du RPG (monnaie, modules, boutique, marché noir, raid, difficultés).",
        inputSchema: {},
        _meta: toolMeta,
      },
      guard('READ_ECONOMY', async () => {
        const config = await prisma.economyConfig.findUnique({ where: { guildId } });
        if (!config) return err("Aucune configuration d'économie trouvée pour ce serveur.");

        // La configuration entière, comme la lit le dashboard : l'outil n'en exposait que
        // six champs, et un agent ne pouvait rien dire du RPG, de la boutique, du marché
        // noir ni du raid.
        const { guildId: _guildId, ...settings } = await withModuleFlags(guildId, config);
        return ok(settings);
      })
    );

    server.registerTool(
      'get_rpg_profile',
      {
        description: "Récupère le profil RPG d'un membre (solde, niveau, stats de base, classe, points, équipement complet, inventaire).",
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
            rpgGuild: { select: { id: true, name: true, level: true } },
            inventory: {
              where: { quantity: { gt: 0 } },
              include: { item: { select: { id: true, name: true, type: true } } },
              orderBy: { item: { name: 'asc' } },
            },
          },
        });

        if (!profile) return err('Aucun profil RPG trouvé pour ce membre.');

        // Les trois emplacements d'accessoire manquaient : un joueur qui en portait
        // paraissait moins équipé qu'il ne l'est en combat.
        const slots = {
          weapon: profile.weaponId,
          armor: profile.armorId,
          accessory1: profile.accessoryId,
          accessory2: profile.accessory2Id,
          accessory3: profile.accessory3Id,
        };
        const equipIds = Object.values(slots).filter((id): id is string => Boolean(id));
        const equipItems = equipIds.length > 0
          ? await prisma.rpgItem.findMany({
            where: { id: { in: equipIds } },
            select: { id: true, name: true, type: true, atkBonus: true, defBonus: true, spdBonus: true, hpBonus: true },
          })
          : [];
        const equipOf = new Map(equipItems.map((i) => [i.id, i]));
        const equipment = Object.fromEntries(
          Object.entries(slots).map(([slot, id]) => [slot, id ? equipOf.get(id) ?? null : null]),
        );

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
          className: profile.className,
          statPoints: profile.statPoints,
          skillPoints: profile.skillPoints,
          isTraveling: profile.isTraveling,
          travelDestination: profile.travelDestination,
          equipment,
          guild: profile.rpgGuild ? { id: profile.rpgGuild.id, name: profile.rpgGuild.name, level: profile.rpgGuild.level } : null,
          inventory: profile.inventory.map((i) => ({
            itemId: i.item.id,
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
        description: 'Liste les objets du RPG que ce serveur utilise : les siens et ceux du catalogue livré de base.',
        inputSchema: {
          type: z.string().optional().describe("Filtre par type d'objet (WEAPON, ARMOR, POTION, etc.)"),
          purchasable_only: z.boolean().default(true).describe('Ne retourner que les objets vendus en boutique (faux pour inclure butins, matériaux et récompenses)'),
          scope: z.enum(['all', 'guild', 'global']).default('all').describe('Objets du serveur, du catalogue livré, ou les deux'),
        },
        _meta: toolMeta,
      },
      guard('READ_ECONOMY', async ({ type, purchasable_only, scope }) => {
        // L'outil ne listait que les objets créés par le serveur : le catalogue livré, qui
        // est l'essentiel de la boutique, restait invisible, et avec lui les identifiants
        // dont un agent a besoin pour donner un objet ou composer une recette.
        const owner = scope === 'guild' ? { guildId } : scope === 'global' ? { guildId: null } : { OR: [{ guildId: null }, { guildId }] };
        const items = await prisma.rpgItem.findMany({
          where: {
            ...owner,
            ...(type ? { type } : {}),
            ...(purchasable_only ? { purchasable: true } : {}),
          },
          orderBy: [{ type: 'asc' }, { price: 'asc' }],
        });

        return ok(
          items.map((item) => ({
            id: item.id,
            scope: item.guildId === null ? 'GLOBAL' : 'GUILD',
            name: item.name,
            emoji: item.emoji,
            description: item.description,
            type: item.type,
            rarity: item.rarity,
            levelRequired: item.levelRequired,
            price: item.price,
            purchasable: item.purchasable,
            blackMarketEligible: item.blackMarketEligible,
            atkBonus: item.atkBonus,
            defBonus: item.defBonus,
            spdBonus: item.spdBonus,
            hpBonus: item.hpBonus,
            hpRestore: item.hpRestore,
            energyRestore: item.energyRestore,
            levelXpReward: item.levelXpReward,
            clanPointsReward: item.clanPointsReward,
            raidAssaultBonus: item.raidAssaultBonus,
            enchantId: item.enchantId,
            enchantTier: item.enchantId ? item.enchantTier : null,
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
