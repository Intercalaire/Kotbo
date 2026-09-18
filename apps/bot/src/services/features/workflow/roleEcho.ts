/**
 * Rôles posés par les actions « Donner un rôle » et « Retirer un rôle ».
 *
 * Même cause que pour les surnoms (voir `nicknameEcho.ts`) : Discord renvoie
 * le changement par la passerelle, donc hors de la profondeur de cascade. Deux
 * automatisations banales bouclent alors sans fin — « quand ce rôle est ajouté,
 * le retirer » face à « quand ce rôle est retiré, l'ajouter » — chaque tour
 * repartant de zéro. L'action annonce le changement qu'elle pose, et le
 * déclencheur ignore la mise à jour qui lui répond.
 *
 * Mémoire du processus : l'événement revient sur le shard qui a agi.
 */

const ECHO_TTL_MS = 30_000;

export type RoleChangeKind = 'added' | 'removed';

const expected = new Map<string, number>();

function echoKey(guildId: string, userId: string, roleId: string, kind: RoleChangeKind): string {
  return `${guildId}:${userId}:${roleId}:${kind}`;
}

/** Annonce un changement de rôle sur le point d'être posé ; la fonction rendue l'oublie. */
export function expectBotRoleChange(
  guildId: string,
  userId: string,
  roleId: string,
  kind: RoleChangeKind,
  now = Date.now(),
): () => void {
  for (const [key, expiresAt] of expected) {
    if (expiresAt <= now) expected.delete(key);
  }
  const key = echoKey(guildId, userId, roleId, kind);
  expected.set(key, now + ECHO_TTL_MS);
  return () => { expected.delete(key); };
}

/** Le changement répond-il à un rôle posé par le bot ? Ne répond qu'une fois. */
export function isBotRoleEcho(
  guildId: string,
  userId: string,
  roleId: string,
  kind: RoleChangeKind,
  now = Date.now(),
): boolean {
  const key = echoKey(guildId, userId, roleId, kind);
  const expiresAt = expected.get(key);
  if (expiresAt === undefined) return false;
  expected.delete(key);
  return expiresAt > now;
}

/**
 * Les changements de rôles d'une mise à jour de membre qu'il faut réellement
 * dépêcher, échos du bot retirés. L'ordre d'origine est conservé : les ajouts
 * puis les retraits.
 */
export function roleChangesToDispatch(
  guildId: string,
  userId: string,
  addedRoles: readonly string[],
  removedRoles: readonly string[],
  now = Date.now(),
): Array<{ roleId: string; kind: RoleChangeKind }> {
  const aDepecher: Array<{ roleId: string; kind: RoleChangeKind }> = [];
  for (const roleId of addedRoles) {
    if (isBotRoleEcho(guildId, userId, roleId, 'added', now)) continue;
    aDepecher.push({ roleId, kind: 'added' });
  }
  for (const roleId of removedRoles) {
    if (isBotRoleEcho(guildId, userId, roleId, 'removed', now)) continue;
    aDepecher.push({ roleId, kind: 'removed' });
  }
  return aDepecher;
}
