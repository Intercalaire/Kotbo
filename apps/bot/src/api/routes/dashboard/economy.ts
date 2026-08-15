import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { resolveMemberAvatarUrl } from '../../../services/moderation/memberIdentityService.js';
import { logger } from '../../../utils/logger.js';
import { getOrCreateEconomyConfig, adminDeleteShopItem } from '../../../services/features/economyService.js';
import { json, readJsonBody, getGuildName, pushAudit, type AuthClaims, type DashboardAccess } from '../../shared.js';
import {
  clampInt,
  DISCOUNT_RANGE,
  DURATION_MIN_RANGE,
  INTERVAL_DAYS_RANGE,
  MAX_QUANTITY_RANGE,
  OFFER_COUNT_RANGE,
} from '../../../services/features/rpg/rpgBlackMarketPolicy.js';

const BLACK_MARKET_ANNOUNCE_MODES = new Set(['NONE', 'CHANNEL', 'CHANNEL_ROLE']);

/** Applique les bornes du marché noir sans écraser un champ que le client n'a pas envoyé. */
function clampOptional(value: number | undefined, range: { min: number; max: number }): number | undefined {
  return value === undefined ? undefined : clampInt(value, range, range.min);
}

interface LocalPlayerProfile {
  userId: string;
  balance: number;
  level: number;
  xp: number;
  health: number;
  energy: number;
  attack: number;
  defense: number;
  speed: number;
  weaponId?: string | null;
  armorId?: string | null;
  rpgGuild?: unknown;
}

