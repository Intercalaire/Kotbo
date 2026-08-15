<script lang="ts">
  import { m } from '../lib/i18n';
  import { channelDisplayName } from '../lib/channelUtils';
  import { onMount, onDestroy, untrack } from 'svelte';
  import { unsavedChanges } from '../lib/stores/unsavedChanges.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';
  import SearchableSelect from '../lib/components/SearchableSelect.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import { updateGlobalSettings } from '../lib/api';
  import { historyStore } from '../lib/stores/history.svelte';

  const saveAction = createAsyncActionState();
  let loading = $state(false);
  const canManageSettings = $derived(
    !!dashboardStore.state.featureAccess?.settings?.canConfigure
      || !!dashboardStore.state.access?.canManageSettings
  );

  const availableChannels = $derived(dashboardStore.state.discordChannels || []);
  const availableVoiceChannels = $derived(dashboardStore.state.discordVoiceChannels || []);
  const availableRoles = $derived(dashboardStore.state.discordRoles || []);

  let guildSettings = $state<Record<string, any>>({
    configChannelId: '',
    publicChannelId: '',
    newsChannelId: '',
    dailyAlgoChannelId: '',
    meetingVoiceChannelId: '',
    baseStaffRoleId: '',
    testStaffRoleId: '',
    translationEnabled: false,
    codePoliceEnabled: false,
    dailyAlgoEnabled: false,
    githubReleasesEnabled: false,
    logChannelId: '',
    propagateSanctions: false,
    crossServerSanctionsEnabled: true,
    analyticsEnabled: true,
  });

  let savedSettings = $state<Record<string, any>>({
    configChannelId: '',
    publicChannelId: '',
    newsChannelId: '',
    dailyAlgoChannelId: '',
    meetingVoiceChannelId: '',
    baseStaffRoleId: '',
    testStaffRoleId: '',
    translationEnabled: false,
    codePoliceEnabled: false,
    dailyAlgoEnabled: false,
    githubReleasesEnabled: false,
    logChannelId: '',
    propagateSanctions: false,
    crossServerSanctionsEnabled: true,
    analyticsEnabled: true,
  });

  $effect(() => {
    const current = JSON.stringify(guildSettings);
    const saved = JSON.stringify(savedSettings);
    const dirty = current !== saved;

    if (dirty && canManageSettings) {
      untrack(() => {
        unsavedChanges.register({
          id: 'general-settings',
          label: m.general_settings_unsaved_label(),
          onSave: () => handleSave(),
          onReset: () => {
            guildSettings = { ...savedSettings };
          }
        });
      });
    } else if (!dirty) {
      untrack(() => {
        unsavedChanges.release('general-settings');
      });
    }
  });

  onDestroy(() => {
    unsavedChanges.release('general-settings');
  });

  onMount(async () => {
    loading = true;
    try {
      await dashboardStore.refresh();
      const s = dashboardStore.state as any;
      const loaded = {
        configChannelId: s.configChannelId || '',
        publicChannelId: s.publicChannelId || '',
        newsChannelId: s.newsChannelId || '',
        dailyAlgoChannelId: s.dailyAlgoChannelId || '',
        meetingVoiceChannelId: s.meetingVoiceChannelId || '',
        baseStaffRoleId: s.baseStaffRoleId || '',
        testStaffRoleId: s.testStaffRoleId || '',
        translationEnabled: s.translationEnabled || false,
        codePoliceEnabled: s.codePoliceEnabled || false,
        dailyAlgoEnabled: s.dailyAlgoEnabled || false,
        githubReleasesEnabled: s.githubReleasesEnabled || false,
        logChannelId: s.logChannelId || '',
        propagateSanctions: s.propagateSanctions || false,
        crossServerSanctionsEnabled: s.crossServerSanctionsEnabled ?? true,
        analyticsEnabled: s.analyticsEnabled ?? true,
      };
      guildSettings = loaded;
      savedSettings = { ...loaded };
    } finally {
      loading = false;
    }
  });

  async function handleSave(): Promise<boolean> {
    if (!canManageSettings) {
      saveAction.setError(m.general_settings_access_denied());
      return false;
    }
    let success = false;
    await saveAction.run(async () => {
      const ok = await updateGlobalSettings(guildSettings);
      if (!ok) throw new Error(m.general_settings_api_error());

      await dashboardStore.refresh();
      savedSettings = { ...guildSettings };
      success = true;
      return true;
    }, { successMessage: m.general_settings_saved_toast() });
    return success;
  }

  const channelFields = [
    { key: 'meetingVoiceChannelId', label: m.general_settings_ch_meeting_voice_label(), desc: m.general_settings_ch_meeting_voice_desc(), isVoice: true },
    { key: 'dailyAlgoChannelId', label: m.general_settings_ch_daily_algo_label(), desc: m.general_settings_ch_daily_algo_desc() },
    { key: 'publicChannelId', label: m.general_settings_ch_public_label(), desc: m.general_settings_ch_public_desc() },
    { key: 'newsChannelId', label: m.general_settings_ch_news_label(), desc: m.general_settings_ch_news_desc() },
    { key: 'configChannelId', label: m.general_settings_ch_config_label(), desc: m.general_settings_ch_config_desc() },
    { key: 'logChannelId', label: m.general_settings_ch_logs_label(), desc: m.general_settings_ch_logs_desc() },
  ];

  const roleFields = [
    { key: 'baseStaffRoleId', label: m.general_settings_role_base_label(), desc: m.general_settings_role_base_desc() },
    { key: 'testStaffRoleId', label: m.general_settings_role_test_label(), desc: m.general_settings_role_test_desc() },
  ];

  const toggleFields = [
    { key: 'translationEnabled', label: m.general_settings_toggle_translation_label(), desc: m.general_settings_toggle_translation_desc() },
    { key: 'codePoliceEnabled', label: m.general_settings_toggle_code_police_label(), desc: m.general_settings_toggle_code_police_desc() },
    { key: 'dailyAlgoEnabled', label: m.general_settings_toggle_daily_algo_label(), desc: m.general_settings_toggle_daily_algo_desc() },
    { key: 'githubReleasesEnabled', label: m.general_settings_toggle_github_label(), desc: m.general_settings_toggle_github_desc() },
    { key: 'propagateSanctions', label: m.general_settings_toggle_propagate_label(), desc: m.general_settings_toggle_propagate_desc() },
    { key: 'crossServerSanctionsEnabled', label: m.general_settings_toggle_cross_server_label(), desc: m.general_settings_toggle_cross_server_desc() },
    { key: 'analyticsEnabled', label: m.general_settings_toggle_analytics_label(), desc: m.general_settings_toggle_analytics_desc() },
  ];
