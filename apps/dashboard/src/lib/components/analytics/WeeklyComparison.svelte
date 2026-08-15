<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import { fetchWeeklyComparison } from '../../api';
  import { m, dateLocale } from '../../i18n';

  type ComparisonData = {
    thisWeek: { messages: number; voiceMinutes: number; joins: number; leaves: number; sanctions: number };
    lastWeek: { messages: number; voiceMinutes: number; joins: number; leaves: number; sanctions: number };
    changes: { messagesChange: number; voiceChange: number; joinsChange: number; leavesChange: number; sanctionsChange: number };
  };

  const { data: initialData = null }: { data?: ComparisonData | null } = $props();

  // Period selector state
  type PeriodMode = 'week' | 'month';
  let selectedMode = $state<PeriodMode>('week');
  let selectedOffset = $state(1);
  let data = $state<any>(null);
  $effect(() => {
    data = initialData;
  });
  let loading = $state(false);

  const weekOptions = $derived([1, 2, 3, 4, 5].map(offset => ({
    offset,
    label: offset === 1 ? m.an_wk_last_week() : m.an_wk_weeks_ago({ n: offset })
  })));

  const monthOptions = $derived([1, 2, 3, 4, 5].map(offset => ({
    offset,
    label: offset === 1 ? m.an_wk_last_month() : m.an_wk_months_ago({ n: offset })
  })));

  async function loadComparison() {
    loading = true;
    try {
      const result = await fetchWeeklyComparison({ offset: selectedOffset, mode: selectedMode });
      data = result;
    } catch (e) {
      console.error('Error loading comparison:', e);
    } finally {
      loading = false;
    }
  }

  async function setMode(mode: PeriodMode) {
    selectedMode = mode;
    selectedOffset = 1;
    await loadComparison();
  }

  async function setOffset(offset: number) {
    selectedOffset = offset;
    await loadComparison();
  }

  const getChangeColor = (change: number) => {
    if (change > 0) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (change < 0) return 'text-red-400 bg-red-500/10 border-red-500/20';
    return 'text-on-surface-variant/40 bg-surface-container-high border-outline-variant/10';
  };

  const getChangeIcon = (change: number) => {
    if (change > 0) return 'TrendingUp';
    if (change < 0) return 'TrendingDown';
    return 'Minus';
  };

  const metrics = $derived([
    { label: m.an_wk_metric_messages(), key: 'messages', icon: 'ChatCircleDots', color: '#6366f1', accentLight: '#6366f115', change: data?.changes?.messagesChange ?? 0 },
    { label: m.an_wk_metric_voice(), key: 'voiceMinutes', icon: 'Microphone', color: '#ec4899', accentLight: '#ec489915', suffix: m.an_unit_min(), change: data?.changes?.voiceChange ?? 0 },
    { label: m.an_wk_metric_joins(), key: 'joins', icon: 'LogIn', color: '#10b981', accentLight: '#10b98115', change: data?.changes?.joinsChange ?? 0 },
    { label: m.an_wk_metric_leaves(), key: 'leaves', icon: 'LogOut', color: '#f97316', accentLight: '#f9731615', change: data?.changes?.leavesChange ?? 0 },
    { label: m.an_wk_metric_sanctions(), key: 'sanctions', icon: 'Hammer', color: '#ef4444', accentLight: '#ef444415', change: data?.changes?.sanctionsChange ?? 0 },
  ]);

  const currentPeriodLabel = $derived(
    selectedMode === 'week' ? m.an_wk_this_week() : m.an_wk_this_month()
  );
  const previousPeriodLabel = $derived(
    selectedMode === 'week'
      ? weekOptions.find(w => w.offset === selectedOffset)?.label ?? m.an_wk_last_week()
      : monthOptions.find(o => o.offset === selectedOffset)?.label ?? m.an_wk_last_month()
  );
  const currentOptions = $derived(selectedMode === 'week' ? weekOptions : monthOptions);
</script>

