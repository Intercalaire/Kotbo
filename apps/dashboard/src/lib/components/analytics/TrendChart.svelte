<!--
  Une mesure jour par jour, en barres, et la même mesure sur la période
  d'avant en pointillés neutres quand la comparaison est active. Une seule
  mesure par graphique : messages et vocal n'ont pas la même échelle, ils ont
  chacun le leur (jamais deux axes).
-->
<script lang="ts">
  import Chart from '../charts/Chart.svelte';
  import { shortDate } from './analyticsFormat';

  const {
    dates,
    values,
    previous = [],
    label,
    previousLabel,
    compare = false,
    color = 'var(--series-1)',
    height = 240,
    format = (v: number) => String(v),
  }: {
    dates: string[];
    values: number[];
    previous?: number[];
    label: string;
    previousLabel: string;
    compare?: boolean;
    color?: string;
    height?: number;
    format?: (value: number) => string;
  } = $props();

  const data = $derived({
    labels: dates.map(shortDate),
    datasets: [
      {
        type: 'bar',
        label,
        data: values,
        backgroundColor: color,
        hoverBackgroundColor: color,
        borderRadius: 4,
        borderSkipped: 'bottom',
        maxBarThickness: 28,
        order: 2,
      },
      ...(compare && previous.length > 0
        ? [{
            type: 'line',
            label: previousLabel,
            data: previous,
            borderColor: 'var(--series-neutral)',
            backgroundColor: 'var(--series-neutral)',
            borderDash: [5, 4],
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.25,
            order: 1,
          }]
        : []),
    ],
  });

  const options = $derived({
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: compare && previous.length > 0, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } },
      tooltip: {
        callbacks: {
          label: (ctx: { dataset: { label: string }; parsed: { y: number } }) => `${ctx.dataset.label} : ${format(ctx.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 8, autoSkip: true } },
      y: { beginAtZero: true, ticks: { maxTicksLimit: 5, callback: (v: number) => format(v) } },
    },
  });
</script>

<Chart type="bar" {data} {options} {height} />
