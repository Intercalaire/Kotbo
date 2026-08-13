import { type Client, type Guild, type GuildMember, type TextChannel, type VoiceBasedChannel, type VoiceState, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { createReadStream, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import type { RaidProtectionConfig } from '@prisma/client';
import { getRaidProtectionConfig } from './raidProtectionService.js';

export const VOICE_CODE_LENGTH = 5;

export const VOICE_LOCALES = ['FR', 'EN'] as const;
export type VoiceLocale = (typeof VOICE_LOCALES)[number];
const DEFAULT_VOICE_LOCALE: VoiceLocale = 'FR';

/**
 * Symboles utilisables, par langue : les 26 lettres et les 10 chiffres, dans
 * les deux.
 *
 * 0 et 1 sont écartés du captcha image parce qu'ils s'y confondent avec O et I.
 * À l'oreille rien ne les confond, « zéro » et « O » n'ayant aucun son commun :
 * les exclure ici ne retirait donc que de l'entropie.
 *
 * Les packs couvrent l'alphabet complet des scripts de génération : ces listes
 * peuvent en être des sous-ensembles, loadPack ignorant les clips dont le
 * symbole n'y figure pas. Réduire ici ne demande donc aucune régénération.
 */
const VOICE_ALPHABETS: Record<VoiceLocale, string> = {
  FR: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  EN: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
};

export function alphabetFor(locale: VoiceLocale): string {
  return VOICE_ALPHABETS[locale];
}

const PACK_ROOT = fileURLToPath(new URL('../../../assets/captcha-voice/', import.meta.url));

/**
 * Une langue absente ou invalide en base ne doit pas priver le serveur du mode
 * vocal : on retombe sur le français plutôt que de chercher un pack inexistant.
 */
export function normalizeVoiceLocale(value: string | null | undefined): VoiceLocale {
  const upper = value?.toUpperCase();
  return VOICE_LOCALES.includes(upper as VoiceLocale) ? (upper as VoiceLocale) : DEFAULT_VOICE_LOCALE;
}

// Temps d'antenne : la diffusion audio est sérielle, chaque milliseconde ici
// est payée par tous les membres en file derrière.
const CLIP_GAP_MIN_MS = 180;
const CLIP_GAP_MAX_MS = 420;
// Moyennes mesurees sur les clips reellement tires par chaque alphabet. Les
// deux packs viennent desormais d'une prise humaine, d'ou des valeurs proches ;
// la table reste par langue parce qu'une prise se remplace langue par langue, et
// qu'une estimation fausse ment au membre sur son attente et masque le moment ou
// la file depasse le delai d'expiration.
const CLIP_DURATION_ESTIMATE_MS: Record<VoiceLocale, number> = { FR: 900, EN: 950 };
const JOIN_WINDOW_MS = 45_000; // Délai laissé au membre pour rejoindre à son tour
const TYPICAL_JOIN_MS = 8_000; // Utilisé seulement pour estimer l'attente annoncée
const BETWEEN_MEMBERS_MS = 500;
// Discord n'a pas fini d'etablir le flux audio quand l'evenement d'arrivee
// tombe : enoncer aussitot ferait manquer les premiers caracteres au membre.
const JOIN_SETTLE_MS = 2_000;
// Le player passe en Idle quand il a fini de lire la ressource, pas quand le son
// est sorti côté Discord : sans ce délai, la fin du dernier caractère est coupée
// par la déconnexion, et le membre se retrouve ejecté avant d'avoir tout entendu.
const POST_CODE_LINGER_MS = 2_000;
// Fenêtre pendant laquelle le membre reste dans le salon et peut redemander son
// code. Elle n'est ouverte que si personne n'attend derrière : la diffusion est
// sérielle, la réécoute de l'un ne doit pas être payée par toute la file.
const REPLAY_GRACE_MS = 15_000;
const MAX_REPLAYS_PER_TURN = 2;
const CONNECTION_READY_TIMEOUT_MS = 20_000;
const IDLE_DISCONNECT_MS = 30_000;

export function generateVoiceCode(locale: VoiceLocale = DEFAULT_VOICE_LOCALE): string {
  const alphabet = alphabetFor(locale);
  let code = '';
  for (let i = 0; i < VOICE_CODE_LENGTH; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

// ── Pack audio ────────────────────────────────────────────────────────────────

const packCache = new Map<VoiceLocale, Map<string, string[]>>();

/**
 * Variantes retenues. Les prises humaines occupent `-3` dans les deux langues ;
 * `-1` et `-2` etaient la synthese edge-tts, ou « bee », « see », « dee »,
 * « gee », « pee », « tee » et « vee » sont quasi indiscernables en anglais et
 * ou le N francais passait mal.
 *
 * Une liste explicite plutot que la suppression seule des fichiers : `clipFor`
 * tire au hasard, et un seul clip de synthese remis par une regeneration
 * distraite - `generate-captcha-voice.sh` sans argument les recree tous -
 * suffirait a rendre un code sur trois inintelligible, sans que rien ne le
 * signale. Ajouter une voix demande donc desormais de l'inscrire ici.
 */
const ACCEPTED_VARIANTS = new Set(['3']);

/** Scanne le dossier d'une langue une fois : symbole -> variantes disponibles. */
function loadPack(locale: VoiceLocale): Map<string, string[]> {
  const cached = packCache.get(locale);
  if (cached) return cached;

  const dir = path.join(PACK_ROOT, locale.toLowerCase());
  const pack = new Map<string, string[]>();
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ogg')) continue;
      const [symbol, variant] = file.slice(0, -'.ogg'.length).split('-');
      if (!symbol || !variant || !ACCEPTED_VARIANTS.has(variant)) continue;
      if (!alphabetFor(locale).includes(symbol.toUpperCase())) continue;
      const variants = pack.get(symbol.toUpperCase()) ?? [];
      variants.push(path.join(dir, file));
      pack.set(symbol.toUpperCase(), variants);
    }
  } catch (err) {
    logger.warn('VoiceCaptcha', `Pack audio illisible dans ${dir}`, err);
  }

  packCache.set(locale, pack);
  return pack;
}

/**
 * Le mode vocal n'est utilisable que si chaque symbole de l'alphabet dispose
 * d'au moins un clip dans la langue demandée : un pack incomplet produirait des
 * codes inénonçables.
 */
export function isVoicePackAvailable(locale: VoiceLocale = DEFAULT_VOICE_LOCALE): boolean {
  const pack = loadPack(locale);
  return [...alphabetFor(locale)].every((symbol) => (pack.get(symbol)?.length ?? 0) > 0);
}

/**
 * Le code est-il énonçable en entier dans cette langue ? Un code reste en base
 * avec l'alphabet qui l'a produit : changer la langue du serveur, ou réduire un
 * alphabet, rend soudain certains de ses symboles muets. L'énoncer quand même
 * donnerait un code amputé, que le membre échouerait jusqu'à la sanction.
 */
function isCodeSpeakable(code: string, locale: VoiceLocale): boolean {
  const pack = loadPack(locale);
  return [...code].every((symbol) => (pack.get(symbol.toUpperCase())?.length ?? 0) > 0);
}

function clipFor(symbol: string, locale: VoiceLocale): string | null {
  const variants = loadPack(locale).get(symbol.toUpperCase());
  if (!variants?.length) return null;
  return variants[crypto.randomInt(variants.length)];
}

// ── File d'attente (une par serveur) ──────────────────────────────────────────

type QueueEntry = {
  userId: string;
  sessionId: string | null; // null = simple répétition, la session existe déjà
  code: string;
  enqueuedAt: number;
};

const queues = new Map<string, QueueEntry[]>();
const runningGuilds = new Set<string>();

/** Membre dont c'est le tour : seul autorisé dans le salon vocal. */
const currentTurns = new Map<string, string>();

/** Résolveurs en attente de l'arrivée effective du membre dans le salon. */
const joinWaiters = new Map<string, { userId: string; resolve: () => void }>();

/** Membre en fenêtre de réécoute : son clic sur « Répéter » agit sur place. */
const replayWaiters = new Map<string, { userId: string; request: () => void }>();

export function getQueueLength(guildId: string): number {
  return queues.get(guildId)?.length ?? 0;
}

export function getQueuePosition(guildId: string, userId: string): number {
  const queue = queues.get(guildId) ?? [];
  return queue.findIndex((entry) => entry.userId === userId) + 1;
}

export function isQueued(guildId: string, userId: string): boolean {
  return getQueuePosition(guildId, userId) > 0 || currentTurns.get(guildId) === userId;
}

/** Durée moyenne d'un tour, utilisée pour estimer l'attente annoncée. */
export function estimateTurnMs(locale: VoiceLocale = DEFAULT_VOICE_LOCALE): number {
  const averageGap = (CLIP_GAP_MIN_MS + CLIP_GAP_MAX_MS) / 2;
  const airtime = VOICE_CODE_LENGTH * (CLIP_DURATION_ESTIMATE_MS[locale] + averageGap);
  return TYPICAL_JOIN_MS + JOIN_SETTLE_MS + airtime + POST_CODE_LINGER_MS + BETWEEN_MEMBERS_MS;
}

/**
 * Récupère la file du serveur, en la créant au besoin. À appeler juste avant de
 * la modifier, sans await entre les deux : deux clics simultanés partiraient
 * sinon chacun d'un tableau neuf, et le dernier enregistrement écraserait
 * l'autre membre sans que rien ne le signale.
 */
function queueFor(guildId: string): QueueEntry[] {
  const existing = queues.get(guildId);
  if (existing) return existing;

  const created: QueueEntry[] = [];
  queues.set(guildId, created);
  return created;
}

function removeFromQueue(guildId: string, userId: string): void {
  const queue = queues.get(guildId);
  if (!queue) return;
  const index = queue.findIndex((entry) => entry.userId === userId);
  if (index !== -1) queue.splice(index, 1);
}

// ── Contrôles de configuration ────────────────────────────────────────────────

export type VoiceReadiness =
  | { ok: true; channel: VoiceBasedChannel }
  | { ok: false; reason: string };

/**
 * Vérifie que le mode vocal est réellement praticable sur ce serveur. Tout
 * échec doit renvoyer vers le captcha image plutôt que bloquer le membre.
 *
 * Le contrôle porte autant sur le bot que sur le rôle non-vérifié : une
 * configuration où l'arrivant ne peut pas voir le salon vocal échouerait
 * silencieusement côté membre, sans que rien n'alerte l'administrateur.
 */
export async function checkVoiceReadiness(guild: Guild, config: RaidProtectionConfig): Promise<VoiceReadiness> {
  if (!config.captchaVoiceChannelId) return { ok: false, reason: 'aucun salon vocal configuré' };

  const locale = normalizeVoiceLocale(config.captchaVoiceLocale);
  if (!isVoicePackAvailable(locale)) {
    return { ok: false, reason: `pack audio ${locale} absent ou incomplet` };
  }

  const channel = await guild.channels.fetch(config.captchaVoiceChannelId).catch(() => null);
  if (!channel?.isVoiceBased()) return { ok: false, reason: 'salon vocal introuvable' };

  const me = guild.members.me;
  if (!me) return { ok: false, reason: 'membre bot indisponible' };

  const botPermissions = channel.permissionsFor(me);
  const required: Array<[bigint, string]> = [
    [PermissionFlagsBits.ViewChannel, 'Voir le salon'],
    [PermissionFlagsBits.Connect, 'Se connecter'],
    [PermissionFlagsBits.Speak, 'Parler'],
    // Sert à éjecter le membre du salon dès son code énoncé, et à en sortir
    // quiconque s'y glisserait hors de son tour.
    [PermissionFlagsBits.MoveMembers, 'Déplacer les membres'],
    // Nécessaire pour poser puis retirer l'autorisation individuelle qui ouvre
    // le salon au seul membre dont c'est le tour.
    [PermissionFlagsBits.ManageRoles, 'Gérer les permissions'],
  ];
  const missingBot = required.filter(([flag]) => !botPermissions?.has(flag)).map(([, label]) => label);
  if (missingBot.length) {
    return { ok: false, reason: `permissions bot manquantes sur le salon vocal : ${missingBot.join(', ')}` };
  }

  const roleCheck = checkUnverifiedRoleAccess(channel, config);
  if (!roleCheck.ok) return roleCheck;

  return { ok: true, channel };
}

/**
 * Le rôle non-vérifié doit voir le salon vocal sans pouvoir y entrer : c'est
 * l'autorisation individuelle posée à son tour qui lui ouvre la porte. Un rôle
 * qui aurait déjà « Se connecter » ferait s'entasser tout le monde dans le
 * salon, et chacun entendrait le code des autres.
 */
export function checkUnverifiedRoleAccess(
  channel: VoiceBasedChannel,
  config: RaidProtectionConfig
): { ok: true } | { ok: false; reason: string } {
  if (!config.captchaUnverifiedRoleId) return { ok: false, reason: 'aucun rôle non-vérifié configuré' };

  const role = channel.guild.roles.cache.get(config.captchaUnverifiedRoleId);
  if (!role) return { ok: false, reason: 'rôle non-vérifié introuvable' };

  const rolePermissions = channel.permissionsFor(role);
  if (!rolePermissions?.has(PermissionFlagsBits.ViewChannel)) {
    return {
      ok: false,
      reason: `le rôle @${role.name} ne voit pas le salon vocal : il ne pourra jamais le rejoindre`,
    };
  }

  if (rolePermissions.has(PermissionFlagsBits.Connect)) {
    return {
      ok: false,
      reason: `le rôle @${role.name} peut rejoindre le salon vocal librement : retire-lui « Se connecter » sur ce salon, le bot l'accorde individuellement le temps de chaque tour`,
    };
  }

  return { ok: true };
}

// ── Entrée dans la file ───────────────────────────────────────────────────────

export type EnqueueResult =
  | { ok: true; position: number; estimatedWaitMs: number; immediate?: boolean }
  | { ok: false; reason: string };

/**
 * Le membre se déclare prêt (bouton dans le salon de vérification). On ne lui
 * demande pas d'attendre dans le vocal : il n'y entre qu'à son tour, seul.
 */
export async function enqueueMember(member: GuildMember, config: RaidProtectionConfig): Promise<EnqueueResult> {
  const guildId = member.guild.id;

  if (isQueued(guildId, member.id)) {
    return { ok: false, reason: 'déjà en file' };
  }

  const readiness = await checkVoiceReadiness(member.guild, config);
  if (!readiness.ok) return { ok: false, reason: readiness.reason };

  if (getQueueLength(guildId) >= config.captchaVoiceQueueLimit) {
    return { ok: false, reason: 'file saturée' };
  }

  const session = await prisma.captchaSession.findFirst({
    where: { guildId, userId: member.id, status: 'PENDING', mode: 'VOICE' },
    orderBy: { createdAt: 'desc' },
  });
  // Une session déjà basculée sur l'image n'est pas éligible : son code est tiré
  // dans l'alphabet image, que le pack vocal ne couvre pas entièrement.
  if (!session) return { ok: false, reason: 'aucune vérification vocale en cours' };

  // Section critique : aucun await jusqu'au push, sinon un clic concurrent
  // s'intercale. Les deux contrôles sont refaits ici, ceux d'avant les requêtes
  // n'étant que des raccourcis pour éviter un aller-retour en base inutile.
  if (isQueued(guildId, member.id)) return { ok: false, reason: 'déjà en file' };

  const queue = queueFor(guildId);
  if (queue.length >= config.captchaVoiceQueueLimit) {
    return { ok: false, reason: 'file saturée' };
  }
  queue.push({ userId: member.id, sessionId: session.id, code: session.code, enqueuedAt: Date.now() });

  void runQueue(member.guild, config);

  return {
    ok: true,
    position: queue.length,
    estimatedWaitMs: (queue.length - 1) * estimateTurnMs(normalizeVoiceLocale(config.captchaVoiceLocale)),
  };
}

export function dequeueMember(guildId: string, userId: string): void {
  removeFromQueue(guildId, userId);
}

// ── Ouverture et fermeture du salon pour un membre ────────────────────────────

async function openChannelFor(channel: VoiceBasedChannel, userId: string): Promise<boolean> {
  try {
    await channel.permissionOverwrites.edit(userId, { Connect: true, ViewChannel: true }, {
      reason: 'Captcha vocal : tour du membre',
    });
    return true;
  } catch (err) {
    logger.error('VoiceCaptcha', `Ouverture du salon impossible pour ${userId}`, err);
    return false;
  }
}

async function closeChannelFor(channel: VoiceBasedChannel, userId: string): Promise<void> {
  await channel.permissionOverwrites.delete(userId, 'Captcha vocal : fin du tour').catch((err) => {
    logger.warn('VoiceCaptcha', `Retrait de l'autorisation impossible pour ${userId}`, err);
  });
}

/** Attend que le membre rejoigne effectivement le salon, ou expire. */
function waitForJoin(guildId: string, userId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      joinWaiters.delete(guildId);
      resolve(false);
    }, timeoutMs);

    joinWaiters.set(guildId, {
      userId,
      resolve: () => {
        clearTimeout(timer);
        joinWaiters.delete(guildId);
        resolve(true);
      },
    });
  });
}

