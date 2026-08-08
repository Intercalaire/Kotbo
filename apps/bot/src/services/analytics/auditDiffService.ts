import {
  AuditLogEvent,
  PermissionsBitField,
  type Guild,
  type GuildAuditLogsEntry,
} from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';

/**
 * Interactive Audit Logger - capture des états avant/après et calcul des
 * différences structurées.
 *
 * Le service ne produit jamais de texte formaté : il renvoie des changements
 * décrits champ par champ, que le dashboard restitue en diff visuel. La logique
 * de comparaison est volontairement composée de fonctions pures, testables sans
 * base ni client Discord.
 */

// ============================================================================
// TYPES
// ============================================================================

export type AuditEventType =
  | 'MESSAGE_UPDATE'
  | 'MEMBER_UPDATE'
  | 'ROLE_UPDATE'
  | 'CHANNEL_UPDATE'
  | 'CHANNEL_PERMISSIONS_UPDATE';

export type AuditTargetType = 'MESSAGE' | 'MEMBER' | 'ROLE' | 'CHANNEL';

export type ChangeKind = 'added' | 'removed' | 'modified';

export interface AuditChange {
  /** Nom technique du champ, utilisé pour le filtrage */
  field: string;
  /** Libellé lisible affiché dans le dashboard */
  label: string;
  kind: ChangeKind;
  before?: unknown;
  after?: unknown;
  /** Éléments gagnés : rôles ajoutés, permissions accordées */
  added?: string[];
  /** Éléments perdus : rôles retirés, permissions refusées */
  removed?: string[];
  /** Permissions revenues à l'état hérité du salon parent */
  reset?: string[];
}

/** Description d'un champ scalaire à comparer entre deux états. */
export interface FieldSpec {
  key: string;
  label: string;
}

export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  'MESSAGE_UPDATE',
  'MEMBER_UPDATE',
  'ROLE_UPDATE',
  'CHANNEL_UPDATE',
  'CHANNEL_PERMISSIONS_UPDATE',
] as const;

// ============================================================================
// COMPARAISON (logique pure)
// ============================================================================

/**
 * Compare deux valeurs scalaires en traitant `null`, `undefined` et la chaîne
 * vide comme équivalents : Discord alterne entre les trois pour un même
 * « champ non renseigné », ce qui produirait sinon de faux changements.
 */
export function isSameScalar(before: unknown, after: unknown): boolean {
  const normalize = (value: unknown) => (value === null || value === undefined || value === '' ? null : value);
  return normalize(before) === normalize(after);
}

/**
 * Produit un changement par champ scalaire réellement modifié.
 * Les champs absents des deux états sont ignorés.
 */
export function diffScalarFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  specs: FieldSpec[],
): AuditChange[] {
  const changes: AuditChange[] = [];

  for (const spec of specs) {
    const previous = before[spec.key];
    const next = after[spec.key];
    if (isSameScalar(previous, next)) continue;

    changes.push({
      field: spec.key,
      label: spec.label,
      kind: previous === null || previous === undefined || previous === ''
        ? 'added'
        : next === null || next === undefined || next === ''
          ? 'removed'
          : 'modified',
      before: previous ?? null,
      after: next ?? null,
    });
  }

  return changes;
}

/** Éléments entrés et sortis entre deux listes, sans tenir compte de l'ordre. */
export function diffStringLists(
  before: string[] = [],
  after: string[] = [],
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  return {
    added: after.filter((item) => !beforeSet.has(item)),
    removed: before.filter((item) => !afterSet.has(item)),
  };
}

export type OverwriteState = 'allow' | 'deny' | 'inherit';

export interface PermissionOverwriteSnapshot {
  id: string;
  /** 'role' | 'member' */
  type: string;
  name: string;
  allow: string[];
  deny: string[];
}

/**
 * Reconstitue l'état tri-valué (autorisé / refusé / hérité) de chaque
 * permission d'un surclassement de salon.
 */
export function overwriteStateMap(overwrite: PermissionOverwriteSnapshot | null): Map<string, OverwriteState> {
  const states = new Map<string, OverwriteState>();
  if (!overwrite) return states;
  for (const permission of overwrite.allow) states.set(permission, 'allow');
  for (const permission of overwrite.deny) states.set(permission, 'deny');
  return states;
}

/**
 * Compare les surclassements de permissions d'un salon, cible par cible.
 *
 * Une permission passée à « autorisé » apparaît dans `added`, passée à
 * « refusé » dans `removed`, et revenue à l'héritage dans `reset` - ce qui
 * donne au dashboard de quoi rendre `+ SEND_MESSAGES` / `- ATTACH_FILES`.
 */
