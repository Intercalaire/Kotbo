<!--
  « A traiter » : ce qui attend le staff, en tete de l'accueil.

  Une ligne par sujet - appel de ban, ticket sans prise en charge, double compte
  suspecte, salon de logs supprime - avec son compteur et la page ou le regler.
  A cote, pour qui configure, ce qui manque encore au parcours de prise en main.
  Le bloc n'est pas dans la grille personnalisable : c'est la raison d'etre de
  la page, pas un widget qu'on range.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { authStore } from '../../stores/auth.svelte';
  import { subscribeRealtime } from '../../stores/realtime.svelte';
  import { fetchHomeTasks, type HomeTask, type HomeTaskKey, type HomeTasksData } from '../../api';
  import { m, dateLocale } from '../../i18n';
  import Papicon from '../Papicon.svelte';
  import Skeleton from '../Skeleton.svelte';
  import { Button } from '../ui';

  let {
    /** Incremente par la page pour forcer un rechargement (bouton Actualiser). */
    refreshKey = 0,
    /** Nombre de sujets, remonte pour le sous-titre de l'accueil. */
    count = $bindable(0),
  }: { refreshKey?: number; count?: number } = $props();

  /** Au-dela, la liste se replie : dix lignes d'affilee ne se lisent plus. */
  const COLLAPSED_SIZE = 6;
  const SETUP_PREVIEW = 4;

  let data = $state<HomeTasksData | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  let expanded = $state(false);
  let loadedGuildId: string | null = null;

  const TASK_ICON: Record<HomeTaskKey, string> = {
    bot_permissions: 'lock',
    broken_references: 'hash',
    tickets_pending_validation: 'message-square',
    tickets_unclaimed: 'message-square',
    ban_appeals_pending: 'gavel',
    sanction_reports_missing: 'file-text',
    admin_requests_pending: 'shield',
    alt_detections: 'user-check',
    alt_links_pending: 'link',
    absences_pending: 'calendar',
    staff_tasks_mine: 'check-circle',
    polls_unvoted: 'bar-chart',
    meetings_upcoming: 'users',
    recruitment_pending: 'user-plus',
    partner_applications_pending: 'handshake',
    suggestions_pending: 'thumbs-up',
    channel_health_alerts: 'activity',
    workflow_failures: 'git-branch',
  };

  const TASK_TITLE: Record<HomeTaskKey, () => string> = {
    bot_permissions: m.home_task_bot_permissions,
    broken_references: m.home_task_broken_references,
    tickets_pending_validation: m.home_task_tickets_pending_validation,
    tickets_unclaimed: m.home_task_tickets_unclaimed,
    ban_appeals_pending: m.home_task_ban_appeals_pending,
    sanction_reports_missing: m.home_task_sanction_reports_missing,
    admin_requests_pending: m.home_task_admin_requests_pending,
    alt_detections: m.home_task_alt_detections,
    alt_links_pending: m.home_task_alt_links_pending,
    absences_pending: m.home_task_absences_pending,
    staff_tasks_mine: m.home_task_staff_tasks_mine,
    polls_unvoted: m.home_task_polls_unvoted,
    meetings_upcoming: m.home_task_meetings_upcoming,
    recruitment_pending: m.home_task_recruitment_pending,
    partner_applications_pending: m.home_task_partner_applications_pending,
    suggestions_pending: m.home_task_suggestions_pending,
    channel_health_alerts: m.home_task_channel_health_alerts,
    workflow_failures: m.home_task_workflow_failures,
  };

  const SEVERITY_CLASS: Record<HomeTask['severity'], { tile: string; badge: string; label: () => string }> = {
    critical: { tile: 'bg-error/10 text-error', badge: 'bg-error/15 text-error', label: m.home_todo_sev_critical },
    warning: { tile: 'bg-warning/10 text-warning', badge: 'bg-warning/15 text-warning', label: m.home_todo_sev_warning },
    info: { tile: 'bg-primary/10 text-primary', badge: 'bg-surface-container-highest text-on-surface-variant', label: m.home_todo_sev_info },
  };

  const tasks = $derived(data?.tasks ?? []);
  const visibleTasks = $derived(expanded ? tasks : tasks.slice(0, COLLAPSED_SIZE));
  const hiddenCount = $derived(Math.max(0, tasks.length - COLLAPSED_SIZE));
  const setup = $derived(data?.setup ?? null);
  const setupPercent = $derived(setup && setup.total > 0 ? Math.round((setup.done / setup.total) * 100) : 0);

  $effect(() => {
    count = tasks.length;
  });

  async function load(force = false) {
    const guildId = authStore.selectedGuildId;
    if (!guildId || (loading && !force)) return;
    if (loadedGuildId !== guildId) {
      data = null;
      expanded = false;
    }
    loading = true;
    try {
      const result = await fetchHomeTasks(guildId);
      if (authStore.selectedGuildId !== guildId) return;
      if (result) {
        data = result;
        failed = false;
        loadedGuildId = guildId;
      } else if (!data) {
        failed = true;
      }
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // Relire au changement de serveur et a chaque « Actualiser » de la page.
    // `load` lit et ecrit l'etat du bloc : sans `untrack`, l'effet s'abonnerait
    // a `loading` et se relancerait a chaque fin de chargement.
    void refreshKey;
    if (authStore.selectedGuildId) untrack(() => void load(true));
  });

  // Toute ecriture du dashboard peut vider une file : on relit a chaque
  // changement pousse pour ce serveur. Ce qui arrive depuis Discord (un ticket
  // ouvert, un appel depose) n'emet pas toujours d'evenement, d'ou le filet.
  const unsubscribe = subscribeRealtime({
    reasons: '*',
    throttleMs: 5_000,
    fallbackMs: 60_000,
    onUpdate: () => load(),
  });
  onDestroy(unsubscribe);

  const relative = new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto' });

  /** « il y a 3 jours », « dans 2 heures » : la date seule oblige a calculer. */
  function relativeTo(iso: string): string {
    const diff = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(diff);
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (abs < hour) return relative.format(Math.round(diff / minute), 'minute');
    if (abs < day) return relative.format(Math.round(diff / hour), 'hour');
    return relative.format(Math.round(diff / day), 'day');
  }

  /** Duree d'attente sans « il y a » : elle suit « depuis ». */
  function ageOf(iso: string): string {
    const ms = Math.max(0, Date.now() - new Date(iso).getTime());
    const hours = Math.floor(ms / 3_600_000);
    const format = (value: number, unit: 'minute' | 'hour' | 'day') =>
      new Intl.NumberFormat(dateLocale(), { style: 'unit', unit, unitDisplay: 'short' }).format(value);
    if (hours < 1) return format(Math.max(1, Math.floor(ms / 60_000)), 'minute');
    if (hours < 24) return format(hours, 'hour');
    return format(Math.floor(hours / 24), 'day');
  }

  function detailOf(task: HomeTask): string {
    const parts: string[] = [];
    if (task.mine && task.key !== 'staff_tasks_mine' && task.key !== 'polls_unvoted') {
      parts.push(m.home_todo_mine({ n: task.mine }));
    }
    if (task.oldestAt) parts.push(m.home_todo_oldest({ age: ageOf(task.oldestAt) }));
    const preview = (task.preview ?? [])
      .map((item) => (item.at && (task.key === 'meetings_upcoming' || task.key === 'staff_tasks_mine')
        ? `${item.label} (${relativeTo(item.at)})`
        : item.label))
      .join(' · ');
    if (preview) parts.push(preview);
    return parts.join(' — ');
  }
