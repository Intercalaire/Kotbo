<!--
  Activité, un sous-onglet à la fois : messages, vocal, heures de pointe,
  records, comparaison hebdomadaire ou mensuelle, commandes, Algo du jour.
  Messages et vocal (ActivityTrafficView) suivent tous les filtres ; le reste
  suit la période.
-->
<script lang="ts" module>
  export type ActivityView = 'messages' | 'voice' | 'heatmap' | 'pulse' | 'weekly' | 'commands' | 'algo';
</script>

<script lang="ts">
  import { EmptyState, SectionCard } from '../ui';
  import AnalyticsSkeleton from './AnalyticsSkeleton.svelte';
  import ActivityTrafficView from './ActivityTrafficView.svelte';
  import HourlyHeatmap from './HourlyHeatmap.svelte';
  import CommandUsage from './CommandUsage.svelte';
  import DailyAlgoAnalyticsCard from './DailyAlgoAnalyticsCard.svelte';
  import WeeklyComparison from './WeeklyComparison.svelte';
  import AdvancedAnalyticsPanel from './AdvancedAnalyticsPanel.svelte';
  import { fetchDailyAlgoAnalytics, fetchHourlyHeatmap, fetchWeeklyComparison } from '../../api';
  import { m } from '../../i18n';
  import { analyticsFilters as filters } from './analyticsFilters.svelte';

  const {
    view,
    legacy,
    legacyLoading,
    onOpenMember,
  }: {
    view: ActivityView;
    /** Réponse de l'ancien /analytics, pour les sessions vocales et les commandes. */
    legacy: any;
    legacyLoading: boolean;
    onOpenMember: (userId: string, name: string) => void;
  } = $props();

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
</script>

{#if view === 'messages' || view === 'voice'}
  {#key view}
    <ActivityTrafficView kind={view} {legacy} {legacyLoading} {onOpenMember} />
  {/key}
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
