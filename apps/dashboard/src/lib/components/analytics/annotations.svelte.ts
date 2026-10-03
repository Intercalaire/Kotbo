import {
  createAnalyticsAnnotation,
  deleteAnalyticsAnnotation,
  fetchAnalyticsAnnotations,
  type AnalyticsAnnotation,
} from '../../api';
import { authStore } from '../../stores/auth.svelte';
import { dashboardStore } from '../../stores/dashboard.svelte';

/**
 * Notes datées posées sur les courbes, partagées par toutes les vues de la
 * page : une note ajoutée depuis Messages réapparaît dans la vue d'ensemble.
 */
class AnnotationsStore {
  items = $state<AnalyticsAnnotation[]>([]);
  private key = '';

  async load(period: { period?: number; startDate?: string; endDate?: string }, force = false) {
    const key = `${authStore.selectedGuildId}|${JSON.stringify(period)}`;
    if (!force && key === this.key) return;
    this.key = key;
    try {
      const rows = (await fetchAnalyticsAnnotations(period)) ?? [];
      if (this.key === key) this.items = rows;
    } catch {
      if (this.key === key) this.items = [];
    }
  }

  async add(dateKey: string, label: string, period: { period?: number; startDate?: string; endDate?: string }) {
    await createAnalyticsAnnotation({ dateKey, label });
    await this.load(period, true);
  }

  async remove(id: string) {
    await deleteAnalyticsAnnotation(id);
    this.items = this.items.filter((a) => a.id !== id);
  }

  /** L'auteur retire sa note, un administrateur n'importe laquelle. */
  canDelete(annotation: AnalyticsAnnotation): boolean {
    return annotation.authorId === authStore.user?.id || Boolean(dashboardStore.state.access?.canManageSettings);
  }
}

export const analyticsAnnotations = new AnnotationsStore();
