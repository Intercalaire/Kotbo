<!--
  Mini-courbe sans axe, pour donner la forme d'une série à côté d'un chiffre.
  Décorative : la valeur exacte est toujours écrite à côté, donc la courbe est
  masquée aux lecteurs d'écran.
-->
<script lang="ts">
  const {
    values,
    color = 'var(--series-1)',
    width = 72,
    height = 22,
    fill = true,
  }: {
    values: number[];
    color?: string;
    width?: number;
    height?: number;
    fill?: boolean;
  } = $props();

  const PAD = 1.5;

  const points = $derived.by(() => {
    if (values.length < 2) return [];
    const max = Math.max(...values);
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const step = (width - PAD * 2) / (values.length - 1);
    return values.map((v, i) => [PAD + i * step, height - PAD - ((v - min) / span) * (height - PAD * 2)] as const);
  });

  const line = $derived(points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  const area = $derived(
    points.length > 0
      ? `M${points[0]![0].toFixed(1)},${height} L${line.replaceAll(' ', ' L')} L${points[points.length - 1]![0].toFixed(1)},${height} Z`
      : '',
  );
</script>

{#if points.length > 0}
  <svg class="sparkline" viewBox="0 0 {width} {height}" {width} {height} aria-hidden="true" focusable="false">
    {#if fill}<path d={area} style="fill: {color}; opacity: 0.12;" />{/if}
    <polyline points={line} style="stroke: {color};" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
  </svg>
{/if}

<style>
  .sparkline {
    display: block;
    flex-shrink: 0;
    overflow: visible;
  }
</style>
