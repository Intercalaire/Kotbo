<!--
  Performance du support : volume, délais (médiane et 90e centile), respect
  des objectifs, satisfaction, file actuelle et tableau par membre du staff.
  La lecture qu'un responsable fait chaque semaine dans un outil de support.
-->
<script lang="ts">
  import Skeleton from '../Skeleton.svelte';
  import BarList from '../analytics/BarList.svelte';
  import { fmtNumber } from '../analytics/analyticsFormat';
  import { Callout, EmptyState, FilterPills, SectionCard, type FilterOption } from '../ui';
  import { m, dateLocale } from '../../i18n';
  import { fetchTicketStats, type DurationStats, type TicketStats } from '../../api';

  type Period = '7' | '30' | '90';
  let period = $state<Period>('30');
  let stats = $state<TicketStats | null>(null);
  let loading = $state(true);
  let error = $state('');

  const periodOptions: FilterOption<Period>[] = $derived([
    { value: '7', label: m.th_period_7() },
    { value: '30', label: m.th_period_30() },
    { value: '90', label: m.th_period_90() },
  ]);

  $effect(() => {
    const days = Number(period);
    loading = true;
    error = '';
    fetchTicketStats(days)
      .then((res) => { stats = res; })
      .catch((err) => { error = err instanceof Error ? err.message : m.th_stats_error(); })
      .finally(() => { loading = false; });
  });

  function duration(minutes: number | null): string {
    if (minutes === null) return '—';
    if (minutes < 60) return m.th_min({ count: Math.max(1, Math.round(minutes)) });
    const hours = minutes / 60;
    if (hours < 48) return m.th_hours_decimal({ count: hours.toLocaleString(dateLocale(), { maximumFractionDigits: 1 }) });
    return m.th_days({ count: Math.round(hours / 24) });
  }

  const p90 = (value: DurationStats) => (value.p90 === null ? '' : m.th_p90({ time: duration(value.p90) }));
  const pct = (value: number | null) => (value === null ? '—' : `${value.toLocaleString(dateLocale(), { maximumFractionDigits: 1 })} %`);

  const maxDay = $derived(Math.max(1, ...(stats?.volume.byDay.flatMap((day) => [day.created, day.closed]) ?? [0])));
  const maxRating = $derived(Math.max(1, ...(stats?.satisfaction.distribution ?? [0])));
  const formatDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });

  function ageOf(iso: string | null): string {
    if (!iso) return '—';
    return duration((Date.now() - new Date(iso).getTime()) / 60_000);
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-body-sm text-on-surface-variant">{m.th_stats_intro()}</p>
    <FilterPills label={m.th_period()} options={periodOptions} value={period} onchange={(value) => (period = value)} />
  </div>

  {#if loading && !stats}
    <div class="grid gap-3 grid-cols-2 lg:grid-cols-6">{#each Array(6) as _}<Skeleton height="h-24" />{/each}</div>
    <Skeleton height="h-56" />
  {:else if error}
    <Callout variant="danger">{error}</Callout>
  {:else if stats}
    <div class="grid gap-3 grid-cols-2 lg:grid-cols-6">
      <div class="tps-kpi"><span>{m.th_kpi_created()}</span><strong>{fmtNumber(stats.volume.created)}</strong><small>{m.th_kpi_closed({ count: fmtNumber(stats.volume.closed) })}</small></div>
      <div class="tps-kpi"><span>{m.th_kpi_first_response()}</span><strong>{duration(stats.firstResponse.median)}</strong><small>{p90(stats.firstResponse)}</small></div>
      <div class="tps-kpi"><span>{m.th_kpi_resolution()}</span><strong>{duration(stats.resolution.median)}</strong><small>{p90(stats.resolution)}</small></div>
      <div class="tps-kpi">
        <span>{m.th_kpi_sla()}</span>
        <strong>{stats.sla.configured ? pct(stats.sla.firstResponseMet ?? stats.sla.resolutionMet) : '—'}</strong>
        <small>{stats.sla.configured ? m.th_kpi_sla_hint({ first: pct(stats.sla.firstResponseMet), resolution: pct(stats.sla.resolutionMet) }) : m.th_kpi_sla_none()}</small>
      </div>
      <div class="tps-kpi">
        <span>{m.th_kpi_csat()}</span>
        <strong class={stats.satisfaction.average !== null && stats.satisfaction.average < 3.5 ? 'text-warning' : ''}>{stats.satisfaction.average === null ? '—' : `${stats.satisfaction.average.toLocaleString(dateLocale())}/5`}</strong>
        <small>{m.th_kpi_csat_count({ count: stats.satisfaction.count })}</small>
      </div>
      <div class="tps-kpi">
        <span>{m.th_kpi_backlog()}</span>
        <strong class={stats.backlog.breached > 0 ? 'text-error' : ''}>{fmtNumber(stats.backlog.active)}</strong>
        <small>{m.th_kpi_backlog_hint({ breached: stats.backlog.breached, oldest: ageOf(stats.backlog.oldestActiveAt) })}</small>
      </div>
    </div>

    {#if stats.backlog.unassigned > 0 || stats.backlog.waitingStaff > 0}
      <Callout variant={stats.backlog.breached > 0 ? 'warning' : 'info'}>
        {m.th_backlog_callout({ unassigned: stats.backlog.unassigned, waiting: stats.backlog.waitingStaff })}
      </Callout>
    {/if}

    <SectionCard title={m.th_volume_title()} description={m.th_volume_desc()}>
      <div class="px-5 pb-5 pt-4">
        <div class="tps-bars" role="img" aria-label={m.th_volume_title()}>
          {#each stats.volume.byDay as day (day.date)}
            <div class="tps-day" title={m.th_volume_tip({ date: formatDay(day.date), created: day.created, closed: day.closed })}>
              <span class="tps-bar tps-bar--created" style="height: {day.created ? Math.max(4, (day.created / maxDay) * 100) : 0}%"></span>
              <span class="tps-bar tps-bar--closed" style="height: {day.closed ? Math.max(4, (day.closed / maxDay) * 100) : 0}%"></span>
            </div>
          {/each}
        </div>
        <div class="flex justify-between mt-1.5 text-2xs text-on-surface-variant">
          <span>{formatDay(stats.volume.byDay[0]?.date ?? '')}</span>
          <span class="flex items-center gap-3">
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-sm" style="background: var(--series-1)"></span>{m.th_legend_created()}</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-sm" style="background: var(--series-2)"></span>{m.th_legend_closed()}</span>
          </span>
          <span>{formatDay(stats.volume.byDay[stats.volume.byDay.length - 1]?.date ?? '')}</span>
        </div>
      </div>
    </SectionCard>

    <SectionCard title={m.th_agents_title()} description={m.th_agents_desc()} flush>
      {#if stats.agents.length === 0}
        <EmptyState icon="users" title={m.th_agents_empty()} description={m.th_agents_empty_desc()} />
      {:else}
        <div class="overflow-x-auto">
          <table class="tps-table">
            <thead>
              <tr>
                <th>{m.th_col_agent()}</th>
                <th>{m.th_col_handled()}</th>
                <th>{m.th_col_closed()}</th>
                <th>{m.th_col_first_response()}</th>
                <th>{m.th_col_resolution()}</th>
                <th>{m.th_col_csat()}</th>
                <th>{m.th_col_open()}</th>
              </tr>
            </thead>
            <tbody>
              {#each stats.agents as agent (agent.userId)}
                <tr>
                  <td><a class="hover:underline" href={`/members/${agent.userId}`}>{agent.name}</a></td>
                  <td>{agent.handled}</td>
                  <td>{agent.closed}</td>
                  <td>{duration(agent.firstResponse.median)}</td>
                  <td>{duration(agent.resolution.median)}</td>
                  <td>{agent.rating === null ? '—' : `${agent.rating.toLocaleString(dateLocale())} (${agent.ratings})`}</td>
                  <td>{agent.openNow}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </SectionCard>

    <div class="grid gap-4 lg:grid-cols-3">
      <SectionCard title={m.th_by_type()}>
        <div class="px-5 pb-5 pt-3">
          <BarList
            items={stats.byType.map((type) => ({ id: type.label, label: type.label, value: type.count, sub: type.resolution.median !== null ? m.th_type_resolution({ time: duration(type.resolution.median) }) : undefined }))}
            empty={m.th_none()}
          />
        </div>
      </SectionCard>
      <SectionCard title={m.th_by_tag()}>
        <div class="px-5 pb-5 pt-3">
          <BarList items={stats.byTag.map((tag) => ({ id: tag.tag, label: `#${tag.tag}`, value: tag.count }))} empty={m.th_by_tag_empty()} />
        </div>
      </SectionCard>
      <SectionCard title={m.th_csat_title()}>
        <div class="px-5 pb-5 pt-3 space-y-1.5">
          {#each [5, 4, 3, 2, 1] as score (score)}
            {@const count = stats.satisfaction.distribution[score - 1] ?? 0}
            <div class="flex items-center gap-2 text-2xs text-on-surface-variant">
              <span class="w-6 tabular-nums">{score}★</span>
              <span class="flex-1 h-2 rounded-full bg-surface-container-low overflow-hidden"><span class="block h-full rounded-full" style="width: {(count / maxRating) * 100}%; background: var(--series-1)"></span></span>
              <span class="w-8 text-right tabular-nums">{count}</span>
            </div>
          {/each}
        </div>
      </SectionCard>
    </div>
  {/if}
</div>

<style>
  .tps-kpi {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.875rem 1rem;
    border: 1px solid var(--outline-variant);
    border-radius: 0.875rem;
    background: var(--surface-container-lowest);
  }
  .tps-kpi span {
    font-size: 0.75rem;
    color: var(--on-surface-variant);
  }
  .tps-kpi strong {
    font-size: 1.3rem;
    font-weight: 600;
    color: var(--on-surface);
    font-variant-numeric: tabular-nums;
  }
  .tps-kpi small {
    font-size: 0.6875rem;
    color: var(--on-surface-variant);
  }

  .tps-bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 8rem;
  }
  .tps-day {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
    gap: 1px;
  }
  .tps-bar {
    flex: 1;
    border-radius: 2px 2px 0 0;
  }
  .tps-bar--created {
    background: var(--series-1);
  }
  .tps-bar--closed {
    background: var(--series-2);
  }

  .tps-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }
  .tps-table th {
    padding: 0.6rem 1.25rem;
    text-align: left;
    font-weight: 500;
    font-size: 0.75rem;
    color: var(--on-surface-variant);
    border-bottom: 1px solid var(--outline-variant);
    white-space: nowrap;
  }
  .tps-table td {
    padding: 0.55rem 1.25rem;
    color: var(--on-surface);
    font-variant-numeric: tabular-nums;
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 50%, transparent);
    white-space: nowrap;
  }
  .tps-table tr:last-child td {
    border-bottom: none;
  }
</style>
