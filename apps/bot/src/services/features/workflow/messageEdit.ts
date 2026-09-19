import type { MessageUpdateEvent } from '@kotbo/core';

/**
 * Écart maximal entre la date de modification d'un message et sa mise à jour.
 * Un aperçu de lien ajouté à un message modifié il y a longtemps porte encore
 * l'ancienne date : sans cette borne, il passerait pour une nouvelle édition.
 */
const MESSAGE_EDIT_FRESHNESS_MS = 60_000;

/**
 * La mise à jour est-elle une vraie modification du texte ? Discord en publie
 * aussi pour l'aperçu d'un lien ou un épinglage. Une édition se reconnaît à une
 * date de modification récente et, quand l'ancien texte est connu, à un texte
 * différent.
 */
export function isMessageEdit(payload: MessageUpdateEvent): boolean {
  if (!payload.authorId || payload.newContent === null) return false;
  if (typeof payload.editedTimestamp !== 'number') return false;
  if (payload.timestamp - payload.editedTimestamp > MESSAGE_EDIT_FRESHNESS_MS) return false;
  return payload.oldContent === null || payload.oldContent !== payload.newContent;
}
