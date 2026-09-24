<script lang="ts">
  import type { Snippet } from 'svelte';
  import Papicon from './Papicon.svelte';

  const {
    title = '',
    description = '',
    icon = '',
    flush = false,
    actions,
    children,
  }: {
    title?: string;
    description?: string;
    icon?: string;
    /** true : le contenu touche les bords (tables, listes) */
    flush?: boolean;
    actions?: Snippet;
    children?: Snippet;
  } = $props();
</script>

<section class="section-card {flush ? 'overflow-hidden' : ''}">
  {#if title || actions}
    <header class="section-card__header flex items-start justify-between gap-4 px-5 pt-5 {flush ? 'pb-4 border-b border-outline-variant' : 'pb-1'}">
      <div class="flex items-start gap-3 min-w-0">
        {#if icon}
          <div class="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant flex items-center justify-center shrink-0 mt-0.5">
            <Papicon {icon} size={16} />
          </div>
        {/if}
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-on-surface leading-tight">{title}</h3>
          {#if description}
            <p class="text-body-sm text-on-surface-variant mt-0.5 leading-relaxed">{description}</p>
          {/if}
        </div>
      </div>
      {#if actions}
        <div class="section-card__actions flex items-center gap-2 shrink-0">
          {@render actions()}
        </div>
      {/if}
    </header>
  {/if}
  <div class={flush ? 'section-card__body section-card__body--flush' : 'section-card__body p-5'}>
    {@render children?.()}
  </div>
</section>
