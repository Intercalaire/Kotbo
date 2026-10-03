<!--
  Vues Messages et Vocal d'Activité. En haut, la carte de courbe : ses tuiles
  choisissent la mesure (volume, membres actifs, volume par actif, arrivées),
  sa barre d'outils le pas et l'affichage. Dessous, les deux classements Top N
  (membres et salons), côte à côte quand la place le permet.

  Tout suit les filtres de la page ; les notes posées sur la courbe suivent
  la période.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Callout } from '../ui';
  import ActivityChartCard, { type ChartMetric } from './ActivityChartCard.svelte';
  import TopList from './TopList.svelte';
  import KpiTile from './KpiTile.svelte';
  import AnalyticsSkeleton from './AnalyticsSkeleton.svelte';
  import {
    createAnalyticsAnnotation,
    deleteAnalyticsAnnotation,
    fetchActivityAnalytics,
    fetchActivityBreakdown,
    fetchActivityHourly,
    fetchActivityRankings,
    fetchAnalyticsAnnotations,
    type ActivityAnalytics,
    type AnalyticsAnnotation,
  } from '../../api';
  import { authStore } from '../../stores/auth.svelte';
  import { dashboardStore } from '../../stores/dashboard.svelte';
  import { channelDetailsModal } from '../../stores/channelDetailsModal.svelte';
  import { m } from '../../i18n';
  import { errorMessage } from '@kotbo/shared';
  import { analyticsExport, analyticsFilters as filters, relativeDelta } from './analyticsFilters.svelte';
  import { fmtMinutes, fmtNumber, SERIES } from './analyticsFormat';

  const {
    kind,
    legacy,
    legacyLoading,
    onOpenMember,
  }: {
    kind: 'messages' | 'voice';
    /** Réponse de l'ancien /analytics : sessions vocales et affluence. */
    legacy: any;
    legacyLoading: boolean;
    onOpenMember: (userId: string, name: string) => void;
  } = $props();

  // ── Données ────────────────────────────────────────────────────────────────
  let activity = $state<ActivityAnalytics | null>(null);
  let loading = $state(true);
  let error = $state('');
  let requestId = 0;

  $effect(() => {
    const query = filters.query;
    const id = ++requestId;
    untrack(() => {
      loading = true;
      error = '';
    });
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

  let annotations = $state<AnalyticsAnnotation[]>([]);

  async function loadAnnotations(period = filters.periodQuery) {
    try {
      annotations = (await fetchAnalyticsAnnotations(period)) ?? [];
    } catch {
      annotations = [];
    }
  }

  $effect(() => {
    const period = filters.periodQuery;
    untrack(() => loadAnnotations(period));
  });

  async function annotate(dateKey: string, label: string) {
    await createAnalyticsAnnotation({ dateKey, label });
    await loadAnnotations();
  }

  async function removeAnnotation(id: string) {
    await deleteAnalyticsAnnotation(id);
    annotations = annotations.filter((a) => a.id !== id);
  }

  const canDelete = (a: AnalyticsAnnotation) =>
    a.authorId === authStore.user?.id || Boolean(dashboardStore.state.access?.canManageSettings);

  // ── Mesures ────────────────────────────────────────────────────────────────
  let active = $state<string>(untrack(() => kind));

  const series = $derived(activity?.series ?? []);
  const dates = $derived(series.map((d) => d.dateKey));
  const k = $derived(activity?.kpis);

  const ratio = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 10) / 10 : 0);
  const fmtRatio = (v: number) => fmtNumber(Math.round(v * 10) / 10);

  const metrics: ChartMetric[] = $derived.by(() => {
    if (!k) return [];
    const activeTile: ChartMetric = {
      id: 'active',
      label: m.anx_metric_active(),
      hint: m.anx_metric_active_hint(),
      color: SERIES[2]!,
      format: fmtRatio,
      value: fmtNumber(k.activeMembers.value),
      delta: relativeDelta(k.activeMembers.value, k.activeMembers.previous),
      aggregate: 'avg',
      daily: series.map((d) => d.activeMembers ?? 0),
      prevDaily: series.map((d) => d.prevActiveMembers ?? 0),
      hourly: (p) => p.activeMembers,
      forecast: false,
    };

    if (kind === 'messages') {
      const perNow = ratio(k.messages.value, k.activeMembers.value);
      const perPrev = ratio(k.messages.previous, k.activeMembers.previous);
      return [
        {
          id: 'messages',
          label: m.anx_metric_messages(),
          color: SERIES[0]!,
          format: fmtNumber,
          value: fmtNumber(k.messages.value),
          delta: relativeDelta(k.messages.value, k.messages.previous),
          aggregate: 'sum',
          daily: series.map((d) => d.messages),
          prevDaily: series.map((d) => d.prevMessages),
          hourly: (p) => p.messages,
          breakdown: 'messages',
          anomalyKey: 'messages',
          forecast: true,
        },
        activeTile,
        {
          id: 'per-active',
          label: m.anx_metric_per_active(),
          hint: m.anx_metric_per_active_hint(),
          color: SERIES[6]!,
          format: fmtRatio,
          value: fmtRatio(perNow),
          delta: relativeDelta(perNow, perPrev),
          aggregate: 'avg',
          daily: series.map((d) => ratio(d.messages, d.activeMembers ?? 0)),
          prevDaily: series.map((d) => ratio(d.prevMessages, d.prevActiveMembers ?? 0)),
          hourly: (p) => ratio(p.messages, p.activeMembers),
        },
        {
          id: 'net-joins',
          label: m.anx_metric_net_joins(),
          hint: m.anx_metric_net_joins_hint(),
          color: SERIES[3]!,
          format: fmtNumber,
          value: `${k.netJoins.value > 0 ? '+' : ''}${fmtNumber(k.netJoins.value)}`,
          delta: k.netJoins.previous > 0 ? relativeDelta(k.netJoins.value, k.netJoins.previous) : undefined,
          aggregate: 'sum',
          daily: series.map((d) => (d.joined ?? 0) - (d.left ?? 0)),
          prevDaily: series.map((d) => (d.prevJoined ?? 0) - (d.prevLeft ?? 0)),
        },
      ];
    }

    const perNow = ratio(k.voiceMinutes.value, k.activeMembers.value);
    const perPrev = ratio(k.voiceMinutes.previous, k.activeMembers.previous);
    return [
      {
        id: 'voice',
        label: m.anx_metric_voice(),
        color: SERIES[2]!,
        format: fmtMinutes,
        value: fmtMinutes(k.voiceMinutes.value),
        delta: relativeDelta(k.voiceMinutes.value, k.voiceMinutes.previous),
        aggregate: 'sum',
        daily: series.map((d) => d.voiceMinutes),
        prevDaily: series.map((d) => d.prevVoiceMinutes),
        hourly: (p) => p.voiceMinutes,
        breakdown: 'voice',
        anomalyKey: 'voiceMinutes',
        forecast: true,
      },
      { ...activeTile, color: SERIES[0]! },
      {
        id: 'voice-per-active',
        label: m.anx_metric_voice_per_active(),
        hint: m.anx_metric_voice_per_active_hint(),
        color: SERIES[6]!,
        format: fmtMinutes,
        value: fmtMinutes(perNow),
        delta: relativeDelta(perNow, perPrev),
        aggregate: 'avg',
        daily: series.map((d) => ratio(d.voiceMinutes, d.activeMembers ?? 0)),
        prevDaily: series.map((d) => ratio(d.prevVoiceMinutes, d.prevActiveMembers ?? 0)),
        hourly: (p) => ratio(p.voiceMinutes, p.activeMembers),
      },
    ];
  });

  const hourlyPossible = $derived(filters.days <= 14 && !filters.channel && !filters.role && !filters.excludeStaff);
  const format = $derived(kind === 'messages' ? fmtNumber : fmtMinutes);

  // Sessions et affluence : seule l'ancienne réponse les porte (période seule).
  const voiceSessions = $derived((legacy?.dailyTrend ?? []).reduce((s: number, d: any) => s + (d.voiceSessions ?? 0), 0));
  const peakVoice = $derived(Math.max(0, ...(legacy?.dailyTrend ?? []).map((d: any) => d.peakVoice ?? 0)));
