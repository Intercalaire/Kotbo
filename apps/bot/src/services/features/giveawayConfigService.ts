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
import type { Prisma } from '@prisma/client';
import prisma from '../../utils/db.js';
import {
  defaultAppearance,
  mergeAppearance,
  normalizeAppearancePatch,
  renderGiveawayText,
  type GiveawayAppearance,
} from './giveawayAppearance.js';
import { resolveGuildLocale, type BotLocale } from '../../utils/i18n.js';

/** Chances supplémentaires accordées aux porteurs d'un rôle. */
export type GiveawayBonusEntry = { roleId: string; weight: number };

export type GiveawayConfig = GiveawayAppearance & {
  guildId: string;
  /** Langue du serveur, resolue a la lecture : elle n'est pas une colonne. */
  locale: BotLocale;
  managerRoleIds: string[];
  requiredRoleIds: string[];
  blockedRoleIds: string[];
  minAccountAgeDays: number;
  minMemberAgeDays: number;
  minLevel: number;
  blockLinkedAccounts: boolean;
  bonusEntries: GiveawayBonusEntry[];
  clanBonusEnabled: boolean;
  clanBonusWeight: number;
  showBonusRoles: boolean;
  /** Salon proposé d'office au lancement, vide quand le serveur n'en fixe pas. */
  defaultChannelId: string | null;
};

