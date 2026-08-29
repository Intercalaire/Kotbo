<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import {
    applyGuildPreset,
    fetchFeatureConfigurations,
    updateFeatureConfiguration,
    updateRoleAccess,
    updateGlobalSettings,
  } from '../lib/api';

  import ManagementOverview from '../lib/components/management/ManagementOverview.svelte';
  import ManagementFeatures from '../lib/components/management/ManagementFeatures.svelte';
  import ManagementChannelsRoles from '../lib/components/management/ManagementChannelsRoles.svelte';
  import ManagementAccess from '../lib/components/management/ManagementAccess.svelte';
  import ManagementNotifications from '../lib/components/management/ManagementNotifications.svelte';
  import ManagementAudit from '../lib/components/management/ManagementAudit.svelte';

  // Cette page distribue les droits des autres pages : la reserver aux
  // administrateurs evite qu'un role puisse s'y accorder ce qu'on lui refuse.
  // L'API applique la meme regle, elle rejette tout le reste en 403.
  const canManageSettings = $derived(!!dashboardStore.state.access?.canManageSettings);
  const availableChannels = $derived(dashboardStore.state.discordChannels || []);
  const availableRoles = $derived(dashboardStore.state.discordRoles || []);
  const auditLogs = $derived(dashboardStore.state.auditTrail || []);

  const categories = [
    { id: 'overview', label: 'Aperçu', icon: 'Grid' },
    { id: 'features', label: 'Modules', icon: 'Package' },
    { id: 'channels', label: 'Discord', icon: 'Hash' },
    { id: 'access', label: 'Accès', icon: 'Shield' },
    { id: 'notifications', label: 'Alertes', icon: 'Bell' },
    { id: 'audit', label: 'Audit', icon: 'ListBullets' },
  ];

  let activeCategory = $state('overview');
  let loading = $state(false);
  const saveAction = createAsyncActionState();

  type FeatureConfig = {
    id: string;
    featureKey: string;
    featureName: string;
    enabled: boolean;
    channelId: string | null;
    secondaryChannelId: string | null;
    requiredRoleId: string | null;
    notificationRoleId: string | null;
    notifyViaDiscordChannel: boolean;
    notifyViaDM: boolean;
    loggingEnabled: boolean;
    userActivityTracking: boolean;
    roleAccess: any[];
    roleAccessByRole: any[];
    notificationTargets: any[];
  };

  let features = $state<FeatureConfig[]>([]);

  let guildSettings = $state({
    configChannelId: '',
    regulationChannelId: '',
    logChannelId: '',
    publicChannelId: '',
    digestChannelId: '',
    meetingAnnouncementChannelId: '',
    meetingVoiceChannelId: '',
    moderatorRoleId: '',
    baseStaffRoleId: '',
    testStaffRoleId: '',
    youtubeEnabled: false,
    digestEnabled: false,
    translationEnabled: false,
    codePoliceEnabled: false,
    dailyAlgoEnabled: false,
    githubReleasesEnabled: false,
  });

  onMount(async () => {
    if (!canManageSettings) return;
    loading = true;
    try {
      const [featureResult] = await Promise.all([
        fetchFeatureConfigurations(),
      ]);

      if (featureResult?.features) {
        features = featureResult.features.map((f: any) => ({
          ...f,
          metadata: f.metadata || {}
        }));
      }

      const s = dashboardStore.state as any;
      guildSettings = {
        configChannelId: s.configChannelId || '',
        regulationChannelId: s.regulationChannelId || '',
        logChannelId: s.logChannelId || '',
        publicChannelId: s.publicChannelId || '',
        digestChannelId: s.digestChannelId || '',
        meetingAnnouncementChannelId: s.meetingAnnouncementChannelId || '',
        meetingVoiceChannelId: s.meetingVoiceChannelId || '',
        moderatorRoleId: s.moderatorRoleId || '',
        baseStaffRoleId: s.baseStaffRoleId || '',
        testStaffRoleId: s.testStaffRoleId || '',
        youtubeEnabled: s.youtubeEnabled || false,
        digestEnabled: s.digestEnabled || false,
        translationEnabled: s.translationEnabled || false,
        codePoliceEnabled: s.codePoliceEnabled || false,
        dailyAlgoEnabled: s.dailyAlgoEnabled || false,
        githubReleasesEnabled: s.githubReleasesEnabled || false,
      };
    } catch (err) {
      console.error('Erreur chargement config:', err);
      saveAction.setError('Impossible de charger les configurations.');
    } finally {
      loading = false;
    }
  });

  async function saveGlobalSettings() {
    await saveAction.run(
      async () => {
        const ok = await updateGlobalSettings(guildSettings);
        if (!ok) throw new Error('Erreur API');
        await dashboardStore.refresh();
        return true;
      },
      { successMessage: 'Paramètres globaux enregistrés.' }
    );
  }

  async function saveFeatureConfig(featureKey: string) {
    const feature = features.find(f => f.featureKey === featureKey);
    if (!feature) return;
    await saveAction.run(
      async () => {
        const ok = await updateFeatureConfiguration(featureKey, {
          enabled: feature.enabled,
          channelId: feature.channelId,
          secondaryChannelId: feature.secondaryChannelId,
          requiredRoleId: feature.requiredRoleId,
          notificationRoleId: feature.notificationRoleId,
          notifyViaDiscordChannel: feature.notifyViaDiscordChannel,
          notifyViaDM: feature.notifyViaDM,
          loggingEnabled: feature.loggingEnabled,
          userActivityTracking: feature.userActivityTracking,
          metadata: (feature as any).metadata
        });
        if (!ok) throw new Error('Erreur API');
        return true;
      },
      { successMessage: `${feature.featureName} sauvegardé.` }
    );
  }

  async function handleUpdateRoleAccess(featureKey: string, roleAccess: any[]) {
    await saveAction.run(
      async () => {
        const updated = await updateRoleAccess(featureKey, roleAccess);
        if (!updated) throw new Error('Erreur API');
        const idx = features.findIndex(f => f.featureKey === featureKey);
        if (idx !== -1) features[idx] = { ...features[idx], roleAccess };
        return true;
      },
      { successMessage: 'Accès mis à jour.' }
    );
  }


  async function handleApplyPreset(presetKey: string) {
    if (!(await confirmDialog.ask({ title: `Appliquer le preset « ${presetKey} » ?`, description: 'Les réglages d\'accès actuels seront écrasés.', confirmLabel: 'Appliquer', variant: 'warning' }))) return;
    
    await saveAction.run(
      async () => {
        const ok = await applyGuildPreset(presetKey);
        if (!ok) throw new Error('Erreur API');
        
        // Refresh local data
        const featureResult = await fetchFeatureConfigurations();
        if (featureResult?.features) {
          features = featureResult.features;
        }
        return true;
      },
      { successMessage: `Preset ${presetKey} appliqué avec succès.` }
    );
  }
