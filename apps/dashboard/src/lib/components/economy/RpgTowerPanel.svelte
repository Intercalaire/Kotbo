<script lang="ts">
  /**
   * La Tour : mode roguelite du RPG.
   *
   * Les joueurs y entrent avec des stats compressées (ou remises à zéro) et gagnent des éclats,
   * une monnaie propre à la Tour. Ce panneau règle l'entrée, la difficulté et le rythme des
   * récompenses, gère la boutique d'éclats et les paliers, et ouvre les saisons du classement.
   */
  import { onMount } from 'svelte';
  import { m } from '../../i18n';
  import { confirmDialog } from '../../stores/confirmDialog.svelte';
  import { dashboardStore } from '../../stores/dashboard.svelte';
  import { createAsyncActionState } from '../../asyncAction.svelte';
  import {
    deleteRpgTowerReward,
    fetchRpgItems,
    fetchRpgTitles,
    fetchRpgTower,
    saveRpgTowerReward,
    saveRpgTowerSettings,
    startRpgTowerSeason,
  } from '../../api';
  import Papicon from '../Papicon.svelte';
  import EmojiPicker from '../EmojiPicker.svelte';
  import EmojiText from '../EmojiText.svelte';
  import InlineFeedback from '../InlineFeedback.svelte';
  import SearchableSelect from '../SearchableSelect.svelte';
  import ToggleSwitch from '../ToggleSwitch.svelte';
  import RpgTowerMapEditor from './RpgTowerMapEditor.svelte';

  const { canManage = false, disabled = false, currencyName = '' }: { canManage?: boolean; disabled?: boolean; currencyName?: string } = $props();

  type EntryMode = 'COMPRESSED' | 'RESET';
  type Settings = {
    enabled: boolean;
    name: string;
    emoji: string;
    description: string;
    entryMode: EntryMode;
    inheritCapPercent: number;
    titleCapPercent: number;
    floorGrowthPercent: number;
    bossEvery: number;
    blessingEvery: number;
    maxBlessings: number;
    shardsPerFloor: number;
    deathShardPercent: number;
    weeklyShardCap: number;
    idleTimeoutMinutes: number;
    currencyName: string;
    currencyEmoji: string;
    seasonStartedAt?: string;
    layoutEnabled?: boolean;
    layout?: any;
  };
  type Reward = {
    id: string;
    kind: 'SHOP' | 'MILESTONE';
    name: string;
    description: string;
    emoji: string;
    price: number;
    floor: number;
    repeatable: boolean;
    titleId: string | null;
    roleId: string | null;
    coins: number;
    xp: number;
    clanPoints: number;
    itemName: string | null;
    shards: number;
    enabled: boolean;
  };
  type RewardDraft = Omit<Reward, 'id'> & { id?: string };
  type NumericSetting = { [K in keyof Settings]-?: Settings[K] extends number ? K : never }[keyof Settings];
  type LeaderboardEntry = { userId: string; displayName: string; bestFloor: number; totalRuns: number };

  const DEFAULTS: Settings = {
    enabled: false,
    name: 'La Tour',
    emoji: '🗼',
    description: '',
    entryMode: 'COMPRESSED',
    inheritCapPercent: 50,
    titleCapPercent: 30,
    floorGrowthPercent: 8,
    bossEvery: 10,
    blessingEvery: 5,
    maxBlessings: 6,
    shardsPerFloor: 2,
    deathShardPercent: 50,
    weeklyShardCap: 0,
    idleTimeoutMinutes: 30,
    currencyName: 'Éclats de Tour',
    currencyEmoji: '💠',
  };

  // Mêmes constantes que `rpgTowerPolicy.ts` côté bot : l'aperçu doit dire ce que le jeu fera.
  const BASE_ATTACK = 20;
  const INHERIT_SLOPE = 0.2;
  const MONSTER_BASE_HEALTH = 70;
  const MONSTER_BASE_ATTACK = 13;

  const actionState = createAsyncActionState();
  let loading = $state(true);
  let settings = $state<Settings>({ ...DEFAULTS });
  let rewards = $state<Reward[]>([]);
  let leaderboard = $state<LeaderboardEntry[]>([]);
  let stats = $state({ players: 0, runs: 0, activeRuns: 0, bestFloor: 0 });
  let limits = $state<{ rewardsMax: number; mapSize?: { min: number; max: number }; mapRoomsMax?: number }>({ rewardsMax: 40 });
  let foes = $state<{ name: string; emoji: string; isBoss: boolean; enabled: boolean }[]>([]);
  // Recrée l'éditeur après chaque chargement, pour qu'il reparte de la carte enregistrée.
  let mapVersion = $state(0);
  let titles = $state<{ id: string; name: string }[]>([]);
  let items = $state<{ name: string; emoji: string; guildId: string | null }[]>([]);
  let editing = $state<RewardDraft | null>(null);

  const roles = $derived((dashboardStore.state.discordRoles || []).map((role: any) => ({ id: role.id, name: `@${role.name}` })));
  const titleOptions = $derived(titles.map((title) => ({ id: title.id, name: title.name })));
  // Un objet du serveur masque l'objet livré du même nom, comme dans le jeu.
  const itemOptions = $derived.by(() => {
    const byName = new Map<string, { name: string; emoji: string; guildId: string | null }>();
    for (const item of items) {
      if (!byName.has(item.name) || item.guildId) byName.set(item.name, item);
    }
    return [...byName.values()].map((item) => ({ id: item.name, name: `${item.emoji} ${item.name}` }));
  });
  const shopRewards = $derived(rewards.filter((reward) => reward.kind === 'SHOP'));
  const milestones = $derived(rewards.filter((reward) => reward.kind === 'MILESTONE').sort((a, b) => a.floor - b.floor));

  function towerAttack(mainAttack: number): number {
    const inherited = settings.entryMode === 'COMPRESSED'
      ? Math.min(settings.inheritCapPercent / 100, INHERIT_SLOPE * Math.log10(1 + mainAttack / BASE_ATTACK))
      : 0;
    return Math.round(BASE_ATTACK * (1 + inherited));
  }

  const entryPreview = $derived([20, 2_000, 200_000, 20_000_000].map((main) => ({ main, tower: towerAttack(main) })));
  const floorPreview = $derived([1, 10, 25, 50].map((floor) => {
    const growth = Math.pow(1 + (Number(settings.floorGrowthPercent) || 0) / 100, floor - 1);
    return { floor, health: Math.round(MONSTER_BASE_HEALTH * growth), attack: Math.round(MONSTER_BASE_ATTACK * growth) };
  }));
  const veteranRatio = $derived((towerAttack(20_000_000) / towerAttack(20)).toFixed(2));

  function roleName(roleId: string | null): string | null {
    return roleId ? roles.find((role) => role.id === roleId)?.name ?? roleId : null;
  }

  function titleName(titleId: string | null): string | null {
    return titleId ? titles.find((title) => title.id === titleId)?.name ?? titleId : null;
  }

  async function load() {
    loading = true;
    try {
      const res = await fetchRpgTower();
      if (res) {
        settings = { ...DEFAULTS, ...(res.settings ?? {}) };
        rewards = res.rewards ?? [];
        leaderboard = res.leaderboard ?? [];
        if (res.stats) stats = res.stats;
        if (res.limits) limits = res.limits;
        foes = res.foes ?? [];
        mapVersion += 1;
      }
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    void fetchRpgTitles().then((res) => { if (res?.titles) titles = res.titles; }).catch(console.error);
    void fetchRpgItems().then((res) => { if (res?.items) items = res.items; }).catch(console.error);
  });

  async function saveSettings() {
    const payload = { ...settings };
    delete payload.seasonStartedAt;
    delete payload.layout;
    delete payload.layoutEnabled;
    await actionState.run(async () => {
      await saveRpgTowerSettings(payload);
      await load();
      return true;
    });
  }

  function openNew(kind: 'SHOP' | 'MILESTONE') {
    editing = {
      kind,
      name: '',
      description: '',
      emoji: kind === 'SHOP' ? '🎁' : '🏆',
      price: 100,
      floor: 10,
      repeatable: false,
      titleId: null,
      roleId: null,
      coins: 0,
      xp: 0,
      clanPoints: 0,
      itemName: null,
      shards: 0,
      enabled: true,
    };
  }

  function openEdit(reward: Reward) {
    editing = { ...reward };
  }

  async function saveReward() {
    if (!editing) return;
    const draft = editing;
    await actionState.run(async () => {
      await saveRpgTowerReward({
        ...draft,
        price: Number(draft.price) || 0,
        floor: Number(draft.floor) || 0,
        coins: Number(draft.coins) || 0,
        xp: Number(draft.xp) || 0,
        clanPoints: Number(draft.clanPoints) || 0,
        itemName: draft.itemName || null,
        shards: Number(draft.shards) || 0,
        titleId: draft.titleId || null,
        roleId: draft.roleId || null,
      });
      editing = null;
      await load();
      return true;
    });
  }

  async function removeReward(reward: Reward) {
    const confirmed = await confirmDialog.danger(m.eco_tower_reward_delete_confirm({ name: reward.name }), m.eco_tower_reward_delete_confirm_desc());
    if (!confirmed) return;
    await actionState.run(async () => {
      await deleteRpgTowerReward(reward.id);
      await load();
      return true;
    });
  }

  async function newSeason() {
    const confirmed = await confirmDialog.ask({
      title: m.eco_tower_season_confirm(),
      description: m.eco_tower_season_confirm_desc(),
      confirmLabel: m.eco_tower_season_btn(),
      variant: 'warning',
    });
    if (!confirmed) return;
    await actionState.run(async () => {
      await startRpgTowerSeason();
      await load();
      return true;
    });
  }

  const inputClass = 'w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2.5 text-xs focus:outline-none disabled:opacity-60';
  const labelClass = 'text-xs font-semibold text-on-surface-variant/60 ml-2';
