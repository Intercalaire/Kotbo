/**
 * Traitement d'un job de la file AegisAI : notes, statistiques, décision de
 * modération et modules dérivés.
 *
 * Une panne d'AegisAI ne laisse pas passer une insulte évidente : la liste de
 * mots bannis du serveur prend le relais et envoie le message en revue (jamais
 * d'action automatique sur ce seul repli).
 */
import type { Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { containsBannedWord, loadBannedWords } from '../bannedWordsService.js';
import { AegisUnavailableError, getAegisClient, type EmotionResult } from './aegisClient.js';
import { getAegisConfig, type AegisRuntimeConfig } from './aegisConfig.js';
import { isLate, type AegisJob } from './aegisQueue.js';
import { recordAegisObservation } from './aegisStats.js';
import { chunkText, textFingerprint } from './aegisText.js';
import { ConflictTracker, CooldownGate, HarassmentTracker, decideToxicity, isDistress, isHeated } from './aegisSignals.js';
import { handleToxic } from './aegisActions.js';
import { raiseConflict, raiseDistress, raiseHarassment, updateTicketMood } from './aegisModules.js';

let discordClient: Client | null = null;

export function setAegisDiscordClient(client: Client): void {
  discordClient = client;
}

// ── Cache des notes ─────────────────────────────────────────────────────────
// Un raid copie-colle le même texte des centaines de fois : une note suffit.

const RESULT_TTL_MS = 10 * 60_000;
const RESULT_MAX = 5000;
const toxicityCache = new Map<string, { value: number; at: number }>();
const emotionCache = new Map<string, { value: EmotionResult; at: number }>();

function cached<T>(map: Map<string, { value: T; at: number }>, key: string): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > RESULT_TTL_MS) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

function remember<T>(map: Map<string, { value: T; at: number }>, key: string, value: T): void {
  map.set(key, { value, at: Date.now() });
  if (map.size > RESULT_MAX) map.delete(map.keys().next().value!);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Attend la réouverture du circuit plutôt que de perdre le job. */
async function waitForApi(): Promise<void> {
  const api = getAegisClient();
  if (!api.available && api.configured) await sleep(Math.min(api.retryInMs, 30_000));
}

/** Pire note des morceaux du texte ; on s'arrête dès qu'un morceau franchit le seuil automatique. */
async function scoreToxicity(text: string, save: boolean, autoThreshold: number): Promise<number> {
  const key = textFingerprint(text);
  const hit = cached(toxicityCache, key);
  if (hit !== undefined) return hit;
  let worst = 0;
  for (const chunk of chunkText(text)) {
    const { toxicity } = await getAegisClient().toxicity(chunk, save);
    worst = Math.max(worst, toxicity);
    if (worst * 100 >= autoThreshold) break;
  }
  remember(toxicityCache, key, worst);
  return worst;
}

async function scoreEmotion(text: string): Promise<EmotionResult> {
  const key = textFingerprint(text);
  const hit = cached(emotionCache, key);
  if (hit) return hit;
  const result = await getAegisClient().emotion(chunkText(text)[0]!);
  remember(emotionCache, key, result);
  return result;
}

// ── Modules ─────────────────────────────────────────────────────────────────

const conflicts = new ConflictTracker();
const harassment = new HarassmentTracker();
const distressGate = new CooldownGate();

async function runModules(job: AegisJob, config: AegisRuntimeConfig, toxicity: number | undefined, emotion: EmotionResult | undefined): Promise<void> {
  const client = discordClient;
  const guild = client?.guilds.cache.get(job.guildId);
  if (!client || !guild) return;
  const now = Date.now();
  const toxicEnough = toxicity !== undefined && toxicity * 100 >= config.reviewThreshold;

  if (config.harassmentEnabled && toxicEnough && job.targetUserId && job.targetUserId !== job.authorId) {
    const outcome = harassment.record(`${job.guildId}:${job.authorId}>${job.targetUserId}`, now, {
      windowMs: config.harassmentWindowMin * 60_000,
      threshold: config.harassmentThreshold,
    });
    if (outcome.triggered) await raiseHarassment(client, guild, job, config, outcome.count);
  }

  if (config.conflictEnabled && isHeated(toxicity, emotion, config.reviewThreshold)) {
    const outcome = conflicts.record(`${job.guildId}:${job.channelId}`, job.authorId, now, {
      windowMs: config.conflictWindowSec * 1000,
      threshold: config.conflictMessageThreshold,
      cooldownMs: config.conflictDurationMin * 60_000,
    });
    if (outcome.triggered) await raiseConflict(client, guild, job, config, outcome.authors, outcome.count);
  }

  const distress = isDistress(emotion, toxicity, config);
  if (config.distressEnabled && distress && emotion) {
    if (distressGate.tryPass(`${job.guildId}:${job.authorId}`, now, config.distressCooldownHours * 3_600_000)) {
      await raiseDistress(guild, job, config, emotion, toxicity);
    }
  }

  if (config.analyzeTickets) await updateTicketMood(job, config, emotion, toxicity, distress);
}

// ── Traitement ──────────────────────────────────────────────────────────────

export async function processAegisJob(job: AegisJob): Promise<void> {
  const config = await getAegisConfig(job.guildId);
  if (!config) return;
  const api = getAegisClient();
  if (!api.configured) return;
  await waitForApi();

  let toxicity: number | undefined;
  let fallbackHit = false;
  if (job.wantToxicity) {
    try {
      toxicity = await scoreToxicity(job.text, config.trainingConsent === true, config.autoThreshold);
    } catch (error) {
      const words = await loadBannedWords(job.guildId).catch(() => [] as string[]);
      fallbackHit = containsBannedWord(job.text, words);
      if (!(error instanceof AegisUnavailableError)) logger.warn('AegisAI', `Toxicité non notée (${job.guildId}) :`, error);
    }
  }

  let emotion: EmotionResult | undefined;
  // Les émotions d'un message en retard de plus de 15 min ne servent plus
  // qu'aux statistiques : sous forte charge on les laisse.
  if (job.wantEmotion && Date.now() - job.enqueuedAt < 15 * 60_000) {
    emotion = await scoreEmotion(job.text).catch(() => undefined);
  }

  if (job.countStats && job.source === 'MESSAGE') {
    recordAegisObservation({
      guildId: job.guildId,
      channelId: job.statsChannelId,
      userId: job.authorId,
      at: new Date(job.enqueuedAt),
      toxicity,
      emotion: emotion?.label,
      reviewThreshold: config.reviewThreshold,
      autoThreshold: config.autoThreshold,
    });
  }

  const client = discordClient;
  const guild = client?.guilds.cache.get(job.guildId);
  if (!client || !guild) return;

  if (toxicity !== undefined || fallbackHit) {
    const late = isLate(job);
    const decision = toxicity !== undefined ? decideToxicity(toxicity, config, late) : 'review';
    if (decision !== 'none') {
      await handleToxic({ client, guild, job, config, toxicity: toxicity ?? null, emotion, late, decision });
    }
  }

  if (job.source === 'MESSAGE') await runModules(job, config, toxicity, emotion);
}
