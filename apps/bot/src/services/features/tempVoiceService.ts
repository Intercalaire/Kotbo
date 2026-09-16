/**
 * Règles de création des salons vocaux temporaires : fonctions pures et
 * vérifiables sans client Discord. La politique par défaut laisse les
 * serveurs déjà configurés inchangés.
 */
import { OverwriteType, PermissionFlagsBits, type OverwriteResolvable } from 'discord.js';
import type { TempVoiceOwnerPower, TempVoiceTextChatMode, TempVoicePolicy } from '@kotbo/shared';

export type { TempVoiceOwnerPower, TempVoiceTextChatMode, TempVoicePolicy };

export const TEMP_VOICE_OWNER_POWERS: readonly TempVoiceOwnerPower[] = [
  'mute',
  'deafen',
  'move',
  'manageChannel',
  'manageMessages',
] as const;

export const TEMP_VOICE_TEXT_CHAT_MODES: readonly TempVoiceTextChatMode[] = [
  'inherit',
  'open',
  'locked',
] as const;

export const LEGACY_OWNER_POWERS: readonly TempVoiceOwnerPower[] = ['mute', 'deafen', 'move'] as const;

/** Un salon Discord n'accepte pas plus de 99 places. */
export const MAX_USER_LIMIT = 99;

/** Au-delà, la liste des rôles autorisés d'office n'est plus lisible en page. */
export const MAX_AUTO_ALLOW_ROLES = 10;

export interface TempVoiceGenerator {
  channelId: string;
  categoryId?: string;
  nameTemplate: string;
  requiredRoleId?: string;
  policy: TempVoicePolicy;
  /** `generators[0]` n'est pas forcément le principal : un serveur peut n'avoir que des additionnels. */
  primary: boolean;
}

export interface StoredTempVoiceGenerator {
  channelId: string;
  categoryId?: string;
  nameTemplate?: string;
  requiredRoleId?: string | null;
  userLimit?: number;
  lockOnCreate?: boolean;
  autoAllowRoleIds?: string[];
  textChat?: TempVoiceTextChatMode;
  ownerPowers?: TempVoiceOwnerPower[];
}

export const DEFAULT_NAME_TEMPLATE = '🔊 Salon de {user}';

export function defaultTempVoicePolicy(): TempVoicePolicy {
  return {
    userLimit: 0,
    lockOnCreate: false,
    autoAllowRoleIds: [],
    textChat: 'inherit',
    ownerPowers: [...LEGACY_OWNER_POWERS],
  };
}

function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

/** `everyoneRoleId` est écarté : il passe la validation de format, et l'autoriser d'office
 *  viderait le verrouillage de son sens. */
function normalizeRoleIds(value: unknown, max: number, everyoneRoleId?: string): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(isSnowflake).filter((id) => id !== everyoneRoleId);
  return [...new Set(ids)].slice(0, max);
}

function normalizeUserLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.trunc(parsed), 0), MAX_USER_LIMIT);
}

function normalizeOwnerPowers(value: unknown): TempVoiceOwnerPower[] {
  // `undefined` n'est pas « aucun pouvoir », c'est « rien n'a été dit » : le
  // champ absent rend les pouvoirs historiques, la liste vide n'en rend aucun.
  if (!Array.isArray(value)) return [...LEGACY_OWNER_POWERS];
  return TEMP_VOICE_OWNER_POWERS.filter((power) => value.includes(power));
}

function normalizeTextChat(value: unknown): TempVoiceTextChatMode {
  return TEMP_VOICE_TEXT_CHAT_MODES.includes(value as TempVoiceTextChatMode)
    ? (value as TempVoiceTextChatMode)
    : 'inherit';
}

/** Ramène une valeur de la base ou du dashboard à une politique complète :
 *  personne d'autre ne valide ce JSON. */
export function normalizeTempVoicePolicy(raw: unknown, everyoneRoleId?: string): TempVoicePolicy {
  if (!raw || typeof raw !== 'object') return defaultTempVoicePolicy();
  const source = raw as Record<string, unknown>;

  return {
    userLimit: normalizeUserLimit(source.userLimit),
    lockOnCreate: source.lockOnCreate === true,
    autoAllowRoleIds: normalizeRoleIds(source.autoAllowRoleIds, MAX_AUTO_ALLOW_ROLES, everyoneRoleId),
    textChat: normalizeTextChat(source.textChat),
    ownerPowers: normalizeOwnerPowers(source.ownerPowers),
  };
}

