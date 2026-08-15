/**
 * Réglages des giveaways d'un serveur.
 *
 * Historiquement, lancer un concours exigeait « Gérer les messages » sur Discord
 * ou les droits d'administration du dashboard : impossible de confier les
 * giveaways à une équipe animation sans lui ouvrir la modération. Ce service
 * porte la liste des rôles gestionnaires, et les rôles autorisés ou exclus à la
 * participation.
 */
import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import prisma from '../../utils/db.js';

export type GiveawayConfig = {
  guildId: string;
  managerRoleIds: string[];
  requiredRoleIds: string[];
  blockedRoleIds: string[];
};

/** Réglages d'un serveur qui n'a jamais ouvert l'onglet Configuration. */
function defaultConfig(guildId: string): GiveawayConfig {
  return { guildId, managerRoleIds: [], requiredRoleIds: [], blockedRoleIds: [] };
}

/**
 * Réglages du serveur, sans écriture : la lecture est sur le chemin de chaque
 * clic sur « Rejoindre », elle ne doit pas créer de ligne au passage.
 */
export async function getGiveawayConfig(guildId: string): Promise<GiveawayConfig> {
  const config = await prisma.giveawayConfig.findUnique({ where: { guildId } });
  if (!config) return defaultConfig(guildId);

  return {
    guildId,
    managerRoleIds: config.managerRoleIds,
    requiredRoleIds: config.requiredRoleIds,
    blockedRoleIds: config.blockedRoleIds,
  };
}

/** Ne garde que des identifiants Discord plausibles, dédoublonnés. */
export function normalizeRoleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.filter((entry): entry is string => typeof entry === 'string' && /^\d{17,20}$/.test(entry)),
  )];
}

export async function updateGiveawayConfig(
  guildId: string,
  patch: Partial<Omit<GiveawayConfig, 'guildId'>>,
): Promise<GiveawayConfig> {
  const data = {
    ...(patch.managerRoleIds ? { managerRoleIds: patch.managerRoleIds } : {}),
    ...(patch.requiredRoleIds ? { requiredRoleIds: patch.requiredRoleIds } : {}),
    ...(patch.blockedRoleIds ? { blockedRoleIds: patch.blockedRoleIds } : {}),
  };

  const config = await prisma.giveawayConfig.upsert({
    where: { guildId },
    update: data,
    create: { guildId, ...data },
  });

  return {
    guildId,
    managerRoleIds: config.managerRoleIds,
    requiredRoleIds: config.requiredRoleIds,
    blockedRoleIds: config.blockedRoleIds,
  };
}

/** Vrai si l'un des rôles configurés figure dans `roleIds`. */
export function hasAnyRole(roleIds: string[], configuredRoleIds: string[]): boolean {
  return configuredRoleIds.some((roleId) => roleIds.includes(roleId));
}

/**
 * Droit de piloter les concours : créer, clôturer, relancer, supprimer.
 *
 * Les rôles gestionnaires s'ajoutent aux accès historiques, ils ne les
 * remplacent pas : un serveur qui n'a rien configuré continue de fonctionner
 * exactement comme avant.
 */
export async function canManageGiveaways(member: GuildMember | null, guildId: string): Promise<boolean> {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;

  const config = await getGiveawayConfig(guildId);
  return hasAnyRole([...member.roles.cache.keys()], config.managerRoleIds);
}

export type ParticipationCheck = { allowed: true } | { allowed: false; reason: string };

/**
 * Filtre de participation appliqué au clic sur « Rejoindre ».
 *
 * Le blocage l'emporte sur l'autorisation : un rôle exclu le reste même s'il
 * porte aussi un rôle requis.
 */
export function evaluateParticipation(roleIds: string[], config: GiveawayConfig): ParticipationCheck {
  if (config.blockedRoleIds.length > 0 && hasAnyRole(roleIds, config.blockedRoleIds)) {
    return { allowed: false, reason: "❌ L'un de tes rôles t'exclut des giveaways de ce serveur." };
  }

  if (config.requiredRoleIds.length > 0 && !hasAnyRole(roleIds, config.requiredRoleIds)) {
    return { allowed: false, reason: '❌ Tu n\'as pas le rôle requis pour participer aux giveaways de ce serveur.' };
  }

  return { allowed: true };
}
