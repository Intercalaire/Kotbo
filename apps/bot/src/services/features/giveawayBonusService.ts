/**
 * Chances supplémentaires d'un concours.
 *
 * Deux sources se rejoignent ici : les rôles avantagés réglés dans la page
 * Concours, et le bonus que la section Clans accorde au clan vainqueur de la
 * saison. La seconde était appliquée en dur au tirage, invisible depuis les
 * réglages des giveaways et cassée dès qu'une saison finissait sur une égalité :
 * `lastWinningClanId` porte alors plusieurs identifiants séparés par des
 * virgules, que l'ancienne recherche par identifiant unique ne retrouvait pas.
 */
import prisma from '../../utils/db.js';
import { cache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { bonusWeightFor, type GiveawayBonusEntry, type GiveawayConfig } from './giveawayConfigService.js';
import { generatedLabels } from './giveawayAppearance.js';
import type { BotLocale } from '../../utils/i18n.js';

/**
 * Les rôles des clans vainqueurs ne changent qu'à la clôture d'une saison, mais
 * la liste est relue à chaque clic sur « Rejoindre » pour redessiner l'embed.
 */
const CLAN_ROLES_TTL_SECONDS = 60;

/** Rôles des clans vainqueurs, vide quand la saison n'a pas désigné de gagnant. */
async function winningClanRoleIds(guildId: string): Promise<string[]> {
  const cacheKey = `giveaway:${guildId}:winning-clan-roles`;
  const cached = await cache.get<string[]>(cacheKey);
  if (cached) return cached;

  let roleIds: string[] = [];
  try {
    const guildSettings = await prisma.guild.findUnique({
      where: { id: guildId },
      select: { clanRewardGiveaway: true, lastWinningClanId: true },
    });

    if (guildSettings?.clanRewardGiveaway && guildSettings.lastWinningClanId) {
      // Plusieurs identifiants en cas d'ex æquo : la saison peut se terminer
      // sur une égalité, et tous les clans à égalité gardent leur bonus.
      const winnerIds = guildSettings.lastWinningClanId.split(',').map((id) => id.trim()).filter(Boolean);
      if (winnerIds.length > 0) {
        const winningClans = await prisma.clan.findMany({
          where: { id: { in: winnerIds } },
          select: { roleId: true },
        });
        roleIds = winningClans.map((clan) => clan.roleId).filter(Boolean);
      }
    }
  } catch (err) {
    logger.error('GiveawayService', `Rôles des clans vainqueurs illisibles sur ${guildId} :`, err);
    return [];
  }

  await cache.set(cacheKey, roleIds, CLAN_ROLES_TTL_SECONDS);
  return roleIds;
}

export interface ResolvedBonus {
  entries: GiveawayBonusEntry[];
}

/**
 * Chances effectives d'un concours : rôles réglés à la main, plus les clans
 * vainqueurs quand les deux sections l'autorisent.
 *
 * Un rôle présent des deux côtés garde son meilleur poids, comme deux rôles
 * portés par le même membre : nulle part les avantages ne se multiplient.
 */
export async function resolveGiveawayBonuses(
  guildId: string,
  config: GiveawayConfig,
  options: { ignoreBonuses?: boolean } = {},
): Promise<ResolvedBonus> {
  if (options.ignoreBonuses) return { entries: [] };

  const byRole = new Map<string, number>(config.bonusEntries.map((entry) => [entry.roleId, entry.weight]));

  if (config.clanBonusEnabled && config.clanBonusWeight > 1) {
    for (const roleId of await winningClanRoleIds(guildId)) {
      byRole.set(roleId, Math.max(byRole.get(roleId) ?? 1, config.clanBonusWeight));
    }
  }

  return { entries: [...byRole].map(([roleId, weight]) => ({ roleId, weight })) };
}

/** Chances d'un membre, à partir des bonus déjà résolus. */
export function weightForRoles(roleIds: string[], bonus: ResolvedBonus): number {
  return bonusWeightFor(roleIds, bonus.entries);
}

/**
 * Bloc « Chances supplémentaires » de l'embed, vide quand aucun rôle n'est
 * avantagé. Les rôles sont mentionnés plutôt que nommés : Discord les rend
 * alors avec leur couleur, et un rôle renommé reste juste. Les messages du
 * concours interdisent la mention de rôle, personne n'est donc notifié.
 */
export function buildBonusRolesBlock(bonus: ResolvedBonus, locale: BotLocale): string {
  if (bonus.entries.length === 0) return '';

  const lines = [...bonus.entries]
    .sort((a, b) => b.weight - a.weight)
    .map((entry) => `<@&${entry.roleId}> ×${entry.weight}`);

  return `\n**${generatedLabels(locale).bonusRolesTitle}**\n${lines.join('\n')}\n`;
}