/** Nombre maximum de générateurs additionnels acceptés pour un serveur. */
export const MAX_ADDITIONAL_GENERATORS = 25;

export function normalizeTempVoiceGeneratorsInput(
  raw: unknown,
  everyoneRoleId?: string,
  mainChannelId?: string | null,
): StoredTempVoiceGenerator[] {
  if (!Array.isArray(raw)) return [];

  const normalized: StoredTempVoiceGenerator[] = [];
  // Le générateur principal occupe déjà son salon : un additionnel dessus ne serait jamais atteint.
  const seen = new Set<string>(mainChannelId ? [mainChannelId] : []);

  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if (!isSnowflake(entry.channelId)) continue;
    // Deux générateurs sur le même salon : le second ne serait jamais atteint.
    if (seen.has(entry.channelId)) continue;
    seen.add(entry.channelId);

    const policy = normalizeTempVoicePolicy(entry, everyoneRoleId);
    const nameTemplate = typeof entry.nameTemplate === 'string' && entry.nameTemplate.trim()
      ? entry.nameTemplate.trim().slice(0, 100)
      : DEFAULT_NAME_TEMPLATE;

    normalized.push({
      channelId: entry.channelId,
      ...(isSnowflake(entry.categoryId) ? { categoryId: entry.categoryId } : {}),
      nameTemplate,
      requiredRoleId: isSnowflake(entry.requiredRoleId) ? entry.requiredRoleId : null,
      userLimit: policy.userLimit,
      lockOnCreate: policy.lockOnCreate,
      autoAllowRoleIds: policy.autoAllowRoleIds,
      textChat: policy.textChat,
      ownerPowers: policy.ownerPowers,
    });

    if (normalized.length >= MAX_ADDITIONAL_GENERATORS) break;
  }

  return normalized;
}

/** Colonnes du serveur que la résolution des générateurs consulte. */
export interface TempVoiceGuildConfig {
  tempVoiceEnabled: boolean;
  tempVoiceChannelId: string | null;
  tempVoiceCategoryId: string | null;
  tempVoiceNameTemplate: string;
  tempVoiceRequiredRoleId?: string | null;
  tempVoiceDefaults?: unknown;
  tempVoiceGenerators?: unknown;
}

/** Le principal vit dans des colonnes à plat, les additionnels dans un JSON ;
 *  `everyoneRoleId` descend jusqu'à la normalisation pour filtrer une base écrite à la main. */
export function resolveTempVoiceGenerators(
  guildConfig: TempVoiceGuildConfig,
  everyoneRoleId?: string,
): TempVoiceGenerator[] {
  const generators: TempVoiceGenerator[] = [];

  if (guildConfig.tempVoiceChannelId) {
    generators.push({
      channelId: guildConfig.tempVoiceChannelId,
      categoryId: guildConfig.tempVoiceCategoryId || undefined,
      nameTemplate: guildConfig.tempVoiceNameTemplate || DEFAULT_NAME_TEMPLATE,
      requiredRoleId: guildConfig.tempVoiceRequiredRoleId || undefined,
      policy: normalizeTempVoicePolicy(guildConfig.tempVoiceDefaults, everyoneRoleId),
      primary: true,
    });
  }

  if (Array.isArray(guildConfig.tempVoiceGenerators)) {
    for (const value of guildConfig.tempVoiceGenerators) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry.channelId !== 'string') continue;

      generators.push({
        channelId: entry.channelId,
        categoryId: typeof entry.categoryId === 'string' ? entry.categoryId : undefined,
        nameTemplate: typeof entry.nameTemplate === 'string' ? entry.nameTemplate : DEFAULT_NAME_TEMPLATE,
        requiredRoleId: typeof entry.requiredRoleId === 'string' ? entry.requiredRoleId : undefined,
        policy: normalizeTempVoicePolicy(entry, everyoneRoleId),
        primary: false,
      });
    }
  }

  return generators;
}

