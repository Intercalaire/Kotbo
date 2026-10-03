import { untrack } from 'svelte';
import { errorMessage } from '@kotbo/shared';
import { m } from '../../i18n';
import { analyticsExport } from './analyticsFilters.svelte';

/**
 * Charge une réponse d'Analytics et la recharge quand les filtres lus par
 * `read` changent. Une réponse arrivée après une plus récente est ignorée ;
 * pendant un rechargement, l'ancienne reste affichée (`loading` permet de
 * l'atténuer). À appeler pendant l'initialisation d'un composant.
 */
export function analyticsLoader<T>(read: () => Promise<T | null>, exportKey?: string) {
  const state = $state({ data: null as T | null, loading: true, error: '' });
  let requestId = 0;

  $effect(() => {
    const promise = read();
    const id = ++requestId;
    untrack(() => {
      state.loading = true;
      state.error = '';
    });
    promise
      .then((res) => {
        if (id !== requestId) return;
        state.data = res;
        if (exportKey) analyticsExport[exportKey] = res;
      })
      .catch((e) => {
        if (id === requestId) state.error = errorMessage(e) || m.an_error_generic();
      })
      .finally(() => {
        if (id === requestId) state.loading = false;
      });
  });

  return state;
}