export async function handleEconomyRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  client: Client,
  user: AuthClaims,
  guildId: string,
  _access: DashboardAccess
): Promise<boolean> {
  const method = req.method;
  const auditUser = `${user.username} (${user.userId})`;
  
  // parts[4] === 'economy'
  const subAction = parts[5]; // config | items | players

  // 1. Economy Configuration Routes
  if (subAction === 'config') {
    // GET /api/dashboard/guilds/:guildId/economy/config
    if (parts.length === 6 && method === 'GET') {
      try {
        const config = await getOrCreateEconomyConfig(guildId);
        json(res, 200, { config });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching economy config:', err);
        json(res, 500, { error: "Erreur lors de la récupération de la configuration de l'économie." });
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/economy/config
    if (parts.length === 6 && method === 'PATCH') {
      try {
        const body = await readJsonBody<{
          enabled?: boolean;
          rpgEnabled?: boolean;
          guildsEnabled?: boolean;
          shopEnabled?: boolean;
          currencyName?: string;
          currencyEmoji?: string;
          currencyIcon?: string | null;
          dailyRewardMin?: number;
          dailyRewardMax?: number;
          dailyCooldownHour?: number;
          adventureCooldownMin?: number;
          maxEnergy?: number;
          energyRecoveryPerHour?: number;
          maxBetAmount?: number;
          maxDailyBets?: number;
          maxTransferAmount?: number;
          transferCooldownMin?: number;
          blackMarketEnabled?: boolean;
          blackMarketIntervalDays?: number;
          blackMarketDurationMin?: number;
          blackMarketOfferCount?: number;
          blackMarketMaxQuantity?: number;
          blackMarketDiscountMin?: number;
          blackMarketDiscountMax?: number;
          blackMarketAnnounce?: string;
          blackMarketChannelId?: string | null;
          blackMarketRoleId?: string | null;
        }>(req);

        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        if (body.blackMarketAnnounce !== undefined && !BLACK_MARKET_ANNOUNCE_MODES.has(body.blackMarketAnnounce)) {
          json(res, 400, { error: "Mode d'annonce du marché noir invalide." });
          return true;
        }

        // Un mode d'annonce sans destinataire produirait un marché noir « annoncé » qui
        // ne s'annonce jamais : on refuse la combinaison au lieu de la laisser passer.
        const current = await getOrCreateEconomyConfig(guildId);
        const announceMode = body.blackMarketAnnounce ?? current.blackMarketAnnounce;
        const announceChannel = body.blackMarketChannelId !== undefined ? body.blackMarketChannelId : current.blackMarketChannelId;
        const announceRole = body.blackMarketRoleId !== undefined ? body.blackMarketRoleId : current.blackMarketRoleId;
        if (announceMode !== 'NONE' && !announceChannel) {
          json(res, 400, { error: "Sélectionnez un salon d'annonce pour le marché noir." });
          return true;
        }
        if (announceMode === 'CHANNEL_ROLE' && !announceRole) {
          json(res, 400, { error: 'Sélectionnez un rôle à mentionner pour le marché noir.' });
          return true;
        }

        const config = await prisma.economyConfig.update({
          where: { guildId },
          data: {
            enabled: body.enabled,
            rpgEnabled: body.rpgEnabled,
            guildsEnabled: body.guildsEnabled,
            shopEnabled: body.shopEnabled,
            currencyName: body.currencyName,
            currencyEmoji: body.currencyEmoji,
            currencyIcon: body.currencyIcon,
            dailyRewardMin: body.dailyRewardMin,
            dailyRewardMax: body.dailyRewardMax,
            dailyCooldownHour: body.dailyCooldownHour,
            adventureCooldownMin: body.adventureCooldownMin,
            maxEnergy: body.maxEnergy,
            energyRecoveryPerHour: body.energyRecoveryPerHour,
            maxBetAmount: body.maxBetAmount,
            maxDailyBets: body.maxDailyBets,
            maxTransferAmount: body.maxTransferAmount,
            transferCooldownMin: body.transferCooldownMin,
            blackMarketEnabled: body.blackMarketEnabled,
            // Les bornes sont celles qu'applique le tirage : les faire respecter ici évite
            // qu'une saisie aberrante ne soit silencieusement corrigée à chaque ouverture.
            blackMarketIntervalDays: clampOptional(body.blackMarketIntervalDays, INTERVAL_DAYS_RANGE),
            blackMarketDurationMin: clampOptional(body.blackMarketDurationMin, DURATION_MIN_RANGE),
            blackMarketOfferCount: clampOptional(body.blackMarketOfferCount, OFFER_COUNT_RANGE),
            blackMarketMaxQuantity: clampOptional(body.blackMarketMaxQuantity, MAX_QUANTITY_RANGE),
            blackMarketDiscountMin: clampOptional(body.blackMarketDiscountMin, DISCOUNT_RANGE),
            blackMarketDiscountMax: clampOptional(body.blackMarketDiscountMax, DISCOUNT_RANGE),
            blackMarketAnnounce: body.blackMarketAnnounce,
            blackMarketChannelId: body.blackMarketChannelId,
            blackMarketRoleId: body.blackMarketRoleId
          }
        });

        // Also sync the main Guild model toggle
        if (body.enabled !== undefined) {
          await prisma.guild.update({
            where: { id: guildId },
            data: { economyEnabled: body.enabled }
          });
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Mise à jour configuration Économie',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `Config éco mise à jour. Économie active: ${config.enabled}, RPG: ${config.rpgEnabled}`,
          channelId: null
        });

        json(res, 200, { config });
      } catch (err) {
        logger.error('EconomyAPI', 'Error updating economy config:', err);
        json(res, 500, { error: "Erreur lors de la mise à jour de la configuration de l'économie." });
      }
      return true;
    }
  }

  // 2. Shop Items Routes
  if (subAction === 'items') {
    // GET /api/dashboard/guilds/:guildId/economy/items
    if (parts.length === 6 && method === 'GET') {
      try {
        const items = await prisma.rpgItem.findMany({
          where: {
            OR: [
              { guildId: null },
              { guildId }
            ]
          },
          orderBy: { price: 'asc' }
        });
        json(res, 200, { items });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching shop items:', err);
        json(res, 500, { error: 'Erreur lors de la récupération des objets de la boutique.' });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/economy/items (Create/Update Item)
    if (parts.length === 6 && method === 'POST') {
      try {
        const body = await readJsonBody<{
          id?: string;
          name: string;
          description: string;
          emoji?: string;
          type: 'WEAPON' | 'ARMOR' | 'POTION' | 'QUEST';
          atkBonus?: number;
          defBonus?: number;
          spdBonus?: number;
          hpRestore?: number;
          energyRestore?: number;
          price: number;
          purchasable?: boolean;
        }>(req);

        if (!body || !body.name || !body.type || body.price === undefined) {
          json(res, 400, { error: 'Champs obligatoires manquants.' });
          return true;
        }

        let item;
        if (body.id) {
          // Update
          item = await prisma.rpgItem.update({
            where: { id: body.id },
            data: {
              name: body.name,
              description: body.description,
              emoji: body.emoji ?? '📦',
              type: body.type,
              atkBonus: body.atkBonus ?? 0,
              defBonus: body.defBonus ?? 0,
              spdBonus: body.spdBonus ?? 0,
              hpRestore: body.hpRestore ?? 0,
              energyRestore: body.energyRestore ?? 0,
              price: body.price,
              purchasable: body.purchasable ?? true
            }
          });
        } else {
          // Create
          item = await prisma.rpgItem.create({
            data: {
              guildId,
              name: body.name,
              description: body.description,
              emoji: body.emoji ?? '📦',
              type: body.type,
              atkBonus: body.atkBonus ?? 0,
              defBonus: body.defBonus ?? 0,
              spdBonus: body.spdBonus ?? 0,
              hpRestore: body.hpRestore ?? 0,
              energyRestore: body.energyRestore ?? 0,
              price: body.price,
              purchasable: body.purchasable ?? true
            }
          });
        }

        await pushAudit(guildId, {
          user: auditUser,
          action: body.id ? 'Modification objet boutique' : 'Création objet boutique',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `Objet: ${body.name} (${body.type}) - Prix: ${body.price}`,
          channelId: null
        });

        json(res, 200, { item });
      } catch (err) {
        logger.error('EconomyAPI', 'Error saving shop item:', err);
        json(res, 500, { error: "Erreur lors de la sauvegarde de l'objet." });
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/economy/items/:itemId
    if (parts.length === 7 && method === 'DELETE') {
      const itemId = parts[6];
      try {
        const { item, unequippedCount } = await adminDeleteShopItem(guildId, itemId);

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression objet boutique',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `Objet ${item.name} supprimé.${unequippedCount > 0 ? ` Déséquipé de ${unequippedCount} profil(s).` : ''}`,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        if (err instanceof Error && err.message === 'Objet introuvable.') {
          json(res, 404, { error: err.message });
          return true;
        }
        if (err instanceof Error && err.message.startsWith('Vous ne pouvez supprimer')) {
          json(res, 403, { error: err.message });
          return true;
        }
        logger.error('EconomyAPI', 'Error deleting shop item:', err);
        json(res, 500, { error: "Erreur lors de la suppression de l'objet." });
      }
      return true;
    }
  }

  // 3. Players / Profiles Routes
  if (subAction === 'players') {
    // GET /api/dashboard/guilds/:guildId/economy/players
    if (parts.length === 6 && method === 'GET') {
      try {
        const players = await prisma.rpgProfile.findMany({
          where: { guildId },
          include: { rpgGuild: true },
          orderBy: { balance: 'desc' }
        });

        const items = await prisma.rpgItem.findMany({
          where: { OR: [{ guildId: null }, { guildId }] }
        });

        // Resolve Discord tags/usernames from cache if possible
        const discordGuild = client.guilds.cache.get(guildId);
        const playerDetails = players.map((player: unknown) => {
          const p = player as LocalPlayerProfile;
          const member = discordGuild?.members.cache.get(p.userId);
          const weapon = items.find(i => i.id === p.weaponId);
          const armor = items.find(i => i.id === p.armorId);
          return {
            ...p,
            username: member?.user?.username ?? `Utilisateur ${p.userId}`,
            displayName: member?.displayName ?? `Utilisateur ${p.userId}`,
            avatarUrl: resolveMemberAvatarUrl(member, 128),
            weapon: weapon ? { name: weapon.name, emoji: weapon.emoji, atkBonus: weapon.atkBonus } : null,
            armor: armor ? { name: armor.name, emoji: armor.emoji, defBonus: armor.defBonus } : null
          };
        });

        json(res, 200, { players: playerDetails });
      } catch (err) {
        logger.error('EconomyAPI', 'Error fetching players:', err);
        json(res, 500, { error: 'Erreur lors de la récupération des joueurs.' });
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/economy/players/:userId
    if (parts.length === 7 && method === 'PATCH') {
      const targetUserId = parts[6];
      try {
        const body = await readJsonBody<{
          balance?: number;
          level?: number;
          xp?: number;
          health?: number;
          energy?: number;
          attack?: number;
          defense?: number;
          speed?: number;
        }>(req);

        if (!body) {
          json(res, 400, { error: 'Corps de requête manquant.' });
          return true;
        }

        const profile = await prisma.rpgProfile.findUnique({
          where: { guildId_userId: { guildId, userId: targetUserId } }
        });

        if (!profile) {
          json(res, 404, { error: 'Profil RPG introuvable pour cet utilisateur.' });
          return true;
        }

        const updatedProfile = await prisma.rpgProfile.update({
          where: { id: profile.id },
          data: {
            balance: body.balance,
            level: body.level,
            xp: body.xp,
            health: body.health,
            energy: body.energy,
            attack: body.attack,
            defense: body.defense,
            speed: body.speed
          }
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Modification profil RPG joueur',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `Modifié joueur ${targetUserId}. Solde: ${updatedProfile.balance}, Niveau: ${updatedProfile.level}`,
          channelId: null
        });

        json(res, 200, { player: updatedProfile });
      } catch (err) {
        logger.error('EconomyAPI', 'Error updating player profile:', err);
        json(res, 500, { error: 'Erreur lors de la mise à jour du profil du joueur.' });
      }
      return true;
    }
  }

  // 4. Reset Economy Route
  if (subAction === 'reset') {
    // POST /api/dashboard/guilds/:guildId/economy/reset
    if (parts.length === 6 && method === 'POST') {
      try {
        const body = await readJsonBody<{
          component: 'all' | 'profiles' | 'items' | 'config' | 'guilds';
        }>(req);

        if (!body || !body.component) {
          json(res, 400, { error: 'Composant de réinitialisation manquant.' });
          return true;
        }

        const { adminResetGuildEconomy } = await import('../../../services/features/economyService.js');
        await adminResetGuildEconomy(guildId, body.component);

        const componentLabels: Record<string, string> = {
          all: 'Global (tout réinitialiser)',
          profiles: 'Profils des joueurs',
          items: 'Objets de la boutique',
          config: 'Configuration',
          guilds: 'Guildes RPG'
        };

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Réinitialisation Économie/RPG',
          context: getGuildName(client, guildId),
          module: 'Économie',
          eventType: 'Manuel',
          details: `Composant réinitialisé : ${componentLabels[body.component] || body.component}`,
          channelId: null
        });

        json(res, 200, { success: true });
      } catch (err) {
        logger.error('EconomyAPI', 'Error resetting guild economy:', err);
        json(res, 500, { error: "Erreur lors de la réinitialisation de l'économie." });
      }
      return true;
    }
  }

  return false;
}
