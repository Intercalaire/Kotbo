<script lang="ts">
  import { channelDisplayName } from '../../channelUtils';
  import Papicon from '../Papicon.svelte';
  import SearchableSelect from '../SearchableSelect.svelte';
  import ToggleSwitch from '../ToggleSwitch.svelte';
  import { m } from '../../i18n';

  let {
    features = $bindable([]),
    guildSettings = $bindable({} as any),
    availableChannels = [],
    availableVoiceChannels = [],
    availableRoles = [],
    onSaveGlobal = () => {},
    onSaveFeature = (_key: string) => {},
  }: {
    features?: any[];
    guildSettings?: any;
    availableChannels?: any[];
    availableVoiceChannels?: any[];
    availableRoles?: any[];
    onSaveGlobal?: (event: MouseEvent) => void | Promise<void>;
    onSaveFeature?: (key: string) => void | Promise<void>;
  } = $props();

  const globalChannelFields = $derived([
    { key: 'logChannelId', label: m.mcr_field_log_label(), desc: m.mcr_field_log_desc() },
    { key: 'regulationChannelId', label: m.mcr_field_regulation_label(), desc: m.mcr_field_regulation_desc() },
    { key: 'meetingAnnouncementChannelId', label: m.mcr_field_meeting_announce_label(), desc: m.mcr_field_meeting_announce_desc() },
    { key: 'meetingVoiceChannelId', label: m.mcr_field_meeting_voice_label(), desc: m.mcr_field_meeting_voice_desc(), isVoice: true },
    { key: 'digestChannelId', label: m.mcr_field_digest_label(), desc: m.mcr_field_digest_desc() },
    { key: 'publicChannelId', label: m.mcr_field_public_label(), desc: m.mcr_field_public_desc() },
    { key: 'configChannelId', label: m.mcr_field_config_label(), desc: m.mcr_field_config_desc() },
    { key: 'newsChannelId', label: m.mcr_field_news_label(), desc: m.mcr_field_news_desc() },
    { key: 'dailyAlgoChannelId', label: m.mcr_field_daily_algo_label(), desc: m.mcr_field_daily_algo_desc() },
  ]);

  const globalRoleFields = $derived([
    { key: 'moderatorRoleId', label: m.mcr_role_moderator_label(), desc: m.mcr_role_moderator_desc() },
    { key: 'baseStaffRoleId', label: m.mcr_role_base_staff_label(), desc: m.mcr_role_base_staff_desc() },
    { key: 'testStaffRoleId', label: m.mcr_role_test_staff_label(), desc: m.mcr_role_test_staff_desc() },
  ]);

  const integrationToggles = $derived([
    { key: 'youtubeEnabled', label: m.mcr_toggle_youtube_label(), desc: m.mcr_toggle_youtube_desc() },
    { key: 'digestEnabled', label: m.mcr_toggle_digest_label(), desc: m.mcr_toggle_digest_desc() },
    { key: 'translationEnabled', label: m.mcr_toggle_translation_label(), desc: m.mcr_toggle_translation_desc() },
    { key: 'codePoliceEnabled', label: m.mcr_toggle_codepolice_label(), desc: m.mcr_toggle_codepolice_desc() },
    { key: 'dailyAlgoEnabled', label: m.mcr_toggle_dailyalgo_label(), desc: m.mcr_toggle_dailyalgo_desc() },
    { key: 'githubReleasesEnabled', label: m.mcr_toggle_github_label(), desc: m.mcr_toggle_github_desc() },
    { key: 'crossServerSanctionsEnabled', label: m.mcr_toggle_cross_server_label(), desc: m.mcr_toggle_cross_server_desc() },
    { key: 'analyticsEnabled', label: m.mcr_toggle_analytics_label(), desc: m.mcr_toggle_analytics_desc() },
  ]);
</script>