<div class="space-y-8">
  <!-- Header -->
  <div class="flex flex-col md:flex-row md:items-center justify-between gap-6 premium-card p-6 md:p-8 rounded-xl">
    <div class="flex items-center gap-4">
      <div class="bg-primary/10 p-4 rounded-xl text-primary shadow-inner">
        <Papicon icon="calendar" size={28} />
      </div>
      <div>
        <h3 class="text-2xl font-semibold text-on-surface tracking-tight">{m.an_wk_title()}</h3>
        <p class="text-sm font-bold text-on-surface-variant/50">{m.an_wk_subtitle()}</p>
      </div>
    </div>

    <!-- Period Controls -->
    <div class="flex flex-col gap-3">
      <!-- Mode Toggle (Week / Month) -->
      <div class="flex items-center gap-2 bg-surface-container-high/40 p-1.5 rounded-lg border border-outline-variant/10 self-start">
        <button
          onclick={() => setMode('week')}
          class="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all duration-300 {selectedMode === 'week' ? 'bg-primary text-on-primary shadow-lg' : 'text-on-surface-variant/60 hover:text-on-surface'}"
        >
          <Papicon icon="CalendarBlank" size={12} />
          {m.an_wk_mode_week()}
        </button>
        <button
          onclick={() => setMode('month')}
          class="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all duration-300 {selectedMode === 'month' ? 'bg-primary text-on-primary shadow-lg' : 'text-on-surface-variant/60 hover:text-on-surface'}"
        >
          <Papicon icon="CalendarDots" size={12} />
          {m.an_wk_mode_month()}
        </button>
      </div>

      <!-- Offset Selector -->
      <div class="flex flex-wrap gap-1.5">
        {#each currentOptions as opt}
          <button
            onclick={() => setOffset(opt.offset)}
            class="px-3 py-1.5 rounded-xl text-[11px] font-semibold uppercase tracking-widest transition-all duration-200 border {selectedOffset === opt.offset ? 'bg-primary/10 text-primary border-primary/30 shadow-inner' : 'text-on-surface-variant/50 border-outline-variant/10 hover:bg-surface-container-high hover:text-on-surface'}"
          >
            {selectedMode === 'week' ? m.an_wk_offset_week({ n: opt.offset }) : m.an_wk_offset_month({ n: opt.offset })}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- Period Legend -->
  <div class="flex flex-wrap items-center gap-3">
    <div class="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-400/10 border border-slate-400/15 text-[10px] font-semibold uppercase text-slate-400">
      <div class="w-2 h-2 rounded-full bg-slate-400/50"></div>
      {previousPeriodLabel}
    </div>
    <div class="text-on-surface-variant/30 text-xs font-bold">→</div>
    <div class="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-[10px] font-semibold uppercase text-primary">
      <div class="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
      {currentPeriodLabel}
    </div>
    {#if loading}
      <div class="flex items-center gap-2 text-[10px] font-bold text-on-surface-variant/40">
        <div class="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
        {m.common_loading()}
      </div>
    {/if}
  </div>

  <!-- Metrics Grid -->
  {#if data}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      {#each metrics as metric}
        {@const thisVal = data.thisWeek[metric.key as keyof typeof data.thisWeek]}
        {@const lastVal = data.lastWeek[metric.key as keyof typeof data.lastWeek]}
        {@const pct = lastVal > 0 ? ((thisVal - lastVal) / lastVal) * 100 : thisVal > 0 ? 100 : 0}
        {@const barW = Math.max(thisVal, lastVal) > 0 ? Math.round((thisVal / Math.max(thisVal, lastVal)) * 100) : 0}
        {@const lastBarW = Math.max(thisVal, lastVal) > 0 ? Math.round((lastVal / Math.max(thisVal, lastVal)) * 100) : 0}
        <div class="premium-card p-6 rounded-xl border border-outline-variant/10 hover:border-primary/20 transition-all duration-500 group relative overflow-hidden">
          <!-- Glow -->
          <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 rounded-xl" style="background: radial-gradient(ellipse at top left, {metric.accentLight} 0%, transparent 60%)"></div>
          
          <!-- Header -->
          <div class="relative flex items-start justify-between mb-5">
            <div class="flex items-center gap-3">
              <div class="p-2.5 rounded-xl border border-outline-variant/10 bg-surface-container-low group- transition-transform duration-500" style="color: {metric.color}">
                <Papicon icon={metric.icon} size={20} />
              </div>
              <p class="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">{metric.label}</p>
            </div>
            <div class="px-2.5 py-1 rounded-xl flex items-center gap-1 border text-xs font-semibold {getChangeColor(metric.change)}">
              <Papicon icon={getChangeIcon(metric.change)} size={12} />
              {metric.change > 0 ? '+' : ''}{metric.change}%
            </div>
          </div>

          <!-- Values Comparison -->
          <div class="relative space-y-3 mb-5">
            <!-- Current period -->
            <div class="space-y-1">
              <div class="flex items-center justify-between text-[11px] font-semibold uppercase tracking-widest">
                <span class="text-primary/80">{currentPeriodLabel}</span>
                <span class="text-on-surface font-semibold text-sm">
                  {thisVal.toLocaleString(dateLocale())}
                  {#if metric.suffix}<span class="text-[10px] text-on-surface-variant/40 ml-0.5">{metric.suffix}</span>{/if}
                </span>
              </div>
              <div class="h-2 bg-surface-container-high rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-700" style="width: {barW}%; background: {metric.color}"></div>
              </div>
            </div>

            <!-- Previous period -->
            <div class="space-y-1">
              <div class="flex items-center justify-between text-[11px] font-semibold uppercase tracking-widest">
                <span class="text-on-surface-variant/40">{previousPeriodLabel}</span>
                <span class="text-on-surface-variant/60 text-sm font-bold">
                  {lastVal.toLocaleString(dateLocale())}
                  {#if metric.suffix}<span class="text-[10px] ml-0.5 opacity-50">{metric.suffix}</span>{/if}
                </span>
              </div>
              <div class="h-2 bg-surface-container-high rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-700 opacity-30" style="width: {lastBarW}%; background: {metric.color}"></div>
              </div>
            </div>
          </div>

          <!-- Delta absolute -->
          <div class="relative pt-4 border-t border-outline-variant/10 flex items-center justify-between">
            <span class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/30">{m.an_wk_absolute_change()}</span>
            <span class="text-xs font-semibold {pct >= 0 ? 'text-emerald-400' : 'text-red-400'}">
              {thisVal - lastVal >= 0 ? '+' : ''}{(thisVal - lastVal).toLocaleString(dateLocale())}
              {#if metric.suffix}<span class="opacity-60 ml-0.5">{metric.suffix}</span>{/if}
            </span>
          </div>
        </div>
      {/each}

      <!-- Summary Card -->
      <div class="premium-card p-8 rounded-xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/10 flex flex-col justify-center">
        <div class="space-y-4">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 text-primary text-xs font-medium">
            <Papicon icon="TrendingUp" size={12} />
            {m.an_wk_analysis()}
          </div>
          <h4 class="text-2xl font-semibold text-on-surface leading-tight">
            {m.an_wk_progress_title()}
          </h4>
          <p class="text-sm font-medium text-on-surface-variant/60 leading-relaxed">
            {selectedMode === 'week'
              ? m.an_wk_compare_week({ previous: previousPeriodLabel.toLowerCase() })
              : m.an_wk_compare_month({ previous: previousPeriodLabel.toLowerCase() })}
            {m.an_wk_progress_hint()}
          </p>
          {#if data.thisWeek.joins + data.thisWeek.leaves > 0}
            <div class="pt-4 border-t border-primary/10">
              <div class="flex items-center justify-between text-xs font-bold text-primary">
                <span>{m.an_wk_estimated_retention()}</span>
                <span>{Math.round(100 - (data.thisWeek.leaves / (data.thisWeek.joins || 1) * 100))}%</span>
              </div>
              <div class="mt-2 h-1.5 bg-primary/10 rounded-full overflow-hidden">
                <div class="h-full bg-primary rounded-full transition-all duration-700" style="width: {Math.max(0, Math.round(100 - (data.thisWeek.leaves / (data.thisWeek.joins || 1) * 100)))}%"></div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