export function diffPermissionOverwrites(
  before: PermissionOverwriteSnapshot[] = [],
  after: PermissionOverwriteSnapshot[] = [],
): AuditChange[] {
  const beforeById = new Map(before.map((o) => [o.id, o]));
  const afterById = new Map(after.map((o) => [o.id, o]));
  const allIds = new Set([...beforeById.keys(), ...afterById.keys()]);

  const changes: AuditChange[] = [];

  for (const id of allIds) {
    const previous = beforeById.get(id) ?? null;
    const next = afterById.get(id) ?? null;

    const previousStates = overwriteStateMap(previous);
    const nextStates = overwriteStateMap(next);
    const permissions = new Set([...previousStates.keys(), ...nextStates.keys()]);

    const added: string[] = [];
    const removed: string[] = [];
    const reset: string[] = [];

    for (const permission of permissions) {
      const was = previousStates.get(permission) ?? 'inherit';
      const now = nextStates.get(permission) ?? 'inherit';
      if (was === now) continue;

      if (now === 'allow') added.push(permission);
      else if (now === 'deny') removed.push(permission);
      else reset.push(permission);
    }

    if (added.length === 0 && removed.length === 0 && reset.length === 0) continue;

    const target = next ?? previous;
    changes.push({
      field: `overwrite:${id}`,
      label: `Permissions - ${target?.type === 'member' ? '' : '@'}${target?.name ?? id}`,
      kind: previous === null ? 'added' : next === null ? 'removed' : 'modified',
      added: added.sort(),
      removed: removed.sort(),
      reset: reset.sort(),
    });
  }

  return changes;
}

/** Convertit un bitfield de permissions en liste de noms triés. */
export function permissionNames(bitfield: bigint | number): string[] {
  return new PermissionsBitField(BigInt(bitfield)).toArray().sort();
}

// ============================================================================
// LIBELLÉS DES CHAMPS
// ============================================================================

export const MESSAGE_FIELDS: FieldSpec[] = [
  { key: 'content', label: 'Contenu' },
  { key: 'pinned', label: 'Épinglé' },
  { key: 'embedCount', label: "Nombre d'intégrations" },
];

export const MEMBER_FIELDS: FieldSpec[] = [
  { key: 'nickname', label: 'Surnom' },
  { key: 'avatarUrl', label: 'Avatar de serveur' },
  { key: 'timeoutUntil', label: "Exclusion temporaire jusqu'à" },
  { key: 'pending', label: "En attente de l'écran d'accueil" },
];

export const ROLE_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Nom' },
  { key: 'color', label: 'Couleur' },
  { key: 'hoist', label: 'Affiché séparément' },
  { key: 'mentionable', label: 'Mentionnable' },
  { key: 'position', label: 'Position' },
];

export const CHANNEL_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Nom' },
  { key: 'topic', label: 'Sujet' },
  { key: 'nsfw', label: 'NSFW' },
  { key: 'rateLimitPerUser', label: 'Mode lent (s)' },
  { key: 'parentName', label: 'Catégorie' },
  { key: 'bitrate', label: 'Débit binaire' },
  { key: 'userLimit', label: "Limite d'utilisateurs" },
];

// ============================================================================
// CALCUL DES DIFFÉRENCES PAR TYPE D'ENTITÉ
// ============================================================================

export interface MessageSnapshot {
  content: string;
  pinned?: boolean;
  embedCount?: number;
  attachments?: string[];
}

export function diffMessages(before: MessageSnapshot, after: MessageSnapshot): AuditChange[] {
  const changes = diffScalarFields(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
    MESSAGE_FIELDS,
  );

  const attachments = diffStringLists(before.attachments, after.attachments);
  if (attachments.added.length > 0 || attachments.removed.length > 0) {
    changes.push({
      field: 'attachments',
      label: 'Pièces jointes',
      kind: 'modified',
      added: attachments.added,
      removed: attachments.removed,
    });
  }

  return changes;
}

export interface MemberSnapshot {
  nickname: string | null;
  avatarUrl: string | null;
  timeoutUntil: string | null;
  pending?: boolean;
  roles: { id: string; name: string }[];
}

export function diffMembers(before: MemberSnapshot, after: MemberSnapshot): AuditChange[] {
  const changes = diffScalarFields(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
    MEMBER_FIELDS,
  );

  // Les rôles sont comparés par identifiant mais restitués par nom : un rôle
  // renommé ne doit pas apparaître comme un ajout suivi d'un retrait.
  const nameById = new Map([...before.roles, ...after.roles].map((r) => [r.id, r.name]));
  const roles = diffStringLists(
    before.roles.map((r) => r.id),
    after.roles.map((r) => r.id),
  );

  if (roles.added.length > 0 || roles.removed.length > 0) {
    changes.push({
      field: 'roles',
      label: 'Rôles',
      kind: 'modified',
      added: roles.added.map((id) => nameById.get(id) ?? id),
      removed: roles.removed.map((id) => nameById.get(id) ?? id),
    });
  }

  return changes;
}

