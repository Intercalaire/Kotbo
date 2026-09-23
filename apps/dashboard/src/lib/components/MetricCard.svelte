<script lang="ts">
  import Papicon from './Papicon.svelte';

  const {
    label,
    value,
    note = '',
    icon = 'activity',
    toneClass = 'bg-primary/10 text-primary',
    cardClass = '',
    loading = false
  } = $props();
</script>

<div class="section-card p-5 flex items-center gap-4 {cardClass}">
  <div class="w-10 h-10 rounded-lg {toneClass} flex items-center justify-center shrink-0">
    <Papicon {icon} size={20} />
  </div>
  <div class="flex-1 min-w-0">
    <p class="text-2xs font-medium uppercase tracking-wider text-on-surface-variant truncate">{label}</p>
    {#if loading}
      <div class="mt-1.5 h-7 w-14 animate-pulse bg-surface-container-high rounded"></div>
    {:else}
      <p class="text-2xl font-semibold text-on-surface mt-0.5 tracking-tight truncate">{value}</p>
    {/if}
    {#if note}
      <p class="text-xs text-on-surface-variant mt-0.5 truncate">{note}</p>
    {/if}
  </div>
</div>
