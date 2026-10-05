/**
 * File d'attente des analyses AegisAI.
 *
 * L'API sert ~15 requêtes par seconde au mieux, tous serveurs confondus, et
 * chaque message en coûte deux. Les messages ne sont donc jamais notés sur le
 * chemin de `MessageCreate` : ils entrent ici et sortent dans l'ordre
 * d'arrivée, deux à la fois (au-delà, le débit de l'API n'augmente plus).
 *
 * Deux voies :
 * - priorité haute : ce qui peut mener à une action de modération ;
 * - priorité basse : ce qui ne sert qu'aux statistiques d'émotions.
 *
 * Quand la file s'allonge, on lâche d'abord les émotions, puis tout au-delà
 * d'un plafond. Un message noté trop tard n'est plus supprimé d'office : il
 * part en revue (voir `isLate`).
 *
 * BullMQ quand Redis répond : la file survit à un redéploiement. Sinon une
 * file en mémoire, mêmes règles.
 */
import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { createRedisForWorker } from '../../../infra/redis.js';
import { logger } from '../../../utils/logger.js';

export type AegisJobSource = 'MESSAGE' | 'EDIT' | 'NICKNAME';

export type AegisJob = {
  source: AegisJobSource;
  guildId: string;
  /** Salon du message (le fil lui-même pour un fil). */
  channelId: string;
  /** Salon de rattachement des statistiques (le parent pour un fil). */
  statsChannelId: string;
  messageId: string | null;
  authorId: string;
  /** Texte préparé (aegisText.prepareText). */
  text: string;
  /** Extrait brut, conservé si une détection est créée. */
  excerpt: string;
  /** Membre visé : auteur du message auquel on répond, ou unique mention. */
  targetUserId: string | null;
  /** Note de toxicité utile (modération active et membre non exempté). */
  wantToxicity: boolean;
  /** Émotion utile (statistiques, escalade, détresse, tickets). */
  wantEmotion: boolean;
  /** Le message compte dans les statistiques (collecte Analytics autorisée). */
  countStats: boolean;
  enqueuedAt: number;
};

export type AegisProcessor = (job: AegisJob) => Promise<void>;

export type EnqueueOutcome = 'queued' | 'queued_without_emotion' | 'dropped';

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const QUEUE_LIMITS = {
  concurrency: readPositiveInt(process.env.AEGISAI_CONCURRENCY, 2),
  /** Au-delà, les émotions ne sont plus demandées. */
  emotionShedDepth: readPositiveInt(process.env.AEGISAI_EMOTION_SHED_DEPTH, 300),
  /** Au-delà, plus rien n'entre. */
  maxDepth: readPositiveInt(process.env.AEGISAI_QUEUE_MAX, 5000),
  /** Âge au-delà duquel une note ne déclenche plus d'action automatique. */
  staleMs: readPositiveInt(process.env.AEGISAI_STALE_MS, 120_000),
};

/** Note arrivée trop tard pour supprimer le message sans dérouter le salon. */
export function isLate(job: Pick<AegisJob, 'enqueuedAt'>, now = Date.now()): boolean {
  return now - job.enqueuedAt > QUEUE_LIMITS.staleMs;
}

/**
 * Décide du sort d'un job selon la profondeur de la file. Pur, pour les tests.
 * Un job qui ne voulait que l'émotion disparaît avec elle.
 */
export function admitJob(job: AegisJob, depth: number, limits = QUEUE_LIMITS): { job: AegisJob | null; outcome: EnqueueOutcome } {
  if (depth >= limits.maxDepth) return { job: null, outcome: 'dropped' };
  if (depth >= limits.emotionShedDepth && job.wantEmotion) {
    if (!job.wantToxicity) return { job: null, outcome: 'dropped' };
    return { job: { ...job, wantEmotion: false }, outcome: 'queued_without_emotion' };
  }
  return { job, outcome: 'queued' };
}

export type AegisQueueStats = {
  backend: 'redis' | 'memory' | 'stopped';
  depth: number;
  active: number;
  processed: number;
  failed: number;
  dropped: number;
  emotionsShed: number;
};

const counters = { processed: 0, failed: 0, dropped: 0, emotionsShed: 0 };

// ── Backend mémoire ──────────────────────────────────────────────────────────

class MemoryQueue {
  private high: AegisJob[] = [];
  private low: AegisJob[] = [];
  private active = 0;

  constructor(private readonly processor: AegisProcessor, private readonly concurrency: number) {}

  get depth(): number {
    return this.high.length + this.low.length;
  }

  get running(): number {
    return this.active;
  }

