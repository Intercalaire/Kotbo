<!--
  Chiffre clé d'une section, avec son écart par rapport à la période d'avant
  quand la comparaison est active. L'écart porte une flèche en plus de sa
  couleur : le sens se lit sans distinguer le vert du rouge.
-->
<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import { m } from '../../i18n';
  import { fmtDelta } from './analyticsFormat';

  const {
    label,
    value,
    delta = undefined,
    unit = 'pct',
    compare = false,
    hint = '',
  }: {
    label: string;
    value: string;
    /** Écart en % (pct), en points (pts) ou en valeur (abs). null = pas de base. */
    delta?: number | null;
    unit?: 'pct' | 'pts' | 'abs';
    compare?: boolean;
    hint?: string;
  } = $props();

  const direction = $derived(delta === undefined || delta === null ? 'flat' : Math.abs(delta) < 0.05 ? 'flat' : delta > 0 ? 'up' : 'down');
</script>

<div class="kpi-tile" title={hint || undefined}>
  <span class="text-body-sm text-on-surface-variant">{label}</span>
  <span class="kpi-tile__value">{value}</span>
  {#if compare && delta !== undefined}
    <span
      class="inline-flex items-center gap-1 text-2xs font-medium {direction === 'up' ? 'text-success' : direction === 'down' ? 'text-error' : 'text-on-surface-variant'}"
      title={m.anx_delta_title()}
    >
      {#if direction !== 'flat'}
        <Papicon icon={direction === 'up' ? 'trending-up' : 'trending-down'} size={12} />
      {/if}
      {fmtDelta(delta ?? null, unit)}
      <span class="sr-only">{m.anx_delta_title()}</span>
    </span>
  {/if}
</div>

<style>
  .kpi-tile {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    padding: 1rem 1.125rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-outline-variant);
    background: var(--color-surface-container-low);
  }

  .kpi-tile__value {
    font-family: var(--font-headline);
    font-size: 1.625rem;
    font-weight: 600;
    line-height: 1.2;
    color: var(--color-on-surface);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
