/**
 * Rôles posés par les actions « Donner un rôle » et « Retirer un rôle ».
 *
 * Même cause que pour les surnoms (voir `nicknameEcho.ts`) : Discord renvoie
 * le changement par la passerelle, donc hors de la profondeur de cascade. Deux
 * automatisations banales bouclent alors sans fin, « quand ce rôle est ajouté,
 * le retirer » face à « quand ce rôle est retiré, l'ajouter », chaque tour
 * repartant de zéro.
 *
 * L'action annonce le changement qu'elle pose avec la profondeur où elle
 * s'exécute, et le déclencheur dépêche la mise à jour qui lui répond à cette
 * profondeur : `MAX_CASCADE_DEPTH` coupe la boucle, et « quand le rôle Membre
 * est ajouté, souhaiter la bienvenue » part toujours quand une autre
 * automatisation a donné le rôle. Une annonce sans profondeur (`null`) fait
 * taire l'écho : le balayage des rôles temporaires tourne hors de toute
 * cascade, et le redémarrer à zéro relancerait « quand un rôle est retiré, le
 * redonner pour 10 min » à chaque échéance.
 *
 * Mémoire du processus : l'événement revient sur le shard qui a agi.
 */

const ECHO_TTL_MS = 30_000;

export type RoleChangeKind = 'added' | 'removed';

export interface RoleChange {
  roleId: string;
  kind: RoleChangeKind;
  /** Profondeur de l'automatisation qui a posé ce changement ; absente pour un geste humain. */
  echoDepth?: number;
}

const expected = new Map<string, { expiresAt: number; depth: number | null }>();

function echoKey(guildId: string, userId: string, roleId: string, kind: RoleChangeKind): string {
  return `${guildId}:${userId}:${roleId}:${kind}`;
}

/** Annonce un changement de rôle sur le point d'être posé ; la fonction rendue l'oublie. */
export function expectBotRoleChange(
  guildId: string,
  userId: string,
  roleId: string,
  kind: RoleChangeKind,
  depth: number | null,
  now = Date.now(),
): () => void {
  for (const [key, entry] of expected) {
    if (entry.expiresAt <= now) expected.delete(key);
  }
  const key = echoKey(guildId, userId, roleId, kind);
  expected.set(key, { expiresAt: now + ECHO_TTL_MS, depth });
  return () => { expected.delete(key); };
}

/**
 * Le changement répond-il à un rôle posé par le bot ? Rend la profondeur
 * annoncée (`null` pour un écho à taire), ou `undefined` s'il n'en est pas un.
 * Ne répond qu'une fois.
 */
export function takeBotRoleEcho(
  guildId: string,
  userId: string,
  roleId: string,
  kind: RoleChangeKind,
  now = Date.now(),
): number | null | undefined {
  const key = echoKey(guildId, userId, roleId, kind);
  const entry = expected.get(key);
  if (entry === undefined) return undefined;
  expected.delete(key);
  return entry.expiresAt > now ? entry.depth : undefined;
}

/**
 * Les changements de rôles d'une mise à jour de membre qu'il faut réellement
 * dépêcher, échos tus retirés. L'ordre d'origine est conservé : les ajouts
 * puis les retraits.
 */
export function roleChangesToDispatch(
  guildId: string,
  userId: string,
  addedRoles: readonly string[],
  removedRoles: readonly string[],
  now = Date.now(),
): RoleChange[] {
  const changes: RoleChange[] = [];
  const collect = (roleIds: readonly string[], kind: RoleChangeKind) => {
    for (const roleId of roleIds) {
      const depth = takeBotRoleEcho(guildId, userId, roleId, kind, now);
      if (depth === null) continue;
      changes.push(depth === undefined ? { roleId, kind } : { roleId, kind, echoDepth: depth });
    }
  };
  collect(addedRoles, 'added');
  collect(removedRoles, 'removed');
  return changes;
}
