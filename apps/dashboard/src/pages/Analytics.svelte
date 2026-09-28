<script lang="ts">
  /**
   * Page Analytics : huit sections dans une barre latérale (des onglets sur
   * mobile), des filtres communs au-dessus. Chaque section charge ses propres
   * données ; les anciens composants qui dépendent de la grosse réponse
   * /analytics la reçoivent d'ici, chargée seulement quand une section en a
   * besoin.
   *
   * Pulse, Invitations et l'annuaire des invitations ont leur propre page : les
   * anciennes adresses d'onglets y mènent ou vers la section qui les a reprises.
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
  import ActivitySection from '../lib/components/analytics/ActivitySection.svelte';
  import ContentSection from '../lib/components/analytics/ContentSection.svelte';
  import ChannelsSection from '../lib/components/analytics/ChannelsSection.svelte';
  import GrowthSection from '../lib/components/analytics/GrowthSection.svelte';
  import MembersStats from '../lib/components/analytics/MembersStats.svelte';
  import GhostMembersPanel from '../lib/components/analytics/GhostMembersPanel.svelte';
  import AdvancedAnalyticsPanel from '../lib/components/analytics/AdvancedAnalyticsPanel.svelte';
  import ModerationAudit from '../lib/components/analytics/ModerationAudit.svelte';
  import StaffAudit from '../lib/components/analytics/StaffAudit.svelte';
  import StaffPerformance from '../lib/components/analytics/StaffPerformance.svelte';
  import GlobalInteractionGraph from '../lib/components/charts/GlobalInteractionGraph.svelte';
  import { analyticsExport, analyticsFilters as filters } from '../lib/components/analytics/analyticsFilters.svelte';

  type SectionId = 'overview' | 'activity' | 'content' | 'channels' | 'members' | 'growth' | 'moderation' | 'staff';

  interface SectionDef {
    id: SectionId;
    label: string;
    icon: string;
    description: string;
    /** Les filtres salon/rôle/staff s'appliquent-ils à cette section ? */
    scope: 'full' | 'period';
    isNew?: boolean;
  }

  const sections: SectionDef[] = $derived([
    { id: 'overview', label: m.an_tab_overview(), icon: 'Grid', description: m.anx_section_overview_desc(), scope: 'full' },
    { id: 'activity', label: m.anx_section_activity(), icon: 'Activity', description: m.anx_section_activity_desc(), scope: 'full' },
    { id: 'content', label: m.anx_section_content(), icon: 'ChatCircleDots', description: m.anx_section_content_desc(), scope: 'full', isNew: true },
    { id: 'channels', label: m.anx_section_channels(), icon: 'ChatBubbles', description: m.anx_section_channels_desc(), scope: 'period' },
    { id: 'members', label: m.an_tab_members(), icon: 'UsersFour', description: m.anx_section_members_desc(), scope: 'period' },
    { id: 'growth', label: m.anx_section_growth(), icon: 'TrendingUp', description: m.anx_section_growth_desc(), scope: 'period' },
    { id: 'moderation', label: m.an_tab_moderation(), icon: 'Gavel', description: m.anx_section_moderation_desc(), scope: 'period' },
    { id: 'staff', label: m.anx_section_staff(), icon: 'Users', description: m.anx_section_staff_desc(), scope: 'period' },
  ]);

  const SECTION_IDS: SectionId[] = ['overview', 'activity', 'content', 'channels', 'members', 'growth', 'moderation', 'staff'];

  /** Anciens onglets : leur contenu vit dans une section, ou dans une autre page. */
  const LEGACY_TABS: Record<string, SectionId | `/${string}`> = {
    messages: 'activity', voice: 'activity', commands: 'activity', heatmap: 'activity', weekly: 'activity', algo: 'activity',
    interactions: 'members', social: 'members', ghosts: 'members',
    words: 'content',
    cohorts: 'growth', churn: 'growth',
    'mod-advanced': 'moderation',
    performance: 'staff',
    pulse: '/pulse',
    invitations: '/invitations',
  };

  let active = $state<SectionId>('overview');

  $effect(() => {
    const path = $router.path;
    const prefix = '/analytics/';
    if (path.startsWith(prefix)) {
      const segment = decodeURIComponent(path.slice(prefix.length).split('/')[0] ?? '');
      const target = LEGACY_TABS[segment];
      if (target) {
        router.goto(target.startsWith('/') ? target : `/analytics/${target}`, true);
        return;
      }
    }
    active = resolveTabFromUrl('/analytics', SECTION_IDS, 'overview', path) as SectionId;
  });

  const current = $derived(sections.find((s) => s.id === active) ?? sections[0]!);

  function go(id: string) {
    gotoTab('/analytics', id, 'overview');
  }

  // ── Réponse /analytics historique, pour les anciens composants ─────────────
  const NEEDS_LEGACY = new Set<SectionId>(['activity', 'members', 'moderation', 'staff']);
  let legacy = $state<any>(null);
  let legacyKey = '';
  let legacyLoading = $state(false);
  let legacyError = $state('');

  $effect(() => {
    if (!NEEDS_LEGACY.has(active)) return;
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

  // ── Réseau d'interactions, chargé à la demande (lourd) ─────────────────────
  let interactions = $state<any>(null);
  let interactionsLoading = $state(false);
  let interactionsError = $state('');

  async function loadInteractions() {
    interactionsLoading = true;
    interactionsError = '';
    try {
      interactions = await fetchGlobalInteractions(filters.periodQuery);
    } catch (e) {
      interactionsError = errorMessage(e) || m.an_error_interactions();
    } finally {
      interactionsLoading = false;
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
      triggerDownload(blob, `analytics_${active}_${String(index + 1).padStart(2, '0')}.png`, 'image/png');
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
      <p class="max-w-2xl text-body-sm text-on-surface-variant">{current.description}</p>
    </div>
    <ExportDropdown onExportCSV={exportCSV} onExportXLSX={exportXLSX} onExportImage={exportImages} />
  </header>

  <div class="analytics-v2__layout">
    <aside class="analytics-v2__sidebar">
      <nav aria-label={m.anx_nav_label()} class="flex flex-col gap-0.5">
        {#each sections as section (section.id)}
          <button
            type="button"
            class="side-link"
            aria-current={section.id === active ? 'page' : undefined}
            onclick={() => go(section.id)}
          >
            <Papicon icon={section.icon} size={18} />
            <span class="truncate">{section.label}</span>
            {#if section.isNew}<span class="side-link__badge">{m.anx_badge_new()}</span>{/if}
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
      <div class="analytics-v2__tabs">
        <Tabs
          label={m.anx_nav_label()}
          tabs={sections.map((s) => ({ id: s.id, label: s.label, icon: s.icon, badge: s.isNew ? m.anx_badge_new() : undefined }))}
          active={active}
          onchange={go}
        />
      </div>

      <AnalyticsFilterBar scopeSupport={current.scope} />

      {#key active}
        {#if active === 'overview'}
          <OverviewSection onNavigate={go} />
        {:else if active === 'activity'}
          <ActivitySection {legacy} {legacyLoading} onOpenMember={openMemberDetails} />
        {:else if active === 'content'}
          <ContentSection onOpenMember={openMemberDetails} />
        {:else if active === 'channels'}
          <ChannelsSection onOpenMember={openMemberDetails} />
        {:else if active === 'growth'}
          <GrowthSection onOpenMember={openMemberDetails} />
        {:else if legacyError}
          <Callout variant="danger" title={m.an_error_generic()}>{legacyError}</Callout>
        {:else if !legacy}
          <AnalyticsSkeleton />
        {:else if active === 'members'}
          <div class="flex flex-col gap-4">
            <MembersStats data={legacy} {chartLabels} onOpenMember={openMemberDetails} />
            <SectionCard title={m.an_tab_network()} description={m.anx_network_desc()}>
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
                  {#snippet actions()}<Button size="sm" onclick={loadInteractions}>{m.an_retry()}</Button>{/snippet}
                </Callout>
              {:else}
                <Button icon="Compass" loading={interactionsLoading} onclick={loadInteractions}>{m.anx_network_show()}</Button>
              {/if}
            </SectionCard>
            <div class="flex flex-col gap-2">
              <h3 class="text-sm font-semibold text-on-surface">{m.an_tab_social()}</h3>
              <AdvancedAnalyticsPanel section="social" onOpenMember={openMemberDetails} />
            </div>
            <div class="flex flex-col gap-2">
              <h3 class="text-sm font-semibold text-on-surface">{m.ghost_tab()}</h3>
              <GhostMembersPanel onOpenMember={openMemberDetails} />
            </div>
          </div>
        {:else if active === 'moderation'}
          <div class="flex flex-col gap-4">
            <ModerationAudit data={legacy} {chartLabels} onOpenMember={openMemberDetails} />
            <div class="flex flex-col gap-2">
              <h3 class="text-sm font-semibold text-on-surface">{m.an_tab_mod_advanced()}</h3>
              <AdvancedAnalyticsPanel section="moderation" onOpenMember={openMemberDetails} />
            </div>
          </div>
        {:else if active === 'staff'}
          <div class="flex flex-col gap-4">
            <StaffAudit data={legacy} onOpenMember={openMemberDetails} {fmt} {fmtH} />
            {#if legacy.staffPerformance}
              <StaffPerformance data={legacy.staffPerformance} onOpenMember={openMemberDetails} />
            {/if}
          </div>
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

  .analytics-v2__tabs {
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

    .analytics-v2__tabs {
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
