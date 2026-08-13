<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { authStore } from '../lib/stores/auth.svelte';
  import { fetchSecurityAudit, applySecurityFix } from '../lib/api';
  import { toast } from '../lib/stores/toast.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import SectionCard from '../lib/components/SectionCard.svelte';
  import RefreshButton from '../lib/components/RefreshButton.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import EmptyState from '../lib/components/EmptyState.svelte';

  type Severity = 'CRITICAL' | 'WARNING' | 'INFO' | 'OK';
  type Category =
    | 'DISCORD' | 'PERMISSIONS' | 'BOTS' | 'WEBHOOKS'
    | 'INVITES' | 'MODULES' | 'BOT_PERMS' | 'HYGIENE';

  /**
   * `intro` s'insere en tete du corps de page, sous l'en-tete. Le hub Securite
   * y place sa configuration rapide : rendue a cote de cette page plutot que
   * dedans, elle passerait au-dessus du titre, et echapperait au grisage
   * applique quand le module est desactive.
   */
  const { intro = undefined }: { intro?: Snippet } = $props();

  type AuditEntity = { id: string; name: string; type: string; detail?: string };
  type AuditFix = { action: string; label: string; risky?: boolean };

  type Finding = {
    id: string;
    category: Category;
    severity: Severity;
    title: string;
    detail: string;
    recommendation?: string;
    weight: number;
    entities?: AuditEntity[];
    fix?: AuditFix;
  };

  type CategoryScore = {
    category: Category;
    label: string;
    score: number;
    lost: number;
    max: number;
    counts: { critical: number; warning: number; info: number; ok: number };
  };

  type Report = {
    score: number;
    grade: string;
    categories: CategoryScore[];
    findings: Finding[];
    degraded: string[];
    stats: {
      memberCount: number;
      roleCount: number;
      channelCount: number;
      botCount: number;
      webhookCount: number | null;
      inviteCount: number | null;
      adminMemberCount: number;
      nativeAutoModRules: number | null;
    };
    generatedAt: string;
    durationMs: number;
  };

  let report = $state<Report | null>(null);
  let loading = $state(true);
  let error = $state('');
  let fixingId = $state<string | null>(null);
  let severityFilter = $state<Severity | 'ALL'>('ALL');
  let categoryFilter = $state<Category | 'ALL'>('ALL');
  let showResolved = $state(false);

  const SEVERITY_META: Record<Severity, { label: string; icon: string; text: string; bg: string; ring: string }> = {
    CRITICAL: { label: 'Critique', icon: 'AlertOctagon', text: 'text-error', bg: 'bg-error/10', ring: 'ring-error/30' },
    WARNING: { label: 'Avertissement', icon: 'AlertTriangle', text: 'text-amber-500', bg: 'bg-amber-500/10', ring: 'ring-amber-500/30' },
    INFO: { label: 'Information', icon: 'Info', text: 'text-sky-500', bg: 'bg-sky-500/10', ring: 'ring-sky-500/30' },
    OK: { label: 'Conforme', icon: 'ShieldCheck', text: 'text-emerald-500', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30' },
  };

  const CATEGORY_ICONS: Record<Category, string> = {
    DISCORD: 'Discord',
    PERMISSIONS: 'Lock',
    BOTS: 'Robot',
    WEBHOOKS: 'Link',
    INVITES: 'MailOpen',
    MODULES: 'Gears',
    BOT_PERMS: 'ShieldAlert',
    HYGIENE: 'Sparkles',
  };

  const problems = $derived((report?.findings ?? []).filter((f) => f.severity !== 'OK'));
  const resolved = $derived((report?.findings ?? []).filter((f) => f.severity === 'OK'));

  const visibleFindings = $derived(
    (showResolved ? (report?.findings ?? []) : problems).filter(
      (f) =>
        (severityFilter === 'ALL' || f.severity === severityFilter) &&
        (categoryFilter === 'ALL' || f.category === categoryFilter)
    )
  );

  const counts = $derived({
    critical: problems.filter((f) => f.severity === 'CRITICAL').length,
    warning: problems.filter((f) => f.severity === 'WARNING').length,
    info: problems.filter((f) => f.severity === 'INFO').length,
    ok: resolved.length,
  });

  const fixableCount = $derived(problems.filter((f) => f.fix).length);

  /** Points regagnes si tous les correctifs automatiques etaient appliques. */
  const fixablePoints = $derived(problems.filter((f) => f.fix).reduce((sum, f) => sum + f.weight, 0));

  function scoreColor(value: number): string {
    if (value >= 85) return 'text-emerald-500';
    if (value >= 65) return 'text-amber-500';
    if (value >= 45) return 'text-orange-500';
    return 'text-error';
  }

  function scoreStroke(value: number): string {
    if (value >= 85) return 'stroke-emerald-500';
    if (value >= 65) return 'stroke-amber-500';
    if (value >= 45) return 'stroke-orange-500';
    return 'stroke-error';
  }

  function barColor(value: number): string {
    if (value >= 85) return 'bg-emerald-500';
    if (value >= 65) return 'bg-amber-500';
    if (value >= 45) return 'bg-orange-500';
    return 'bg-error';
  }

  function formatDuration(ms: number): string {
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  }

  async function load(showToast = false) {
    if (!authStore.selectedGuildId) return;
    loading = true;
    error = '';
    try {
      const res = await fetchSecurityAudit(true, authStore.selectedGuildId);
      report = res?.report ?? null;
      if (showToast) toast.success('Audit actualisé');
    } catch (err) {
      error = err instanceof Error ? err.message : "Impossible de lancer l'audit";
      report = null;
    } finally {
      loading = false;
    }
  }

  async function runFix(finding: Finding) {
    if (!finding.fix || fixingId) return;
    if (finding.fix.risky) {
      const confirmed = window.confirm(
        `${finding.fix.label}\n\nCette action modifie des permissions existantes du serveur. Confirmer ?`
      );
      if (!confirmed) return;
    }

    fixingId = finding.id;
    try {
      const res = await applySecurityFix(finding.id, authStore.selectedGuildId);
      if (res?.report) report = res.report;
      toast.success(res?.message ?? 'Correctif appliqué');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Le correctif a échoué');
    } finally {
      fixingId = null;
    }
  }

  onMount(load);

  // Recharge quand l'utilisateur change de serveur.
  $effect(() => {
    const guildId = authStore.selectedGuildId;
    if (guildId) void load();
  });

  // Geometrie de l'anneau de score.
  const RING_RADIUS = 52;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const ringOffset = $derived(RING_CIRCUMFERENCE * (1 - (report?.score ?? 0) / 100));
</script>

<ModulePage
  title="Audit de sécurité"
  description="Analyse complète de la configuration du serveur, catégorie par catégorie"
  icon="ShieldCheck"
  featureKey="raid_protection"
>
  {#snippet actions()}
    <RefreshButton onclick={() => load(true)} loading={loading} />
  {/snippet}

  {#if intro}{@render intro()}{/if}

  {#if loading && !report}
    <LoadingHint context="config" />
  {:else if error}
    <EmptyState icon="AlertTriangle" title="Audit indisponible" description={error} />
  {:else if report}
    <!-- ── Synthese ───────────────────────────────────────────────────── -->
    <div class="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
      <SectionCard>
        <div class="flex flex-col items-center gap-4 py-2">
          <div class="relative w-[136px] h-[136px]">
            <svg viewBox="0 0 120 120" class="w-full h-full -rotate-90">
              <circle
                cx="60" cy="60" r={RING_RADIUS}
                class="stroke-outline-variant/30"
                stroke-width="9" fill="none"
              />
              <circle
                cx="60" cy="60" r={RING_RADIUS}
                class="{scoreStroke(report.score)} transition-all duration-700"
                stroke-width="9" fill="none" stroke-linecap="round"
                stroke-dasharray={RING_CIRCUMFERENCE}
                stroke-dashoffset={ringOffset}
              />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-4xl font-bold tracking-tight {scoreColor(report.score)}">{report.score}</span>
              <span class="text-[11px] uppercase tracking-widest text-on-surface-variant/70">Note {report.grade}</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 w-full text-center">
            <div class="rounded-lg bg-error/10 px-3 py-2">
              <div class="text-lg font-semibold text-error">{counts.critical}</div>
              <div class="text-[11px] text-on-surface-variant">Critiques</div>
            </div>
            <div class="rounded-lg bg-amber-500/10 px-3 py-2">
              <div class="text-lg font-semibold text-amber-500">{counts.warning}</div>
              <div class="text-[11px] text-on-surface-variant">Avertissements</div>
            </div>
            <div class="rounded-lg bg-sky-500/10 px-3 py-2">
              <div class="text-lg font-semibold text-sky-500">{counts.info}</div>
              <div class="text-[11px] text-on-surface-variant">Informations</div>
            </div>
            <div class="rounded-lg bg-emerald-500/10 px-3 py-2">
              <div class="text-lg font-semibold text-emerald-500">{counts.ok}</div>
              <div class="text-[11px] text-on-surface-variant">Conformes</div>
            </div>
          </div>

          {#if fixableCount > 0}
            <p class="text-[12px] text-center text-on-surface-variant leading-relaxed">
              <span class="font-semibold text-primary">{fixableCount} constat(s)</span> corrigeables en un clic
              - soit <span class="font-semibold text-primary">+{fixablePoints} points</span> de score.
            </p>
          {/if}

          <p class="text-[11px] text-on-surface-variant/60 text-center">
            Audit effectué en {formatDuration(report.durationMs)} ·
            {new Date(report.generatedAt).toLocaleString('fr-FR')}
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Score par catégorie" description="La catégorie la plus faible est celle qui mérite l'effort en premier.">
        <div class="space-y-2.5">
          {#each [...report.categories].sort((a, b) => a.score - b.score) as cat (cat.category)}
            <button
              type="button"
              class="w-full text-left group"
              onclick={() => (categoryFilter = categoryFilter === cat.category ? 'ALL' : cat.category)}
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center transition-colors
                  {categoryFilter === cat.category ? 'bg-primary/20 text-primary' : 'bg-surface-container text-on-surface-variant group-hover:text-on-surface'}"
                >
                  <Papicon icon={CATEGORY_ICONS[cat.category]} size={14} />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-[13px] font-medium text-on-surface truncate">{cat.label}</span>
                    <span class="text-[12px] font-semibold tabular-nums {scoreColor(cat.score)}">{cat.score}%</span>
                  </div>
                  <div class="mt-1 h-1.5 rounded-full bg-surface-container overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-700 {barColor(cat.score)}"
                      style="width: {cat.score}%"
                    ></div>
                  </div>
                </div>
                {#if cat.counts.critical > 0}
                  <span class="text-[11px] font-semibold text-error shrink-0">{cat.counts.critical} crit.</span>
                {/if}
              </div>
            </button>
          {/each}
        </div>

        <div class="mt-5 pt-4 border-t border-outline-variant/30 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div>
            <div class="text-sm font-semibold text-on-surface">{report.stats.memberCount.toLocaleString('fr-FR')}</div>
            <div class="text-[11px] text-on-surface-variant">Membres</div>
          </div>
          <div>
            <div class="text-sm font-semibold text-on-surface">{report.stats.adminMemberCount}</div>
            <div class="text-[11px] text-on-surface-variant">Administrateurs</div>
          </div>
          <div>
            <div class="text-sm font-semibold text-on-surface">{report.stats.botCount}</div>
            <div class="text-[11px] text-on-surface-variant">Bots</div>
          </div>
          <div>
            <div class="text-sm font-semibold text-on-surface">
              {report.stats.webhookCount ?? '-'}
            </div>
            <div class="text-[11px] text-on-surface-variant">Webhooks</div>
          </div>
        </div>
      </SectionCard>
    </div>

    <!-- ── Controles non executes ─────────────────────────────────────── -->
    {#if report.degraded.length > 0}
      <div class="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <div class="flex items-start gap-3">
          <Papicon icon="AlertTriangle" size={16} class="text-amber-500 mt-0.5 shrink-0" />
          <div class="min-w-0">
            <p class="text-[13px] font-medium text-on-surface">Certains contrôles n'ont pas pu être exécutés</p>
            <ul class="mt-1 space-y-0.5">
              {#each report.degraded as item}
                <li class="text-[12px] text-on-surface-variant">• {item}</li>
              {/each}
            </ul>
            <p class="mt-1.5 text-[12px] text-on-surface-variant/70">
              Le score ne tient pas compte de ces contrôles : il peut être optimiste.
            </p>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Constats ───────────────────────────────────────────────────── -->
    <SectionCard
      title="Constats"
      description="{visibleFindings.length} élément(s) affiché(s) sur {report.findings.length} contrôles."
    >
      {#snippet actions()}
        <label class="flex items-center gap-2 text-[12px] text-on-surface-variant cursor-pointer select-none">
          <input type="checkbox" bind:checked={showResolved} class="accent-primary" />
          Afficher les points conformes
        </label>
      {/snippet}

      <div class="flex flex-wrap gap-1.5 mb-4">
        <button
          type="button"
          class="px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors
          {severityFilter === 'ALL'
            ? 'bg-primary/15 border-primary/40 text-primary'
            : 'bg-surface-container-low border-outline-variant/40 text-on-surface-variant hover:text-on-surface'}"
          onclick={() => (severityFilter = 'ALL')}
        >
          Tout
        </button>
        {#each ['CRITICAL', 'WARNING', 'INFO'] as sev}
          {@const meta = SEVERITY_META[sev as Severity]}
          <button
            type="button"
            class="px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors inline-flex items-center gap-1.5
            {severityFilter === sev
              ? `${meta.bg} border-current ${meta.text}`
              : 'bg-surface-container-low border-outline-variant/40 text-on-surface-variant hover:text-on-surface'}"
            onclick={() => (severityFilter = severityFilter === sev ? 'ALL' : (sev as Severity))}
          >
            <Papicon icon={meta.icon} size={12} />
            {meta.label}
          </button>
        {/each}

        {#if categoryFilter !== 'ALL'}
          <button
            type="button"
            class="px-2.5 py-1 rounded-full text-[12px] font-medium border border-primary/40 bg-primary/15 text-primary inline-flex items-center gap-1.5"
            onclick={() => (categoryFilter = 'ALL')}
          >
            {report.categories.find((c) => c.category === categoryFilter)?.label}
            <Papicon icon="Cross" size={11} />
          </button>
        {/if}
      </div>

      {#if visibleFindings.length === 0}
        <EmptyState
          icon="ShieldCheck"
          title="Aucun constat pour ce filtre"
          description="Élargissez le filtre ou lancez une nouvelle analyse."
        />
      {:else}
        <div class="space-y-2.5">
          {#each visibleFindings as finding (finding.id)}
            {@const meta = SEVERITY_META[finding.severity]}
            <article
              class="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-4 transition-colors hover:border-outline-variant/60"
            >
              <div class="flex items-start gap-3">
                <div class="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center {meta.bg} {meta.text}">
                  <Papicon icon={meta.icon} size={14} />
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-3">
                    <h4 class="text-[14px] font-semibold text-on-surface leading-snug">{finding.title}</h4>
                    <div class="flex items-center gap-2 shrink-0">
                      {#if finding.weight > 0}
                        <span class="text-[11px] font-semibold tabular-nums {meta.text}">-{finding.weight} pts</span>
                      {/if}
                      <span class="text-[11px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">
                        {report.categories.find((c) => c.category === finding.category)?.label}
                      </span>
                    </div>
                  </div>

                  <p class="mt-1 text-[13px] text-on-surface-variant leading-relaxed">
                    {@html finding.detail
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-on-surface font-medium">$1</strong>')
                      .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 rounded bg-surface-container text-[12px]">$1</code>')}
                  </p>

                  {#if finding.entities && finding.entities.length > 0}
                    <div class="mt-2 flex flex-wrap gap-1">
                      {#each finding.entities.slice(0, 12) as entity}
                        <span
                          class="text-[11px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant"
                          title={entity.detail ?? entity.id}
                        >
                          {entity.type === 'channel' ? '#' : entity.type === 'role' ? '@' : ''}{entity.name}
                        </span>
                      {/each}
                      {#if finding.entities.length > 12}
                        <span class="text-[11px] px-1.5 py-0.5 text-on-surface-variant/60">
                          +{finding.entities.length - 12}
                        </span>
                      {/if}
                    </div>
                  {/if}

                  {#if finding.recommendation}
                    <p class="mt-2 text-[12.5px] text-on-surface-variant/85 leading-relaxed pl-2.5 border-l-2 border-primary/40">
                      {finding.recommendation}
                    </p>
                  {/if}

                  {#if finding.fix}
                    <button
                      type="button"
                      class="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium
                      bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25
                      disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      disabled={fixingId !== null}
                      onclick={() => runFix(finding)}
                    >
                      {#if fixingId === finding.id}
                        <Papicon icon="Loader" size={13} class="animate-spin" />
                        Application…
                      {:else}
                        <Papicon icon="Wrench" size={13} />
                        {finding.fix.label}
                        {#if finding.fix.risky}
                          <span class="text-[10px] text-amber-500 ml-0.5">· confirmation</span>
                        {/if}
                      {/if}
                    </button>
                  {/if}
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </SectionCard>
  {/if}
</ModulePage>
