<script lang="ts">
  /**
   * La Tour de clan : une tour à part, ouverte chaque semaine, que les clans du serveur
   * gravissent chacun de leur côté. Réglages, étages (le même éditeur que la Tour) et
   * classement de la semaine en cours.
   */
  import { onMount } from 'svelte';
  import { m } from '../../i18n';
  import { channelDisplayName } from '../../channelUtils';
  import { dashboardStore } from '../../stores/dashboard.svelte';
  import { createAsyncActionState } from '../../asyncAction.svelte';
  import { fetchRpgClanTower, saveRpgClanTowerLayout, saveRpgClanTowerSettings } from '../../api';
  import Papicon from '../Papicon.svelte';
  import InlineFeedback from '../InlineFeedback.svelte';
  import SearchableSelect from '../SearchableSelect.svelte';
  import ToggleSwitch from '../ToggleSwitch.svelte';
  import RpgTowerMapEditor from './RpgTowerMapEditor.svelte';

  type Foe = { name: string; emoji: string; isBoss: boolean; enabled: boolean };
  type Settings = {
    enabled: boolean;
    name: string;
    floorsAfter: 'GENERATE' | 'LOOP';
    generatedFog: boolean;
    weekday: number;
    hour: number;
    durationHours: number;
    pointsPerFloor: number;
    podiumPoints: number[];
    milestones: number[];
    announceChannelId: string | null;
    floors?: any[];
  };
  type Standing = {
    clanId: string;
    name: string;
    floors: number;
    rank: number;
    climbers: { userId: string; floors: number; displayName?: string }[];
    totalFloors?: number;
    milestones?: number;
  };
  type Award = { clanId: string; name: string; rank: number; floors: number; total: number };

  const {
    canManage = false,
    disabled = false,
    foes = [],
    limits = {},
    growthPercent = 8,
  }: {
    canManage?: boolean;
    disabled?: boolean;
    foes?: Foe[];
    limits?: { mapSize?: { min: number; max: number }; mapRoomsMax?: number; floorsMax?: number };
    growthPercent?: number;
  } = $props();

  const DEFAULTS: Settings = {
    enabled: false,
    name: 'Tour de clan',
    floorsAfter: 'GENERATE',
    generatedFog: true,
    weekday: 6,
    hour: 18,
    durationHours: 48,
    pointsPerFloor: 10,
    podiumPoints: [150, 100, 50],
    milestones: [10, 25, 50],
    announceChannelId: null,
  };

  /** Bonus des paliers collectifs, dans l'ordre (mêmes valeurs que `CLAN_TOWER_MILESTONE_BONUSES` côté bot). */
  const MILESTONE_BONUSES = [
    () => m.eco_clan_tower_milestone_bonus_1(),
    () => m.eco_clan_tower_milestone_bonus_2(),
    () => m.eco_clan_tower_milestone_bonus_3(),
  ];

  const WEEKDAYS = [
    () => m.eco_clan_tower_day_0(), () => m.eco_clan_tower_day_1(), () => m.eco_clan_tower_day_2(), () => m.eco_clan_tower_day_3(),
    () => m.eco_clan_tower_day_4(), () => m.eco_clan_tower_day_5(), () => m.eco_clan_tower_day_6(),
  ];

  const actionState = createAsyncActionState();
  let settings = $state<Settings>({ ...DEFAULTS, podiumPoints: [...DEFAULTS.podiumPoints], milestones: [...DEFAULTS.milestones] });
  let clansEnabled = $state(true);
  let current = $state<{ startsAt: string; endsAt: string; standings: Standing[] } | null>(null);
  let last = $state<{ endsAt: string; results: { awards?: Award[] } | null } | null>(null);
  let nextOpensAt = $state<string | null>(null);
  let loading = $state(true);
  let mapVersion = $state(0);

  const channels = $derived(((dashboardStore.state.discordChannels ?? []) as any[]).map((channel) => ({ id: channel.id, name: channelDisplayName(channel) })));

  const inputClass = 'w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2.5 text-xs focus:outline-none disabled:opacity-60';
  const labelClass = 'text-xs font-semibold text-on-surface-variant/60 ml-2';
  const cardClass = 'bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6';

  function when(value: string | null | undefined): string {
    return value ? new Date(value).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '—';
  }

  async function load() {
    loading = true;
    try {
      const res = await fetchRpgClanTower();
      if (res) {
        const loaded = res.settings ?? {};
        settings = {
          ...DEFAULTS,
          ...loaded,
          podiumPoints: [...(loaded.podiumPoints ?? DEFAULTS.podiumPoints)],
          milestones: [...(loaded.milestones ?? DEFAULTS.milestones)],
        };
        clansEnabled = res.clansEnabled !== false;
        current = res.current ?? null;
        last = res.last ?? null;
        nextOpensAt = res.nextOpensAt ?? null;
        mapVersion += 1;
      }
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => { void load(); });

  async function save() {
    const payload: Record<string, unknown> = {
      ...settings,
      podiumPoints: settings.podiumPoints.map((value) => Number(value) || 0),
      milestones: settings.milestones.map((value) => Number(value) || 0),
    };
    delete payload.floors;
    await actionState.run(async () => {
      await saveRpgClanTowerSettings(payload);
      await load();
      return true;
    });
  }
</script>

<div class="space-y-6">
  {#if !clansEnabled}
    <p class="text-xs flex items-start gap-2 bg-warning/10 border border-warning/20 text-warning rounded-lg px-3 py-2">
      <Papicon icon="AlertTriangle" size={13} /> {m.eco_clan_tower_clans_off()}
    </p>
  {/if}

  <!-- Semaine en cours, ou prochaine ouverture -->
  <div class={cardClass}>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-2">
      <div>
        <h4 class="text-sm font-bold flex items-center gap-2"><Papicon icon="Trophy" size={14} /> {m.eco_clan_tower_current_title()}</h4>
        <p class="text-2xs text-on-surface-variant/60 mt-1">
          {#if current}
            {m.eco_clan_tower_current_until({ end: when(current.endsAt) })}
          {:else if settings.enabled}
            {m.eco_clan_tower_next({ start: when(nextOpensAt) })}
          {:else}
            {m.eco_clan_tower_off()}
          {/if}
        </p>
      </div>
    </div>
    {#if current}
      {#if current.standings.length > 0}
        <ol class="space-y-1.5 text-xs">
          {#each current.standings as standing (standing.clanId)}
            <li class="flex items-center justify-between gap-3 bg-surface-container-high/30 rounded-lg px-3 py-2">
              <span class="flex items-center gap-2 min-w-0">
                <span class="font-mono text-on-surface-variant/60 w-6">{standing.rank}.</span>
                <span class="font-semibold truncate">{standing.name}</span>
              </span>
              <span class="flex items-center gap-3 shrink-0">
                {#if standing.totalFloors !== undefined}<span class="text-2xs text-on-surface-variant/60" title={m.eco_clan_tower_total_tip()}>{m.eco_clan_tower_total({ floors: standing.totalFloors, reached: standing.milestones ?? 0 })}</span>{/if}
                {#if standing.climbers[0]}<span class="text-2xs text-on-surface-variant/60">{standing.climbers[0].displayName ?? standing.climbers[0].userId} · {standing.climbers[0].floors}</span>{/if}
                <span class="font-bold">{m.eco_tower_milestone_floor({ floor: standing.floors })}</span>
              </span>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="text-xs text-on-surface-variant/50">{m.eco_clan_tower_no_conquest()}</p>
      {/if}
    {/if}
    {#if last?.results?.awards && last.results.awards.length > 0}
      <div class="pt-4 border-t border-outline-variant/10 space-y-1.5">
        <p class="text-xs font-semibold">{m.eco_clan_tower_last_title({ end: when(last.endsAt) })}</p>
        {#each last.results.awards.slice(0, 5) as award (award.clanId)}
          <p class="text-2xs text-on-surface-variant/70">{award.rank}. <span class="font-semibold">{award.name}</span> · {m.eco_tower_milestone_floor({ floor: award.floors })} · +{award.total}</p>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Réglages -->
  <div class={cardClass}>
    <div class="flex items-center justify-between gap-4 border-b border-outline-variant/15 pb-4">
      <div>
        <h4 class="text-sm font-bold">{m.eco_clan_tower_title()}</h4>
        <p class="text-2xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-2xl">{m.eco_clan_tower_desc()}</p>
      </div>
      <ToggleSwitch checked={settings.enabled} disabled={!canManage || disabled} ariaLabel={m.eco_clan_tower_title()} onToggle={(value: boolean) => { settings.enabled = value; }} />
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="space-y-1">
        <label for="clanTowerName" class={labelClass}>{m.eco_clan_tower_name()}</label>
        <input id="clanTowerName" type="text" maxlength="40" bind:value={settings.name} disabled={!canManage || disabled} class={inputClass} />
      </div>
      <div class="space-y-1" title={m.eco_clan_tower_announce_hint()}>
        <span class={labelClass}>{m.eco_tower_announce_channel()}</span>
        <SearchableSelect
          value={settings.announceChannelId}
          options={channels}
          placeholder={m.eco_tower_announce_none()}
          clearable={true}
          className="w-full"
          on:change={(e: any) => { settings.announceChannelId = e.detail?.value ?? null; }}
        />
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="space-y-1">
        <label for="clanTowerDay" class={labelClass}>{m.eco_clan_tower_weekday()}</label>
        <select id="clanTowerDay" bind:value={settings.weekday} disabled={!canManage || disabled} class={inputClass}>
          {#each WEEKDAYS as label, index}<option value={index}>{label()}</option>{/each}
        </select>
      </div>
      <div class="space-y-1">
        <label for="clanTowerHour" class={labelClass}>{m.eco_clan_tower_hour()}</label>
        <input id="clanTowerHour" type="number" min="0" max="23" bind:value={settings.hour} disabled={!canManage || disabled} class={inputClass} />
      </div>
      <div class="space-y-1" title={m.eco_clan_tower_duration_hint()}>
        <label for="clanTowerDuration" class={labelClass}>{m.eco_clan_tower_duration()}</label>
        <input id="clanTowerDuration" type="number" min="24" max="96" step="24" bind:value={settings.durationHours} disabled={!canManage || disabled} class={inputClass} />
      </div>
    </div>
    <p class="text-2xs text-on-surface-variant/50 leading-relaxed ml-2">{m.eco_clan_tower_attempts_hint()}</p>

    <div class="space-y-3 pt-2 border-t border-outline-variant/5">
      <h4 class="text-sm font-bold">{m.eco_clan_tower_points_title()}</h4>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="space-y-1" title={m.eco_clan_tower_per_floor_hint()}>
          <label for="clanTowerPerFloor" class={labelClass}>{m.eco_clan_tower_per_floor()}</label>
          <input id="clanTowerPerFloor" type="number" min="0" max="1000" bind:value={settings.pointsPerFloor} disabled={!canManage || disabled} class={inputClass} />
        </div>
        {#each [0, 1, 2] as index}
          <div class="space-y-1">
            <label for="clanTowerPodium{index}" class={labelClass}>{m.eco_clan_tower_podium({ rank: index + 1 })}</label>
            <input id="clanTowerPodium{index}" type="number" min="0" max="100000" bind:value={settings.podiumPoints[index]} disabled={!canManage || disabled} class={inputClass} />
          </div>
        {/each}
      </div>
      <p class="text-2xs text-on-surface-variant/50 leading-relaxed ml-2">{m.eco_clan_tower_points_hint()}</p>
    </div>

    <div class="space-y-3 pt-2 border-t border-outline-variant/5">
      <h4 class="text-sm font-bold">{m.eco_clan_tower_milestones_title()}</h4>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        {#each [0, 1, 2] as index}
          <div class="space-y-1">
            <label for="clanTowerMilestone{index}" class={labelClass}>{m.eco_clan_tower_milestone({ rank: index + 1, bonus: MILESTONE_BONUSES[index]() })}</label>
            <input id="clanTowerMilestone{index}" type="number" min="1" max="10000" bind:value={settings.milestones[index]} disabled={!canManage || disabled} class={inputClass} />
          </div>
        {/each}
      </div>
      <p class="text-2xs text-on-surface-variant/50 leading-relaxed ml-2">{m.eco_clan_tower_milestones_hint()}</p>
    </div>

    <div class="space-y-3 pt-2 border-t border-outline-variant/5">
      <p class={labelClass}>{m.eco_tower_floors_after()}</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        {#each [
          { value: 'GENERATE' as const, title: m.eco_tower_floors_after_generate(), desc: m.eco_tower_floors_after_generate_desc() },
          { value: 'LOOP' as const, title: m.eco_tower_floors_after_loop(), desc: m.eco_tower_floors_after_loop_desc() },
        ] as option}
          <button type="button" disabled={!canManage || disabled} onclick={() => { settings.floorsAfter = option.value; }}
            class="text-left p-4 rounded-xl border transition-all {settings.floorsAfter === option.value ? 'border-primary bg-primary/10' : 'border-outline-variant/10 bg-surface-container-high/30 hover:border-outline-variant/30'}">
            <p class="text-xs font-bold">{option.title}</p>
            <p class="text-2xs text-on-surface-variant/60 mt-1 leading-relaxed">{option.desc}</p>
          </button>
        {/each}
      </div>
      <div class="flex items-center justify-between gap-4">
        <p class="text-xs font-semibold flex items-center gap-2"><Papicon icon="Eye" size={12} /> {m.eco_tower_generated_fog()}</p>
        <ToggleSwitch checked={settings.generatedFog} disabled={!canManage || disabled} ariaLabel={m.eco_tower_generated_fog()} onToggle={(value: boolean) => { settings.generatedFog = value; }} />
      </div>
    </div>

    {#if canManage}
      <div class="flex justify-end">
        <button type="button" onclick={save} disabled={disabled || loading || actionState.state.loading} class="px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary text-body-sm font-medium rounded-lg transition-all disabled:opacity-50">
          {m.eco_clan_tower_save()}
        </button>
      </div>
    {/if}
    <InlineFeedback state={actionState} />
  </div>

  <!-- Étages : le même éditeur que la Tour, enregistré à part -->
  {#key mapVersion}
    <RpgTowerMapEditor
      {canManage}
      {disabled}
      initialFloors={settings.floors ?? []}
      floorsMax={limits.floorsMax ?? 300}
      {growthPercent}
      floorsAfter={settings.floorsAfter}
      {foes}
      sizeLimits={limits.mapSize ?? { min: 3, max: 20 }}
      roomsMax={limits.mapRoomsMax ?? 300}
      saveFloors={(floors) => saveRpgClanTowerLayout({ floors })}
      onSaved={load}
    />
  {/key}
</div>
