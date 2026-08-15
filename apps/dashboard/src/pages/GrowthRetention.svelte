<script lang="ts">
  import { onMount } from 'svelte';
  import RefreshButton from '../lib/components/RefreshButton.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import GrowthAndRetention from '../lib/components/analytics/GrowthAndRetention.svelte';
  import HourlyHeatmap from '../lib/components/analytics/HourlyHeatmap.svelte';
  import WeeklyComparison from '../lib/components/analytics/WeeklyComparison.svelte';
  import { fetchGrowthAndRetention, fetchHourlyHeatmap, fetchWeeklyComparison } from '../lib/api';
  import LoadingHint from '../lib/components/LoadingHint.svelte';


  let growthData: any = $state(null);
  let heatmapData: any = $state(null);
  let weeklyData: any = $state(null);
  let loading = $state(true);
  let error = $state('');
  let period = $state(90);
  const heatmapDays = $state(30);
  let activeTab = $state('growth');

  async function loadData() {
    loading = true;
    error = '';
    
    try {
      const [growth, heatmap, weekly] = await Promise.all([
        fetchGrowthAndRetention({ days: period }),
        fetchHourlyHeatmap({ days: heatmapDays }),
        fetchWeeklyComparison()
      ]);

      growthData = growth;
      heatmapData = heatmap;
      weeklyData = weekly;
    } catch (e) {
      error = 'Erreur lors du chargement des données';
      console.error(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadData();
  });
</script>

<div class="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20 max-w-7xl mx-auto px-4 md:px-8">
  <!-- Header -->
  <div class="relative overflow-hidden flex flex-col gap-3 rounded-xl border border-outline-variant/10 p-5 bg-surface-container-low/30 group">
    <div class="relative flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div class="flex items-center gap-4">
        <div class="bg-primary/10 p-2 rounded-xl text-primary">
          <Papicon icon="TrendingUp" size={20} />
        </div>
        <div>
          <span class="text-xs font-medium text-primary">Croissance & Rétention</span>
          <h1 class="text-lg font-semibold text-on-surface tracking-tight">Analyse de Communauté</h1>
          <p class="text-sm text-on-surface-variant/70">Suivi de la croissance, rétention et engagement</p>
        </div>
      </div>
      <RefreshButton onclick={loadData} />
    </div>
  </div>

  <!-- Tabs -->
  <div class="flex gap-2 flex-wrap">
    {#each ['growth', 'heatmap', 'weekly'] as tab}
      <button
        onclick={() => activeTab = tab}
        class="tab-button {activeTab === tab ? 'active' : ''}"
      >
        {#if tab === 'growth'}
          <Papicon icon="TrendingUp" size={14} class="inline mr-2" />
          Croissance
        {:else if tab === 'heatmap'}
          <Papicon icon="Fire" size={14} class="inline mr-2" />
          Heatmap Horaire
        {:else}
          <Papicon icon="Calendar" size={14} class="inline mr-2" />
          Comparaison
        {/if}
      </button>
    {/each}
  </div>

  <!-- Period Controls -->
  <div class="flex gap-4 flex-wrap">
    {#each [7, 30, 90] as p}
      <button
        onclick={() => {
          period = p;
          loadData();
        }}
        class="px-4 py-2 rounded-lg text-sm font-bold transition-all {period === p
 ? 'bg-secondary text-secondary-on'
          : 'bg-surface-container-high/40 text-on-surface-variant hover:bg-surface-container-high'}"
      >
        {p} jours
      </button>
    {/each}
  </div>

  {#if error}
    <div class="p-4 rounded-lg bg-error/10 border border-error/20 text-error flex items-center gap-2">
      <Papicon icon="alert-octagon" size={20} />{error}
    </div>
  {:else if loading}
    <div class="flex flex-col items-center justify-center py-24">
      <div class="relative mb-6">
        <div class="absolute -inset-4 rounded-full bg-primary/10 blur-xl animate-pulse"></div>
        <Papicon icon="loader" size={48} class="animate-spin text-primary" />
      </div>
      <p class="text-[13px] font-medium text-on-surface-variant/60">Chargement des données...</p>
      <LoadingHint context="analytics" />
    </div>
  {:else if growthData && heatmapData && weeklyData}
    {#if activeTab === 'growth'}
      <GrowthAndRetention data={growthData} />
    {:else if activeTab === 'heatmap'}
      <HourlyHeatmap data={heatmapData} />
    {:else if activeTab === 'weekly'}
      <WeeklyComparison data={weeklyData} />
    {/if}
  {/if}
</div>
