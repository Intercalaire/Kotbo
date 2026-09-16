import { readTriggerChannelFilter, type WorkflowGraph } from '@kotbo/shared';

/** Ce que le filtre lit du serveur : de quoi remonter d'un salon à son parent. */
export interface ChannelTree {
  channels: { cache: { get(id: string): unknown } };
}

function parentOf(guild: ChannelTree, channelId: string): string | null {
  const channel = guild.channels.cache.get(channelId) as { parentId?: string | null } | undefined;
  return channel?.parentId ?? null;
}

/**
 * Le salon de l'événement passe-t-il le filtre du déclencheur ?
 *
 * Un salon retenu couvre aussi ses fils, et une catégorie retenue couvre ses
 * salons et leurs fils : on remonte donc jusqu'à deux parents. Un événement
 * sans salon ne passe pas un filtre posé, faute de pouvoir le vérifier.
 */
export function matchesTriggerChannelFilter(
  guild: ChannelTree,
  graph: WorkflowGraph,
  payload: Record<string, unknown>,
): boolean {
  const allowed = readTriggerChannelFilter(graph);
  if (allowed.length === 0) return true;

  let channelId = typeof payload.channelId === 'string' ? payload.channelId : null;
  for (let depth = 0; channelId && depth < 3; depth += 1) {
    if (allowed.includes(channelId)) return true;
    channelId = parentOf(guild, channelId);
  }
  return false;
}
