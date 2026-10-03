<!--
  Comparer des segments côte à côte : deux ou trois rôles, salons (ou
  catégories), ou deux périodes. Une ligne par segment sur la même courbe,
  et un tableau des chiffres clés avec l'écart entre A et B. Les périodes
  sont alignées jour par jour (J1, J2…), pas sur le calendrier.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Callout, FilterPills, SectionCard } from '../ui';
  import SearchableSelect from '../SearchableSelect.svelte';
  import TimeSeriesChart from './TimeSeriesChart.svelte';
  import AnalyticsSkeleton from './AnalyticsSkeleton.svelte';
  import { fetchActivityAnalytics, fetchAnalyticsFilterOptions, type ActivityAnalytics, type AnalyticsFilterOptions } from '../../api';
  import { m } from '../../i18n';
  import { analyticsFilters as filters, relativeDelta } from './analyticsFilters.svelte';
  import { fmtDelta, fmtMinutes, fmtNumber, shortDate, SERIES } from './analyticsFormat';

  type Kind = 'role' | 'channel' | 'period';
  type Metric = 'messages' | 'voiceMinutes' | 'activeMembers';

  let kind = $state<Kind>('role');
  let metric = $state<Metric>('messages');
  let picks = $state<Array<string | null>>([null, null, null]);
  let periodB = $state({ start: '', end: '' });
  let options = $state<AnalyticsFilterOptions | null>(null);

  $effect(() => {
    void fetchAnalyticsFilterOptions().then((o) => (options = o)).catch(() => (options = null));
  });

  // Changer de type de segment vide les choix.
  $effect(() => {
    kind;
    untrack(() => (picks = [null, null, null]));
  });

  const choiceOptions = $derived(
    kind === 'role'
      ? (options?.roles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }))
      : (options?.categories ?? []).flatMap((cat) => [
          ...(cat.id ? [{ id: cat.id, name: `${m.anx_cmp_category()} · ${cat.name}` }] : []),
          ...cat.channels.map((c) => ({ id: c.id, name: `#${c.name}` })),
        ]),
  );
  const nameOf = (id: string | null) => choiceOptions.find((o) => o.id === id)?.name ?? '';

  interface Segment { label: string; data: ActivityAnalytics | null }
  let segments = $state<Segment[]>([]);
  let loading = $state(false);
  let requestId = 0;

  $effect(() => {
    const base = filters.query;
    const k = kind;
    const chosen = picks.filter((p): p is string => Boolean(p));
    const b = { ...periodB };
    const id = ++requestId;
    untrack(() => {
      let queries: Array<{ label: string; query: typeof base }>;
      if (k === 'period') {
        if (!b.start || !b.end) {
          segments = [];
          return;
        }
        queries = [
          { label: m.anx_cmp_period_a(), query: base },
          { label: m.anx_cmp_period_b({ start: shortDate(b.start), end: shortDate(b.end) }), query: { ...base, period: undefined, startDate: b.start, endDate: b.end } },
        ];
      } else {
        if (chosen.length < 2) {
          segments = [];
          return;
        }
        queries = chosen.map((value) => ({
          label: nameOf(value),
          query: k === 'role' ? { ...base, role: value } : { ...base, channel: value },
        }));
      }
      loading = true;
      Promise.all(queries.map((q) => fetchActivityAnalytics(q.query).catch(() => null)))
        .then((results) => {
          if (id === requestId) segments = queries.map((q, i) => ({ label: q.label, data: results[i] ?? null }));
        })
        .finally(() => {
          if (id === requestId) loading = false;
        });
    });
  });

  const pick = (d: ActivityAnalytics['series'][number]) => (metric === 'messages' ? d.messages : metric === 'voiceMinutes' ? d.voiceMinutes : (d.activeMembers ?? 0));
  const format = $derived(metric === 'voiceMinutes' ? fmtMinutes : fmtNumber);
  const length = $derived(Math.max(0, ...segments.map((s) => s.data?.series.length ?? 0)));
  const labels = $derived(
    kind === 'period'
      ? Array.from({ length }, (_, i) => m.anx_cmp_day_n({ n: i + 1 }))
      : (segments[0]?.data?.series.map((d) => shortDate(d.dateKey)) ?? []),
  );
  const lines = $derived(
    segments.map((s, i) => ({ label: s.label, color: SERIES[i]!, values: (s.data?.series ?? []).map(pick) })),
  );

  const rows = $derived.by(() => {
    const val = (s: Segment, key: 'messages' | 'voiceMinutes' | 'activeMembers') => s.data?.kpis[key].value ?? 0;
    const perActive = (s: Segment) => {
      const a = val(s, 'activeMembers');
      return a > 0 ? Math.round((val(s, 'messages') / a) * 10) / 10 : 0;
    };
    return [
      { label: m.anx_metric_messages(), values: segments.map((s) => val(s, 'messages')), fmt: fmtNumber },
      { label: m.anx_alert_m_active(), values: segments.map((s) => val(s, 'activeMembers')), fmt: fmtNumber },
      { label: m.anx_metric_per_active(), values: segments.map(perActive), fmt: fmtNumber },
      { label: m.anx_metric_voice(), values: segments.map((s) => val(s, 'voiceMinutes')), fmt: fmtMinutes },
    ];
  });