/** Réglages d'un serveur qui n'a jamais ouvert l'onglet Configuration. */
export function defaultGiveawayConfig(guildId: string, locale: BotLocale): GiveawayConfig {
  return {
    guildId,
    locale,
    managerRoleIds: [],
    requiredRoleIds: [],
    blockedRoleIds: [],
    minAccountAgeDays: 0,
    minMemberAgeDays: 0,
    minLevel: 0,
    blockLinkedAccounts: false,
    bonusEntries: [],
    clanBonusEnabled: true,
    clanBonusWeight: 2,
    showBonusRoles: true,
    defaultChannelId: null,
    ...defaultAppearance(locale),
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

/** Identifiant de salon Discord, `null` dès qu'il n'est pas plausible. */
export function normalizeChannelId(value: unknown): string | null {
  return typeof value === 'string' && /^\d{17,20}$/.test(value) ? value : null;
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
  blockLinkedAccounts: boolean;
  bonusEntries: unknown;
  clanBonusEnabled: boolean;
  clanBonusWeight: number;
  showBonusRoles: boolean;
  defaultChannelId: string | null;
} & Record<string, unknown>;

function toConfig(row: GiveawayConfigRow, locale: BotLocale): GiveawayConfig {
  return {
    guildId: row.guildId,
    locale,
    managerRoleIds: row.managerRoleIds,
    requiredRoleIds: row.requiredRoleIds,
    blockedRoleIds: row.blockedRoleIds,
    minAccountAgeDays: row.minAccountAgeDays,
    minMemberAgeDays: row.minMemberAgeDays,
    minLevel: row.minLevel,
    blockLinkedAccounts: row.blockLinkedAccounts === true,
    bonusEntries: normalizeBonusEntries(row.bonusEntries),
    // `!== false` et non `=== true` : ces deux réglages sont actifs d'usine, et
    // une colonne lue avant sa migration ne doit pas les éteindre en silence.
    clanBonusEnabled: row.clanBonusEnabled !== false,
    clanBonusWeight: Number.isFinite(row.clanBonusWeight) ? row.clanBonusWeight : 2,
    showBonusRoles: row.showBonusRoles !== false,
    defaultChannelId: normalizeChannelId(row.defaultChannelId),
    // Une colonne de texte vide vaut « texte d'usine » : la fusion la remplace
    // par le gabarit de la langue du serveur.
    ...mergeAppearance(locale, normalizeAppearancePatch(row)),
  };
}

/**
 * Réglages du serveur, sans écriture : la lecture est sur le chemin de chaque
 * clic sur « Rejoindre », elle ne doit pas créer de ligne au passage.
 */
export async function getGiveawayConfig(guildId: string): Promise<GiveawayConfig> {
  const [config, locale] = await Promise.all([
    prisma.giveawayConfig.findUnique({ where: { guildId } }),
    resolveGuildLocale(guildId),
  ]);
  if (!config) return defaultGiveawayConfig(guildId, locale);
  return toConfig(config as unknown as GiveawayConfigRow, locale);
}

export type GiveawayConfigPatch = Partial<Omit<GiveawayConfig, 'guildId'>>;

export async function updateGiveawayConfig(
  guildId: string,
  patch: GiveawayConfigPatch,
  /**
   * Gabarits à remettre au texte d'usine. Les vider en base plutôt que d'y
   * recopier le texte courant garde le concours dans la langue du serveur,
   * même si celle-ci change plus tard.
   */
  resetToDefault: (keyof GiveawayAppearance)[] = [],
): Promise<GiveawayConfig> {
  // Une clef absente du patch ne doit pas écraser la colonne : un appel qui ne
  // porte que les rôles gestionnaires laisse l'apparence intacte.
  // `guildId` et `locale` sont ecartes : la page renvoie la configuration telle
  // qu'elle l'a recue, et ni l'identifiant ni la langue resolue ne sont des
  // colonnes que l'on met a jour ici.
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key !== 'guildId' && key !== 'locale' && value !== undefined) data[key] = value;
  }
  for (const key of resetToDefault) data[key] = null;

  const [config, locale] = await Promise.all([
    prisma.giveawayConfig.upsert({
      where: { guildId },
      create: { guildId, ...data } as Prisma.GiveawayConfigUncheckedCreateInput,
      update: data as Prisma.GiveawayConfigUncheckedUpdateInput,
    }),
    resolveGuildLocale(guildId),
  ]);

  return toConfig(config as unknown as GiveawayConfigRow, locale);
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
  /** Nom du serveur, seule donnée de contexte citable dans un refus. */
  guildName?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(date: Date): number {
  return (Date.now() - date.getTime()) / DAY_MS;
}

/**
 * Un refus est prononcé avant toute lecture du concours : le membre a pu cliquer
 * sur n'importe lequel. Seuls les seuils exigés et le nom du serveur sont donc
 * connus, et le reste des variables n'a rien à afficher.
 */
function denied(template: string, config: GiveawayConfig, guildName = ''): ParticipationCheck {
  return {
    allowed: false,
    reason: renderGiveawayText(template, {
      id: '',
      prize: '',
      winnerCount: 0,
      participantCount: 0,
      endsAt: new Date(),
      guildName,
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
export function evaluateParticipation(
  roleIds: string[],
  config: GiveawayConfig,
  guildName = '',
): ParticipationCheck {
  if (config.blockedRoleIds.length > 0 && hasAnyRole(roleIds, config.blockedRoleIds)) {
    return denied(config.deniedBlockedTemplate, config, guildName);
  }

  if (config.requiredRoleIds.length > 0 && !hasAnyRole(roleIds, config.requiredRoleIds)) {
    return denied(config.deniedRequiredTemplate, config, guildName);
  }

  return { allowed: true };
}

/**
 * Vrai si un réglage passant par `checkParticipation` est actif.
 *
 * Le repli des comptes liés n'en fait pas partie : il se joue au moment de
 * l'inscription, quand la liste des participants est sous verrou.
 */
export function hasParticipationRules(config: GiveawayConfig): boolean {
  return config.requiredRoleIds.length > 0
    || config.blockedRoleIds.length > 0
    || config.minAccountAgeDays > 0
    || config.minMemberAgeDays > 0
    || config.minLevel > 0;
}

/**
 * Refus opposé à un membre dont un autre compte participe déjà.
 *
 * Rend le texte et non une décision : l'appelant a déjà tranché, il n'a plus
 * qu'à répondre, et Discord refuse un message vide.
 */
export function deniedLinkedAccountText(config: GiveawayConfig, guildName = ''): string {
  const check = denied(config.deniedLinkedTemplate, config, guildName);
  return check.allowed ? config.deniedLinkedTemplate : check.reason;
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
  const guildName = participant.guildName ?? '';
  const roleCheck = evaluateParticipation(participant.roleIds, config, guildName);
  if (!roleCheck.allowed) return roleCheck;

  if (
    config.minAccountAgeDays > 0
    && participant.accountCreatedAt
    && daysSince(participant.accountCreatedAt) < config.minAccountAgeDays
  ) {
    return denied(config.deniedAccountAgeTemplate, config, guildName);
  }

  if (
    config.minMemberAgeDays > 0
    && participant.joinedAt
    && daysSince(participant.joinedAt) < config.minMemberAgeDays
  ) {
    return denied(config.deniedMemberAgeTemplate, config, guildName);
  }

  if (config.minLevel > 0) {
    const memberLevel = await prisma.memberLevel.findUnique({
      where: { guildId_userId: { guildId, userId: participant.userId } },
      select: { level: true },
    });
    if ((memberLevel?.level ?? 0) < config.minLevel) {
      return denied(config.deniedLevelTemplate, config, guildName);
    }
  }

  return { allowed: true };
}