export interface RoleSnapshot {
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  position: number;
  permissions: string[];
}

export function diffRoles(before: RoleSnapshot, after: RoleSnapshot): AuditChange[] {
  const changes = diffScalarFields(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
    ROLE_FIELDS,
  );

  const permissions = diffStringLists(before.permissions, after.permissions);
  if (permissions.added.length > 0 || permissions.removed.length > 0) {
    changes.push({
      field: 'permissions',
      label: 'Permissions',
      kind: 'modified',
      added: permissions.added,
      removed: permissions.removed,
    });
  }

  return changes;
}

export interface ChannelSnapshot {
  name: string;
  topic?: string | null;
  nsfw?: boolean | null;
  rateLimitPerUser?: number | null;
  parentName?: string | null;
  bitrate?: number | null;
  userLimit?: number | null;
  overwrites: PermissionOverwriteSnapshot[];
}

export function diffChannels(before: ChannelSnapshot, after: ChannelSnapshot): AuditChange[] {
  return [
    ...diffScalarFields(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      CHANNEL_FIELDS,
    ),
    ...diffPermissionOverwrites(before.overwrites, after.overwrites),
  ];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface AuditLoggerConfig {
  guildId: string;
  enabled: boolean;
  retentionDays: number;
  captureMessages: boolean;
  captureMembers: boolean;
  captureRoles: boolean;
  captureChannels: boolean;
  ignoredChannelIds: string[];
  ignoredUserIds: string[];
}

export const DEFAULT_AUDIT_CONFIG: Omit<AuditLoggerConfig, 'guildId'> = {
  enabled: false,
  retentionDays: 90,
  captureMessages: true,
  captureMembers: true,
  captureRoles: true,
  captureChannels: true,
  ignoredChannelIds: [],
  ignoredUserIds: [],
};

const RETENTION_BOUNDS = { min: 0, max: 3650 };

export function sanitizeAuditConfigPatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const key of ['enabled', 'captureMessages', 'captureMembers', 'captureRoles', 'captureChannels'] as const) {
    if (typeof body[key] === 'boolean') patch[key] = body[key];
  }

  if (typeof body.retentionDays === 'number' && Number.isFinite(body.retentionDays)) {
    patch.retentionDays = Math.min(
      RETENTION_BOUNDS.max,
      Math.max(RETENTION_BOUNDS.min, Math.trunc(body.retentionDays)),
    );
  }

  for (const key of ['ignoredChannelIds', 'ignoredUserIds'] as const) {
    if (Array.isArray(body[key])) {
      patch[key] = (body[key] as unknown[])
        .filter((id): id is string => typeof id === 'string' && /^\d{5,25}$/.test(id))
        .slice(0, 200);
    }
  }

  return patch;
}

/** Cache court : les listeners consultent la config à chaque événement Discord. */
const configCache = new Map<string, { config: AuditLoggerConfig; expiresAt: number }>();
const CONFIG_TTL_MS = 60_000;

export async function getAuditConfig(guildId: string): Promise<AuditLoggerConfig> {
  const cached = configCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  const stored = await prisma.auditLoggerConfig.findUnique({ where: { guildId } });
  const config = (stored ?? { guildId, ...DEFAULT_AUDIT_CONFIG }) as AuditLoggerConfig;
  configCache.set(guildId, { config, expiresAt: Date.now() + CONFIG_TTL_MS });
  return config;
}

export async function upsertAuditConfig(
  guildId: string,
  patch: Record<string, unknown>,
): Promise<AuditLoggerConfig> {
  const config = await prisma.auditLoggerConfig.upsert({
    where: { guildId },
    create: { guildId, ...DEFAULT_AUDIT_CONFIG, ...patch },
    update: patch,
  });
  configCache.delete(guildId);
  return config as AuditLoggerConfig;
}

/** Réservé aux tests : purge le cache de configuration. */
export function __resetAuditConfigCache(): void {
  configCache.clear();
}

// ============================================================================
// ATTRIBUTION DE L'AUTEUR
// ============================================================================

/** Fenêtre au-delà de laquelle une entrée d'audit log n'est plus corrélée. */
const AUDIT_LOG_MATCH_WINDOW_MS = 10_000;

/**
 * Retrouve l'auteur d'une modification via l'audit log Discord.
 *
 * Discord ne fournit pas l'auteur dans les événements de mise à jour : il faut
 * corréler avec une entrée récente portant sur la même cible. Retourne `null`
 * quand le bot n'a pas la permission de lire l'audit log ou qu'aucune entrée ne
 * correspond - l'événement reste alors enregistré, simplement sans auteur.
 */