</script>

<div class="flex flex-col gap-4">
  <SectionCard title={m.anx_cmp_title()} description={m.anx_cmp_desc()}>
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <FilterPills
          label={m.anx_cmp_kind()}
          options={[{ value: 'role', label: m.anx_cmp_roles() }, { value: 'channel', label: m.anx_cmp_channels() }, { value: 'period', label: m.anx_cmp_periods() }]}
          value={kind}
          onchange={(v) => (kind = v as Kind)}
        />
        <FilterPills
          label={m.anx_conc_metric()}
          options={[{ value: 'messages', label: m.anx_metric_messages() }, { value: 'activeMembers', label: m.anx_alert_m_active() }, { value: 'voiceMinutes', label: m.anx_metric_voice() }]}
          value={metric}
          onchange={(v) => (metric = v as Metric)}
        />
      </div>
      {#if kind === 'period'}
        <div class="cmp-grid">
          <p class="text-body-sm text-on-surface-variant">{m.anx_cmp_period_a_hint()}</p>
          <label class="field">
            <span class="field__label">{m.anx_cmp_period_b_start()}</span>
            <input class="input" type="date" bind:value={periodB.start} />
          </label>
          <label class="field">
            <span class="field__label">{m.anx_cmp_period_b_end()}</span>
            <input class="input" type="date" bind:value={periodB.end} min={periodB.start} />
          </label>
        </div>
      {:else}
        <div class="cmp-grid">
          {#each [0, 1, 2] as i (i)}
            <label class="field" for="cmp-pick-{i}">
              <span class="field__label"><span class="cmp-dot" style="background: {SERIES[i]};"></span>{m.anx_cmp_segment({ letter: 'ABC'[i] ?? '' })}{i === 2 ? ` (${m.anx_cmp_optional()})` : ''}</span>
              <SearchableSelect id="cmp-pick-{i}" bind:value={picks[i]} options={choiceOptions} placeholder={kind === 'role' ? m.anx_cmp_pick_role() : m.anx_cmp_pick_channel()} className="input w-full" showId={false} />
            </label>
          {/each}
        </div>
      {/if}
    </div>
  </SectionCard>

  {#if segments.length === 0 && !loading}
    <Callout variant="info">{kind === 'period' ? m.anx_cmp_need_period() : m.anx_cmp_need_two()}</Callout>
  {:else if loading && segments.length === 0}
    <AnalyticsSkeleton />
  {:else}
    <div class="flex flex-col gap-4" class:opacity-60={loading}>
      {#if segments.some((s) => s.data && !s.data.voiceAvailable) && metric === 'voiceMinutes'}
        <Callout variant="info">{m.anx_voice_unavailable()}</Callout>
      {/if}
      <SectionCard title={m.anx_cmp_chart()}>
        <TimeSeriesChart {labels} mode="lines" stacks={lines} {format} height={280} />
      </SectionCard>
      <SectionCard title={m.anx_cmp_table()} flush>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">{m.anx_cmp_metric()}</th>
                {#each segments as s, i (i)}
                  <th scope="col" class="num"><span class="cmp-dot" style="background: {SERIES[i]};"></span>{s.label}</th>
                {/each}
                <th scope="col" class="num">{m.anx_cmp_diff()}</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as row (row.label)}
                <tr>
                  <th scope="row">{row.label}</th>
                  {#each row.values as v, i (i)}<td class="num">{row.fmt(v)}</td>{/each}
                  <td class="num">{fmtDelta(relativeDelta(row.values[1] ?? 0, row.values[0] ?? 0), 'pct')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="px-5 py-3 text-2xs text-on-surface-variant">{m.anx_cmp_diff_hint()}</p>
      </SectionCard>
    </div>
  {/if}
</div>

<style>
  .cmp-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
    align-items: end;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .field__label {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-on-surface);
  }

  .cmp-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    margin-right: 0.25rem;
    border-radius: 999px;
  }

  .table-wrap {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .data-table th,
  .data-table td {
    padding: 0.5rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--color-outline-variant);
    white-space: nowrap;
  }

  .data-table thead th {
    font-weight: 500;
    color: var(--color-on-surface-variant);
  }

  .data-table tbody th {
    font-weight: 500;
    color: var(--color-on-surface);
  }

  .data-table .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