/**
 * Laisse au membre le temps de cliquer sur « Répéter » sans quitter le salon.
 * On scrute au lieu d'attendre d'un bloc, pour rendre la main dès qu'un autre
 * membre se met en file : sa réécoute ne doit pas leur coûter la fenêtre entière.
 */
async function awaitReplayRequest(
  guildId: string,
  replay: { requested: boolean },
  stillPresent: () => boolean
): Promise<boolean> {
  const deadline = Date.now() + REPLAY_GRACE_MS;

  while (Date.now() < deadline) {
    // Le clic a pu tomber pendant l'énonciation : on le consomme ici.
    if (replay.requested) {
      replay.requested = false;
      return true;
    }
    if (!stillPresent()) return false;
    // La propre entrée du membre occupe encore la file pendant son tour.
    if (getQueueLength(guildId) > 1) return false;
    await waitFor(400);
  }
  return false;
}

// ── Boucle de diffusion ───────────────────────────────────────────────────────

async function runQueue(guild: Guild, config: RaidProtectionConfig): Promise<void> {
  if (runningGuilds.has(guild.id)) return;
  runningGuilds.add(guild.id);

  const locale = normalizeVoiceLocale(config.captchaVoiceLocale);
  let connection: import('@discordjs/voice').VoiceConnection | null = null;

  try {
    const readiness = await checkVoiceReadiness(guild, config);
    if (!readiness.ok) {
      logger.warn('VoiceCaptcha', `File abandonnée sur ${guild.id} : ${readiness.reason}`);
      await drainQueueToImage(guild, config);
      return;
    }

    const voice = await importVoice();
    if (!voice) {
      await drainQueueToImage(guild, config);
      return;
    }

    connection = voice.joinVoiceChannel({
      channelId: readiness.channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, CONNECTION_READY_TIMEOUT_MS);

    const player = voice.createAudioPlayer({
      behaviors: { noSubscriber: voice.NoSubscriberBehavior.Play },
    });
    connection.subscribe(player);

    // On garde la connexion ouverte un moment après le dernier tour : pendant
    // une vague d'arrivées, se reconnecter à chaque membre coûterait plus cher
    // que d'attendre. La boucle scrute la file plutôt que de dormir d'un bloc,
    // sinon un arrivant patienterait tout le délai d'inactivité pour rien.
    let idleSince = Date.now();
    for (;;) {
      const entry = (queues.get(guild.id) ?? [])[0];

      if (!entry) {
        if (Date.now() - idleSince >= IDLE_DISCONNECT_MS) break;
        await waitFor(500);
        continue;
      }
      idleSince = Date.now();

      const member = await guild.members.fetch(entry.userId).catch(() => null);
      if (!member) {
        removeFromQueue(guild.id, entry.userId);
        continue;
      }

      // Contrôle avant d'ouvrir le salon : un code tiré sous une autre langue
      // serait énoncé amputé, et le membre échouerait jusqu'à la sanction sans
      // avoir commis d'erreur. L'image lui donne une chance équitable.
      if (!isCodeSpeakable(entry.code, locale)) {
        removeFromQueue(guild.id, entry.userId);
        logger.info('VoiceCaptcha', `Code inénonçable en ${locale} pour ${entry.userId}, bascule sur l'image`);
        const { deliverImageCaptcha } = await import('./captchaService.js');
        await deliverImageCaptcha(member, config, entry.sessionId).catch(() => null);
        continue;
      }

      await runTurn(entry, member, readiness.channel, config, voice, player);
    }
  } catch (err) {
    logger.error('VoiceCaptcha', `Erreur de la file vocale sur ${guild.id}`, err);
  } finally {
    // destroy() lève si la connexion est déjà détruite, ce qui arrive quand
    // Discord l'a coupée de son côté pendant la boucle.
    try {
      connection?.destroy();
    } catch {
      // Connexion déjà fermée, rien à libérer.
    }
    currentTurns.delete(guild.id);
    runningGuilds.delete(guild.id);

    // Une nouvelle arrivée pendant la fermeture aurait été ignorée : on relance.
    if ((queues.get(guild.id)?.length ?? 0) > 0) {
      void runQueue(guild, config);
    }
  }
}

async function runTurn(
  entry: QueueEntry,
  member: GuildMember,
  channel: VoiceBasedChannel,
  config: RaidProtectionConfig,
  voice: VoiceModule,
  player: import('@discordjs/voice').AudioPlayer
): Promise<void> {
  const guildId = member.guild.id;
  currentTurns.set(guildId, member.id);

  try {
    if (!(await openChannelFor(channel, member.id))) {
      removeFromQueue(guildId, entry.userId);
      return;
    }

    // L'attente est armée avant l'annonce : un membre réactif peut rejoindre
    // dans l'intervalle, et le signal serait perdu si le guetteur n'était posé
    // qu'après. Il patienterait alors la fenêtre entière, déjà sur place.
    const joinPromise = waitForJoin(guildId, member.id, JOIN_WINDOW_MS);
    await notifyTurn(member, config, channel);
    if (member.voice.channelId === channel.id) joinWaiters.get(guildId)?.resolve();

    const joined = await joinPromise;

    if (!joined) {
      // Pas de remise en file automatique : un membre absent bloquerait tout le
      // monde à chaque tour. Il repasse par le bouton quand il est réellement là.
      await notifyMissedTurn(member, config);
      return;
    }

    if (entry.sessionId) {
      // Le chrono ne démarre qu'ici : le temps passé en file n'est pas imputable
      // au membre, et le cron d'expiration expulserait sinon des légitimes.
      await prisma.captchaSession.update({
        where: { id: entry.sessionId },
        data: {
          awaitingTurn: false,
          expiresAt: new Date(Date.now() + config.captchaTimeoutMinutes * 60 * 1000),
        },
      }).catch(() => null);
    }

    // Le membre vient d'entrer : on le laisse s'installer avant de parler.
    await waitFor(JOIN_SETTLE_MS);

    const locale = normalizeVoiceLocale(config.captchaVoiceLocale);
    // Le guetteur reste armé pendant l'énonciation, pas seulement pendant la
    // fenêtre : un clic à ce moment-là doit être honoré ensuite, plutôt que de
    // répondre « déjà en file » à qui vient justement de mal entendre.
    const replay = { requested: false };

    for (let replays = 0; ; replays++) {
      const canReplayAgain = replays < MAX_REPLAYS_PER_TURN;
      // Budget épuisé : les clics suivants doivent repasser par la file, donc
      // le guetteur est retiré avant la dernière énonciation.
      if (canReplayAgain) replayWaiters.set(guildId, { userId: member.id, request: () => { replay.requested = true; } });
      else replayWaiters.delete(guildId);

      await speakCode(entry.code, locale, voice, player);
      await waitFor(POST_CODE_LINGER_MS);

      if (!canReplayAgain) break;
      if (!(await awaitReplayRequest(guildId, replay, () => member.voice.channelId === channel.id))) break;
    }
  } finally {
    removeFromQueue(guildId, entry.userId);
    currentTurns.delete(guildId);
    joinWaiters.delete(guildId);
    replayWaiters.delete(guildId);

    // Le membre sort du salon dès son code énoncé : le laisser sur place lui
    // ferait entendre celui du suivant, ce qui suffit à un attaquant
    // multi-comptes pour récolter les codes de tous les autres.
    if (member.voice.channelId === channel.id) {
      await member.voice.disconnect('Captcha vocal : code énoncé').catch(() => null);
    }
    await closeChannelFor(channel, member.id);
    await waitFor(BETWEEN_MEMBERS_MS);
  }
}

/** Diffuse le code caractère par caractère dans la connexion vocale active. */
async function speakCode(
  code: string,
  locale: VoiceLocale,
  voice: VoiceModule,
  player: import('@discordjs/voice').AudioPlayer
): Promise<void> {
  for (const symbol of code) {
    const clip = clipFor(symbol, locale);
    if (!clip) {
      // Sauter en silence donnerait un code tronqué, donc invalidable : le cas
      // arrive pour une session tirée avant une réduction de l'alphabet.
      logger.warn('VoiceCaptcha', `Aucun clip ${locale} pour le symbole ${symbol}, code amputé`);
      continue;
    }

    const resource = voice.createAudioResource(createReadStream(clip), {
      inputType: voice.StreamType.OggOpus,
    });
    player.play(resource);

    await voice.entersState(player, voice.AudioPlayerStatus.Playing, 5_000).catch(() => null);
    await voice.entersState(player, voice.AudioPlayerStatus.Idle, 15_000).catch(() => null);

    // Silence de longueur variable : un enregistrement du flux ne se découpe
    // pas mécaniquement en segments de durée fixe.
    await waitFor(crypto.randomInt(CLIP_GAP_MIN_MS, CLIP_GAP_MAX_MS));
  }

  player.stop();
}

// ── Messages au membre ────────────────────────────────────────────────────────

async function captchaChannel(guild: Guild, config: RaidProtectionConfig): Promise<TextChannel | null> {
  if (!config.captchaChannelId) return null;
  const channel = await guild.channels.fetch(config.captchaChannelId).catch(() => null);
  return channel?.isTextBased() ? (channel as TextChannel) : null;
}

async function notifyTurn(member: GuildMember, config: RaidProtectionConfig, voiceChannel: VoiceBasedChannel): Promise<void> {
  const channel = await captchaChannel(member.guild, config);
  if (!channel) return;

  const sent = await channel.send({
    content: `🔊 ${member}, c'est ton tour : rejoins <#${voiceChannel.id}> dans les **${Math.round(JOIN_WINDOW_MS / 1000)} secondes**. Tu y seras seul, le bot t'énoncera ton code.\n`
      // La fenêtre de réécoute sur place n'existe que si personne n'attend
      // derrière : ne la promettre que dans ce cas.
      + (getQueueLength(member.guild.id) > 1
        ? '🔁 Mal entendu ? Le bouton **Répéter le code** te remet en file pour une nouvelle énonciation.'
        : `🔁 Mal entendu ? Reste dans le salon et clique **Répéter le code** dans les **${Math.round(REPLAY_GRACE_MS / 1000)} secondes** qui suivent.`),
  }).catch(() => null);

  if (sent) setTimeout(() => sent.delete().catch(() => null), JOIN_WINDOW_MS + 30_000);
}

async function notifyMissedTurn(member: GuildMember, config: RaidProtectionConfig): Promise<void> {
  const channel = await captchaChannel(member.guild, config);
  if (!channel) return;

  const sent = await channel.send({
    content: `⏭️ ${member}, tu n'as pas rejoint le salon vocal à temps. Reclique sur le bouton quand tu es prêt.`,
  }).catch(() => null);

  if (sent) setTimeout(() => sent.delete().catch(() => null), 60_000);
}

// ── Répétition ────────────────────────────────────────────────────────────────

/**
 * Traite le bouton « Répéter le code », qu'il soit pressé après une énonciation
 * ou avant la première : réécoute sur place si le membre est encore dans le
 * salon, remise en file sinon.
 */
export async function replayCode(member: GuildMember): Promise<EnqueueResult> {
  // Encore dans le salon, dans sa fenêtre de réécoute : on lui réénonce sur
  // place plutôt que de le renvoyer au bout de la file.
  const waiter = replayWaiters.get(member.guild.id);
  if (waiter?.userId === member.id) {
    waiter.request();
    return { ok: true, position: 0, estimatedWaitMs: 0, immediate: true };
  }

  // Son tour est en cours, mais son budget de réécoute sur place est épuisé :
  // « déjà en file » serait faux, il est dans le salon.
  if (currentTurns.get(member.guild.id) === member.id) {
    return { ok: false, reason: 'limite de réécoutes atteinte pour ce tour' };
  }

  const config = await getRaidProtectionConfig(member.guild.id);
  if (!config) return { ok: false, reason: 'configuration introuvable' };

  if (isQueued(member.guild.id, member.id)) return { ok: false, reason: 'déjà en file' };

  const readiness = await checkVoiceReadiness(member.guild, config);
  if (!readiness.ok) return { ok: false, reason: readiness.reason };

  if (getQueueLength(member.guild.id) >= config.captchaVoiceQueueLimit) {
    return { ok: false, reason: 'file saturée' };
  }

  // Le mode doit être contrôlé : une session déjà basculée sur l'image porte un
  // code tiré dans l'alphabet image, dont plusieurs symboles n'ont aucun clip.
  // L'énoncer donnerait un code amputé, invalidable, et occuperait une place
  // dans une file sérielle.
  const session = await prisma.captchaSession.findFirst({
    where: { guildId: member.guild.id, userId: member.id, status: 'PENDING', mode: 'VOICE' },
    orderBy: { createdAt: 'desc' },
  });
  if (!session) return { ok: false, reason: 'aucune vérification vocale en cours' };

  // Section critique : aucun await jusqu'au push, voir queueFor.
  if (isQueued(member.guild.id, member.id)) return { ok: false, reason: 'déjà en file' };

  const queue = queueFor(member.guild.id);
  if (queue.length >= config.captchaVoiceQueueLimit) {
    return { ok: false, reason: 'file saturée' };
  }
  // awaitingTurn distingue le membre qui n'a jamais entendu son code, dont le
  // chrono doit démarrer à l'énonciation, de la simple répétition.
  queue.push({
    userId: member.id,
    sessionId: session.awaitingTurn ? session.id : null,
    code: session.code,
    enqueuedAt: Date.now(),
  });

  void runQueue(member.guild, config);

  return {
    ok: true,
    position: queue.length,
    estimatedWaitMs: (queue.length - 1) * estimateTurnMs(normalizeVoiceLocale(config.captchaVoiceLocale)),
  };
}

// ── Repli et nettoyage ────────────────────────────────────────────────────────

/** Bascule tous les membres encore en file vers le captcha image. */
async function drainQueueToImage(guild: Guild, config: RaidProtectionConfig): Promise<void> {
  const queue = queues.get(guild.id) ?? [];
  queues.delete(guild.id);

  const { deliverImageCaptcha } = await import('./captchaService.js');
  for (const entry of queue) {
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member) continue;
    await deliverImageCaptcha(member, config, entry.sessionId).catch(() => null);
  }
}

