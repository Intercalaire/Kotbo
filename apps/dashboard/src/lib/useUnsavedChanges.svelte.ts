/**
 * useUnsavedChanges - Svelte 5 composable helper
 *
 * Tracks dirty state by comparing a reactive config object against a saved
 * snapshot. Automatically registers/clears with the global unsavedChanges
 * bar store.
 *
 * Usage in a page (<script lang="ts"> block):
 *
 *   import { useUnsavedChanges } from '../lib/useUnsavedChanges.svelte';
 *
 *   let config = $state({ ... });
 *   let savedConfig = $state({ ... }); // same initial shape
 *
 *   useUnsavedChanges({
 *     label: 'Ma Page',
 *     getConfig: () => config,
 *     getSaved: () => savedConfig,
 *     onSave: async () => {
 *       // call API, update savedConfig = { ...config } on success
 *       return true; // or false on failure
 *     },
 *     onReset: () => { config = { ...savedConfig }; }
 *   });
 */

import { untrack, onDestroy } from 'svelte';
import { unsavedChanges } from './stores/unsavedChanges.svelte';

interface UseUnsavedChangesOptions {
  /** Label shown in the bar, e.g. "Accueil & Départ" */
  label: string;
  /** Getter for the current (possibly-dirty) config */
  getConfig: () => unknown;
  /** Getter for the last-saved config snapshot */
  getSaved: () => unknown;
  /** Called when user hits Save. Return true on success, false to keep dirty. */
  onSave: () => Promise<boolean>;
  /** Called when user hits Reset. Should restore config to savedConfig. */
  onReset: () => void;
  /** Optional: only allow dirty detection when user has permission */
  canEdit?: () => boolean;
}

export function useUnsavedChanges(opts: UseUnsavedChangesOptions) {
  $effect(() => {
    const current = JSON.stringify(opts.getConfig());
    const saved = JSON.stringify(opts.getSaved());
    const dirty = current !== saved;
    const allowed = opts.canEdit ? opts.canEdit() : true;

    if (dirty && allowed) {
      untrack(() => {
        unsavedChanges.register({
          label: opts.label,
          onSave: opts.onSave,
          onReset: opts.onReset
        });
      });
    } else if (!dirty) {
      untrack(() => {
        if (unsavedChanges.isDirty && unsavedChanges.pageLabel === opts.label) {
          unsavedChanges.clear();
        }
      });
    }
  });

  onDestroy(() => {
    if (unsavedChanges.pageLabel === opts.label) {
      unsavedChanges.clear();
    }
  });
}
