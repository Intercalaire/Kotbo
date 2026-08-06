/**
 * Mise en route d'un module : cree les salons qui lui manquent, et reprend ceux
 * qui sont deja enregistres dans sa configuration.
 *
 * La reprise se fait par identifiant, jamais par nom. Une recherche par nom
 * recreerait un salon des qu'il a ete renomme, et rattacherait a tort le salon
 * d'un autre module qui porterait le meme nom.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type GuildBasedChannel,
  type NonThreadGuildBasedChannel,
  type OverwriteResolvable,
  type Role,
  type VoiceChannel,
} from 'discord.js';
import { cache } from '../../utils/cache.js';

/** Ce qu'une mise en route a fait d'un element, pour le rendre au dashboard. */
export type ProvisionedEntry = {
  key: string;
  id: string;
  name: string;
  created: boolean;
};

export const PROVISION_PERMISSION_LABELS: Record<string, string> = {
  [String(PermissionFlagsBits.ManageChannels)]: 'Gérer les salons',
  [String(PermissionFlagsBits.ManageRoles)]: 'Gérer les rôles',
  [String(PermissionFlagsBits.Administrator)]: 'Administrateur',
};

/**
 * Permissions manquantes au bot parmi celles demandees. Les verifier avant de
 * commencer evite la mise en route a moitie faite.
 */
export async function missingProvisionPermissions(guild: Guild, required: bigint[]): Promise<string[]> {
  // `members.me` sort du cache, qui peut etre vide sur une guilde recuperee par
  // REST. Sans ce repli, toutes les permissions passeraient pour manquantes et
  // la mise en route serait refusee a tort.
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me) throw new Error("Impossible de lire les permissions du bot sur ce serveur.");
  return required
    .filter((permission) => !me.permissions.has(permission))
    .map((permission) => PROVISION_PERMISSION_LABELS[String(permission)] ?? String(permission));
}

const inFlightProvisions = new Set<string>();

/**
 * Une seule mise en route a la fois par module et par serveur. Deux appels
 * simultanes liraient tous deux la meme configuration encore vide et
 * creeraient chacun leur jeu de salons : la reprise par identifiant ne protege
 * que des appels successifs, pas de ceux qui se chevauchent.
 *
 * Verrou en memoire : l'API dashboard ne tourne que sur le shard 0, comme les
 * limiteurs de debit qui reposent deja sur cette hypothese.
 */
export function acquireProvisionLock(key: string): boolean {
  if (inFlightProvisions.has(key)) return false;
  inFlightProvisions.add(key);
  return true;
}

export function releaseProvisionLock(key: string): void {
  inFlightProvisions.delete(key);
}

/**
 * Mises en route simultanees admises, tous serveurs confondus.
 *
 * Le verrou ci-dessus est par serveur : il n'empeche pas cinquante serveurs de
 * se mettre en route au meme instant. Or une mise en place complete fait une
 * vingtaine d'appels REST, et discord.js les fait tous passer par un plafond
 * commun de cinquante requetes par seconde. Cinquante serveurs a la fois, c'est
 * un millier d'appels en file : la requete du dashboard pend jusqu'a expirer
 * alors que le travail aboutit, et le trafic ordinaire du bot attend derriere.
 *
 * Trois a la fois tient la file a une soixantaine d'appels, soit le temps d'un
 * aller-retour HTTP ordinaire. Les autres sont refuses tout de suite, avec de
 * quoi comprendre, plutot que de rester suspendus.
 */
export const MAX_CONCURRENT_PROVISIONS = 3;

/**
 * Au-dela, la file est refusee plutot que retenue : ces requetes attendent
 * toutes derriere un socket ouvert, et en accumuler sans fin ne ferait que
 * repousser l'expiration au lieu de l'eviter.
 */
const MAX_WAITING_PROVISIONS = 25;

/** Passe ce delai, mieux vaut rendre la main que tenir la requete indefiniment. */
const PROVISION_SLOT_TIMEOUT_MS = 60_000;

let activeProvisions = 0;

type SlotWaiter = { settle: (granted: boolean) => void };
const waitingForSlot: SlotWaiter[] = [];

