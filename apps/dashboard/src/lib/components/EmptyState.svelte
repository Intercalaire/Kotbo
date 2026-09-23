<script lang="ts">
  import type { Snippet } from 'svelte';
  import Papicon from './Papicon.svelte';

  const {
    icon = 'inbox',
    title = 'Rien à afficher',
    description = '',
    action,
  }: {
    icon?: string;
    title?: string;
    description?: string;
    /** Bouton ou lien d'action optionnel affiché sous le message */
    action?: Snippet;
  } = $props();
</script>

<div class="flex flex-col items-center justify-center text-center py-14 px-6 gap-1.5">
  <div class="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant/50 mb-2">
    <Papicon {icon} size={22} />
  </div>
  <p class="text-sm font-medium text-on-surface">{title}</p>
  {#if description}
    <p class="text-body-sm text-on-surface-variant max-w-sm leading-relaxed">{description}</p>
  {/if}
  {#if action}
    <div class="mt-3">
      {@render action()}
    </div>
  {/if}
</div>
