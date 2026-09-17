/**
 * Surnoms posés par l'action « Changer le surnom ».
 *
 * Discord renvoie la modification comme n'importe quelle autre, par la
 * passerelle et donc hors de la profondeur de cascade : « quand un surnom
 * change, ajouter un préfixe » se relancerait sans fin. L'action annonce le
 * surnom qu'elle pose, et le déclencheur ignore la mise à jour qui lui répond.
 * Mémoire du processus : l'événement revient sur le shard qui a agi.
 */

const ECHO_TTL_MS = 30_000;

const expected = new Map<string, number>();

function echoKey(guildId: string, userId: string, nickname: string | null): string {
  return `${guildId}:${userId}:${(nickname ?? '').trim()}`;
}

/** Annonce un surnom sur le point d'être posé ; la fonction rendue l'oublie. */
export function expectBotNickname(guildId: string, userId: string, nickname: string | null, now = Date.now()): () => void {
  for (const [key, expiresAt] of expected) {
    if (expiresAt <= now) expected.delete(key);
  }
  const key = echoKey(guildId, userId, nickname);
  expected.set(key, now + ECHO_TTL_MS);
  return () => { expected.delete(key); };
}

/** La mise à jour répond-elle à un surnom posé par le bot ? Ne répond qu'une fois. */
export function isBotNicknameEcho(guildId: string, userId: string, nickname: string | null, now = Date.now()): boolean {
  const key = echoKey(guildId, userId, nickname);
  const expiresAt = expected.get(key);
  if (expiresAt === undefined) return false;
  expected.delete(key);
  return expiresAt > now;
}
