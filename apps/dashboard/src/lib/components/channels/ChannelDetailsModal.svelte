<script lang="ts">
  /**
   * Vue détaillée d'un salon, ouverte par `channelDetailsModal.show(id, name)`.
   * Montée une seule fois dans App.svelte : les listes de salons n'ont qu'à
   * appeler le store, sans gérer d'état local ni remonter d'événement.
   */
  import { portal } from '../../actions/portal';
  import { router } from 'tinro';
  import Papicon from '../Papicon.svelte';
  import Chart from '../charts/Chart.svelte';
  import { memberAvatarSrc } from '../../discordMedia';
  import { channelDetailsModal } from '../../stores/channelDetailsModal.svelte';
  import { fetchChannelDetails } from '../../api';
  import { m, dateLocale } from '../../i18n';

  type ChannelTab = 'resume' | 'activite' | 'membres' | 'contenu' | 'moderation' | 'config';

  let details = $state<any>(null);
  let loading = $state(false);
  let error = $state('');
  let days = $state(30);
  let activeTab = $state<ChannelTab>('resume');
  let activityMetric = $state<'messages' | 'uniqueAuthors' | 'voiceMinutes'>('messages');

  const isOpen = $derived(channelDetailsModal.open);
  const channelId = $derived(channelDetailsModal.channelId);

  const displayName = $derived(
    details?.channel?.name ?? channelDetailsModal.channelName ?? channelId ?? ''
  );

  const typeIcon = $derived.by(() => {
    switch (details?.channel?.type) {
      case 'voice':
      case 'stage': return 'Mic';
      case 'forum': return 'ChatBubbles';
      case 'media': return 'Image';
      case 'announcement': return 'Megaphone';
      case 'thread': return 'GitBranch';
      default: return 'Hash';
    }
  });

  $effect(() => {
    if (!isOpen || !channelId) return;
    void loadDetails();
  });

  $effect(() => {
    if (isOpen) return;
    details = null;
    error = '';
    loading = false;
    activeTab = 'resume';
  });

  async function loadDetails() {
    if (!channelId) return;
    loading = true;
    error = '';
    try {
      details = await fetchChannelDetails(channelId, { days });
    } catch (err: any) {
      error = err?.message || m.chd_load_error();
      details = null;
    } finally {
      loading = false;
    }
  }

  function closeModal() {
    channelDetailsModal.close();
  }

  function openMember(userId: string) {
    closeModal();
    router.goto(`/members/${userId}`);
  }

  function formatDate(value: string | Date | null | undefined) {
    if (!value) return m.chd_unknown();
    return new Date(value).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTime(value: string | Date | null | undefined) {
    if (!value) return m.chd_unknown();
    return new Date(value).toLocaleString(dateLocale());
  }

  function formatNumber(value: number | null | undefined) {
    return (value ?? 0).toLocaleString(dateLocale());
  }

  function formatChange(value: number | null | undefined) {
    if (value === null || value === undefined) return '-';
    return `${value > 0 ? '+' : ''}${value} %`;
  }

  function changeClass(value: number | null | undefined) {
    if (value === null || value === undefined) return 'text-on-surface-variant/50';
    if (value > 0) return 'text-emerald-500';
    if (value < 0) return 'text-red-500';
    return 'text-on-surface-variant/70';
  }

  const HEALTH_STYLES: Record<string, { label: () => string; class: string; icon: string }> = {
    HEALTHY: { label: () => m.chd_health_healthy(), class: 'bg-emerald-500/10 text-emerald-500', icon: 'CheckCircle' },
    OVERLOADED: { label: () => m.chd_health_overloaded(), class: 'bg-orange-500/10 text-orange-500', icon: 'Fire' },
    UNDERUSED: { label: () => m.chd_health_underused(), class: 'bg-amber-500/10 text-amber-500', icon: 'Warning' },
    DEAD: { label: () => m.chd_health_dead(), class: 'bg-red-500/10 text-red-500', icon: 'Ghost' },
    UNKNOWN: { label: () => m.chd_health_unknown(), class: 'bg-surface-container-high/40 text-on-surface-variant/60', icon: 'Info' },
  };
  const healthStyle = $derived(HEALTH_STYLES[details?.health?.status ?? 'UNKNOWN'] ?? HEALTH_STYLES.UNKNOWN);

  const tabs = $derived([
    { id: 'resume' as const, label: m.chd_tab_summary(), icon: 'Grid' },
    { id: 'activite' as const, label: m.chd_tab_activity(), icon: 'ChartLineUp' },
    { id: 'membres' as const, label: m.chd_tab_people(), icon: 'Users' },
    { id: 'contenu' as const, label: m.chd_tab_content(), icon: 'FileText' },
    { id: 'moderation' as const, label: m.chd_tab_moderation(), icon: 'Gavel' },
    { id: 'config' as const, label: m.chd_tab_config(), icon: 'Settings' },
  ]);

  const METRIC_COLORS: Record<string, string> = {
    messages: 'var(--color-primary)',
    uniqueAuthors: 'var(--color-cyan-500)',
    voiceMinutes: 'var(--color-emerald-500)',
  };

  function metricLabel(metric: string) {
    if (metric === 'uniqueAuthors') return m.chd_metric_authors();
    if (metric === 'voiceMinutes') return m.chd_metric_voice();
    return m.chd_metric_messages();
  }

  const activityChart = $derived.by(() => {
    const daily = details?.activity?.daily ?? [];
    if (daily.length === 0) return null;
    return {
      data: {
        labels: daily.map((d: any) => {
          const [, month, day] = d.dateKey.split('-');
          return `${day}/${month}`;
        }),
        datasets: [
          {
            label: metricLabel(activityMetric),
            data: daily.map((d: any) => d[activityMetric] ?? 0),
            borderColor: METRIC_COLORS[activityMetric],
            backgroundColor: 'transparent',
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 3,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true },
        },
      },
    };
  });

  const heatmapMax = $derived.by(() => {
    const matrix: number[][] = details?.heatmap?.matrix ?? [];
    let max = 0;
    for (const row of matrix) for (const v of row) if (v > max) max = v;
    return max;
  });

  const dayNames = $derived([
    m.chd_day_mon(), m.chd_day_tue(), m.chd_day_wed(),
    m.chd_day_thu(), m.chd_day_fri(), m.chd_day_sat(), m.chd_day_sun(),
  ]);

  function heatCellStyle(value: number) {
    // `--primary-color` et non `--color-primary` : color-mix a besoin d'une
    // couleur résolue, c'est le jeton de base du thème.
    if (heatmapMax <= 0 || value <= 0) {
      return 'background: color-mix(in srgb, var(--outline-variant) 25%, transparent)';
    }
    const intensity = Math.max(0.12, value / heatmapMax);
    return `background: color-mix(in srgb, var(--primary-color) ${Math.round(intensity * 85)}%, transparent)`;
  }

  function truncate(text: string | null | undefined, max = 140) {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
</script>

{#if isOpen}
  <div
    use:portal
    class="modal-backdrop"
    role="button"
    aria-label={m.chd_close()}
    tabindex="0"
    onclick={(e) => e.currentTarget === e.target && closeModal()}
    onkeydown={(e) => {
      if (e.key === 'Escape') closeModal();
    }}
  >
    <div class="modal-panel modal-panel-xl space-y-0 p-0 font-body">
      <!-- ── En-tête ─────────────────────────────────────────── -->
      <div class="p-6 border-b border-outline-variant/30 flex items-center justify-between gap-4">
        <div class="flex items-center gap-4 min-w-0">
          <div class="p-3 rounded-xl bg-primary/10 text-primary shrink-0">
            <Papicon icon={typeIcon} size={22} />
          </div>
          <div class="min-w-0">
            <h3 class="text-2xl font-semibold truncate">#{displayName}</h3>
            <p class="text-sm text-on-surface-variant truncate">
              {#if details?.channel?.categoryName}
                {m.chd_subtitle_with_category({ category: details.channel.categoryName })}
              {:else}
                {m.chd_subtitle()}
              {/if}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <select
            bind:value={days}
            onchange={loadDetails}
            class="px-3 py-2 rounded-xl bg-surface-container-high/40 text-xs font-bold border border-outline-variant/20"
          >
            <option value={7}>{m.chd_days_7()}</option>
            <option value={30}>{m.chd_days_30()}</option>
            <option value={90}>{m.chd_days_90()}</option>
          </select>
          <button
            type="button"
            onclick={closeModal}
            class="h-10 w-10 flex items-center justify-center rounded-xl bg-surface-container-high/60 hover:bg-surface-container-high transition-colors"
            aria-label={m.chd_close()}
          >
            <Papicon icon="X" size={18} />
          </button>
        </div>
      </div>

      {#if !loading && !error && details}
        <!-- ── Navigation ────────────────────────────────────── -->
        <div class="px-6 pt-4 border-b border-outline-variant/20 flex gap-1 overflow-x-auto custom-scrollbar">
          {#each tabs as tab}
            <button
              type="button"
              onclick={() => activeTab = tab.id}
              class="flex items-center gap-2 px-4 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-colors
                {activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-on-surface-variant/60 hover:text-on-surface'}"
            >
              <Papicon icon={tab.icon} size={16} />
              {tab.label}
            </button>
          {/each}
        </div>
      {/if}

      <div class="p-6 space-y-6">
        {#if loading}
          <div class="flex items-center justify-center py-16 gap-3 text-on-surface-variant/60">
            <div class="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
            <span class="text-sm font-bold">{m.chd_loading()}</span>
          </div>
        {:else if error}
          <div class="p-4 rounded-lg bg-red-500/10 text-red-500 text-sm font-bold">{error}</div>
        {:else if details}
          {#if !details.channel}
            <div class="p-4 rounded-lg bg-amber-500/10 text-amber-600 text-xs font-bold">
              {m.chd_channel_gone()}
            </div>
          {/if}

          <!-- ══════════════ RÉSUMÉ ══════════════ -->
          {#if activeTab === 'resume'}
            <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div class="premium-card p-5 rounded-xl">
                <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.chd_kpi_messages()}</p>
                <p class="text-2xl font-semibold text-primary">{formatNumber(details.activity.totals.messages)}</p>
                <p class="text-[11px] font-bold {changeClass(details.activity.change.messages)}">{formatChange(details.activity.change.messages)}</p>
              </div>
              <div class="premium-card p-5 rounded-xl">
                <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.chd_kpi_share()}</p>
                <p class="text-2xl font-semibold text-cyan-500">{details.activity.share.messagesPct} %</p>
                <p class="text-[11px] font-bold text-on-surface-variant/50">
                  {details.activity.share.rank
                    ? m.chd_kpi_rank({ rank: details.activity.share.rank, total: details.activity.share.channelCount })
                    : '-'}
                </p>
              </div>
              <div class="premium-card p-5 rounded-xl">
                <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.chd_kpi_authors()}</p>
                <p class="text-2xl font-semibold text-purple-500">{details.activity.totals.uniqueAuthorsAvg}</p>
                <p class="text-[11px] font-bold text-on-surface-variant/50">{m.chd_kpi_authors_hint()}</p>
              </div>
              <div class="premium-card p-5 rounded-xl">
                <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.chd_kpi_active_days()}</p>
                <p class="text-2xl font-semibold text-orange-500">{details.activity.totals.activeDays}<span class="text-sm text-on-surface-variant/40">/{details.period}</span></p>
                <p class="text-[11px] font-bold text-on-surface-variant/50">{m.chd_kpi_avg_per_day({ value: details.activity.totals.avgMessagesPerDay })}</p>
              </div>
              <div class="premium-card p-5 rounded-xl">
                <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.chd_kpi_voice()}</p>
                <p class="text-2xl font-semibold text-emerald-500">{formatNumber(details.activity.totals.voiceMinutes)}</p>
                <p class="text-[11px] font-bold {changeClass(details.activity.change.voiceMinutes)}">{formatChange(details.activity.change.voiceMinutes)}</p>
              </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div class="lg:col-span-2 premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-primary/10 text-primary"><Papicon icon="TrendingUp" size={18} /></div>
                    <div>
                      <h4 class="text-sm font-semibold">{m.chd_trend_title()}</h4>
                      <p class="text-xs text-on-surface-variant/40">{m.chd_trend_subtitle({ days: details.period })}</p>
                    </div>
                  </div>
                  {#if details.activity.totals.peakDateKey}
                    <span class="px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-500">
                      {m.chd_peak({ date: formatDate(details.activity.totals.peakDateKey), count: details.activity.totals.peakMessages })}
                    </span>
                  {/if}
                </div>
                <div class="h-56">
                  {#if activityChart}
                    <Chart data={activityChart.data} options={activityChart.options} type="line" height={200} />
                  {:else}
                    <div class="flex items-center justify-center h-full text-on-surface-variant/60 text-sm">{m.chd_no_data()}</div>
                  {/if}
                </div>
              </div>

              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl {healthStyle.class}"><Papicon icon={healthStyle.icon} size={18} /></div>
                  <div>
                    <h4 class="text-sm font-semibold">{m.chd_health_title()}</h4>
                    <p class="text-xs text-on-surface-variant/40">
                      {details.health.configured ? m.chd_health_configured() : m.chd_health_not_configured()}
                    </p>
                  </div>
                </div>
                <div class="px-3 py-2 rounded-xl {healthStyle.class} text-xs font-bold text-center">{healthStyle.label()}</div>
                <div class="space-y-2 text-xs">
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_health_msg_day()}</span>
                    <span class="font-bold text-on-surface">{details.health.metrics.avgMsgPerDay}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_health_msg_hour()}</span>
                    <span class="font-bold text-on-surface">{details.health.metrics.avgMsgPerHour}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_health_authors()}</span>
                    <span class="font-bold text-on-surface">{details.health.metrics.uniqueAuthorsAvg}</span>
                  </div>
                  {#if details.health.excluded}
                    <p class="pt-2 border-t border-outline-variant/10 text-[11px] font-bold text-amber-500">{m.chd_health_excluded()}</p>
                  {/if}
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-purple-500/10 text-purple-500"><Papicon icon="Users" size={18} /></div>
                  <h4 class="text-sm font-semibold">{m.chd_top_contributors()}</h4>
                </div>
                {#if details.contributors.available && details.contributors.items.length > 0}
                  <div class="space-y-2">
                    {#each details.contributors.items.slice(0, 5) as person, index}
                      <button
                        type="button"
                        class="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/10 hover:bg-surface-container-high/40 transition-all text-left group"
                        onclick={() => openMember(person.userId)}
                      >
                        <div class="flex items-center gap-3 min-w-0">
                          <span class="text-xs font-bold text-on-surface-variant/40 w-4">{index + 1}</span>
                          <img src={memberAvatarSrc(person.avatarUrl, person.userTag, person.userId)} alt="" class="w-8 h-8 rounded-lg object-cover" />
                          <span class="text-sm font-semibold truncate group-hover:text-primary transition-colors">{person.userTag}</span>
                        </div>
                        <div class="text-right shrink-0">
                          <p class="text-sm font-semibold text-primary">{formatNumber(person.messages)}</p>
                          <p class="text-[10px] font-bold text-on-surface-variant/40">{person.sharePct} %</p>
                        </div>
                      </button>
                    {/each}
                  </div>
                {:else}
                  <p class="text-xs text-on-surface-variant/50 py-6 text-center">
                    {details.contributors.available ? m.chd_no_data() : m.chd_logging_required()}
                  </p>
                {/if}
              </div>

              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-cyan-500/10 text-cyan-500"><Papicon icon="Info" size={18} /></div>
                  <h4 class="text-sm font-semibold">{m.chd_quick_meta()}</h4>
                </div>
                <div class="space-y-2 text-xs">
                  <div class="flex justify-between gap-3">
                    <span class="text-on-surface-variant/60">{m.chd_meta_category()}</span>
                    <span class="font-bold text-on-surface truncate">{details.channel?.categoryName ?? '-'}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_created()}</span>
                    <span class="font-bold text-on-surface">{formatDate(details.channel?.createdAt)}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_slowmode()}</span>
                    <span class="font-bold text-on-surface">{details.channel?.rateLimitPerUser ? m.chd_seconds({ value: details.channel.rateLimitPerUser }) : m.chd_none()}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_visibility()}</span>
                    <span class="font-bold {details.channel?.isPrivate ? 'text-amber-500' : 'text-on-surface'}">{details.channel?.isPrivate ? m.chd_private() : m.chd_public()}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_threads()}</span>
                    <span class="font-bold text-on-surface">{details.content.threads.length}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_pinned()}</span>
                    <span class="font-bold text-on-surface">{details.content.pinned.length}</span>
                  </div>
                </div>
              </div>
            </div>

          <!-- ══════════════ ACTIVITÉ ══════════════ -->
          {:else if activeTab === 'activite'}
            <div class="premium-card p-5 rounded-xl space-y-4">
              <div class="flex items-center justify-between flex-wrap gap-3">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-primary/10 text-primary"><Papicon icon="ChartLineUp" size={18} /></div>
                  <div>
                    <h4 class="text-sm font-semibold">{m.chd_trend_title()}</h4>
                    <p class="text-xs text-on-surface-variant/40">{m.chd_trend_subtitle({ days: details.period })}</p>
                  </div>
                </div>
                <div class="flex gap-1 p-1 rounded-xl bg-surface-container-high/40">
                  {#each ['messages', 'uniqueAuthors', 'voiceMinutes'] as metric}
                    <button
                      type="button"
                      onclick={() => activityMetric = metric as typeof activityMetric}
                      class="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors
                        {activityMetric === metric ? 'bg-primary text-on-primary' : 'text-on-surface-variant/60 hover:text-on-surface'}"
                    >
                      {metricLabel(metric)}
                    </button>
                  {/each}
                </div>
              </div>
              <div class="h-72">
                {#if activityChart}
                  <Chart data={activityChart.data} options={activityChart.options} type="line" height={280} />
                {:else}
                  <div class="flex items-center justify-center h-full text-on-surface-variant/60 text-sm">{m.chd_no_data()}</div>
                {/if}
              </div>
            </div>

            <div class="premium-card p-5 rounded-xl space-y-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-orange-500/10 text-orange-500"><Papicon icon="Fire" size={18} /></div>
                  <div>
                    <h4 class="text-sm font-semibold">{m.chd_heatmap_title()}</h4>
                    <p class="text-xs text-on-surface-variant/40">{m.chd_heatmap_subtitle()}</p>
                  </div>
                </div>
                {#if details.heatmap.available && details.heatmap.peak}
                  <span class="px-3 py-1 rounded-full text-[11px] font-semibold bg-orange-500/10 text-orange-500">
                    {m.chd_heatmap_peak({
                      day: dayNames[details.heatmap.peak.day],
                      hour: String(details.heatmap.peak.hour).padStart(2, '0'),
                      count: details.heatmap.peak.count,
                    })}
                  </span>
                {/if}
              </div>

              {#if details.heatmap.available && heatmapMax > 0}
                <div class="overflow-x-auto custom-scrollbar">
                  <div class="min-w-140 space-y-1">
                    <div class="flex items-center gap-1 pl-10">
                      {#each Array.from({ length: 24 }, (_, h) => h) as hour}
                        <div class="flex-1 text-center">
                          {#if hour % 3 === 0}
                            <span class="text-[10px] font-semibold text-on-surface-variant/40">{String(hour).padStart(2, '0')}</span>
                          {/if}
                        </div>
                      {/each}
                    </div>
                    {#each details.heatmap.matrix as row, day}
                      <div class="flex items-center gap-1">
                        <span class="w-10 text-[10px] font-semibold uppercase text-on-surface-variant/50 text-right pr-1">{dayNames[day]}</span>
                        {#each row as value, hour}
                          <div
                            class="flex-1 aspect-square rounded"
                            style={heatCellStyle(value)}
                            title={m.chd_heatmap_cell({ day: dayNames[day], hour: String(hour).padStart(2, '0'), count: value })}
                          ></div>
                        {/each}
                      </div>
                    {/each}
                  </div>
                </div>
              {:else}
                <p class="text-xs text-on-surface-variant/50 py-8 text-center">
                  {details.heatmap.available ? m.chd_no_data() : m.chd_logging_required()}
                </p>
              {/if}
            </div>

            <div class="premium-card p-5 rounded-xl space-y-4">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-xl bg-cyan-500/10 text-cyan-500"><Papicon icon="BarChart" size={18} /></div>
                <h4 class="text-sm font-semibold">{m.chd_daily_table()}</h4>
              </div>
              <div class="max-h-80 overflow-y-auto custom-scrollbar">
                <table class="w-full text-xs">
                  <thead class="sticky top-0 bg-surface-container-lowest">
                    <tr class="text-on-surface-variant/50 text-left">
                      <th class="py-2 font-semibold">{m.chd_col_date()}</th>
                      <th class="py-2 font-semibold text-right">{m.chd_metric_messages()}</th>
                      <th class="py-2 font-semibold text-right">{m.chd_metric_authors()}</th>
                      <th class="py-2 font-semibold text-right">{m.chd_metric_voice()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each [...details.activity.daily].reverse() as row}
                      <tr class="border-t border-outline-variant/10">
                        <td class="py-2 font-bold text-on-surface-variant/70">{formatDate(row.dateKey)}</td>
                        <td class="py-2 text-right font-semibold text-on-surface">{formatNumber(row.messages)}</td>
                        <td class="py-2 text-right text-on-surface-variant/70">{formatNumber(row.uniqueAuthors)}</td>
                        <td class="py-2 text-right text-on-surface-variant/70">{formatNumber(row.voiceMinutes)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>

          <!-- ══════════════ MEMBRES ══════════════ -->
          {:else if activeTab === 'membres'}
            <div class="premium-card p-5 rounded-xl space-y-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-purple-500/10 text-purple-500"><Papicon icon="Users" size={18} /></div>
                  <div>
                    <h4 class="text-sm font-semibold">{m.chd_top_contributors()}</h4>
                    <p class="text-xs text-on-surface-variant/40">{m.chd_click_to_open_member()}</p>
                  </div>
                </div>
                <span class="px-3 py-1 rounded-full text-xs font-semibold bg-surface-container-high/40 text-on-surface-variant/70">
                  {m.chd_logged_messages({ count: details.contributors.total })}
                </span>
              </div>

              {#if details.contributors.available && details.contributors.items.length > 0}
                <div class="space-y-2 max-h-105 overflow-y-auto custom-scrollbar pr-2">
                  {#each details.contributors.items as person, index}
                    <button
                      type="button"
                      class="w-full flex items-center justify-between gap-4 p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/10 hover:bg-surface-container-high/40 transition-all text-left group"
                      onclick={() => openMember(person.userId)}
                    >
                      <div class="flex items-center gap-4 min-w-0">
                        <span class="text-xs font-bold text-on-surface-variant/40 w-5">{index + 1}</span>
                        <img src={memberAvatarSrc(person.avatarUrl, person.userTag, person.userId)} alt="" class="w-10 h-10 rounded-xl object-cover" />
                        <div class="min-w-0">
                          <p class="text-sm font-semibold truncate group-hover:text-primary transition-colors">{person.userTag}</p>
                          <p class="text-[10px] text-on-surface-variant/50 font-mono">{m.chd_last_message({ date: formatDateTime(person.lastMessageAt) })}</p>
                        </div>
                      </div>
                      <div class="flex items-center gap-4 shrink-0">
                        <div class="w-28 h-2 rounded-full bg-surface-container-high overflow-hidden">
                          <div class="h-full rounded-full bg-primary" style="width: {Math.min(100, person.sharePct)}%"></div>
                        </div>
                        <div class="text-right w-20">
                          <p class="text-sm font-semibold text-primary">{formatNumber(person.messages)}</p>
                          <p class="text-[10px] font-bold text-on-surface-variant/40">{person.sharePct} %</p>
                        </div>
                      </div>
                    </button>
                  {/each}
                </div>
              {:else}
                <p class="text-xs text-on-surface-variant/50 py-10 text-center">
                  {details.contributors.available ? m.chd_no_data() : m.chd_logging_required()}
                </p>
              {/if}
            </div>

          <!-- ══════════════ CONTENU ══════════════ -->
          {:else if activeTab === 'contenu'}
            <div class="grid grid-cols-3 gap-4">
              <div class="premium-card p-5 rounded-xl">
                <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.chd_counter_attachments()}</p>
                <p class="text-2xl font-semibold text-cyan-500">{formatNumber(details.content.counters.attachments)}</p>
              </div>
              <div class="premium-card p-5 rounded-xl">
                <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.chd_counter_replies()}</p>
                <p class="text-2xl font-semibold text-purple-500">{formatNumber(details.content.counters.replies)}</p>
              </div>
              <div class="premium-card p-5 rounded-xl">
                <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.chd_counter_bots()}</p>
                <p class="text-2xl font-semibold text-orange-500">{formatNumber(details.content.counters.botMessages)}</p>
              </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-amber-500/10 text-amber-500"><Papicon icon="Bookmark" size={18} /></div>
                  <h4 class="text-sm font-semibold">{m.chd_pinned_title()}</h4>
                </div>
                {#if details.content.pinned.length > 0}
                  <div class="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-2">
                    {#each details.content.pinned as pin}
                      <div class="p-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/10">
                        <p class="text-[11px] font-bold text-on-surface-variant/60">{pin.authorName} • {formatDateTime(pin.createdAt)}</p>
                        <p class="text-xs text-on-surface mt-1 wrap-break-word">{truncate(pin.content) || m.chd_empty_message()}</p>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="text-xs text-on-surface-variant/50 py-6 text-center">{m.chd_no_pinned()}</p>
                {/if}
              </div>

              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-emerald-500/10 text-emerald-500"><Papicon icon="GitBranch" size={18} /></div>
                  <h4 class="text-sm font-semibold">{m.chd_threads_title()}</h4>
                </div>
                {#if details.content.threads.length > 0}
                  <div class="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-2">
                    {#each details.content.threads as thread}
                      <div class="p-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/10 flex items-center justify-between gap-3">
                        <div class="min-w-0">
                          <p class="text-xs font-semibold truncate">{thread.name}</p>
                          <p class="text-[10px] text-on-surface-variant/50">
                            {m.chd_thread_stats({ messages: thread.messageCount ?? 0, members: thread.memberCount ?? 0 })}
                          </p>
                        </div>
                        {#if thread.locked}
                          <span class="px-2 py-1 rounded-full text-[10px] font-bold bg-red-500/10 text-red-500 shrink-0">{m.chd_thread_locked()}</span>
                        {:else if thread.archived}
                          <span class="px-2 py-1 rounded-full text-[10px] font-bold bg-surface-container-high text-on-surface-variant/60 shrink-0">{m.chd_thread_archived()}</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="text-xs text-on-surface-variant/50 py-6 text-center">{m.chd_no_threads()}</p>
                {/if}
              </div>
            </div>

            <div class="premium-card p-5 rounded-xl space-y-4">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-xl bg-primary/10 text-primary"><Papicon icon="ChatCircleDots" size={18} /></div>
                <h4 class="text-sm font-semibold">{m.chd_recent_messages()}</h4>
              </div>
              {#if details.content.logging.available && details.content.recentMessages.length > 0}
                <div class="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                  {#each details.content.recentMessages as msg}
                    <div class="p-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/10">
                      <div class="flex items-center gap-2">
                        <img src={memberAvatarSrc(msg.authorAvatar, msg.authorName, msg.authorId)} alt="" class="w-6 h-6 rounded-lg object-cover" />
                        <span class="text-[11px] font-bold text-on-surface">{msg.authorName}</span>
                        {#if msg.isBot}
                          <span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/10 text-primary">BOT</span>
                        {/if}
                        <span class="text-[10px] text-on-surface-variant/40">{formatDateTime(msg.createdAt)}</span>
                        {#if msg.editedAt}
                          <span class="text-[10px] text-amber-500 font-bold">{m.chd_edited()}</span>
                        {/if}
                      </div>
                      <p class="text-xs text-on-surface-variant/80 mt-1 wrap-break-word">{truncate(msg.content, 240) || m.chd_empty_message()}</p>
                      {#if msg.hasAttachment || msg.embedCount > 0}
                        <p class="text-[10px] font-bold text-cyan-500 mt-1">{m.chd_has_media()}</p>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="text-xs text-on-surface-variant/50 py-8 text-center">
                  {details.content.logging.available ? m.chd_no_data() : m.chd_logging_required()}
                </p>
              {/if}
            </div>

            {#if details.content.links.length > 0}
              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-cyan-500/10 text-cyan-500"><Papicon icon="Link" size={18} /></div>
                  <h4 class="text-sm font-semibold">{m.chd_links_title()}</h4>
                </div>
                <div class="space-y-2">
                  {#each details.content.links as link}
                    <div class="p-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/10 flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <p class="text-xs font-semibold truncate">
                          {link.otherGuildName ?? link.otherGuildId} • #{link.otherChannelName ?? link.otherChannelId}
                        </p>
                        <p class="text-[10px] text-on-surface-variant/50">{link.direction}</p>
                      </div>
                      <span class="px-2 py-1 rounded-full text-[10px] font-bold shrink-0 {link.enabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-surface-container-high text-on-surface-variant/60'}">
                        {link.enabled ? m.chd_link_enabled() : m.chd_link_disabled()}
                      </span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

          <!-- ══════════════ MODÉRATION ══════════════ -->
          {:else if activeTab === 'moderation'}
            {#if !details.moderation.available}
              <div class="premium-card p-8 rounded-xl text-center space-y-2">
                <Papicon icon="Gavel" size={32} class="text-on-surface-variant/20 mx-auto" />
                <p class="text-sm font-bold text-on-surface-variant/60">{m.chd_logging_required()}</p>
              </div>
            {:else}
              <div class="grid grid-cols-2 gap-4">
                <div class="premium-card p-5 rounded-xl">
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.chd_deleted_messages()}</p>
                  <p class="text-2xl font-semibold text-red-500">{formatNumber(details.moderation.deleted)}</p>
                </div>
                <div class="premium-card p-5 rounded-xl">
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.chd_edited_messages()}</p>
                  <p class="text-2xl font-semibold text-amber-500">{formatNumber(details.moderation.edited)}</p>
                </div>
              </div>

              {#if details.moderation.topDeleted.length > 0}
                <div class="premium-card p-5 rounded-xl space-y-4">
                  <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-red-500/10 text-red-500"><Papicon icon="UserX" size={18} /></div>
                    <h4 class="text-sm font-semibold">{m.chd_top_deleted()}</h4>
                  </div>
                  <div class="space-y-2">
                    {#each details.moderation.topDeleted as row}
                      <button
                        type="button"
                        class="w-full flex items-center justify-between p-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/10 hover:bg-surface-container-high/40 transition-all text-left"
                        onclick={() => openMember(row.userId)}
                      >
                        <span class="text-xs font-semibold">{row.userTag}</span>
                        <span class="text-xs font-bold text-red-500">{row.count}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}

              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-red-500/10 text-red-500"><Papicon icon="Trash" size={18} /></div>
                  <h4 class="text-sm font-semibold">{m.chd_recent_deleted()}</h4>
                </div>
                {#if details.moderation.recentDeleted.length > 0}
                  <div class="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                    {#each details.moderation.recentDeleted as msg}
                      <div class="p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                        <div class="flex items-center gap-2">
                          <img src={memberAvatarSrc(msg.authorAvatar, msg.authorName, msg.authorId)} alt="" class="w-6 h-6 rounded-lg object-cover" />
                          <span class="text-[11px] font-bold text-on-surface">{msg.authorName}</span>
                          <span class="text-[10px] text-on-surface-variant/40">{m.chd_deleted_at({ date: formatDateTime(msg.deletedAt) })}</span>
                        </div>
                        <p class="text-xs text-on-surface-variant/80 mt-1 wrap-break-word">{truncate(msg.content, 240) || m.chd_empty_message()}</p>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="text-xs text-on-surface-variant/50 py-6 text-center">{m.chd_no_deleted()}</p>
                {/if}
              </div>
            {/if}

            {#if details.health.alerts.length > 0}
              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-amber-500/10 text-amber-500"><Papicon icon="Warning" size={18} /></div>
                  <h4 class="text-sm font-semibold">{m.chd_health_alerts()}</h4>
                </div>
                <div class="space-y-2">
                  {#each details.health.alerts as alert}
                    <div class="p-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/10">
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-xs font-bold">{alert.type}</span>
                        <span class="px-2 py-1 rounded-full text-[10px] font-bold bg-surface-container-high text-on-surface-variant/70">{alert.status}</span>
                      </div>
                      <p class="text-[11px] text-on-surface-variant/60 mt-1">{alert.reason ?? '-'}</p>
                      <p class="text-[10px] text-on-surface-variant/40 mt-1">{formatDateTime(alert.createdAt)} • {m.chd_confidence({ value: alert.confidence })}</p>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

          <!-- ══════════════ CONFIG ══════════════ -->
          {:else if activeTab === 'config'}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-surface-container-high/40 text-on-surface-variant"><Papicon icon="Info" size={18} /></div>
                  <h4 class="text-sm font-semibold">{m.chd_config_title()}</h4>
                </div>
                <div class="space-y-2 text-xs">
                  <div class="flex justify-between gap-3">
                    <span class="text-on-surface-variant/60 shrink-0">{m.chd_meta_id()}</span>
                    <span class="font-mono font-bold text-on-surface truncate">{details.channelId}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_type()}</span>
                    <span class="font-bold text-on-surface">{details.channel?.type ?? '-'}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_category()}</span>
                    <span class="font-bold text-on-surface">{details.channel?.categoryName ?? '-'}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_position()}</span>
                    <span class="font-bold text-on-surface">{details.channel?.position ?? '-'}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_created()}</span>
                    <span class="font-bold text-on-surface">{formatDate(details.channel?.createdAt)}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_slowmode()}</span>
                    <span class="font-bold text-on-surface">{details.channel?.rateLimitPerUser ? m.chd_seconds({ value: details.channel.rateLimitPerUser }) : m.chd_none()}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant/60">{m.chd_meta_nsfw()}</span>
                    <span class="font-bold {details.channel?.nsfw ? 'text-red-500' : 'text-on-surface'}">{details.channel?.nsfw ? m.chd_yes() : m.chd_no()}</span>
                  </div>
                  {#if details.channel?.bitrate}
                    <div class="flex justify-between">
                      <span class="text-on-surface-variant/60">{m.chd_meta_bitrate()}</span>
                      <span class="font-bold text-on-surface">{Math.round(details.channel.bitrate / 1000)} kbps</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-on-surface-variant/60">{m.chd_meta_user_limit()}</span>
                      <span class="font-bold text-on-surface">{details.channel.userLimit || m.chd_unlimited()}</span>
                    </div>
                  {/if}
                </div>
                {#if details.channel?.topic}
                  <div class="pt-3 border-t border-outline-variant/10">
                    <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-1">{m.chd_meta_topic()}</p>
                    <p class="text-xs text-on-surface-variant/80 wrap-break-word">{details.channel.topic}</p>
                  </div>
                {/if}
              </div>

              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-purple-500/10 text-purple-500"><Papicon icon="Shield" size={18} /></div>
                  <h4 class="text-sm font-semibold">{m.chd_permissions_title()}</h4>
                </div>
                {#if (details.channel?.roleOverwrites?.length ?? 0) > 0}
                  <div class="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-2">
                    {#each details.channel.roleOverwrites as overwrite}
                      <div class="p-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/10 flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2 min-w-0">
                          <span class="w-2 h-2 rounded-full shrink-0" style="background: {overwrite.color ?? 'var(--color-primary)'}"></span>
                          <span class="text-xs font-semibold truncate">{overwrite.isEveryone ? '@everyone' : overwrite.name}</span>
                        </div>
                        <span class="text-[10px] font-bold shrink-0">
                          <span class="text-emerald-500">+{overwrite.allow}</span>
                          <span class="text-on-surface-variant/30 mx-1">/</span>
                          <span class="text-red-500">−{overwrite.deny}</span>
                        </span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="text-xs text-on-surface-variant/50 py-6 text-center">{m.chd_no_overwrites()}</p>
                {/if}
              </div>
            </div>

            <div class="premium-card p-5 rounded-xl space-y-4">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-xl bg-cyan-500/10 text-cyan-500"><Papicon icon="History" size={18} /></div>
                <div>
                  <h4 class="text-sm font-semibold">{m.chd_audit_title()}</h4>
                  <p class="text-xs text-on-surface-variant/40">{m.chd_audit_subtitle()}</p>
                </div>
              </div>
              {#if details.auditTrail.length > 0}
                <div class="space-y-2 max-h-80 overflow-y-auto custom-scrollbar pr-2">
                  {#each details.auditTrail as event}
                    <div class="p-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/10">
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-xs font-bold">{event.eventType}</span>
                        <span class="text-[10px] text-on-surface-variant/40">{formatDateTime(event.createdAt)}</span>
                      </div>
                      <p class="text-[11px] text-on-surface-variant/60 mt-1">
                        {m.chd_audit_by({ author: event.executorName ?? m.chd_unknown() })}
                        {#if event.changedFields?.length}
                          • {event.changedFields.join(', ')}
                        {/if}
                      </p>
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="text-xs text-on-surface-variant/50 py-6 text-center">{m.chd_no_audit()}</p>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .premium-card {
    background: rgba(var(--color-surface-container-low), 0.4);
    backdrop-filter: blur(24px);
    border: 1px solid rgba(var(--color-outline-variant), 0.1);
    transition: all 0.4s cubic-bezier(0.2, 1, 0.3, 1);
  }

  :global(.custom-scrollbar) {
    scrollbar-width: thin;
    scrollbar-color: rgba(var(--color-primary), 0.3) transparent;
  }

  :global(.custom-scrollbar::-webkit-scrollbar) {
    width: 6px;
    height: 6px;
  }

  :global(.custom-scrollbar::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(.custom-scrollbar::-webkit-scrollbar-thumb) {
    background-color: rgba(var(--color-primary), 0.3);
    border-radius: 3px;
  }
</style>