</script>

{#if loading && !activity}
  <AnalyticsSkeleton />
{:else if error && !activity}
  <Callout variant="danger" title={m.an_error_generic()}>{error}</Callout>
{:else if activity && k}
  {#if kind === 'voice' && !activity.voiceAvailable}
    <Callout variant="info">{m.anx_voice_unavailable()}</Callout>
  {:else}
    <div class="flex flex-col gap-4">
      <ActivityChartCard
        {metrics}
        {active}
        onchange={(id) => (active = id)}
        {dates}
        days={filters.days}
        compare={filters.compare}
        onToggleCompare={() => filters.toggleCompare()}
        {hourlyPossible}
        loadHourly={() => fetchActivityHourly(filters.query)}
        loadBreakdown={(metric, dimension) => fetchActivityBreakdown(filters.query, metric, dimension)}
        reloadKey={filters.key}
        anomalies={activity.anomalies ?? []}
        {annotations}
        onAnnotate={annotate}
        onDeleteAnnotation={removeAnnotation}
        canDeleteAnnotation={canDelete}
        busy={loading}
        forecastAllowed={!filters.isCustom}
      />

      {#if kind === 'voice'}
        <div class="kpi-grid" style="--kpi-cols: 2;">
          <KpiTile label={m.anx_kpi_voice_sessions()} value={legacy ? fmtNumber(voiceSessions) : legacyLoading ? '…' : '—'} hint={m.anx_period_only_note()} />
          <KpiTile label={m.anx_kpi_peak_voice()} value={legacy ? fmtNumber(peakVoice) : legacyLoading ? '…' : '—'} hint={m.anx_kpi_peak_voice_hint()} />
        </div>
      {/if}

      <div class="top-grid">
        <TopList
          title={kind === 'messages' ? m.anx_top_members_messages() : m.anx_top_members_voice()}
          description={m.anx_top_follows_filters()}
          icon={kind === 'messages' ? 'UsersFour' : 'Microphone'}
          kind="members"
          load={(limit) => fetchActivityRankings(filters.query, kind, 'members', limit)}
          reloadKey={`${filters.key}|${kind}`}
          {format}
          compare={filters.compare}
          color={kind === 'messages' ? SERIES[0] : SERIES[2]}
          onselect={(item) => onOpenMember(item.id, item.name ?? '')}
          exportName={kind === 'messages' ? 'top_membres_messages' : 'top_membres_vocal'}
        />
        <TopList
          title={kind === 'messages' ? m.anx_top_channels_messages() : m.anx_top_channels_voice()}
          description={m.anx_top_follows_filters()}
          icon={kind === 'messages' ? 'ChatBubbles' : 'Microphone'}
          kind="channels"
          load={(limit) => fetchActivityRankings(filters.query, kind, 'channels', limit)}
          reloadKey={`${filters.key}|${kind}`}
          {format}
          compare={filters.compare}
          color={kind === 'messages' ? SERIES[0] : SERIES[2]}
          onselect={(item) => channelDetailsModal.show(item.id, item.name ? `#${item.name}` : m.anx_channel_deleted())}
          exportName={kind === 'messages' ? 'top_salons_messages' : 'top_salons_vocal'}
        />
      </div>
    </div>
  {/if}
{/if}

<style>
  .top-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    align-items: start;
  }
</style>
