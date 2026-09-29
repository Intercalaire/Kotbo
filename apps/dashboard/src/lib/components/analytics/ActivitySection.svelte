<!--
  Activité, un sous-onglet à la fois : messages, vocal, heures de pointe,
  records, comparaison hebdomadaire ou mensuelle, commandes, Algo du jour.
  Les courbes de messages et de vocal suivent tous les filtres ; le reste suit
  la période.
-->
<script lang="ts" module>
  export type ActivityView = 'messages' | 'voice' | 'heatmap' | 'pulse' | 'weekly' | 'commands' | 'algo';
</script>

<script lang="ts">
  import { Callout, EmptyState, SectionCard } from '../ui';
  import BarList, { type BarListItem } from './BarList.svelte';
  import TrendChart from './TrendChart.svelte';
  import KpiTile from './KpiTile.svelte';
  import AnalyticsSkeleton from './AnalyticsSkeleton.svelte';
  import EngagementMetrics from './EngagementMetrics.svelte';
  import HourlyHeatmap from './HourlyHeatmap.svelte';
  import CommandUsage from './CommandUsage.svelte';
  import DailyAlgoAnalyticsCard from './DailyAlgoAnalyticsCard.svelte';
  import WeeklyComparison from './WeeklyComparison.svelte';
  import AdvancedAnalyticsPanel from './AdvancedAnalyticsPanel.svelte';
  import {
    fetchActivityAnalytics,
    fetchDailyAlgoAnalytics,
    fetchHourlyHeatmap,
    fetchWeeklyComparison,
    type ActivityAnalytics,
  } from '../../api';
  import { channelDetailsModal } from '../../stores/channelDetailsModal.svelte';
  import { m } from '../../i18n';
  import { errorMessage } from '@kotbo/shared';
  import { analyticsExport, analyticsFilters as filters, relativeDelta } from './analyticsFilters.svelte';
  import { fmtMinutes, fmtNumber, SERIES } from './analyticsFormat';

  const {
    view,
    legacy,
    legacyLoading,
    onOpenMember,
  }: {
    view: ActivityView;
    /** Réponse de l'ancien /analytics, pour les classements et les commandes. */
    legacy: any;
    legacyLoading: boolean;
    onOpenMember: (userId: string, name: string) => void;
  } = $props();

  let activity = $state<ActivityAnalytics | null>(null);
  let loading = $state(true);
  let error = $state('');
  let requestId = 0;

  const needsActivity = $derived(view === 'messages' || view === 'voice');

  $effect(() => {
    if (!needsActivity) return;
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

  let heatmap = $state<any>(null);
  let algo = $state<any>(null);
  let weekly = $state<any>(null);
  let weeklyLoaded = $state(false);

  $effect(() => {
    if (view !== 'weekly' || weeklyLoaded) return;
    fetchWeeklyComparison()
      .then((res) => (weekly = res))
      .catch(() => (weekly = null))
      .finally(() => (weeklyLoaded = true));
  });

  $effect(() => {
    if (view !== 'heatmap' && view !== 'algo') return;
    const period = filters.periodQuery;
    const range = period.startDate ? { startDate: period.startDate, endDate: period.endDate } : { days: period.period };
    if (view === 'heatmap') {
      fetchHourlyHeatmap(range).then((res) => (heatmap = res)).catch(() => (heatmap = null));
    } else {
      fetchDailyAlgoAnalytics(range).then((res) => (algo = res)).catch(() => (algo = null));
    }
  });

  const dates = $derived(activity?.series.map((d) => d.dateKey) ?? []);
  const k = $derived(activity?.kpis);
  const topChannels: BarListItem[] = $derived(
    (activity?.topChannels ?? []).map((c) => ({ id: c.channelId, label: c.name ? `#${c.name}` : m.anx_channel_deleted(), value: c.messages })),
  );

  /** Moyenne par jour et jour de pic de la courbe affichée. */
  function dailyStats(values: number[]) {
    const total = values.reduce((s, v) => s + v, 0);
    let peakIndex = 0;
    values.forEach((v, i) => {
      if (v > (values[peakIndex] ?? 0)) peakIndex = i;
    });
    return { avg: values.length > 0 ? total / values.length : 0, peak: values[peakIndex] ?? 0, peakDate: dates[peakIndex] ?? null };
  }

  const messageStats = $derived(dailyStats(activity?.series.map((d) => d.messages) ?? []));
  const voiceStats = $derived(dailyStats(activity?.series.map((d) => d.voiceMinutes) ?? []));
  const voiceSessions = $derived((legacy?.dailyTrend ?? []).reduce((s: number, d: any) => s + (d.voiceSessions ?? 0), 0));
  const peakVoice = $derived(Math.max(0, ...(legacy?.dailyTrend ?? []).map((d: any) => d.peakVoice ?? 0)));
</script>

{#if needsActivity}
  {#if loading && !activity}
    <AnalyticsSkeleton />
  {:else if error}
    <Callout variant="danger" title={m.an_error_generic()}>{error}</Callout>
  {:else if activity && k}
    <div class="flex flex-col gap-4" aria-busy={loading}>
      {#if view === 'messages'}
        <div class="kpi-grid kpi-grid--4">
          <KpiTile label={m.anx_kpi_messages()} value={fmtNumber(k.messages.value)} delta={relativeDelta(k.messages.value, k.messages.previous)} compare={filters.compare} />
          <KpiTile label={m.anx_kpi_per_day()} value={fmtNumber(Math.round(messageStats.avg))} />
          <KpiTile label={m.anx_kpi_peak_day()} value={fmtNumber(messageStats.peak)} hint={messageStats.peakDate ?? ''} />
          <KpiTile label={m.anx_kpi_active_members()} value={fmtNumber(k.activeMembers.value)} delta={relativeDelta(k.activeMembers.value, k.activeMembers.previous)} compare={filters.compare} />
        </div>
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
        <div class="section-grid">
          <div class="span-5">
            <SectionCard title={m.anx_top_channels_title()}>
              <BarList items={topChannels} empty={m.anx_top_channels_empty()} onselect={(item) => channelDetailsModal.show(item.id, item.label)} />
            </SectionCard>
          </div>
          <div class="span-7">
            <SectionCard title={m.anx_rankings_title()} description={m.anx_period_only_note()}>
              {#if legacyLoading && !legacy}
                <AnalyticsSkeleton />
              {:else if legacy}
                <EngagementMetrics data={legacy} mode="messages" {onOpenMember} />
              {/if}
            </SectionCard>
          </div>
        </div>
      {:else if !activity.voiceAvailable}
        <Callout variant="info">{m.anx_voice_unavailable()}</Callout>
      {:else}
        <div class="kpi-grid kpi-grid--4">
          <KpiTile label={m.anx_kpi_voice()} value={fmtMinutes(k.voiceMinutes.value)} delta={relativeDelta(k.voiceMinutes.value, k.voiceMinutes.previous)} compare={filters.compare} />
          <KpiTile label={m.anx_kpi_voice_per_day()} value={fmtMinutes(voiceStats.avg)} />
          <KpiTile label={m.anx_kpi_voice_sessions()} value={legacy ? fmtNumber(voiceSessions) : '—'} hint={m.anx_period_only_note()} />
          <KpiTile label={m.anx_kpi_peak_voice()} value={legacy ? fmtNumber(peakVoice) : '—'} hint={m.anx_kpi_peak_voice_hint()} />
        </div>
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
        <SectionCard title={m.anx_rankings_title()} description={m.anx_period_only_note()}>
          {#if legacyLoading && !legacy}
            <AnalyticsSkeleton />
          {:else if legacy}
            <EngagementMetrics data={legacy} mode="voice" {onOpenMember} />
          {/if}
        </SectionCard>
      {/if}
    </div>
  {/if}
{:else if view === 'heatmap'}
  {#if heatmap}
    <HourlyHeatmap data={heatmap} />
  {:else}
    <AnalyticsSkeleton />
  {/if}
{:else if view === 'pulse'}
  <AdvancedAnalyticsPanel section="activity" {onOpenMember} />
{:else if view === 'weekly'}
  {#if weeklyLoaded}
    <WeeklyComparison data={weekly} />
  {:else}
    <AnalyticsSkeleton />
  {/if}
{:else if view === 'commands'}
  {#if legacyLoading && !legacy}
    <AnalyticsSkeleton />
  {:else if legacy?.commandUsage?.length > 0}
    <CommandUsage data={legacy.commandUsage} />
  {:else}
    <SectionCard>
      <EmptyState icon="Code" title={m.an_commands_empty_title()} description={m.an_commands_empty_desc()} />
    </SectionCard>
  {/if}
{:else if view === 'algo'}
  {#if !algo}
    <AnalyticsSkeleton />
  {:else if (algo?.metrics?.totalRuns ?? 0) > 0}
    <DailyAlgoAnalyticsCard data={algo} />
  {:else}
    <SectionCard>
      <EmptyState icon="Code" title={m.anx_algo_empty_title()} description={m.anx_algo_empty_desc()} />
    </SectionCard>
  {/if}
{/if}