/**
 * Attend son tour plutot que d'essuyer un refus.
 *
 * La mise en place ne se lance qu'une fois par serveur : deux appels simultanes
 * viennent donc forcement de deux serveurs differents, tous deux legitimes.
 * Les refuser parce qu'un troisieme travaille reviendrait a punir l'un pour
 * l'activite de l'autre. Ils prennent la file, dans l'ordre d'arrivee.
 *
 * `false` ne sort que des deux cas ou attendre ne rime plus a rien : file
 * pleine, ou attente trop longue.
 */
export function waitForProvisionSlot(timeoutMs = PROVISION_SLOT_TIMEOUT_MS): Promise<boolean> {
  if (activeProvisions < MAX_CONCURRENT_PROVISIONS) {
    activeProvisions += 1;
    return Promise.resolve(true);
  }
  if (waitingForSlot.length >= MAX_WAITING_PROVISIONS) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const waiter: SlotWaiter = {
      settle: (granted: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const index = waitingForSlot.indexOf(waiter);
        if (index !== -1) waitingForSlot.splice(index, 1);
        resolve(granted);
      },
    };

    const timer = setTimeout(() => waiter.settle(false), timeoutMs);
    // Un compte a rebours seul ne doit pas retenir le processus a l'arret.
    timer.unref?.();

    waitingForSlot.push(waiter);
  });
}

export function releaseProvisionSlot(): void {
  const next = waitingForSlot.shift();
  if (next) {
    // La place passe de main en main sans repasser par zero : la decrementer
    // puis la laisser reprendre donnerait le tour a un appel arrive a l'instant
    // plutot qu'a celui qui attend depuis le plus longtemps.
    next.settle(true);
    return;
  }
  // Jamais sous zero : une liberation en trop rendrait des places qui
  // n'existent pas, et le plafond ne voudrait plus rien dire.
  activeProvisions = Math.max(0, activeProvisions - 1);
}

/** Delai impose entre deux mises en route qui creent quelque chose. */
export const PROVISION_COOLDOWN_SECONDS = 10 * 60;

/**
 * Le verrou n'arrete que les appels qui se chevauchent. Ce delai borne la
 * suite : supprimer les salons puis relancer recree tout, et sans lui rien
 * n'empeche d'en fabriquer a la chaine.
 *
 * La cle est volontairement hors du prefixe `guild:<id>:` : ce prefixe est vide
 * apres chaque ecriture du dashboard, le delai ne survivrait pas au premier
 * enregistrement de reglages venu.
 */
function cooldownKey(key: string): string {
  return `provision:cooldown:${key}`;
}

type StoredCooldown = { until: number; by: string };

/**
 * Delai en cours, ou `null` si la voie est libre. L'auteur est retenu avec :
 * un administrateur qui se voit refuser une mise en route qu'il n'a pas lancee
 * doit pouvoir savoir de qui elle vient, sans aller lire le journal d'audit.
 */
export async function provisionCooldown(key: string): Promise<{ seconds: number; by: string } | null> {
  const stored = await cache.get<StoredCooldown>(cooldownKey(key));
  if (!stored?.until) return null;

  const seconds = Math.ceil((stored.until - Date.now()) / 1000);
  if (seconds <= 0) return null;
  return { seconds, by: stored.by };
}

export async function startProvisionCooldown(key: string, by: string): Promise<void> {
  const stored: StoredCooldown = { until: Date.now() + PROVISION_COOLDOWN_SECONDS * 1000, by };
  await cache.set(cooldownKey(key), stored, PROVISION_COOLDOWN_SECONDS);
}

/**
 * Message de refus commun, sur la meme forme que les autres refus du
 * dashboard : ce qui s'est passe, puis quand reessayer. Depuis quand le delai
 * court n'est pas dit, le temps restant le donne deja.
 *
 * `subject` est la proposition complete que l'appelant ecrit lui-meme - « La
 * mise en route a déjà été lancée » - le francais n'accordant pas de la meme
 * facon selon le sujet.
 */
export function provisionCooldownMessage(cooldown: { seconds: number; by: string }, subject: string): string {
  const minutes = Math.max(1, Math.ceil(cooldown.seconds / 60));
  return `${subject} par ${cooldown.by}. Réessayez dans ${minutes} min.`;
}

