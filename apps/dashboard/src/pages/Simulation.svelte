<script lang="ts">
  import { onMount } from 'svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { m, dateLocale } from '../lib/i18n';
  import {
    INCIDENT_KINDS,
    MODERATION_ACTIONS,
    DIFFICULTIES,
    validateScenario,
    type Difficulty,
    type IncidentKind,
    type ModerationAction,
    type ScenarioIssue,
    type ScenarioStep,
  } from '@kotbo/shared';
  import {
    fetchSimulation,
    fetchSimulationSessions,
    fetchSimulationSession,
    updateSimulationConfig,
    createScenario,
    updateScenario,
    deleteScenario,
    type SimulationConfig,
    type SimulationScenario,
    type SimulationSessionSummary,
    type SimulationSessionDetail,
  } from '../lib/api';

  const canManageSettings = $derived(!!dashboardStore.state.access?.canManageSettings);
  const availableChannels = $derived(dashboardStore.state.discordChannels || []);

  type Tab = 'scenarios' | 'sessions' | 'config';
  let tab = $state<Tab>('scenarios');
  let loading = $state(true);
  let error = $state('');
  let saving = $state(false);

  let config = $state<SimulationConfig | null>(null);
  let scenarios = $state<SimulationScenario[]>([]);
  let sessions = $state<SimulationSessionSummary[]>([]);
  let openSession = $state<SimulationSessionDetail | null>(null);

  let configForm = $state({ enabled: false, testChannelId: '', stepTimeoutSeconds: 180 });

  // ── Édition d'un scénario ────────────────────────────────────────────────
  let editing = $state<string | null>(null);
  let isNew = $state(false);
  let form = $state({
    title: '',
    description: '',
    difficulty: 'MEDIUM' as Difficulty,
    enabled: true,
    steps: [] as ScenarioStep[],
  });

  const issues = $derived<ScenarioIssue[]>(
    editing !== null || isNew ? validateScenario({ title: form.title, steps: form.steps }) : [],
  );

  const KIND_LABELS: Record<IncidentKind, () => string> = {
    SPAM: () => m.sm_kind_spam(),
    INSULT: () => m.sm_kind_insult(),
    SUSPICIOUS_LINK: () => m.sm_kind_suspicious_link(),
    TICKET: () => m.sm_kind_ticket(),
    HARMLESS: () => m.sm_kind_harmless(),
  };

  const ACTION_LABELS: Record<ModerationAction, () => string> = {
    IGNORE: () => m.sm_action_ignore(),
    DELETE: () => m.sm_action_delete(),
    WARN: () => m.sm_action_warn(),
    MUTE: () => m.sm_action_mute(),
    KICK: () => m.sm_action_kick(),
    BAN: () => m.sm_action_ban(),
    ESCALATE: () => m.sm_action_escalate(),
    REPLY: () => m.sm_action_reply(),
  };

  const DIFFICULTY_LABELS: Record<Difficulty, () => string> = {
    EASY: () => m.sm_difficulty_easy(),
    MEDIUM: () => m.sm_difficulty_medium(),
    HARD: () => m.sm_difficulty_hard(),
  };

  const STATUS_META: Record<string, { label: () => string; color: string }> = {
    RUNNING: { label: () => m.sm_status_running(), color: 'bg-sky-500/15 text-sky-300' },
    COMPLETED: { label: () => m.sm_status_completed(), color: 'bg-emerald-500/15 text-emerald-300' },
    ABANDONED: { label: () => m.sm_status_abandoned(), color: 'bg-amber-500/15 text-amber-300' },
  };

  async function load() {
    try {
      const [sim, sess] = await Promise.all([fetchSimulation(), fetchSimulationSessions()]);
      if (sim) {
        config = sim.config;
        scenarios = sim.scenarios;
        configForm = {
          enabled: sim.config.enabled,
          testChannelId: sim.config.testChannelId ?? '',
          stepTimeoutSeconds: sim.config.stepTimeoutSeconds,
        };
      }
      if (sess) sessions = sess.sessions;
    } catch (e: any) {
      error = e?.message || m.sm_error();
    }
  }

  onMount(async () => {
    loading = true;
    await load();
    loading = false;
  });

  async function saveConfig() {
    if (!canManageSettings || saving) return;
    saving = true;
    try {
      await updateSimulationConfig({
        enabled: configForm.enabled,
        testChannelId: configForm.testChannelId || null,
        stepTimeoutSeconds: configForm.stepTimeoutSeconds,
      });
      toast.success(m.sm_saved());
      await load();
    } catch (e: any) {
      toast.error(e?.message || m.sm_error());
    } finally {
      saving = false;
    }
  }

  function newScenario() {
    isNew = true;
    editing = null;
    form = { title: '', description: '', difficulty: 'MEDIUM', enabled: true, steps: [] };
    addStep();
  }

  function editScenario(scenario: SimulationScenario) {
    isNew = false;
    editing = scenario.id;
    form = {
      title: scenario.title,
      description: scenario.description,
      difficulty: scenario.difficulty,
      enabled: scenario.enabled,
      steps: structuredClone(scenario.steps),
    };
  }

  function closeEditor() {
    editing = null;
    isNew = false;
  }

  function addStep() {
    form.steps = [...form.steps, {
      id: `step-${Date.now()}-${form.steps.length}`,
      kind: 'SPAM',
      authorName: 'Utilisateur test',
      content: '',
      delaySeconds: 10,
      expected: { action: 'DELETE' },
      points: 10,
      hint: '',
    }];
  }

  function removeStep(index: number) {
    form.steps = form.steps.filter((_, i) => i !== index);
  }

  function updateStep(index: number, patch: Partial<ScenarioStep>) {
    form.steps = form.steps.map((step, i) => (i === index ? { ...step, ...patch } : step));
  }

  function updateExpected(index: number, patch: Partial<ScenarioStep['expected']>) {
    form.steps = form.steps.map((step, i) =>
      (i === index ? { ...step, expected: { ...step.expected, ...patch } } : step));
  }

  async function saveScenario() {
    if (!canManageSettings || saving) return;
    if (issues.length > 0) {
      toast.error(issues[0].message);
      return;
    }

    saving = true;
    try {
      const payload = { ...form };
      if (editing) await updateScenario(editing, payload);
      else await createScenario(payload);
      toast.success(m.sm_saved());
      closeEditor();
      await load();
    } catch (e: any) {
      toast.error(e?.message || m.sm_error());
    } finally {
      saving = false;
    }
  }

  async function removeScenario(id: string) {
    if (!confirm(m.sm_delete_confirm())) return;
    try {
      await deleteScenario(id);
      toast.success(m.sm_deleted());
      await load();
    } catch (e: any) {
      toast.error(e?.message || m.sm_error());
    }
  }

  async function openSessionDetail(id: string) {
    try {
      const result = await fetchSimulationSession(id);
      if (result?.session) openSession = result.session;
    } catch (e: any) {
      toast.error(e?.message || m.sm_error());
    }
  }

  function formatDate(value: string | null): string {
    if (!value) return '-';
    return new Date(value).toLocaleString(dateLocale(), {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  function scoreColor(percent: number): string {
    if (percent >= 80) return 'text-emerald-400';
    if (percent >= 50) return 'text-amber-400';
    return 'text-red-400';
  }

  const editorOpen = $derived(isNew || editing !== null);
</script>

<ModulePage title={m.sm_page_title()} description={m.sm_page_desc()} icon="GraduationCap" featureKey="simulation">
  {#snippet actions()}
    <div class="inline-flex bg-surface-container-high/60 border border-outline-variant/10 rounded-lg p-1 gap-1">
      {#each [
        { id: 'scenarios' as const, label: m.sm_tab_scenarios() },
        { id: 'sessions' as const, label: m.sm_tab_sessions() },
        { id: 'config' as const, label: m.sm_tab_config() },
      ] as entry}
        <button
          onclick={() => { tab = entry.id; closeEditor(); openSession = null; }}
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all {tab === entry.id
            ? 'bg-primary text-on-primary'
            : 'text-on-surface-variant/70 hover:text-on-surface'}"
        >{entry.label}</button>
      {/each}
    </div>
  {/snippet}

  {#if loading}
    <div class="space-y-3">
      {#each Array(3) as _}
        <div class="h-24 rounded-2xl bg-surface-container-high/40 animate-pulse"></div>
      {/each}
    </div>
  {:else if error}
    <div class="p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 flex items-center gap-3">
      <Papicon icon="Warning" size={20} /><span>{error}</span>
    </div>

  <!-- ── Configuration ──────────────────────────────────────────────────── -->
  {:else if tab === 'config'}
    <section class="p-5 rounded-2xl bg-surface-container-high/50 border border-outline-variant/10 space-y-4 max-w-2xl">
      <label class="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" bind:checked={configForm.enabled} class="w-4 h-4 rounded accent-primary" />
        <span class="text-sm text-on-surface">{m.sm_config_enabled()}</span>
      </label>

      <div class="space-y-1.5">
        <label for="sm-channel" class="text-[10px] font-bold text-on-surface-variant/70 uppercase tracking-widest">
          {m.sm_config_channel()}
        </label>
        <select
          id="sm-channel"
          bind:value={configForm.testChannelId}
          class="w-full px-3 py-2 rounded-xl bg-surface-container-highest border border-outline-variant/20 text-sm text-on-surface"
        >
          <option value="">-</option>
          {#each availableChannels as channel}
            <option value={channel.id}>#{channel.name}</option>
          {/each}
        </select>
        <p class="text-[11px] text-on-surface-variant/50">{m.sm_config_channel_help()}</p>
      </div>

      <div class="space-y-1.5">
        <label for="sm-timeout" class="text-[10px] font-bold text-on-surface-variant/70 uppercase tracking-widest">
          {m.sm_config_timeout()}
        </label>
        <input
          id="sm-timeout"
          type="number"
          min="30"
          max="900"
          bind:value={configForm.stepTimeoutSeconds}
          class="w-full px-3 py-2 rounded-xl bg-surface-container-highest border border-outline-variant/20 text-sm text-on-surface"
        />
        <p class="text-[11px] text-on-surface-variant/50">{m.sm_config_timeout_help()}</p>
      </div>

      {#if canManageSettings}
        <div class="flex justify-end">
          <button
            onclick={saveConfig}
            disabled={saving}
            class="px-5 py-2.5 rounded-xl text-xs font-semibold bg-primary text-on-primary hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            <Papicon icon={saving ? 'Loader' : 'Check'} size={14} class={saving ? 'animate-spin' : ''} />
            {saving ? m.sm_saving() : m.sm_save()}
          </button>
        </div>
      {/if}
    </section>

  <!-- ── Éditeur de scénario ────────────────────────────────────────────── -->
  {:else if tab === 'scenarios' && editorOpen}
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <button onclick={closeEditor} class="px-4 py-2 rounded-xl text-xs font-semibold bg-surface-container-high text-on-surface">
          {m.sm_back()}
        </button>
        <button
          onclick={saveScenario}
          disabled={saving || issues.length > 0}
          class="px-5 py-2 rounded-xl text-xs font-semibold bg-primary text-on-primary disabled:opacity-40 flex items-center gap-2"
        >
          <Papicon icon={saving ? 'Loader' : 'Check'} size={14} class={saving ? 'animate-spin' : ''} />
          {saving ? m.sm_saving() : m.sm_save()}
        </button>
      </div>

      {#if issues.length > 0}
        <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 space-y-1">
          <h4 class="text-[10px] font-bold uppercase tracking-widest text-red-300">{m.sm_issues()}</h4>
          {#each issues as issue}
            <p class="text-[11px] text-red-300">{issue.message}</p>
          {/each}
        </div>
      {/if}

      <div class="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3">
        <div class="space-y-1.5">
          <label for="sm-title" class="text-[10px] font-bold text-on-surface-variant/70 uppercase tracking-widest">{m.sm_title()}</label>
          <input id="sm-title" bind:value={form.title} class="w-full px-3 py-2 rounded-xl bg-surface-container-highest border border-outline-variant/20 text-sm text-on-surface" />
        </div>
        <div class="space-y-1.5">
          <label for="sm-diff" class="text-[10px] font-bold text-on-surface-variant/70 uppercase tracking-widest">{m.sm_difficulty()}</label>
          <select id="sm-diff" bind:value={form.difficulty} class="w-full px-3 py-2 rounded-xl bg-surface-container-highest border border-outline-variant/20 text-sm text-on-surface">
            {#each DIFFICULTIES as level}
              <option value={level}>{DIFFICULTY_LABELS[level]()}</option>
            {/each}
          </select>
        </div>
        <label class="flex items-center gap-2 px-3 py-2 cursor-pointer">
          <input type="checkbox" bind:checked={form.enabled} class="w-4 h-4 rounded accent-primary" />
          <span class="text-xs text-on-surface">{m.sm_enabled()}</span>
        </label>
      </div>

      <div class="space-y-1.5">
        <label for="sm-desc" class="text-[10px] font-bold text-on-surface-variant/70 uppercase tracking-widest">{m.sm_description()}</label>
        <input id="sm-desc" bind:value={form.description} class="w-full px-3 py-2 rounded-xl bg-surface-container-highest border border-outline-variant/20 text-sm text-on-surface" />
      </div>

      <!-- Incidents -->
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-on-surface">{m.sm_steps()} <span class="text-on-surface-variant/40 font-normal">({form.steps.length})</span></h3>
        <button onclick={addStep} class="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-container-highest text-on-surface">
          {m.sm_add_step()}
        </button>
      </div>

      <div class="space-y-3">
        {#each form.steps as step, index (step.id)}
          <article class="p-4 rounded-2xl bg-surface-container-high/50 border border-outline-variant/10 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold text-on-surface-variant/50">#{index + 1}</span>
              <button onclick={() => removeStep(index)} class="p-1 rounded text-red-400 hover:bg-red-500/10">
                <Papicon icon="Trash" size={13} />
              </button>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div class="space-y-1">
                <label for="k-{step.id}" class="text-[10px] text-on-surface-variant/60">{m.sm_step_kind()}</label>
                <select id="k-{step.id}" value={step.kind} onchange={(e) => updateStep(index, { kind: e.currentTarget.value as IncidentKind })}
                  class="w-full px-2 py-1.5 rounded-lg bg-surface-container-highest border border-outline-variant/20 text-[11px] text-on-surface">
                  {#each INCIDENT_KINDS as kind}<option value={kind}>{KIND_LABELS[kind]()}</option>{/each}
                </select>
              </div>
              <div class="space-y-1">
                <label for="a-{step.id}" class="text-[10px] text-on-surface-variant/60">{m.sm_step_author()}</label>
                <input id="a-{step.id}" value={step.authorName} oninput={(e) => updateStep(index, { authorName: e.currentTarget.value })}
                  class="w-full px-2 py-1.5 rounded-lg bg-surface-container-highest border border-outline-variant/20 text-[11px] text-on-surface" />
              </div>
              <div class="space-y-1">
                <label for="d-{step.id}" class="text-[10px] text-on-surface-variant/60">{m.sm_step_delay()}</label>
                <input id="d-{step.id}" type="number" min="0" max="600" value={step.delaySeconds}
                  oninput={(e) => updateStep(index, { delaySeconds: Number(e.currentTarget.value) })}
                  class="w-full px-2 py-1.5 rounded-lg bg-surface-container-highest border border-outline-variant/20 text-[11px] text-on-surface" />
              </div>
              <div class="space-y-1">
                <label for="p-{step.id}" class="text-[10px] text-on-surface-variant/60">{m.sm_step_points()}</label>
                <input id="p-{step.id}" type="number" min="1" max="100" value={step.points}
                  oninput={(e) => updateStep(index, { points: Number(e.currentTarget.value) })}
                  class="w-full px-2 py-1.5 rounded-lg bg-surface-container-highest border border-outline-variant/20 text-[11px] text-on-surface" />
              </div>
            </div>

            <div class="space-y-1">
              <label for="c-{step.id}" class="text-[10px] text-on-surface-variant/60">{m.sm_step_content()}</label>
              <textarea id="c-{step.id}" rows="2" value={step.content} oninput={(e) => updateStep(index, { content: e.currentTarget.value })}
                class="w-full px-2 py-1.5 rounded-lg bg-surface-container-highest border border-outline-variant/20 text-[11px] text-on-surface"></textarea>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div class="space-y-1">
                <label for="e-{step.id}" class="text-[10px] text-on-surface-variant/60">{m.sm_step_expected()}</label>
                <select id="e-{step.id}" value={step.expected.action} onchange={(e) => updateExpected(index, { action: e.currentTarget.value as ModerationAction })}
                  class="w-full px-2 py-1.5 rounded-lg bg-surface-container-highest border border-outline-variant/20 text-[11px] text-on-surface">
                  {#each MODERATION_ACTIONS as action}<option value={action}>{ACTION_LABELS[action]()}</option>{/each}
                </select>
              </div>
              {#if step.expected.action === 'MUTE'}
                <div class="space-y-1">
                  <label for="mm-{step.id}" class="text-[10px] text-on-surface-variant/60">{m.sm_step_mute_minutes()}</label>
                  <input id="mm-{step.id}" type="number" min="1" value={step.expected.muteMinutes ?? 60}
                    oninput={(e) => updateExpected(index, { muteMinutes: Number(e.currentTarget.value) })}
                    class="w-full px-2 py-1.5 rounded-lg bg-surface-container-highest border border-outline-variant/20 text-[11px] text-on-surface" />
                </div>
                <div class="space-y-1">
                  <label for="mt-{step.id}" class="text-[10px] text-on-surface-variant/60">{m.sm_step_tolerance()}</label>
                  <input id="mt-{step.id}" type="number" min="0" value={step.expected.muteToleranceMinutes ?? 0}
                    oninput={(e) => updateExpected(index, { muteToleranceMinutes: Number(e.currentTarget.value) })}
                    class="w-full px-2 py-1.5 rounded-lg bg-surface-container-highest border border-outline-variant/20 text-[11px] text-on-surface" />
                </div>
              {/if}
              <div class="space-y-1 {step.expected.action === 'MUTE' ? '' : 'md:col-span-3'}">
                <label for="h-{step.id}" class="text-[10px] text-on-surface-variant/60">{m.sm_step_hint()}</label>
                <input id="h-{step.id}" value={step.hint ?? ''} oninput={(e) => updateStep(index, { hint: e.currentTarget.value })}
                  class="w-full px-2 py-1.5 rounded-lg bg-surface-container-highest border border-outline-variant/20 text-[11px] text-on-surface" />
              </div>
            </div>
          </article>
        {/each}
      </div>
    </div>

  <!-- ── Liste des scénarios ────────────────────────────────────────────── -->
  {:else if tab === 'scenarios'}
    <div class="space-y-4">
      {#if canManageSettings}
        <button onclick={newScenario} class="px-5 py-2.5 rounded-xl text-xs font-semibold bg-primary text-on-primary flex items-center gap-2">
          <Papicon icon="Plus" size={14} />{m.sm_new_scenario()}
        </button>
      {/if}

      {#if scenarios.length === 0}
        <div class="p-10 text-center text-sm text-on-surface-variant/50 rounded-2xl bg-surface-container-high/30">
          {m.sm_scenarios_empty()}
        </div>
      {:else}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {#each scenarios as scenario (scenario.id)}
            <article class="p-4 rounded-2xl bg-surface-container-high/50 border border-outline-variant/10 space-y-2">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-on-surface truncate">{scenario.title}</h3>
                  <p class="text-[11px] text-on-surface-variant/60 truncate">{scenario.description}</p>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 {scenario.enabled
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-surface-container-highest text-on-surface-variant/50'}">
                  {scenario.enabled ? m.sm_enabled() : m.sm_disabled()}
                </span>
              </div>
              <div class="flex gap-3 text-[11px] text-on-surface-variant/60">
                <span>{DIFFICULTY_LABELS[scenario.difficulty]()}</span>
                <span>{m.sm_step_count({ n: scenario.steps.length })}</span>
              </div>
              {#if canManageSettings}
                <div class="flex gap-2 pt-1">
                  <button onclick={() => editScenario(scenario)} class="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-surface-container-highest text-on-surface">{m.sm_edit()}</button>
                  <button onclick={() => removeScenario(scenario.id)} class="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-300">{m.sm_delete()}</button>
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </div>

  <!-- ── Rapports ───────────────────────────────────────────────────────── -->
  {:else if openSession}
    <div class="space-y-4">
      <button onclick={() => (openSession = null)} class="px-4 py-2 rounded-xl text-xs font-semibold bg-surface-container-high text-on-surface">
        {m.sm_back()}
      </button>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="p-4 rounded-2xl bg-surface-container-high/50 border border-outline-variant/10">
          <div class="text-[10px] uppercase tracking-widest text-on-surface-variant/50">{m.sm_session_score()}</div>
          <div class="text-2xl font-bold {scoreColor(openSession.scorePercent)}">{openSession.scorePercent} %</div>
          <div class="text-[11px] text-on-surface-variant/50">{openSession.score} / {openSession.maxScore}</div>
        </div>
        <div class="p-4 rounded-2xl bg-surface-container-high/50 border border-outline-variant/10">
          <div class="text-[10px] uppercase tracking-widest text-on-surface-variant/50">{m.sm_session_avg()}</div>
          <div class="text-2xl font-bold text-on-surface">{Math.round(openSession.averageResponseMs / 1000)} s</div>
        </div>
        <div class="p-4 rounded-2xl bg-surface-container-high/50 border border-outline-variant/10">
          <div class="text-[10px] uppercase tracking-widest text-on-surface-variant/50">{m.sm_session_detail()}</div>
          <div class="text-sm text-on-surface mt-1">
            <span class="text-emerald-400">{openSession.correctCount}</span> ·
            <span class="text-amber-400">{openSession.partialCount}</span> ·
            <span class="text-red-400">{openSession.missedCount}</span>
          </div>
        </div>
      </div>

      {#if openSession.advice.length > 0}
        <div class="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/20 space-y-1">
          <h4 class="text-[10px] font-bold uppercase tracking-widest text-sky-300">{m.sm_session_advice()}</h4>
          {#each openSession.advice as advice}
            <p class="text-xs text-sky-200">• {advice}</p>
          {/each}
        </div>
      {/if}

      <div class="rounded-2xl bg-surface-container-high/50 border border-outline-variant/10 overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-[10px] uppercase tracking-widest text-on-surface-variant/50 border-b border-outline-variant/10">
              <th class="text-left font-bold px-4 py-3">#</th>
              <th class="text-left font-bold px-4 py-3">{m.sm_session_expected()}</th>
              <th class="text-left font-bold px-4 py-3">{m.sm_session_chosen()}</th>
              <th class="text-right font-bold px-4 py-3">{m.sm_step_points()}</th>
              <th class="text-left font-bold px-4 py-3">{m.sm_session_detail()}</th>
            </tr>
          </thead>
          <tbody>
            {#each openSession.answers as answer (answer.id)}
              <tr class="border-b border-outline-variant/5">
                <td class="px-4 py-2 text-on-surface-variant/50">{answer.stepIndex + 1}</td>
                <td class="px-4 py-2 text-on-surface-variant/80">
                  {ACTION_LABELS[answer.expectedAction as ModerationAction]?.() ?? answer.expectedAction}
                  {#if answer.expectedMinutes}<span class="text-on-surface-variant/40"> · {answer.expectedMinutes} min</span>{/if}
                </td>
                <td class="px-4 py-2 {answer.correct ? 'text-emerald-300' : answer.partiallyCorrect ? 'text-amber-300' : 'text-red-300'}">
                  {answer.chosenAction
                    ? (ACTION_LABELS[answer.chosenAction as ModerationAction]?.() ?? answer.chosenAction)
                    : m.sm_session_no_answer()}
                  {#if answer.chosenMinutes}<span class="opacity-60"> · {answer.chosenMinutes} min</span>{/if}
                </td>
                <td class="px-4 py-2 text-right text-on-surface-variant/70">{answer.points}/{answer.maxPoints}</td>
                <td class="px-4 py-2 text-on-surface-variant/60">{answer.reason}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

  {:else}
    {#if sessions.length === 0}
      <div class="p-10 text-center text-sm text-on-surface-variant/50 rounded-2xl bg-surface-container-high/30">
        {m.sm_sessions_empty()}
      </div>
    {:else}
      <ul class="space-y-2">
        {#each sessions as session (session.id)}
          {@const meta = STATUS_META[session.status] ?? STATUS_META.ABANDONED}
          <li class="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-high/50 text-xs">
            <span class="px-2 py-0.5 rounded font-semibold {meta.color}">{meta.label()}</span>
            <span class="text-on-surface font-medium truncate">{session.traineeName}</span>
            <span class="text-on-surface-variant/60 truncate">{session.scenario.title}</span>
            <span class="font-bold {scoreColor(session.scorePercent)}">{session.scorePercent} %</span>
            <span class="text-on-surface-variant/50">{Math.round(session.averageResponseMs / 1000)} s</span>
            <span class="text-on-surface-variant/40 ml-auto">{formatDate(session.startedAt)}</span>
            <button
              onclick={() => openSessionDetail(session.id)}
              class="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-surface-container-highest text-on-surface-variant/70 hover:text-on-surface"
            >{m.sm_session_detail()}</button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</ModulePage>
