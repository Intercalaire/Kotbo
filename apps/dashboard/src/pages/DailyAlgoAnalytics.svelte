<script lang="ts">
  import { onMount } from 'svelte';
  import RefreshButton from '../lib/components/RefreshButton.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import DailyAlgoAnalyticsCard from '../lib/components/analytics/DailyAlgoAnalyticsCard.svelte';
  import { fetchDailyAlgoAnalytics } from '../lib/api';
  import { m } from '../lib/i18n';


  let data: any = $state(null);
  let loading = $state(true);
  let error = $state('');
  let period = $state(30);

  async function loadData() {
    loading = true;
    error = '';
    
    try {
      const result = await fetchDailyAlgoAnalytics({ days: period });
      data = result;
    } catch (e) {
      error = m.daa_load_error();
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
          <Papicon icon="Code" size={20} />
        </div>
        <div>
          <span class="text-xs font-medium text-primary">Daily Algo</span>
          <h1 class="text-lg font-semibold text-on-surface tracking-tight">{m.daa_title()}</h1>
          <p class="text-sm text-on-surface-variant/70">{m.daa_desc()}</p>
        </div>
      </div>
      <RefreshButton onclick={loadData} />
    </div>
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
 ? 'bg-primary text-primary-on'
          : 'bg-surface-container-high/40 text-on-surface-variant hover:bg-surface-container-high'}"
      >
        {m.daa_days_unit({ count: p })}
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
      <p class="text-[13px] font-medium text-on-surface-variant/60">{m.daa_loading()}</p>
    </div>
  {:else if data}
    <DailyAlgoAnalyticsCard {data} />
  {/if}
</div>