</script>

<section class="grid grid-cols-1 lg:grid-cols-3 gap-4" aria-labelledby="home-todo-title">
  <div class="section-card p-5 flex flex-col gap-3 {setup ? 'lg:col-span-2' : 'lg:col-span-3'}">
    <div class="flex items-center justify-between gap-3">
      <h2 id="home-todo-title" class="text-base font-semibold text-on-surface flex items-center gap-2">
        {m.home_todo_title()}
        {#if tasks.length > 0}
          <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">{tasks.length}</span>
        {/if}
      </h2>
    </div>

    {#if !data && !failed}
      <div class="flex flex-col gap-2" aria-busy="true">
        {#each Array(3) as _, index (index)}
          <div class="flex items-center gap-3 py-2">
            <Skeleton width="w-9" height="h-9" rounded="rounded-lg" />
            <div class="flex-1 flex flex-col gap-1.5">
              <Skeleton width="w-1/2" height="h-3.5" />
              <Skeleton width="w-3/4" height="h-3" />
            </div>
          </div>
        {/each}
      </div>
    {:else if failed && !data}
      <div class="flex items-center justify-between gap-3 py-2">
        <p class="text-sm text-on-surface-variant">{m.home_todo_error()}</p>
        <Button size="sm" variant="ghost" icon="refresh-cw" onclick={() => load(true)}>{m.home_todo_retry()}</Button>
      </div>
    {:else if tasks.length === 0}
      <div class="flex items-center gap-3 py-2">
        <span class="w-9 h-9 rounded-lg bg-success/10 text-success flex items-center justify-center shrink-0">
          <Papicon icon="check-circle" size={18} />
        </span>
        <div>
          <p class="text-sm font-medium text-on-surface">{m.home_todo_all_clear()}</p>
          <p class="text-xs text-on-surface-variant">{m.home_todo_all_clear_sub()}</p>
        </div>
      </div>
    {:else}
      <ul class="flex flex-col -mx-2">
        {#each visibleTasks as task (task.key)}
          {@const tone = SEVERITY_CLASS[task.severity]}
          {@const detail = detailOf(task)}
          <li>
            <a
              href={task.href}
              class="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-surface-container-high transition-colors group"
            >
              <span class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 {tone.tile}" aria-hidden="true">
                <Papicon icon={TASK_ICON[task.key]} size={18} />
              </span>
              <span class="flex-1 min-w-0">
                <span class="flex items-center gap-2">
                  <span class="text-sm font-medium text-on-surface truncate">{TASK_TITLE[task.key]()}</span>
                  {#if task.severity !== 'info'}
                    <span class="text-2xs font-medium px-1.5 py-0.5 rounded {tone.badge} shrink-0">{tone.label()}</span>
                  {/if}
                </span>
                {#if detail}
                  <span class="block text-xs text-on-surface-variant truncate" title={detail}>{detail}</span>
                {/if}
              </span>
              <span class="text-sm font-semibold tabular-nums text-on-surface shrink-0">{task.count}</span>
              <span class="text-on-surface-variant opacity-60 group-hover:opacity-100 transition-opacity shrink-0" aria-hidden="true">
                <Papicon icon="chevron-right" size={16} />
              </span>
            </a>
          </li>
        {/each}
      </ul>
      {#if hiddenCount > 0}
        <div>
          <Button size="sm" variant="ghost" iconRight={expanded ? '' : 'chevron-down'} onclick={() => (expanded = !expanded)}>
            {expanded ? m.home_todo_show_less() : m.home_todo_show_more({ n: hiddenCount })}
          </Button>
        </div>
      {/if}
    {/if}
  </div>

  {#if setup}
    <div class="section-card p-5 flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-base font-semibold text-on-surface">{m.home_setup_title()}</h2>
        <span class="text-xs text-on-surface-variant">{m.home_setup_progress({ done: setup.done, total: setup.total })}</span>
      </div>
      <div
        class="h-1.5 w-full rounded-full bg-surface-container-highest overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={setup.total}
        aria-valuenow={setup.done}
        aria-label={m.home_setup_progress({ done: setup.done, total: setup.total })}
      >
        <div class="h-full rounded-full bg-primary transition-all" style="width: {setupPercent}%"></div>
      </div>
      <p class="text-xs text-on-surface-variant">{m.home_setup_missing()}</p>
      <ul class="flex flex-col -mx-2">
        {#each setup.missing.slice(0, SETUP_PREVIEW) as gap (gap.key)}
          <li>
            <a href={gap.href} class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-container-high transition-colors text-sm text-on-surface">
              <span class="w-1.5 h-1.5 rounded-full bg-warning shrink-0" aria-hidden="true"></span>
              <span class="flex-1 min-w-0 truncate">{gap.label}{#if gap.detail}<span class="text-on-surface-variant"> · {gap.detail}</span>{/if}</span>
              <Papicon icon="chevron-right" size={14} class="text-on-surface-variant" />
            </a>
          </li>
        {/each}
      </ul>
      {#if setup.missing.length > SETUP_PREVIEW}
        <p class="text-xs text-on-surface-variant">{m.home_setup_more({ n: setup.missing.length - SETUP_PREVIEW })}</p>
      {/if}
      <div class="mt-auto pt-1">
        <Button size="sm" variant="secondary" href="/setup" iconRight="arrow-right">{m.home_setup_continue()}</Button>
      </div>
    </div>
  {/if}
</section>
