/**
 * Réglages des giveaways d'un serveur.
 *
 * Historiquement, lancer un concours exigeait « Gérer les messages » sur Discord
 * ou les droits d'administration du dashboard : impossible de confier les
 * giveaways à une équipe animation sans lui ouvrir la modération. Ce service
 * porte la liste des rôles gestionnaires, les conditions de participation, et
 * l'apparence que prennent les concours du serveur.
 */
import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import prisma from '../../utils/db.js';
import {
  DEFAULT_APPEARANCE,
  mergeAppearance,
  normalizeAppearancePatch,
  renderGiveawayText,
  type GiveawayAppearance,
} from './giveawayAppearance.js';

/** Chances supplémentaires accordées aux porteurs d'un rôle. */
export type GiveawayBonusEntry = { roleId: string; weight: number };

export type GiveawayConfig = GiveawayAppearance & {
  guildId: string;
  managerRoleIds: string[];
  requiredRoleIds: string[];
  blockedRoleIds: string[];
  minAccountAgeDays: number;
  minMemberAgeDays: number;
  minLevel: number;
  bonusEntries: GiveawayBonusEntry[];
};

/** Réglages d'un serveur qui n'a jamais ouvert l'onglet Configuration. */
function defaultConfig(guildId: string): GiveawayConfig {
  return {
    guildId,
    managerRoleIds: [],
    requiredRoleIds: [],
    blockedRoleIds: [],
    minAccountAgeDays: 0,
    minMemberAgeDays: 0,
    minLevel: 0,
    bonusEntries: [],
    ...DEFAULT_APPEARANCE,
  };
}

/** Poids maximal d'une entrée bonus : au-delà, le tirage n'a plus rien d'un tirage. */
const MAX_BONUS_WEIGHT = 10;

/** Ne garde que des identifiants Discord plausibles, dédoublonnés. */
export function normalizeRoleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.filter((entry): entry is string => typeof entry === 'string' && /^\d{17,20}$/.test(entry)),
  )];
}

/** Entier borné, utilisé par les conditions de participation. */
export function normalizeThreshold(value: unknown, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.trunc(parsed), 0), max);
}

/**
 * Un rôle ne figure qu'une fois : deux poids pour le même rôle rendraient le
 * tirage dépendant de l'ordre de saisie.
 */
export function normalizeBonusEntries(value: unknown): GiveawayBonusEntry[] {
  if (!Array.isArray(value)) return [];
  const byRole = new Map<string, number>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { roleId, weight } = entry as { roleId?: unknown; weight?: unknown };
    if (typeof roleId !== 'string' || !/^\d{17,20}$/.test(roleId)) continue;
    const parsed = typeof weight === 'number' ? weight : Number(weight);
    if (!Number.isFinite(parsed)) continue;
    const bounded = Math.min(Math.max(Math.trunc(parsed), 1), MAX_BONUS_WEIGHT);
    if (bounded <= 1) continue;
    byRole.set(roleId, bounded);
  }

  return [...byRole].map(([roleId, weight]) => ({ roleId, weight }));
}

type GiveawayConfigRow = {
  guildId: string;
  managerRoleIds: string[];
  requiredRoleIds: string[];
  blockedRoleIds: string[];
  minAccountAgeDays: number;
  minMemberAgeDays: number;
  minLevel: number;
  bonusEntries: unknown;
} & Record<string, unknown>;

function toConfig(row: GiveawayConfigRow): GiveawayConfig {
  return {
    guildId: row.guildId,
    managerRoleIds: row.managerRoleIds,
    requiredRoleIds: row.requiredRoleIds,
    blockedRoleIds: row.blockedRoleIds,
    minAccountAgeDays: row.minAccountAgeDays,
    minMemberAgeDays: row.minMemberAgeDays,
    minLevel: row.minLevel,
    bonusEntries: normalizeBonusEntries(row.bonusEntries),
    // La ligne porte les colonnes d'apparence : on repasse par la fusion pour
    // qu'une colonne vidée à la main en base retombe sur la valeur d'usine.
    ...mergeAppearance(normalizeAppearancePatch(row)),
  };
}

/**
 * Réglages du serveur, sans écriture : la lecture est sur le chemin de chaque
 * clic sur « Rejoindre », elle ne doit pas créer de ligne au passage.
 */
export async function getGiveawayConfig(guildId: string): Promise<GiveawayConfig> {
  const config = await prisma.giveawayConfig.findUnique({ where: { guildId } });
  if (!config) return defaultConfig(guildId);
  return toConfig(config as unknown as GiveawayConfigRow);
}

export type GiveawayConfigPatch = Partial<Omit<GiveawayConfig, 'guildId'>>;