/**
 * Au démarrage : un arrêt en plein tour laisse derrière lui des autorisations
 * individuelles sur le salon vocal, qui ouvriraient le salon à ces membres
 * lors du tour de quelqu'un d'autre.
 */
export async function sweepStaleOverwrites(client: Client): Promise<void> {
  const configs = await prisma.raidProtectionConfig.findMany({
    where: { captchaEnabled: true, captchaMode: 'VOICE', captchaVoiceChannelId: { not: null } },
    select: { guildId: true, captchaVoiceChannelId: true },
  });

  for (const { guildId, captchaVoiceChannelId } of configs) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild || !captchaVoiceChannelId) continue;

    const channel = await guild.channels.fetch(captchaVoiceChannelId).catch(() => null);
    if (!channel?.isVoiceBased()) continue;

    // On ne balaie que les membres passés par le captcha. Supprimer toutes les
    // autorisations individuelles effacerait aussi celles qu'un administrateur
    // aurait posées à la main sur ce salon.
    const known = await prisma.captchaSession.findMany({
      where: { guildId },
      select: { userId: true },
      distinct: ['userId'],
    });
    const knownIds = new Set(known.map((session) => session.userId));

    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.type !== OverwriteType.Member) continue;
      if (!knownIds.has(overwrite.id)) continue;
      await overwrite.delete('Captcha vocal : nettoyage au démarrage').catch(() => null);
    }

    for (const member of channel.members.values()) {
      if (member.user.bot) continue;
      if (!knownIds.has(member.id)) continue;
      await member.voice.disconnect('Captcha vocal : nettoyage au démarrage').catch(() => null);
    }
  }
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

