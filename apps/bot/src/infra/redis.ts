import Redis, { Cluster } from 'ioredis';
import type { RedisOptions, ClusterOptions, ClusterNode } from 'ioredis';
import { logger } from '../utils/logger.js';

type RedisLike = Redis | Cluster;

let sharedRedis: RedisLike | null = null;
let redisDisabled = false;
let clusterMode = false;

function getRedisConnectionInput(): { url?: string; host?: string; port?: number; password?: string } {
  const url = process.env.REDIS_URL;
  if (url) return { url };

  const host = process.env.REDIS_HOST;
  if (!host) return {};

  const port = Number.parseInt(process.env.REDIS_PORT ?? '6379', 10);
  const password = process.env.REDIS_PASSWORD;
  return { host, port: Number.isNaN(port) ? 6379 : port, password };
}

function parseClusterNodes(): ClusterNode[] | null {
  const raw = process.env.REDIS_CLUSTER_NODES;
  if (!raw) return null;

  return raw.split(',').map((node) => {
    const [host, portStr] = node.trim().split(':');
    return { host: host || '127.0.0.1', port: Number.parseInt(portStr || '6379', 10) };
  });
}

function buildRedisOptions(extra?: RedisOptions): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableReadyCheck: true,
    ...extra,
  };
}

function createClient(extra?: RedisOptions): Redis | null {
  const conn = getRedisConnectionInput();

  if (!conn.url && !conn.host) {
    return null;
  }

  if (conn.url) {
    return new Redis(conn.url, buildRedisOptions(extra));
  }

  return new Redis({
    host: conn.host,
    port: conn.port,
    password: conn.password,
    ...buildRedisOptions(extra),
  });
}

function createCluster(extra?: Partial<ClusterOptions>): Cluster | null {
  const nodes = parseClusterNodes();
  if (!nodes || nodes.length === 0) return null;

  const password = process.env.REDIS_PASSWORD;

  return new Cluster(nodes, {
    redisOptions: {
      password: password || undefined,
      maxRetriesPerRequest: null,
      ...extra?.redisOptions,
    },
    lazyConnect: true,
    enableReadyCheck: true,
    scaleReads: 'slave',
    ...extra,
  });
}

export async function initRedis(): Promise<RedisLike | null> {
  if (sharedRedis) return sharedRedis;
  if (redisDisabled) return null;

  // Cluster mode takes priority
  const cluster = createCluster();
  if (cluster) {
    try {
      await cluster.connect();
      await cluster.ping();
      sharedRedis = cluster;
      clusterMode = true;
      logger.success('Redis', `Connexion Redis Cluster établie (${parseClusterNodes()!.length} noeud(s)).`);
      return sharedRedis;
    } catch (error) {
      logger.error('Redis', 'Impossible de se connecter au Cluster Redis:', error);
      cluster.disconnect();
    }
  }

  // Fallback: single node
  const client = createClient();
  if (!client) {
    redisDisabled = true;
    logger.warn('Redis', 'Redis désactivé: REDIS_URL/REDIS_HOST absent.');
    return null;
  }

  try {
    await client.connect();
    await client.ping();
    sharedRedis = client;
    clusterMode = false;
    logger.success('Redis', 'Connexion Redis (single node) établie.');
    return sharedRedis;
  } catch (error) {
    logger.error('Redis', 'Impossible de se connecter à Redis:', error);
    client.disconnect();
    redisDisabled = true;
    return null;
  }
}

export function createRedisForWorker(): Redis | null {
  if (redisDisabled) return null;
  return createClient({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function getRedis(): RedisLike | null {
  return sharedRedis;
}

export function isClusterMode(): boolean {
  return clusterMode;
}

export async function assertRedisConnection(): Promise<void> {
  const client = sharedRedis ?? await initRedis();
  if (!client) {
    throw new Error(
      'Redis indisponible - BullMQ requiert une connexion Redis active. ' +
      'Configurez REDIS_URL ou REDIS_HOST (ou REDIS_CLUSTER_NODES pour le mode cluster).'
    );
  }
  try {
    await client.ping();
  } catch (err) {
    throw new Error(`Redis indisponible - ping échoué: ${String(err)}`);
  }
}
