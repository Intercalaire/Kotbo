<script lang="ts">
  /**
   * Ascend — pilotage du classement compétitif.
   *
   * Le module se greffe sur le leveling : les gains de RP dérivent de l'XP
   * réellement accordée, d'où l'absence ici de tout réglage de cooldown ou
   * d'exclusion de salon, qui vivent sur la page Niveaux.
   */
  import { onMount } from 'svelte';
  import {
    fetchRankedOverview,
    updateRankedConfig,
    setRankedTierRole,
    removeRankedTierRole,
    createRankedEvent,
    cancelRankedEvent,
    previewRankedDecay,
    runRankedDecay,
  } from '../lib/api';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import SectionCard from '../lib/components/SectionCard.svelte';
  import MetricCard from '../lib/components/MetricCard.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';
  import UserDisplay from '../lib/components/UserDisplay.svelte';
  import EmptyState from '../lib/components/EmptyState.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import { m } from '../lib/i18n';

  type Tier = { key: string; tier: string; division: number; name: string; minRp: number; color: string };
  type LeaderboardEntry = { rank: number; userId: string; rp: number; tier: Tier; streakDays: number; flames: number; percent: number };
  type StreakEntry = { rank: number; userId: string; streakDays: number; bestStreak: number; flames: number };
  type RankedEvent = {
    id: string;
    type: string;
    name: string;
    multiplier: number;
    startsAt: string;
    endsAt: string;
    status: string;
    participants: number;
    bonusRpGranted: number;
  };

  let loading = $state(true);
  let saving = $state(false);
  let config = $state<Record<string, any> | null>(null);
  let ladder = $state<Tier[]>([]);
  let tierRoles = $state<Array<{ tierKey: string; roleId: string }>>([]);
  let stats = $state<any>(null);
  let leaderboard = $state<LeaderboardEntry[]>([]);
  let streaks = $state<StreakEntry[]>([]);
  let events = $state<RankedEvent[]>([]);
  let decayPreview = $state<{ affected: number; rpLost: number } | null>(null);

  let showEventForm = $state(false);
  let newEvent = $state({ type: 'MESSAGE_RUSH', name: '', multiplier: 2, durationMinutes: 60, announceChannelId: '' });

  const channels = $derived((dashboardStore.state.discordChannels ?? []) as Array<{ id: string; name: string }>);
  const roles = $derived((dashboardStore.state.discordRoles ?? []) as Array<{ id: string; name: string; color?: number }>);

  const EVENT_TYPES = [
    { value: 'MESSAGE_RUSH', label: 'Message Rush' },
    { value: 'REACTION_STORM', label: 'Reaction Storm' },
    { value: 'VOCAL_TIME', label: 'Vocal Time' },
    { value: 'CUSTOM', label: 'Custom' },
  ];

  function roleFor(tierKey: string): string | null {
    return tierRoles.find((mapping) => mapping.tierKey === tierKey)?.roleId ?? null;
  }

  function statusLabel(status: string): string {
    if (status === 'RUNNING') return m.asc_event_status_running();
    if (status === 'SCHEDULED') return m.asc_event_status_scheduled();
    if (status === 'CANCELLED') return m.asc_event_status_cancelled();
    return m.asc_event_status_ended();
  }

  function statusClass(status: string): string {
    if (status === 'RUNNING') return 'bg-emerald-500/10 text-emerald-500';
    if (status === 'SCHEDULED') return 'bg-primary/10 text-primary';
    if (status === 'CANCELLED') return 'bg-rose-500/10 text-rose-500';
    return 'bg-surface-container-high/40 text-on-surface-variant';
  }

  async function load() {
    loading = true;
    try {
      const data: any = await fetchRankedOverview();
      config = data.config;
      ladder = data.ladder ?? [];
      tierRoles = data.tierRoles ?? [];
      stats = data.stats;
      leaderboard = data.leaderboard ?? [];
      streaks = data.streaks ?? [];
      events = data.events ?? [];
    } catch {
      toast.error(m.asc_load_error());
    } finally {
      loading = false;
    }
  }

  /**
   * Envoie un correctif partiel. Le champ local est déjà à jour (bind), donc en
   * cas d'échec on recharge : laisser l'écran afficher une valeur que le
   * serveur a refusée est pire que le clignotement du rechargement.
   */
  async function patch(changes: Record<string, unknown>) {
    saving = true;
    try {
      const result: any = await updateRankedConfig(changes);
      config = result.config;
      toast.success(m.asc_saved());
    } catch {
      toast.error(m.asc_save_error());
      await load();
    } finally {
      saving = false;
    }
  }

  async function bindRole(tierKey: string, roleId: string) {
    try {
      if (!roleId) {
        await removeRankedTierRole(tierKey);
        tierRoles = tierRoles.filter((mapping) => mapping.tierKey !== tierKey);
      } else {
        await setRankedTierRole(tierKey, roleId);
        tierRoles = [...tierRoles.filter((mapping) => mapping.tierKey !== tierKey), { tierKey, roleId }];
      }
      toast.success(m.asc_saved());
    } catch {
      toast.error(m.asc_save_error());
    }
  }

  async function handlePreviewDecay() {
    try {
      decayPreview = (await previewRankedDecay()) as any;
    } catch {
      toast.error(m.asc_load_error());
    }
  }

  async function handleRunDecay() {
    try {
      const report: any = await runRankedDecay();
      toast.success(m.asc_decay_ran({ affected: report.affected, rpLost: report.rpLost }));
      await load();
    } catch {
      toast.error(m.asc_save_error());
    }
  }

  async function handleCreateEvent() {
    try {
      await createRankedEvent({
        type: newEvent.type,
        name: newEvent.name || EVENT_TYPES.find((t) => t.value === newEvent.type)?.label || newEvent.type,
        multiplier: newEvent.multiplier,
        durationMinutes: newEvent.durationMinutes,
        announceChannelId: newEvent.announceChannelId || undefined,
      });
      showEventForm = false;
      newEvent = { type: 'MESSAGE_RUSH', name: '', multiplier: 2, durationMinutes: 60, announceChannelId: '' };
      toast.success(m.asc_event_created());
      await load();
    } catch {
      toast.error(m.asc_save_error());
    }
  }

  async function handleCancelEvent(eventId: string) {
    try {
      await cancelRankedEvent(eventId);
      toast.success(m.asc_event_cancelled());
      await load();
    } catch {
      toast.error(m.asc_save_error());
    }
  }

  onMount(load);
