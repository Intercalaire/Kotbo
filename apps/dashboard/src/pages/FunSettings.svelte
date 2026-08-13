<script lang="ts">
  import { m } from '../lib/i18n';
  import { channelDisplayName } from '../lib/channelUtils';
  import { onMount, onDestroy, untrack } from 'svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { unsavedChanges } from '../lib/stores/unsavedChanges.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import SearchableSelect from '../lib/components/SearchableSelect.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import {
    fetchFunConfig,
    updateFunConfig,
    resetCountingGame,
    resetGuessNumberGame
  } from '../lib/api';

  const actionState = createAsyncActionState();
  let loading = $state(false);

  const canManageSettings = $derived(
    !!dashboardStore.state.featureAccess?.fun?.canConfigure
      || !!dashboardStore.state.access?.canManageSettings
  );

  const availableChannels = $derived(dashboardStore.state.discordChannels || []);

  let config = $state({
    funEnabled: false,
    funCountingChannelId: null as string | null,
    funOneWordStoryChannelId: null as string | null,
    funGuessNumberChannelId: null as string | null
  });

  let savedConfig = $state({
    funEnabled: false,
    funCountingChannelId: null as string | null,
    funOneWordStoryChannelId: null as string | null,
    funGuessNumberChannelId: null as string | null
  });

  let gameState = $state({
    countingCurrent: 0,
    countingLastUserId: null as string | null,
    oneWordStoryLastUserId: null as string | null,
    guessNumberTarget: 0
  });

  // Detect changes and register/deregister with the global bar
  $effect(() => {
    const current = JSON.stringify(config);
    const saved = JSON.stringify(savedConfig);
    const dirty = current !== saved;

    if (dirty && canManageSettings) {
      untrack(() => {
        unsavedChanges.register({
          id: 'fun-settings',
          label: m.fun_unsaved_label(),
          onSave: () => handleSave(),
          onReset: () => { config = { ...savedConfig }; }
        });
      });
    } else if (!dirty) {
      untrack(() => {
        unsavedChanges.release('fun-settings');
      });
    }
  });

  onDestroy(() => {
    unsavedChanges.release('fun-settings');
  });

  onMount(async () => {
    loading = true;
    try {
      await dashboardStore.refresh();
      const res = await fetchFunConfig();
      if (res && res.config) {
        const loaded = {
          funEnabled: res.config.funEnabled ?? false,
          funCountingChannelId: res.config.funCountingChannelId ?? null,
          funOneWordStoryChannelId: res.config.funOneWordStoryChannelId ?? null,
          funGuessNumberChannelId: res.config.funGuessNumberChannelId ?? null
        };
        config = loaded;
        savedConfig = { ...loaded };
      }
      if (res && res.gameState) {
        gameState = {
          countingCurrent: res.gameState.countingCurrent ?? 0,
          countingLastUserId: res.gameState.countingLastUserId ?? null,
          oneWordStoryLastUserId: res.gameState.oneWordStoryLastUserId ?? null,
          guessNumberTarget: res.gameState.guessNumberTarget ?? 0
        };
      }
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  });

  async function handleSave(): Promise<boolean> {
    if (!canManageSettings) return false;
    let success = false;
    await actionState.run(async () => {
      const res = await updateFunConfig(config);
      if (!res) throw new Error(m.fun_save_error());
      const saved = {
        funEnabled: res.config.funEnabled ?? false,
        funCountingChannelId: res.config.funCountingChannelId ?? null,
        funOneWordStoryChannelId: res.config.funOneWordStoryChannelId ?? null,
        funGuessNumberChannelId: res.config.funGuessNumberChannelId ?? null
      };
      config = saved;
      savedConfig = { ...saved };

      if (res.gameState) {
        gameState = {
          countingCurrent: res.gameState.countingCurrent ?? 0,
          countingLastUserId: res.gameState.countingLastUserId ?? null,
          oneWordStoryLastUserId: res.gameState.oneWordStoryLastUserId ?? null,
          guessNumberTarget: res.gameState.guessNumberTarget ?? 0
        };
      }

      success = true;
      return true;
    }, { successMessage: m.fun_save_success() });
    return success;
  }

  async function handleResetCounting() {
    if (!canManageSettings) return;
    if (!(await confirmDialog.ask({ title: m.fun_reset_counting_confirm_title(), confirmLabel: m.fun_reset_counting_confirm_btn(), variant: 'warning' }))) return;

    await actionState.run(async () => {
      const res = await resetCountingGame();
      if (res && res.gameState) {
        gameState = {
          countingCurrent: res.gameState.countingCurrent ?? 0,
          countingLastUserId: res.gameState.countingLastUserId ?? null,
          oneWordStoryLastUserId: res.gameState.oneWordStoryLastUserId ?? null,
          guessNumberTarget: res.gameState.guessNumberTarget ?? 0
        };
      }
      return true;
    }, { successMessage: m.fun_reset_counting_toast() });
  }

  async function handleResetGuessNumber() {
    if (!canManageSettings) return;
    if (!(await confirmDialog.ask({ title: m.fun_reset_guess_confirm_title(), confirmLabel: m.fun_reset_guess_confirm_btn() }))) return;

    await actionState.run(async () => {
      const res = await resetGuessNumberGame();
      if (res && res.gameState) {
        gameState = {
          countingCurrent: res.gameState.countingCurrent ?? 0,
          countingLastUserId: res.gameState.countingLastUserId ?? null,
          oneWordStoryLastUserId: res.gameState.oneWordStoryLastUserId ?? null,
          guessNumberTarget: res.gameState.guessNumberTarget ?? 0
        };
      }
      return true;
    }, { successMessage: m.fun_reset_guess_toast() });
  }
</script>

<ModulePage
  title={m.fun_page_title()}
  description={m.fun_page_desc()}
  icon="Smile"
  featureKey="fun"
>
  <InlineFeedback state={actionState} />

  {#if loading}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <Skeleton height="320px" radius="2.5rem" />
      <Skeleton height="320px" radius="2.5rem" />
      <Skeleton height="320px" radius="2.5rem" />
    </div>
    <div class="flex justify-center mt-4">
      <LoadingHint context="config" />
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- Counting Card -->
      <section class="bg-surface-container-low/40 border border-outline-variant/30 p-8 rounded-xl flex flex-col justify-between gap-6 hover:bg-surface-container-low/60 transition-all duration-300">
        <div class="space-y-4">
          <div class="flex items-center gap-3 pb-3 border-b border-outline-variant/15">
            <div class="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <Papicon icon="Binary" size={20} />
            </div>
            <div>
              <h3 class="text-lg font-semibold tracking-tight text-on-surface">{m.fun_counting_title()}</h3>
              <p class="text-[10px] text-on-surface-variant/55 uppercase font-bold tracking-wider">{m.fun_counting_subtitle()}</p>
            </div>
          </div>

          <div class="space-y-1.5">
            <label for="countingChannel" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.fun_channel_label()}</label>
            <SearchableSelect
              id="countingChannel"
              bind:value={config.funCountingChannelId}
              options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))}
              placeholder={m.fun_no_channel()}
              className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500/30 transition-all"
              disabled={!canManageSettings}
            />
          </div>

          <div class="p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 space-y-2.5">
            <p class="text-xs font-medium text-on-surface-variant/50">{m.fun_game_state_title()}</p>
            <div class="grid grid-cols-2 gap-4">
              <div class="bg-surface-container-high/40 p-3 rounded-xl border border-outline-variant/10 text-center">
                <span class="text-[10px] text-on-surface-variant/50 uppercase font-bold">{m.fun_counting_number()}</span>
                <p class="text-2xl font-semibold text-amber-500 mt-0.5">{gameState.countingCurrent}</p>
              </div>
              <div class="bg-surface-container-high/40 p-3 rounded-xl border border-outline-variant/10 text-center flex flex-col justify-center min-w-0">
                <span class="text-[10px] text-on-surface-variant/50 uppercase font-bold truncate">{m.fun_last_player()}</span>
                <p class="text-xs font-bold text-on-surface mt-1 truncate" title={gameState.countingLastUserId || m.fun_none()}>
                  {gameState.countingLastUserId ? m.fun_user_id({ id: gameState.countingLastUserId }) : m.fun_none()}
                </p>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onclick={handleResetCounting}
          disabled={!canManageSettings || actionState.state.loading}
          class="w-full py-3.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 rounded-lg text-[13px] font-medium transition-all duration-200 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40"
        >
          <Papicon icon="refresh-cw" size={14} />
          {m.fun_reset_counting_btn()}
        </button>
      </section>

      <!-- One Word Story Card -->
      <section class="bg-surface-container-low/40 border border-outline-variant/30 p-8 rounded-xl flex flex-col justify-between gap-6 hover:bg-surface-container-low/60 transition-all duration-300">
        <div class="space-y-4">
          <div class="flex items-center gap-3 pb-3 border-b border-outline-variant/15">
            <div class="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <Papicon icon="BookOpen" size={20} />
            </div>
            <div>
              <h3 class="text-lg font-semibold tracking-tight text-on-surface">{m.fun_oneword_title()}</h3>
              <p class="text-[10px] text-on-surface-variant/55 uppercase font-bold tracking-wider">{m.fun_oneword_subtitle()}</p>
            </div>
          </div>

          <div class="space-y-1.5">
            <label for="oneWordStoryChannel" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.fun_channel_label()}</label>
            <SearchableSelect
              id="oneWordStoryChannel"
              bind:value={config.funOneWordStoryChannelId}
              options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))}
              placeholder={m.fun_no_channel()}
              className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-purple-500/30 transition-all"
              disabled={!canManageSettings}
            />
          </div>

          <div class="p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 space-y-2.5">
            <p class="text-xs font-medium text-on-surface-variant/50">{m.fun_game_state_title()}</p>
            <div class="bg-surface-container-high/40 p-3 rounded-xl border border-outline-variant/10 text-center flex flex-col justify-center min-w-0">
              <span class="text-[10px] text-on-surface-variant/50 uppercase font-bold truncate">{m.fun_last_author()}</span>
              <p class="text-xs font-bold text-on-surface mt-1 truncate" title={gameState.oneWordStoryLastUserId || m.fun_none()}>
                {gameState.oneWordStoryLastUserId ? m.fun_user_id({ id: gameState.oneWordStoryLastUserId }) : m.fun_none()}
              </p>
            </div>
          </div>
        </div>

        <div class="text-[11px] text-on-surface-variant/40 italic text-center py-2 leading-relaxed font-medium">
          {m.fun_oneword_hint()}
        </div>
      </section>

      <!-- Guess Number Card -->
      <section class="bg-surface-container-low/40 border border-outline-variant/30 p-8 rounded-xl flex flex-col justify-between gap-6 hover:bg-surface-container-low/60 transition-all duration-300">
        <div class="space-y-4">
          <div class="flex items-center gap-3 pb-3 border-b border-outline-variant/15">
            <div class="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <Papicon icon="Gamepad2" size={20} />
            </div>
            <div>
              <h3 class="text-lg font-semibold tracking-tight text-on-surface">{m.fun_guess_title()}</h3>
              <p class="text-[10px] text-on-surface-variant/55 uppercase font-bold tracking-wider">{m.fun_guess_subtitle()}</p>
            </div>
          </div>

          <div class="space-y-1.5">
            <label for="guessNumberChannel" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.fun_channel_label()}</label>
            <SearchableSelect
              id="guessNumberChannel"
              bind:value={config.funGuessNumberChannelId}
              options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))}
              placeholder={m.fun_no_channel()}
              className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500/30 transition-all"
              disabled={!canManageSettings}
            />
          </div>

          <div class="p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 space-y-2.5">
            <p class="text-xs font-medium text-on-surface-variant/50">{m.fun_game_state_title()}</p>
            <div class="bg-surface-container-high/40 p-3 rounded-xl border border-outline-variant/10 text-center">
              <span class="text-[10px] text-on-surface-variant/50 uppercase font-bold">{m.fun_guess_target()}</span>
              <p class="text-2xl font-semibold text-emerald-500 mt-0.5">{gameState.guessNumberTarget || '???'}</p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onclick={handleResetGuessNumber}
          disabled={!canManageSettings || actionState.state.loading}
          class="w-full py-3.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 rounded-lg text-[13px] font-medium transition-all duration-200 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40"
        >
          <Papicon icon="refresh-cw" size={14} />
          {m.fun_reset_guess_btn()}
        </button>
      </section>
    </div>
  {/if}
</ModulePage>
