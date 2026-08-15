<script lang="ts">
  import { m } from '../lib/i18n';
  import { channelDisplayName } from '../lib/channelUtils';
  import { onMount } from 'svelte';
  import { router } from 'tinro';
  import { fade, scale } from 'svelte/transition';
  import { authStore } from '../lib/stores/auth.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import { resolveTabFromUrl, gotoTab } from '../lib/tabRouting';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import SectionCard from '../lib/components/SectionCard.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import MultiSelect from '../lib/components/MultiSelect.svelte';
  import SearchableSelect from '../lib/components/SearchableSelect.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';
  import {
    fetchGiveaways,
    createGiveaway,
    endGiveaway,
    rerollGiveaway,
    deleteGiveaway,
    fetchGiveawayConfig,
    updateGiveawayConfig
  } from '../lib/api';

  const actionState = createAsyncActionState();
  const configAction = createAsyncActionState();
  let loading = $state(false);
  let showModal = $state(false);

  const giveawayTabs = ['concours', 'configuration'] as const;
  type GiveawayTab = (typeof giveawayTabs)[number];
  const DEFAULT_TAB: GiveawayTab = 'concours';
  let activeTab = $state<GiveawayTab>(DEFAULT_TAB);

  $effect(() => {
    const _path = $router.path;
    activeTab = resolveTabFromUrl('/giveaways', giveawayTabs, DEFAULT_TAB) as GiveawayTab;
  });

  const canManageSettings = $derived(
    !!dashboardStore.state.featureAccess?.giveaways?.canConfigure
      || !!dashboardStore.state.access?.canManageSettings
  );

  // Décider qui pilote les concours est un réglage de serveur : il reste aux
  // administrateurs du dashboard, pas aux rôles gestionnaires qu'il déclare.
  const canEditConfig = $derived(!!dashboardStore.state.access?.canManageSettings);

  const availableChannels = $derived(dashboardStore.state.discordChannels || []);
  const availableRoles = $derived(dashboardStore.state.discordRoles || []);

  // Adresse de la page publique des concours, partageable telle quelle.
  let copySuccess = $state(false);
  const publicGiveawaysUrl = $derived(
    authStore.selectedGuildId
      ? `${window.location.origin}/${authStore.selectedGuildId}/giveaways`
      : ''
  );

  async function copyPublicGiveawaysUrl() {
    if (!publicGiveawaysUrl) return;
    await navigator.clipboard.writeText(publicGiveawaysUrl);
    copySuccess = true;
    setTimeout(() => { copySuccess = false; }, 2000);
  }

  let config = $state({
    managerRoleIds: [] as string[],
    requiredRoleIds: [] as string[],
    blockedRoleIds: [] as string[],
  });

  let giveaways = $state<Array<{
    id: string;
    channelId: string;
    messageId: string | null;
    prize: string;
    description: string | null;
    winnerCount: number;
    endsAt: string;
    ended: boolean;
    participants: string[];
    winners: string[];
    createdAt: string;
  }>>([]);

  // Form states
  let formPrize = $state('');
  let formDescription = $state('');
  let formWinnerCount = $state(1);
  let durationValue = $state(1);
  let durationUnit = $state('hours');
  let formChannelId = $state('');

  const computedDurationMinutes = $derived.by(() => {
    const val = durationValue || 1;
    if (durationUnit === 'minutes') return val;
    if (durationUnit === 'hours') return val * 60;
    if (durationUnit === 'days') return val * 1440;
    return val;
  });

  const presets = [
    { label: m.e8_giveaways_preset_30m(), value: 30, unit: 'minutes' },
    { label: m.e8_giveaways_preset_1h(), value: 1, unit: 'hours' },
    { label: m.e8_giveaways_preset_12h(), value: 12, unit: 'hours' },
    { label: m.e8_giveaways_preset_1d(), value: 1, unit: 'days' },
    { label: m.e8_giveaways_preset_3d(), value: 3, unit: 'days' },
    { label: m.e8_giveaways_preset_7d(), value: 7, unit: 'days' },
  ];

  function applyPreset(preset: typeof presets[0]) {
    durationValue = preset.value;
    durationUnit = preset.unit;
  }

  onMount(async () => {
    loading = true;
    try {
      await dashboardStore.refresh();
      const res = await fetchGiveaways();
      if (res && res.giveaways) {
        giveaways = res.giveaways;
      }
      const configRes = await fetchGiveawayConfig();
      if (configRes && configRes.config) {
        config = {
          managerRoleIds: configRes.config.managerRoleIds ?? [],
          requiredRoleIds: configRes.config.requiredRoleIds ?? [],
          blockedRoleIds: configRes.config.blockedRoleIds ?? [],
        };
      }
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  });

  async function handleSaveConfig() {
    if (!canEditConfig) return;
    await configAction.run(async () => {
      const res = await updateGiveawayConfig({
        managerRoleIds: config.managerRoleIds,
        requiredRoleIds: config.requiredRoleIds,
        blockedRoleIds: config.blockedRoleIds,
      });
      if (!res || !res.config) throw new Error(m.giv_cfg_error_save());
      config = {
        managerRoleIds: res.config.managerRoleIds ?? [],
        requiredRoleIds: res.config.requiredRoleIds ?? [],
        blockedRoleIds: res.config.blockedRoleIds ?? [],
      };
      return true;
    }, { successMessage: m.giv_cfg_success_save() });
  }

  function openCreateModal() {
    formPrize = '';
    formDescription = '';
    formWinnerCount = 1;
    durationValue = 1;
    durationUnit = 'hours';
    formChannelId = '';
    actionState.clearFeedback();
    showModal = true;
  }

  async function handleCreate() {
    if (!canManageSettings || !formPrize || !formWinnerCount || !computedDurationMinutes || !formChannelId) return;
    await actionState.run(async () => {
      const res = await createGiveaway({
        prize: formPrize,
        description: formDescription || undefined,
        winnerCount: formWinnerCount,
        durationMinutes: computedDurationMinutes,
        channelId: formChannelId
      });
      if (!res || !res.giveaway) throw new Error(m.e8_giveaways_error_create());
      giveaways = [res.giveaway, ...giveaways];
      showModal = false;
      return true;
    }, { successMessage: m.e8_giveaways_success_create() });
  }

  async function handleEnd(id: string) {
    if (!canManageSettings) return;
    await actionState.run(async () => {
      const ok = await endGiveaway(id);
      if (!ok) throw new Error(m.e8_giveaways_error_end());
      giveaways = giveaways.map(g => g.id === id ? { ...g, ended: true } : g);
      const res = await fetchGiveaways();
      if (res && res.giveaways) giveaways = res.giveaways;
      return true;
    }, { successMessage: m.e8_giveaways_success_end() });
  }

  async function handleReroll(id: string) {
    if (!canManageSettings) return;
    await actionState.run(async () => {
      const ok = await rerollGiveaway(id);
      if (!ok) throw new Error(m.e8_giveaways_error_reroll());
      const res = await fetchGiveaways();
      if (res && res.giveaways) giveaways = res.giveaways;
      return true;
    }, { successMessage: m.e8_giveaways_success_reroll() });
  }

  async function handleDelete(id: string) {
    if (!canManageSettings) return;
    if (!(await confirmDialog.danger(m.e8_giveaways_confirm_delete_title(), m.e8_giveaways_confirm_delete_desc()))) return;
    await actionState.run(async () => {
      const ok = await deleteGiveaway(id);
      if (!ok) throw new Error(m.e8_giveaways_error_delete());
      giveaways = giveaways.filter(g => g.id !== id);
      return true;
    }, { successMessage: m.e8_giveaways_success_delete() });
  }

  function getChannelName(channelId: string) {
    const channel = availableChannels.find(c => c.id === channelId);
    return channel ? channelDisplayName(channel) : m.e8_giveaways_unknown_channel({ channelId });
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatDurationLabel(minutes: number) {
    if (minutes < 60) return m.e8_giveaways_duration_min({ minutes });
    if (minutes < 1440) return m.e8_giveaways_duration_hours({ hours: Math.round(minutes / 60) });
    return m.e8_giveaways_duration_days({ days: Math.round(minutes / 1440) });
  }
</script>

<ModulePage
  title={m.giv_page_title()}
  description={m.giv_page_desc()}
  icon="sparkles"
  featureKey="giveaways"
>
  <InlineFeedback state={actionState} />

  {#if canEditConfig}
    <nav class="tab-group w-fit">
      <button onclick={() => gotoTab('/giveaways', 'concours', DEFAULT_TAB)} class="tab-button {activeTab === 'concours' ? 'active' : ''}">
        <Papicon icon="Sparkles" size={16} />
        {m.giv_tab_giveaways()}
      </button>
      <button onclick={() => gotoTab('/giveaways', 'configuration', DEFAULT_TAB)} class="tab-button {activeTab === 'configuration' ? 'active' : ''}">
        <Papicon icon="Settings" size={16} />
        {m.giv_tab_config()}
      </button>
    </nav>
  {/if}

  {#if loading}
    <div class="space-y-4">
      <Skeleton height="100px" radius="2rem" />
      <Skeleton height="100px" radius="2rem" />
      <Skeleton height="100px" radius="2rem" />
    </div>
  {:else if activeTab === 'configuration' && canEditConfig}
    <div class="space-y-6">
      <InlineFeedback state={configAction} />

      <SectionCard
        title={m.giv_cfg_managers_title()}
        description={m.giv_cfg_managers_desc()}
        icon="shield"
      >
        <div class="space-y-1.5">
          <MultiSelect
            id="giveaway-manager-roles"
            bind:values={config.managerRoleIds}
            options={availableRoles.map((r: any) => ({ id: r.id, name: `@${r.name}` }))}
            accentClass="bg-primary/20 text-primary border-primary/40"
          />
          <p class="text-[11px] text-on-surface-variant/50">{m.giv_cfg_managers_help()}</p>
        </div>
      </SectionCard>

      <SectionCard
        title={m.giv_cfg_participation_title()}
        description={m.giv_cfg_participation_desc()}
        icon="users"
      >
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="space-y-1.5">
            <span class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.giv_cfg_required_label()}</span>
            <MultiSelect
              id="giveaway-required-roles"
              bind:values={config.requiredRoleIds}
              options={availableRoles.map((r: any) => ({ id: r.id, name: `@${r.name}` }))}
              accentClass="bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
            />
            <p class="text-[11px] text-on-surface-variant/50">{m.giv_cfg_required_help()}</p>
          </div>

          <div class="space-y-1.5">
            <span class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.giv_cfg_blocked_label()}</span>
            <MultiSelect
              id="giveaway-blocked-roles"
              bind:values={config.blockedRoleIds}
              options={availableRoles.map((r: any) => ({ id: r.id, name: `@${r.name}` }))}
              accentClass="bg-rose-500/20 text-rose-300 border-rose-500/40"
            />
            <p class="text-[11px] text-on-surface-variant/50">{m.giv_cfg_blocked_help()}</p>
          </div>
        </div>
      </SectionCard>

      <div class="flex justify-end">
        <button
          onclick={handleSaveConfig}
          disabled={configAction.state.loading}
          class="px-8 py-3 bg-primary text-on-primary font-medium text-[13px] rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {configAction.state.loading ? m.giv_cfg_saving() : m.giv_cfg_save()}
        </button>
      </div>
    </div>
  {:else}
    <div class="space-y-6">
      <!-- Page publique : consultable sans compte, elle sert de vitrine aux concours -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-linear-to-r from-tertiary/10 to-secondary/10 border border-tertiary/20 rounded-xl p-6 px-8 shadow-xs relative overflow-hidden">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-lg bg-tertiary/10 border border-tertiary/20 flex items-center justify-center text-tertiary shadow-inner">
            <Papicon icon="Globe" size={22} />
          </div>
          <div>
            <p class="text-sm font-semibold text-on-surface">{m.giv_public_banner_title()}</p>
            <p class="text-xs text-on-surface-variant/70 font-medium">{m.giv_public_page_desc()}</p>
          </div>
        </div>
        <div class="flex items-center gap-3 shrink-0 w-full sm:w-auto">
          <a
            href={publicGiveawaysUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-2 px-5 py-3 bg-tertiary/20 text-tertiary border border-tertiary/25 rounded-lg text-xs font-semibold hover:bg-tertiary/30 transition-all hover:scale-103 w-full sm:w-auto text-center"
          >
            <Papicon icon="ExternalLink" size={14} />
            {m.giv_public_page_view()}
          </a>
          <button
            onclick={copyPublicGiveawaysUrl}
            class="flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-xs font-semibold transition-all hover:scale-103 w-full sm:w-auto {copySuccess ? 'bg-green-500/15 text-green-400 border border-green-500/20' : 'bg-surface-container-high/40 text-on-surface-variant border border-outline-variant/10 hover:bg-surface-container-high/60'}"
          >
            {#if copySuccess}
              <Papicon icon="Check" size={14} />
              {m.giv_public_page_copied()}
            {:else}
              <Papicon icon="Copy" size={14} />
              {m.giv_public_page_copy()}
            {/if}
          </button>
        </div>
      </div>

      <!-- Title & Actions Bar -->
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <h3 class="text-xl font-semibold flex items-center gap-3">
          <Papicon icon="List" size={20} class="text-secondary" />
          {m.giv_list_title({ count: giveaways.length })}
        </h3>

        {#if canManageSettings}
          <button
            onclick={openCreateModal}
            class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary font-medium text-[13px] rounded-lg transition-all cursor-pointer"
          >
            <Papicon icon="Add" size={16} />
            {m.giv_btn_create()}
          </button>
        {/if}
      </div>

      <!-- Giveaways list -->
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {#each giveaways as giveaway}
          <div class="bg-surface-container-low/30 border border-outline-variant/10 p-6 rounded-xl flex flex-col justify-between hover:bg-surface-container-low/50 hover:border-outline-variant/20 hover:shadow-sm hover:shadow-primary/5 transition-all duration-300 relative group">
            <div class="space-y-4">
              <!-- Status & Destination -->
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <span class="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-xl {giveaway.ended ? 'bg-outline-variant/20 text-on-surface-variant' : 'bg-primary/10 text-primary border border-primary/20 animate-pulse'}">
                  {giveaway.ended ? m.giv_status_ended() : m.giv_status_active()}
                </span>
                <span class="text-[11px] font-bold text-on-surface-variant/70 flex items-center gap-1 bg-surface-container-high/40 px-2 py-1 rounded-lg">
                  <Papicon icon="Hash" size={11} />{getChannelName(giveaway.channelId)}
                </span>
              </div>

              <!-- Prize & Description -->
              <div class="space-y-1">
                <h4 class="text-lg font-semibold text-on-surface leading-tight group-hover:text-primary transition-colors duration-300">{giveaway.prize}</h4>
                {#if giveaway.description}
                  <p class="text-xs text-on-surface-variant/70 font-medium line-clamp-3 leading-relaxed">{giveaway.description}</p>
                {/if}
              </div>

              <!-- Stats row -->
              <div class="flex flex-wrap gap-2 pt-3 border-t border-outline-variant/10">
                <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/10">
                  <Papicon icon="Users" size={10} />{m.giv_participants_count({ count: giveaway.participants.length })}
                </span>
                <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/10">
                  <Papicon icon="Crown" size={10} />{m.giv_winners_count({ count: giveaway.winnerCount })}
                </span>
              </div>

              <!-- Winners or Clock -->
              {#if giveaway.ended}
                <div class="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-3 space-y-1">
                  <span class="text-xs font-medium text-emerald-400 flex items-center gap-1">
                    <Papicon icon="Crown" size={10} /> {m.giv_winners_header()}
                  </span>
                  <p class="text-xs font-bold text-emerald-300/95 wrap-break-word">
                    {giveaway.winners.length > 0 ? giveaway.winners.join(', ') : m.giv_no_winners()}
                  </p>
                </div>
              {:else}
                <div class="bg-surface-container-high/20 border border-outline-variant/5 rounded-lg p-3 flex items-center gap-2 text-on-surface-variant/60">
                  <Papicon icon="Clock" size={12} class="text-primary" />
                  <span class="text-[10px] font-semibold">
                    {m.giv_ends_at({ date: formatDate(giveaway.endsAt) })}
                  </span>
                </div>
              {/if}
            </div>

            <!-- Actions -->
            {#if canManageSettings}
              <div class="flex items-center gap-2 pt-4 mt-4 border-t border-outline-variant/10 justify-end">
                {#if !giveaway.ended}
                  <button
                    onclick={() => handleEnd(giveaway.id)}
                    class="px-3.5 py-2 bg-secondary hover:bg-secondary-hover text-on-secondary text-[10px] font-semibold uppercase tracking-wider rounded-xl transition-all shadow-md shadow-secondary/10 cursor-pointer flex items-center gap-1.5"
                    title={m.giv_title_pick_winner()}
                  >
                    <Papicon icon="Sparkles" size={11} />
                    {m.giv_btn_pick_winner()}
                  </button>
                {:else}
                  <button
                    onclick={() => handleReroll(giveaway.id)}
                    class="px-3.5 py-2 bg-outline-variant/20 hover:bg-outline-variant/35 text-on-surface text-[10px] font-semibold uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                    title={m.giv_title_reroll()}
                  >
                    <Papicon icon="Refresh" size={11} />
                    {m.giv_btn_reroll()}
                  </button>
                {/if}
                <button
                  onclick={() => handleDelete(giveaway.id)}
                  class="p-2 text-error hover:bg-error/10 border border-transparent rounded-xl transition-all cursor-pointer"
                  title={m.giv_title_delete()}
                >
                  <Papicon icon="Trash" size={16} />
                </button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="col-span-full flex flex-col items-center justify-center py-20 bg-surface-container-low/20 border border-outline-variant/10 rounded-xl text-center">
            <Papicon icon="Sparkles" size={32} class="text-on-surface-variant/20 mb-3" />
            <p class="text-sm text-on-surface-variant/60 font-medium">{m.giv_empty_text()}</p>
            {#if canManageSettings}
              <button
                onclick={openCreateModal}
                class="mt-4 flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-xs rounded-lg transition-all cursor-pointer"
              >
                <Papicon icon="Add" size={14} /> {m.giv_empty_btn()}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</ModulePage>

<!-- Modal Création Giveaway -->
{#if showModal}
  <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" transition:fade={{ duration: 150 }}>
    <div class="bg-surface-container-low/95 border border-outline-variant/20 max-w-lg w-full rounded-xl p-8 space-y-6 shadow-sm relative" transition:scale={{ start: 0.97, duration: 150 }}>

      <!-- Close button -->
      <button
        onclick={() => showModal = false}
        class="absolute top-6 right-6 p-2 rounded-full bg-surface-container-high/40 hover:bg-rose-500/15 hover:text-rose-500 text-on-surface-variant transition-colors cursor-pointer"
        title={m.giv_modal_close_title()}
      >
        <Papicon icon="Cross" size={20} />
      </button>

      <!-- Modal Header -->
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center text-primary shadow-inner">
          <Papicon icon="Sparkles" size={24} />
        </div>
        <div>
          <h3 class="text-2xl font-semibold tracking-tight">{m.giv_modal_title()}</h3>
          <p class="text-xs text-on-surface-variant/80 font-medium">{m.giv_modal_subtitle()}</p>
        </div>
      </div>

      <form onsubmit={(e) => { e.preventDefault(); handleCreate(); }} class="space-y-5 pt-2">
        <div class="space-y-1.5">
          <label for="modal-prize" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.giv_field_prize_label()}</label>
          <input
            id="modal-prize"
            type="text"
            bind:value={formPrize}
            placeholder={m.giv_field_prize_placeholder()}
            class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
            required
            disabled={!canManageSettings}
          />
        </div>

        <div class="space-y-1.5">
          <label for="modal-desc" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.giv_field_desc_label()}</label>
          <textarea
            id="modal-desc"
            bind:value={formDescription}
            placeholder={m.giv_field_desc_placeholder()}
            class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none h-20 resize-none"
            disabled={!canManageSettings}
          ></textarea>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label for="modal-winners" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.giv_field_winners_label()}</label>
            <input
              id="modal-winners"
              type="number"
              min="1"
              max="50"
              bind:value={formWinnerCount}
              class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
              required
              disabled={!canManageSettings}
            />
          </div>

          <div class="space-y-1.5">
            <label for="modal-duration-value" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.giv_field_duration_label()}</label>
            <div class="flex gap-2">
              <input
                id="modal-duration-value"
                type="number"
                min="1"
                bind:value={durationValue}
                class="w-2/3 bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
                required
                disabled={!canManageSettings}
              />
              <select
                bind:value={durationUnit}
                class="w-1/3 bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-3 py-3 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none cursor-pointer"
                disabled={!canManageSettings}
              >
                <option value="minutes">{m.giv_unit_minutes()}</option>
                <option value="hours">{m.giv_unit_hours()}</option>
                <option value="days">{m.giv_unit_days()}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Presets -->
        <div class="space-y-1.5">
          <span class="text-[11px] font-bold text-on-surface-variant/50 ml-2 uppercase tracking-widest">{m.giv_field_presets_label()}</span>
          <div class="flex flex-wrap gap-2 ml-1">
            {#each presets as preset}
              <button
                type="button"
                onclick={() => applyPreset(preset)}
                class="px-3 py-1.5 bg-surface-container-high/35 hover:bg-primary/10 border border-outline-variant/10 hover:border-primary/30 rounded-xl text-xs font-bold text-on-surface transition-all cursor-pointer {durationValue === preset.value && durationUnit === preset.unit ? 'bg-primary/15 border-primary/40 text-primary' : ''}"
                disabled={!canManageSettings}
              >
                {preset.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="space-y-1.5">
          <label for="modal-channel" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.giv_field_channel_label()}</label>
          <SearchableSelect
            id="modal-channel"
            bind:value={formChannelId}
            options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))}
            placeholder={m.giv_select_channel_placeholder()}
            className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all"
            disabled={!canManageSettings}
          />
        </div>

        <div class="flex justify-end gap-3 pt-4 border-t border-outline-variant/10">
          <button
            type="button"
            onclick={() => showModal = false}
            class="px-6 py-3 bg-outline-variant/20 hover:bg-outline-variant/30 text-on-surface text-[13px] font-medium rounded-lg transition-all cursor-pointer"
          >
            {m.giv_btn_cancel()}
          </button>
          {#if canManageSettings}
            <button
              type="submit"
              class="px-8 py-3 bg-primary text-on-primary font-medium text-[13px] rounded-lg transition-all cursor-pointer"
            >
              {m.giv_btn_submit_discord()}
            </button>
          {/if}
        </div>
      </form>
    </div>
  </div>
{/if}
