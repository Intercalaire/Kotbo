<script lang="ts">
  /**
   * Page Analytics : huit sections dans une barre latérale (des onglets sur
   * mobile), chacune découpée en sous-onglets comme les autres pages. L'adresse
   * porte le sous-onglet (/analytics/emojis), la section s'en déduit : les
   * anciens liens d'onglets restent valables.
   *
   * Chaque sous-onglet dit ce qu'il suit : tous les filtres, la période seule,
   * ou sa propre fenêtre de temps (la barre de filtres est alors masquée).
   * Les anciens composants qui dépendent de la grosse réponse /analytics la
   * reçoivent d'ici, chargée seulement quand un sous-onglet en a besoin.
   */
  import { untrack } from 'svelte';
  import { router } from 'tinro';
  import { canViewFeature } from '../lib/permissions.svelte';
  import { authStore } from '../lib/stores/auth.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { downloadXlsx } from '../lib/xlsxExport';
  import { gotoTab, resolveTabFromUrl } from '../lib/tabRouting';
  import { m, dateLocale } from '../lib/i18n';
  import { errorMessage } from '@kotbo/shared';
  import { fetchAnalytics, fetchGlobalInteractions, fetchMemberCase } from '../lib/api';
  import Papicon from '../lib/components/Papicon.svelte';
  import MemberCaseModal from '../lib/components/MemberCaseModal.svelte';
  import { Button, Callout, SectionCard, Tabs } from '../lib/components/ui';
  import ExportDropdown from '../lib/components/analytics/ExportDropdown.svelte';
  import AnalyticsFilterBar from '../lib/components/analytics/AnalyticsFilterBar.svelte';
  import AnalyticsSkeleton from '../lib/components/analytics/AnalyticsSkeleton.svelte';
  import OverviewSection from '../lib/components/analytics/OverviewSection.svelte';
  import ActivitySection, { type ActivityView } from '../lib/components/analytics/ActivitySection.svelte';
  import ContentSection, { type ContentView } from '../lib/components/analytics/ContentSection.svelte';
  import ChannelsSection from '../lib/components/analytics/ChannelsSection.svelte';
  import GrowthSection from '../lib/components/analytics/GrowthSection.svelte';
  import KpiTile from '../lib/components/analytics/KpiTile.svelte';
  import BarList from '../lib/components/analytics/BarList.svelte';
  import MembersStats from '../lib/components/analytics/MembersStats.svelte';
  import GhostMembersPanel from '../lib/components/analytics/GhostMembersPanel.svelte';
  import AdvancedAnalyticsPanel from '../lib/components/analytics/AdvancedAnalyticsPanel.svelte';
  import ModerationAudit from '../lib/components/analytics/ModerationAudit.svelte';
  import StaffAudit from '../lib/components/analytics/StaffAudit.svelte';
  import StaffPerformance from '../lib/components/analytics/StaffPerformance.svelte';
  import GlobalInteractionGraph from '../lib/components/charts/GlobalInteractionGraph.svelte';
  import { analyticsExport, analyticsFilters as filters } from '../lib/components/analytics/analyticsFilters.svelte';
  import { fmtNumber, SERIES_NEUTRAL } from '../lib/components/analytics/analyticsFormat';

  /** Ce que suit un sous-onglet : tous les filtres, la période, ou sa propre fenêtre. */
  type Scope = 'full' | 'period' | 'own';

  interface SubTab {
    id: string;
    label: string;
    icon: string;
    scope: Scope;
    /** A besoin de la réponse /analytics historique. */
    legacy?: boolean;
  }

  interface Section {
    id: string;
    label: string;
    icon: string;
    description: string;
    isNew?: boolean;
    tabs: SubTab[];
  }

  const sections: Section[] = $derived([
    {
      id: 'overview', label: m.an_tab_overview(), icon: 'Grid', description: m.anx_section_overview_desc(),
      tabs: [{ id: 'overview', label: m.an_tab_overview(), icon: 'Grid', scope: 'full', legacy: true }],
    },
    {
      id: 'activity', label: m.anx_section_activity(), icon: 'Activity', description: m.anx_section_activity_desc(),
      tabs: [
        { id: 'messages', label: m.an_tab_messages(), icon: 'ChatCircleDots', scope: 'full', legacy: true },
        { id: 'voice', label: m.an_tab_voice(), icon: 'Microphone', scope: 'full', legacy: true },
        { id: 'heatmap', label: m.an_tab_heatmap(), icon: 'Fire', scope: 'period' },
        { id: 'pulse', label: m.an_tab_pulse(), icon: 'Activity', scope: 'own' },
        { id: 'weekly', label: m.an_tab_weekly(), icon: 'Calendar', scope: 'own' },
        { id: 'commands', label: m.an_tab_commands(), icon: 'Code', scope: 'period', legacy: true },
        { id: 'algo', label: m.an_tab_algo(), icon: 'Code', scope: 'period' },
      ],
    },
    {
      id: 'content', label: m.anx_section_content(), icon: 'ChatCircleDots', description: m.anx_section_content_desc(), isNew: true,
      tabs: [
        { id: 'content', label: m.anx_tab_content_overview(), icon: 'Grid', scope: 'full' },
        { id: 'emojis', label: m.anx_tab_emojis(), icon: 'Smile', scope: 'full' },
        { id: 'stickers', label: m.anx_tab_stickers(), icon: 'image', scope: 'full' },
        { id: 'gifs', label: m.anx_tab_gifs(), icon: 'Lightning', scope: 'full' },
        { id: 'sites', label: m.anx_tab_sites(), icon: 'link', scope: 'full' },
        { id: 'formatting', label: m.anx_tab_formatting(), icon: 'Type', scope: 'full' },
        { id: 'words', label: m.an_tab_words(), icon: 'ChatCircleDots', scope: 'own' },
      ],
    },
    {
      id: 'channels', label: m.anx_section_channels(), icon: 'ChatBubbles', description: m.anx_section_channels_desc(),
      tabs: [
        { id: 'channels', label: m.anx_tab_channel_tree(), icon: 'ChatBubbles', scope: 'period' },
        { id: 'channel-health', label: m.anx_channels_health_title(), icon: 'heart', scope: 'own' },
      ],
    },
    {
      id: 'members', label: m.an_tab_members(), icon: 'UsersFour', description: m.anx_section_members_desc(),
      tabs: [
        { id: 'members', label: m.an_tab_members(), icon: 'UsersFour', scope: 'period', legacy: true },
        { id: 'interactions', label: m.an_tab_network(), icon: 'Compass', scope: 'period' },
        { id: 'social', label: m.an_tab_social(), icon: 'Users', scope: 'own' },
        { id: 'ghosts', label: m.ghost_tab(), icon: 'Ghost', scope: 'own' },
      ],
    },
    {
      id: 'growth', label: m.anx_section_growth(), icon: 'TrendingUp', description: m.anx_section_growth_desc(),
      tabs: [
        { id: 'growth', label: m.anx_tab_growth(), icon: 'TrendingUp', scope: 'period', legacy: true },
        { id: 'cohorts', label: m.an_tab_cohorts(), icon: 'UsersFour', scope: 'own' },
        { id: 'churn', label: m.an_tab_churn(), icon: 'Warning', scope: 'own' },
      ],
    },
    {
      id: 'moderation', label: m.an_tab_moderation(), icon: 'Gavel', description: m.anx_section_moderation_desc(),
      tabs: [
        { id: 'moderation', label: m.an_tab_moderation(), icon: 'Gavel', scope: 'period', legacy: true },
        { id: 'mod-advanced', label: m.an_tab_mod_advanced(), icon: 'ChartLineUp', scope: 'own' },
      ],
    },
    {
      id: 'staff', label: m.anx_section_staff(), icon: 'Users', description: m.anx_section_staff_desc(),
      tabs: [
        { id: 'staff', label: m.an_tab_staff_directory(), icon: 'Users', scope: 'period', legacy: true },
        { id: 'performance', label: m.an_tab_staff_performance(), icon: 'TrendUp', scope: 'period', legacy: true },
      ],
    },
  ]);

  const allTabIds = $derived(sections.flatMap((s) => s.tabs.map((t) => t.id)));

  /** Anciens onglets partis sur leur propre page. */
  const MOVED_TO_PAGE: Record<string, string> = { invitations: '/invitations' };

  let activeTab = $state('overview');

  $effect(() => {
    const path = $router.path;
    const prefix = '/analytics/';
    if (path.startsWith(prefix)) {
      const segment = decodeURIComponent(path.slice(prefix.length).split('/')[0] ?? '');
      if (MOVED_TO_PAGE[segment]) {
        router.goto(MOVED_TO_PAGE[segment]!, true);
        return;
      }
    }
    activeTab = resolveTabFromUrl('/analytics', allTabIds, 'overview', path);
  });

  const section = $derived(sections.find((s) => s.tabs.some((t) => t.id === activeTab)) ?? sections[0]!);
  const tab = $derived(section.tabs.find((t) => t.id === activeTab) ?? section.tabs[0]!);

  function goTab(id: string) {
    gotoTab('/analytics', id, 'overview');
  }

  function goSection(id: string) {
    const target = sections.find((s) => s.id === id);
    if (target) goTab(target.tabs[0]!.id);
  }

  // ── Réponse /analytics historique, pour les anciens composants ─────────────
  let legacy = $state<any>(null);
  let legacyKey = '';
  let legacyLoading = $state(false);
  let legacyError = $state('');

  $effect(() => {
    if (!tab.legacy) return;
    const period = filters.periodQuery;
    untrack(() => loadLegacy(period));
  });

  function loadLegacy(period: { period?: number; startDate?: string; endDate?: string }) {
    const key = JSON.stringify(period);
    if (key === legacyKey && (legacy || legacyLoading)) return;
    legacyKey = key;
    legacyLoading = true;
    legacyError = '';
    const options = period.period === 1 ? { ...period, granularity: '30' } : period;
    fetchAnalytics(options)
      .then((res) => {
        if (legacyKey !== key) return;
        legacy = res;
        analyticsExport.legacy = res;
      })
      .catch((e) => {
        if (legacyKey === key) legacyError = errorMessage(e) || m.an_error_generic();
      })
      .finally(() => {
        if (legacyKey === key) legacyLoading = false;
      });
  }

  const isWeeklyView = $derived(!filters.isCustom && filters.days > 90);
  const chartLabels = $derived(legacy?.dailyTrend?.map((d: any) => {
    if (isWeeklyView) {
      const parts = d.dateKey?.slice(5)?.split('-');
      return { ...d, label: parts ? m.an_week_short({ date: `${parts[1]}/${parts[0]}` }) : d.dateKey?.slice(5) };
    }
    return { ...d, label: d.dateKey?.slice(5) };
  }) ?? []);

  const fmt = (n: number) => n?.toLocaleString(dateLocale()) ?? '0';
  const fmtH = (mins: number) => {
    const h = Math.floor((mins || 0) / 60);
    const min = Math.round((mins || 0) % 60);
    if (h > 0) return `${h}h${min > 0 ? String(min).padStart(2, '0') : ''}`;
    return `${min}min`;
  };

  const roleItems = $derived(
    (legacy?.roleDistribution ?? []).map((r: any) => ({
      id: r.roleId,
      label: r.roleName,
      value: r.count ?? 0,
      // Couleur du rôle sur Discord ; un rôle sans couleur reste neutre.
      color: r.color && r.color !== '#000000' && r.color !== '#99AAB5' ? r.color : SERIES_NEUTRAL,
    })),
  );

  // ── Réseau d'interactions ──────────────────────────────────────────────────
  let interactions = $state<any>(null);
  let interactionsKey = '';
  let interactionsLoading = $state(false);
  let interactionsError = $state('');

  $effect(() => {
    if (activeTab !== 'interactions') return;
    const period = filters.periodQuery;
    untrack(() => loadInteractions(period));
  });

  async function loadInteractions(period = filters.periodQuery, force = false) {
    const key = JSON.stringify(period);
    if (!force && key === interactionsKey && (interactions || interactionsLoading)) return;
    interactionsKey = key;
    interactionsLoading = true;
    interactionsError = '';
    try {
      const res = await fetchGlobalInteractions(period);
      if (interactionsKey === key) interactions = res;
    } catch (e) {
      if (interactionsKey === key) interactionsError = errorMessage(e) || m.an_error_interactions();
    } finally {
      if (interactionsKey === key) interactionsLoading = false;
    }
  }

  // ── Fiche membre ───────────────────────────────────────────────────────────
  let modalOpen = $state(false);
  let selectedUserId = $state<string | null>(null);
  let selectedUserName = $state('');
  let caseData = $state<any>(null);
  let loadingCase = $state(false);
  let caseError = $state('');

  /** La fiche membre appartient à la section Membres du centre de gestion. */
  const canOpenMemberCase = $derived(canViewFeature('members'));

  async function openMemberDetails(memberId: string, memberName: string) {
    if (!canOpenMemberCase) return;
    selectedUserId = memberId;
    selectedUserName = memberName || m.an_member_fallback();
    modalOpen = true;
    loadingCase = true;
    caseError = '';
    caseData = null;
    try {
      caseData = await fetchMemberCase(memberId, authStore.selectedGuildId);
    } catch (e) {
      caseError = errorMessage(e) || m.an_case_load_error();
    } finally {
      loadingCase = false;
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  type ExportRow = Record<string, string | number | boolean | null>;
  type ExportSheet = { name: string; rows: ExportRow[] };

  function cell(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    return JSON.stringify(value);
  }

  function appendSheets(sheets: ExportSheet[], name: string, value: unknown) {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      sheets.push({
        name,
        rows: value.map((entry, index) =>
          typeof entry === 'object' && entry !== null
            ? Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, cell(v)]))
            : { index: index + 1, value: cell(entry) }),
      });
      return;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [key, nested] of entries) {
        if (Array.isArray(nested)) appendSheets(sheets, `${name}_${key}`, nested);
      }
      const scalars = entries.filter(([, v]) => !Array.isArray(v));
      if (scalars.length > 0) sheets.push({ name: `${name}_resume`, rows: scalars.map(([key, v]) => ({ key, value: cell(v) })) });
    }
  }

  function collectSheets(): ExportSheet[] {
    const sheets: ExportSheet[] = [];
    for (const [name, value] of Object.entries(analyticsExport)) appendSheets(sheets, name, value);
    return sheets;
  }

  function triggerDownload(content: BlobPart, fileName: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const csvCell = (v: string | number | boolean | null) => {
    if (v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  function exportCSV() {
    const sheets = collectSheets();
    if (sheets.length === 0) return toast.error(m.an_export_no_data());
    const lines: string[] = [];
    for (const sheet of sheets) {
      const headers = [...new Set(sheet.rows.flatMap((r) => Object.keys(r)))];
      lines.push(`# ${sheet.name}`, headers.join(','), ...sheet.rows.map((r) => headers.map((h) => csvCell(r[h] ?? null)).join(',')), '');
    }
    triggerDownload(lines.join('\n'), `analytics_kotbo_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    toast.success(m.an_export_csv_done());
  }

  async function exportXLSX() {
    const sheets = collectSheets();
    if (sheets.length === 0) return toast.error(m.an_export_no_data());
    const ok = await downloadXlsx(`analytics_kotbo_${new Date().toISOString().slice(0, 10)}.xlsx`, sheets);
    if (ok) toast.success(m.an_export_xlsx_done());
    else toast.error(m.an_export_no_data());
  }

  async function exportImages() {
    const root = document.getElementById('analytics-export-root');
    const canvases = root ? [...root.querySelectorAll('canvas')].filter((c) => c.width >= 280 && c.height >= 160) : [];
    if (canvases.length === 0) return toast.error(m.an_export_no_visible_chart());
    let count = 0;
    for (const [index, canvas] of canvases.entries()) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) continue;
      triggerDownload(blob, `analytics_${activeTab}_${String(index + 1).padStart(2, '0')}.png`, 'image/png');
      count += 1;
    }
    if (count === 0) toast.error(m.an_export_images_failed());
    else toast.success(m.an_export_images_done({ count }));
  }
</script>

<div id="analytics-export-root" class="analytics-v2 mx-auto flex max-w-7xl flex-col gap-5 pb-20">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="flex min-w-0 flex-col gap-1">
      <h1 class="font-headline text-2xl font-semibold text-on-surface">{m.anx_page_title()}</h1>
      <p class="max-w-2xl text-body-sm text-on-surface-variant">{section.description}</p>
    </div>
    <ExportDropdown onExportCSV={exportCSV} onExportXLSX={exportXLSX} onExportImage={exportImages} />
  </header>

  <div class="analytics-v2__layout">
    <aside class="analytics-v2__sidebar">
      <nav aria-label={m.anx_nav_label()} class="flex flex-col gap-0.5">
        {#each sections as s (s.id)}
          <button
            type="button"
            class="side-link"
            aria-current={s.id === section.id ? 'page' : undefined}
            onclick={() => goSection(s.id)}
          >
            <Papicon icon={s.icon} size={18} />
            <span class="truncate">{s.label}</span>
            {#if s.isNew}<span class="side-link__badge">{m.anx_badge_new()}</span>{/if}
            {#if s.tabs.length > 1}<span class="side-link__count">{s.tabs.length}</span>{/if}
          </button>
        {/each}
      </nav>
      <div class="flex flex-col gap-1 border-t border-outline-variant pt-3">
        <span class="px-3 text-2xs text-on-surface-variant">{m.anx_nav_elsewhere()}</span>
        <a class="side-link side-link--quiet" href="/pulse"><Papicon icon="activity" size={16} />{m.nav_pulse()}</a>
        <a class="side-link side-link--quiet" href="/invitations"><Papicon icon="link" size={16} />{m.nav_invitations()}</a>
      </div>
    </aside>

    <div class="flex min-w-0 flex-col gap-4">
      <div class="analytics-v2__mobile-sections">
        <Tabs
          label={m.anx_nav_label()}
          tabs={sections.map((s) => ({ id: s.id, label: s.label, icon: s.icon, badge: s.isNew ? m.anx_badge_new() : undefined }))}
          active={section.id}
          onchange={goSection}
        />
      </div>

      {#if section.tabs.length > 1}
        <Tabs
          label={m.anx_subtabs_label({ section: section.label })}
          tabs={section.tabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
          active={tab.id}
          onchange={goTab}
        />
      {/if}

      {#if tab.scope === 'own'}
        <Callout variant="info">{m.anx_filter_own_window()}</Callout>
      {:else}
        <AnalyticsFilterBar scopeSupport={tab.scope === 'full' ? 'full' : 'period'} />
      {/if}

      {#key activeTab}
        {#if activeTab === 'overview'}
          <OverviewSection onNavigate={goTab} {legacy} />
        {:else if ['messages', 'voice', 'heatmap', 'pulse', 'weekly', 'commands', 'algo'].includes(activeTab)}
          <ActivitySection view={activeTab as ActivityView} {legacy} {legacyLoading} onOpenMember={openMemberDetails} />
        {:else if ['content', 'emojis', 'stickers', 'gifs', 'sites', 'formatting'].includes(activeTab)}
          <ContentSection view={activeTab as ContentView} />
        {:else if activeTab === 'words'}
          <AdvancedAnalyticsPanel section="words" onOpenMember={openMemberDetails} />
        {:else if activeTab === 'channels'}
          <ChannelsSection onOpenMember={openMemberDetails} />
        {:else if activeTab === 'channel-health'}
          <AdvancedAnalyticsPanel section="channels" onOpenMember={openMemberDetails} />
        {:else if activeTab === 'interactions'}
          {#if interactions}
            <GlobalInteractionGraph
              nodes={interactions.nodes || []}
              edges={interactions.edges || []}
              hiddenMembersCount={interactions.hiddenMembersCount || 0}
              onSelectNode={(userId) => openMemberDetails(userId, m.an_loading_short())}
            />
          {:else if interactionsError}
            <Callout variant="danger" title={m.an_network_error()}>
              {interactionsError}
              {#snippet actions()}<Button size="sm" onclick={() => loadInteractions(filters.periodQuery, true)}>{m.an_retry()}</Button>{/snippet}
            </Callout>
          {:else}
            <AnalyticsSkeleton />
          {/if}
        {:else if activeTab === 'social'}
          <AdvancedAnalyticsPanel section="social" onOpenMember={openMemberDetails} />
        {:else if activeTab === 'ghosts'}
          <GhostMembersPanel onOpenMember={openMemberDetails} />
        {:else if activeTab === 'growth'}
          <GrowthSection {legacy} {legacyLoading} onOpenMember={openMemberDetails} />
        {:else if activeTab === 'cohorts'}
          <AdvancedAnalyticsPanel section="retention" onOpenMember={openMemberDetails} />
        {:else if activeTab === 'churn'}
          <AdvancedAnalyticsPanel section="churn" onOpenMember={openMemberDetails} />
        {:else if activeTab === 'mod-advanced'}
          <AdvancedAnalyticsPanel section="moderation" onOpenMember={openMemberDetails} />
        {:else if legacyError}
          <Callout variant="danger" title={m.an_error_generic()}>{legacyError}</Callout>
        {:else if !legacy}
          <AnalyticsSkeleton />
        {:else if activeTab === 'members'}
          <div class="flex flex-col gap-4">
            <MembersStats data={legacy} {chartLabels} onOpenMember={openMemberDetails} />
            {#if roleItems.length > 0}
              <SectionCard title={m.anx_roles_title()} description={m.anx_roles_desc()}>
                <BarList items={roleItems} />
              </SectionCard>
            {/if}
          </div>
        {:else if activeTab === 'moderation'}
          <div class="flex flex-col gap-4">
            <div class="kpi-grid kpi-grid--4">
              <KpiTile label={m.anx_fact_sanctions()} value={fmtNumber(legacy.totals?.sanctions ?? 0)} />
              <KpiTile label={m.anx_mod_active()} value={fmtNumber(legacy.moderation?.activeSanctions ?? 0)} hint={m.anx_mod_active_hint()} />
              <KpiTile label={m.anx_mod_per_day()} value={fmtNumber(Math.round(((legacy.totals?.sanctions ?? 0) / Math.max(1, filters.days)) * 10) / 10)} />
              <KpiTile label={m.anx_mod_moderators()} value={fmtNumber(legacy.topModerators?.length ?? 0)} hint={m.anx_mod_moderators_hint()} />
            </div>
            <ModerationAudit data={legacy} {chartLabels} onOpenMember={openMemberDetails} />
          </div>
        {:else if activeTab === 'staff'}
          <StaffAudit data={legacy} onOpenMember={openMemberDetails} {fmt} {fmtH} />
        {:else if activeTab === 'performance'}
          {#if legacy.staffPerformance}
            <StaffPerformance data={legacy.staffPerformance} onOpenMember={openMemberDetails} />
          {/if}
        {/if}
      {/key}
    </div>
  </div>

  <MemberCaseModal
    bind:open={modalOpen}
    userId={selectedUserId}
    userName={selectedUserName}
    {caseData}
    loading={loadingCase}
    error={caseError}
    onClose={() => (modalOpen = false)}
    onSelectUser={(userId) => openMemberDetails(userId, m.an_loading_short())}
  />
</div>

<style>
  .analytics-v2__layout {
    display: grid;
    grid-template-columns: 13.5rem minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }

  .analytics-v2__sidebar {
    position: sticky;
    top: calc(var(--app-navbar-height) + 1rem);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .analytics-v2__mobile-sections {
    display: none;
  }

  .side-link {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    min-height: 2.5rem;
    padding: 0 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    text-align: left;
    color: var(--color-on-surface-variant);
  }

  .side-link:hover {
    background: var(--color-surface-container);
    color: var(--color-on-surface);
  }

  .side-link:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .side-link[aria-current='page'] {
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    color: var(--color-primary);
  }

  .side-link--quiet {
    min-height: 2.25rem;
    font-size: 0.8125rem;
  }

  .side-link__badge {
    margin-left: auto;
    padding: 0.0625rem 0.4375rem;
    border-radius: 999px;
    font-size: 0.6875rem;
    font-weight: 600;
    background: var(--color-primary);
    color: var(--color-on-primary);
  }

  .side-link__count {
    margin-left: auto;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--color-on-surface-variant);
  }

  .side-link__badge + .side-link__count {
    margin-left: 0.375rem;
  }

  /* Grilles partagées par les sections. */
  .analytics-v2 :global(.kpi-grid) {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(var(--kpi-cols, 4), minmax(0, 1fr));
  }

  .analytics-v2 :global(.kpi-grid--4) {
    --kpi-cols: 4;
  }

  .analytics-v2 :global(.kpi-grid--5) {
    --kpi-cols: 5;
  }

  .analytics-v2 :global(.section-grid) {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    align-items: start;
  }

  .analytics-v2 :global(.span-4) { grid-column: span 4; }
  .analytics-v2 :global(.span-5) { grid-column: span 5; }
  .analytics-v2 :global(.span-6) { grid-column: span 6; }
  .analytics-v2 :global(.span-7) { grid-column: span 7; }
  .analytics-v2 :global(.span-12) { grid-column: span 12; }

  @media (max-width: 1279px) {
    .analytics-v2 :global(.kpi-grid--5) {
      --kpi-cols: 3;
    }

    .analytics-v2 :global(.span-4),
    .analytics-v2 :global(.span-5),
    .analytics-v2 :global(.span-7) {
      grid-column: span 12;
    }
  }

  @media (max-width: 1023px) {
    .analytics-v2__layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .analytics-v2__sidebar {
      display: none;
    }

    .analytics-v2__mobile-sections {
      display: block;
    }

    .analytics-v2 :global(.span-6) {
      grid-column: span 12;
    }
  }

  @media (max-width: 639px) {
    .analytics-v2 :global(.kpi-grid) {
      --kpi-cols: 2;
    }
  }
</style>