</script>

{#snippet numberField(id: string, label: string, hint: string, key: NumericSetting, min: number, max: number)}
  <div class="space-y-1">
    <label for={id} class={labelClass}>{label}</label>
    <input {id} type="number" {min} {max} bind:value={settings[key]} disabled={!canManage || disabled} class={inputClass} />
    <p class="text-2xs text-on-surface-variant/50 leading-relaxed ml-2">{hint}</p>
  </div>
{/snippet}

{#snippet rewardCard(reward: Reward)}
  <div class="bg-surface-container-high/30 border border-outline-variant/10 p-4 rounded-xl space-y-2 {reward.enabled ? '' : 'opacity-60'}">
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <EmojiText value={reward.emoji} size="1.25rem" class="text-xl" />
        <div class="min-w-0">
          <p class="font-semibold text-sm truncate">{reward.name}</p>
          {#if reward.description}<p class="text-2xs text-on-surface-variant/60 line-clamp-2">{reward.description}</p>{/if}
        </div>
      </div>
      <span class="text-xs font-bold whitespace-nowrap {reward.kind === 'SHOP' ? 'text-sky-400' : 'text-amber-300'}">
        {reward.kind === 'SHOP'
          ? `${reward.price} ${settings.currencyEmoji}`
          : m.eco_tower_milestone_floor({ floor: reward.floor })}
      </span>
    </div>
    <div class="flex flex-wrap gap-x-3 gap-y-1 text-2xs">
      {#if reward.coins > 0}<span class="text-warning font-bold">+{reward.coins} {currencyName}</span>{/if}
      {#if reward.xp > 0}<span class="text-sky-400 font-bold">+{reward.xp} {m.eco_dungeon_rpg_xp()}</span>{/if}
      {#if reward.clanPoints > 0}<span class="text-emerald-400 font-bold flex items-center gap-1"><Papicon icon="shield" size={11} /> {m.eco_tower_reward_clan_points({ amount: reward.clanPoints })}</span>{/if}
      {#if reward.itemName}<span class="font-semibold flex items-center gap-1"><Papicon icon="package" size={11} /> {reward.itemName}</span>{/if}
      {#if reward.shards > 0}<span class="text-sky-400 font-bold">+{reward.shards} {settings.currencyEmoji}</span>{/if}
      {#if reward.titleId}<span class="font-semibold text-amber-300 flex items-center gap-1"><Papicon icon="award" size={11} /> {titleName(reward.titleId)}</span>{/if}
      {#if reward.roleId}<span class="font-semibold text-primary">{roleName(reward.roleId)}</span>{/if}
      {#if reward.repeatable}<span class="text-on-surface-variant/60">{m.eco_tower_reward_repeatable()}</span>{/if}
    </div>
    {#if canManage}
      <div class="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/5">
        <button type="button" onclick={() => openEdit(reward)} disabled={disabled} class="px-3 py-1.5 bg-outline-variant/10 hover:bg-outline-variant/25 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50">
          <Papicon icon="edit" size={12} /> {m.eco_btn_edit()}
        </button>
        <button type="button" onclick={() => removeReward(reward)} disabled={disabled} class="px-3 py-1.5 bg-error/10 hover:bg-error/20 text-error text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50">
          <Papicon icon="trash" size={12} /> {m.eco_tower_reward_delete_btn()}
        </button>
      </div>
    {/if}
  </div>
{/snippet}

<div class="space-y-6 transition-opacity duration-300 {disabled ? 'opacity-60' : ''}">
  <InlineFeedback state={actionState} />

  {#if loading}
    <div class="flex items-center justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  {:else}
    <!-- Réglages -->
    <div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/15 pb-4">
        <div>
          <h3 class="text-lg font-semibold">{m.eco_tower_title()}</h3>
          <p class="text-xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-2xl">{m.eco_tower_desc()}</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs font-semibold">{settings.enabled ? m.eco_tower_open() : m.eco_tower_closed()}</span>
          <ToggleSwitch checked={settings.enabled} disabled={!canManage || disabled} ariaLabel={m.eco_tower_toggle_aria()} onToggle={(value: boolean) => { settings.enabled = value; }} />
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        {#each [
          { label: m.eco_tower_stat_players(), value: stats.players, icon: 'users' },
          { label: m.eco_tower_stat_runs(), value: stats.runs, icon: 'Tasks' },
          { label: m.eco_tower_stat_active(), value: stats.activeRuns, icon: 'zap' },
          { label: m.eco_tower_stat_best(), value: stats.bestFloor, icon: 'Trophy' },
        ] as stat}
          <div class="bg-surface-container-high/30 border border-outline-variant/10 rounded-xl p-4">
            <p class="text-2xs text-on-surface-variant/60 flex items-center gap-1"><Papicon icon={stat.icon} size={11} /> {stat.label}</p>
            <p class="text-xl font-bold mt-1">{stat.value}</p>
          </div>
        {/each}
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2 space-y-1">
          <label for="towerName" class={labelClass}>{m.eco_tower_field_name()}</label>
          <input id="towerName" type="text" maxlength="50" bind:value={settings.name} disabled={!canManage || disabled} class={inputClass} />
        </div>
        <div class="space-y-1">
          <label for="towerEmoji" class={labelClass}>{m.eco_item_emoji()}</label>
          <div class="flex gap-2">
            <input id="towerEmoji" type="text" bind:value={settings.emoji} disabled={!canManage || disabled} class={inputClass} />
            {#if canManage}<EmojiPicker bind:value={settings.emoji} />{/if}
          </div>
        </div>
        <div class="col-span-3 space-y-1">
          <label for="towerDescription" class={labelClass}>{m.eco_tower_field_description()}</label>
          <textarea id="towerDescription" rows="2" maxlength="300" bind:value={settings.description} disabled={!canManage || disabled} placeholder={m.eco_tower_field_description_placeholder()} class="{inputClass} resize-none"></textarea>
        </div>
      </div>

      <!-- Entrée -->
      <div class="space-y-3 pt-2 border-t border-outline-variant/5">
        <div>
          <h4 class="text-sm font-bold">{m.eco_tower_entry_title()}</h4>
          <p class="text-xs text-on-surface-variant/60 mt-0.5 leading-relaxed">{m.eco_tower_entry_hint()}</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {#each [
            { mode: 'COMPRESSED' as EntryMode, title: m.eco_tower_mode_compressed(), desc: m.eco_tower_mode_compressed_desc() },
            { mode: 'RESET' as EntryMode, title: m.eco_tower_mode_reset(), desc: m.eco_tower_mode_reset_desc() },
          ] as option}
            <button
              type="button"
              disabled={!canManage || disabled}
              onclick={() => { settings.entryMode = option.mode; }}
              class="text-left p-4 rounded-xl border transition-all {settings.entryMode === option.mode ? 'border-primary bg-primary/10' : 'border-outline-variant/10 bg-surface-container-high/30 hover:border-outline-variant/30'}"
            >
              <p class="text-sm font-bold">{option.title}</p>
              <p class="text-2xs text-on-surface-variant/60 mt-1 leading-relaxed">{option.desc}</p>
            </button>
          {/each}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {#if settings.entryMode === 'COMPRESSED'}
            {@render numberField('towerInherit', m.eco_tower_field_inherit(), m.eco_tower_field_inherit_hint(), 'inheritCapPercent', 0, 300)}
          {/if}
          {@render numberField('towerTitle', m.eco_tower_field_title_cap(), m.eco_tower_field_title_cap_hint(), 'titleCapPercent', 0, 200)}
        </div>
        <div class="bg-surface-container-high/20 border border-outline-variant/10 rounded-xl p-4 space-y-2">
          <p class="text-xs font-semibold">{m.eco_tower_preview_entry()}</p>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-2xs">
            {#each entryPreview as row}
              <div class="bg-surface-container-high/30 rounded-lg px-3 py-2">
                <p class="text-on-surface-variant/60">{m.eco_tower_preview_rpg({ value: row.main.toLocaleString() })}</p>
                <p class="font-bold text-sm">⚔️ {row.tower}</p>
              </div>
            {/each}
          </div>
          <p class="text-2xs text-on-surface-variant/60">{m.eco_tower_preview_lead({ ratio: veteranRatio })}</p>
        </div>
      </div>

      <!-- Difficulté -->
      <div class="space-y-3 pt-2 border-t border-outline-variant/5">
        <h4 class="text-sm font-bold">{m.eco_tower_difficulty_title()}</h4>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {@render numberField('towerGrowth', m.eco_tower_field_growth(), m.eco_tower_field_growth_hint(), 'floorGrowthPercent', 1, 30)}
          {@render numberField('towerBoss', m.eco_tower_field_boss(), m.eco_tower_field_boss_hint(), 'bossEvery', 0, 50)}
          {@render numberField('towerBlessing', m.eco_tower_field_blessing(), m.eco_tower_field_blessing_hint(), 'blessingEvery', 0, 20)}
          {@render numberField('towerMaxBlessings', m.eco_tower_field_max_blessings(), m.eco_tower_field_max_blessings_hint(), 'maxBlessings', 1, 12)}
          {@render numberField('towerIdle', m.eco_tower_field_idle(), m.eco_tower_field_idle_hint(), 'idleTimeoutMinutes', 5, 1440)}
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-2xs">
          {#each floorPreview as row}
            <div class="bg-surface-container-high/30 rounded-lg px-3 py-2">
              <p class="text-on-surface-variant/60">{m.eco_tower_preview_floor({ floor: row.floor })}</p>
              <p class="font-semibold">❤️ {row.health} · ⚔️ {row.attack}</p>
            </div>
          {/each}
        </div>
      </div>

      <!-- Éclats -->
      <div class="space-y-3 pt-2 border-t border-outline-variant/5">
        <h4 class="text-sm font-bold">{m.eco_tower_shards_title()}</h4>
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2 space-y-1">
            <label for="towerCurrency" class={labelClass}>{m.eco_tower_field_currency()}</label>
            <input id="towerCurrency" type="text" maxlength="30" bind:value={settings.currencyName} disabled={!canManage || disabled} class={inputClass} />
          </div>
          <div class="space-y-1">
            <label for="towerCurrencyEmoji" class={labelClass}>{m.eco_item_emoji()}</label>
            <div class="flex gap-2">
              <input id="towerCurrencyEmoji" type="text" bind:value={settings.currencyEmoji} disabled={!canManage || disabled} class={inputClass} />
              {#if canManage}<EmojiPicker bind:value={settings.currencyEmoji} />{/if}
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          {@render numberField('towerShards', m.eco_tower_field_shards(), m.eco_tower_field_shards_hint(), 'shardsPerFloor', 0, 1000)}
          {@render numberField('towerDeath', m.eco_tower_field_death(), m.eco_tower_field_death_hint(), 'deathShardPercent', 0, 100)}
          {@render numberField('towerCap', m.eco_tower_field_cap(), m.eco_tower_field_cap_hint(), 'weeklyShardCap', 0, 1000000)}
        </div>
      </div>

      {#if canManage}
        <div class="flex justify-end pt-4 border-t border-outline-variant/10">
          <button type="button" onclick={saveSettings} disabled={disabled || actionState.state.loading} class="px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary text-body-sm font-medium rounded-lg transition-all disabled:opacity-50">
            {m.eco_btn_save()}
          </button>
        </div>
      {/if}
    </div>

    <!-- Carte -->
    {#key mapVersion}
      <RpgTowerMapEditor
        {canManage}
        {disabled}
        initialLayout={settings.layout ?? null}
        initialEnabled={settings.layoutEnabled ?? false}
        {foes}
        sizeLimits={limits.mapSize ?? { min: 3, max: 12 }}
        roomsMax={limits.mapRoomsMax ?? 100}
        onSaved={load}
      />
    {/key}

    <!-- Récompenses -->
    <div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/15 pb-4">
        <div>
          <h3 class="text-lg font-semibold">{m.eco_tower_rewards_title()}</h3>
          <p class="text-xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-2xl">{m.eco_tower_rewards_desc()}</p>
        </div>
        {#if canManage}
          <div class="flex gap-2">
            <button type="button" onclick={() => openNew('SHOP')} disabled={disabled || rewards.length >= limits.rewardsMax} class="px-4 py-2.5 bg-primary hover:bg-primary-hover text-on-primary text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50">
              <Papicon icon="Plus" size={14} /> {m.eco_tower_new_shop_btn()}
            </button>
            <button type="button" onclick={() => openNew('MILESTONE')} disabled={disabled || rewards.length >= limits.rewardsMax} class="px-4 py-2.5 bg-outline-variant/10 hover:bg-outline-variant/25 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50">
              <Papicon icon="Trophy" size={14} /> {m.eco_tower_new_milestone_btn()}
            </button>
          </div>
        {/if}
      </div>

      <div class="space-y-3">
        <h4 class="text-sm font-bold">{m.eco_tower_shop_title()}</h4>
        {#if shopRewards.length === 0}
          <p class="text-xs text-on-surface-variant/60 italic">{m.eco_tower_shop_empty()}</p>
        {:else}
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {#each shopRewards as reward (reward.id)}{@render rewardCard(reward)}{/each}
          </div>
        {/if}
      </div>

      <div class="space-y-3">
        <h4 class="text-sm font-bold">{m.eco_tower_milestones_title()}</h4>
        {#if milestones.length === 0}
          <p class="text-xs text-on-surface-variant/60 italic">{m.eco_tower_milestones_empty()}</p>
        {:else}
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {#each milestones as reward (reward.id)}{@render rewardCard(reward)}{/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Classement -->
    <div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-4">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/15 pb-4">
        <div>
          <h3 class="text-lg font-semibold">{m.eco_tower_leaderboard_title()}</h3>
          <p class="text-xs text-on-surface-variant/60 mt-1">
            {settings.seasonStartedAt && new Date(settings.seasonStartedAt).getTime() > 0
              ? m.eco_tower_season_since({ date: new Date(settings.seasonStartedAt).toLocaleDateString() })
              : m.eco_tower_season_first()}
          </p>
        </div>
        {#if canManage}
          <button type="button" onclick={newSeason} disabled={disabled} class="px-4 py-2.5 bg-warning/10 hover:bg-warning/20 text-warning text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50">
            <Papicon icon="RotateCcw" size={14} /> {m.eco_tower_season_btn()}
          </button>
        {/if}
      </div>
      {#if leaderboard.length === 0}
        <p class="text-xs text-on-surface-variant/60 italic">{m.eco_tower_leaderboard_empty()}</p>
      {:else}
        <ol class="space-y-1.5">
          {#each leaderboard as entry, index (entry.userId)}
            <li class="flex items-center gap-3 bg-surface-container-high/30 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs">
              <span class="w-6 text-right font-mono text-on-surface-variant/50">{index + 1}.</span>
              <span class="flex-1 font-semibold truncate">{entry.displayName}</span>
              <span class="text-on-surface-variant/60">{m.eco_tower_leaderboard_runs({ runs: entry.totalRuns })}</span>
              <span class="font-bold text-amber-300">{m.eco_tower_milestone_floor({ floor: entry.bestFloor })}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
</div>

{#if editing}
  <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div class="bg-surface-container rounded-xl border border-outline-variant/30 p-8 w-full max-w-xl space-y-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
      <h3 class="text-xl font-semibold">
        {editing.kind === 'SHOP'
          ? (editing.id ? m.eco_tower_modal_edit_shop() : m.eco_tower_modal_new_shop())
          : (editing.id ? m.eco_tower_modal_edit_milestone() : m.eco_tower_modal_new_milestone())}
      </h3>

      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2 space-y-1">
          <label for="rewardName" class={labelClass}>{m.eco_tower_field_reward_name()}</label>
          <input id="rewardName" type="text" maxlength="50" bind:value={editing.name} class={inputClass} />
        </div>
        <div class="space-y-1">
          <label for="rewardEmoji" class={labelClass}>{m.eco_item_emoji()}</label>
          <div class="flex gap-2">
            <input id="rewardEmoji" type="text" bind:value={editing.emoji} class={inputClass} />
            <EmojiPicker bind:value={editing.emoji} />
          </div>
        </div>
        <div class="col-span-3 space-y-1">
          <label for="rewardDescription" class={labelClass}>{m.eco_tower_field_description()}</label>
          <textarea id="rewardDescription" rows="2" maxlength="300" bind:value={editing.description} class="{inputClass} resize-none"></textarea>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        {#if editing.kind === 'SHOP'}
          <div class="space-y-1">
            <label for="rewardPrice" class={labelClass}>{m.eco_tower_field_price({ currency: settings.currencyName })}</label>
            <input id="rewardPrice" type="number" min="1" bind:value={editing.price} class={inputClass} />
          </div>
          <div class="flex items-center justify-between gap-3 px-2">
            <div>
              <p class="text-xs font-semibold">{m.eco_tower_field_repeatable()}</p>
              <p class="text-2xs text-on-surface-variant/50">{m.eco_tower_field_repeatable_hint()}</p>
            </div>
            <ToggleSwitch checked={editing.repeatable} onToggle={(value: boolean) => { if (editing) editing.repeatable = value; }} />
          </div>
        {:else}
          <div class="space-y-1">
            <label for="rewardFloor" class={labelClass}>{m.eco_tower_field_floor()}</label>
            <input id="rewardFloor" type="number" min="1" bind:value={editing.floor} class={inputClass} />
          </div>
          <div class="space-y-1">
            <label for="rewardShards" class={labelClass}>{m.eco_tower_field_bonus_shards({ currency: settings.currencyName })}</label>
            <input id="rewardShards" type="number" min="0" bind:value={editing.shards} class={inputClass} />
          </div>
        {/if}
        <div class="space-y-1">
          <label for="rewardCoins" class={labelClass}>{currencyName || m.eco_fish_field_value()}</label>
          <input id="rewardCoins" type="number" min="0" bind:value={editing.coins} class={inputClass} />
        </div>
        <div class="space-y-1">
          <label for="rewardXp" class={labelClass}>{m.eco_dungeon_rpg_xp()}</label>
          <input id="rewardXp" type="number" min="0" bind:value={editing.xp} class={inputClass} />
        </div>
        <div class="space-y-1">
          <label for="rewardClan" class={labelClass}>{m.eco_tower_field_clan_points()}</label>
          <input id="rewardClan" type="number" min="0" bind:value={editing.clanPoints} class={inputClass} />
          <p class="text-2xs text-on-surface-variant/50 leading-relaxed ml-2">{m.eco_tower_field_clan_points_hint()}</p>
        </div>
        <div class="space-y-1">
          <span class={labelClass}>{m.eco_fish_reward_title()}</span>
          <SearchableSelect
            value={editing.titleId || null}
            options={titleOptions}
            placeholder={titles.length > 0 ? m.eco_bestiary_title_none() : m.eco_bestiary_title_empty()}
            clearable={true}
            showId={false}
            className="w-full"
            on:change={(e: any) => { if (editing) editing.titleId = e.detail?.value ?? null; }}
          />
        </div>
        <div class="col-span-2 space-y-1">
          <span class={labelClass}>{m.eco_fish_reward_item()}</span>
          <SearchableSelect
            value={editing.itemName || null}
            options={itemOptions}
            placeholder={m.eco_fish_reward_item_none()}
            clearable={true}
            showId={false}
            className="w-full"
            on:change={(e: any) => { if (editing) editing.itemName = e.detail?.value ?? null; }}
          />
        </div>
        <div class="col-span-2 space-y-1">
          <span class={labelClass}>{m.eco_fish_reward_role()}</span>
          <SearchableSelect
            value={editing.roleId || null}
            options={roles}
            placeholder={m.eco_fish_reward_role_none()}
            clearable={true}
            className="w-full"
            on:change={(e: any) => { if (editing) editing.roleId = e.detail?.value ?? null; }}
          />
        </div>
      </div>
      <p class="text-2xs text-on-surface-variant/50 leading-relaxed -mt-3">{m.eco_tower_reward_power_hint()}</p>

      <div class="flex items-center justify-between pt-2 border-t border-outline-variant/5">
        <div>
          <h4 class="text-sm font-bold">{m.eco_tower_reward_enabled()}</h4>
        </div>
        <ToggleSwitch checked={editing.enabled} onToggle={(value: boolean) => { if (editing) editing.enabled = value; }} />
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-outline-variant/10">
        <button type="button" onclick={() => editing = null} class="px-5 py-2.5 bg-outline-variant/10 hover:bg-outline-variant/20 rounded-xl text-xs font-bold transition-all">
          {m.eco_btn_cancel()}
        </button>
        <button type="button" onclick={saveReward} disabled={actionState.state.loading || !editing.name.trim()} class="px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary text-body-sm font-medium rounded-lg transition-all disabled:opacity-50">
          {m.eco_btn_save()}
        </button>
      </div>
    </div>
  </div>
{/if}
