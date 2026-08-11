<script lang="ts">
  import { onMount } from 'svelte';
  import { memberAvatarSrc } from '../../discordMedia';
  import { portal } from '../../actions/portal';
  import { router } from 'tinro';
  import Papicon from '../Papicon.svelte';
  import Chart from '../charts/Chart.svelte';
  import ActionButton from '../ActionButton.svelte';
  import { inviteDetailsModal } from '../../stores/inviteDetailsModal.svelte';
  import { dashboardStore } from '../../stores/dashboard.svelte';
  import { toast } from '../../stores/toast.svelte';
  import { confirmDialog } from '../../stores/confirmDialog.svelte';
  import { downloadSingleSheetXlsx } from '../../xlsxExport';
  import {
    fetchInvitationDetails,
    toggleInvitationSuspension,
    purgeInvitationMembers,
    purgeInviterMembers,
    deleteInvitation,
    updateInvitationSource
  } from '../../api';
  import { m, dateLocale } from '../../i18n';

  type InviteTab = 'resume' | 'retention' | 'qualite' | 'temporalite' | 'invites';

  let details = $state<any>(null);
  let loading = $state(false);
  let error = $state('');
  let days = $state(30);
  let activeTab = $state<InviteTab>('resume');

  // Onglet « Invités » : filtres locaux, aucun aller-retour serveur.
  let joinSearch = $state('');
  let joinStatus = $state<'all' | 'present' | 'left'>('all');
  let joinSort = $state<'recent' | 'oldest' | 'messages'>('recent');
  let joinPage = $state(1);
  const JOINS_PER_PAGE = 25;

  let sourceDraft = $state('');
  let sourceSaving = $state(false);

  const isOpen = $derived(inviteDetailsModal.open);
  const inviteCode = $derived(inviteDetailsModal.code);
  const canModerate = $derived(!!dashboardStore.state.access?.canModerateContent);

  $effect(() => {
    if (!isOpen || !inviteCode) return;
    void loadDetails();
  });

  $effect(() => {
    if (isOpen) return;
    details = null;
    error = '';
    loading = false;
    activeTab = 'resume';
    joinSearch = '';
    joinStatus = 'all';
    joinSort = 'recent';
    joinPage = 1;
  });

  onMount(() => {
    if (isOpen && inviteCode) {
      void loadDetails();
    }
  });

  async function loadDetails() {
    if (!inviteCode) return;
    loading = true;
    error = '';
    try {
      details = await fetchInvitationDetails(inviteCode, { days });
      sourceDraft = details?.invite?.sourceLabel ?? '';
    } catch (err: any) {
      error = err?.message || m.d7_inv_load_error();
      details = null;
    } finally {
      loading = false;
    }
  }

  function closeModal() {
    inviteDetailsModal.close();
  }

  function formatDate(value: string | null | undefined) {
    if (!value) return m.d7_never();
    return new Date(value).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  function formatDateTime(value: string | null | undefined) {
    if (!value) return m.d7_unknown();
    return new Date(value).toLocaleString('fr-FR');
  }

  function formatPct(value: number | null | undefined) {
    return value === null || value === undefined ? '—' : `${value} %`;
  }

  function formatDays(value: number | null | undefined) {
    return value === null || value === undefined ? '—' : m.d7_inv_days_value({ value });
  }

  async function toggleSuspend() {
    if (!details?.invite) return;
    try {
      await toggleInvitationSuspension(details.invite.code, !details.invite.isSuspended);
      toast.success(details.invite.isSuspended ? m.d7_inv_restored() : m.d7_inv_suspended());
      await loadDetails();
    } catch (err: any) {
      toast.error(err?.message || m.d7_inv_modify_error());
    }
  }

  async function purgeInvite() {
    if (!details?.invite) return;
    const ok = await confirmDialog.danger(m.d7_inv_purge_confirm({ code: details.invite.code }), '', m.d7_purge());
    if (!ok) return;
    try {
      const result = await purgeInvitationMembers(details.invite.code);
      toast.success(m.d7_inv_purge_done({ count: result?.purgedCount ?? 0 }));
      await loadDetails();
    } catch (err: any) {
      toast.error(err?.message || m.d7_inv_purge_error());
    }
  }

  async function purgeInviter() {
    const inviterId = details?.invite?.inviterId;
    if (!inviterId) return;
    const ok = await confirmDialog.danger(m.d7_inv_cascade_confirm(), m.d7_inv_cascade_desc(), m.d7_purge());
    if (!ok) return;
    try {
      const result = await purgeInviterMembers(inviterId);
      toast.success(m.d7_inv_cascade_done({ count: result?.purgedCount ?? 0 }));
      await loadDetails();
    } catch (err: any) {
      toast.error(err?.message || m.d7_inv_cascade_error());
    }
  }

  async function deleteInvite() {
    if (!details?.invite) return;
    const ok = await confirmDialog.danger(m.d7_inv_delete_confirm({ code: details.invite.code }), m.d7_inv_delete_permanent());
    if (!ok) return;
    try {
      await deleteInvitation(details.invite.code);
      toast.success(m.d7_inv_deleted());
      closeModal();
    } catch (err: any) {
      toast.error(err?.message || m.d7_inv_delete_error());
    }
  }

  async function saveSource() {
    if (!details?.invite) return;
    sourceSaving = true;
    try {
      const trimmed = sourceDraft.trim();
      await updateInvitationSource(details.invite.code, trimmed || null);
      toast.success(m.d7_inv_source_saved());
      await loadDetails();
    } catch (err: any) {
      toast.error(err?.message || m.d7_inv_source_error());
    } finally {
      sourceSaving = false;
    }
  }

  function copyInvite() {
    if (!details?.invite?.code) return;
    const link = `https://discord.gg/${details.invite.code}`;
    navigator.clipboard.writeText(link)
      .then(() => toast.success(m.d7_inv_link_copied()))
      .catch(() => toast.warning(m.d7_inv_link_copy_fail()));
  }

  function openMember(userId: string) {
    closeModal();
    router.goto(`/members/${userId}`);
  }

  const tabs = $derived([
    { id: 'resume' as const, label: m.d7_inv_tab_summary(), icon: 'Grid' },
    { id: 'retention' as const, label: m.d7_inv_tab_retention(), icon: 'TrendingUp' },
    { id: 'qualite' as const, label: m.d7_inv_tab_quality(), icon: 'Award' },
    { id: 'temporalite' as const, label: m.d7_inv_tab_timing(), icon: 'Clock' },
    { id: 'invites' as const, label: m.d7_inv_tab_people(), icon: 'Users' },
  ]);

  const trendData = $derived.by(() => {
    const trend = details?.trend;
    if (!trend) return null;
    const labels = (trend.labels || []).map((dateKey: string) => {
      const parts = dateKey.split('-');
      return `${parts[2]}/${parts[1]}`;
    });

    return {
      data: {
        labels,
        datasets: [
          {
            label: m.d7_inv_arrivals(),
            data: trend.counts || [],
            borderColor: 'var(--color-emerald-500)',
            backgroundColor: 'transparent',
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 3
          }
        ]
      },
      options: {
        scales: {
          x: { display: true, grid: { display: false } },
          y: { display: true, beginAtZero: true }
        },
        plugins: { legend: { display: false } },
        maintainAspectRatio: false
      }
    };
  });

  const cumulativeData = $derived.by(() => {
    const timing = details?.timing;
    if (!timing?.cumulative?.length) return null;
    return {
      data: {
        labels: (timing.labels || []).map((dateKey: string) => {
          const parts = dateKey.split('-');
          return `${parts[2]}/${parts[1]}`;
        }),
        datasets: [
          {
            label: m.d7_inv_cumulative(),
            data: timing.cumulative,
            borderColor: 'var(--color-primary)',
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 3
          }
        ]
      },
      options: {
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
        plugins: { legend: { display: false } },
        maintainAspectRatio: false
      }
    };
  });

  const hourlyData = $derived.by(() => {
    const hourly: number[] = details?.timing?.hourly ?? [];
    if (hourly.length === 0) return null;
    return {
      data: {
        labels: hourly.map((_, hour) => `${String(hour).padStart(2, '0')}h`),
        datasets: [{ label: m.d7_inv_arrivals(), data: hourly, backgroundColor: 'var(--color-primary)' }]
      },
      options: {
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
        plugins: { legend: { display: false } },
        maintainAspectRatio: false
      }
    };
  });

  const weekdayNames = $derived([
    m.d7_inv_day_mon(), m.d7_inv_day_tue(), m.d7_inv_day_wed(),
    m.d7_inv_day_thu(), m.d7_inv_day_fri(), m.d7_inv_day_sat(), m.d7_inv_day_sun(),
  ]);

  const weekdayData = $derived.by(() => {
    const weekday: number[] = details?.timing?.weekday ?? [];
    if (weekday.length === 0) return null;
    return {
      data: {
        labels: weekdayNames,
        datasets: [{ label: m.d7_inv_arrivals(), data: weekday, backgroundColor: 'var(--color-cyan-500)' }]
      },
      options: {
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
        plugins: { legend: { display: false } },
        maintainAspectRatio: false
      }
    };
  });

  const ghostEntries = $derived.by(() => {
    const ghost = details?.quality?.ghost ?? {};
    const labels: Record<string, () => string> = {
      ACTIVE: m.d7_inv_ghost_active,
      SPECTATOR: m.d7_inv_ghost_spectator,
      INACTIVE: m.d7_inv_ghost_inactive,
      NEW: m.d7_inv_ghost_new,
      UNKNOWN: m.d7_inv_ghost_unknown,
    };
    const colors: Record<string, string> = {
      ACTIVE: 'text-emerald-500',
      SPECTATOR: 'text-cyan-500',
      INACTIVE: 'text-orange-500',
      NEW: 'text-purple-500',
      UNKNOWN: 'text-on-surface-variant/60',
    };
    return Object.keys(labels)
      .map((key) => ({ key, label: labels[key](), color: colors[key], count: ghost[key] ?? 0 }))
      .filter((entry) => entry.count > 0);
  });

  /** Écart relatif d'un invité moyen par rapport au membre moyen du serveur. */
  function deltaVsGuild(value: number | null, guildValue: number | null): number | null {
    if (value === null || guildValue === null || !guildValue) return null;
    return Math.round(((value - guildValue) / guildValue) * 100);
  }

  const filteredJoins = $derived.by(() => {
    const joins: any[] = details?.joins ?? [];
    const query = joinSearch.trim().toLowerCase();

    const filtered = joins.filter((join) => {
      if (joinStatus === 'present' && join.leftAt) return false;
      if (joinStatus === 'left' && !join.leftAt) return false;
      if (!query) return true;
      return (join.userTag ?? '').toLowerCase().includes(query) || join.userId.includes(query);
    });

    return [...filtered].sort((a, b) => {
      if (joinSort === 'messages') return (b.messageCount ?? 0) - (a.messageCount ?? 0);
      const diff = new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
      return joinSort === 'oldest' ? diff : -diff;
    });
  });

  const joinTotalPages = $derived(Math.max(1, Math.ceil(filteredJoins.length / JOINS_PER_PAGE)));
  const pagedJoins = $derived(filteredJoins.slice((joinPage - 1) * JOINS_PER_PAGE, joinPage * JOINS_PER_PAGE));

  // Un filtre qui raccourcit la liste peut laisser `joinPage` hors bornes.
  $effect(() => {
    if (joinPage > joinTotalPages) joinPage = joinTotalPages;
  });

  function joinRows() {
    return filteredJoins.map((join) => ({
      utilisateur: join.userTag,
      id: join.userId,
      arrive_le: formatDateTime(join.joinedAt),
      parti_le: join.leftAt ? formatDateTime(join.leftAt) : '',
      statut: join.leftAt ? m.d7_inv_left() : m.d7_inv_present(),
      messages: join.messageCount ?? 0,
    }));
  }

  function exportCsv() {
    const rows = joinRows();
    if (!rows.length) { toast.error(m.d7_inv_export_empty()); return; }
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => `"${String((row as any)[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `invites_${inviteCode}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function exportXlsx() {
    const rows = joinRows();
    if (!rows.length) { toast.error(m.d7_inv_export_empty()); return; }
    await downloadSingleSheetXlsx(`invites_${inviteCode}`, 'invites', rows);
  }
</script>

{#if isOpen}
  <div
    use:portal
    class="modal-backdrop"
    role="button"
    aria-label={m.d7_inv_close_view()}
    tabindex="0"
    onclick={(e) => e.currentTarget === e.target && closeModal()}
    onkeydown={(e) => {
      if (e.key === 'Escape') closeModal();
    }}
  >
    <div class="modal-panel modal-panel-xl space-y-0 p-0 font-body">
      <div class="p-6 border-b border-outline-variant/30 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <h3 class="text-2xl font-semibold truncate">{m.d7_inv_title({ code: inviteCode })}</h3>
          <p class="text-sm text-on-surface-variant">{m.d7_inv_moderation_view()}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <select
            bind:value={days}
            onchange={loadDetails}
            class="px-3 py-2 rounded-xl bg-surface-container-high/40 text-xs font-bold border border-outline-variant/20"
          >
            <!-- Valeurs numeriques : avec des chaines, `days` (number)
                 ne correspond a aucune option et le select s'affiche vide. -->
            <option value={7}>{m.d7_inv_days_7()}</option>
            <option value={30}>{m.d7_inv_days_30()}</option>
            <option value={90}>{m.d7_inv_days_90()}</option>
          </select>
          <button
            type="button"
            onclick={closeModal}
            class="h-10 w-10 flex items-center justify-center rounded-xl bg-surface-container-high/60 hover:bg-surface-container-high transition-colors"
            aria-label={m.d7_inv_close_view()}
          >
            <Papicon icon="X" size={18} />
          </button>
        </div>
      </div>

      {#if !loading && !error && details}
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
          <div class="flex items-center justify-center py-12 gap-3 text-on-surface-variant/60">
            <div class="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
            <span class="text-sm font-bold">{m.d7_inv_loading_details()}</span>
          </div>
        {:else if error}
          <div class="p-4 rounded-lg bg-red-500/10 text-red-500 text-sm font-bold">{error}</div>
        {:else if details}

          <!-- ══════════════ RÉSUMÉ ══════════════ -->
          {#if activeTab === 'resume'}
            <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <div class="lg:col-span-3 premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-primary/10 text-primary">
                    <Papicon icon="TrendingUp" size={18} />
                  </div>
                  <div>
                    <h4 class="text-sm font-semibold uppercase tracking-widest text-on-surface-variant/60">{m.d7_inv_joins_trend()}</h4>
                    <p class="text-xs text-on-surface-variant/40">{m.d7_inv_period_evolution()}</p>
                  </div>
                </div>
                <div class="h-56">
                  {#if trendData}
                    <Chart data={trendData.data} options={trendData.options} type="line" height={200} />
                  {:else}
                    <div class="flex items-center justify-center h-full text-on-surface-variant/60 text-sm">
                      {m.d7_inv_no_data_available()}
                    </div>
                  {/if}
                </div>
              </div>

              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="grid grid-cols-1 gap-4">
                  <div>
                    <p class="text-xs font-medium text-on-surface-variant/50">{m.d7_inv_joins()}</p>
                    <p class="text-lg font-semibold text-emerald-500">{details.trend?.totalJoined ?? 0}</p>
                  </div>
                  <div>
                    <p class="text-xs font-medium text-on-surface-variant/50">{m.d7_inv_departures()}</p>
                    <p class="text-lg font-semibold text-orange-500">{details.trend?.totalLeft ?? 0}</p>
                  </div>
                  <div>
                    <p class="text-xs font-medium text-on-surface-variant/50">{m.d7_inv_remaining()}</p>
                    <p class="text-lg font-semibold text-cyan-500">{details.trend?.totalStayed ?? 0}</p>
                  </div>
                  <div class="pt-2 border-t border-outline-variant/10">
                    <p class="text-xs font-medium text-on-surface-variant/50">{m.d7_inv_expires()}</p>
                    <p class="text-sm font-bold text-on-surface-variant/70">{details.invite?.expiresAt ? formatDate(details.invite.expiresAt) : m.d7_never()}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Meta, Créateur, Actions -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-surface-container-high/40 text-on-surface-variant">
                    <Papicon icon="Info" size={18} />
                  </div>
                  <h4 class="text-sm font-semibold">{m.d7_inv_meta()}</h4>
                </div>
                <div class="space-y-2">
                  <div class="flex justify-between gap-3 text-xs">
                    <span class="text-on-surface-variant/60 shrink-0">{m.d7_inv_source_label()}</span>
                    {#if details.invite?.sourceLabel}
                      <span class="px-2 py-0.5 rounded-lg bg-primary/10 text-primary font-bold truncate" title={details.invite.sourceLabel}>
                        {details.invite.sourceLabel}
                      </span>
                    {:else}
                      <span class="font-bold text-on-surface-variant/40 italic">{m.d7_inv_source_none()}</span>
                    {/if}
                  </div>
                  <div class="flex justify-between text-xs">
                    <span class="text-on-surface-variant/60">{m.d7_inv_created_on()}</span>
                    <span class="font-bold text-on-surface">{formatDate(details.invite?.createdAt)}</span>
                  </div>
                  <div class="flex justify-between text-xs">
                    <span class="text-on-surface-variant/60">{m.d7_inv_uses()}</span>
                    <span class="font-bold text-on-surface">{details.invite?.uses ?? 0}</span>
                  </div>
                  <div class="flex justify-between text-xs">
                    <span class="text-on-surface-variant/60">{m.d7_inv_max()}</span>
                    <span class="font-bold text-on-surface">{details.invite?.maxUses ?? '∞'}</span>
                  </div>
                  <div class="flex justify-between text-xs">
                    <span class="text-on-surface-variant/60">{m.d7_inv_temporary()}</span>
                    <span class="font-bold {details.invite?.isTemporary ? 'text-amber-500' : 'text-on-surface-variant/70'}">{details.invite?.isTemporary ? m.d7_yes() : m.d7_no()}</span>
                  </div>
                  <div class="flex justify-between text-xs">
                    <span class="text-on-surface-variant/60">{m.d7_inv_suspended_label()}</span>
                    <span class="font-bold {details.invite?.isSuspended ? 'text-amber-500' : 'text-on-surface-variant/70'}">{details.invite?.isSuspended ? m.d7_yes() : m.d7_no()}</span>
                  </div>
                  <div class="flex justify-between text-xs">
                    <span class="text-on-surface-variant/60">{m.d7_inv_deleted_label()}</span>
                    <span class="font-bold {details.invite?.isDeleted ? 'text-red-500' : 'text-on-surface-variant/70'}">{details.invite?.isDeleted ? m.d7_yes() : m.d7_no()}</span>
                  </div>
                </div>
              </div>

              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-emerald-500/10 text-emerald-500">
                    <Papicon icon="User" size={18} />
                  </div>
                  <h4 class="text-sm font-semibold">{m.d7_inv_creator()}</h4>
                </div>
                <div class="space-y-2">
                  <div class="flex justify-between text-xs">
                    <span class="text-on-surface-variant/60">{m.d7_inv_tag()}</span>
                    <span class="font-bold text-on-surface">{details.invite?.inviterTag || m.d7_unknown()}</span>
                  </div>
                  <div class="flex justify-between text-xs">
                    <span class="text-on-surface-variant/60">{m.d7_inv_id()}</span>
                    <span class="font-bold text-on-surface font-mono text-xs">{details.invite?.inviterId || '-'}</span>
                  </div>
                </div>
                {#if details.invite?.inviterId}
                  <div class="space-y-2">
                    <ActionButton label={m.d7_inv_open_creator()} icon="User" size="md" variant="muted" onClick={() => openMember(details.invite.inviterId)} />
                    {#if canModerate}
                      <ActionButton label={m.d7_inv_purge_cascade_btn()} icon="Trash" size="md" variant="danger" onClick={purgeInviter} />
                    {/if}
                  </div>
                {/if}
              </div>

              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-primary/10 text-primary">
                    <Papicon icon="Settings" size={18} />
                  </div>
                  <h4 class="text-sm font-semibold">{m.d7_inv_actions()}</h4>
                </div>
                <div class="space-y-2">
                  <ActionButton label={m.d7_inv_copy_link()} icon="Copy" size="md" variant="muted" onClick={copyInvite} />
                  {#if canModerate}
                    <ActionButton
                      label={details.invite?.isSuspended ? m.d7_inv_restore_btn() : m.d7_inv_suspend_btn()}
                      icon={details.invite?.isSuspended ? 'Play' : 'Pause'}
                      size="md"
                      variant={details.invite?.isSuspended ? 'success' : 'muted'}
                      onClick={toggleSuspend}
                    />
                    <ActionButton label={m.d7_inv_purge_btn()} icon="Trash" size="md" variant="danger" onClick={purgeInvite} />
                    <ActionButton label={m.d7_inv_delete_btn()} icon="X" size="md" variant="danger" onClick={deleteInvite} />
                  {/if}
                </div>
              </div>
            </div>

            <!-- Classement du code -->
            {#if details.ranking}
              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-amber-500/10 text-amber-500"><Papicon icon="Trophy" size={18} /></div>
                    <div>
                      <h4 class="text-sm font-semibold">{m.d7_inv_ranking_title()}</h4>
                      <p class="text-xs text-on-surface-variant/40">{m.d7_inv_ranking_subtitle()}</p>
                    </div>
                  </div>
                  <div class="text-right">
                    <p class="text-2xl font-semibold text-amber-500">
                      {details.ranking.rank ? `#${details.ranking.rank}` : '—'}
                      <span class="text-xs text-on-surface-variant/40">/ {details.ranking.totalCodes}</span>
                    </p>
                    <p class="text-[11px] font-bold text-on-surface-variant/50">{m.d7_inv_ranking_share({ pct: formatPct(details.ranking.sharePct) })}</p>
                  </div>
                </div>
                {#if details.ranking.topCodes.length > 0}
                  <div class="space-y-2">
                    {#each details.ranking.topCodes as top, index}
                      <button
                        type="button"
                        class="w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left
                          {top.code === inviteCode
                            ? 'bg-primary/10 border-primary/30'
                            : 'bg-surface-container-high/20 border-outline-variant/10 hover:bg-surface-container-high/40'}"
                        onclick={() => inviteDetailsModal.show(top.code)}
                      >
                        <span class="text-xs font-bold">
                          <span class="text-on-surface-variant/40 mr-2">{index + 1}</span>{top.code}
                        </span>
                        <span class="text-xs font-semibold text-on-surface">{m.d7_inv_joins_count({ count: top.joins })}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}

          <!-- ══════════════ RÉTENTION ══════════════ -->
          {:else if activeTab === 'retention'}
            {#if details.retention}
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="premium-card p-5 rounded-xl">
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.d7_inv_retention_rate()}</p>
                  <p class="text-2xl font-semibold text-emerald-500">{formatPct(details.retention.retentionPct)}</p>
                  <p class="text-[11px] font-bold text-on-surface-variant/50">{m.d7_inv_retention_ratio({ stayed: details.retention.stayed, total: details.retention.total })}</p>
                </div>
                <div class="premium-card p-5 rounded-xl">
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.d7_inv_avg_lifetime()}</p>
                  <p class="text-2xl font-semibold text-cyan-500">{formatDays(details.retention.avgLifetimeDays)}</p>
                  <p class="text-[11px] font-bold text-on-surface-variant/50">{m.d7_inv_median_lifetime({ value: formatDays(details.retention.medianLifetimeDays) })}</p>
                </div>
                <div class="premium-card p-5 rounded-xl">
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.d7_inv_same_day_leavers()}</p>
                  <p class="text-2xl font-semibold text-orange-500">{details.retention.sameDayLeavers}</p>
                  <p class="text-[11px] font-bold text-on-surface-variant/50">{formatPct(details.retention.sameDayLeaversPct)}</p>
                </div>
                <div class="premium-card p-5 rounded-xl">
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.d7_inv_departures()}</p>
                  <p class="text-2xl font-semibold text-red-500">{details.retention.left}</p>
                  <p class="text-[11px] font-bold text-on-surface-variant/50">{m.d7_inv_total_joins({ count: details.retention.total })}</p>
                </div>
              </div>

              <div class="premium-card p-5 rounded-xl space-y-5">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-emerald-500/10 text-emerald-500"><Papicon icon="Activity" size={18} /></div>
                  <div>
                    <h4 class="text-sm font-semibold">{m.d7_inv_survival_title()}</h4>
                    <p class="text-xs text-on-surface-variant/40">{m.d7_inv_survival_subtitle()}</p>
                  </div>
                </div>
                <div class="space-y-4">
                  {#each [['d1', m.d7_inv_survival_d1()], ['d7', m.d7_inv_survival_d7()], ['d30', m.d7_inv_survival_d30()]] as [key, label]}
                    {@const bucket = details.retention.survival[key]}
                    <div class="space-y-1.5">
                      <div class="flex items-center justify-between text-xs">
                        <span class="font-bold text-on-surface">{label}</span>
                        <span class="font-bold text-on-surface-variant/70">
                          {bucket.rate === null
                            ? m.d7_inv_survival_not_enough()
                            : m.d7_inv_survival_value({ pct: bucket.rate, eligible: bucket.eligible })}
                        </span>
                      </div>
                      <div class="h-2 w-full rounded-full bg-on-surface/5 overflow-hidden">
                        <div class="h-full rounded-full bg-emerald-500 transition-all duration-500" style="width: {bucket.rate ?? 0}%"></div>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {:else}
              <p class="text-sm text-on-surface-variant/60 text-center py-10">{m.d7_inv_no_data_available()}</p>
            {/if}

          <!-- ══════════════ QUALITÉ ══════════════ -->
          {:else if activeTab === 'qualite'}
            {#if details.quality}
              {@const q = details.quality}
              {@const msgDelta = deltaVsGuild(q.avgMessages, q.guildAvgMessages)}
              {@const lvlDelta = deltaVsGuild(q.avgLevel, q.guildAvgLevel)}

              {#if q.sampled}
                <div class="p-3 rounded-lg bg-amber-500/10 text-amber-600 text-[11px] font-bold">
                  {m.d7_inv_quality_sampled({ count: q.analyzed })}
                </div>
              {/if}

              <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="premium-card p-5 rounded-xl">
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.d7_inv_avg_messages()}</p>
                  <p class="text-2xl font-semibold text-primary">{q.avgMessages ?? '—'}</p>
                  <p class="text-[11px] font-bold {msgDelta === null ? 'text-on-surface-variant/50' : msgDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}">
                    {msgDelta === null ? m.d7_inv_no_comparison() : m.d7_inv_vs_guild({ delta: `${msgDelta > 0 ? '+' : ''}${msgDelta}` })}
                  </p>
                </div>
                <div class="premium-card p-5 rounded-xl">
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.d7_inv_avg_level()}</p>
                  <p class="text-2xl font-semibold text-purple-500">{q.avgLevel ?? '—'}</p>
                  <p class="text-[11px] font-bold {lvlDelta === null ? 'text-on-surface-variant/50' : lvlDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}">
                    {lvlDelta === null ? m.d7_inv_no_comparison() : m.d7_inv_vs_guild({ delta: `${lvlDelta > 0 ? '+' : ''}${lvlDelta}` })}
                  </p>
                </div>
                <div class="premium-card p-5 rounded-xl">
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.d7_inv_young_accounts()}</p>
                  <p class="text-2xl font-semibold text-orange-500">{q.youngAccounts}</p>
                  <p class="text-[11px] font-bold text-on-surface-variant/50">{formatPct(q.youngAccountsPct)} • {m.d7_inv_young_hint()}</p>
                </div>
                <div class="premium-card p-5 rounded-xl">
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.d7_inv_sanctioned()}</p>
                  <p class="text-2xl font-semibold text-red-500">{q.sanctionedMembers}</p>
                  <p class="text-[11px] font-bold text-on-surface-variant/50">{m.d7_inv_sanctions_total({ count: q.sanctionsCount })}</p>
                </div>
              </div>

              <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div class="premium-card p-5 rounded-xl space-y-4">
                  <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-cyan-500/10 text-cyan-500"><Papicon icon="Ghost" size={18} /></div>
                    <div>
                      <h4 class="text-sm font-semibold">{m.d7_inv_ghost_title()}</h4>
                      <p class="text-xs text-on-surface-variant/40">{m.d7_inv_ghost_subtitle()}</p>
                    </div>
                  </div>
                  {#if ghostEntries.length > 0}
                    <div class="space-y-3">
                      {#each ghostEntries as entry}
                        {@const pct = q.analyzed > 0 ? Math.round((entry.count / q.analyzed) * 100) : 0}
                        <div class="space-y-1.5">
                          <div class="flex items-center justify-between text-xs">
                            <span class="font-bold {entry.color}">{entry.label}</span>
                            <span class="font-bold text-on-surface-variant/70">{entry.count} ({pct} %)</span>
                          </div>
                          <div class="h-1.5 w-full rounded-full bg-on-surface/5 overflow-hidden">
                            <div class="h-full rounded-full bg-primary/70" style="width: {pct}%"></div>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <p class="text-xs text-on-surface-variant/50 py-6 text-center">{m.d7_inv_no_data_available()}</p>
                  {/if}
                  {#if q.bots > 0}
                    <p class="pt-2 border-t border-outline-variant/10 text-[11px] font-bold text-amber-500">{m.d7_inv_bots_detected({ count: q.bots })}</p>
                  {/if}
                </div>

                <div class="premium-card p-5 rounded-xl space-y-4">
                  <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-red-500/10 text-red-500"><Papicon icon="Gavel" size={18} /></div>
                    <h4 class="text-sm font-semibold">{m.d7_inv_top_sanctioned()}</h4>
                  </div>
                  {#if q.topSanctioned.length > 0}
                    <div class="space-y-2">
                      {#each q.topSanctioned as row}
                        <button
                          type="button"
                          class="w-full flex items-center justify-between p-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/10 hover:bg-surface-container-high/40 transition-all text-left"
                          onclick={() => openMember(row.userId)}
                        >
                          <span class="text-xs font-semibold truncate">{row.userTag}</span>
                          <span class="text-xs font-bold text-red-500 shrink-0">{row.count}</span>
                        </button>
                      {/each}
                    </div>
                  {:else}
                    <p class="text-xs text-on-surface-variant/50 py-6 text-center">{m.d7_inv_no_sanctioned()}</p>
                  {/if}
                </div>
              </div>
            {:else}
              <p class="text-sm text-on-surface-variant/60 text-center py-10">{m.d7_inv_no_data_available()}</p>
            {/if}

          <!-- ══════════════ TEMPORALITÉ ══════════════ -->
          {:else if activeTab === 'temporalite'}
            <div class="premium-card p-5 rounded-xl space-y-4">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-xl bg-primary/10 text-primary"><Papicon icon="TrendingUp" size={18} /></div>
                <div>
                  <h4 class="text-sm font-semibold">{m.d7_inv_cumulative_title()}</h4>
                  <p class="text-xs text-on-surface-variant/40">{m.d7_inv_cumulative_subtitle()}</p>
                </div>
              </div>
              <div class="h-56">
                {#if cumulativeData}
                  <Chart data={cumulativeData.data} options={cumulativeData.options} type="line" height={200} />
                {:else}
                  <div class="flex items-center justify-center h-full text-on-surface-variant/60 text-sm">{m.d7_inv_no_data_available()}</div>
                {/if}
              </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-primary/10 text-primary"><Papicon icon="Clock" size={18} /></div>
                    <h4 class="text-sm font-semibold">{m.d7_inv_hourly_title()}</h4>
                  </div>
                  {#if details.timing?.peakHour !== null && details.timing?.peakHour !== undefined}
                    <span class="px-3 py-1 rounded-full text-[11px] font-semibold bg-primary/10 text-primary">
                      {m.d7_inv_peak_hour({ hour: String(details.timing.peakHour).padStart(2, '0') })}
                    </span>
                  {/if}
                </div>
                <div class="h-52">
                  {#if hourlyData}
                    <Chart data={hourlyData.data} options={hourlyData.options} type="bar" height={200} />
                  {:else}
                    <div class="flex items-center justify-center h-full text-on-surface-variant/60 text-sm">{m.d7_inv_no_data_available()}</div>
                  {/if}
                </div>
              </div>

              <div class="premium-card p-5 rounded-xl space-y-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-cyan-500/10 text-cyan-500"><Papicon icon="Calendar" size={18} /></div>
                    <h4 class="text-sm font-semibold">{m.d7_inv_weekday_title()}</h4>
                  </div>
                  {#if details.timing?.peakWeekday !== null && details.timing?.peakWeekday !== undefined}
                    <span class="px-3 py-1 rounded-full text-[11px] font-semibold bg-cyan-500/10 text-cyan-500">
                      {m.d7_inv_peak_weekday({ day: weekdayNames[details.timing.peakWeekday] })}
                    </span>
                  {/if}
                </div>
                <div class="h-52">
                  {#if weekdayData}
                    <Chart data={weekdayData.data} options={weekdayData.options} type="bar" height={200} />
                  {:else}
                    <div class="flex items-center justify-center h-full text-on-surface-variant/60 text-sm">{m.d7_inv_no_data_available()}</div>
                  {/if}
                </div>
              </div>
            </div>

            <div class="premium-card p-5 rounded-xl space-y-4">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-xl bg-purple-500/10 text-purple-500"><Papicon icon="Tag" size={18} /></div>
                <div>
                  <h4 class="text-sm font-semibold">{m.d7_inv_source_title()}</h4>
                  <p class="text-xs text-on-surface-variant/40">{m.d7_inv_source_hint()}</p>
                </div>
              </div>
              <div class="flex gap-2">
                <input
                  type="text"
                  bind:value={sourceDraft}
                  maxlength="60"
                  disabled={!canModerate}
                  placeholder={m.d7_inv_source_placeholder()}
                  class="flex-1 bg-surface-container-high/40 text-on-surface text-sm font-bold rounded-lg px-4 py-2.5 border border-outline-variant/10 focus:border-primary/50 focus:outline-none transition-colors placeholder:text-on-surface-variant/40 disabled:opacity-50"
                />
                {#if canModerate}
                  <button
                    type="button"
                    onclick={saveSource}
                    disabled={sourceSaving || sourceDraft.trim() === (details.invite?.sourceLabel ?? '')}
                    class="px-5 py-2.5 rounded-lg bg-primary text-on-primary text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {sourceSaving ? m.d7_inv_source_saving() : m.d7_inv_source_save()}
                  </button>
                {/if}
              </div>
            </div>

          <!-- ══════════════ INVITÉS ══════════════ -->
          {:else if activeTab === 'invites'}
            <div class="premium-card p-5 rounded-xl space-y-4">
              <div class="flex items-center justify-between flex-wrap gap-3">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-xl bg-purple-500/10 text-purple-500">
                    <Papicon icon="Users" size={18} />
                  </div>
                  <div>
                    <h4 class="text-sm font-semibold">{m.d7_inv_invited_people()}</h4>
                    <p class="text-xs text-on-surface-variant/60">{m.d7_inv_click_to_open()}</p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-surface-container-high/40 text-on-surface-variant/70">
                    {m.d7_inv_entries({ count: filteredJoins.length })}
                  </span>
                  <button type="button" onclick={exportCsv} class="px-3 py-2 rounded-xl bg-surface-container-high/40 hover:bg-surface-container-high text-xs font-bold transition-colors">CSV</button>
                  <button type="button" onclick={exportXlsx} class="px-3 py-2 rounded-xl bg-surface-container-high/40 hover:bg-surface-container-high text-xs font-bold transition-colors">XLSX</button>
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                <div class="relative flex-1 min-w-50">
                  <div class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40">
                    <Papicon icon="MagnifyingGlass" size={16} />
                  </div>
                  <input
                    type="text"
                    bind:value={joinSearch}
                    oninput={() => joinPage = 1}
                    placeholder={m.d7_inv_search_placeholder()}
                    class="w-full bg-surface-container-high/40 text-on-surface text-xs font-bold rounded-lg pl-9 pr-3 py-2.5 border border-outline-variant/10 focus:border-primary/50 focus:outline-none transition-colors placeholder:text-on-surface-variant/40"
                  />
                </div>
                <select
                  bind:value={joinStatus}
                  onchange={() => joinPage = 1}
                  class="px-3 py-2.5 rounded-lg bg-surface-container-high/40 text-xs font-bold border border-outline-variant/10"
                >
                  <option value="all">{m.d7_inv_filter_all()}</option>
                  <option value="present">{m.d7_inv_present()}</option>
                  <option value="left">{m.d7_inv_left()}</option>
                </select>
                <select
                  bind:value={joinSort}
                  class="px-3 py-2.5 rounded-lg bg-surface-container-high/40 text-xs font-bold border border-outline-variant/10"
                >
                  <option value="recent">{m.d7_inv_sort_recent()}</option>
                  <option value="oldest">{m.d7_inv_sort_oldest()}</option>
                  <option value="messages">{m.d7_inv_sort_messages()}</option>
                </select>
              </div>

              <div class="space-y-2 max-h-110 overflow-y-auto custom-scrollbar pr-2">
                {#each pagedJoins as join}
                  <button
                    class="w-full flex items-center justify-between p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/10 hover:bg-surface-container-high/40 transition-all text-left group"
                    onclick={() => openMember(join.userId)}
                  >
                    <div class="flex items-center gap-4 min-w-0">
                      <img src={memberAvatarSrc(join.avatarUrl, join.userTag, join.userId)} alt="" class="w-10 h-10 rounded-xl object-cover" />
                      <div class="min-w-0">
                        <p class="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors truncate">{join.userTag}</p>
                        <p class="text-[10px] text-on-surface-variant/50 font-mono truncate">{join.userId} • {formatDateTime(join.joinedAt)}</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-4 shrink-0">
                      <div class="text-right">
                        <p class="text-xs font-medium text-on-surface-variant/40">{m.d7_inv_messages_label()}</p>
                        <p class="text-sm font-semibold text-on-surface">{join.messageCount ?? 0}</p>
                      </div>
                      <div class="text-right">
                        <p class="text-xs font-medium text-on-surface-variant/40">{m.d7_inv_status()}</p>
                        <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold {join.leftAt ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}">
                          {join.leftAt ? m.d7_inv_left() : m.d7_inv_present()}
                        </span>
                      </div>
                    </div>
                  </button>
                {/each}
                {#if filteredJoins.length === 0}
                  <div class="text-center py-8 text-on-surface-variant/60 text-sm">
                    {m.d7_inv_no_invited()}
                  </div>
                {/if}
              </div>

              {#if joinTotalPages > 1}
                <div class="flex items-center justify-between pt-3 border-t border-outline-variant/10">
                  <button
                    type="button"
                    onclick={() => joinPage = Math.max(1, joinPage - 1)}
                    disabled={joinPage === 1}
                    class="px-4 py-2 rounded-xl bg-surface-container-high/40 hover:bg-surface-container-high text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {m.d7_inv_previous()}
                  </button>
                  <span class="text-xs font-bold text-on-surface-variant/60">{m.d7_inv_page_of({ current: joinPage, total: joinTotalPages })}</span>
                  <button
                    type="button"
                    onclick={() => joinPage = Math.min(joinTotalPages, joinPage + 1)}
                    disabled={joinPage === joinTotalPages}
                    class="px-4 py-2 rounded-xl bg-surface-container-high/40 hover:bg-surface-container-high text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {m.d7_inv_next()}
                  </button>
                </div>
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