</script>

<ModulePage
  title={m.asc_page_title()}
  description={m.asc_page_desc()}
  icon="trophy"
  featureKey="leveling"
>
  {#if loading}
    <LoadingHint context="config" />
  {:else if config}
    <!-- ==================== EN-TÊTE CHIFFRÉ ==================== -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <MetricCard label={m.asc_stat_ranked()} value={stats?.rankedMembers ?? 0} icon="users" />
      <MetricCard
        label={m.asc_stat_streaks()}
        value={stats?.activeStreaks ?? 0}
        icon="activity"
        toneClass="bg-amber-500/10 text-amber-500"
      />
      <MetricCard
        label={m.asc_stat_total_rp()}
        value={(stats?.totalRp ?? 0).toLocaleString()}
        icon="chart"
        toneClass="bg-emerald-500/10 text-emerald-500"
      />
      <MetricCard
        label={m.asc_stat_best_streak()}
        value={stats?.bestStreak ?? 0}
        icon="crown"
        toneClass="bg-pink-500/10 text-pink-500"
      />
    </div>

    <!-- ==================== GAINS ==================== -->
    <SectionCard title={m.asc_section_gains()} description={m.asc_section_gains_hint()} icon="chart">
      <div class="space-y-4">
        <label class="flex items-center justify-between gap-4">
          <span class="text-[13px] font-medium text-on-surface">{m.asc_field_enabled()}</span>
          <ToggleSwitch checked={config.enabled} disabled={saving} onToggle={(v) => patch({ enabled: v })} />
        </label>

        <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <label class="block">
            <span class="field-label">{m.asc_field_rp_per_xp()}</span>
            <input
              type="number" step="0.05" min="0" max="10"
              bind:value={config.rpPerXp}
              onchange={() => patch({ rpPerXp: Number(config?.rpPerXp) })}
              class="ascend-input"
            />
          </label>
          <label class="block">
            <span class="field-label">{m.asc_field_reaction_rp()}</span>
            <input
              type="number" min="0" max="100"
              bind:value={config.reactionRp}
              onchange={() => patch({ reactionRp: Number(config?.reactionRp) })}
              class="ascend-input"
            />
          </label>
          <label class="block">
            <span class="field-label">{m.asc_field_reaction_cap()}</span>
            <input
              type="number" min="0" max="500"
              bind:value={config.reactionDailyCap}
              onchange={() => patch({ reactionDailyCap: Number(config?.reactionDailyCap) })}
              class="ascend-input"
            />
          </label>
          <label class="block">
            <span class="field-label">{m.asc_field_daily_cap()}</span>
            <input
              type="number" min="0"
              bind:value={config.dailyRpCap}
              onchange={() => patch({ dailyRpCap: Number(config?.dailyRpCap) })}
              class="ascend-input"
            />
          </label>
        </div>

        <div class="grid sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="field-label">{m.asc_field_announce_channel()}</span>
            <select
              bind:value={config.announceChannelId}
              onchange={() => patch({ announceChannelId: config?.announceChannelId ?? null })}
              class="ascend-input"
            >
              <option value={null}>—</option>
              {#each channels as channel (channel.id)}
                <option value={channel.id}>#{channel.name}</option>
              {/each}
            </select>
          </label>

          <div class="space-y-2 sm:pt-6">
            <label class="flex items-center justify-between gap-4">
              <span class="text-[13px] text-on-surface-variant">{m.asc_field_announce_promotions()}</span>
              <ToggleSwitch checked={config.announcePromotions} size="sm" onToggle={(v) => patch({ announcePromotions: v })} />
            </label>
            <label class="flex items-center justify-between gap-4">
              <span class="text-[13px] text-on-surface-variant">{m.asc_field_announce_demotions()}</span>
              <ToggleSwitch checked={config.announceDemotions} size="sm" onToggle={(v) => patch({ announceDemotions: v })} />
            </label>
            <label class="flex items-center justify-between gap-4">
              <span class="text-[13px] text-on-surface-variant">{m.asc_field_global()}</span>
              <ToggleSwitch checked={config.globalLeaderboard} size="sm" onToggle={(v) => patch({ globalLeaderboard: v })} />
            </label>
          </div>
        </div>
      </div>
    </SectionCard>

    <!-- ==================== SÉRIES ==================== -->
    <SectionCard title={m.asc_section_streaks()} description={m.asc_section_streaks_hint()} icon="activity">
      <div class="space-y-4">
        <label class="flex items-center justify-between gap-4">
          <span class="text-[13px] font-medium text-on-surface">{m.asc_field_streak_enabled()}</span>
          <ToggleSwitch checked={config.streakEnabled} onToggle={(v) => patch({ streakEnabled: v })} />
        </label>

        <div class="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <label class="block">
            <span class="field-label">{m.asc_field_streak_bonus()}</span>
            <input
              type="number" min="0" max="100"
              value={Math.round((config.streakBonusPerDay ?? 0) * 100)}
              onchange={(e) => patch({ streakBonusPerDay: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
              class="ascend-input"
            />
          </label>
          <label class="block">
            <span class="field-label">{m.asc_field_streak_max()}</span>
            <input
              type="number" min="0" max="500"
              value={Math.round((config.streakMaxBonus ?? 0) * 100)}
              onchange={(e) => patch({ streakMaxBonus: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
              class="ascend-input"
            />
          </label>
          <label class="block">
            <span class="field-label">{m.asc_field_streak_grace()}</span>
            <input
              type="number" min="0" max="7"
              bind:value={config.streakGraceDays}
              onchange={() => patch({ streakGraceDays: Number(config?.streakGraceDays) })}
              class="ascend-input"
            />
          </label>
          <label class="block">
            <span class="field-label">{m.asc_field_streak_weekly_freezes()}</span>
            <input
              type="number" min="0" max="7"
              bind:value={config.streakWeeklyFreezes}
              onchange={() => patch({ streakWeeklyFreezes: Number(config?.streakWeeklyFreezes) })}
              class="ascend-input"
            />
          </label>
          <label class="block">
            <span class="field-label">{m.asc_field_streak_max_freezes()}</span>
            <input
              type="number" min="0" max="14"
              bind:value={config.streakMaxFreezes}
              onchange={() => patch({ streakMaxFreezes: Number(config?.streakMaxFreezes) })}
              class="ascend-input"
            />
          </label>
        </div>
      </div>
    </SectionCard>

    <!-- ==================== DECAY ==================== -->
    <SectionCard title={m.asc_section_decay()} description={m.asc_section_decay_hint()} icon="arrow-down">
      <div class="space-y-4">
        <label class="flex items-center justify-between gap-4">
          <span class="text-[13px] font-medium text-on-surface">{m.asc_field_decay_enabled()}</span>
          <ToggleSwitch checked={config.decayEnabled} onToggle={(v) => patch({ decayEnabled: v })} />
        </label>

        <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <label class="block">
            <span class="field-label">{m.asc_field_decay_grace()}</span>
            <input
              type="number" min="0" max="60"
              bind:value={config.decayGraceDays}
              onchange={() => patch({ decayGraceDays: Number(config?.decayGraceDays) })}
              class="ascend-input"
            />
          </label>
          <label class="block">
            <span class="field-label">{m.asc_field_decay_rp()}</span>
            <input
              type="number" min="0"
              bind:value={config.decayRpPerDay}
              onchange={() => patch({ decayRpPerDay: Number(config?.decayRpPerDay) })}
              class="ascend-input"
            />
          </label>
          <label class="block">
            <span class="field-label">{m.asc_field_decay_percent()}</span>
            <input
              type="number" min="0" max="50"
              value={Math.round((config.decayPercentPerDay ?? 0) * 100)}
              onchange={(e) => patch({ decayPercentPerDay: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
              class="ascend-input"
            />
          </label>
          <label class="block">
            <span class="field-label">{m.asc_field_decay_floor()}</span>
            <select
              bind:value={config.decayFloorTierKey}
              onchange={() => patch({ decayFloorTierKey: config?.decayFloorTierKey ?? null })}
              class="ascend-input"
            >
              <option value={null}>{m.asc_decay_floor_none()}</option>
              {#each ladder as tier (tier.key)}
                <option value={tier.key}>{tier.name}</option>
              {/each}
            </select>
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-2 pt-1">
          <button class="px-3 py-1.5 rounded-lg bg-surface-container-high/40 text-on-surface-variant text-xs font-bold" onclick={handlePreviewDecay}>
            {m.asc_btn_preview_decay()}
          </button>
          <button class="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-500 text-xs font-bold" onclick={handleRunDecay}>
            {m.asc_btn_run_decay()}
          </button>
          {#if decayPreview}
            <span class="text-xs text-on-surface-variant">
              {m.asc_decay_preview({ affected: decayPreview.affected, rpLost: decayPreview.rpLost })}
            </span>
          {/if}
        </div>
      </div>
    </SectionCard>

    <!-- ==================== PALIERS & RÔLES ==================== -->
    <SectionCard title={m.asc_section_ladder()} description={m.asc_ladder_hint()} icon="shield">
      <div class="space-y-4">
        <div class="grid sm:grid-cols-2 gap-2">
          <label class="flex items-center justify-between gap-4">
            <span class="text-[13px] text-on-surface-variant">{m.asc_field_tier_roles_enabled()}</span>
            <ToggleSwitch checked={config.tierRolesEnabled} size="sm" onToggle={(v) => patch({ tierRolesEnabled: v })} />
          </label>
          <label class="flex items-center justify-between gap-4">
            <span class="text-[13px] text-on-surface-variant">{m.asc_field_tier_roles_exclusive()}</span>
            <ToggleSwitch checked={config.tierRolesExclusive} size="sm" onToggle={(v) => patch({ tierRolesExclusive: v })} />
          </label>
        </div>

        <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {#each ladder as tier (tier.key)}
            <div class="flex items-center gap-3 rounded-lg border border-outline-variant/20 bg-surface-container-low/30 px-3 py-2">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:{tier.color}"></span>
              <div class="min-w-0 flex-1">
                <p class="text-[13px] font-semibold text-on-surface truncate">{tier.name}</p>
                <p class="text-[11px] text-on-surface-variant">{tier.minRp.toLocaleString()} RP</p>
              </div>
              <select
                value={roleFor(tier.key) ?? ''}
                onchange={(e) => bindRole(tier.key, (e.currentTarget as HTMLSelectElement).value)}
                class="ascend-input mt-0! max-w-[45%]"
              >
                <option value="">{m.asc_ladder_no_role()}</option>
                {#each roles as role (role.id)}
                  <option value={role.id}>{role.name}</option>
                {/each}
              </select>
            </div>
          {/each}
        </div>
      </div>
    </SectionCard>

    <!-- ==================== ÉVÉNEMENTS ==================== -->
    <SectionCard title={m.asc_section_events()} description={m.asc_events_hint()} icon="zap">
      {#snippet actions()}
        <button
          class="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold flex items-center gap-1.5"
          onclick={() => (showEventForm = !showEventForm)}
        >
          <Papicon icon="plus" size={14} />
          {m.asc_btn_new_event()}
        </button>
      {/snippet}

      <div class="space-y-4">
        {#if showEventForm}
          <div class="rounded-lg border border-outline-variant/20 bg-surface-container-low/30 p-4 space-y-3">
            <div class="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
              <label class="block">
                <span class="field-label">{m.asc_event_type()}</span>
                <select bind:value={newEvent.type} class="ascend-input">
                  {#each EVENT_TYPES as type (type.value)}
                    <option value={type.value}>{type.label}</option>
                  {/each}
                </select>
              </label>
              <label class="block">
                <span class="field-label">{m.asc_event_name()}</span>
                <input type="text" bind:value={newEvent.name} class="ascend-input" />
              </label>
              <label class="block">
                <span class="field-label">{m.asc_event_multiplier()}</span>
                <input type="number" min="1" max="10" step="0.5" bind:value={newEvent.multiplier} class="ascend-input" />
              </label>
              <label class="block">
                <span class="field-label">{m.asc_event_duration()}</span>
                <input type="number" min="5" max="1440" bind:value={newEvent.durationMinutes} class="ascend-input" />
              </label>
              <label class="block">
                <span class="field-label">{m.asc_event_channel()}</span>
                <select bind:value={newEvent.announceChannelId} class="ascend-input">
                  <option value="">—</option>
                  {#each channels as channel (channel.id)}
                    <option value={channel.id}>#{channel.name}</option>
                  {/each}
                </select>
              </label>
            </div>
            <div class="flex justify-end gap-2">
              <button class="px-3 py-1.5 rounded-lg bg-surface-container-high/40 text-on-surface-variant text-xs font-bold" onclick={() => (showEventForm = false)}>
                {m.asc_btn_cancel()}
              </button>
              <button class="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold" onclick={handleCreateEvent}>
                {m.asc_btn_create()}
              </button>
            </div>
          </div>
        {/if}

        {#if events.length === 0}
          <EmptyState icon="zap" title={m.asc_event_empty()} />
        {:else}
          <div class="space-y-1">
            {#each events as event (event.id)}
              <div class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-container-high/10">
                <span class="px-2 py-0.5 rounded-full text-[11px] font-medium {statusClass(event.status)}">{statusLabel(event.status)}</span>
                <div class="min-w-0 flex-1">
                  <p class="text-[13px] font-semibold text-on-surface truncate">{event.name} · ×{event.multiplier}</p>
                  <p class="text-[11px] text-on-surface-variant">
                    {new Date(event.startsAt).toLocaleString()} → {new Date(event.endsAt).toLocaleString()}
                  </p>
                </div>
                <span class="text-[11px] text-on-surface-variant hidden sm:block">
                  {m.asc_event_result({ participants: event.participants, bonus: event.bonusRpGranted })}
                </span>
                {#if event.status === 'SCHEDULED' || event.status === 'RUNNING'}
                  <button class="text-[11px] font-bold text-rose-500" onclick={() => handleCancelEvent(event.id)}>
                    {m.asc_btn_cancel_event()}
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </SectionCard>

    <!-- ==================== CLASSEMENTS ==================== -->
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <SectionCard title={m.asc_section_leaderboard()} icon="crown">
        {#if leaderboard.length === 0}
          <EmptyState icon="crown" title={m.asc_leaderboard_empty()} />
        {:else}
          <div class="space-y-0.5">
            {#each leaderboard as entry (entry.userId)}
              <div class="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-container-high/10">
                <span class="w-7 text-right text-[13px] font-semibold text-on-surface-variant">#{entry.rank}</span>
                <UserDisplay userId={entry.userId} size="sm" class="min-w-0 flex-1" />
                <span class="px-2 py-0.5 rounded-full text-[11px] font-medium" style="background:{entry.tier.color}22;color:{entry.tier.color}">
                  {entry.tier.name}
                </span>
                <span class="text-[12px] font-mono text-on-surface-variant w-16 text-right">{entry.rp.toLocaleString()}</span>
              </div>
            {/each}
          </div>
        {/if}
      </SectionCard>

      <SectionCard title={m.asc_section_streak_board()} icon="activity">
        {#if streaks.length === 0}
          <EmptyState icon="activity" title={m.asc_streak_board_empty()} />
        {:else}
          <div class="space-y-0.5">
            {#each streaks as entry (entry.userId)}
              <div class="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-container-high/10">
                <span class="w-7 text-right text-[13px] font-semibold text-on-surface-variant">#{entry.rank}</span>
                <UserDisplay userId={entry.userId} size="sm" class="min-w-0 flex-1" />
                <span class="text-[13px]">{'🔥'.repeat(Math.max(1, entry.flames))}</span>
                <span class="text-[12px] font-mono text-on-surface-variant w-14 text-right">
                  {m.asc_streak_days({ days: entry.streakDays })}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </SectionCard>
    </div>
  {/if}
</ModulePage>

<style>
  .ascend-input {
    margin-top: 0.25rem;
    width: 100%;
    border-radius: 0.5rem;
    background: var(--surface-container, rgba(255, 255, 255, 0.04));
    border: 1px solid rgb(from var(--outline-variant, #444) r g b / 40%);
    padding: 0.5rem 0.75rem;
    font-size: 13px;
    color: var(--on-surface, inherit);
  }
</style>