</script>

<ModulePage
  title={m.general_settings_page_title()}
  description={m.general_settings_page_desc()}
  icon="settings"
  featureKey="settings"
>
  <InlineFeedback state={saveAction} />

  {#if loading}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {#each Array(2) as _}
        <div class="p-8 rounded-xl bg-surface-container-low/30 border border-outline-variant/10 space-y-6">
          <Skeleton width="40%" height="24px" />
          <div class="space-y-4">
            {#each Array(4) as _}
              <div class="space-y-2">
                <Skeleton width="20%" height="12px" />
                <Skeleton width="100%" height="48px" radius="16px" />
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    <div class="flex justify-center mt-4">
      <LoadingHint context="config" />
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <!-- Discord Configuration -->
      <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-8">
        <div class="space-y-6">
          <h3 class="text-xl font-semibold flex items-center gap-3">
            <Papicon icon="Hash" size={20} class="text-primary" />
            {m.general_settings_section_channels()}
          </h3>
          <div class="space-y-4">
            {#each channelFields as field}
              <div class="space-y-1.5">
                <label for={field.key} class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{field.label}</label>
                {#if field.isVoice}
                  <SearchableSelect id={field.key} bind:value={guildSettings[field.key]} options={availableVoiceChannels.map(c => ({ id: c.id, name: `🔊 ${c.name}` }))} placeholder={m.general_settings_none_placeholder()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all" />
                {:else}
                  <SearchableSelect id={field.key} bind:value={guildSettings[field.key]} options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.general_settings_none_placeholder()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all" />
                {/if}
                <p class="text-[11px] text-on-surface-variant/40 ml-2">{field.desc}</p>
              </div>
            {/each}
          </div>
        </div>
      </section>

      <div class="space-y-8">
        <!-- Roles Configuration -->
        <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-8">
          <h3 class="text-xl font-semibold flex items-center gap-3">
            <Papicon icon="Shield" size={20} class="text-secondary" />
            {m.general_settings_section_roles()}
          </h3>
          <div class="space-y-4">
            {#each roleFields as field}
              <div class="space-y-1.5">
                <label for={field.key} class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{field.label}</label>
                <SearchableSelect id={field.key} bind:value={guildSettings[field.key]} options={availableRoles.map(r => ({ id: r.id, name: `@${r.name}` }))} placeholder={m.general_settings_none_placeholder()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all" />
                <p class="text-[11px] text-on-surface-variant/40 ml-2">{field.desc}</p>
              </div>
            {/each}
          </div>
        </section>

        <!-- Integrations Toggles -->
        <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-8">
          <h3 class="text-xl font-semibold flex items-center gap-3">
            <Papicon icon="Link" size={20} class="text-tertiary" />
            {m.general_settings_section_integrations()}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {#each toggleFields as toggle}
              <div class="flex items-center justify-between p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 hover:bg-surface-container-high/40 transition-colors">
                <div>
                  <p class="text-sm font-bold">{toggle.label}</p>
                  <p class="text-[10px] text-on-surface-variant/50">{toggle.desc}</p>
                </div>
                <ToggleSwitch checked={guildSettings[toggle.key]} onToggle={(v: boolean) => {
                  const previousValue = guildSettings[toggle.key];
                  const key = toggle.key;
                  guildSettings[key] = v;
                  guildSettings = {...guildSettings};
                  historyStore.push({
                    label: m.general_settings_history_toggle({ label: toggle.label }),
                    undo: () => {
                      guildSettings[key] = previousValue;
                      guildSettings = {...guildSettings};
                    },
                    redo: () => {
                      guildSettings[key] = v;
                      guildSettings = {...guildSettings};
                    }
                  });
                }} />
              </div>
            {/each}
          </div>

          {#if !guildSettings.analyticsEnabled}
            <div class="flex gap-3 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <Papicon icon="Shield" size={18} class="text-emerald-500 shrink-0 mt-0.5" />
              <div class="space-y-1">
                <p class="text-sm font-bold text-emerald-600 dark:text-emerald-400">{m.general_settings_analytics_off_title()}</p>
                <p class="text-[11px] text-on-surface-variant/60 leading-relaxed">{m.general_settings_analytics_off_desc()}</p>
              </div>
            </div>
          {/if}
        </section>
      </div>
    </div>
  {/if}
</ModulePage>