<div class="space-y-8 animate-in fade-in duration-500">
  <!-- Global settings -->
  <div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-8">
    <div class="flex justify-between items-center">
      <div>
        <h3 class="text-xl font-semibold">{m.mcr_global_settings_title()}</h3>
        <p class="text-xs text-on-surface-variant/50 mt-1">{m.mcr_global_settings_desc()}</p>
      </div>
      <button onclick={onSaveGlobal} class="px-7 py-3 bg-primary text-on-primary font-semibold uppercase tracking-widest text-[10px] rounded-lg transition-transform">
        {m.mcr_save_global()}
      </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-10">
      <!-- Global channels -->
      <div class="space-y-5">
        <h4 class="text-xs font-medium text-primary flex items-center gap-2"><Papicon icon="Hash" size={14} /> {m.mcr_discord_channels()}</h4>
        <div class="space-y-4">
          {#each globalChannelFields as field}
            <div class="space-y-1.5">
              <label for="channel-{field.key}" class="text-[10px] font-bold text-on-surface-variant/60 ml-2">{field.label}</label>
              {#if field.isVoice}
                <SearchableSelect id="channel-{field.key}" bind:value={guildSettings[field.key]} options={availableVoiceChannels.map(c => ({ id: c.id, name: `🔊 ${c.name}` }))} placeholder={m.mcr_none_placeholder()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all" />
              {:else}
                <SearchableSelect id="channel-{field.key}" bind:value={guildSettings[field.key]} options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.mcr_none_placeholder()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all" />
              {/if}
              <p class="text-[11px] text-on-surface-variant/40 ml-2">{field.desc}</p>
            </div>
          {/each}
        </div>
      </div>

      <!-- Global roles -->
      <div class="space-y-5">
        <h4 class="text-xs font-medium text-secondary flex items-center gap-2"><Papicon icon="Shield" size={14} /> {m.mcr_discord_roles()}</h4>
        <div class="space-y-4">
          {#each globalRoleFields as field}
            <div class="space-y-1.5">
              <label for="role-{field.key}" class="text-[10px] font-bold text-on-surface-variant/60 ml-2">{field.label}</label>
              <SearchableSelect id="role-{field.key}" bind:value={guildSettings[field.key]} options={availableRoles.map(r => ({ id: r.id, name: `@${r.name}` }))} placeholder={m.mcr_none_placeholder()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all" />
              <p class="text-[11px] text-on-surface-variant/40 ml-2">{field.desc}</p>
            </div>
          {/each}
        </div>

        <!-- Global toggles -->
        <div class="mt-6 space-y-4">
          <h4 class="text-xs font-medium text-tertiary flex items-center gap-2"><Papicon icon="ToggleRight" size={14} /> {m.mcr_integrations()}</h4>
          <div class="bg-surface-container-high/20 rounded-xl border border-outline-variant/5 p-5 space-y-3">
            {#each integrationToggles as toggle}
              <div class="flex items-center justify-between py-1">
                <div><p class="text-sm font-bold">{toggle.label}</p><p class="text-[10px] text-on-surface-variant/50">{toggle.desc}</p></div>
                <ToggleSwitch checked={guildSettings[toggle.key]} onToggle={(v) => { guildSettings[toggle.key] = v; guildSettings = {...guildSettings}; }} />
              </div>
            {/each}
          </div>

          {#if !guildSettings.analyticsEnabled}
            <div class="flex gap-3 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <Papicon icon="Shield" size={18} class="text-emerald-500 shrink-0 mt-0.5" />
              <div class="space-y-1">
                <p class="text-sm font-bold text-emerald-600 dark:text-emerald-400">{m.mcr_analytics_off_title()}</p>
                <p class="text-[11px] text-on-surface-variant/60 leading-relaxed">{m.mcr_analytics_off_desc()}</p>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Channels & roles per feature -->
  <div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
    <h3 class="text-xl font-semibold">{m.mcr_per_feature_title()}</h3>
    <p class="text-xs text-on-surface-variant/50">{m.mcr_per_feature_desc()}</p>

    <div class="overflow-hidden rounded-xl border border-outline-variant/5">
      <table class="w-full text-left border-collapse">
        <thead class="bg-surface-container-high/40 text-xs font-medium text-on-surface-variant/60">
          <tr>
            <th class="px-5 py-4">{m.mcr_col_module()}</th>
            <th class="px-5 py-4">{m.mcr_col_main_channel()}</th>
            <th class="px-5 py-4">{m.mcr_col_required_role()}</th>
            <th class="px-5 py-4">{m.mcr_col_notif_role()}</th>
            <th class="px-5 py-4 text-center">{m.mcr_col_action()}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-outline-variant/5">
          {#each features as feature, idx}
            <tr class="hover:bg-surface-container-high/20 transition-colors">
              <td class="px-5 py-4"><span class="text-sm font-bold">{feature.featureName}</span></td>
              <td class="px-5 py-4">
                <SearchableSelect bind:value={features[idx].channelId} options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.mcr_none_placeholder()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-xl px-3 py-2 text-xs" />
              </td>
              <td class="px-5 py-4">
                <SearchableSelect bind:value={features[idx].requiredRoleId} options={availableRoles.map(r => ({ id: r.id, name: `@${r.name}` }))} placeholder={m.mcr_none_placeholder()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-xl px-3 py-2 text-xs" />
              </td>
              <td class="px-5 py-4">
                <SearchableSelect bind:value={features[idx].notificationRoleId} options={availableRoles.map(r => ({ id: r.id, name: `@${r.name}` }))} placeholder={m.mcr_none_placeholder()} className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-xl px-3 py-2 text-xs" />
              </td>
              <td class="px-5 py-4 text-center">
                <button onclick={() => onSaveFeature(feature.featureKey)} class="px-4 py-1.5 bg-on-surface text-surface text-[11px] font-semibold uppercase tracking-widest rounded-lg transition-transform">
                  {m.mcr_save_short()}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
