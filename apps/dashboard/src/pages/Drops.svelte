<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { authStore } from '../lib/stores/auth.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { unsavedChanges } from '../lib/stores/unsavedChanges.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import SearchableSelect from '../lib/components/SearchableSelect.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';
  import { m, dateLocale } from '../lib/i18n';
  import {
    fetchDiscordChannels,
    fetchDropsData,
    updateDropGlobalSettings,
    updateDropTypeSettings,
    type DropConfigEntry,
    type DropHistoryEntry,
  } from '../lib/api';
  import {
    DEFAULT_DROP_GLOBAL_SETTINGS,
    DROP_AMOUNT_RANGE,
    DROP_INTERVAL_MINUTES_RANGE,
    DROP_LIFETIME_MINUTES_RANGE,
    DROP_RACE_WINNERS_RANGE,
    DROP_TYPES,
    DROP_WINDOW_MINUTES_RANGE,
    defaultDropTypeSettings,
    enabledDropModes,
    type DropGlobalSettings,
    type DropType,
  } from '@kotbo/shared';

  const actionState = createAsyncActionState();
  let loading = $state(false);

  let activeTab = $state<'global' | DropType>('global');
  // L'onglet actif retombe sur un type concret : le gabarit d'un onglet de
  // ressource ne doit jamais être instancié avec l'onglet global.
  const activeType = $derived<DropType>(activeTab === 'global' ? 'XP' : activeTab);

  let globalSettings = $state<DropGlobalSettings>({ ...DEFAULT_DROP_GLOBAL_SETTINGS });
  let savedGlobalSettings = $state<DropGlobalSettings>({ ...DEFAULT_DROP_GLOBAL_SETTINGS });

  function blankConfig(type: DropType): DropConfigEntry {
    return { type, nextDropAt: null, ...defaultDropTypeSettings(type) };
  }

  let configs = $state<Record<DropType, DropConfigEntry>>({
    XP: blankConfig('XP'),
    RPG_XP: blankConfig('RPG_XP'),
    CLAN_POINTS: blankConfig('CLAN_POINTS'),
    COINS: blankConfig('COINS'),
  });
  let savedConfigs = $state<Record<DropType, DropConfigEntry>>({
    XP: blankConfig('XP'),
    RPG_XP: blankConfig('RPG_XP'),
    CLAN_POINTS: blankConfig('CLAN_POINTS'),
    COINS: blankConfig('COINS'),
  });

  let recentDrops = $state<DropHistoryEntry[]>([]);
  let availableChannels = $state<any[]>([]);

  const availableRoles = $derived(dashboardStore.state.discordRoles || []);
  // État du module Clans tel que le store le connaît déjà : un drop de points
  // de clan ne crédite personne sans lui. Module absent de la liste = actif,
  // même lecture que ModulePage.
  const clansEnabled = $derived.by(() => {
    const clans = ((dashboardStore.state.modules as any[]) ?? []).find((mod) => mod.id === 'clans');
    return !clans || clans.status === 'active';
  });

  const canManageSettings = $derived(
    !!dashboardStore.state.featureAccess?.leveling?.canConfigure
      || !!dashboardStore.state.access?.canManageSettings
  );

  const TYPE_LABELS: Record<DropType, () => string> = {
    XP: () => m.drop_tab_xp(),
    RPG_XP: () => m.drop_tab_rpg_xp(),
    CLAN_POINTS: () => m.drop_tab_clan_points(),
    COINS: () => m.drop_tab_coins(),
  };

  const TYPE_DESCRIPTIONS: Record<DropType, () => string> = {
    XP: () => m.drop_type_desc_xp(),
    RPG_XP: () => m.drop_type_desc_rpg_xp(),
    CLAN_POINTS: () => m.drop_type_desc_clan_points(),
    COINS: () => m.drop_type_desc_coins(),
  };

  const TYPE_ICONS: Record<DropType, string> = {
    XP: 'Star',
    RPG_XP: 'Sparkles',
    CLAN_POINTS: 'Shield',
    COINS: 'Coins',
  };

  const MODE_LABELS: Record<string, () => string> = {
    FIRST: () => m.drop_mode_first_title(),
    RACE: () => m.drop_mode_race_title(),
    WINDOW: () => m.drop_mode_window_title(),
  };

  function channelName(channelId: string | null): string {
    if (!channelId) return m.drop_option_default_channel();
    const channel = availableChannels.find((c) => c.id === channelId);
    return channel ? `#${channel.name}` : channelId;
  }

  /** Fréquence exprimée en drops par jour : plus parlant qu'un intervalle en minutes. */
  function dropsPerDay(intervalMinutes: number): string {
    const perDay = (24 * 60) / Math.max(DROP_INTERVAL_MINUTES_RANGE.min, intervalMinutes);
    return perDay >= 10 ? String(Math.round(perDay)) : perDay.toFixed(1);
  }

  function modeSummary(config: DropConfigEntry): string {
    const modes = enabledDropModes(config);
    if (modes.length === 0) return m.drop_no_mode_short();
    return modes.map((mode) => MODE_LABELS[mode]()).join(', ');
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' });
  }

  function cloneConfig(config: DropConfigEntry): DropConfigEntry {
    return {
      ...config,
      first: { ...config.first },
      race: { ...config.race },
      window: { ...config.window },
    };
  }

  async function refreshData(silent = false) {
    if (!silent) loading = true;
    try {
      const res = await fetchDropsData();
      if (res) {
        const loadedGlobal: DropGlobalSettings = {
          dropsEnabled: res.dropsEnabled,
          dropChannelId: res.dropChannelId,
          dropMentionRoleId: res.dropMentionRoleId,
          dropLifetimeMinutes: res.dropLifetimeMinutes,
        };
        globalSettings = { ...loadedGlobal };
        savedGlobalSettings = { ...loadedGlobal };

        for (const type of DROP_TYPES) {
          const loaded = res.configs.find((config) => config.type === type) ?? blankConfig(type);
          configs[type] = cloneConfig(loaded);
          savedConfigs[type] = cloneConfig(loaded);
        }

        recentDrops = res.recentDrops ?? [];
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) loading = false;
    }
  }

  // Chaque type a sa propre route : seuls ceux réellement modifiés sont
  // renvoyés, une page qui republie les quatre écraserait un réglage changé
  // entre-temps depuis un autre onglet.
  async function handleSaveSettings(): Promise<boolean> {
    if (!canManageSettings) return false;
    let success = false;

    await actionState.run(async () => {
      if (JSON.stringify(globalSettings) !== JSON.stringify(savedGlobalSettings)) {
        const res = await updateDropGlobalSettings({
          ...globalSettings,
          dropChannelId: globalSettings.dropChannelId || null,
          dropMentionRoleId: globalSettings.dropMentionRoleId || null,
        });
        if (!res) throw new Error(m.drop_save_error());
        globalSettings = { ...res };
        savedGlobalSettings = { ...res };
      }

      for (const type of DROP_TYPES) {
        if (JSON.stringify(configs[type]) === JSON.stringify(savedConfigs[type])) continue;
        const res = await updateDropTypeSettings(type, {
          enabled: configs[type].enabled,
          channelId: configs[type].channelId || null,
          intervalMinutes: configs[type].intervalMinutes,
          first: { ...configs[type].first },
          race: { ...configs[type].race },
          window: { ...configs[type].window },
        });
        if (!res) throw new Error(m.drop_save_error());
        configs[type] = cloneConfig(res);
        savedConfigs[type] = cloneConfig(res);
      }

      success = true;
      return true;
    }, { successMessage: m.drop_save_success() });

    return success;
  }

  $effect(() => {
    const dirty = JSON.stringify(globalSettings) !== JSON.stringify(savedGlobalSettings)
      || DROP_TYPES.some((type) => JSON.stringify(configs[type]) !== JSON.stringify(savedConfigs[type]));

    if (dirty && canManageSettings) {
      untrack(() => {
        unsavedChanges.register({
          id: 'drops',
          label: m.drop_unsaved_label(),
          onSave: () => handleSaveSettings(),
          onReset: () => {
            globalSettings = { ...savedGlobalSettings };
            for (const type of DROP_TYPES) {
              configs[type] = cloneConfig(savedConfigs[type]);
            }
          },
        });
      });
    } else if (!dirty) {
      untrack(() => {
        unsavedChanges.release('drops');
      });
    }
  });

  function handleWsMessage(e: Event) {
    const detail = (e as CustomEvent).detail;
    if (
      detail?.type === 'dashboard_state_changed'
      && detail?.guildId === authStore.selectedGuildId
      && detail?.reason === 'drops_updated'
    ) {
      void refreshData(true);
    }
  }

  onMount(async () => {
    window.addEventListener('kotbo-ws-message', handleWsMessage);
    await dashboardStore.refresh();
    await refreshData();
    const channelsData = await fetchDiscordChannels().catch(() => null);
    if (channelsData) {
      availableChannels = channelsData.textChannels || [];
    }
  });

  onDestroy(() => {
    window.removeEventListener('kotbo-ws-message', handleWsMessage);
    unsavedChanges.release('drops');
  });
