<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { unsavedChanges } from '../lib/stores/unsavedChanges.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { fetchAutoThreadConfig, updateAutoThreadConfig } from '../lib/api';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';

  let config = $state({
    enabled: false,
    channels: [] as string[],
    botsEnabled: false
  });
  let loading = $state(true);
  let loadError = $state('');
  let searchQuery = $state('');

  // Snapshot of last-saved state
  let savedConfig = $state(JSON.parse(JSON.stringify({
    enabled: false,
    channels: [] as string[],
    botsEnabled: false
  })));

  $effect(() => {
    const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig);
    if (dirty) {
      untrack(() => {
        unsavedChanges.register({
          id: 'auto-thread',
          label: 'Auto-Thread',
          onSave: () => handleSave(),
          onReset: () => {
            config = JSON.parse(JSON.stringify(savedConfig));
          }
        });
      });
    } else {
      untrack(() => {
        unsavedChanges.release('auto-thread');
      });
    }
  });

  onDestroy(() => {
    unsavedChanges.release('auto-thread');
  });

  const saveAction = createAsyncActionState();

  const availableChannels = $derived(dashboardStore.state.discordChannels || []);
  const filteredChannels = $derived(
    availableChannels.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  onMount(async () => {
    try {
      await dashboardStore.refresh();
      const res = await fetchAutoThreadConfig();
      if (res) {
        config.enabled = res.enabled ?? false;
        config.channels = res.channels ?? [];
        config.botsEnabled = res.botsEnabled ?? false;
        savedConfig = JSON.parse(JSON.stringify(config));
      }
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Impossible de charger la configuration.';
    } finally {
      loading = false;
    }
  });

  // Keep config.enabled in sync with ModulePage toggle header
  $effect(() => {
    const activeModule = (dashboardStore.state.modules as any[]).find(m => m.id === 'auto_thread');
    config.enabled = activeModule?.status === 'active';
  });

  async function handleSave(): Promise<boolean> {
    let success = false;
    await saveAction.run(async () => {
      const ok = await updateAutoThreadConfig({
        enabled: config.enabled,
        channels: config.channels,
        botsEnabled: config.botsEnabled
      } as any);
      if (!ok) throw new Error('Erreur de sauvegarde API');
      
      // Update global store state
      await dashboardStore.refresh();
      savedConfig = JSON.parse(JSON.stringify(config));
      success = true;
      return true;
    }, { successMessage: 'Configuration Auto-Thread mise à jour avec succès.' });
    return success;
  }

  function toggleChannel(channelId: string) {
    if (config.channels.includes(channelId)) {
      config.channels = config.channels.filter(id => id !== channelId);
    } else {
      config.channels = [...config.channels, channelId];
    }
  }

  function selectAll() {
    config.channels = filteredChannels.map(c => c.id);
  }

  function deselectAll() {
    config.channels = [];
  }
</script>

<ModulePage
  title="Auto-Thread"
  description="Configurez les salons Discord dans lesquels le bot créera automatiquement un fil de discussion pour chaque message posté."
  icon="chat"
  featureKey="auto_thread"
>

  <InlineFeedback state={saveAction} />

  {#if loading}
    <div class="flex flex-col gap-6 animate-pulse">
      <div class="h-12 w-48 bg-surface-container-low/60 rounded-xl"></div>
      <div class="h-64 rounded-xl bg-surface-container-low/60"></div>
    </div>
  {:else if loadError}
    <div class="rounded-xl bg-error/10 border border-error/20 p-6 text-error text-sm font-semibold">
      ⚠️ {loadError}
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-8">
      <!-- Section Salons -->
      <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 class="text-xl font-semibold flex items-center gap-3">
              <Papicon icon="Hash" size={20} class="text-primary" />
              Salons éligibles
            </h3>
            <p class="text-xs text-on-surface-variant/60 mt-1">Sélectionnez les salons textuels et d'annonces où les fils de discussion doivent être créés.</p>
          </div>
          
          <div class="flex items-center gap-2">
            <button 
              onclick={selectAll}
              class="px-4 py-2 bg-surface-container-high/40 hover:bg-surface-container-high/80 border border-outline-variant/10 text-xs font-bold rounded-xl transition-all"
            >
              Sélectionner tout (filtre)
            </button>
            <button 
              onclick={deselectAll}
              class="px-4 py-2 bg-surface-container-high/40 hover:bg-surface-container-high/80 border border-outline-variant/10 text-xs font-bold rounded-xl transition-all"
            >
              Tout désélectionner
            </button>
          </div>
        </div>

        <!-- Search & Info Bar -->
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div class="flex-1 relative">
            <input
              type="text"
              bind:value={searchQuery}
              placeholder="Rechercher un salon..."
              class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg pl-11 pr-5 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all outline-none"
            />
            <div class="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50">
              <Papicon icon="search" size={16} />
            </div>
          </div>
          
          <div class="px-5 py-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 flex items-center gap-2 text-xs font-bold">
            <span class="text-primary">{config.channels.length}</span>
            <span class="text-on-surface-variant/60">salon(s) sélectionné(s)</span>
          </div>
        </div>

        <!-- Channels Grid/List -->
        {#if filteredChannels.length > 0}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[450px] overflow-y-auto pr-2 no-scrollbar">
            {#each filteredChannels as channel}
              {@const isChecked = config.channels.includes(channel.id)}
              <button
                onclick={() => toggleChannel(channel.id)}
                class="flex items-center justify-between p-4 rounded-lg border transition-all text-left group
 {isChecked 
                    ? 'bg-primary/5 border-primary/30 text-primary hover:bg-primary/10' 
                    : 'bg-surface-container-high/10 border-outline-variant/5 hover:bg-surface-container-high/30'}"
              >
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-lg flex items-center justify-center {isChecked ? 'bg-primary/10' : 'bg-surface-container-highest'}">
                    <span class="text-sm font-semibold opacity-60">#</span>
                  </div>
                  <span class="text-sm font-semibold truncate max-w-[180px]">{channel.name}</span>
                </div>
                
                <div class="w-5 h-5 rounded-md border flex items-center justify-center transition-all
 {isChecked 
                    ? 'bg-primary border-primary text-on-primary' 
                    : 'border-outline-variant/30 group-hover:border-outline-variant/60'}"
                >
                  {#if isChecked}
                    <Papicon icon="check" size={12} class="text-white" />
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {:else}
          <div class="flex flex-col items-center justify-center py-12 text-on-surface-variant/30 bg-surface-container-high/10 border border-dashed border-outline-variant/10 rounded-lg gap-3">
            <Papicon icon="search" size={32} class="opacity-30" />
            <p class="text-sm font-bold">Aucun salon ne correspond à votre recherche.</p>
          </div>
        {/if}
      </section>

      <!-- Section Bots -->
      <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-xl font-semibold flex items-center gap-3">
              <Papicon icon="bot" size={20} class="text-primary" />
              Prise en charge des bots & webhooks
            </h3>
            <p class="text-xs text-on-surface-variant/80 mt-1 font-medium">Activer la création automatique de fils de discussion pour les messages envoyés par d'autres bots ou webhooks (ex: flux RSS).</p>
          </div>
          <ToggleSwitch 
            checked={config.botsEnabled} 
            onToggle={(v: boolean) => config.botsEnabled = v} 
          />
        </div>
      </section>
    </div>
  {/if}
</ModulePage>

<style>
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
</style>