export async function resolveExecutor(
  guild: Guild,
  type: AuditLogEvent,
  targetId: string,
): Promise<{ id: string; name: string; reason: string | null } | null> {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find((candidate: GuildAuditLogsEntry) =>
      candidate.targetId === targetId
      && Date.now() - candidate.createdTimestamp < AUDIT_LOG_MATCH_WINDOW_MS);

    if (!entry?.executor) return null;
    const { id, tag, username } = entry.executor;
    return {
      id,
      name: tag || username || id,
      reason: entry.reason?.trim() || null,
    };
  } catch {
    // Permission ViewAuditLog absente : on continue sans attribution.
    return null;
  }
}

// ============================================================================
// PERSISTANCE
// ============================================================================

export interface RecordAuditEventInput {
  guildId: string;
  eventType: AuditEventType;
  targetType: AuditTargetType;
  targetId: string;
  targetName?: string | null;
  executorId?: string | null;
  executorName?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  before: unknown;
  after: unknown;
  changes: AuditChange[];
  reason?: string | null;
}

/**
 * Enregistre un événement d'audit. Sans changement détecté, rien n'est écrit :
 * Discord émet des mises à jour pour des propriétés qui ne nous intéressent pas.
 */
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<boolean> {
  if (input.changes.length === 0) return false;

  try {
    await prisma.auditEvent.create({
      data: {
        guildId: input.guildId,
        eventType: input.eventType,
        targetType: input.targetType,
        targetId: input.targetId,
        targetName: input.targetName ?? null,
        executorId: input.executorId ?? null,
        executorName: input.executorName ?? null,
        channelId: input.channelId ?? null,
        channelName: input.channelName ?? null,
        before: (input.before ?? null) as never,
        after: (input.after ?? null) as never,
        changes: input.changes as never,
        changedFields: input.changes.map((c) => c.field),
        reason: input.reason ?? null,
      },
    });
    return true;
  } catch (error) {
    logger.error('AuditLogger', `Échec de l'enregistrement d'un événement pour ${input.guildId}:`, error);
    return false;
  }
}

// ============================================================================
// RECHERCHE
// ============================================================================

export interface SearchAuditEventsOptions {
  eventType?: AuditEventType;
  executorId?: string;
  channelId?: string;
  targetId?: string;
  /** Recherche libre sur le nom de la cible ou de l'auteur */
  search?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export function buildAuditSearchWhere(
  guildId: string,
  options: SearchAuditEventsOptions,
): Record<string, unknown> {
  const where: Record<string, unknown> = { guildId };

  if (options.eventType) where.eventType = options.eventType;
  if (options.executorId) where.executorId = options.executorId;
  if (options.channelId) where.channelId = options.channelId;
  if (options.targetId) where.targetId = options.targetId;

  if (options.from || options.to) {
    where.createdAt = {
      ...(options.from ? { gte: options.from } : {}),
      ...(options.to ? { lte: options.to } : {}),
    };
  }

  const search = options.search?.trim().slice(0, 100);
  if (search) {
    where.OR = [
      { targetName: { contains: search, mode: 'insensitive' } },
      { executorName: { contains: search, mode: 'insensitive' } },
      { targetId: search },
    ];
  }

  return where;
}

export async function searchAuditEvents(guildId: string, options: SearchAuditEventsOptions = {}) {
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize ?? 25)));
  const where = buildAuditSearchWhere(guildId, options);

  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  return { events, total, page, pageSize };
}

/** Auteurs distincts ayant produit au moins un événement, pour alimenter le filtre. */
export async function getAuditExecutors(guildId: string) {
  const grouped = await prisma.auditEvent.groupBy({
    by: ['executorId', 'executorName'],
    where: { guildId, executorId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { executorId: 'desc' } },
    take: 50,
  });

  return grouped.map((row) => {
    const id = row.executorId as string;
    return { id, name: row.executorName ?? id, count: row._count._all };
  });
}

// ============================================================================
// RÉTENTION
// ============================================================================

export async function pruneOldAuditEvents(): Promise<void> {
  const configs = await prisma.auditLoggerConfig.findMany({
    where: { enabled: true, retentionDays: { gt: 0 } },
    select: { guildId: true, retentionDays: true },
  });

  for (const config of configs) {
    const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000);
    try {
      const { count } = await prisma.auditEvent.deleteMany({
        where: { guildId: config.guildId, createdAt: { lt: cutoff } },
      });
      if (count > 0) {
        logger.info('AuditLogger', `Purge de ${count} événement(s) expiré(s) pour la guilde ${config.guildId}.`);
      }
    } catch (error) {
      logger.error('AuditLogger', `Erreur lors de la purge des événements pour ${config.guildId}:`, error);
    }
  }
}
