import { normalizeEmoji, readTriggerEmojiFilter, readTriggerMessageFilter, type WorkflowGraph } from '@kotbo/shared';

/**
 * La réaction passe-t-elle les filtres de messages et d'émojis du
 * déclencheur ? Un filtre vide laisse tout passer ; un événement sans message
 * ou sans émoji ne passe pas un filtre posé.
 */
export function matchesTriggerReactionFilter(graph: WorkflowGraph, payload: Record<string, unknown>): boolean {
  const messages = readTriggerMessageFilter(graph);
  if (messages.length > 0 && !(typeof payload.messageId === 'string' && messages.includes(payload.messageId))) {
    return false;
  }

  const emojis = readTriggerEmojiFilter(graph);
  if (emojis.length > 0 && !(typeof payload.emoji === 'string' && emojis.includes(normalizeEmoji(payload.emoji)))) {
    return false;
  }

  return true;
}