type VoiceModule = typeof import('@discordjs/voice');
let voiceModule: VoiceModule | null | undefined;

/**
 * Import paresseux : @discordjs/voice est une dépendance lourde et optionnelle.
 * Si elle manque, le bot doit continuer de tourner et le captcha se replier sur
 * l'image, pas refuser de démarrer.
 */
async function importVoice(): Promise<VoiceModule | null> {
  if (voiceModule !== undefined) return voiceModule;
  try {
    voiceModule = await import('@discordjs/voice');
  } catch (err) {
    logger.warn('VoiceCaptcha', '@discordjs/voice absent : captcha vocal désactivé', err);
    voiceModule = null;
  }
  return voiceModule;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Événements vocaux ─────────────────────────────────────────────────────────

export async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
  const guild = newState.guild ?? oldState.guild;
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;
  if (oldState.channelId === newState.channelId) return;

  const config = await getRaidProtectionConfig(guild.id);
  if (!config?.captchaEnabled || config.captchaMode !== 'VOICE' || !config.captchaVoiceChannelId) return;
  if (newState.channelId !== config.captchaVoiceChannelId) return;

  if (currentTurns.get(guild.id) === member.id) {
    const waiter = joinWaiters.get(guild.id);
    if (waiter?.userId === member.id) waiter.resolve();
    return;
  }

  // Garde-fou : même si les permissions du salon dérivent, aucun membre en
  // cours de vérification ne reste dans la pièce hors de son tour. C'est ce qui
  // rend l'isolation réelle plutôt que dépendante d'une configuration correcte.
  // Le staff, lui, doit pouvoir entrer librement : il n'a pas le rôle
  // non-vérifié, et l'éjecter de son propre salon serait absurde.
  if (config.captchaUnverifiedRoleId && member.roles.cache.has(config.captchaUnverifiedRoleId)) {
    await member.voice.disconnect('Captcha vocal : ce n\'est pas ton tour').catch(() => null);
  }
}