async function resolveChannel(guild: Guild, id: string | null | undefined): Promise<GuildBasedChannel | null> {
  if (!id) return null;
  return guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
}

function entryOf(key: string, channel: { id: string; name: string }, created: boolean): ProvisionedEntry {
  return { key, id: channel.id, name: channel.name, created };
}

export async function ensureCategory(guild: Guild, input: {
  key: string;
  existingId?: string | null;
  name: string;
  permissionOverwrites?: OverwriteResolvable[];
  reason: string;
}): Promise<{ channel: CategoryChannel; entry: ProvisionedEntry }> {
  const existing = await resolveChannel(guild, input.existingId);
  if (existing?.type === ChannelType.GuildCategory) {
    return { channel: existing, entry: entryOf(input.key, existing, false) };
  }

  const channel = await guild.channels.create({
    name: input.name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: input.permissionOverwrites,
    reason: input.reason,
  });
  return { channel, entry: entryOf(input.key, channel, true) };
}

// Le type rend la garantie deja assuree par la reprise ci-dessous : jamais un
// fil. Un appelant qui veut reposer des surcharges sur un salon repris a besoin
// de cette certitude, un fil n'en portant pas.
export async function ensureTextChannel(guild: Guild, input: {
  key: string;
  existingId?: string | null;
  name: string;
  parentId?: string | null;
  permissionOverwrites?: OverwriteResolvable[];
  reason: string;
}): Promise<{ channel: NonThreadGuildBasedChannel; entry: ProvisionedEntry }> {
  const existing = await resolveChannel(guild, input.existingId);
  // Tout salon ou le bot peut ecrire fait l'affaire, pas seulement un salon
  // textuel : un salon d'annonces est un choix legitime, et exiger le type
  // exact reviendrait a en creer un doublon en ecrasant la configuration.
  if (existing?.isTextBased() && !existing.isThread()) {
    return { channel: existing, entry: entryOf(input.key, existing, false) };
  }

  const channel = await guild.channels.create({
    name: input.name,
    type: ChannelType.GuildText,
    parent: input.parentId ?? undefined,
    permissionOverwrites: input.permissionOverwrites,
    reason: input.reason,
  });
  return { channel, entry: entryOf(input.key, channel, true) };
}

export async function ensureVoiceChannel(guild: Guild, input: {
  key: string;
  existingId?: string | null;
  name: string;
  parentId?: string | null;
  permissionOverwrites?: OverwriteResolvable[];
  /** Places du salon. Pose a la creation seulement, comme les surcharges. */
  userLimit?: number;
  reason: string;
}): Promise<{ channel: VoiceChannel; entry: ProvisionedEntry }> {
  const existing = await resolveChannel(guild, input.existingId);
  if (existing?.type === ChannelType.GuildVoice) {
    return { channel: existing, entry: entryOf(input.key, existing, false) };
  }

  const channel = await guild.channels.create({
    name: input.name,
    type: ChannelType.GuildVoice,
    parent: input.parentId ?? undefined,
    permissionOverwrites: input.permissionOverwrites,
    userLimit: input.userLimit,
    reason: input.reason,
  });
  return { channel, entry: entryOf(input.key, channel, true) };
}

/**
 * Meme reprise par identifiant que les salons : un role deja enregistre est
 * repris tel quel, sans que ses permissions soient reecrites. Le reprendre
 * evite de doubler le role staff d'un serveur deja monte.
 */
export async function ensureRole(guild: Guild, input: {
  key: string;
  existingId?: string | null;
  name: string;
  color?: number;
  hoist?: boolean;
  permissions?: bigint[];
  reason: string;
}): Promise<{ role: Role; entry: ProvisionedEntry }> {
  const existing = input.existingId
    ? guild.roles.cache.get(input.existingId) ?? await guild.roles.fetch(input.existingId).catch(() => null)
    : null;
  if (existing) {
    return { role: existing, entry: entryOf(input.key, existing, false) };
  }

  const role = await guild.roles.create({
    name: input.name,
    color: input.color,
    hoist: input.hoist,
    permissions: input.permissions,
    reason: input.reason,
  });
  return { role, entry: entryOf(input.key, role, true) };
}
