<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { router } from 'tinro';
  import { resolveTabFromUrl, gotoTab } from '../lib/tabRouting';
  import { unsavedChanges } from '../lib/stores/unsavedChanges.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
import EmojiPicker from '../lib/components/EmojiPicker.svelte';
  import EconomyPresetPicker from '../lib/components/EconomyPresetPicker.svelte';
  import { findEconomyPreset, type EconomyPreset, type EconomyPresetValues } from '../lib/economyPresets';
  import {
    fetchEconomyConfig,
    updateEconomyConfig,
    fetchRpgItems,
    saveRpgItem,
    deleteRpgItem,
    fetchRpgPlayers,
    updateRpgPlayer,
    resetEconomy
  } from '../lib/api';
  import { m } from '../lib/i18n';

  const actionState = createAsyncActionState();
  let loading = $state(false);
  const economyTabs = ['accueil', 'config', 'items', 'players'] as const;
  const DEFAULT_TAB = 'accueil';
  let activeTab = $state(DEFAULT_TAB);

  $effect(() => {
    const _path = $router.path;
    activeTab = resolveTabFromUrl('/economy', economyTabs, DEFAULT_TAB);
  });

  const canManageSettings = $derived(
    !!dashboardStore.state.featureAccess?.economy?.canConfigure
      || !!dashboardStore.state.access?.canManageSettings
  );

  const DEFAULT_CONFIG = {
    enabled: false,
    rpgEnabled: false,
    guildsEnabled: false,
    shopEnabled: false,
    currencyName: 'KotboCoins',
    currencyEmoji: '🪙',
    currencyIcon: null as string | null,
    dailyRewardMin: 50,
    dailyRewardMax: 150,
    dailyCooldownHour: 20,
    adventureCooldownMin: 30,
    maxEnergy: 100,
    energyRecoveryPerHour: 10,
    maxBetAmount: 1000,
    maxDailyBets: 20,
    maxTransferAmount: 5000,
    transferCooldownMin: 15
  };

  // Configuration state
  let config = $state(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));

  let savedConfig = $state(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));

  // Shop items list
  let items = $state<any[]>([]);
  let itemsLoading = $state(false);
  let editingItem = $state<any>(null); // For Item Modal

  // Players list
  let players = $state<any[]>([]);
  let playersLoading = $state(false);
  let editingPlayer = $state<any>(null); // For Player Modal
  let searchQuery = $state('');

  // Reset component state
  let resetComponent = $state<'all' | 'profiles' | 'items' | 'config' | 'guilds' | null>(null);

  function triggerReset(component: 'all' | 'profiles' | 'items' | 'config' | 'guilds') {
    resetComponent = component;
  }

  async function confirmReset() {
    if (!resetComponent) return;
    const comp = resetComponent;
    resetComponent = null;

    await actionState.run(async () => {
      await resetEconomy(comp);
      if (comp === 'config' || comp === 'all') {
        const res = await fetchEconomyConfig();
        if (res && res.config) {
          config = res.config;
          savedConfig = JSON.parse(JSON.stringify(res.config));
        }
      }
      if (comp === 'items' || comp === 'all') {
        if (activeTab === 'items') await loadItems();
      }
      if (comp === 'profiles' || comp === 'all') {
        if (activeTab === 'players') await loadPlayers();
      }
      return true;
    }, { successMessage: m.eco_toast_reset_success() });
  }

  // Rythmes de la page d'accueil : ils ne touchent qu'aux gains et a l'energie.
  // Le nom de la monnaie et les modules RPG, boutique et guildes restent a
  // regler dans les onglets, un rythme n'ayant aucun moyen de les deviner.
  const selectedPreset = $derived(findEconomyPreset(config));
  const activePreset = $derived(findEconomyPreset(savedConfig));
  const configDirty = $derived(JSON.stringify(config) !== JSON.stringify(savedConfig));

  function economyValuesOf(source: typeof config): EconomyPresetValues {
    return {
      dailyRewardMin: source.dailyRewardMin,
      dailyRewardMax: source.dailyRewardMax,
      dailyCooldownHour: source.dailyCooldownHour,
      adventureCooldownMin: source.adventureCooldownMin,
      maxEnergy: source.maxEnergy,
      energyRecoveryPerHour: source.energyRecoveryPerHour,
    };
  }

  // Des qu'un rythme est choisi, la configuration courante est la sienne : la
  // carte « Personnalise » doit alors montrer la configuration enregistree,
  // sans quoi elle devient le sosie de la carte qu'on vient de cliquer.
  const customPresetValues = $derived(economyValuesOf(selectedPreset ? savedConfig : config));

  function applyEconomyPreset(preset: EconomyPreset) {
    if (!canManageSettings) return;
    Object.assign(config, preset.values);
  }

  // La carte « Personnalise » n'a rien a appliquer : elle affiche deja la
  // configuration en place, elle ouvre juste les onglets.
  function openPresetDetail() {
    gotoTab('/economy', 'config', DEFAULT_TAB);
  }

  // Unsaved changes tracker
  $effect(() => {
    const dirty = configDirty;
    if (dirty && canManageSettings) {
      untrack(() => {
        unsavedChanges.register({
          id: 'economy',
          label: 'Économie & RPG',
          onSave: () => handleSaveConfig(),
          onReset: () => {
            config = JSON.parse(JSON.stringify(savedConfig));
          }
        });
      });
    } else if (!dirty) {
      untrack(() => {
        unsavedChanges.release('economy');
      });
    }
  });

  onDestroy(() => {
    unsavedChanges.release('economy');
  });

  onMount(async () => {
    loading = true;
    try {
      await dashboardStore.refresh();
      const res = await fetchEconomyConfig();
      if (res && res.config) {
        config = res.config;
        savedConfig = JSON.parse(JSON.stringify(res.config));
      }
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  });

  // Tab change triggers loaders
  $effect(() => {
    if (activeTab === 'items') {
      void loadItems();
    } else if (activeTab === 'players') {
      void loadPlayers();
    }
  });

  async function loadItems() {
    itemsLoading = true;
    try {
      const res = await fetchRpgItems();
      if (res && res.items) {
        items = res.items;
      }
    } catch (err) {
      console.error(err);
    } finally {
      itemsLoading = false;
    }
  }

  async function loadPlayers() {
    playersLoading = true;
    try {
      const res = await fetchRpgPlayers();
      if (res && res.players) {
        players = res.players;
      }
    } catch (err) {
      console.error(err);
    } finally {
      playersLoading = false;
    }
  }

  async function handleSaveConfig(): Promise<boolean> {
    if (!canManageSettings) return false;
    if (config.dailyRewardMax < config.dailyRewardMin) {
      toast.error(m.eco_toast_daily_invalid());
      return false;
    }

    let success = false;
    await actionState.run(async () => {
      const res = await updateEconomyConfig(config);
      if (!res || !res.config) throw new Error('Erreur de sauvegarde de la configuration.');
      config = res.config;
      savedConfig = JSON.parse(JSON.stringify(res.config));
      success = true;
      return true;
    }, { successMessage: m.eco_toast_config_saved() });
    return success;
  }

  // Shop Item CRUD actions
  function openNewItem() {
    editingItem = {
      name: '',
      description: '',
      emoji: '📦',
      type: 'POTION',
      atkBonus: 0,
      defBonus: 0,
      spdBonus: 0,
      hpRestore: 0,
      energyRestore: 0,
      price: 10,
      purchasable: true
    };
  }

  function openEditItem(item: any) {
    editingItem = { ...item };
  }

  async function handleSaveItem() {
    if (!editingItem.name || !editingItem.type || editingItem.price === undefined) {
      toast.error(m.eco_toast_missing_fields());
      return;
    }

    await actionState.run(async () => {
      const res = await saveRpgItem(editingItem);
      if (res && res.item) {
        await loadItems();
        editingItem = null;
      }
      return true;
    }, { successMessage: m.eco_toast_item_saved() });
  }

  async function handleDeleteItem(itemId: string) {
    if (!(await confirmDialog.danger(m.eco_delete_item_confirm()))) return;

    await actionState.run(async () => {
      await deleteRpgItem(itemId);
      await loadItems();
      return true;
    }, { successMessage: m.eco_toast_item_deleted() });
  }

  // Player Editing actions
  function openEditPlayer(player: any) {
    editingPlayer = { ...player };
  }

  async function handleSavePlayer() {
    await actionState.run(async () => {
      const res = await updateRpgPlayer(editingPlayer.userId, {
        balance: editingPlayer.balance,
        level: editingPlayer.level,
        xp: editingPlayer.xp,
        health: editingPlayer.health,
        energy: editingPlayer.energy,
        attack: editingPlayer.attack,
        defense: editingPlayer.defense,
        speed: editingPlayer.speed
      });
      if (res && res.player) {
        await loadPlayers();
        editingPlayer = null;
      }
      return true;
    }, { successMessage: m.eco_toast_player_saved() });
  }

  const filteredPlayers = $derived(
    players.filter(p => 
      p.userId.includes(searchQuery) || 
      (p.username && p.username.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.displayName && p.displayName.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );
</script>

<ModulePage
  title={m.eco_page_title()}
  description={m.eco_page_desc()}
  icon="coins"
>
  {#snippet actions()}
    {#if !loading}
      <button
        type="button"
        onclick={() => gotoTab('/economy', activeTab === 'accueil' ? 'config' : 'accueil', DEFAULT_TAB)}
        class="group flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold bg-primary text-on-primary shadow-md shadow-primary/20 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 transition-all"
      >
        <Papicon icon={activeTab === 'accueil' ? 'Settings' : 'ArrowLeft'} size={15} />
        {activeTab === 'accueil' ? m.eco_presets_open_advanced() : m.eco_presets_back()}
        {#if activeTab === 'accueil'}
          <Papicon icon="ChevronRight" size={14} class="transition-transform group-hover:translate-x-0.5" />
        {/if}
      </button>
      <div class="flex items-center gap-3 bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5">
        <span class="text-xs font-bold text-on-surface-variant/80">{m.eco_module_status()}</span>
        <ToggleSwitch
          checked={config.enabled}
          onToggle={(v: boolean) => {
            config.enabled = v;
          }}
          disabled={!canManageSettings}
        />
      </div>
    {/if}
  {/snippet}

  <InlineFeedback state={actionState} />

  <!-- Navigation Tabs -->
  {#if activeTab !== 'accueil'}
  <div class="tab-group w-fit">
    <button 
      onclick={() => gotoTab('/economy', 'config', DEFAULT_TAB)}
      class="tab-button {activeTab === 'config' ? 'active' : ''}"
    >
      <Papicon icon="settings" size={14} />
      {m.eco_tab_config()}
    </button>
    <button
      onclick={() => gotoTab('/economy', 'items', DEFAULT_TAB)}
      class="tab-button {activeTab === 'items' ? 'active' : ''}"
    >
      <Papicon icon="package" size={14} />
      {m.eco_tab_items()}
    </button>
    <button
      onclick={() => gotoTab('/economy', 'players', DEFAULT_TAB)}
      class="tab-button {activeTab === 'players' ? 'active' : ''}"
    >
      <Papicon icon="users" size={14} />
      {m.eco_tab_players()}
    </button>
  </div>
  {/if}

  {#if loading}
    <Skeleton height="350px" radius="2.5rem" />
    <div class="flex justify-center mt-4">
      <LoadingHint context="config" />
    </div>
  {:else if activeTab === 'accueil'}
    <EconomyPresetPicker
      selectedId={selectedPreset?.id ?? null}
      activeId={activePreset?.id ?? null}
      customValues={customPresetValues}
      currencyName={config.currencyName}
      disabled={!canManageSettings}
      dirty={configDirty}
      saving={actionState.state.loading}
      moduleEnabled={config.enabled}
      onselect={applyEconomyPreset}
      onsave={handleSaveConfig}
      ondetail={openPresetDetail}
    />
  {:else}
    <!-- Tab 1: Configuration -->
    {#if activeTab === 'config'}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- Activation settings -->
        <div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6 h-fit">
          <h3 class="text-lg font-semibold border-b border-outline-variant/15 pb-4">{m.eco_activation_title()}</h3>
          
          <div class="space-y-4">
            <!-- RPG Toggle -->
            <div class="flex items-center justify-between py-2 border-b border-outline-variant/5">
              <div>
                <h4 class="text-sm font-bold">{m.eco_rpg_toggle_title()}</h4>
                <p class="text-xs text-on-surface-variant/60 mt-0.5">{m.eco_rpg_toggle_desc()}</p>
              </div>
              <ToggleSwitch checked={config.rpgEnabled} onToggle={(v: boolean) => config.rpgEnabled = v} disabled={!canManageSettings || !config.enabled} />
            </div>

            <!-- Shop Toggle -->
            <div class="flex items-center justify-between py-2 border-b border-outline-variant/5">
              <div>
                <h4 class="text-sm font-bold">{m.eco_shop_toggle_title()}</h4>
                <p class="text-xs text-on-surface-variant/60 mt-0.5">{m.eco_shop_toggle_desc()}</p>
              </div>
              <ToggleSwitch checked={config.shopEnabled} onToggle={(v: boolean) => config.shopEnabled = v} disabled={!canManageSettings || !config.enabled} />
            </div>

            <!-- Guilds Toggle -->
            <div class="flex items-center justify-between py-2">
              <div>
                <h4 class="text-sm font-bold">{m.eco_guilds_toggle_title()}</h4>
                <p class="text-xs text-on-surface-variant/60 mt-0.5">{m.eco_guilds_toggle_desc()}</p>
              </div>
              <ToggleSwitch checked={config.guildsEnabled} onToggle={(v: boolean) => config.guildsEnabled = v} disabled={!canManageSettings || !config.enabled} />
            </div>
          </div>
        </div>

        <!-- Details config -->
        <div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6 transition-opacity duration-300 {!config.enabled ? 'opacity-60' : ''}">
          <h3 class="text-lg font-semibold border-b border-outline-variant/15 pb-4">{m.eco_settings_title()}</h3>
          
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label for="curName" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_currency_name()}</label>
              <input id="curName" type="text" bind:value={config.currencyName} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
            </div>

            <div class="space-y-1.5">
              <label for="curEmoji" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_currency_emoji()}</label>
              <div class="flex gap-2">
                <input id="curEmoji" type="text" bind:value={config.currencyEmoji} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
                <EmojiPicker bind:value={config.currencyEmoji} disabled={!canManageSettings || !config.enabled} />
              </div>
            </div>

            <!-- Currency Image Upload -->
            <div class="col-span-2 space-y-2 pt-2 border-t border-outline-variant/10">
              <span class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2 block">{m.eco_currency_icon()}</span>
              <div class="flex items-center gap-4 bg-surface-container-high/20 p-4 rounded-lg border border-outline-variant/10">
                {#if config.currencyIcon}
                  <!-- L'overflow-hidden qui arrondit l'apercu vit sur le cadre
                       interieur : porte par ce conteneur, il rognait la croix
                       posee en -top-1 -right-1, qui semblait alors faire partie
                       de l'image. -->
                  <div class="relative w-12 h-12 shrink-0">
                    <div class="w-full h-full rounded-xl bg-surface-container overflow-hidden border border-outline-variant/20 flex items-center justify-center">
                      <img src={config.currencyIcon} alt="Icone" class="w-full h-full object-contain" />
                    </div>
                    {#if canManageSettings && config.enabled}
                      <button
                        type="button"
                        onclick={() => { config.currencyIcon = null; }}
                        class="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shadow-sm ring-2 ring-surface-container-high transition-colors"
                        title="Supprimer"
                      >
                        ✕
                      </button>
                    {/if}
                  </div>
                {:else}
                  <div class="w-12 h-12 rounded-xl bg-surface-container/60 border-2 border-dashed border-outline-variant/25 flex items-center justify-center text-on-surface-variant/30 text-[10px] font-semibold shrink-0">
                    {m.eco_no_icon()}
                  </div>
                {/if}

                {#if canManageSettings}
                  <div class="flex-1 space-y-1">
                    <input
                      type="file"
                      id="currencyIconUpload"
                      accept="image/*"
                      class="hidden"
                      disabled={!config.enabled}
                      onchange={(e: Event) => {
                        const file = (e.currentTarget as HTMLInputElement).files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const res = event.target?.result;
                            if (typeof res === 'string') {
                              config.currencyIcon = res;
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onclick={() => document.getElementById('currencyIconUpload')?.click()}
                      class="px-4 py-2 bg-secondary text-on-secondary hover:scale-102 active:scale-98 transition-all text-xs font-bold rounded-xl shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!config.enabled}
                    >
                      {config.currencyIcon ? m.eco_change_icon() : m.eco_upload_icon()}
                    </button>
                    <p class="text-[11px] text-on-surface-variant/40 leading-none">{m.eco_icon_hint()}</p>
                  </div>
                {:else}
                  <p class="text-xs text-on-surface-variant/40 italic">{m.eco_readonly()}</p>
                {/if}
              </div>
            </div>

            <div class="space-y-1.5">
              <label for="dailyMin" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_daily_min()}</label>
              <input id="dailyMin" type="number" bind:value={config.dailyRewardMin} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
            </div>

            <div class="space-y-1.5">
              <label for="dailyMax" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_daily_max()}</label>
              <input id="dailyMax" type="number" bind:value={config.dailyRewardMax} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
            </div>

            <div class="space-y-1.5">
              <label for="dailyCd" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_daily_cd()}</label>
              <input id="dailyCd" type="number" bind:value={config.dailyCooldownHour} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
            </div>

            <div class="space-y-1.5">
              <label for="advCd" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_adv_cd()}</label>
              <input id="advCd" type="number" bind:value={config.adventureCooldownMin} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
            </div>

            <div class="space-y-1.5">
              <label for="maxEnergy" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_max_energy()}</label>
              <input id="maxEnergy" type="number" bind:value={config.maxEnergy} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
            </div>

            <div class="space-y-1.5">
              <label for="energyRecovery" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_energy_recovery()}</label>
              <input id="energyRecovery" type="number" bind:value={config.energyRecoveryPerHour} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
            </div>
          </div>
        </div>

        <!-- Les quatre plafonds que le bot applique deja aux jeux d'argent et
             aux transferts : ils vivaient en base sans aucun ecran pour les
             regler. -->
        <div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6 h-fit">
          <div class="border-b border-outline-variant/15 pb-4">
            <h3 class="text-lg font-semibold">{m.eco_limits_title()}</h3>
            <p class="text-xs text-on-surface-variant/60 mt-1">{m.eco_limits_desc()}</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div class="space-y-1.5">
              <label for="maxBet" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_max_bet()}</label>
              <input id="maxBet" type="number" min="1" bind:value={config.maxBetAmount} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
              <p class="text-[11px] text-on-surface-variant/40">{m.eco_max_bet_hint()}</p>
            </div>

            <div class="space-y-1.5">
              <label for="maxDailyBets" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_max_daily_bets()}</label>
              <input id="maxDailyBets" type="number" min="0" bind:value={config.maxDailyBets} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
            </div>

            <div class="space-y-1.5">
              <label for="maxTransfer" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_max_transfer()}</label>
              <input id="maxTransfer" type="number" min="1" bind:value={config.maxTransferAmount} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
              <p class="text-[11px] text-on-surface-variant/40">{m.eco_max_transfer_hint()}</p>
            </div>

            <div class="space-y-1.5">
              <label for="transferCd" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_transfer_cd()}</label>
              <input id="transferCd" type="number" min="0" bind:value={config.transferCooldownMin} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canManageSettings || !config.enabled} />
            </div>
          </div>
        </div>

        <!-- Reset Economy Section -->
        {#if canManageSettings}
          <div class="col-span-1 lg:col-span-2 bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6 transition-opacity duration-300 {!config.enabled ? 'opacity-60' : ''}">
            <div class="border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold text-error flex items-center gap-2.5">
                <Papicon icon="alert-triangle" size={20} class="text-error" />
                {m.eco_reset_section_title()}
              </h3>
              <p class="text-xs text-on-surface-variant/60 mt-1">{m.eco_reset_section_desc()}</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <button
                type="button"
                onclick={() => triggerReset('profiles')}
                disabled={!config.enabled}
                class="px-5 py-4 bg-error/10 hover:bg-error/20 text-error text-xs font-bold rounded-lg transition-all border border-error/20 flex flex-col items-center justify-center text-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span class="font-semibold flex items-center gap-1.5"><Papicon icon="users" size={14} /> {m.eco_reset_players_btn()}</span>
                <span class="text-[10px] text-on-surface-variant/60 font-normal">{m.eco_reset_players_desc()}</span>
              </button>

              <button
                type="button"
                onclick={() => triggerReset('items')}
                disabled={!config.enabled}
                class="px-5 py-4 bg-error/10 hover:bg-error/20 text-error text-xs font-bold rounded-lg transition-all border border-error/20 flex flex-col items-center justify-center text-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span class="font-semibold flex items-center gap-1.5"><Papicon icon="package" size={14} /> {m.eco_reset_items_btn()}</span>
                <span class="text-[10px] text-on-surface-variant/60 font-normal">{m.eco_reset_items_desc()}</span>
              </button>

              <button
                type="button"
                onclick={() => triggerReset('guilds')}
                disabled={!config.enabled}
                class="px-5 py-4 bg-error/10 hover:bg-error/20 text-error text-xs font-bold rounded-lg transition-all border border-error/20 flex flex-col items-center justify-center text-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span class="font-semibold flex items-center gap-1.5"><Papicon icon="shield" size={14} /> {m.eco_reset_guilds_btn()}</span>
                <span class="text-[10px] text-on-surface-variant/60 font-normal">{m.eco_reset_guilds_desc()}</span>
              </button>

              <button
                type="button"
                onclick={() => triggerReset('config')}
                disabled={!config.enabled}
                class="px-5 py-4 bg-error/10 hover:bg-error/20 text-error text-xs font-bold rounded-lg transition-all border border-error/20 flex flex-col items-center justify-center text-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span class="font-semibold flex items-center gap-1.5"><Papicon icon="settings" size={14} /> {m.eco_reset_config_btn()}</span>
                <span class="text-[10px] text-on-surface-variant/60 font-normal">{m.eco_reset_config_desc()}</span>
              </button>

              <button
                type="button"
                onclick={() => triggerReset('all')}
                disabled={!config.enabled}
                class="px-5 py-4 bg-error text-on-error hover:bg-error-hover text-xs font-bold rounded-lg shadow-lg transition-all flex flex-col items-center justify-center text-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span class="font-semibold flex items-center gap-1.5"><Papicon icon="alert-triangle" size={14} /> {m.eco_reset_all_btn()}</span>
                <span class="text-[10px] text-on-error/80 font-normal">{m.eco_reset_all_desc()}</span>
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Tab 2: Shop Items -->
    {#if activeTab === 'items'}
      <div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6 transition-opacity duration-300 {!config.enabled ? 'opacity-60' : ''}">
        <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
          <h3 class="text-lg font-semibold">{m.eco_shop_title()}</h3>
          {#if canManageSettings}
            <button 
              type="button" 
              onclick={openNewItem}
              disabled={!config.enabled}
              class="px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary text-[13px] font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Papicon icon="plus" size={14} />
              {m.eco_create_item_btn()}
            </button>
          {/if}
        </div>

        {#if itemsLoading}
          <div class="flex items-center justify-center py-12">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {#each items as item}
              <div class="bg-surface-container-high/30 border border-outline-variant/10 p-6 rounded-xl relative group flex flex-col justify-between">
                <div class="space-y-3">
                  <div class="flex items-center gap-3">
                    <span class="text-lg">{item.emoji}</span>
                    <div>
                      <h4 class="font-semibold text-base leading-none">{item.name}</h4>
                      <span class="text-[11px] font-semibold uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full inline-block mt-1">{item.type}</span>
                    </div>
                  </div>
                  <p class="text-xs text-on-surface-variant/60 leading-relaxed">{item.description}</p>
                  
                  <!-- Stat bonuses summary -->
                  <div class="flex flex-wrap gap-1.5 text-[10px] font-bold">
                    {#if item.atkBonus} <span class="bg-red-500/10 text-red-400 px-2 py-0.5 rounded-lg flex items-center gap-1"><Papicon icon="zap" size={10} /> ATK +{item.atkBonus}</span> {/if}
                    {#if item.defBonus} <span class="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-lg flex items-center gap-1"><Papicon icon="shield" size={10} /> DEF +{item.defBonus}</span> {/if}
                    {#if item.spdBonus} <span class="bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-lg flex items-center gap-1"><Papicon icon="activity" size={10} /> SPD +{item.spdBonus}</span> {/if}
                    {#if item.hpRestore} <span class="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-lg flex items-center gap-1"><Papicon icon="heart" size={10} /> HP +{item.hpRestore}</span> {/if}
                    {#if item.energyRestore} <span class="bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-lg flex items-center gap-1"><Papicon icon="zap" size={10} /> ÉNERGIE +{item.energyRestore}</span> {/if}
                  </div>
                </div>

                <div class="mt-6 border-t border-outline-variant/5 pt-4 flex items-center justify-between">
                  <span class="text-sm font-bold text-on-surface flex items-center gap-1.5">
                    {#if config.currencyIcon}
                      <img src={config.currencyIcon} alt={config.currencyName} class="w-4 h-4 object-contain inline-block" />
                    {:else}
                      <span>{config.currencyEmoji}</span>
                    {/if}
                    <span>{item.price} {config.currencyName}</span>
                  </span>
                  
                  {#if canManageSettings && item.guildId}
                    <div class="flex gap-2">
                      <button 
                        type="button" 
                        onclick={() => openEditItem(item)}
                        disabled={!config.enabled}
                        class="p-2 bg-outline-variant/10 hover:bg-outline-variant/20 rounded-lg text-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        title={m.eco_btn_edit()}
                      >
                        <Papicon icon="edit" size={14} />
                      </button>
                      <button 
                        type="button" 
                        onclick={() => handleDeleteItem(item.id)}
                        disabled={!config.enabled}
                        class="p-2 bg-red-500/10 hover:bg-red-500/25 rounded-lg text-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        title={m.fb_delete()}
                      >
                        <Papicon icon="trash" size={14} />
                      </button>
                    </div>
                  {:else}
                    <span class="text-[11px] font-bold text-on-surface-variant/40 italic">{m.eco_global_readonly()}</span>
                  {/if}
                </div>
              </div>
            {:else}
              <p class="text-xs text-on-surface-variant/60 italic py-6">{m.eco_no_items()}</p>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Tab 3: Players list & Leaderboard -->
    {#if activeTab === 'players'}
      <div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6 transition-opacity duration-300 {!config.enabled ? 'opacity-60' : ''}">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/15 pb-4">
          <h3 class="text-lg font-semibold">{m.eco_players_title()}</h3>
          
          <input 
            type="search" 
            placeholder={m.eco_search_players_ph()} 
            bind:value={searchQuery}
            class="bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none w-full md:w-64"
          />
        </div>

        {#if playersLoading}
          <div class="flex items-center justify-center py-12">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="border-b border-outline-variant/10 text-on-surface-variant/55 font-bold uppercase tracking-wider text-[10px]">
                  <th class="py-4 px-4">{m.eco_col_rank()}</th>
                  <th class="py-4 px-4">{m.eco_col_player()}</th>
                  <th class="py-4 px-4">{m.eco_col_balance()}</th>
                  <th class="py-4 px-4">{m.eco_col_stats_gear()}</th>
                  <th class="py-4 px-4">{m.eco_col_hp_energy()}</th>
                  <th class="py-4 px-4">{m.eco_col_location_guild()}</th>
                  {#if canManageSettings}
                    <th class="py-4 px-4 text-right">{m.eco_col_actions()}</th>
                  {/if}
                </tr>
              </thead>
              <tbody>
                {#each filteredPlayers as player, index}
                  <tr class="border-b border-outline-variant/5 hover:bg-surface-container-high/10 transition-colors">
                    <td class="py-4 px-4 font-bold">#{index + 1}</td>
                    <td class="py-4 px-4 flex items-center gap-3">
                      {#if player.avatarUrl}
                        <img src={player.avatarUrl} alt="Avatar" class="w-8 h-8 rounded-full border border-outline-variant/20" />
                      {:else}
                        <div class="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold">U</div>
                      {/if}
                      <div>
                        <div class="font-semibold text-sm">{player.displayName || player.username}</div>
                        <div class="text-[10px] text-on-surface-variant/40 font-mono mt-0.5">{player.userId}</div>
                        <!-- Bento mini-stats -->
                        <div class="flex items-center gap-2 mt-1 text-[9px] font-bold text-on-surface-variant/50">
                          <span class="bg-red-500/5 text-red-400 px-1.5 py-0.5 rounded">⚔️ {player.attack} ATK</span>
                          <span class="bg-blue-500/5 text-blue-400 px-1.5 py-0.5 rounded">🛡️ {player.defense} DEF</span>
                          <span class="bg-amber-500/5 text-amber-400 px-1.5 py-0.5 rounded">⚡ {player.speed} SPD</span>
                        </div>
                      </div>
                    </td>
                    <td class="py-4 px-4 font-bold text-on-surface">
                      <div class="flex items-center gap-1.5">
                        {#if config.currencyIcon}
                          <img src={config.currencyIcon} alt={config.currencyName} class="w-4 h-4 object-contain inline-block" />
                        {:else}
                          <span>{config.currencyEmoji}</span>
                        {/if}
                        <span>{player.balance} {config.currencyName}</span>
                      </div>
                      <div class="text-[10px] text-on-surface-variant/50 mt-0.5 font-normal">{m.eco_player_level_xp({ level: player.level, xp: player.xp })}</div>
                    </td>
                    <td class="py-4 px-4">
                      <!-- Equipment display -->
                      <div class="space-y-1.5">
                        {#if player.weapon}
                          <div class="flex items-center gap-1.5 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-lg w-fit font-bold">
                            <span>{player.weapon.emoji || '⚔️'}</span>
                            <span class="truncate max-w-[120px]">{player.weapon.name} (+{player.weapon.atkBonus} ATK)</span>
                          </div>
                        {:else}
                          <div class="text-[10px] text-on-surface-variant/30 italic">{m.eco_no_weapon()}</div>
                        {/if}

                        {#if player.armor}
                          <div class="flex items-center gap-1.5 text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-lg w-fit font-bold">
                            <span>{player.armor.emoji || '🛡️'}</span>
                            <span class="truncate max-w-[120px]">{player.armor.name} (+{player.armor.defBonus} DEF)</span>
                          </div>
                        {:else}
                          <div class="text-[10px] text-on-surface-variant/30 italic">{m.eco_no_armor()}</div>
                        {/if}
                      </div>
                    </td>
                    <td class="py-4 px-4">
                      <div class="flex items-center gap-2">
                        <div class="w-20 bg-surface-container-high rounded-full h-2">
                          <div class="bg-red-500 h-2 rounded-full" style="width: {Math.round((player.health / player.maxHealth) * 100)}%"></div>
                        </div>
                        <span class="font-bold">{player.health} / {player.maxHealth} HP</span>
                      </div>
                      <div class="flex items-center gap-2 mt-1.5">
                        <div class="w-20 bg-surface-container-high rounded-full h-2">
                          <div class="bg-purple-500 h-2 rounded-full" style="width: {player.energy}%"></div>
                        </div>
                        <span class="font-bold text-on-surface-variant/70">{player.energy}{m.eco_energy_unit()}</span>
                      </div>
                    </td>
                    <td class="py-4 px-4 space-y-1">
                      <!-- Location -->
                      <div class="font-semibold text-on-surface flex items-center gap-1">
                        {#if player.isTraveling}
                          <span>{m.eco_traveling_to()}</span>
                          <span class="text-primary font-bold">{player.travelDestination}</span>
                        {:else}
                          <span>{m.eco_location_at()}</span>
                          <span class="text-emerald-400 font-bold">{player.travelDestination || m.eco_wild_lands()}</span>
                        {/if}
                      </div>
                      <!-- Guild -->
                      <div class="text-[10px] text-on-surface-variant/60 font-medium">
                        {#if player.rpgGuild}
                          <span>{m.eco_alliance()} <strong>{player.rpgGuild.emoji} {player.rpgGuild.name}</strong></span>
                        {:else}
                          <span class="italic text-on-surface-variant/30">{m.eco_no_guild()}</span>
                        {/if}
                      </div>
                    </td>
                    {#if canManageSettings}
                      <td class="py-4 px-4 text-right">
                        <button 
                           type="button" 
                           onclick={() => openEditPlayer(player)}
                           disabled={!config.enabled}
                           class="px-3 py-1.5 bg-outline-variant/10 hover:bg-outline-variant/25 text-xs font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ml-auto w-fit"
                        >
                          <Papicon icon="edit" size={12} /> {m.eco_btn_edit()}
                        </button>
                      </td>
                    {/if}
                  </tr>
                {:else}
                  <tr>
                    <td colspan="7" class="text-center py-8 text-on-surface-variant/50 italic">{m.eco_no_players()}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</ModulePage>

<!-- ITEM MODAL EDITOR -->
{#if editingItem}
  <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div class="bg-surface-container rounded-xl border border-outline-variant/30 p-8 w-full max-w-lg space-y-6 animate-in zoom-in-95 duration-200">
      <h3 class="text-xl font-semibold">{editingItem.id ? m.eco_modal_edit_item() : m.eco_modal_create_item()}</h3>
      
      <div class="space-y-4">
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2 space-y-1">
            <label for="itemName" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_item_name()}</label>
            <input id="itemName" type="text" bind:value={editingItem.name} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
          </div>
          <div class="space-y-1">
            <label for="itemEmoji" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_item_emoji()}</label>
            <div class="flex gap-2">
              <input id="itemEmoji" type="text" bind:value={editingItem.emoji} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
              <EmojiPicker bind:value={editingItem.emoji} />
            </div>
          </div>
        </div>

        <div class="space-y-1">
          <label for="itemDesc" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_item_desc()}</label>
          <textarea id="itemDesc" bind:value={editingItem.description} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none h-16 resize-none"></textarea>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label for="itemType" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_item_type()}</label>
            <select id="itemType" bind:value={editingItem.type} class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none text-on-surface">
              <option value="WEAPON">🗡️ WEAPON (Arme)</option>
              <option value="ARMOR">🦺 ARMOR (Armure)</option>
              <option value="POTION">🧪 POTION (Consommable)</option>
              <option value="QUEST">🔑 QUEST (Quête)</option>
            </select>
          </div>
          <div class="space-y-1">
            <label for="itemPrice" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_item_price({ currency: config.currencyName })}</label>
            <input id="itemPrice" type="number" bind:value={editingItem.price} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
          </div>
        </div>

        <!-- Dynamic inputs depending on item type -->
        <fieldset class="border border-outline-variant/10 p-4 rounded-lg space-y-3">
          <legend class="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant/50 px-2">{m.eco_stats_effects()}</legend>
          {#if editingItem.type === 'WEAPON'}
            <div class="space-y-1">
              <label for="itemAtk" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_atk_bonus()}</label>
              <input id="itemAtk" type="number" bind:value={editingItem.atkBonus} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-xl px-3 py-2 text-xs focus:outline-none" />
            </div>
          {:else if editingItem.type === 'ARMOR'}
            <div class="space-y-1">
              <label for="itemDef" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_def_bonus()}</label>
              <input id="itemDef" type="number" bind:value={editingItem.defBonus} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-xl px-3 py-2 text-xs focus:outline-none" />
            </div>
          {:else if editingItem.type === 'POTION'}
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1">
                <label for="itemHp" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_hp_heal()}</label>
                <input id="itemHp" type="number" bind:value={editingItem.hpRestore} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-xl px-3 py-2 text-xs focus:outline-none" />
              </div>
              <div class="space-y-1">
                <label for="itemEnergy" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.eco_energy_heal()}</label>
                <input id="itemEnergy" type="number" bind:value={editingItem.energyRestore} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-xl px-3 py-2 text-xs focus:outline-none" />
              </div>
            </div>
          {:else}
            <p class="text-xs text-on-surface-variant/50 italic text-center py-2">{m.eco_no_attrs_needed()}</p>
          {/if}
        </fieldset>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-outline-variant/10">
        <button 
          type="button" 
          onclick={() => editingItem = null}
          class="px-5 py-2.5 bg-outline-variant/10 hover:bg-outline-variant/20 rounded-xl text-xs font-bold transition-all"
        >
          {m.eco_btn_cancel()}
        </button>
        <button 
          type="button" 
          onclick={handleSaveItem}
          class="px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary text-[13px] font-medium rounded-lg transition-all"
        >
          {m.eco_btn_save()}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- PLAYER MODAL EDITOR -->
{#if editingPlayer}
  <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div class="bg-surface-container rounded-xl border border-outline-variant/30 p-8 w-full max-w-lg space-y-6 animate-in zoom-in-95 duration-200">
      <h3 class="text-xl font-semibold">{m.eco_modal_edit_player({ name: editingPlayer.displayName || editingPlayer.username })}</h3>
      
      <div class="grid grid-cols-2 gap-4">
        <div class="space-y-1">
          <label for="pBalance" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_balance_currency({ currency: config.currencyName })}</label>
          <input id="pBalance" type="number" bind:value={editingPlayer.balance} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
        </div>

        <div class="space-y-1">
          <label for="pLevel" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_rpg_level()}</label>
          <input id="pLevel" type="number" bind:value={editingPlayer.level} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
        </div>

        <div class="space-y-1">
          <label for="pXp" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_xp()}</label>
          <input id="pXp" type="number" bind:value={editingPlayer.xp} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
        </div>

        <div class="space-y-1">
          <label for="pHp" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_hp()}</label>
          <input id="pHp" type="number" bind:value={editingPlayer.health} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
        </div>

        <div class="space-y-1">
          <label for="pEnergy" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_energy_pct()}</label>
          <input id="pEnergy" type="number" bind:value={editingPlayer.energy} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
        </div>

        <div class="space-y-1">
          <label for="pAtk" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_atk()}</label>
          <input id="pAtk" type="number" bind:value={editingPlayer.attack} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
        </div>

        <div class="space-y-1">
          <label for="pDef" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_def()}</label>
          <input id="pDef" type="number" bind:value={editingPlayer.defense} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
        </div>

        <div class="space-y-1">
          <label for="pSpd" class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest ml-2">{m.eco_spd()}</label>
          <input id="pSpd" type="number" bind:value={editingPlayer.speed} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs focus:outline-none" />
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-outline-variant/10">
        <button 
          type="button" 
          onclick={() => editingPlayer = null}
          class="px-5 py-2.5 bg-outline-variant/10 hover:bg-outline-variant/20 rounded-xl text-xs font-bold transition-all"
        >
          {m.eco_btn_cancel()}
        </button>
        <button 
          type="button" 
          onclick={handleSavePlayer}
          class="px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary text-[13px] font-medium rounded-lg transition-all"
        >
          {m.eco_btn_save()}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- RESET CONFIRMATION MODAL -->
{#if resetComponent}
  <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div class="bg-surface-container rounded-xl border border-outline-variant/30 p-8 w-full max-w-md space-y-6 animate-in zoom-in-95 duration-200">
      <div class="text-center space-y-3 flex flex-col items-center">
        <div class="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mb-2">
          <Papicon icon="alert-triangle" size={32} />
        </div>
        <h3 class="text-xl font-semibold text-error">{m.eco_reset_modal_title()}</h3>
        <p class="text-xs text-on-surface-variant/80 leading-relaxed text-center">
          {m.eco_reset_modal_desc({ component: resetComponent })}
        </p>
      </div>

      <div class="flex justify-center gap-3 pt-2">
        <button
          type="button"
          onclick={() => resetComponent = null}
          class="px-5 py-2.5 bg-outline-variant/10 hover:bg-outline-variant/20 rounded-xl text-xs font-bold transition-all"
        >
          {m.eco_btn_cancel()}
        </button>
        <button
          type="button"
          onclick={confirmReset}
          class="px-5 py-2.5 bg-error hover:bg-error-hover text-on-error text-[13px] font-medium rounded-lg transition-all"
        >
          {m.eco_confirm_delete_btn()}
        </button>
      </div>
    </div>
  </div>
{/if}
