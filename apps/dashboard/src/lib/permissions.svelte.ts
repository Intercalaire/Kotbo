import { dashboardStore } from './stores/dashboard.svelte';

/**
 * Droits par fonctionnalite du centre de gestion, cote navigateur.
 *
 * Chaque page redigeait sa propre lecture de `featureAccess`, et les formules
 * divergeaient : certaines exigeaient `=== true`, d'autres se contentaient de
 * la moderation Discord, d'autres ne verifiaient rien. Elles vivent ici pour
 * que le dashboard pose exactement la question que l'API tranche.
 *
 * `!== false` et non `=== true` : tant qu'un serveur n'a pose aucune regle de
 * role sur une fonctionnalite, le champ est absent et c'est le niveau Discord
 * qui decide. Exiger une autorisation explicite fermerait le dashboard a tous
 * les serveurs qui n'ont jamais ouvert le centre de gestion.
 */
function feature(key: string) {
  return dashboardStore.state.featureAccess?.[key];
}

export function canViewFeature(key: string): boolean {
  if (dashboardStore.state.access.canManageSettings) return true;
  return feature(key)?.canView !== false;
}

export function canModerateFeature(key: string): boolean {
  if (dashboardStore.state.access.canManageSettings) return true;
  if (feature(key)?.canModerate === true) return true;
  return dashboardStore.state.access.canModerateContent && feature(key)?.canModerate !== false;
}

export function canConfigureFeature(key: string): boolean {
  if (dashboardStore.state.access.canManageSettings) return true;
  return feature(key)?.canConfigure === true;
}