export async function updateGiveawayConfig(
  guildId: string,
  patch: GiveawayConfigPatch,
): Promise<GiveawayConfig> {
  // Une clef absente du patch ne doit pas écraser la colonne : le dashboard
  // enregistre onglet par onglet, il n'envoie jamais la configuration entière.
  // `guildId` est écarté : la page renvoie la configuration telle qu'elle l'a
  // reçue, identifiant compris, et il ne doit jamais devenir modifiable.
  const data = Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => key !== 'guildId' && value !== undefined),
  );

  const config = await prisma.giveawayConfig.upsert({
    where: { guildId },
    update: data,
    create: { guildId, ...data },
  });

  return toConfig(config as unknown as GiveawayConfigRow);
}

/** Vrai si l'un des rôles configurés figure dans `roleIds`. */
export function hasAnyRole(roleIds: string[], configuredRoleIds: string[]): boolean {
  return configuredRoleIds.some((roleId) => roleIds.includes(roleId));
}

/**
 * Chances d'un membre dans le tirage.
 *
 * Le meilleur rôle l'emporte au lieu de s'additionner : cumuler ferait grimper
 * les chances d'un membre simplement parce qu'il collectionne les rôles, ce
 * qu'aucun réglage n'annonce.
 */
export function bonusWeightFor(roleIds: string[], entries: GiveawayBonusEntry[]): number {
  let weight = 1;
  for (const entry of entries) {
    if (roleIds.includes(entry.roleId) && entry.weight > weight) weight = entry.weight;
  }
  return weight;
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

/** Ce qu'on sait du membre au moment où il clique sur « Rejoindre ». */
export interface ParticipantSnapshot {
  userId: string;
  roleIds: string[];
  /** Création du compte Discord. */
  accountCreatedAt: Date | null;
  /** Arrivée sur le serveur, `null` quand Discord ne l'a pas transmise. */
  joinedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(date: Date): number {
  return (Date.now() - date.getTime()) / DAY_MS;
}

function denied(template: string, config: GiveawayConfig): ParticipationCheck {
  return {
    allowed: false,
    reason: renderGiveawayText(template, {
      id: '',
      prize: '',
      winnerCount: 0,
      participantCount: 0,
      endsAt: new Date(),
      minAccountAgeDays: config.minAccountAgeDays,
      minMemberAgeDays: config.minMemberAgeDays,
      minLevel: config.minLevel,
    }),
  };
}

/**
 * Filtre de participation par les rôles.
 *
 * Le blocage l'emporte sur l'autorisation : un rôle exclu le reste même s'il
 * porte aussi un rôle requis.
 */
export function evaluateParticipation(roleIds: string[], config: GiveawayConfig): ParticipationCheck {
  if (config.blockedRoleIds.length > 0 && hasAnyRole(roleIds, config.blockedRoleIds)) {
    return denied(config.deniedBlockedTemplate, config);
  }

  if (config.requiredRoleIds.length > 0 && !hasAnyRole(roleIds, config.requiredRoleIds)) {
    return denied(config.deniedRequiredTemplate, config);
  }

  return { allowed: true };
}

/** Vrai si un réglage de participation est actif, donc s'il faut vérifier quoi que ce soit. */
export function hasParticipationRules(config: GiveawayConfig): boolean {
  return config.requiredRoleIds.length > 0
    || config.blockedRoleIds.length > 0
    || config.minAccountAgeDays > 0
    || config.minMemberAgeDays > 0
    || config.minLevel > 0;
}

/**
 * Filtre de participation complet : rôles, ancienneté et niveau.
 *
 * L'ancienneté manquante laisse passer : Discord ne transmet pas toujours la
 * date d'arrivée, et refuser sur une donnée absente priverait de concours des
 * membres parfaitement éligibles.
 */
export async function checkParticipation(
  guildId: string,
  participant: ParticipantSnapshot,
  config: GiveawayConfig,
): Promise<ParticipationCheck> {
  const roleCheck = evaluateParticipation(participant.roleIds, config);
  if (!roleCheck.allowed) return roleCheck;

  if (
    config.minAccountAgeDays > 0
    && participant.accountCreatedAt
    && daysSince(participant.accountCreatedAt) < config.minAccountAgeDays
  ) {
    return denied(config.deniedAccountAgeTemplate, config);
  }

  if (
    config.minMemberAgeDays > 0
    && participant.joinedAt
    && daysSince(participant.joinedAt) < config.minMemberAgeDays
  ) {
    return denied(config.deniedMemberAgeTemplate, config);
  }

  if (config.minLevel > 0) {
    const memberLevel = await prisma.memberLevel.findUnique({
      where: { guildId_userId: { guildId, userId: participant.userId } },
      select: { level: true },
    });
    if ((memberLevel?.level ?? 0) < config.minLevel) {
      return denied(config.deniedLevelTemplate, config);
    }
  }

  return { allowed: true };
}
