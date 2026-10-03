<!--
  Vues enregistrées d'Analytics : l'onglet, la période et les filtres du
  moment, à retrouver en un clic. Privées par défaut, partageables avec
  l'équipe. Le menu s'ouvre sous son bouton, se ferme à Échap ou au clic
  dehors.
-->
<script lang="ts">
  import { Button } from '../ui';
  import Papicon from '../Papicon.svelte';
  import { createSavedView, deleteSavedView, fetchSavedViews, type SavedView } from '../../api';
  import { authStore } from '../../stores/auth.svelte';
  import { toast } from '../../stores/toast.svelte';
  import { m } from '../../i18n';
  import { errorMessage } from '@kotbo/shared';
  import { analyticsFilters as filters } from './analyticsFilters.svelte';

  const { activeTab, onApply }: { activeTab: string; onApply: (tab: string) => void } = $props();

  let open = $state(false);
  let views = $state<SavedView[]>([]);
  let name = $state('');
  let shared = $state(false);
  let saving = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  async function load() {
    try {
      views = (await fetchSavedViews()) ?? [];
    } catch {
      views = [];
    }
  }

  $effect(() => {
    authStore.selectedGuildId;
    void load();
  });

  $effect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });

  function apply(view: SavedView) {
    filters.apply(view.payload);
    onApply(view.payload.tab);
    open = false;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    saving = true;
    try {
      const view = await createSavedView({ name: name.trim(), shared, payload: { tab: activeTab, ...filters.snapshot() } });
      if (view) views = [...views, view];
      name = '';
      shared = false;
      toast.success(m.anx_views_saved());
    } catch (e) {
      toast.error(errorMessage(e) || m.an_error_generic());
    } finally {
      saving = false;
    }
  }

  async function remove(view: SavedView) {
    try {
      await deleteSavedView(view.id);
      views = views.filter((v) => v.id !== view.id);
    } catch (e) {
      toast.error(errorMessage(e) || m.an_error_generic());
    }
  }
</script>

<div class="views" bind:this={root}>
  <Button size="sm" variant="secondary" icon="bookmark" aria-expanded={open} aria-haspopup="true" onclick={() => (open = !open)}>
    {m.anx_views_button()}{#if views.length > 0}<span class="views__count">{views.length}</span>{/if}
  </Button>
  {#if open}
    <div class="views__panel" role="dialog" aria-label={m.anx_views_title()}>
      <p class="views__title">{m.anx_views_title()}</p>
      {#if views.length === 0}
        <p class="views__empty">{m.anx_views_empty()}</p>
      {:else}
        <ul class="views__list">
          {#each views as view (view.id)}
            <li class="views__item">
              <button type="button" class="views__apply" onclick={() => apply(view)}>
                <span class="truncate">{view.name}</span>
                {#if view.shared}<span class="views__badge">{view.mine ? m.anx_views_shared() : m.anx_views_from_team()}</span>{/if}
              </button>
              {#if view.mine}
                <button type="button" class="views__remove" aria-label={m.anx_views_delete({ name: view.name })} title={m.anx_views_delete({ name: view.name })} onclick={() => remove(view)}>
                  <Papicon icon="x" size={14} />
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      <form class="views__form" onsubmit={save}>
        <label class="sr-only" for="saved-view-name">{m.anx_views_name()}</label>
        <input id="saved-view-name" class="input" bind:value={name} maxlength="60" placeholder={m.anx_views_name_placeholder()} />
        <label class="views__share">
          <input type="checkbox" bind:checked={shared} />
          {m.anx_views_share()}
        </label>
        <Button size="sm" variant="primary" type="submit" loading={saving} disabled={!name.trim()}>{m.anx_views_save()}</Button>
      </form>
    </div>
  {/if}
</div>

<style>
  .views {
    position: relative;
  }

  .views__count {
    margin-left: 0.375rem;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
  }

  .views__panel {
    position: absolute;
    right: 0;
    top: calc(100% + 0.5rem);
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    width: min(20rem, calc(100vw - 2rem));
    padding: 0.875rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-outline-variant);
    background: var(--color-surface-container-lowest, var(--color-surface));
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
  }

  .views__title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-on-surface);
  }

  .views__empty {
    font-size: 0.8125rem;
    color: var(--color-on-surface-variant);
  }

  .views__list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    max-height: 16rem;
    overflow-y: auto;
  }

  .views__item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .views__apply {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
    padding: 0.375rem 0.5rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    color: var(--color-on-surface);
    text-align: left;
  }

  .views__apply:hover {
    background: var(--color-surface-container);
  }

  .views__badge {
    flex-shrink: 0;
    padding: 0 0.375rem;
    border-radius: 999px;
    font-size: 0.6875rem;
    background: var(--color-surface-container-high);
    color: var(--color-on-surface-variant);
  }

  .views__remove {
    display: inline-flex;
    padding: 0.25rem;
    border-radius: 0.25rem;
    color: var(--color-on-surface-variant);
  }

  .views__remove:hover {
    color: var(--color-error);
  }

  .views__form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.625rem;
    border-top: 1px solid var(--color-outline-variant);
  }

  .views__share {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--color-on-surface-variant);
  }
</style>
