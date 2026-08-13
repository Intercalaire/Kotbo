import { type Client, type GuildMember, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getRaidProtectionConfig } from './raidProtectionService.js';
import type { RaidProtectionConfig } from '@prisma/client';

// Le "server tag" (clan tag) est exposé par l'API via user.primary_guild.
// discord.js le mappe sur user.primaryGuild ({ identityGuildId, identityEnabled, tag }).
type UserWithPrimaryGuild = {
  primaryGuild?: {
    identityGuildId: string | null;
    identityEnabled: boolean | null;
    tag: string | null;
  } | null;
};

/** true si le membre arbore le tag de CE serveur sur son profil. */
export function memberDisplaysGuildTag(member: GuildMember): boolean {
  const primaryGuild = (member.user as unknown as UserWithPrimaryGuild).primaryGuild;
  return Boolean(primaryGuild?.identityEnabled && primaryGuild.identityGuildId === member.guild.id);
}

/**
 * Synchronise le rôle "tag" d'un membre : ajout s'il porte le tag du serveur,
 * retrait sinon. Retourne true si un changement a été appliqué.
 */
export async function syncMemberTagRole(member: GuildMember, config?: RaidProtectionConfig | null): Promise<boolean> {
  const cfg = config ?? (await getRaidProtectionConfig(member.guild.id));
  if (!cfg?.tagRoleEnabled || !cfg.tagRoleId) return false;
  if (member.user.bot) return false;

  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return false;

  const hasTag = memberDisplaysGuildTag(member);
  const hasRole = member.roles.cache.has(cfg.tagRoleId);

  try {
    if (hasTag && !hasRole) {
      await member.roles.add(cfg.tagRoleId, 'Tag du serveur affiché sur le profil');
      return true;
    }
    if (!hasTag && hasRole) {
      await member.roles.remove(cfg.tagRoleId, 'Tag du serveur retiré du profil');
      return true;
    }
  } catch (err) {
    logger.error('TagRole', `Sync du rôle tag impossible pour ${member.id} sur ${member.guild.id}`, err);
  }
  return false;
}

/** Rescan complet d'une guilde (commande admin) - retourne le nombre de changements. */
export async function rescanGuildTagRoles(client: Client, guildId: string): Promise<{ added: number; removed: number } | null> {
  const config = await getRaidProtectionConfig(guildId);
  if (!config?.tagRoleEnabled || !config.tagRoleId) return null;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  const members = await guild.members.fetch().catch(() => null);
  if (!members) return null;

  let added = 0;
  let removed = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const hadRole = member.roles.cache.has(config.tagRoleId);
    const changed = await syncMemberTagRole(member, config);
    if (changed) {
      if (hadRole) removed++;
      else added++;
    }
  }
  return { added, removed };
}