const OWNER_POWER_BITS: Record<TempVoiceOwnerPower, bigint> = {
  mute: PermissionFlagsBits.MuteMembers,
  deafen: PermissionFlagsBits.DeafenMembers,
  move: PermissionFlagsBits.MoveMembers,
  manageChannel: PermissionFlagsBits.ManageChannels,
  manageMessages: PermissionFlagsBits.ManageMessages,
};

/** Le propriétaire garde toujours l'écriture et la lecture, même salon verrouillé :
 *  sinon « Verrouiller » le rendrait muet chez lui. */
export function ownerAllowBits(policy: TempVoicePolicy): bigint[] {
  const bits = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ];

  for (const power of policy.ownerPowers) bits.push(OWNER_POWER_BITS[power]);

  return bits;
}

/** Discord refuse une surcharge qui accorde un droit que le bot n'a pas lui-même. */
export function requiredBotPermissions(policy: TempVoicePolicy): bigint[] {
  return [
    ...new Set([
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.MoveMembers,
      // Créer un salon avec des surcharges de permissions exige `ManageRoles`.
      PermissionFlagsBits.ManageRoles,
      ...ownerAllowBits(policy),
    ]),
  ];
}

export interface OverwriteDraft {
  id: string;
  type: OverwriteType;
  allow: bigint;
  deny: bigint;
}

function toBigInt(value: bigint | number | string | { bitfield: bigint }): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'object' && value && 'bitfield' in value) return value.bitfield;
  return BigInt(value);
}

/** Autoriser un bit le retire du refus : les deux champs sont exclusifs côté Discord. */
function applyBits(draft: OverwriteDraft, allow: bigint[] = [], deny: bigint[] = []): OverwriteDraft {
  let nextAllow = draft.allow;
  let nextDeny = draft.deny;

  for (const bit of allow) {
    nextAllow |= bit;
    nextDeny &= ~bit;
  }
  for (const bit of deny) {
    nextDeny |= bit;
    nextAllow &= ~bit;
  }

  return { ...draft, allow: nextAllow, deny: nextDeny };
}

/** Un refus porté par @everyone reste dépassable (le propriétaire entre dans son
 *  salon sur un serveur fermé) ; un refus posé sur la *même* cible gagne toujours. */
function grantableBits(allow: bigint[], inheritedDeny: bigint): bigint[] {
  return allow.filter((bit) => (inheritedDeny & bit) !== bit);
}

export interface BuildCreationOverwritesInput {
  /** Identifiant du rôle @everyone, qui vaut celui du serveur. */
  everyoneRoleId: string;
  ownerId: string;
  /** Surcharges recopiées de la catégorie parente, vides si elle n'existe pas. */
  inherited: OverwriteDraft[];
  policy: TempVoicePolicy;
}

/** La politique s'empile bit à bit sur ce que porte la catégorie, sans jamais remplacer
 *  une surcharge entière : un salon rouvert à @everyone serait le seul sans vérification. */