</script>

<div class="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
  <!-- Top Bar: Header & Nav -->
  <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-container-low/30 p-5 rounded-xl border border-outline-variant/10">
    <div class="flex items-center gap-4">
      <div class="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
        <Papicon icon="Gear" size={20} />
      </div>
      <div>
        <h1 class="text-lg font-semibold tracking-tight leading-tight">Centre de Gestion</h1>
        <p class="text-sm text-on-surface-variant/60 font-medium">Administration système & modules</p>
      </div>
    </div>

    <!-- Compact Horizontal Tabs -->
    <nav class="flex items-center gap-1 bg-surface-container-high/40 p-1.5 rounded-lg border border-outline-variant/5 overflow-x-auto no-scrollbar">
      {#each categories as cat}
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 group whitespace-nowrap
 {activeCategory === cat.id 
              ? 'bg-primary text-on-primary shadow-md shadow-primary/20 scale-105' 
              : 'hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface'}"
          onclick={() => activeCategory = cat.id}
        >
          <Papicon icon={cat.icon} size={16} />
          <span class="font-medium text-[13px]">{cat.label}</span>
        </button>
      {/each}
    </nav>
  </div>

  <InlineFeedback state={saveAction} />

  {#if loading}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each Array(6) as _}
        <div class="p-6 rounded-xl bg-surface-container/30 border border-outline-variant/5 space-y-4">
          <div class="flex items-center gap-3">
            <Skeleton width="40px" height="40px" radius="12px" />
            <div class="space-y-2">
              <Skeleton width="120px" height="16px" />
              <Skeleton width="80px" height="10px" />
            </div>
          </div>
          <Skeleton width="100%" height="80px" radius="16px" />
        </div>
      {/each}
    </div>
    <div class="flex justify-center mt-4">
      <LoadingHint context="config" />
    </div>
  {:else if !canManageSettings}
    <div class="p-12 rounded-xl bg-error/5 border border-error/10 text-center space-y-4">
      <div class="w-16 h-16 bg-error/10 rounded-full flex items-center justify-center mx-auto text-error">
        <Papicon icon="ShieldWarning" size={32} />
      </div>
      <div class="space-y-2">
        <h2 class="text-xl font-semibold text-error">Accès Réservé</h2>
        <p class="text-on-surface-variant text-sm max-w-xs mx-auto">Permissions administratives requises pour cet espace.</p>
      </div>
    </div>
  {:else}
    <div class="grid grid-cols-1 relative">
      {#key activeCategory}
        <div in:fly={{ y: 15, duration: 400, delay: 150 }} out:fade={{ duration: 150 }} class="col-start-1 row-start-1">
          {#if activeCategory === 'overview'}
            <ManagementOverview 
              {features} 
              {guildSettings}
            />
          {:else if activeCategory === 'features'}
            <ManagementFeatures 
              {features} 
              onSave={saveFeatureConfig} 
            />
          {:else if activeCategory === 'channels'}
            <ManagementChannelsRoles 
              {features} 
              {availableChannels} 
              {availableRoles}
              onSaveFeature={saveFeatureConfig}
              onSaveGlobal={saveGlobalSettings}
            />
          {:else if activeCategory === 'access'}
            <ManagementAccess 
              {features} 
              {availableRoles}
              onUpdateAccess={handleUpdateRoleAccess}
              onApplyPreset={handleApplyPreset}
            />
          {:else if activeCategory === 'notifications'}
            <ManagementNotifications 
              {features} 
              {availableChannels}
              {availableRoles}
              onSave={saveFeatureConfig}
            />
          {:else if activeCategory === 'audit'}
            <ManagementAudit {auditLogs} />
          {/if}
        </div>
      {/key}
    </div>
  {/if}
</div>

<style>
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
</style>
