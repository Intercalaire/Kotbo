/** Liste « à traiter » de la page d'accueil. */
import type { HomeTasksData } from '@kotbo/contracts';
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

export type { HomeTask, HomeTaskKey, HomeTasksData, HomeSetupGap } from '@kotbo/contracts';

export async function fetchHomeTasks(guildId = authStore.selectedGuildId): Promise<HomeTasksData | null> {
  return dashboardRequest('/home-tasks', {
    guildId,
    errorContext: 'API Error (Home Tasks):',
    // Rafraichie en fond toutes les minutes : un echec ne merite pas un toast.
    silent: true,
  });
}