export function buildCreationOverwrites(input: BuildCreationOverwritesInput): OverwriteResolvable[] {
  const { everyoneRoleId, ownerId, inherited, policy } = input;

  const drafts = new Map<string, OverwriteDraft>();
  for (const overwrite of inherited) {
    drafts.set(overwrite.id, { ...overwrite });
  }

  const ensure = (id: string, type: OverwriteType): OverwriteDraft => {
    const existing = drafts.get(id);
    if (existing) return existing;
    const created: OverwriteDraft = { id, type, allow: 0n, deny: 0n };
    drafts.set(id, created);
    return created;
  };

  const inheritedDenyFor = (id: string): bigint =>
    inherited.find((overwrite) => overwrite.id === id)?.deny ?? 0n;

  // 1. Propriétaire : la surcharge héritée est complétée, jamais retournée.
  drafts.set(ownerId, applyBits(
    ensure(ownerId, OverwriteType.Member),
    grantableBits(ownerAllowBits(policy), inheritedDenyFor(ownerId)),
  ));

  // 2. Rôles autorisés d'office : ils entrent même si le salon naît verrouillé.
  const autoAllow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ];

  for (const roleId of policy.autoAllowRoleIds) {
    // Garde-fou : une base écrite avant la normalisation peut encore contenir @everyone ici.
    if (roleId === everyoneRoleId) continue;
    drafts.set(roleId, applyBits(
      ensure(roleId, OverwriteType.Role),
      grantableBits(autoAllow, inheritedDenyFor(roleId)),
    ));
  }

  const everyoneAllow: bigint[] = [];
  const everyoneDeny: bigint[] = [];

  if (policy.lockOnCreate) {
    everyoneDeny.push(PermissionFlagsBits.Connect);
    // Verrouiller ferme aussi l'écriture, sauf si le chat est explicitement ouvert.
    if (policy.textChat !== 'open') everyoneDeny.push(PermissionFlagsBits.SendMessages);
  }
  if (policy.textChat === 'open') everyoneAllow.push(PermissionFlagsBits.SendMessages);
  if (policy.textChat === 'locked') everyoneDeny.push(PermissionFlagsBits.SendMessages);

  // 3. @everyone : verrouillage et chat, rien d'autre.
  if (everyoneAllow.length > 0 || everyoneDeny.length > 0) {
    // Même règle : le mode « ouvert » n'écrase pas un refus nommé de la catégorie.
    drafts.set(
      everyoneRoleId,
      applyBits(
        ensure(everyoneRoleId, OverwriteType.Role),
        grantableBits(everyoneAllow, inheritedDenyFor(everyoneRoleId)),
        everyoneDeny,
      ),
    );
  }

  // Discord conserve et affiche une surcharge qui n'autorise ni ne refuse rien.
  return [...drafts.values()]
    .filter((draft) => draft.allow !== 0n || draft.deny !== 0n)
    .map((draft) => ({
      id: draft.id,
      type: draft.type,
      allow: draft.allow,
      deny: draft.deny,
    }));
}

/** Surcharges d'une catégorie Discord ramenées à la forme utilisée ici. */
export function toOverwriteDrafts(
  overwrites: Iterable<{ id: string; type: OverwriteType; allow: bigint | { bitfield: bigint }; deny: bigint | { bitfield: bigint } }>,
): OverwriteDraft[] {
  return [...overwrites].map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: toBigInt(overwrite.allow),
    deny: toBigInt(overwrite.deny),
  }));
}

/**
 * Surcharges posées par les boutons du panneau de gestion.
 *
 * Regroupées ici pour que l'invariant tienne en un seul endroit vérifiable :
 * rien de ce qui rouvre un salon n'autorise explicitement. Rendre un droit se
 * dit `null`, ce qui le remet à ce que prévoit la catégorie ; `true` écraserait
 * un refus posé plus haut.
 */
export const CHANNEL_PATCHES = {
  lock: { Connect: false, SendMessages: false },
  unlock: { Connect: null, SendMessages: null },
  /** Levée de réservation : même règle que le déverrouillage. */
  clearReservation: { Connect: null, SendMessages: null },
  closeChat: { SendMessages: false },
  openChat: { SendMessages: null },
  /** Bannissement : couper la seule connexion laisse lire et écrire dans le chat. */
  ban: { Connect: false, ViewChannel: false, SendMessages: false },
} as const satisfies Record<string, Record<string, boolean | null>>;

/** @everyone porte l'identifiant du serveur : il passe la validation de format, et le réserver
 *  ouvrirait le salon à tout le monde. Le rôle doit exister, sans quoi la surcharge viserait
 *  autre chose. */
export function resolveReservationRoleId(
  value: unknown,
  everyoneRoleId: string,
  guildRoleIds: ReadonlySet<string>,
): string | null {
  if (!isSnowflake(value)) return null;
  if (value === everyoneRoleId) return null;
  return guildRoleIds.has(value) ? value : null;
}

/** Ce que « Ajouter » accorde, avant confrontation avec la catégorie. */
const TRUST_BITS: ReadonlyArray<[bigint, string]> = [
  [PermissionFlagsBits.ViewChannel, 'ViewChannel'],
  [PermissionFlagsBits.Connect, 'Connect'],
  [PermissionFlagsBits.Speak, 'Speak'],
  [PermissionFlagsBits.SendMessages, 'SendMessages'],
  [PermissionFlagsBits.ReadMessageHistory, 'ReadMessageHistory'],
];

/** Dérivé de `TRUST_BITS.length` plutôt qu'écrit en dur, qui figerait le nombre
 *  au jour où la liste a été écrite. */
export const TRUST_BIT_COUNT = TRUST_BITS.length;

