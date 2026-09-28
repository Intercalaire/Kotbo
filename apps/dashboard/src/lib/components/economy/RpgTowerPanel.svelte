<script lang="ts">
  /**
   * La Tour : mode roguelite du RPG.
   *
   * Les joueurs y entrent avec des stats compressées (ou remises à zéro) et gagnent des éclats,
   * une monnaie propre à la Tour. Le panneau est découpé en sous-onglets : réglages, carte,
   * boutique (améliorations et articles), marchand, paliers et classement.
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
  import Tabs from '../ui/Tabs.svelte';
  import RpgTowerMapEditor from './RpgTowerMapEditor.svelte';

  const { canManage = false, disabled = false, currencyName = '' }: { canManage?: boolean; disabled?: boolean; currencyName?: string } = $props();

  type EntryMode = 'COMPRESSED' | 'RESET';
  type OfferKind = 'POTION' | 'HEAL' | 'GEAR';
  type UpgradeEffect = 'POTION' | 'HEALTH' | 'ATTACK' | 'DEFENSE' | 'SPEED' | 'CRIT' | 'GOLD';
  type Upgrade = {
    id: string;
    enabled: boolean;
    name: string;
    emoji: string;
    description: string;
    effect: UpgradeEffect;
    perLevel: number;
    maxLevel: number;
    baseCost: number;
    costGrowthPercent: number;
  };
  type Merchant = {
    offers: OfferKind[];
    potionPrice: number;
    potionPricePerFloor: number;
    healPrice: number;
    healPricePerFloor: number;
    healPercent: number;
    gearPrice: number;
    gearPricePerFloor: number;
    potionHealPercent: number;
  };
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
    leaveShardPercent: number;
    weeklyShardCap: number;
    idleTimeoutMinutes: number;
    currencyName: string;
    currencyEmoji: string;
    upgrades: Upgrade[];
    merchant: Merchant;
    seasonStartedAt?: string;
    layoutEnabled?: boolean;
    floors?: any[];
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
  type NumericMerchant = { [K in keyof Merchant]-?: Merchant[K] extends number ? K : never }[keyof Merchant];
  type LeaderboardEntry = { userId: string; displayName: string; bestFloor: number; totalRuns: number };
  type Tab = 'general' | 'map' | 'shop' | 'merchant' | 'milestones' | 'leaderboard';

  // Mêmes valeurs que `rpgTowerPolicy.ts` côté bot.
  const UPGRADE_EFFECTS: UpgradeEffect[] = ['POTION', 'HEALTH', 'ATTACK', 'DEFENSE', 'SPEED', 'CRIT', 'GOLD'];
  const UPGRADE_ICON: Record<UpgradeEffect, string> = {
    POTION: 'FlaskConical', HEALTH: 'Heart', ATTACK: 'Swords', DEFENSE: 'Shield', SPEED: 'Zap', CRIT: 'Target', GOLD: 'Coins',
  };
  const PER_LEVEL_MAX: Record<UpgradeEffect, number> = { POTION: 5, HEALTH: 100, ATTACK: 100, DEFENSE: 100, SPEED: 100, CRIT: 20, GOLD: 10000 };
  const UPGRADES_MAX = 10;
  const OFFERS: OfferKind[] = ['POTION', 'HEAL', 'GEAR'];
  const MERCHANT_DEFAULTS: Merchant = {
    offers: [...OFFERS],
    potionPrice: 20,
    potionPricePerFloor: 2,
    healPrice: 25,
    healPricePerFloor: 3,
    healPercent: 40,
    gearPrice: 40,
    gearPricePerFloor: 5,
    potionHealPercent: 35,
  };

  function defaultUpgrades(): Upgrade[] {
    return [
      { id: 'potion', enabled: true, name: '', emoji: '', description: '', effect: 'POTION', perLevel: 1, maxLevel: 3, baseCost: 25, costGrowthPercent: 100 },
      { id: 'vigor', enabled: true, name: '', emoji: '', description: '', effect: 'HEALTH', perLevel: 5, maxLevel: 5, baseCost: 40, costGrowthPercent: 100 },
    ];
  }

  const DEFAULTS: Settings = {
    enabled: false,
    name: 'La Tour',
    emoji: '',
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
    leaveShardPercent: 80,
    weeklyShardCap: 0,
    idleTimeoutMinutes: 30,
    currencyName: 'Éclats de Tour',
    currencyEmoji: '',
    upgrades: defaultUpgrades(),
    merchant: { ...MERCHANT_DEFAULTS, offers: [...OFFERS] },
  };

  const BASE_ATTACK = 20;
  const INHERIT_SLOPE = 0.2;
  const MONSTER_BASE_HEALTH = 70;
  const MONSTER_BASE_ATTACK = 13;
  // Au-delà de cet étage, la croissance des monstres est divisée par deux (miroir du bot).
  const GROWTH_KNEE = 25;

  const actionState = createAsyncActionState();
  let loading = $state(true);
  let tab = $state<Tab>('general');
  let settings = $state<Settings>({ ...DEFAULTS });
  let rewards = $state<Reward[]>([]);
  let leaderboard = $state<LeaderboardEntry[]>([]);
  let stats = $state({ players: 0, runs: 0, activeRuns: 0, bestFloor: 0 });
  let limits = $state<{ rewardsMax: number; mapSize?: { min: number; max: number }; mapRoomsMax?: number; floorsMax?: number }>({ rewardsMax: 40 });
  let resetMilestones = $state(true);
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

  const tabs = $derived([
    { id: 'general', label: m.eco_tower_tab_general(), icon: 'Settings' },
    { id: 'map', label: m.eco_tower_tab_map(), icon: 'MapPin' },
    { id: 'shop', label: m.eco_tower_tab_shop(), icon: 'ShoppingBag', badge: settings.upgrades.length + shopRewards.length || undefined },
    { id: 'merchant', label: m.eco_tower_tab_merchant(), icon: 'ShoppingCart' },
    { id: 'milestones', label: m.eco_tower_tab_milestones(), icon: 'Trophy', badge: milestones.length || undefined },
    { id: 'leaderboard', label: m.eco_tower_tab_leaderboard(), icon: 'Medal' },
  ]);

  function towerAttack(mainAttack: number): number {
    const inherited = settings.entryMode === 'COMPRESSED'
      ? Math.min(settings.inheritCapPercent / 100, INHERIT_SLOPE * Math.log10(1 + mainAttack / BASE_ATTACK))
      : 0;
    return Math.round(BASE_ATTACK * (1 + inherited));
  }

  const entryPreview = $derived([20, 2_000, 200_000, 20_000_000].map((main) => ({ main, tower: towerAttack(main) })));
  const floorPreview = $derived([1, 10, 25, 50].map((floor) => {
    const rate = (Number(settings.floorGrowthPercent) || 0) / 100;
    const steep = Math.min(floor - 1, GROWTH_KNEE - 1);
    const growth = Math.pow(1 + rate, steep) * Math.pow(1 + rate / 2, floor - 1 - steep);
    return { floor, health: Math.round(MONSTER_BASE_HEALTH * growth), attack: Math.round(MONSTER_BASE_ATTACK * growth) };
  }));
  const veteranRatio = $derived((towerAttack(20_000_000) / towerAttack(20)).toFixed(2));

  function merchantPrice(base: number, perFloor: number, floor: number): number {
    return Math.max(1, Math.round((Number(base) || 0) + floor * (Number(perFloor) || 0)));
  }

  const merchantPreview = $derived([1, 10, 25, 50].map((floor) => ({
    floor,
    potion: merchantPrice(settings.merchant.potionPrice, settings.merchant.potionPricePerFloor, floor),
    heal: merchantPrice(settings.merchant.healPrice, settings.merchant.healPricePerFloor, floor),
    gear: merchantPrice(settings.merchant.gearPrice, settings.merchant.gearPricePerFloor, floor),
  })));

  function upgradeCost(upgrade: Upgrade, level: number): number {
    return Math.round((Number(upgrade.baseCost) || 0) * Math.pow(1 + (Number(upgrade.costGrowthPercent) || 0) / 100, level));
  }

  function upgradeCosts(upgrade: Upgrade): string {
    const levels = Math.min(Math.max(1, Number(upgrade.maxLevel) || 1), 6);
    const costs = Array.from({ length: levels }, (_, level) => upgradeCost(upgrade, level).toLocaleString());
    return `${costs.join(' · ')}${(Number(upgrade.maxLevel) || 1) > levels ? ' …' : ''}`;
  }

  function effectLabel(effect: UpgradeEffect): string {
    switch (effect) {
      case 'POTION': return m.eco_tower_upgrade_effect_POTION();
      case 'HEALTH': return m.eco_tower_upgrade_effect_HEALTH();
      case 'ATTACK': return m.eco_tower_upgrade_effect_ATTACK();
      case 'DEFENSE': return m.eco_tower_upgrade_effect_DEFENSE();
      case 'SPEED': return m.eco_tower_upgrade_effect_SPEED();
      case 'CRIT': return m.eco_tower_upgrade_effect_CRIT();
      default: return m.eco_tower_upgrade_effect_GOLD();
    }
  }

  function effectUnit(effect: UpgradeEffect): string {
    switch (effect) {
      case 'POTION': return m.eco_tower_upgrade_unit_POTION();
      case 'HEALTH': return m.eco_tower_upgrade_unit_HEALTH();
      case 'ATTACK': return m.eco_tower_upgrade_unit_ATTACK();
      case 'DEFENSE': return m.eco_tower_upgrade_unit_DEFENSE();
      case 'SPEED': return m.eco_tower_upgrade_unit_SPEED();
      case 'CRIT': return m.eco_tower_upgrade_unit_CRIT();
      default: return m.eco_tower_upgrade_unit_GOLD();
    }
  }

  function offerLabel(offer: OfferKind): string {
    if (offer === 'POTION') return m.eco_tower_merchant_potion();
    if (offer === 'HEAL') return m.eco_tower_merchant_heal();
    return m.eco_tower_merchant_gear();
  }

  function offerTip(offer: OfferKind): string {
    if (offer === 'POTION') return m.eco_tower_merchant_potion_tip();
    if (offer === 'HEAL') return m.eco_tower_merchant_heal_tip();
    return m.eco_tower_merchant_gear_tip();
  }

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
        const loaded = res.settings ?? {};
        settings = {
          ...DEFAULTS,
          ...loaded,
          upgrades: Array.isArray(loaded.upgrades) ? loaded.upgrades : defaultUpgrades(),
          merchant: { ...MERCHANT_DEFAULTS, ...(loaded.merchant ?? {}) },
        };
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
    const payload: Record<string, unknown> = {
      ...settings,
      upgrades: settings.upgrades.map((upgrade) => ({
        ...upgrade,
        perLevel: Number(upgrade.perLevel) || 1,
        maxLevel: Number(upgrade.maxLevel) || 1,
        baseCost: Number(upgrade.baseCost) || 1,
        costGrowthPercent: Number(upgrade.costGrowthPercent) || 0,
      })),
    };
    delete payload.seasonStartedAt;
    delete payload.floors;
    delete payload.layoutEnabled;
    await actionState.run(async () => {
      await saveRpgTowerSettings(payload);
      await load();
      return true;
    });
  }

  function addUpgrade() {
    if (settings.upgrades.length >= UPGRADES_MAX) return;
    const id = `u${Date.now().toString(36)}`;
    settings.upgrades = [...settings.upgrades, {
      id, enabled: true, name: '', emoji: '', description: '', effect: 'ATTACK', perLevel: 5, maxLevel: 3, baseCost: 50, costGrowthPercent: 100,
    }];
  }

  async function removeUpgrade(upgrade: Upgrade) {
    const confirmed = await confirmDialog.danger(
      m.eco_tower_upgrade_delete_confirm({ name: upgrade.name || effectLabel(upgrade.effect) }),
      m.eco_tower_upgrade_delete_confirm_desc(),
    );
    if (!confirmed) return;
    settings.upgrades = settings.upgrades.filter((candidate) => candidate.id !== upgrade.id);
  }

  function toggleOffer(offer: OfferKind) {
    const current = settings.merchant.offers;
    const next = current.includes(offer) ? current.filter((entry) => entry !== offer) : OFFERS.filter((entry) => entry === offer || current.includes(entry));
    if (next.length > 0) settings.merchant.offers = next;
  }

  function openNew(kind: 'SHOP' | 'MILESTONE') {
    editing = {
      kind,
      name: '',
      description: '',
      emoji: '',
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
      await startRpgTowerSeason({ resetMilestones });
      await load();
      return true;
    });
  }

  const inputClass = 'w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2.5 text-xs focus:outline-none disabled:opacity-60';
  const labelClass = 'text-xs font-semibold text-on-surface-variant/60 ml-2';
  const cardClass = 'bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6';
</script>

{#snippet numberField(id: string, label: string, hint: string, key: NumericSetting, min: number, max: number, off: boolean = false)}
  <div class="space-y-1 {off ? 'opacity-60' : ''}" title={hint}>
    <label for={id} class={labelClass}>{label}</label>
    <input {id} type="number" {min} {max} bind:value={settings[key]} disabled={!canManage || disabled || off} class={inputClass} />
    <p class="text-2xs text-on-surface-variant/50 leading-relaxed ml-2">{hint}</p>
  </div>
{/snippet}

{#snippet merchantField(id: string, label: string, key: NumericMerchant, min: number, max: number, hint: string = '')}
  <div class="space-y-1" title={hint || label}>
    <label for={id} class={labelClass}>{label}</label>
    <input {id} type="number" {min} {max} bind:value={settings.merchant[key]} disabled={!canManage || disabled} class={inputClass} />
    {#if hint}<p class="text-2xs text-on-surface-variant/50 leading-relaxed ml-2">{hint}</p>{/if}
  </div>
{/snippet}

{#snippet shardIcon(size: number)}
  {#if settings.currencyEmoji}<EmojiText value={settings.currencyEmoji} />{:else}<Papicon icon="Diamond" {size} />{/if}
{/snippet}

{#snippet saveBar()}
  {#if canManage}
    <div class="flex justify-end pt-4 border-t border-outline-variant/10">
      <button type="button" onclick={saveSettings} disabled={disabled || actionState.state.loading} class="px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary text-body-sm font-medium rounded-lg transition-all disabled:opacity-50">
        {m.eco_btn_save()}
      </button>
    </div>
  {/if}
{/snippet}

{#snippet rewardCard(reward: Reward)}
  <div class="bg-surface-container-high/30 border border-outline-variant/10 p-4 rounded-xl space-y-2 {reward.enabled ? '' : 'opacity-60'}">
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        {#if reward.emoji}
          <EmojiText value={reward.emoji} size="1.25rem" class="text-xl" />
        {:else}
          <span class="text-primary flex"><Papicon icon={reward.kind === 'SHOP' ? 'Gift' : 'Trophy'} size={20} /></span>
        {/if}
        <div class="min-w-0">
          <p class="font-semibold text-sm truncate">{reward.name}</p>
          {#if reward.description}<p class="text-2xs text-on-surface-variant/60 line-clamp-2">{reward.description}</p>{/if}
        </div>
      </div>
      <span class="text-xs font-bold whitespace-nowrap flex items-center gap-1 {reward.kind === 'SHOP' ? 'text-primary' : 'text-warning'}">
        {#if reward.kind === 'SHOP'}
          {reward.price} {@render shardIcon(12)}
        {:else}
          {m.eco_tower_milestone_floor({ floor: reward.floor })}
        {/if}
      </span>
    </div>
    <div class="flex flex-wrap gap-x-3 gap-y-1 text-2xs">
      {#if reward.coins > 0}<span class="text-warning font-bold flex items-center gap-1"><Papicon icon="Coins" size={11} /> +{reward.coins} {currencyName}</span>{/if}
      {#if reward.xp > 0}<span class="text-primary font-bold flex items-center gap-1"><Papicon icon="Sparkles" size={11} /> +{reward.xp} {m.eco_dungeon_rpg_xp()}</span>{/if}
      {#if reward.clanPoints > 0}<span class="text-success font-bold flex items-center gap-1"><Papicon icon="shield" size={11} /> {m.eco_tower_reward_clan_points({ amount: reward.clanPoints })}</span>{/if}
      {#if reward.itemName}<span class="font-semibold flex items-center gap-1"><Papicon icon="package" size={11} /> {reward.itemName}</span>{/if}
      {#if reward.shards > 0}<span class="text-primary font-bold flex items-center gap-1">+{reward.shards} {@render shardIcon(11)}</span>{/if}
      {#if reward.titleId}<span class="font-semibold text-warning flex items-center gap-1"><Papicon icon="award" size={11} /> {titleName(reward.titleId)}</span>{/if}
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
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div>
        <h3 class="text-lg font-semibold flex items-center gap-2">
          {#if settings.emoji}<EmojiText value={settings.emoji} />{:else}<Papicon icon="Building" size={18} />{/if}
          {settings.name || m.eco_tower_title()}
          <span class="text-2xs font-semibold px-2 py-0.5 rounded-full {settings.enabled ? 'bg-success/15 text-success' : 'bg-outline-variant/15 text-on-surface-variant/70'}">
            {settings.enabled ? m.eco_tower_open() : m.eco_tower_closed()}
          </span>
        </h3>
        <p class="text-xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-2xl">{m.eco_tower_desc()}</p>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      {#each [
        { label: m.eco_tower_stat_players(), tip: m.eco_tower_stat_players_tip(), value: stats.players, icon: 'users' },
        { label: m.eco_tower_stat_runs(), tip: m.eco_tower_stat_runs_tip(), value: stats.runs, icon: 'Tasks' },
        { label: m.eco_tower_stat_active(), tip: m.eco_tower_stat_active_tip(), value: stats.activeRuns, icon: 'zap' },
        { label: m.eco_tower_stat_best(), tip: m.eco_tower_stat_best_tip(), value: stats.bestFloor, icon: 'Trophy' },
      ] as stat}
        <div class="bg-surface-container-high/30 border border-outline-variant/10 rounded-xl p-4" title={stat.tip}>
          <p class="text-2xs text-on-surface-variant/60 flex items-center gap-1"><Papicon icon={stat.icon} size={11} /> {stat.label}</p>
          <p class="text-xl font-bold mt-1">{stat.value}</p>
        </div>
      {/each}
    </div>

    <Tabs label={m.eco_tower_tabs_label()} {tabs} active={tab} onchange={(id) => { tab = id as Tab; }} />

    {#if tab === 'general'}
      <div class={cardClass}>
        <div class="flex items-center justify-between gap-4">
          <div>
            <h4 class="text-sm font-bold">{m.eco_tower_title()}</h4>
            <p class="text-xs text-on-surface-variant/60 mt-0.5">{settings.enabled ? m.eco_tower_open() : m.eco_tower_closed()}</p>
          </div>
          <ToggleSwitch checked={settings.enabled} disabled={!canManage || disabled} ariaLabel={m.eco_tower_toggle_aria()} onToggle={(value: boolean) => { settings.enabled = value; }} />
        </div>

        <details class="bg-surface-container-high/20 border border-outline-variant/10 rounded-xl p-4 group">
          <summary class="text-sm font-bold cursor-pointer flex items-center gap-2 select-none">
            <Papicon icon="Info" size={14} /> {m.eco_tower_guide_title()}
          </summary>
          <ul class="mt-3 space-y-2 text-xs text-on-surface-variant/80 leading-relaxed list-disc pl-5">
            <li>{m.eco_tower_guide_floor()}</li>
            <li>{m.eco_tower_guide_boss()}</li>
            <li>{m.eco_tower_guide_growth()}</li>
            <li>{m.eco_tower_guide_combat()}</li>
            <li>{m.eco_tower_guide_milestones()}</li>
            <li>{m.eco_tower_guide_start()}</li>
          </ul>
        </details>

        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2 space-y-1">
            <label for="towerName" class={labelClass}>{m.eco_tower_field_name()}</label>
            <input id="towerName" type="text" maxlength="50" bind:value={settings.name} disabled={!canManage || disabled} class={inputClass} />
          </div>
          <div class="space-y-1" title={m.eco_tower_emoji_default_hint()}>
            <label for="towerEmoji" class={labelClass}>{m.eco_item_emoji()}</label>
            <div class="flex gap-2">
              <input id="towerEmoji" type="text" bind:value={settings.emoji} disabled={!canManage || disabled} placeholder={m.eco_tower_emoji_default_hint()} class={inputClass} />
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
                title={option.desc}
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
                  <p class="font-bold text-sm flex items-center gap-1"><Papicon icon="Swords" size={12} /> {row.tower}</p>
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
            <!-- Sur carte, chaque étage a son gardien, et les bénédictions se comptent en étages gravis. -->
            {@render numberField('towerBoss', m.eco_tower_field_boss(), settings.layoutEnabled ? m.eco_tower_field_boss_map_hint() : m.eco_tower_field_boss_hint(), 'bossEvery', 0, 50, settings.layoutEnabled === true)}
            {@render numberField('towerBlessing', m.eco_tower_field_blessing(), settings.layoutEnabled ? m.eco_tower_field_blessing_map_hint() : m.eco_tower_field_blessing_hint(), 'blessingEvery', 0, 20)}
            {@render numberField('towerMaxBlessings', m.eco_tower_field_max_blessings(), m.eco_tower_field_max_blessings_hint(), 'maxBlessings', 1, 12)}
            {@render numberField('towerIdle', m.eco_tower_field_idle(), m.eco_tower_field_idle_hint(), 'idleTimeoutMinutes', 5, 1440)}
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-2xs">
            {#each floorPreview as row}
              <div class="bg-surface-container-high/30 rounded-lg px-3 py-2">
                <p class="text-on-surface-variant/60">{m.eco_tower_preview_floor({ floor: row.floor })}</p>
                <p class="font-semibold flex items-center gap-2">
                  <span class="flex items-center gap-1"><Papicon icon="Heart" size={11} /> {row.health}</span>
                  <span class="flex items-center gap-1"><Papicon icon="Swords" size={11} /> {row.attack}</span>
                </p>
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
            <div class="space-y-1" title={m.eco_tower_emoji_default_hint()}>
              <label for="towerCurrencyEmoji" class={labelClass}>{m.eco_item_emoji()}</label>
              <div class="flex gap-2">
                <input id="towerCurrencyEmoji" type="text" bind:value={settings.currencyEmoji} disabled={!canManage || disabled} placeholder={m.eco_tower_emoji_default_hint()} class={inputClass} />
                {#if canManage}<EmojiPicker bind:value={settings.currencyEmoji} />{/if}
              </div>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {@render numberField('towerShards', m.eco_tower_field_shards(), m.eco_tower_field_shards_hint(), 'shardsPerFloor', 0, 1000)}
            {@render numberField('towerDeath', m.eco_tower_field_death(), m.eco_tower_field_death_hint(), 'deathShardPercent', 0, 100)}
            {@render numberField('towerLeave', m.eco_tower_field_leave(), m.eco_tower_field_leave_hint(), 'leaveShardPercent', 0, 100)}
            {@render numberField('towerCap', m.eco_tower_field_cap(), m.eco_tower_field_cap_hint(), 'weeklyShardCap', 0, 1000000)}
          </div>
        </div>

        {@render saveBar()}
      </div>
    {:else if tab === 'map'}
      {#key mapVersion}
        <RpgTowerMapEditor
          {canManage}
          {disabled}
          initialFloors={settings.floors ?? []}
          initialEnabled={settings.layoutEnabled ?? false}
          floorsMax={limits.floorsMax ?? 12}
          {foes}
          sizeLimits={limits.mapSize ?? { min: 3, max: 12 }}
          roomsMax={limits.mapRoomsMax ?? 100}
          onSaved={load}
        />
      {/key}
    {:else if tab === 'shop'}
      <!-- Améliorations permanentes -->
      <div class={cardClass}>
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/15 pb-4">
          <div>
            <h3 class="text-lg font-semibold">{m.eco_tower_upgrades_title()}</h3>
            <p class="text-xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-2xl">{m.eco_tower_upgrades_desc()}</p>
          </div>
          {#if canManage}
            <button type="button" onclick={addUpgrade} disabled={disabled || settings.upgrades.length >= UPGRADES_MAX} title={m.eco_tower_upgrades_max({ max: UPGRADES_MAX })} class="px-4 py-2.5 bg-primary hover:bg-primary-hover text-on-primary text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50">
              <Papicon icon="Plus" size={14} /> {m.eco_tower_upgrade_add()}
            </button>
          {/if}
        </div>

        {#if settings.upgrades.length === 0}
          <p class="text-xs text-on-surface-variant/60 italic">{m.eco_tower_upgrades_empty()}</p>
        {:else}
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {#each settings.upgrades as upgrade, index (upgrade.id)}
              <div class="bg-surface-container-high/30 border border-outline-variant/10 p-4 rounded-xl space-y-3 {upgrade.enabled ? '' : 'opacity-60'}">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-sm font-bold flex items-center gap-2 min-w-0">
                    {#if upgrade.emoji}<EmojiText value={upgrade.emoji} />{:else}<span class="text-primary flex"><Papicon icon={UPGRADE_ICON[upgrade.effect]} size={16} /></span>{/if}
                    <span class="truncate">{upgrade.name || effectLabel(upgrade.effect)}</span>
                  </p>
                  <div class="flex items-center gap-2">
                    <ToggleSwitch checked={upgrade.enabled} disabled={!canManage || disabled} ariaLabel={m.eco_tower_upgrade_enabled_aria()} onToggle={(value: boolean) => { settings.upgrades[index].enabled = value; }} />
                    {#if canManage}
                      <button type="button" onclick={() => removeUpgrade(upgrade)} disabled={disabled} title={m.eco_tower_upgrade_delete_confirm_desc()} aria-label={m.eco_tower_reward_delete_btn()} class="p-2 bg-error/10 hover:bg-error/20 text-error rounded-lg transition-all disabled:opacity-50">
                        <Papicon icon="trash" size={12} />
                      </button>
                    {/if}
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-1">
                    <label for="upgEffect{upgrade.id}" class={labelClass}>{m.eco_tower_upgrade_effect()}</label>
                    <select id="upgEffect{upgrade.id}" bind:value={settings.upgrades[index].effect} disabled={!canManage || disabled} class={inputClass}>
                      {#each UPGRADE_EFFECTS as effect}<option value={effect}>{effectLabel(effect)}</option>{/each}
                    </select>
                  </div>
                  <div class="space-y-1" title={effectUnit(upgrade.effect)}>
                    <label for="upgPer{upgrade.id}" class={labelClass}>{effectUnit(upgrade.effect)}</label>
                    <input id="upgPer{upgrade.id}" type="number" min="1" max={PER_LEVEL_MAX[upgrade.effect]} bind:value={settings.upgrades[index].perLevel} disabled={!canManage || disabled} class={inputClass} />
                  </div>
                  <div class="space-y-1">
                    <label for="upgName{upgrade.id}" class={labelClass}>{m.eco_tower_field_reward_name()}</label>
                    <input id="upgName{upgrade.id}" type="text" maxlength="50" bind:value={settings.upgrades[index].name} disabled={!canManage || disabled} placeholder={m.eco_tower_upgrade_name_placeholder({ name: effectLabel(upgrade.effect) })} class={inputClass} />
                  </div>
                  <div class="space-y-1" title={m.eco_tower_emoji_default_hint()}>
                    <label for="upgEmoji{upgrade.id}" class={labelClass}>{m.eco_item_emoji()}</label>
                    <div class="flex gap-2">
                      <input id="upgEmoji{upgrade.id}" type="text" bind:value={settings.upgrades[index].emoji} disabled={!canManage || disabled} class={inputClass} />
                      {#if canManage}<EmojiPicker bind:value={settings.upgrades[index].emoji} />{/if}
                    </div>
                  </div>
                  <div class="col-span-2 space-y-1">
                    <label for="upgDesc{upgrade.id}" class={labelClass}>{m.eco_tower_field_description()}</label>
                    <input id="upgDesc{upgrade.id}" type="text" maxlength="300" bind:value={settings.upgrades[index].description} disabled={!canManage || disabled} class={inputClass} />
                  </div>
                  <div class="space-y-1">
                    <label for="upgMax{upgrade.id}" class={labelClass}>{m.eco_tower_upgrade_max_level()}</label>
                    <input id="upgMax{upgrade.id}" type="number" min="1" max="20" bind:value={settings.upgrades[index].maxLevel} disabled={!canManage || disabled} class={inputClass} />
                  </div>
                  <div class="space-y-1">
                    <label for="upgCost{upgrade.id}" class={labelClass}>{m.eco_tower_upgrade_base_cost({ currency: settings.currencyName })}</label>
                    <input id="upgCost{upgrade.id}" type="number" min="1" bind:value={settings.upgrades[index].baseCost} disabled={!canManage || disabled} class={inputClass} />
                  </div>
                  <div class="col-span-2 space-y-1" title={m.eco_tower_upgrade_growth_hint()}>
                    <label for="upgGrowth{upgrade.id}" class={labelClass}>{m.eco_tower_upgrade_growth()}</label>
                    <input id="upgGrowth{upgrade.id}" type="number" min="0" max="300" bind:value={settings.upgrades[index].costGrowthPercent} disabled={!canManage || disabled} class={inputClass} />
                    <p class="text-2xs text-on-surface-variant/50 leading-relaxed ml-2">{m.eco_tower_upgrade_growth_hint()}</p>
                  </div>
                </div>
                <p class="text-2xs text-on-surface-variant/70 flex items-center gap-1 flex-wrap">
                  {m.eco_tower_upgrade_costs({ list: upgradeCosts(upgrade) })} {@render shardIcon(11)}
                </p>
              </div>
            {/each}
          </div>
        {/if}

        {@render saveBar()}
      </div>

      <!-- Articles -->
      <div class={cardClass}>
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/15 pb-4">
          <div>
            <h3 class="text-lg font-semibold">{m.eco_tower_items_title()}</h3>
            <p class="text-xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-2xl">{m.eco_tower_items_desc()}</p>
          </div>
          {#if canManage}
            <button type="button" onclick={() => openNew('SHOP')} disabled={disabled || rewards.length >= limits.rewardsMax} class="px-4 py-2.5 bg-primary hover:bg-primary-hover text-on-primary text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50">
              <Papicon icon="Plus" size={14} /> {m.eco_tower_new_shop_btn()}
            </button>
          {/if}
        </div>
        {#if shopRewards.length === 0}
          <p class="text-xs text-on-surface-variant/60 italic">{m.eco_tower_shop_empty()}</p>
        {:else}
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {#each shopRewards as reward (reward.id)}{@render rewardCard(reward)}{/each}
          </div>
        {/if}
        <p class="text-2xs text-on-surface-variant/50 leading-relaxed">{m.eco_tower_rewards_desc()}</p>
      </div>
    {:else if tab === 'merchant'}
      <div class={cardClass}>
        <div class="border-b border-outline-variant/15 pb-4">
          <h3 class="text-lg font-semibold">{m.eco_tower_merchant_title()}</h3>
          <p class="text-xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-2xl">{m.eco_tower_merchant_desc()}</p>
        </div>

        <div class="space-y-2">
          <p class="text-xs font-semibold">{m.eco_tower_merchant_offers()}</p>
          <div class="flex flex-wrap gap-2">
            {#each OFFERS as offer}
              <label class="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-outline-variant/15 bg-surface-container-high/30" title={offerTip(offer)}>
                <input type="checkbox" checked={settings.merchant.offers.includes(offer)} disabled={!canManage || disabled} onchange={() => toggleOffer(offer)} />
                {offerLabel(offer)}
              </label>
            {/each}
          </div>
          <p class="text-2xs text-on-surface-variant/50 ml-2">{m.eco_tower_merchant_offers_hint()}</p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {#each OFFERS as offer}
            <div class="bg-surface-container-high/30 border border-outline-variant/10 rounded-xl p-4 space-y-3" title={offerTip(offer)}>
              <p class="text-sm font-bold flex items-center gap-2">
                <span class="text-primary flex"><Papicon icon={offer === 'POTION' ? 'FlaskConical' : offer === 'HEAL' ? 'Heart' : 'Swords'} size={14} /></span>
                {offerLabel(offer)}
              </p>
              <p class="text-2xs text-on-surface-variant/60">{offerTip(offer)}</p>
              {#if offer === 'POTION'}
                {@render merchantField('merchPotion', m.eco_tower_merchant_base_price(), 'potionPrice', 1, 100000)}
                {@render merchantField('merchPotionFloor', m.eco_tower_merchant_per_floor(), 'potionPricePerFloor', 0, 10000)}
              {:else if offer === 'HEAL'}
                {@render merchantField('merchHeal', m.eco_tower_merchant_base_price(), 'healPrice', 1, 100000)}
                {@render merchantField('merchHealFloor', m.eco_tower_merchant_per_floor(), 'healPricePerFloor', 0, 10000)}
                {@render merchantField('merchHealPercent', m.eco_tower_merchant_heal_percent(), 'healPercent', 5, 100)}
              {:else}
                {@render merchantField('merchGear', m.eco_tower_merchant_base_price(), 'gearPrice', 1, 100000)}
                {@render merchantField('merchGearFloor', m.eco_tower_merchant_per_floor(), 'gearPricePerFloor', 0, 10000)}
              {/if}
            </div>
          {/each}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {@render merchantField('merchPotionHeal', m.eco_tower_merchant_potion_heal(), 'potionHealPercent', 5, 100, m.eco_tower_merchant_potion_heal_hint())}
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-2xs">
          {#each merchantPreview as row}
            <div class="bg-surface-container-high/30 rounded-lg px-3 py-2 space-y-0.5">
              <p class="text-on-surface-variant/60">{m.eco_tower_merchant_preview({ floor: row.floor })}</p>
              <p class="flex items-center gap-1" title={m.eco_tower_merchant_potion()}><Papicon icon="FlaskConical" size={11} /> {row.potion} <Papicon icon="Coins" size={10} /></p>
              <p class="flex items-center gap-1" title={m.eco_tower_merchant_heal()}><Papicon icon="Heart" size={11} /> {row.heal} <Papicon icon="Coins" size={10} /></p>
              <p class="flex items-center gap-1" title={m.eco_tower_merchant_gear()}><Papicon icon="Swords" size={11} /> {row.gear} <Papicon icon="Coins" size={10} /></p>
            </div>
          {/each}
        </div>

        {@render saveBar()}
      </div>
    {:else if tab === 'milestones'}
      <div class={cardClass}>
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/15 pb-4">
          <div>
            <h3 class="text-lg font-semibold">{m.eco_tower_milestones_title()}</h3>
            <p class="text-xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-2xl">{m.eco_tower_guide_milestones()} {m.eco_tower_guide_floor()}</p>
          </div>
          {#if canManage}
            <button type="button" onclick={() => openNew('MILESTONE')} disabled={disabled || rewards.length >= limits.rewardsMax} class="px-4 py-2.5 bg-primary hover:bg-primary-hover text-on-primary text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50">
              <Papicon icon="Trophy" size={14} /> {m.eco_tower_new_milestone_btn()}
            </button>
          {/if}
        </div>
        {#if milestones.length === 0}
          <p class="text-xs text-on-surface-variant/60 italic">{m.eco_tower_milestones_empty()}</p>
        {:else}
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {#each milestones as reward (reward.id)}{@render rewardCard(reward)}{/each}
          </div>
        {/if}
      </div>
    {:else}
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
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2" title={m.eco_tower_season_reset_milestones_hint()}>
                <ToggleSwitch checked={resetMilestones} disabled={disabled} ariaLabel={m.eco_tower_season_reset_milestones()} onToggle={(value: boolean) => { resetMilestones = value; }} />
                <span class="text-2xs font-semibold text-on-surface-variant/70">{m.eco_tower_season_reset_milestones()}</span>
              </div>
              <button type="button" onclick={newSeason} disabled={disabled} title={m.eco_tower_season_confirm_desc()} class="px-4 py-2.5 bg-warning/10 hover:bg-warning/20 text-warning text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50">
                <Papicon icon="RotateCcw" size={14} /> {m.eco_tower_season_btn()}
              </button>
            </div>
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
                <span class="font-bold text-warning">{m.eco_tower_milestone_floor({ floor: entry.bestFloor })}</span>
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    {/if}
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
            <input id="rewardEmoji" type="text" bind:value={editing.emoji} placeholder={m.eco_tower_emoji_default_hint()} class={inputClass} />
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
