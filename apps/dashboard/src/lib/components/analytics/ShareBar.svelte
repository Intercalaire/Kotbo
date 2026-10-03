<!--
  Répartition en 100 % : une barre segmentée (2 px d'écart entre segments) et
  sa légende, qui donne chaque part en clair. La légende porte l'information ;
  la barre n'est qu'un aperçu.
-->
<script lang="ts" module>
  export interface ShareSegment {
    id: string;
    label: string;
    value: number;
    color: string;
  }
</script>

<script lang="ts">
  import { fmtNumber, fmtPct } from './analyticsFormat';
  import { pct as pctOf } from './analyticsFilters.svelte';

  const {
    segments,
    columns = 3,
    showCounts = false,
  }: {
    segments: ShareSegment[];
    columns?: number;
    showCounts?: boolean;
  } = $props();

  const total = $derived(segments.reduce((s, x) => s + x.value, 0));
  const visible = $derived(segments.filter((s) => s.value > 0));
</script>

<div class="flex flex-col gap-3">
  <div class="share-bar" aria-hidden="true">
    {#if total === 0}
      <span class="share-bar__empty"></span>
    {:else}
      {#each visible as segment (segment.id)}
        <span
          class="share-bar__segment"
          style="flex: {segment.value} 1 0; background: {segment.color};"
          title={`${segment.label} : ${fmtPct(pctOf(segment.value, total))}`}
        ></span>
      {/each}
    {/if}
  </div>
  <ul class="share-legend" style="--cols: {columns};">
    {#each segments as segment (segment.id)}
      <li class="flex items-center gap-2 min-w-0">
        <span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background: {segment.color};"></span>
        <span class="truncate text-body-sm text-on-surface">{segment.label}</span>
        <span class="ml-auto shrink-0 text-body-sm font-medium tabular-nums text-on-surface">
          {fmtPct(pctOf(segment.value, total))}
        </span>
        {#if showCounts}
          <span class="shrink-0 text-2xs tabular-nums text-on-surface-variant">{fmtNumber(segment.value)}</span>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .share-bar {
    display: flex;
    gap: 2px;
    height: 12px;
    border-radius: 999px;
    overflow: hidden;
  }

  .share-bar__segment {
    min-width: 3px;
    height: 100%;
  }

  .share-bar__empty {
    flex: 1;
    background: var(--color-surface-container);
  }

  .share-legend {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: 0.5rem 1.25rem;
  }

  @media (max-width: 767px) {
    .share-legend {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 420px) {
    .share-legend {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
