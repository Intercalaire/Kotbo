<!--
  Croissance : arrivées, départs et solde de la période, puis la rétention par
  cohorte et les membres dont l'activité décroche.
-->
<script lang="ts">
  import { Callout } from '../ui';
  import KpiTile from './KpiTile.svelte';
  import AdvancedAnalyticsPanel from './AdvancedAnalyticsPanel.svelte';
  import { fetchActivityAnalytics, type ActivityAnalytics } from '../../api';
  import { m } from '../../i18n';
  import { analyticsFilters as filters } from './analyticsFilters.svelte';
  import { fmtNumber } from './analyticsFormat';

  const { onOpenMember }: { onOpenMember: (userId: string, name: string) => void } = $props();

  let activity = $state<ActivityAnalytics | null>(null);
  let requestId = 0;

  $effect(() => {
    // Arrivées et départs sont comptés pour tout le serveur : seule la période compte.
    const query = { ...filters.periodQuery, includeBots: filters.includeBots };
    const id = ++requestId;
    fetchActivityAnalytics(query)
      .then((res) => {
        if (id === requestId) activity = res;
      })
      .catch(() => {
        if (id === requestId) activity = null;
      });
  });

  const k = $derived(activity?.kpis);
</script>

<div class="flex flex-col gap-4">
  {#if k}
    <div class="kpi-grid kpi-grid--4">
      <KpiTile label={m.anx_growth_joined()} value={fmtNumber(k.joined)} />
      <KpiTile label={m.anx_growth_left()} value={fmtNumber(k.left)} />
      <KpiTile label={m.anx_kpi_net_joins()} value={`${k.netJoins.value > 0 ? '+' : ''}${fmtNumber(k.netJoins.value)}`} delta={k.netJoins.value - k.netJoins.previous} unit="abs" compare={filters.compare} />
      {#if k.memberCount !== null}
        <KpiTile label={filters.includeBots ? m.anx_kpi_members_with_bots() : m.anx_kpi_members()} value={fmtNumber(k.memberCount)} />
      {/if}
    </div>
  {/if}
  <Callout variant="info">{m.anx_growth_fixed_window()}</Callout>
  <div class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold text-on-surface">{m.an_tab_cohorts()}</h3>
    <AdvancedAnalyticsPanel section="retention" {onOpenMember} />
  </div>
  <div class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold text-on-surface">{m.an_tab_churn()}</h3>
    <AdvancedAnalyticsPanel section="churn" {onOpenMember} />
  </div>
</div>
