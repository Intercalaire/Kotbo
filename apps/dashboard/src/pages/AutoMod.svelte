<script lang="ts">
  import { channelDisplayName } from '../lib/channelUtils';
  import { m } from '../lib/i18n';
  import { onMount, onDestroy, untrack } from 'svelte';
  import { unsavedChanges } from '../lib/stores/unsavedChanges.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';
  import SearchableSelect from '../lib/components/SearchableSelect.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import AutomodPresetPicker from '../lib/components/AutomodPresetPicker.svelte';
  import { findAutomodPreset, type AutomodPreset } from '@kotbo/shared';
  import {
    fetchAutoModConfig,
    updateAutoModConfig,
    fetchRaidProtection,
    updateRaidProtection,
    setRaidMode,
    setJoinLock,
    setDmLock,
    setInviteEmergency,
    fetchMemberReports,
    decideMemberReport,
    fetchInviteRequests,
    decideInviteRequest,
    fetchScamImages,
    deleteScamImage
  } from '../lib/api';

  const actionState = createAsyncActionState();
  let loading = $state(false);
  let activeTab = $state('accueil');

  const canManageSettings = $derived(
    !!dashboardStore.state.featureAccess?.automod?.canConfigure
      || !!dashboardStore.state.access?.canManageSettings
  );

  let isOwner = $state(false);

  const availableChannels = $derived(dashboardStore.state.discordChannels || []);
  const availableRoles = $derived(dashboardStore.state.discordRoles || []);

  let config = $state({
    discordAutoModEnabled: true,
    spamEnabled: false,
    spamLimit: 5,
    spamIntervalSeconds: 5,
    spamAction: 'TIMEOUT',

    linksEnabled: false,
    linksAction: 'DELETE_AND_WARN',
    linksWhitelist: [] as string[],

    capsEnabled: false,
    capsThresholdPercent: 80,
    capsMinLength: 10,

    emojisEnabled: false,
    emojisLimit: 10,

    mentionsEnabled: false,
    mentionsLimit: 5,

    ghostPingEnabled: false,
    ghostPingAction: 'ALERT',

    antiEveryoneEnabled: false,
    antiEveryoneAction: 'DELETE_AND_WARN',

    customWordsEnabled: false,
    customWordsAction: 'BLOCK',
    customWords: [] as string[],
    customWordsAllowList: [] as string[],
    customWordsTimeoutSec: 60,

    profanityEnabled: false,
    profanityPresetProfanity: true,
    profanityPresetSexual: true,
    profanityPresetSlurs: true,
    profanityAction: 'BLOCK',
    profanityAllowList: [] as string[],
    profanityTimeoutSec: 60,

    inviteFilterEnabled: false,
    inviteFilterAction: 'BLOCK',
    inviteFilterAllowedGuilds: [] as string[],
    inviteFilterTimeoutSec: 60,

    antiBotEnabled: false,
    antiBotAction: 'KICK',
    antiBotBypassUsers: [] as string[],

    adminLockEnabled: false,
    adminLockAction: 'BLOCK',
    adminLockSecurityRoleIds: [] as string[],
    adminLockNotifyChannelId: null as string | null,

    burstSuspendEnabled: false,
    burstSuspendFastLimit: 5,
    burstSuspendFastWindowSec: 1,
    burstSuspendSlowLimit: 10,
    burstSuspendSlowWindowSec: 60,

    bypassRoles: [] as string[],
    bypassChannels: [] as string[]
  });

  // ── Anti-Raid (ex-RaidProtection) — modèle backend séparé (RaidProtectionConfig) ──
  const RAID_DEFAULT_CONFIG = {
    captchaEnabled: false,
    captchaChannelId: null as string | null,
    captchaUnverifiedRoleId: null as string | null,
    captchaTimeoutMinutes: 10,
    captchaMaxAttempts: 3,
    captchaFailAction: 'KICK',
    captchaLogChannelId: null as string | null,
    captchaMode: 'IMAGE',
    captchaVoiceChannelId: null as string | null,
    captchaVoiceQueueLimit: 25,
    captchaVoiceLocale: 'FR',
    antiRaidEnabled: false,
    antiRaidJoinThreshold: 10,
    antiRaidJoinWindowSec: 60,
    antiRaidAction: 'LOCK',
    antiRaidAlertChannelId: null as string | null,
    antiRaidAutoDisableMinutes: 30,
    joinLockKick: true,
    joinLockMessage: '',
    reportsEnabled: false,
    reportsChannelId: null as string | null,
    reportsCooldownSec: 60,
    reportsAnonymous: false,
    scamFilterEnabled: false,
    scamFilterAction: 'DELETE_AND_TIMEOUT',
    scamFilterTimeoutMin: 60,
    scamFilterCustomDomains: [] as string[],
    scamFilterWhitelist: [] as string[],
    scamFilterAlertChannelId: null as string | null,
    scamImageFilterEnabled: false,
    inviteGuardEnabled: false,
    inviteRequireUnitary: false,
    inviteValidationEnabled: false,
    inviteSpamThreshold: 5,
    inviteSpamWindowSec: 60,
    inviteAlertChannelId: null as string | null,
    inviteBypassRoleIds: [] as string[]
  };

  let raidConfig = $state({ ...RAID_DEFAULT_CONFIG });
  let savedRaidConfig = $state({ ...RAID_DEFAULT_CONFIG });

  let raidLiveState = $state({
    raidModeActive: false,
    raidModeManual: false,
    joinLockEnabled: false,
    dmLockEnabled: false,
    inviteEmergencyEnabled: false
  });

  let reportStats = $state({ pending: 0, resolved: 0, dismissed: 0 });
  let scamImageCount = $state(0);
  let pendingReports = $state<any[]>([]);
  let pendingInviteRequests = $state<any[]>([]);
  let scamImages = $state<any[]>([]);
  let showScamImages = $state(false);
  let raidCustomDomainsText = $state('');
  let raidWhitelistText = $state('');

  function applyRaidLoaded(cfg: any) {
    const loaded: typeof RAID_DEFAULT_CONFIG = { ...RAID_DEFAULT_CONFIG };
    for (const key of Object.keys(RAID_DEFAULT_CONFIG) as (keyof typeof RAID_DEFAULT_CONFIG)[]) {
      if (cfg && cfg[key] !== undefined && cfg[key] !== null) (loaded as any)[key] = cfg[key];
      else if (cfg && key.endsWith('ChannelId')) (loaded as any)[key] = cfg[key] ?? null;
    }
    raidConfig = loaded;
    savedRaidConfig = { ...loaded, scamFilterCustomDomains: [...loaded.scamFilterCustomDomains], scamFilterWhitelist: [...loaded.scamFilterWhitelist], inviteBypassRoleIds: [...loaded.inviteBypassRoleIds] };
    raidCustomDomainsText = loaded.scamFilterCustomDomains.join('\n');
    raidWhitelistText = loaded.scamFilterWhitelist.join('\n');
    raidLiveState = {
      raidModeActive: cfg?.raidModeActive ?? false,
      raidModeManual: cfg?.raidModeManual ?? false,
      joinLockEnabled: cfg?.joinLockEnabled ?? false,
      dmLockEnabled: cfg?.dmLockEnabled ?? false,
      inviteEmergencyEnabled: cfg?.inviteEmergencyEnabled ?? false
    };
  }

  async function reloadRaid() {
    const res = await fetchRaidProtection();
    if (res) {
      applyRaidLoaded(res.config);
      reportStats = res.reportStats ?? { pending: 0, resolved: 0, dismissed: 0 };
      scamImageCount = res.scamImageCount ?? 0;
    }
    const [reportsRes, invitesRes] = await Promise.all([
      fetchMemberReports('PENDING').catch(() => null),
      fetchInviteRequests().catch(() => null)
    ]);
    pendingReports = reportsRes?.reports ?? [];
    pendingInviteRequests = (invitesRes?.requests ?? []).filter((r: any) => r.status === 'PENDING');
  }

  async function toggleRaidMode() {
    if (!canManageSettings) return;
    const activating = !raidLiveState.raidModeActive;
    if (activating && !(await confirmDialog.ask({
      title: m.am_confirm_raid_title(),
      description: m.am_confirm_raid_desc(),
      confirmLabel: m.am_confirm_activate(),
      variant: 'warning'
    }))) return;
    await actionState.run(async () => {
      const res = await setRaidMode(activating);
      if (res?.config) applyRaidLoaded(res.config);
      return true;
    }, { successMessage: activating ? m.am_toast_raid_on() : m.am_toast_raid_off() });
  }

  async function toggleJoinLock() {
    if (!canManageSettings) return;
    await actionState.run(async () => {
      const res = await setJoinLock(!raidLiveState.joinLockEnabled);
      if (res?.config) applyRaidLoaded(res.config);
      return true;
    }, { successMessage: raidLiveState.joinLockEnabled ? m.am_toast_joinlock_on() : m.am_toast_joinlock_off() });
  }

  async function toggleDmLock() {
    if (!canManageSettings) return;
    await actionState.run(async () => {
      const res = await setDmLock(!raidLiveState.dmLockEnabled);
      if (res?.config) applyRaidLoaded(res.config);
      return true;
    }, { successMessage: raidLiveState.dmLockEnabled ? m.am_toast_dmlock_on() : m.am_toast_dmlock_off() });
  }

  async function toggleInviteEmergency() {
    if (!canManageSettings) return;
    const activating = !raidLiveState.inviteEmergencyEnabled;
    if (activating && !(await confirmDialog.ask({
      title: m.am_confirm_invite_emergency_title(),
      description: m.am_confirm_invite_emergency_desc(),
      confirmLabel: m.am_confirm_delete_all(),
      variant: 'danger'
    }))) return;
    await actionState.run(async () => {
      const res = await setInviteEmergency(activating);
      if (res?.config) applyRaidLoaded(res.config);
      return true;
    }, { successMessage: activating ? m.am_toast_invite_emergency_on() : m.am_toast_invite_emergency_off() });
  }

  async function handleReportDecision(reportId: string, resolved: boolean) {
    await actionState.run(async () => {
      await decideMemberReport(reportId, resolved);
      pendingReports = pendingReports.filter((r) => r.id !== reportId);
      reportStats.pending = Math.max(0, reportStats.pending - 1);
      if (resolved) reportStats.resolved++;
      else reportStats.dismissed++;
      return true;
    }, { successMessage: resolved ? m.am_toast_report_resolved() : m.am_toast_report_dismissed() });
  }

  async function handleInviteDecision(requestId: string, approved: boolean) {
    await actionState.run(async () => {
      await decideInviteRequest(requestId, approved);
      pendingInviteRequests = pendingInviteRequests.filter((r) => r.id !== requestId);
      return true;
    }, { successMessage: approved ? m.am_toast_invite_approved() : m.am_toast_invite_rejected() });
  }

  async function loadScamImages() {
    showScamImages = !showScamImages;
    if (showScamImages && scamImages.length === 0) {
      const res = await fetchScamImages().catch(() => null);
      scamImages = res?.images ?? [];
    }
  }

  async function handleDeleteScamImage(imageId: string) {
    if (!(await confirmDialog.ask({ title: m.am_confirm_delete_hash_title(), confirmLabel: m.common_delete(), variant: 'danger' }))) return;
    await actionState.run(async () => {
      await deleteScamImage(imageId);
      scamImages = scamImages.filter((i) => i.id !== imageId);
      scamImageCount = Math.max(0, scamImageCount - 1);
      return true;
    }, { successMessage: m.am_toast_hash_deleted() });
  }

  // Snapshot of last-saved state
  let savedConfig = $state(JSON.parse(JSON.stringify({
    discordAutoModEnabled: true,
    spamEnabled: false, spamLimit: 5, spamIntervalSeconds: 5, spamAction: 'TIMEOUT',
    linksEnabled: false, linksAction: 'DELETE_AND_WARN', linksWhitelist: [],
    capsEnabled: false, capsThresholdPercent: 80, capsMinLength: 10,
    emojisEnabled: false, emojisLimit: 10,
    mentionsEnabled: false, mentionsLimit: 5,
    ghostPingEnabled: false, ghostPingAction: 'ALERT',
    antiEveryoneEnabled: false, antiEveryoneAction: 'DELETE_AND_WARN',
    customWordsEnabled: false, customWordsAction: 'BLOCK', customWords: [], customWordsAllowList: [], customWordsTimeoutSec: 60,
    profanityEnabled: false, profanityPresetProfanity: true, profanityPresetSexual: true, profanityPresetSlurs: true, profanityAction: 'BLOCK', profanityAllowList: [], profanityTimeoutSec: 60,
    inviteFilterEnabled: false, inviteFilterAction: 'BLOCK', inviteFilterAllowedGuilds: [], inviteFilterTimeoutSec: 60,
    antiBotEnabled: false, antiBotAction: 'KICK', antiBotBypassUsers: [],
    adminLockEnabled: false, adminLockAction: 'BLOCK', adminLockSecurityRoleIds: [], adminLockNotifyChannelId: null,
    burstSuspendEnabled: false, burstSuspendFastLimit: 5, burstSuspendFastWindowSec: 1, burstSuspendSlowLimit: 10, burstSuspendSlowWindowSec: 60,
    bypassRoles: [], bypassChannels: []
  })));

  $effect(() => {
    const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig);
    const raidDirty = JSON.stringify(raidConfig) !== JSON.stringify(savedRaidConfig);
    if ((dirty || raidDirty) && canManageSettings) {
      untrack(() => {
        unsavedChanges.register({
          label: m.am_page_title(),
          onSave: () => handleSave(),
          onReset: () => {
            config = JSON.parse(JSON.stringify(savedConfig));
            whitelistInput = config.linksWhitelist.join('\n');
            customWordsInput = (config.customWords || []).join('\n');
            customWordsAllowInput = (config.customWordsAllowList || []).join('\n');
            profanityAllowInput = (config.profanityAllowList || []).join('\n');
            inviteAllowedGuildsInput = (config.inviteFilterAllowedGuilds || []).join('\n');
            raidConfig = JSON.parse(JSON.stringify(savedRaidConfig));
            raidCustomDomainsText = savedRaidConfig.scamFilterCustomDomains.join('\n');
            raidWhitelistText = savedRaidConfig.scamFilterWhitelist.join('\n');
          }
        });
      });
    } else if (!dirty && !raidDirty) {
      untrack(() => {
        if (unsavedChanges.isDirty && unsavedChanges.pageLabel === 'AutoMod') unsavedChanges.clear();
      });
    }
  });

  onDestroy(() => {
    if (unsavedChanges.pageLabel === 'AutoMod') unsavedChanges.clear();
  });

  // Helper local states for lists editing
  let whitelistInput = $state('');
  let customWordsInput = $state('');
  let customWordsAllowInput = $state('');
  let profanityAllowInput = $state('');
  let inviteAllowedGuildsInput = $state('');
  let selectedBypassRole = $state('');
  let selectedBypassChannel = $state('');
  let antiBotBypassInput = $state('');
  let selectedAdminLockSecurityRole = $state('');

  onMount(async () => {
    loading = true;
    try {
      await dashboardStore.refresh();
      const res = await fetchAutoModConfig();
      if (res && res.config) {
        config = res.config;
        savedConfig = JSON.parse(JSON.stringify(res.config));
        whitelistInput = config.linksWhitelist.join('\n');
        customWordsInput = (config.customWords || []).join('\n');
        customWordsAllowInput = (config.customWordsAllowList || []).join('\n');
        profanityAllowInput = (config.profanityAllowList || []).join('\n');
        inviteAllowedGuildsInput = (config.inviteFilterAllowedGuilds || []).join('\n');
        if (res.isOwner) isOwner = true;
      }
      await reloadRaid();
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  });

  async function handleSave(): Promise<boolean> {
    if (!canManageSettings) return false;

    config.linksWhitelist = whitelistInput
      .split('\n').map(d => d.trim().toLowerCase()).filter(d => d.length > 0);
    config.customWords = customWordsInput
      .split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    config.customWordsAllowList = customWordsAllowInput
      .split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    config.profanityAllowList = profanityAllowInput
      .split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    config.inviteFilterAllowedGuilds = inviteAllowedGuildsInput
      .split('\n').map(g => g.trim()).filter(g => g.length > 0);
    raidConfig.scamFilterCustomDomains = raidCustomDomainsText
      .split('\n').map(d => d.trim().toLowerCase()).filter(Boolean);
    raidConfig.scamFilterWhitelist = raidWhitelistText
      .split('\n').map(d => d.trim().toLowerCase()).filter(Boolean);

    let success = false;
    let syncWarning: string | null = null;
    await actionState.run(async () => {
      const automodDirty = JSON.stringify(config) !== JSON.stringify(savedConfig);
      const raidDirty = JSON.stringify(raidConfig) !== JSON.stringify(savedRaidConfig);

      if (automodDirty) {
        const res = await updateAutoModConfig(config);
        if (!res || !res.config) throw new Error(m.am_err_save_automod());
        config = res.config;
        savedConfig = JSON.parse(JSON.stringify(res.config));
        syncWarning = res.syncWarning ?? null;
      }

      if (raidDirty) {
        const raidRes = await updateRaidProtection(raidConfig);
        if (!raidRes?.config) throw new Error(m.am_err_save_raid());
        applyRaidLoaded(raidRes.config);
      }

      success = true;
      if (syncWarning) {
        throw new Error(syncWarning);
      }
      return true;
    }, { successMessage: m.am_toast_saved() });
    return success;
  }

  function addBypassRole() {
    if (!selectedBypassRole) return;
    if (!config.bypassRoles.includes(selectedBypassRole)) {
      config.bypassRoles = [...config.bypassRoles, selectedBypassRole];
    }
    selectedBypassRole = '';
  }

  function removeBypassRole(roleId: string) {
    config.bypassRoles = config.bypassRoles.filter(id => id !== roleId);
  }

  function addBypassChannel() {
    if (!selectedBypassChannel) return;
    if (!config.bypassChannels.includes(selectedBypassChannel)) {
      config.bypassChannels = [...config.bypassChannels, selectedBypassChannel];
    }
    selectedBypassChannel = '';
  }

  function removeBypassChannel(channelId: string) {
    config.bypassChannels = config.bypassChannels.filter(id => id !== channelId);
  }

  function getRoleName(roleId: string) {
    const role = availableRoles.find(r => r.id === roleId);
    return role ? `@${role.name}` : roleId;
  }

  function getChannelName(channelId: string) {
    const chan = availableChannels.find(c => c.id === channelId);
    return chan ? `#${chan.name}` : channelId;
  }

  function addAntiBotBypassUser() {
    const userId = antiBotBypassInput.trim();
    if (!userId || !/^\d{17,20}$/.test(userId)) return;
    if (!config.antiBotBypassUsers.includes(userId)) {
      config.antiBotBypassUsers = [...config.antiBotBypassUsers, userId];
    }
    antiBotBypassInput = '';
  }

  function removeAntiBotBypassUser(userId: string) {
    config.antiBotBypassUsers = config.antiBotBypassUsers.filter(id => id !== userId);
  }

  function addAdminLockSecurityRole() {
    if (!selectedAdminLockSecurityRole) return;
    if (!config.adminLockSecurityRoleIds.includes(selectedAdminLockSecurityRole)) {
      config.adminLockSecurityRoleIds = [...config.adminLockSecurityRoleIds, selectedAdminLockSecurityRole];
    }
    selectedAdminLockSecurityRole = '';
  }

  function removeAdminLockSecurityRole(roleId: string) {
    config.adminLockSecurityRoleIds = config.adminLockSecurityRoleIds.filter(id => id !== roleId);
  }

  // Niveaux de protection de la page d'accueil : ils ne touchent qu'aux filtres,
  // aux seuils et aux sanctions. Les salons d'alerte, les roles exemptes et les
  // listes de mots restent a regler dans les onglets, un niveau n'ayant aucun
  // moyen de les deviner.
  const selectedPreset = $derived(findAutomodPreset(config, raidConfig));
  const activePreset = $derived(findAutomodPreset(savedConfig, savedRaidConfig));
  const configDirty = $derived(
    JSON.stringify(config) !== JSON.stringify(savedConfig)
      || JSON.stringify(raidConfig) !== JSON.stringify(savedRaidConfig)
  );

  function applyAutomodPreset(preset: AutomodPreset) {
    if (!canManageSettings) return;
    Object.assign(config, preset.filters);
    Object.assign(raidConfig, preset.raid);
  }

  // La carte « Personnalise » n'a rien a appliquer : elle affiche deja la
  // configuration en place, elle ouvre juste les onglets.
  function openPresetDetail() {
    activeTab = 'bot-filters';
  }
</script>

<ModulePage
  title={m.am_page_title()}
  description={m.am_page_description()}
  icon="shield-alert"
  featureKey="automod"
>
  {#snippet actions()}
    {#if !loading}
      <button
        type="button"
        onclick={() => activeTab = activeTab === 'accueil' ? 'bot-filters' : 'accueil'}
        class="group flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold bg-primary text-on-primary shadow-md shadow-primary/20 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 transition-all"
      >
        <Papicon icon={activeTab === 'accueil' ? 'Settings' : 'ArrowLeft'} size={15} />
        {activeTab === 'accueil' ? m.am_presets_open_advanced() : m.am_presets_back()}
        {#if activeTab === 'accueil'}
          <Papicon icon="ChevronRight" size={14} class="transition-transform group-hover:translate-x-0.5" />
        {/if}
      </button>
    {/if}
  {/snippet}

  <InlineFeedback state={actionState} />

  {#if loading}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <Skeleton height="400px" radius="2.5rem" />
      <Skeleton height="400px" radius="2.5rem" />
    </div>
    <div class="flex justify-center mt-4">
      <LoadingHint context="config" />
    </div>
  {:else if activeTab === 'accueil'}
    <AutomodPresetPicker
      selectedId={selectedPreset?.id ?? null}
      activeId={activePreset?.id ?? null}
      customFilters={selectedPreset ? savedConfig : config}
      customRaid={selectedPreset ? savedRaidConfig : raidConfig}
      disabled={!canManageSettings}
      dirty={configDirty}
      saving={actionState.state.loading}
      onselect={applyAutomodPreset}
      onsave={handleSave}
      ondetail={openPresetDetail}
    />
  {:else}
    <!-- Navigation Tabs -->
    <div class="tab-group w-fit">
      <button
        type="button"
        onclick={() => activeTab = 'bot-filters'}
        class="tab-button {activeTab === 'bot-filters' ? 'active' : ''}"
      >
        <Papicon icon="Shield" size={14} />
        {m.am_tab_bot_filters()}
      </button>
      <button
        type="button"
        onclick={() => activeTab = 'discord-filters'}
        class="tab-button {activeTab === 'discord-filters' ? 'active' : ''}"
      >
        <Papicon icon="MessageSquare" size={14} />
        {m.am_tab_discord_filters()}
      </button>
      <button
        type="button"
        onclick={() => activeTab = 'security'}
        class="tab-button {activeTab === 'security' ? 'active' : ''}"
      >
        <Papicon icon="Lock" size={14} />
        {m.am_tab_security()}
      </button>
      <button
        type="button"
        onclick={() => activeTab = 'exceptions'}
        class="tab-button {activeTab === 'exceptions' ? 'active' : ''}"
      >
        <Papicon icon="Unlock" size={14} />
        {m.am_tab_exceptions()}
      </button>
    </div>

    {#if activeTab === 'bot-filters'}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in duration-300">
        <!-- Left Column: Primary Chat Filters -->
        <div class="space-y-8">
          <!-- Anti-Spam -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="Clock" size={20} class="text-primary" />
                {m.am_spam_title()}
              </h3>
              <ToggleSwitch 
                checked={config.spamEnabled} 
                onToggle={(v: boolean) => config.spamEnabled = v} 
                disabled={!canManageSettings}
              />
            </div>

            {#if config.spamEnabled}
              <div class="grid grid-cols-2 gap-4 animate-in fade-in duration-300">
                <div class="space-y-1.5">
                  <label for="spamLimit" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_spam_max_messages()}</label>
                  <input 
                    id="spamLimit"
                    type="number" 
                    min="2"
                    max="20"
                    bind:value={config.spamLimit} 
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none"
                    disabled={!canManageSettings}
                  />
                </div>

                <div class="space-y-1.5">
                  <label for="spamInterval" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_spam_interval()}</label>
                  <input 
                    id="spamInterval"
                    type="number" 
                    min="1"
                    max="30"
                    bind:value={config.spamIntervalSeconds} 
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none"
                    disabled={!canManageSettings}
                  />
                </div>

                <div class="col-span-2 space-y-1.5">
                  <label for="spamAction" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_spam_action_label()}</label>
                  <select 
                    id="spamAction"
                    bind:value={config.spamAction}
                    class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:outline-none"
                    disabled={!canManageSettings}
                  >
                    <option value="WARN">{m.am_action_warn()}</option>
                    <option value="TIMEOUT">{m.am_action_timeout_10()}</option>
                  </select>
                </div>
              </div>
            {/if}
          </section>

          <!-- Anti-Links & Discord invites -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="Link" size={20} class="text-secondary" />
                {m.am_links_title()}
              </h3>
              <ToggleSwitch 
                checked={config.linksEnabled} 
                onToggle={(v: boolean) => config.linksEnabled = v} 
                disabled={!canManageSettings}
              />
            </div>

            {#if config.linksEnabled}
              <div class="space-y-4 animate-in fade-in duration-300">
                <div class="space-y-1.5">
                  <label for="linksAction" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_links_action_label()}</label>
                  <select 
                    id="linksAction"
                    bind:value={config.linksAction}
                    class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:outline-none"
                    disabled={!canManageSettings}
                  >
                    <option value="DELETE_AND_WARN">{m.am_action_delete_warn()}</option>
                    <option value="DELETE_ONLY">{m.am_action_delete_silent()}</option>
                  </select>
                </div>

                <div class="space-y-1.5">
                  <label for="whitelist" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_links_whitelist_label()}</label>
                  <textarea 
                    id="whitelist"
                    bind:value={whitelistInput} 
                    placeholder="github.com&#10;google.com"
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none h-24 resize-none font-mono"
                    disabled={!canManageSettings}
                  ></textarea>
                </div>
              </div>
            {/if}
          </section>

          <!-- Anti-Caps (MAJUSCULES) -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="Font" size={20} class="text-tertiary" />
                {m.am_caps_title()}
              </h3>
              <ToggleSwitch 
                checked={config.capsEnabled} 
                onToggle={(v: boolean) => config.capsEnabled = v} 
                disabled={!canManageSettings}
              />
            </div>

            {#if config.capsEnabled}
              <div class="grid grid-cols-2 gap-4 animate-in fade-in duration-300">
                <div class="space-y-1.5">
                  <label for="capsThresh" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_caps_threshold()}</label>
                  <input 
                    id="capsThresh"
                    type="number" 
                    min="20"
                    max="100"
                    bind:value={config.capsThresholdPercent} 
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none"
                    disabled={!canManageSettings}
                  />
                </div>

                <div class="space-y-1.5">
                  <label for="capsMin" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_caps_minlength()}</label>
                  <input 
                    id="capsMin"
                    type="number" 
                    min="4"
                    bind:value={config.capsMinLength} 
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none"
                    disabled={!canManageSettings}
                  />
                </div>
              </div>
            {/if}
          </section>
        </div>

        <!-- Right Column: Secondary & Mentions Filters -->
        <div class="space-y-8">
          <!-- Emojis & Mentions Spam (Grouped Side-by-Side in Sub-grid) -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Emojis Flood -->
            <section class="bg-surface-container-low/30 border border-outline-variant/10 p-6 rounded-xl space-y-4">
              <div class="flex items-center justify-between border-b border-outline-variant/15 pb-3">
                <h3 class="text-sm font-semibold flex items-center gap-2">
                  <Papicon icon="Emoji" size={18} class="text-amber-400" />
                  {m.am_emojis_title()}
                </h3>
                <ToggleSwitch 
                  checked={config.emojisEnabled} 
                  onToggle={(v: boolean) => config.emojisEnabled = v} 
                  disabled={!canManageSettings}
                />
              </div>

              {#if config.emojisEnabled}
                <div class="space-y-1.5 animate-in fade-in duration-300">
                  <label for="emojisLim" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.am_limit_per_message()}</label>
                  <input 
                    id="emojisLim"
                    type="number" 
                    min="1"
                    bind:value={config.emojisLimit} 
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none"
                    disabled={!canManageSettings}
                  />
                </div>
              {:else}
                <p class="text-xs text-on-surface-variant/50">{m.am_emojis_disabled()}</p>
              {/if}
            </section>

            <!-- Mentions Flood -->
            <section class="bg-surface-container-low/30 border border-outline-variant/10 p-6 rounded-xl space-y-4">
              <div class="flex items-center justify-between border-b border-outline-variant/15 pb-3">
                <h3 class="text-sm font-semibold flex items-center gap-2">
                  <Papicon icon="User" size={18} class="text-purple-400" />
                  {m.am_mentions_title()}
                </h3>
                <ToggleSwitch 
                  checked={config.mentionsEnabled} 
                  onToggle={(v: boolean) => config.mentionsEnabled = v} 
                  disabled={!canManageSettings}
                />
              </div>

              {#if config.mentionsEnabled}
                <div class="space-y-1.5 animate-in fade-in duration-300">
                  <label for="mentionsLim" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.am_limit_per_message()}</label>
                  <input 
                    id="mentionsLim"
                    type="number" 
                    min="1"
                    bind:value={config.mentionsLimit} 
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none"
                    disabled={!canManageSettings}
                  />
                </div>
              {:else}
                <p class="text-xs text-on-surface-variant/50">{m.am_mentions_disabled()}</p>
              {/if}
            </section>
          </div>

          <!-- Ghost Ping & Anti-Everyone (Grouped Side-by-Side in Sub-grid) -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Anti-Ghost Ping -->
            <section class="bg-surface-container-low/30 border border-outline-variant/10 p-6 rounded-xl space-y-4">
              <div class="flex items-center justify-between border-b border-outline-variant/15 pb-3">
                <h3 class="text-sm font-semibold flex items-center gap-2">
                  <Papicon icon="Ghost" size={18} class="text-rose-400" />
                  {m.am_ghostping_title()}
                </h3>
                <ToggleSwitch 
                  checked={config.ghostPingEnabled} 
                  onToggle={(v: boolean) => config.ghostPingEnabled = v} 
                  disabled={!canManageSettings}
                />
              </div>

              <p class="text-[11px] text-on-surface-variant/70 leading-relaxed">
                {m.am_ghostping_desc()}
                <span class="text-amber-500/90 font-medium block mt-1">{m.am_ghostping_cache_warning()}</span>
              </p>

              {#if config.ghostPingEnabled}
                <div class="space-y-1.5 animate-in fade-in duration-300">
                  <label for="ghostPingAction" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.am_sanction_label()}</label>
                  <select 
                    id="ghostPingAction"
                    bind:value={config.ghostPingAction}
                    class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs text-on-surface focus:outline-none"
                    disabled={!canManageSettings}
                  >
                    <option value="ALERT">{m.am_ghostping_action_alert()}</option>
                    <option value="WARN">{m.am_ghostping_action_warn()}</option>
                  </select>
                </div>
              {/if}
            </section>

            <!-- Anti-Everyone/Here Troll -->
            <section class="bg-surface-container-low/30 border border-outline-variant/10 p-6 rounded-xl space-y-4">
              <div class="flex items-center justify-between border-b border-outline-variant/15 pb-3">
                <h3 class="text-sm font-semibold flex items-center gap-2">
                  <Papicon icon="ShieldAlert" size={18} class="text-red-400" />
                  {m.am_everyone_title()}
                </h3>
                <ToggleSwitch 
                  checked={config.antiEveryoneEnabled} 
                  onToggle={(v: boolean) => config.antiEveryoneEnabled = v} 
                  disabled={!canManageSettings}
                />
              </div>

              <p class="text-[11px] text-on-surface-variant/70 leading-relaxed">
                {m.am_everyone_desc()}
              </p>

              {#if config.antiEveryoneEnabled}
                <div class="space-y-1.5 animate-in fade-in duration-300">
                  <label for="antiEveryoneAction" class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.am_sanction_label()}</label>
                  <select 
                    id="antiEveryoneAction"
                    bind:value={config.antiEveryoneAction}
                    class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs text-on-surface focus:outline-none"
                    disabled={!canManageSettings}
                  >
                    <option value="DELETE_ONLY">{m.am_everyone_delete_only()}</option>
                    <option value="DELETE_AND_WARN">{m.am_everyone_delete_warn()}</option>
                    <option value="TIMEOUT">{m.am_everyone_timeout()}</option>
                  </select>
                </div>
              {/if}
            </section>
          </div>
        </div>
      </div>

    {:else if activeTab === 'discord-filters'}
      <div class="space-y-6 animate-in fade-in duration-300">
        <!-- Native Discord AutoMod Header -->
        <div class="bg-surface-container-low/40 p-6 rounded-xl border border-outline-variant/20 flex flex-col md:flex-row md:items-center gap-4">
          <div class="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary shrink-0">
            <Papicon icon="Shield" size={20} />
          </div>
          <div>
            <h2 class="text-sm font-bold text-on-surface uppercase tracking-widest flex items-center gap-2">
              {m.am_discord_native_title()}
            </h2>
            <p class="text-xs text-on-surface-variant/70 mt-1">
              {m.am_discord_native_desc()}
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <!-- Custom Words Filter -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="Filter" size={20} class="text-orange-400" />
                {m.am_customwords_title()}
              </h3>
              <ToggleSwitch
                checked={config.customWordsEnabled}
                onToggle={(v: boolean) => config.customWordsEnabled = v}
                disabled={!canManageSettings}
              />
            </div>

            <p class="text-xs text-on-surface-variant/70 leading-relaxed">
              {m.am_customwords_desc()}
            </p>

            {#if config.customWordsEnabled}
              <div class="space-y-4 animate-in fade-in duration-300">
                <div class="space-y-1.5">
                  <label for="customWordsAction" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_action_label()}</label>
                  <select
                    id="customWordsAction"
                    bind:value={config.customWordsAction}
                    class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:outline-none"
                    disabled={!canManageSettings}
                  >
                    <option value="BLOCK">{m.am_action_block()}</option>
                    <option value="TIMEOUT">{m.am_action_block_timeout()}</option>
                    <option value="ALERT">{m.am_action_alert_only()}</option>
                  </select>
                </div>

                {#if config.customWordsAction === 'TIMEOUT'}
                  <div class="space-y-1.5">
                    <label for="customWordsTimeout" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_timeout_duration_sec()}</label>
                    <input
                      id="customWordsTimeout"
                      type="number" min="5" max="2419200"
                      bind:value={config.customWordsTimeoutSec}
                      class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none"
                      disabled={!canManageSettings}
                    />
                  </div>
                {/if}

                <div class="space-y-1.5">
                  <label for="customWords" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_customwords_list_label()}</label>
                  <textarea
                    id="customWords"
                    bind:value={customWordsInput}
                    placeholder={m.am_ph_words_example()}
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none h-32 resize-none font-mono"
                    disabled={!canManageSettings}
                  ></textarea>
                  <p class="text-[10px] text-on-surface-variant/50 ml-2">{m.am_customwords_wildcard_hint()}</p>
                </div>

                <div class="space-y-1.5">
                  <label for="customWordsAllow" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_customwords_allow_label()}</label>
                  <textarea
                    id="customWordsAllow"
                    bind:value={customWordsAllowInput}
                    placeholder="exception1&#10;exception2"
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none h-20 resize-none font-mono"
                    disabled={!canManageSettings}
                  ></textarea>
                </div>
              </div>
            {/if}
          </section>

          <!-- Profanity Filter -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="ShieldX" size={20} class="text-red-400" />
                {m.am_profanity_title()}
              </h3>
              <ToggleSwitch
                checked={config.profanityEnabled}
                onToggle={(v: boolean) => config.profanityEnabled = v}
                disabled={!canManageSettings}
              />
            </div>

            <p class="text-xs text-on-surface-variant/70 leading-relaxed">
              {m.am_profanity_desc()}
            </p>

            {#if config.profanityEnabled}
              <div class="space-y-4 animate-in fade-in duration-300">
                <div class="space-y-3">
                  <span class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_profanity_categories()}</span>
                  <div class="space-y-2">
                    <label class="flex items-center gap-3 p-3 bg-surface-container-high/30 rounded-lg cursor-pointer hover:bg-surface-container-high/50 transition-colors">
                      <input type="checkbox" bind:checked={config.profanityPresetProfanity} disabled={!canManageSettings} class="rounded border-outline-variant/30" />
                      <div>
                        <span class="text-sm font-medium">{m.am_profanity_cat_insults()}</span>
                        <p class="text-[10px] text-on-surface-variant/50">{m.am_profanity_cat_insults_desc()}</p>
                      </div>
                    </label>
                    <label class="flex items-center gap-3 p-3 bg-surface-container-high/30 rounded-lg cursor-pointer hover:bg-surface-container-high/50 transition-colors">
                      <input type="checkbox" bind:checked={config.profanityPresetSexual} disabled={!canManageSettings} class="rounded border-outline-variant/30" />
                      <div>
                        <span class="text-sm font-medium">{m.am_profanity_cat_sexual()}</span>
                        <p class="text-[10px] text-on-surface-variant/50">{m.am_profanity_cat_sexual_desc()}</p>
                      </div>
                    </label>
                    <label class="flex items-center gap-3 p-3 bg-surface-container-high/30 rounded-lg cursor-pointer hover:bg-surface-container-high/50 transition-colors">
                      <input type="checkbox" bind:checked={config.profanityPresetSlurs} disabled={!canManageSettings} class="rounded border-outline-variant/30" />
                      <div>
                        <span class="text-sm font-medium">{m.am_profanity_cat_slurs()}</span>
                        <p class="text-[10px] text-on-surface-variant/50">{m.am_profanity_cat_slurs_desc()}</p>
                      </div>
                    </label>
                  </div>
                </div>

                <div class="space-y-1.5">
                  <label for="profanityAction" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_action_label()}</label>
                  <select
                    id="profanityAction"
                    bind:value={config.profanityAction}
                    class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:outline-none"
                    disabled={!canManageSettings}
                  >
                    <option value="BLOCK">{m.am_action_block()}</option>
                    <option value="TIMEOUT">{m.am_action_block_timeout()}</option>
                    <option value="ALERT">{m.am_action_alert_only()}</option>
                  </select>
                </div>

                {#if config.profanityAction === 'TIMEOUT'}
                  <div class="space-y-1.5">
                    <label for="profanityTimeout" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_timeout_duration_sec()}</label>
                    <input
                      id="profanityTimeout"
                      type="number" min="5" max="2419200"
                      bind:value={config.profanityTimeoutSec}
                      class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none"
                      disabled={!canManageSettings}
                    />
                  </div>
                {/if}

                <div class="space-y-1.5">
                  <label for="profanityAllow" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_profanity_allow_label()}</label>
                  <textarea
                    id="profanityAllow"
                    bind:value={profanityAllowInput}
                    placeholder={m.am_ph_profanity_allow_example()}
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none h-20 resize-none font-mono"
                    disabled={!canManageSettings}
                  ></textarea>
                </div>
              </div>
            {/if}
          </section>

          <!-- Invite Filter -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="UserPlus" size={20} class="text-indigo-400" />
                {m.am_invitefilter_title()}
              </h3>
              <ToggleSwitch
                checked={config.inviteFilterEnabled}
                onToggle={(v: boolean) => config.inviteFilterEnabled = v}
                disabled={!canManageSettings}
              />
            </div>

            <p class="text-xs text-on-surface-variant/70 leading-relaxed">
              {m.am_invitefilter_desc()}
            </p>

            {#if config.inviteFilterEnabled}
              <div class="space-y-4 animate-in fade-in duration-300">
                <div class="space-y-1.5">
                  <label for="inviteFilterAction" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_action_label()}</label>
                  <select
                    id="inviteFilterAction"
                    bind:value={config.inviteFilterAction}
                    class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:outline-none"
                    disabled={!canManageSettings}
                  >
                    <option value="BLOCK">{m.am_action_block()}</option>
                    <option value="TIMEOUT">{m.am_action_block_timeout()}</option>
                    <option value="ALERT">{m.am_action_alert_only()}</option>
                  </select>
                </div>

                {#if config.inviteFilterAction === 'TIMEOUT'}
                  <div class="space-y-1.5">
                    <label for="inviteFilterTimeout" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_timeout_duration_sec()}</label>
                    <input
                      id="inviteFilterTimeout"
                      type="number" min="5" max="2419200"
                      bind:value={config.inviteFilterTimeoutSec}
                      class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none"
                      disabled={!canManageSettings}
                    />
                  </div>
                {/if}

                <div class="space-y-1.5">
                  <label for="inviteAllowed" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_invitefilter_allowed_label()}</label>
                  <textarea
                    id="inviteAllowed"
                    bind:value={inviteAllowedGuildsInput}
                    placeholder={m.am_ph_invite_codes_example()}
                    class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:outline-none h-20 resize-none font-mono"
                    disabled={!canManageSettings}
                  ></textarea>
                  <p class="text-[10px] text-on-surface-variant/50 ml-2">{m.am_invitefilter_allowed_hint()}</p>
                </div>
              </div>
            {/if}
          </section>
        </div>
      </div>

    {:else if activeTab === 'security'}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in duration-300">
        <!-- Anti-Bot (Mode Sécurisé) -->
        <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
          <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
            <h3 class="text-lg font-semibold flex items-center gap-3">
              <Papicon icon="ShieldCheck" size={20} class="text-cyan-400" />
              {m.am_antibot_title()}
            </h3>
            <ToggleSwitch
              checked={config.antiBotEnabled}
              onToggle={(v: boolean) => config.antiBotEnabled = v}
              disabled={!isOwner}
            />
          </div>

          {#if !isOwner}
            <div class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p class="text-xs text-red-400/90 font-medium">
                {m.am_antibot_owner_only()}
              </p>
            </div>
          {/if}

          <p class="text-xs text-on-surface-variant/70 leading-relaxed">
            {m.am_antibot_desc()}
          </p>

          {#if config.antiBotEnabled}
            <div class="space-y-5 animate-in fade-in duration-300">
              <div class="space-y-1.5">
                <label for="antiBotAction" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_antibot_action_label()}</label>
                <select
                  id="antiBotAction"
                  bind:value={config.antiBotAction}
                  class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:outline-none"
                  disabled={!isOwner}
                >
                  <option value="KICK">{m.am_antibot_kick()}</option>
                  <option value="BAN">{m.am_antibot_ban()}</option>
                </select>
              </div>

              <!-- Bypass users -->
              <div class="space-y-3 pt-2 border-t border-outline-variant/10">
                <span class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_antibot_bypass_title()}</span>
                <p class="text-xs text-on-surface-variant/50 ml-2">{m.am_antibot_bypass_desc()}</p>
                {#if isOwner}
                  <div class="flex gap-2">
                    <input
                      type="text"
                      bind:value={antiBotBypassInput}
                      placeholder={m.am_antibot_user_id_placeholder()}
                      class="flex-1 bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
                      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); addAntiBotBypassUser(); } }}
                    />
                    <button
                      type="button"
                      onclick={addAntiBotBypassUser}
                      disabled={!antiBotBypassInput.trim() || !/^\d{17,20}$/.test(antiBotBypassInput.trim())}
                      class="px-4 py-2.5 bg-outline-variant/20 hover:bg-outline-variant/35 text-xs font-bold rounded-xl transition-all disabled:opacity-50"
                    >
                      {m.common_add()}
                    </button>
                  </div>
                {/if}

                <div class="flex flex-wrap gap-2">
                  {#each config.antiBotBypassUsers as userId}
                    <div class="flex items-center gap-1.5 px-3 py-1 bg-surface-container-high/40 border border-outline-variant/10 rounded-xl text-xs font-bold font-mono">
                      <span>{userId}</span>
                      {#if isOwner}
                        <button type="button" onclick={() => removeAntiBotBypassUser(userId)} class="text-error hover:text-error/80 transition-colors ml-1 text-sm font-bold leading-none">&times;</button>
                      {/if}
                    </div>
                  {:else}
                    <span class="text-xs text-on-surface-variant/40 italic ml-2">{m.am_antibot_bypass_empty()}</span>
                  {/each}
                </div>
              </div>

              <div class="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p class="text-xs text-amber-400/90 font-medium">
                  {m.am_antibot_notice()}
                </p>
              </div>
            </div>
          {/if}
        </section>

        <!-- Admin Permission Lock -->
        <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
          <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
            <h3 class="text-lg font-semibold flex items-center gap-3">
              <Papicon icon="lock" size={20} class="text-rose-400" />
              {m.am_admin_lock()}
            </h3>
            <ToggleSwitch
              checked={config.adminLockEnabled}
              onToggle={(v: boolean) => config.adminLockEnabled = v}
              disabled={!isOwner}
            />
          </div>

          {#if !isOwner}
            <div class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p class="text-xs text-red-400/90 font-medium">
                {m.am_adminlock_owner_only()}
              </p>
            </div>
          {/if}

          <p class="text-xs text-on-surface-variant/70 leading-relaxed">
            {m.am_adminlock_desc_before()}<strong>ADMINISTRATOR</strong>{m.am_adminlock_desc_after()}
          </p>

          {#if config.adminLockEnabled}
            <div class="space-y-5 animate-in fade-in duration-300">
              <a href="/admin-lock" class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors">
                <Papicon icon="inbox" size={14} /> {m.am_adminlock_view_requests()}
              </a>

              <!-- Rôles sécurité -->
              <div class="space-y-3 pt-2 border-t border-outline-variant/10">
                <span class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_adminlock_security_roles()}</span>
                <p class="text-xs text-on-surface-variant/50 ml-2">{m.am_adminlock_security_roles_desc()}</p>
                {#if isOwner}
                  <div class="flex gap-2">
                    <div class="flex-1">
                      <SearchableSelect
                        id="adminLockSecurityRoleSelect"
                        bind:value={selectedAdminLockSecurityRole}
                        options={availableRoles.map(r => ({ id: r.id, name: `@${r.name}` }))}
                        placeholder={m.am_adminlock_add_role_placeholder()}
                        className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-primary/20 transition-all"
                      />
                    </div>
                    <button
                      type="button"
                      onclick={addAdminLockSecurityRole}
                      disabled={!selectedAdminLockSecurityRole}
                      class="px-4 py-2.5 bg-outline-variant/20 hover:bg-outline-variant/35 text-xs font-bold rounded-xl transition-all disabled:opacity-50"
                    >
                      {m.common_add()}
                    </button>
                  </div>
                {/if}

                <div class="flex flex-wrap gap-2">
                  {#each config.adminLockSecurityRoleIds as roleId}
                    <div class="flex items-center gap-1.5 px-3 py-1 bg-surface-container-high/40 border border-outline-variant/10 rounded-xl text-xs font-bold">
                      <span>{getRoleName(roleId)}</span>
                      {#if isOwner}
                        <button type="button" onclick={() => removeAdminLockSecurityRole(roleId)} class="text-error hover:text-error/80 transition-colors ml-1 text-sm font-bold leading-none">&times;</button>
                      {/if}
                    </div>
                  {:else}
                    <span class="text-xs text-on-surface-variant/40 italic ml-2">{m.am_adminlock_roles_empty()}</span>
                  {/each}
                </div>
              </div>

              <!-- Salon de notification -->
              <div class="space-y-1.5 pt-2 border-t border-outline-variant/10">
                <label for="adminLockNotifyChannel" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_adminlock_notify_channel()}</label>
                <p class="text-xs text-on-surface-variant/50 ml-2 mb-1">{m.am_adminlock_notify_channel_desc()}</p>
                <select
                  id="adminLockNotifyChannel"
                  bind:value={config.adminLockNotifyChannelId}
                  class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:outline-none"
                  disabled={!isOwner}
                >
                  <option value={null}>{m.am_adminlock_default_log_channel()}</option>
                  {#each availableChannels as c}
                    <option value={c.id}># {channelDisplayName(c)}</option>
                  {/each}
                </select>
              </div>

              <!-- Anti-rafale -->
              <div class="space-y-4 pt-2 border-t border-outline-variant/10">
                <div class="flex items-center justify-between">
                  <div>
                    <span class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_burst_title()}</span>
                    <p class="text-xs text-on-surface-variant/50 ml-2 mt-1">
                      {m.am_burst_desc()}
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={config.burstSuspendEnabled}
                    onToggle={(v: boolean) => config.burstSuspendEnabled = v}
                    disabled={!isOwner}
                  />
                </div>

                {#if config.burstSuspendEnabled}
                  <div class="grid grid-cols-2 gap-4 animate-in fade-in duration-300">
                    <div class="space-y-1.5">
                      <label for="burstFastLimit" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_burst_fast()}</label>
                      <div class="flex items-center gap-2">
                        <input id="burstFastLimit" type="number" min="1" max="100" bind:value={config.burstSuspendFastLimit} disabled={!isOwner}
                          class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none" />
                        <span class="text-xs text-on-surface-variant/50 whitespace-nowrap">{m.am_burst_act_per()}</span>
                        <input type="number" min="1" max="3600" bind:value={config.burstSuspendFastWindowSec} disabled={!isOwner}
                          class="w-20 bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none" />
                        <span class="text-xs text-on-surface-variant/50">s</span>
                      </div>
                    </div>
                    <div class="space-y-1.5">
                      <label for="burstSlowLimit" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_burst_slow()}</label>
                      <div class="flex items-center gap-2">
                        <input id="burstSlowLimit" type="number" min="1" max="500" bind:value={config.burstSuspendSlowLimit} disabled={!isOwner}
                          class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none" />
                        <span class="text-xs text-on-surface-variant/50 whitespace-nowrap">{m.am_burst_act_per()}</span>
                        <input type="number" min="1" max="3600" bind:value={config.burstSuspendSlowWindowSec} disabled={!isOwner}
                          class="w-20 bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none" />
                        <span class="text-xs text-on-surface-variant/50">s</span>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>

              <div class="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p class="text-xs text-amber-400/90 font-medium">
                  {m.am_adminlock_notice()}
                </p>
              </div>
            </div>
          {/if}
        </section>
      </div>

      <!-- ── Anti-Raid (captcha, détection, invitations, anti-scam, signalements) ── -->
      <div class="mt-8 space-y-8 animate-in fade-in duration-300">
        <h3 class="text-xl font-semibold flex items-center gap-3">
          <Papicon icon="ShieldAlert" size={20} class="text-orange-400" />
          {m.am_antiraid_section_title()}
        </h3>

        <!-- Panneau d'urgence -->
        <section class="bg-red-500/5 border border-red-500/20 p-8 rounded-xl space-y-5">
          <h3 class="text-lg font-semibold flex items-center gap-3 border-b border-red-500/15 pb-3">
            <Papicon icon="Siren" size={20} class="text-red-500" />
            {m.am_emergency_title()}
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div class="p-4 rounded-lg bg-surface-container-high/30 border border-outline-variant/10 flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-on-surface">{m.am_raid_mode()}</p>
                <p class="text-[11px] text-on-surface-variant/60">{raidLiveState.raidModeActive ? m.am_raid_mode_active({ mode: raidLiveState.raidModeManual ? m.am_raid_mode_manual() : m.am_raid_mode_auto() }) : m.common_inactive()}</p>
              </div>
              <ToggleSwitch checked={raidLiveState.raidModeActive} onToggle={toggleRaidMode} disabled={!canManageSettings || actionState.state.loading} />
            </div>
            <div class="p-4 rounded-lg bg-surface-container-high/30 border border-outline-variant/10 flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-on-surface">{m.am_joinlock()}</p>
                <p class="text-[11px] text-on-surface-variant/60">{m.am_joinlock_desc()}</p>
              </div>
              <ToggleSwitch checked={raidLiveState.joinLockEnabled} onToggle={toggleJoinLock} disabled={!canManageSettings || actionState.state.loading} />
            </div>
            <div class="p-4 rounded-lg bg-surface-container-high/30 border border-outline-variant/10 flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-on-surface">{m.am_dmlock()}</p>
                <p class="text-[11px] text-on-surface-variant/60">{m.am_dmlock_desc()}</p>
              </div>
              <ToggleSwitch checked={raidLiveState.dmLockEnabled} onToggle={toggleDmLock} disabled={!canManageSettings || actionState.state.loading} />
            </div>
            <div class="p-4 rounded-lg bg-surface-container-high/30 border border-outline-variant/10 flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-on-surface">{m.am_invite_emergency()}</p>
                <p class="text-[11px] text-on-surface-variant/60">{m.am_invite_emergency_desc()}</p>
              </div>
              <ToggleSwitch checked={raidLiveState.inviteEmergencyEnabled} onToggle={toggleInviteEmergency} disabled={!canManageSettings || actionState.state.loading} />
            </div>
          </div>
        </section>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <!-- Captcha -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="ScanFace" size={20} class="text-blue-500" />
                {m.am_captcha_title()}
              </h3>
              <ToggleSwitch checked={raidConfig.captchaEnabled} onToggle={(v: boolean) => raidConfig.captchaEnabled = v} disabled={!canManageSettings} />
            </div>
            <p class="text-xs text-on-surface-variant/70 leading-relaxed">{m.am_captcha_desc()}</p>
            {#if raidConfig.captchaEnabled && (!raidConfig.captchaChannelId || !raidConfig.captchaUnverifiedRoleId)}
              <p class="text-xs text-orange-500 leading-relaxed border border-orange-500/30 bg-orange-500/5 rounded-lg px-4 py-3">
                {m.am_captcha_incomplete_warning()}
              </p>
            {/if}
            {#if raidConfig.captchaEnabled}
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-300">
                <div class="space-y-1.5">
                  <label for="captchaMode" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_captcha_mode()}</label>
                  <select id="captchaMode" bind:value={raidConfig.captchaMode} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings}>
                    <option value="IMAGE">{m.am_captcha_mode_image()}</option>
                    <option value="VOICE">{m.am_captcha_mode_voice()}</option>
                  </select>
                </div>
                <div class="space-y-1.5">
                  <label for="captchaChannel" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_captcha_channel()}</label>
                  <SearchableSelect id="captchaChannel" bind:value={raidConfig.captchaChannelId} options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.am_choose_channel()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                <div class="space-y-1.5">
                  <label for="captchaRole" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_captcha_role()}</label>
                  <SearchableSelect id="captchaRole" bind:value={raidConfig.captchaUnverifiedRoleId} options={availableRoles.map(r => ({ id: r.id, name: `@${r.name}` }))} placeholder={m.am_choose_role()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                <div class="space-y-1.5">
                  <label for="captchaTimeout" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_captcha_delay()}</label>
                  <input id="captchaTimeout" type="number" min="2" max="60" bind:value={raidConfig.captchaTimeoutMinutes} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                <div class="space-y-1.5">
                  <label for="captchaAttempts" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_captcha_attempts()}</label>
                  <input id="captchaAttempts" type="number" min="1" max="10" bind:value={raidConfig.captchaMaxAttempts} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                <div class="space-y-1.5">
                  <label for="captchaFail" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_captcha_fail_action()}</label>
                  <select id="captchaFail" bind:value={raidConfig.captchaFailAction} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings}>
                    <option value="KICK">{m.am_captcha_fail_kick()}</option>
                    <option value="BAN">{m.am_captcha_fail_ban()}</option>
                  </select>
                </div>
                <div class="space-y-1.5">
                  <label for="captchaLog" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_captcha_log_channel()}</label>
                  <SearchableSelect id="captchaLog" bind:value={raidConfig.captchaLogChannelId} options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.am_optional()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                {#if raidConfig.captchaMode === 'VOICE'}
                  <div class="space-y-1.5">
                    <label for="captchaVoiceChannel" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_captcha_voice_channel()}</label>
                    <SearchableSelect id="captchaVoiceChannel" bind:value={raidConfig.captchaVoiceChannelId} options={availableChannels.filter(c => c.type === 'voice').map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.am_choose_channel()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                  </div>
                  <div class="space-y-1.5">
                    <label for="captchaVoiceLocale" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_captcha_voice_locale()}</label>
                    <select id="captchaVoiceLocale" bind:value={raidConfig.captchaVoiceLocale} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings}>
                      <option value="FR">{m.am_captcha_voice_locale_fr()}</option>
                      <option value="EN">{m.am_captcha_voice_locale_en()}</option>
                    </select>
                  </div>
                  <div class="space-y-1.5">
                    <label for="captchaVoiceQueue" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_captcha_voice_queue_limit()}</label>
                    <input id="captchaVoiceQueue" type="number" min="1" max="100" bind:value={raidConfig.captchaVoiceQueueLimit} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                  </div>
                  <p class="md:col-span-2 text-xs text-on-surface-variant/70 leading-relaxed">{m.am_captcha_voice_hint()}</p>
                {/if}
              </div>
            {/if}
          </section>

          <!-- Anti-raid -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="ShieldAlert" size={20} class="text-orange-500" />
                {m.am_joinwave_title()}
              </h3>
              <ToggleSwitch checked={raidConfig.antiRaidEnabled} onToggle={(v: boolean) => raidConfig.antiRaidEnabled = v} disabled={!canManageSettings} />
            </div>
            {#if raidConfig.antiRaidEnabled}
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-300">
                <div class="space-y-1.5">
                  <label for="antiRaidThreshold" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_joinwave_threshold()}</label>
                  <input id="antiRaidThreshold" type="number" min="3" max="100" bind:value={raidConfig.antiRaidJoinThreshold} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                <div class="space-y-1.5">
                  <label for="antiRaidWindow" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_joinwave_window()}</label>
                  <input id="antiRaidWindow" type="number" min="10" max="600" bind:value={raidConfig.antiRaidJoinWindowSec} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                <div class="space-y-1.5">
                  <label for="antiRaidAction" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_joinwave_action()}</label>
                  <select id="antiRaidAction" bind:value={raidConfig.antiRaidAction} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings}>
                    <option value="LOCK">{m.am_joinwave_lock()}</option>
                    <option value="CAPTCHA">{m.am_joinwave_captcha()}</option>
                    <option value="KICK">{m.am_joinwave_kick()}</option>
                  </select>
                </div>
                <div class="space-y-1.5">
                  <label for="antiRaidAutoDisable" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_joinwave_autodisable()}</label>
                  <input id="antiRaidAutoDisable" type="number" min="5" max="1440" bind:value={raidConfig.antiRaidAutoDisableMinutes} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                <div class="space-y-1.5 md:col-span-2">
                  <label for="antiRaidAlert" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_alerts_channel()}</label>
                  <SearchableSelect id="antiRaidAlert" bind:value={raidConfig.antiRaidAlertChannelId} options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.am_choose_channel()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
              </div>
            {/if}
          </section>

          <!-- Contrôle des invitations -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="Link" size={20} class="text-cyan-500" />
                {m.am_inviteguard_title()}
              </h3>
              <ToggleSwitch checked={raidConfig.inviteGuardEnabled} onToggle={(v: boolean) => raidConfig.inviteGuardEnabled = v} disabled={!canManageSettings} />
            </div>
            <div class="space-y-3">
              <div class="p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-medium text-on-surface">{m.am_invite_unitary()}</p>
                  <p class="text-[11px] text-on-surface-variant/60">{m.am_invite_unitary_desc()}</p>
                </div>
                <ToggleSwitch checked={raidConfig.inviteRequireUnitary} onToggle={(v: boolean) => raidConfig.inviteRequireUnitary = v} disabled={!canManageSettings} />
              </div>
              <div class="p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-medium text-on-surface">{m.am_invite_staff_validation()}</p>
                  <p class="text-[11px] text-on-surface-variant/60">{m.am_invite_staff_validation_desc()}</p>
                </div>
                <ToggleSwitch checked={raidConfig.inviteValidationEnabled} onToggle={(v: boolean) => raidConfig.inviteValidationEnabled = v} disabled={!canManageSettings} />
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-1.5">
                  <label for="inviteSpamThreshold" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_invite_spam_threshold()}</label>
                  <input id="inviteSpamThreshold" type="number" min="2" max="50" bind:value={raidConfig.inviteSpamThreshold} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                <div class="space-y-1.5">
                  <label for="inviteSpamWindow" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_invite_spam_window()}</label>
                  <input id="inviteSpamWindow" type="number" min="10" max="3600" bind:value={raidConfig.inviteSpamWindowSec} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                <div class="space-y-1.5 md:col-span-2">
                  <label for="inviteAlertChannel" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_invite_alert_channel()}</label>
                  <SearchableSelect id="inviteAlertChannel" bind:value={raidConfig.inviteAlertChannelId} options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.am_choose_channel()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
              </div>
            </div>
            {#if pendingInviteRequests.length > 0}
              <div class="space-y-2 pt-2 border-t border-outline-variant/15">
                <p class="text-xs font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.am_pending_requests({ count: pendingInviteRequests.length })}</p>
                {#each pendingInviteRequests as request (request.id)}
                  <div class="p-3 rounded-lg bg-surface-container-high/30 border border-outline-variant/10 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p class="text-sm text-on-surface truncate">{m.am_invite_creator()} <span class="font-mono">{request.creatorId}</span></p>
                      <p class="text-[11px] text-on-surface-variant/60">{m.am_invite_uses_expiry({ uses: request.maxUses === 0 ? '∞' : request.maxUses, expires: request.maxAgeSec === 0 ? m.am_never() : `${Math.round(request.maxAgeSec / 3600)}h` })}</p>
                    </div>
                    <div class="flex gap-2 shrink-0">
                      <button type="button" class="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 rounded-lg text-xs font-medium" onclick={() => handleInviteDecision(request.id, true)} disabled={!canManageSettings}>{m.am_approve()}</button>
                      <button type="button" class="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 rounded-lg text-xs font-medium" onclick={() => handleInviteDecision(request.id, false)} disabled={!canManageSettings}>{m.am_reject()}</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </section>

          <!-- Anti-scam -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="Fish" size={20} class="text-purple-500" />
                {m.am_scam_title()}
              </h3>
              <ToggleSwitch checked={raidConfig.scamFilterEnabled} onToggle={(v: boolean) => raidConfig.scamFilterEnabled = v} disabled={!canManageSettings} />
            </div>
            <div class="space-y-3">
              <div class="p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-medium text-on-surface">{m.am_scam_images_block()}</p>
                  <p class="text-[11px] text-on-surface-variant/60">{m.am_scam_images_desc({ count: scamImageCount })}</p>
                </div>
                <ToggleSwitch checked={raidConfig.scamImageFilterEnabled} onToggle={(v: boolean) => raidConfig.scamImageFilterEnabled = v} disabled={!canManageSettings} />
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-1.5">
                  <label for="scamAction" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_action_label()}</label>
                  <select id="scamAction" bind:value={raidConfig.scamFilterAction} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings}>
                    <option value="DELETE">{m.am_scam_action_delete()}</option>
                    <option value="DELETE_AND_WARN">{m.am_scam_action_delete_warn()}</option>
                    <option value="DELETE_AND_TIMEOUT">{m.am_scam_action_delete_timeout()}</option>
                    <option value="DELETE_AND_BAN">{m.am_scam_action_delete_ban()}</option>
                  </select>
                </div>
                <div class="space-y-1.5">
                  <label for="scamAlert" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_alerts_channel()}</label>
                  <SearchableSelect id="scamAlert" bind:value={raidConfig.scamFilterAlertChannelId} options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.am_optional()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
                </div>
                <div class="space-y-1.5">
                  <label for="scamDomains" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_scam_domains()}</label>
                  <textarea id="scamDomains" rows="3" bind:value={raidCustomDomainsText} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" placeholder="evil-site.com" disabled={!canManageSettings}></textarea>
                </div>
                <div class="space-y-1.5">
                  <label for="scamWhitelist" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_scam_whitelist()}</label>
                  <textarea id="scamWhitelist" rows="3" bind:value={raidWhitelistText} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" placeholder="mon-site.fr" disabled={!canManageSettings}></textarea>
                </div>
              </div>
              <button type="button" class="w-full py-2.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 rounded-lg text-[13px] font-medium transition-all" onclick={loadScamImages}>
                {showScamImages ? m.am_scam_db_hide({ count: scamImageCount }) : m.am_scam_db_show({ count: scamImageCount })}
              </button>
              {#if showScamImages}
                <div class="space-y-2 max-h-64 overflow-y-auto">
                  {#each scamImages as image (image.id)}
                    <div class="p-3 rounded-lg bg-surface-container-high/30 border border-outline-variant/10 flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <p class="text-xs font-mono text-on-surface truncate">{image.hash.slice(0, 24)}…</p>
                        <p class="text-[11px] text-on-surface-variant/60">{image.filename ?? m.am_scam_no_name()} · {image.source}{image.guildId ? '' : ' · 🌐 global'}</p>
                      </div>
                      {#if image.guildId}
                        <button type="button" class="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 rounded-lg text-xs font-medium shrink-0" onclick={() => handleDeleteScamImage(image.id)} disabled={!canManageSettings}>{m.common_delete()}</button>
                      {/if}
                    </div>
                  {:else}
                    <p class="text-xs text-on-surface-variant/50 text-center py-3">{m.am_scam_empty()}</p>
                  {/each}
                </div>
              {/if}
            </div>
          </section>

          <!-- Signalements -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <div class="flex items-center justify-between border-b border-outline-variant/15 pb-4">
              <h3 class="text-lg font-semibold flex items-center gap-3">
                <Papicon icon="Flag" size={20} class="text-amber-500" />
                {m.am_reports_title({ pending: reportStats.pending, resolved: reportStats.resolved })}
              </h3>
              <ToggleSwitch checked={raidConfig.reportsEnabled} onToggle={(v: boolean) => raidConfig.reportsEnabled = v} disabled={!canManageSettings} />
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="space-y-1.5 md:col-span-2">
                <label for="reportsChannel" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_reports_channel()}</label>
                <SearchableSelect id="reportsChannel" bind:value={raidConfig.reportsChannelId} options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.am_choose_channel()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
              </div>
              <div class="space-y-1.5">
                <label for="reportsCooldown" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_reports_cooldown()}</label>
                <input id="reportsCooldown" type="number" min="0" max="3600" bind:value={raidConfig.reportsCooldownSec} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings} />
              </div>
              <div class="p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 flex items-center justify-between gap-3">
                <p class="text-sm font-medium text-on-surface">{m.am_reports_anonymous()}</p>
                <ToggleSwitch checked={raidConfig.reportsAnonymous} onToggle={(v: boolean) => raidConfig.reportsAnonymous = v} disabled={!canManageSettings} />
              </div>
            </div>
            {#if pendingReports.length > 0}
              <div class="space-y-2 pt-2 border-t border-outline-variant/15 max-h-72 overflow-y-auto">
                {#each pendingReports as report (report.id)}
                  <div class="p-3 rounded-lg bg-surface-container-high/30 border border-outline-variant/10 space-y-2">
                    <div class="flex items-center justify-between gap-3">
                      <p class="text-sm text-on-surface">{m.am_report_target()} <span class="font-mono">{report.targetId}</span></p>
                      <div class="flex gap-2 shrink-0">
                        <button type="button" class="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 rounded-lg text-xs font-medium" onclick={() => handleReportDecision(report.id, true)} disabled={!canManageSettings}>{m.am_report_resolve()}</button>
                        <button type="button" class="px-3 py-1.5 bg-surface-container-highest hover:bg-surface-container-high text-on-surface-variant rounded-lg text-xs font-medium" onclick={() => handleReportDecision(report.id, false)} disabled={!canManageSettings}>{m.am_reject()}</button>
                      </div>
                    </div>
                    <p class="text-xs text-on-surface-variant/70">{report.reason}</p>
                  </div>
                {/each}
              </div>
            {/if}
          </section>

          <!-- Join lock — options -->
          <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
            <h3 class="text-lg font-semibold flex items-center gap-3 border-b border-outline-variant/15 pb-4">
              <Papicon icon="Lock" size={20} class="text-slate-400" />
              {m.am_joinlock_options_title()}
            </h3>
            <div class="p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-medium text-on-surface">{m.am_joinlock_kick()}</p>
                <p class="text-[11px] text-on-surface-variant/60">{m.am_joinlock_kick_desc()}</p>
              </div>
              <ToggleSwitch checked={raidConfig.joinLockKick} onToggle={(v: boolean) => raidConfig.joinLockKick = v} disabled={!canManageSettings} />
            </div>
            <div class="space-y-1.5">
              <label for="joinLockMessage" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_joinlock_message()}</label>
              <textarea id="joinLockMessage" rows="2" bind:value={raidConfig.joinLockMessage} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm" disabled={!canManageSettings}></textarea>
            </div>
          </section>
        </div>
      </div>

    {:else if activeTab === 'exceptions'}
      <div class="animate-in fade-in duration-300">
        <!-- Exempt rules (Bypass) -->
        <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
          <h3 class="text-xl font-semibold flex items-center gap-3 border-b border-outline-variant/15 pb-4">
            <Papicon icon="Unlock" size={20} class="text-emerald-400" />
            {m.am_exceptions_title()}
          </h3>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <!-- Ignored roles -->
            <div class="space-y-3">
              <span class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_exempt_roles()}</span>
              {#if canManageSettings}
                <div class="flex gap-2">
                  <div class="flex-1">
                    <SearchableSelect 
                      id="bypassRoleSelect"
                      bind:value={selectedBypassRole} 
                      options={availableRoles.map(r => ({ id: r.id, name: `@${r.name}` }))} 
                      placeholder={m.am_add_role_placeholder()} 
                      className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                  </div>
                  <button 
                    type="button"
                    onclick={addBypassRole}
                    disabled={!selectedBypassRole}
                    class="px-4 py-2.5 bg-outline-variant/20 hover:bg-outline-variant/35 text-xs font-bold rounded-xl transition-all disabled:opacity-50"
                  >
                    {m.common_add()}
                  </button>
                </div>
              {/if}

              <div class="flex flex-wrap gap-2">
                {#each config.bypassRoles as roleId}
                  <div class="flex items-center gap-1.5 px-3 py-1 bg-surface-container-high/40 border border-outline-variant/10 rounded-xl text-xs font-bold">
                    <span>{getRoleName(roleId)}</span>
                    {#if canManageSettings}
                      <button type="button" onclick={() => removeBypassRole(roleId)} class="text-error hover:text-error/80 transition-colors ml-1 text-sm font-bold leading-none">×</button>
                    {/if}
                  </div>
                {:else}
                  <span class="text-xs text-on-surface-variant/40 italic ml-2">{m.am_no_exempt_role()}</span>
                {/each}
              </div>
            </div>

            <!-- Ignored channels -->
            <div class="space-y-3 lg:border-l lg:border-outline-variant/10 lg:pl-8">
              <span class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.am_exempt_channels()}</span>
              {#if canManageSettings}
                <div class="flex gap-2">
                  <div class="flex-1">
                    <SearchableSelect 
                      id="bypassChanSelect"
                      bind:value={selectedBypassChannel} 
                      options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} 
                      placeholder={m.am_add_channel_placeholder()} 
                      className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                  </div>
                  <button 
                    type="button"
                    onclick={addBypassChannel}
                    disabled={!selectedBypassChannel}
                    class="px-4 py-2.5 bg-outline-variant/20 hover:bg-outline-variant/35 text-xs font-bold rounded-xl transition-all disabled:opacity-50"
                  >
                    {m.common_add()}
                  </button>
                </div>
              {/if}

              <div class="flex flex-wrap gap-2">
                {#each config.bypassChannels as channelId}
                  <div class="flex items-center gap-1.5 px-3 py-1 bg-surface-container-high/40 border border-outline-variant/10 rounded-xl text-xs font-bold">
                    <span>{getChannelName(channelId)}</span>
                    {#if canManageSettings}
                      <button type="button" onclick={() => removeBypassChannel(channelId)} class="text-error hover:text-error/80 transition-colors ml-1 text-sm font-bold leading-none">×</button>
                    {/if}
                  </div>
                {:else}
                  <span class="text-xs text-on-surface-variant/40 italic ml-2">{m.am_no_exempt_channel()}</span>
                {/each}
              </div>
            </div>
          </div>
        </section>
      </div>
    {/if}
  {/if}
</ModulePage>
