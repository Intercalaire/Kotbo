<!--
  Activité : messages et vocal jour par jour (suivent tous les filtres), les
  salons les plus actifs, les heures de pointe, les classements de membres,
  les commandes utilisées et, si le module tourne, l'Algo du jour.
-->
<script lang="ts">
  import { Callout, EmptyState, FilterPills, SectionCard } from '../ui';
  import BarList, { type BarListItem } from './BarList.svelte';
  import TrendChart from './TrendChart.svelte';
  import AnalyticsSkeleton from './AnalyticsSkeleton.svelte';
  import EngagementMetrics from './EngagementMetrics.svelte';
  import HourlyHeatmap from './HourlyHeatmap.svelte';
  import CommandUsage from './CommandUsage.svelte';
  import DailyAlgoAnalyticsCard from './DailyAlgoAnalyticsCard.svelte';
  import {
    fetchActivityAnalytics,
    fetchDailyAlgoAnalytics,
    fetchHourlyHeatmap,
    type ActivityAnalytics,
  } from '../../api';
  import { channelDetailsModal } from '../../stores/channelDetailsModal.svelte';
  import { m } from '../../i18n';
  import { errorMessage } from '@kotbo/shared';
  import { analyticsExport, analyticsFilters as filters } from './analyticsFilters.svelte';
  import { fmtMinutes, fmtNumber, SERIES } from './analyticsFormat';

  const {
    legacy,
    legacyLoading,
    onOpenMember,
  }: {
    /** Réponse de l'ancien /analytics, pour les classements et les commandes. */
    legacy: any;
    legacyLoading: boolean;
    onOpenMember: (userId: string, name: string) => void;
  } = $props();

  let activity = $state<ActivityAnalytics | null>(null);
  let heatmap = $state<any>(null);
  let algo = $state<any>(null);
  let loading = $state(true);
  let error = $state('');
  let requestId = 0;

  $effect(() => {
    const query = filters.query;
    const id = ++requestId;
    loading = true;
    error = '';
    fetchActivityAnalytics(query)
      .then((res) => {
        if (id !== requestId) return;
        activity = res;
        analyticsExport.activity = res;
      })
      .catch((e) => {
        if (id === requestId) error = errorMessage(e) || m.an_error_generic();
      })
      .finally(() => {
        if (id === requestId) loading = false;
      });
  });

  $effect(() => {
    const period = filters.periodQuery;
    const range = period.startDate ? { startDate: period.startDate, endDate: period.endDate } : { days: period.period };
    fetchHourlyHeatmap(range).then((res) => (heatmap = res)).catch(() => (heatmap = null));
    fetchDailyAlgoAnalytics(range).then((res) => (algo = res)).catch(() => (algo = null));
  });

  let rankingMode = $state<'messages' | 'voice'>('messages');

  const dates = $derived(activity?.series.map((d) => d.dateKey) ?? []);
  const topChannels: BarListItem[] = $derived(
    (activity?.topChannels ?? []).map((c) => ({ id: c.channelId, label: c.name ? `#${c.name}` : m.anx_channel_deleted(), value: c.messages })),
  );
  const algoHasData = $derived((algo?.metrics?.totalRuns ?? 0) > 0);
</script>

{#if loading && !activity}
  <AnalyticsSkeleton />
{:else if error}
  <Callout variant="danger" title={m.an_error_generic()}>{error}</Callout>
{:else if activity}
  <div class="flex flex-col gap-4" aria-busy={loading}>
    <div class="section-grid">
      <div class={activity.voiceAvailable ? 'span-6' : 'span-12'}>
        <SectionCard title={m.anx_trend_messages_title()}>
          <TrendChart
            {dates}
            values={activity.series.map((d) => d.messages)}
            previous={activity.series.map((d) => d.prevMessages)}
            label={m.anx_trend_current()}
            previousLabel={m.anx_trend_previous()}
            compare={filters.compare}
            format={fmtNumber}
          />
        </SectionCard>
      </div>
      {#if activity.voiceAvailable}
        <div class="span-6">
          <SectionCard title={m.anx_trend_voice_title()}>
            <TrendChart
              {dates}
              values={activity.series.map((d) => d.voiceMinutes)}
              previous={activity.series.map((d) => d.prevVoiceMinutes)}
              label={m.anx_trend_current()}
              previousLabel={m.anx_trend_previous()}
              compare={filters.compare}
              color={SERIES[1]}
              format={fmtMinutes}
            />
          </SectionCard>
        </div>
      {:else}
        <div class="span-12">
          <Callout variant="info">{m.anx_voice_unavailable()}</Callout>
        </div>
      {/if}
    </div>

    <div class="section-grid">
      <div class="span-5">
        <SectionCard title={m.anx_top_channels_title()}>
          <BarList items={topChannels} empty={m.anx_top_channels_empty()} onselect={(item) => channelDetailsModal.show(item.id, item.label)} />
        </SectionCard>
      </div>
      <div class="span-7">
        <SectionCard title={m.anx_heatmap_title()} description={m.anx_period_only_note()}>
          {#if heatmap}
            <HourlyHeatmap data={heatmap} />
          {:else}
            <p class="text-body-sm text-on-surface-variant">{m.an_loading_short()}</p>
          {/if}
        </SectionCard>
      </div>
    </div>

    <SectionCard title={m.anx_rankings_title()} description={m.anx_period_only_note()}>
      {#snippet actions()}
        <FilterPills
          label={m.anx_rankings_mode_label()}
          options={[{ value: 'messages', label: m.an_tab_messages() }, { value: 'voice', label: m.an_tab_voice() }]}
          value={rankingMode}
          onchange={(v) => (rankingMode = v as typeof rankingMode)}
        />
      {/snippet}
      {#if legacyLoading && !legacy}
        <AnalyticsSkeleton />
      {:else if legacy}
        <EngagementMetrics data={legacy} mode={rankingMode} {onOpenMember} />
      {/if}
    </SectionCard>

    <SectionCard title={m.an_tab_commands()} description={m.anx_period_only_note()}>
      {#if legacy?.commandUsage?.length > 0}
        <CommandUsage data={legacy.commandUsage} />
      {:else if !legacyLoading}
        <EmptyState icon="Code" title={m.an_commands_empty_title()} description={m.an_commands_empty_desc()} />
      {/if}
    </SectionCard>

    {#if algoHasData}
      <SectionCard title={m.an_tab_algo()} description={m.anx_period_only_note()}>
        <DailyAlgoAnalyticsCard data={algo} />
      </SectionCard>
    {/if}
  </div>
{/if}
