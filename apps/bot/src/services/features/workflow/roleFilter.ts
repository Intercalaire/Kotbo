import { readTriggerRoleFilter, type WorkflowGraph } from '@kotbo/shared';

/**
 * Le rôle de l'événement passe-t-il le filtre du déclencheur ? Un événement
 * sans rôle ne passe pas un filtre posé, faute de pouvoir le vérifier.
 */
export function matchesTriggerRoleFilter(graph: WorkflowGraph, payload: Record<string, unknown>): boolean {
  const allowed = readTriggerRoleFilter(graph);
  if (allowed.length === 0) return true;
  return typeof payload.roleId === 'string' && allowed.includes(payload.roleId);
}
