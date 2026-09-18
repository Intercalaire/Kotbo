import { Collection, Guild, GuildMember } from 'discord.js';
import { logger } from './logger.js';

/** Fetches all members, falling back to paginated REST if gateway chunking fails, is disabled, or truncates. */
export async function fetchAllMembers(guild: Guild): Promise<Collection<string, GuildMember>> {
  try {
    const members = await guild.members.fetch();
    if (members && members.size > 0 && members.size >= (guild.memberCount ?? 0)) {
      return members;
    }
    logger.warn('DiscordUtils', `Gateway member fetch returned ${members?.size} out of ${guild.memberCount} members for guild ${guild.id}. Falling back to paginated fetch.`);
  } catch (err) {
    logger.warn('DiscordUtils', `Gateway member fetch failed or timed out for guild ${guild.id}: ${String(err)}. Falling back to paginated fetch.`);
  }

  const allMembers = new Collection<string, GuildMember>();
  let lastId: string | undefined = undefined;

  for (;;) {
    try {
      const options: Record<string, unknown> = { limit: 1000 };
      if (lastId) {
        options.after = lastId;
      }
      
      const chunk = await guild.members.list(options);
      if (!chunk || chunk.size === 0) {
        break;
      }

      for (const [id, member] of chunk.entries()) {
        allMembers.set(id, member);
        guild.members.cache.set(id, member);
      }

      // Snowflake IDs sort correctly as strings; the last one after sort() is the newest in the chunk.
      const sortedKeys = Array.from(chunk.keys()).sort() as string[];
      lastId = sortedKeys[sortedKeys.length - 1];

      if (chunk.size < 1000) {
        break;
      }
    } catch (restErr) {
      logger.error('DiscordUtils', `Error in paginated REST member fetch: ${String(restErr)}`);
      break;
    }
  }

  if (allMembers.size > 0) {
    return allMembers;
  }
  
  return guild.members.cache;
}

/**
 * Résultat d'un appel Discord borné dans le temps : `done` (a abouti), `failed` (refusé, définitif)
 * ou `pending` (rien reçu dans le délai) - les confondre annonce une attente là où il y a un refus.
 */
export type Settled<T> = { status: 'done'; value: T } | { status: 'failed'; error: unknown } | { status: 'pending' };

/**
 * Attend un appel Discord sans s'y suspendre indéfiniment et rapporte laquelle des trois issues de `Settled`
 * s'est produite. Contrat différent des trois `withTimeout` du dépôt (qui rejettent, rendent `null` ou
 * créent un signal d'abandon) : celui-ci ne tranche rien, il rapporte - nécessaire car `@discordjs/rest`
 * n'a pas `rejectOnRateLimit` et ne rejette donc jamais sur une limite de débit, il attend la fenêtre
 * (parfois plusieurs minutes) puis rejoue, si bien qu'un `.catch` ne voit jamais ce cas : c'est
 * l'interaction Discord ou la requête HTTP du dashboard qui expire en premier.
 */
export async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'pending' }), timeoutMs);
  });

  try {
    return await Promise.race([
      promise.then(
        (value) => ({ status: 'done', value } as const),
        (error: unknown) => ({ status: 'failed', error } as const),
      ),
      pending,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Au-delà, mieux vaut dire que Discord temporise que faire attendre. */
export const RENAME_TIMEOUT_MS = 2_500;
