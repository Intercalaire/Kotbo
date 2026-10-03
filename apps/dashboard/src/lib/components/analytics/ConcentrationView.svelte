<!--
  Concentration de l'activité : est-ce que le serveur tient sur une poignée de
  membres ? Part faite par les 1 % et 10 % les plus actifs, nombre de membres
  qui font la moitié de l'activité, indice de Gini, et courbe de Lorenz (plus
  elle s'écarte de la diagonale, plus l'activité est concentrée).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Callout, FilterPills, SectionCard } from '../ui';
  import MetricTabs, { type MetricTab } from './MetricTabs.svelte';
  import TimeSeriesChart from './TimeSeriesChart.svelte';
  import AnalyticsSkeleton from './AnalyticsSkeleton.svelte';
  import { fetchConcentration, type ActivityMetricKind, type Concentration } from '../../api';
  import { m } from '../../i18n';
  import { errorMessage } from '@kotbo/shared';
  import { analyticsExport, analyticsFilters as filters, relativeDelta } from './analyticsFilters.svelte';
  import { fmtNumber, fmtPct, SERIES } from './analyticsFormat';

  let metric = $state<ActivityMetricKind>('messages');
  let data = $state<Concentration | null>(null);
  let loading = $state(true);
  let error = $state('');
  let requestId = 0;

  $effect(() => {
    const query = filters.query;
    const kind = metric;
    const id = ++requestId;
    untrack(() => {
      loading = true;
      error = '';
    });
    fetchConcentration(query, kind)
      .then((res) => {
        if (id !== requestId) return;
        data = res;
        analyticsExport.concentration = res;
      })
      .catch((e) => {
        if (id === requestId) error = errorMessage(e) || m.an_error_generic();
      })
      .finally(() => {
        if (id === requestId) loading = false;
      });
  });

  const cur = $derived(data?.current);
  const prev = $derived(data?.previous);

  const tiles: MetricTab[] = $derived.by(() => {
    if (!cur || !prev) return [];
    return [
      { id: 'top1', label: m.anx_conc_top1(), value: fmtPct(cur.top1Share), delta: relativeDelta(cur.top1Share, prev.top1Share), invert: true, color: SERIES[0], hint: m.anx_conc_top1_hint() },
      { id: 'top10', label: m.anx_conc_top10(), value: fmtPct(cur.top10Share), delta: relativeDelta(cur.top10Share, prev.top10Share), invert: true, color: SERIES[0] },
      { id: 'half', label: m.anx_conc_half(), value: fmtNumber(cur.membersForHalf), delta: relativeDelta(cur.membersForHalf, prev.membersForHalf), color: SERIES[0], hint: m.anx_conc_half_hint() },
      { id: 'gini', label: m.anx_conc_gini(), value: cur.gini.toLocaleString(undefined, { maximumFractionDigits: 2 }), delta: relativeDelta(cur.gini, prev.gini), invert: true, color: SERIES[0], hint: m.anx_conc_gini_hint() },
    ];
  });

  const verdict = $derived(
    !cur ? '' : cur.gini >= 0.8 ? m.anx_conc_verdict_high() : cur.gini >= 0.6 ? m.anx_conc_verdict_mid() : m.anx_conc_verdict_low(),
  );
</script>

<div class="flex flex-col gap-4">
  <FilterPills
    label={m.anx_conc_metric()}
    options={[{ value: 'messages', label: m.anx_metric_messages() }, { value: 'voice', label: m.anx_metric_voice() }]}
    value={metric}
    onchange={(v) => (metric = v)}
  />
  {#if loading && !data}
    <AnalyticsSkeleton />
  {:else if error && !data}
    <Callout variant="danger" title={m.an_error_generic()}>{error}</Callout>
  {:else if data && !data.available}
    <Callout variant="info">{m.anx_top_unavailable()}</Callout>
  {:else if cur}
    <div class="flex flex-col gap-4" class:opacity-60={loading}>
      <MetricTabs metrics={tiles} active="" onchange={() => {}} compare={filters.compare} label={m.anx_conc_title()} interactive={false} />
      <SectionCard title={m.anx_conc_lorenz()} description={m.anx_conc_lorenz_desc({ members: fmtNumber(cur.members) })}>
        <TimeSeriesChart
          labels={cur.lorenz.map((p) => `${p.members} %`)}
          mode="line"
          main={{ label: m.anx_conc_curve(), values: cur.lorenz.map((p) => p.activity), color: SERIES[0]! }}
          previous={{ label: m.anx_conc_equality(), values: cur.lorenz.map((p) => p.members) }}
          format={(v) => fmtPct(v, 0)}
          height={260}
        />
      </SectionCard>
      <Callout variant="info">{verdict}</Callout>
    </div>
  {/if}
</div>