  push(job: AegisJob): void {
    (job.wantToxicity ? this.high : this.low).push(job);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const job = this.high.shift() ?? this.low.shift();
      if (!job) return;
      this.active += 1;
      void this.processor(job)
        .then(() => { counters.processed += 1; })
        .catch((error) => {
          counters.failed += 1;
          logger.warn('AegisQueue', 'Analyse en échec :', error);
        })
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}

// ── Backend Redis ────────────────────────────────────────────────────────────

const QUEUE_NAME = 'kotbo-aegis';
const DEPTH_REFRESH_MS = 1000;

let processorRef: AegisProcessor | null = null;
let memory: MemoryQueue | null = null;
let queue: Queue<AegisJob> | null = null;
let worker: Worker<AegisJob> | null = null;
let connections: Redis[] = [];
let redisDepth = 0;
let depthTimer: ReturnType<typeof setInterval> | null = null;

async function refreshRedisDepth(): Promise<void> {
  if (!queue) return;
  try {
    redisDepth = await queue.getWaitingCount() + await queue.getPrioritizedCount();
  } catch {
    // Profondeur inconnue un instant : on garde la dernière lue.
  }
}

async function startRedisBackend(processor: AegisProcessor): Promise<boolean> {
  const queueConnection = createRedisForWorker();
  const workerConnection = createRedisForWorker();
  if (!queueConnection || !workerConnection) return false;
  try {
    await queueConnection.connect();
    await workerConnection.connect();
    queue = new Queue<AegisJob>(QUEUE_NAME, {
      connection: queueConnection,
      // Le texte d'un message n'a rien à faire dans Redis une fois noté.
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 100, attempts: 2, backoff: { type: 'exponential', delay: 2000 } },
    });
    worker = new Worker<AegisJob>(
      QUEUE_NAME,
      async (job: Job<AegisJob>) => processor(job.data),
      // Le traitement attend l'API quand le coupe-circuit est ouvert (30 s) :
      // le verrou doit tenir plus longtemps pour ne pas passer pour bloqué.
      { connection: workerConnection, concurrency: QUEUE_LIMITS.concurrency, lockDuration: 90_000 },
    );
    worker.on('completed', () => { counters.processed += 1; });
    worker.on('failed', (_job, error) => {
      counters.failed += 1;
      logger.warn('AegisQueue', 'Analyse en échec :', error);
    });
    connections = [queueConnection, workerConnection];
    depthTimer = setInterval(() => void refreshRedisDepth(), DEPTH_REFRESH_MS);
    if (typeof depthTimer.unref === 'function') depthTimer.unref();
    return true;
  } catch (error) {
    logger.warn('AegisQueue', 'File Redis indisponible, repli en mémoire :', error);
    await worker?.close().catch(() => undefined);
    await queue?.close().catch(() => undefined);
    worker = null;
    queue = null;
    queueConnection.disconnect();
    workerConnection.disconnect();
    return false;
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

/** Démarre la file. Le processeur est celui d'aegisProcessor.ts. */
export async function startAegisQueue(processor: AegisProcessor): Promise<void> {
  if (processorRef) return;
  processorRef = processor;
  if (await startRedisBackend(processor)) {
    logger.success('AegisQueue', `File AegisAI sur Redis (${QUEUE_LIMITS.concurrency} en parallèle).`);
    return;
  }
  memory = new MemoryQueue(processor, QUEUE_LIMITS.concurrency);
  logger.info('AegisQueue', `File AegisAI en mémoire (${QUEUE_LIMITS.concurrency} en parallèle).`);
}

export async function stopAegisQueue(): Promise<void> {
  if (depthTimer) clearInterval(depthTimer);
  depthTimer = null;
  await worker?.close().catch(() => undefined);
  await queue?.close().catch(() => undefined);
  for (const connection of connections) connection.disconnect();
  connections = [];
  worker = null;
  queue = null;
  memory = null;
  processorRef = null;
}

export function aegisQueueDepth(): number {
  if (queue) return redisDepth;
  return memory?.depth ?? 0;
}

export async function enqueueAegisJob(job: AegisJob): Promise<EnqueueOutcome> {
  if (!processorRef) return 'dropped';
  const admitted = admitJob(job, aegisQueueDepth());
  if (!admitted.job) {
    counters.dropped += 1;
    return admitted.outcome;
  }
  if (admitted.outcome === 'queued_without_emotion') counters.emotionsShed += 1;

  if (queue) {
    try {
      // Priorité BullMQ : plus petit = plus tôt. FIFO à priorité égale.
      await queue.add(admitted.job.source, admitted.job, { priority: admitted.job.wantToxicity ? 1 : 10 });
      redisDepth += 1;
      return admitted.outcome;
    } catch (error) {
      logger.warn('AegisQueue', 'Enfilage Redis impossible, traitement en mémoire :', error);
      memory ??= new MemoryQueue(processorRef, QUEUE_LIMITS.concurrency);
    }
  }
  memory?.push(admitted.job);
  return admitted.outcome;
}

export async function getAegisQueueStats(): Promise<AegisQueueStats> {
  let active = memory?.running ?? 0;
  if (queue) active += await queue.getActiveCount().catch(() => 0);
  return {
    backend: queue ? 'redis' : memory ? 'memory' : 'stopped',
    depth: aegisQueueDepth(),
    active,
    ...counters,
  };
}