export function trustPermissionPatch(categoryPermissions: bigint | null): Record<string, true> | null {
  const patch: Record<string, true> = {};
  for (const [bit, name] of TRUST_BITS) {
    if (categoryPermissions === null || (categoryPermissions & bit) === bit) patch[name] = true;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Droits *effectifs* dans la catégorie, pas la surcharge nominative : une catégorie
 *  restreinte se configure souvent par un refus à @everyone et une autorisation à un rôle. */
export function categoryTrustPatch<T>(
  channel: {
    parentId: string | null;
    parent: { permissionsFor(target: T): { bitfield: bigint } | null } | null;
  },
  target: T | null | undefined,
): Record<string, true> | null {
  // Cible introuvable : refuser en premier, sinon une cible nulle serait tout accordée.
  if (!target) return null;
  if (channel.parentId && !channel.parent) return null;
  if (!channel.parent) return trustPermissionPatch(null);

  const effective = channel.parent.permissionsFor(target);
  return effective ? trustPermissionPatch(effective.bitfield) : null;
}

/** `null` et non `false` : le sortant redevient un membre ordinaire. Garder une
 *  surcharge nominative laisserait un ancien propriétaire dans un salon verrouillé,
 *  sans bouton pour l'en retirer. */
export function ownerRevokedPermissions(): Record<string, null> {
  return {
    ViewChannel: null,
    Connect: null,
    Speak: null,
    SendMessages: null,
    ReadMessageHistory: null,
    MuteMembers: null,
    DeafenMembers: null,
    MoveMembers: null,
    ManageChannels: null,
    ManageMessages: null,
  };
}

/** Pouvoirs lisibles dans une surcharge déjà posée : ce qu'un transfert reconduit. */
export function ownerPowersFromBits(allow: bigint): TempVoiceOwnerPower[] {
  return TEMP_VOICE_OWNER_POWERS.filter((power) => (allow & OWNER_POWER_BITS[power]) === OWNER_POWER_BITS[power]);
}

/** Reprend ce que la création accorde, sinon un salon au chat fermé laisse son
 *  nouveau propriétaire muet. `categoryPermissions` confronte comme à la création,
 *  pour ne pas rendre à un membre sanctionné la parole qu'on vient de lui retirer. */
export function ownerPermissionPatch(
  powers: TempVoiceOwnerPower[],
  categoryPermissions: bigint | null = null,
): Record<string, boolean | null> {
  const grantable = (bit: bigint): true | null =>
    categoryPermissions === null || (categoryPermissions & bit) === bit ? true : null;

  const patch: Record<string, boolean | null> = {
    ViewChannel: grantable(PermissionFlagsBits.ViewChannel),
    Connect: grantable(PermissionFlagsBits.Connect),
    Speak: grantable(PermissionFlagsBits.Speak),
    SendMessages: grantable(PermissionFlagsBits.SendMessages),
    ReadMessageHistory: grantable(PermissionFlagsBits.ReadMessageHistory),
  };

  const granted = new Set(powers);
  const keys: Record<TempVoiceOwnerPower, string> = {
    mute: 'MuteMembers',
    deafen: 'DeafenMembers',
    move: 'MoveMembers',
    manageChannel: 'ManageChannels',
    manageMessages: 'ManageMessages',
  };

  for (const power of TEMP_VOICE_OWNER_POWERS) {
    patch[keys[power]] = granted.has(power) ? grantable(OWNER_POWER_BITS[power]) : null;
  }

  return patch;
}

/** Longueur ramenée à 100 caractères : ce que Discord accepte pour un nom de salon. */
export function renderChannelName(template: string, displayName: string): string {
  // Fonction de remplacement et non chaîne : `String.replace` interprète `$&` et
  // `$1`, qu'un pseudo contenant ces séquences corromprait.
  const rendered = (template || DEFAULT_NAME_TEMPLATE).replace(/\{user\}/g, () => displayName);
  const trimmed = rendered.trim();
  // Un gabarit réduit à « {user} » avec un pseudo vide donnerait un nom vide, que Discord refuse.
  const fallback = DEFAULT_NAME_TEMPLATE.replace('{user}', () => displayName).trim();
  return (trimmed || fallback || 'Salon temporaire').slice(0, 100);
}
