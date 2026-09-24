<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import { m, dateLocale } from '../../i18n';

  const { data = [] } = $props();

  const totalCount = $derived(data.reduce((acc: number, curr: any) => acc + curr.count, 0));
</script>

<div class="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Summary Card -->
    <div class="lg:col-span-1 bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl flex flex-col justify-center items-center text-center space-y-4">
      <div class="w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center text-primary shadow-inner">
        <Papicon icon="Code" size={32} />
      </div>
      <div>
        <h3 class="text-lg font-semibold">{totalCount.toLocaleString(dateLocale())}</h3>
        <p class="text-xs font-medium text-on-surface-variant/50">{m.an_cmd_executed()}</p>
      </div>
      <p class="text-xs text-on-surface-variant/40 max-w-[200px]">
        {m.an_cmd_summary_desc()}
      </p>
    </div>

    <!-- Usage List -->
    <div class="lg:col-span-2 bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
      <h3 class="text-xl font-semibold flex items-center gap-3">
        <Papicon icon="ChartBar" size={20} class="text-primary" />
        {m.an_cmd_breakdown()}
      </h3>

      <div class="space-y-4 max-h-[400px] overflow-y-auto pr-2 no-scrollbar">
        {#each data as cmd}
          {@const percent = (cmd.count / totalCount) * 100}
          <div class="space-y-2">
            <div class="flex justify-between items-end">
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold text-on-surface">/{cmd.name}</span>
                <span class="text-2xs font-bold text-on-surface-variant/30">{percent.toFixed(1)}%</span>
              </div>
              <span class="text-xs font-semibold text-primary">{cmd.count.toLocaleString(dateLocale())}</span>
            </div>
            <div class="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
              <div 
                class="h-full bg-primary rounded-full transition-all duration-1000 ease-out" 
                style="width: {percent}%"
              ></div>
            </div>
          </div>
        {:else}
          <div class="flex flex-col items-center justify-center py-12 text-on-surface-variant/30 space-y-3">
            <Papicon icon="Ghost" size={48} />
            <p class="text-sm font-bold">{m.an_cmd_empty()}</p>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