</script>

<ModulePage
  title={m.drop_page_title()}
  description={m.drop_page_desc()}
  icon="ArrowDownBox"
  featureKey="drops"
>
  <InlineFeedback state={actionState} />

  <!-- Navigation par Onglets -->
  <div class="flex flex-wrap border-b border-outline-variant/15 mb-6">
    <button
      class="px-5 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer inline-flex items-center gap-2 {activeTab === 'global' ? 'border-primary text-primary font-bold bg-primary/5 rounded-t-lg' : 'border-transparent text-on-surface-variant/70 hover:text-on-surface hover:bg-surface-container-low/30'}"
      onclick={() => activeTab = 'global'}
    >
      <Papicon icon="Gears" size={15} /> {m.drop_tab_global()}
    </button>
    {#each DROP_TYPES as type}
      <button
        class="px-5 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer inline-flex items-center gap-2 {activeTab === type ? 'border-primary text-primary font-bold bg-primary/5 rounded-t-lg' : 'border-transparent text-on-surface-variant/70 hover:text-on-surface hover:bg-surface-container-low/30'}"
        onclick={() => activeTab = type}
      >
        <Papicon icon={TYPE_ICONS[type]} size={15} /> {TYPE_LABELS[type]()}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="space-y-6">
      <Skeleton height="80px" />
      <Skeleton height="300px" />
    </div>
    <div class="flex justify-center mt-4">
      <LoadingHint context="config" />
    </div>
  {:else if activeTab === 'global'}
    <div class="space-y-6" transition:fade={{ duration: 150 }}>
      <section class="bg-surface-container-low/40 border border-outline-variant/30 p-6 rounded-xl space-y-6">
        <div class="flex items-start justify-between gap-4 border-b border-outline-variant/15 pb-3">
          <div>
            <h3 class="text-lg font-semibold flex items-center gap-2"><Papicon icon="Gears" size={18} /> {m.drop_global_heading()}</h3>
            <p class="text-xs text-on-surface-variant/70 mt-1">{m.drop_global_desc()}</p>
          </div>
          <ToggleSwitch checked={globalSettings.dropsEnabled} onToggle={(v) => globalSettings.dropsEnabled = v} disabled={!canManageSettings} />
        </div>

        <p class="text-xs text-on-surface-variant/70">{m.drop_enable_desc()}</p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-1.5">
            <label for="drop-default-channel" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_default_channel_label()}</label>
            <SearchableSelect
              id="drop-default-channel"
              bind:value={globalSettings.dropChannelId}
              options={[{ id: '', name: m.drop_option_none() }, ...availableChannels.map(c => ({ id: c.id, name: `#${c.name}` }))]}
              placeholder={m.drop_select_channel_placeholder()}
              disabled={!canManageSettings}
            />
            <p class="text-[10px] text-on-surface-variant/60 mt-1">{m.drop_default_channel_desc()}</p>
          </div>

          <div class="space-y-1.5">
            <label for="drop-mention-role" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_mention_role_label()}</label>
            <SearchableSelect
              id="drop-mention-role"
              bind:value={globalSettings.dropMentionRoleId}
              options={[{ id: '', name: m.drop_option_none() }, ...availableRoles.map((r: { id: string; name: string }) => ({ id: r.id, name: `@${r.name}` }))]}
              placeholder={m.drop_select_role_placeholder()}
              disabled={!canManageSettings}
            />
            <p class="text-[10px] text-on-surface-variant/60 mt-1">{m.drop_mention_role_desc()}</p>
          </div>

          <div class="space-y-1.5">
            <label for="drop-lifetime" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_lifetime_label()}</label>
            <input
              id="drop-lifetime"
              type="number"
              bind:value={globalSettings.dropLifetimeMinutes}
              min={DROP_LIFETIME_MINUTES_RANGE.min}
              max={DROP_LIFETIME_MINUTES_RANGE.max}
              class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-bold"
              disabled={!canManageSettings}
            />
            <p class="text-[10px] text-on-surface-variant/60 mt-1">{m.drop_lifetime_desc()}</p>
          </div>
        </div>
      </section>

      <section class="bg-surface-container-low/40 border border-outline-variant/30 p-6 rounded-xl space-y-4">
        <div class="border-b border-outline-variant/15 pb-3">
          <h3 class="text-lg font-semibold flex items-center gap-2"><Papicon icon="List" size={18} /> {m.drop_overview_heading()}</h3>
          <p class="text-xs text-on-surface-variant/70 mt-1">{m.drop_overview_desc()}</p>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest">
                <th class="py-2 pr-4">{m.drop_overview_col_type()}</th>
                <th class="py-2 pr-4">{m.drop_overview_col_state()}</th>
                <th class="py-2 pr-4">{m.drop_overview_col_channel()}</th>
                <th class="py-2 pr-4">{m.drop_overview_col_interval()}</th>
                <th class="py-2">{m.drop_overview_col_modes()}</th>
              </tr>
            </thead>
            <tbody>
              {#each DROP_TYPES as type}
                <tr class="text-sm border-t border-outline-variant/10">
                  <td class="py-2.5 pr-4 font-semibold inline-flex items-center gap-2">
                    <Papicon icon={TYPE_ICONS[type]} size={15} /> {TYPE_LABELS[type]()}
                  </td>
                  <td class="py-2.5 pr-4">
                    <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full {configs[type].enabled && globalSettings.dropsEnabled ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-surface-container-high/60 text-on-surface-variant/60'}">
                      {configs[type].enabled && globalSettings.dropsEnabled ? m.drop_state_on() : m.drop_state_off()}
                    </span>
                  </td>
                  <td class="py-2.5 pr-4 text-on-surface-variant/80">{channelName(configs[type].channelId)}</td>
                  <td class="py-2.5 pr-4 text-on-surface-variant/80">{m.drop_interval_hint({ count: dropsPerDay(configs[type].intervalMinutes) })}</td>
                  <td class="py-2.5 text-on-surface-variant/80">{modeSummary(configs[type])}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="bg-surface-container-low/40 border border-outline-variant/30 p-6 rounded-xl space-y-4">
        <div class="border-b border-outline-variant/15 pb-3">
          <h3 class="text-lg font-semibold flex items-center gap-2"><Papicon icon="Clock" size={18} /> {m.drop_history_heading()}</h3>
          <p class="text-xs text-on-surface-variant/70 mt-1">{m.drop_history_desc()}</p>
        </div>

        {#if recentDrops.length === 0}
          <p class="py-8 text-center text-xs text-on-surface-variant/60 italic">{m.drop_history_empty()}</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest">
                  <th class="py-2 pr-4">{m.drop_history_col_date()}</th>
                  <th class="py-2 pr-4">{m.drop_history_col_type()}</th>
                  <th class="py-2 pr-4">{m.drop_history_col_mode()}</th>
                  <th class="py-2 pr-4">{m.drop_history_col_amount()}</th>
                  <th class="py-2">{m.drop_history_col_claims()}</th>
                </tr>
              </thead>
              <tbody>
                {#each recentDrops as drop (drop.id)}
                  <tr class="text-sm border-t border-outline-variant/10">
                    <td class="py-2.5 pr-4 text-on-surface-variant/80 whitespace-nowrap">{formatDate(drop.createdAt)}</td>
                    <td class="py-2.5 pr-4 font-semibold">{TYPE_LABELS[drop.type]?.() ?? drop.type}</td>
                    <td class="py-2.5 pr-4 text-on-surface-variant/80">{MODE_LABELS[drop.mode]?.() ?? drop.mode}</td>
                    <td class="py-2.5 pr-4 font-bold">{drop.amount.toLocaleString(dateLocale())}</td>
                    <td class="py-2.5 text-on-surface-variant/80">
                      {drop.maxClaims > 0
                        ? `${drop.claimCount} / ${drop.maxClaims}`
                        : m.drop_history_unlimited({ count: drop.claimCount })}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    </div>
  {:else}
    {@const type = activeType}
    <div class="space-y-6" transition:fade={{ duration: 150 }}>
      <section class="bg-surface-container-low/40 border border-outline-variant/30 p-6 rounded-xl space-y-6">
        <div class="flex items-start justify-between gap-4 border-b border-outline-variant/15 pb-3">
          <div>
            <h3 class="text-lg font-semibold flex items-center gap-2">
              <Papicon icon={TYPE_ICONS[type]} size={18} /> {TYPE_LABELS[type]()}
            </h3>
            <p class="text-xs text-on-surface-variant/70 mt-1">{TYPE_DESCRIPTIONS[type]()}</p>
          </div>
          <ToggleSwitch checked={configs[type].enabled} onToggle={(v) => configs[type].enabled = v} disabled={!canManageSettings} />
        </div>

        <p class="text-xs text-on-surface-variant/70">{m.drop_type_enable_desc()}</p>

        {#if !globalSettings.dropsEnabled}
          <p class="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
            {m.drop_enable_desc()}
          </p>
        {/if}

        {#if type === 'CLAN_POINTS' && !clansEnabled}
          <p class="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
            {m.drop_clans_disabled_warning()}
          </p>
        {/if}

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-1.5">
            <label for="drop-channel-{type}" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_channel_label()}</label>
            <SearchableSelect
              id="drop-channel-{type}"
              bind:value={configs[type].channelId}
              options={[{ id: '', name: m.drop_option_default_channel() }, ...availableChannels.map(c => ({ id: c.id, name: `#${c.name}` }))]}
              placeholder={m.drop_select_channel_placeholder()}
              disabled={!canManageSettings}
            />
            <p class="text-[10px] text-on-surface-variant/60 mt-1">{m.drop_channel_desc()}</p>
          </div>

          <div class="space-y-1.5">
            <label for="drop-interval-{type}" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_interval_label()}</label>
            <input
              id="drop-interval-{type}"
              type="number"
              bind:value={configs[type].intervalMinutes}
              min={DROP_INTERVAL_MINUTES_RANGE.min}
              max={DROP_INTERVAL_MINUTES_RANGE.max}
              class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-bold"
              disabled={!canManageSettings}
            />
            <p class="text-[10px] text-primary font-semibold mt-1">{m.drop_interval_hint({ count: dropsPerDay(configs[type].intervalMinutes) })}</p>
            <p class="text-[10px] text-on-surface-variant/60">{m.drop_interval_desc()}</p>
          </div>
        </div>
      </section>

      <section class="bg-surface-container-low/40 border border-outline-variant/30 p-6 rounded-xl space-y-5">
        <div class="border-b border-outline-variant/15 pb-3">
          <h3 class="text-lg font-semibold flex items-center gap-2"><Papicon icon="Tasks" size={18} /> {m.drop_modes_heading()}</h3>
          <p class="text-xs text-on-surface-variant/70 mt-1">{m.drop_modes_desc()}</p>
        </div>

        {#if enabledDropModes(configs[type]).length === 0}
          <p class="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
            {m.drop_no_mode_warning()}
          </p>
        {/if}

        <div class="bg-surface-container-high/20 border border-outline-variant/10 rounded-lg p-5 space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h4 class="text-sm font-bold">{m.drop_mode_first_title()}</h4>
              <p class="text-[11px] text-on-surface-variant/70 mt-0.5">{m.drop_mode_first_desc()}</p>
            </div>
            <ToggleSwitch checked={configs[type].first.enabled} onToggle={(v) => configs[type].first.enabled = v} disabled={!canManageSettings} />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label for="drop-first-min-{type}" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_mode_min_label()}</label>
              <input
                id="drop-first-min-{type}"
                type="number"
                bind:value={configs[type].first.minAmount}
                min={DROP_AMOUNT_RANGE.min}
                max={DROP_AMOUNT_RANGE.max}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-bold"
                disabled={!canManageSettings}
              />
            </div>
            <div class="space-y-1.5">
              <label for="drop-first-max-{type}" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_mode_max_label()}</label>
              <input
                id="drop-first-max-{type}"
                type="number"
                bind:value={configs[type].first.maxAmount}
                min={DROP_AMOUNT_RANGE.min}
                max={DROP_AMOUNT_RANGE.max}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-bold"
                disabled={!canManageSettings}
              />
            </div>
          </div>
        </div>

        <div class="bg-surface-container-high/20 border border-outline-variant/10 rounded-lg p-5 space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h4 class="text-sm font-bold">{m.drop_mode_race_title()}</h4>
              <p class="text-[11px] text-on-surface-variant/70 mt-0.5">{m.drop_mode_race_desc()}</p>
            </div>
            <ToggleSwitch checked={configs[type].race.enabled} onToggle={(v) => configs[type].race.enabled = v} disabled={!canManageSettings} />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="space-y-1.5">
              <label for="drop-race-winners-{type}" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_race_winners_label()}</label>
              <input
                id="drop-race-winners-{type}"
                type="number"
                bind:value={configs[type].race.winnerCount}
                min={DROP_RACE_WINNERS_RANGE.min}
                max={DROP_RACE_WINNERS_RANGE.max}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-bold"
                disabled={!canManageSettings}
              />
            </div>
            <div class="space-y-1.5">
              <label for="drop-race-min-{type}" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_mode_min_label()}</label>
              <input
                id="drop-race-min-{type}"
                type="number"
                bind:value={configs[type].race.minAmount}
                min={DROP_AMOUNT_RANGE.min}
                max={DROP_AMOUNT_RANGE.max}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-bold"
                disabled={!canManageSettings}
              />
            </div>
            <div class="space-y-1.5">
              <label for="drop-race-max-{type}" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_mode_max_label()}</label>
              <input
                id="drop-race-max-{type}"
                type="number"
                bind:value={configs[type].race.maxAmount}
                min={DROP_AMOUNT_RANGE.min}
                max={DROP_AMOUNT_RANGE.max}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-bold"
                disabled={!canManageSettings}
              />
            </div>
          </div>
        </div>

        <div class="bg-surface-container-high/20 border border-outline-variant/10 rounded-lg p-5 space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h4 class="text-sm font-bold">{m.drop_mode_window_title()}</h4>
              <p class="text-[11px] text-on-surface-variant/70 mt-0.5">{m.drop_mode_window_desc()}</p>
            </div>
            <ToggleSwitch checked={configs[type].window.enabled} onToggle={(v) => configs[type].window.enabled = v} disabled={!canManageSettings} />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="space-y-1.5">
              <label for="drop-window-duration-{type}" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_window_duration_label()}</label>
              <input
                id="drop-window-duration-{type}"
                type="number"
                bind:value={configs[type].window.durationMinutes}
                min={DROP_WINDOW_MINUTES_RANGE.min}
                max={DROP_WINDOW_MINUTES_RANGE.max}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-bold"
                disabled={!canManageSettings}
              />
            </div>
            <div class="space-y-1.5">
              <label for="drop-window-min-{type}" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_mode_min_label()}</label>
              <input
                id="drop-window-min-{type}"
                type="number"
                bind:value={configs[type].window.minAmount}
                min={DROP_AMOUNT_RANGE.min}
                max={DROP_AMOUNT_RANGE.max}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-bold"
                disabled={!canManageSettings}
              />
            </div>
            <div class="space-y-1.5">
              <label for="drop-window-max-{type}" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.drop_mode_max_label()}</label>
              <input
                id="drop-window-max-{type}"
                type="number"
                bind:value={configs[type].window.maxAmount}
                min={DROP_AMOUNT_RANGE.min}
                max={DROP_AMOUNT_RANGE.max}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-bold"
                disabled={!canManageSettings}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  {/if}
</ModulePage>
