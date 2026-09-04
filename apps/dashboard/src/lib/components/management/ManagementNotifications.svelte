<script lang="ts">
  import { channelDisplayName } from '../../channelUtils';
  import Papicon from '../Papicon.svelte';
  import ToggleSwitch from '../ToggleSwitch.svelte';
  import SearchableSelect from '../SearchableSelect.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import SettingsRow from './SettingsRow.svelte';
  import { categoryIcons, categoryLabel, groupByCategory } from './ManagementAccess.svelte';
  import { m } from '../../i18n';

  let {
    features = $bindable([]),
    availableChannels = [],
    availableRoles = [],
  }: {
    features?: any[];
    availableChannels?: any[];
    availableRoles?: any[];
  } = $props();

  const channelOptions = $derived(availableChannels.map((c) => ({ id: c.id, name: channelDisplayName(c) })));
  const roleOptions = $derived(availableRoles.map((r) => ({ id: r.id, name: `@${r.name}` })));

  const groupedFeatures = $derived(groupByCategory(features));

  const notificationMethods = $derived([
    { key: 'notifyViaDiscordChannel', label: m.mn_method_channel_label(), desc: m.mn_method_channel_desc(), icon: 'Hash' },
    { key: 'notifyViaDM', label: m.mn_method_dm_label(), desc: m.mn_method_dm_desc(), icon: 'Mail' },
  ]);

  let expandedFeature = $state<string | null>(null);
  let query = $state('');

  const matches = (feature: any) =>
    !query || feature.featureName?.toLowerCase().includes(query.toLowerCase())
      || feature.featureKey?.toLowerCase().includes(query.toLowerCase());

  const selectClass = 'w-full md:w-72';
  const inputClass = 'w-full md:w-72 bg-surface-container-high text-on-surface text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 outline-none focus:ring-2 focus:ring-primary/30 transition-all';

  function setMethod(idx: number, key: string, value: boolean) {
    features[idx][key] = value;
    features = [...features];
  }
</script>

<SettingsGroup title={m.mn_title()} description={m.mn_desc()}>
  {#snippet actions()}
    <label class="relative">
      <span class="sr-only">{m.ma_search_placeholder()}</span>
      <Papicon icon="MagnifyingGlass" size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
      <input
        type="text"
        bind:value={query}
        placeholder={m.ma_search_placeholder()}
        class="bg-surface-container-high/40 border border-outline-variant/10 rounded-lg pl-9 pr-4 py-2 text-xs w-56 focus:ring-2 focus:ring-primary/30 transition-all outline-none"
      />
    </label>
  {/snippet}

  <div class="space-y-4">
    {#each groupedFeatures as group}
      {@const items = group.items.filter(({ feature }) => matches(feature))}
      {#if items.length > 0}
        <section class="space-y-1">
          <p class="flex items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/50">
            <Papicon icon={categoryIcons[group.category] || 'Grid'} size={12} />
            {categoryLabel(group.category)}
          </p>

          <div class="rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/10 overflow-hidden bg-surface-container-high/10">
            {#each items as { feature, idx } (feature.featureKey)}
              {@const expanded = expandedFeature === feature.featureKey}
              <div>
                <button
                  type="button"
                  class="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-container-high/30 transition-colors text-left"
                  onclick={() => (expandedFeature = expanded ? null : feature.featureKey)}
                >
                  <span class="flex items-center gap-3 min-w-0">
                    <span class="text-sm font-medium truncate">{feature.featureName}</span>
                    <span class="flex gap-1 shrink-0">
                      {#if feature.notifyViaDiscordChannel}
                        <span class="px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-400 text-[10px] font-bold">{m.mn_badge_channel()}</span>
                      {/if}
                      {#if feature.notifyViaDM}
                        <span class="px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-400 text-[10px] font-bold">{m.mn_badge_dm()}</span>
                      {/if}
                    </span>
                  </span>
                  <span class="transition-transform shrink-0 {expanded ? 'rotate-180' : ''}">
                    <Papicon icon="CaretDown" size={14} />
                  </span>
                </button>

                {#if expanded}
                  <div class="divide-y divide-outline-variant/5 border-t border-outline-variant/10">
                    {#each notificationMethods as method}
                      <SettingsRow label={method.label} description={method.desc}>
                        <ToggleSwitch
                          checked={features[idx][method.key]}
                          ariaLabel="{feature.featureName} - {method.label}"
                          onToggle={(value) => setMethod(idx, method.key, value)}
                        />
                      </SettingsRow>
                    {/each}

                    <SettingsRow label={m.mn_alert_channel_label()} labelFor="notify-channel-{feature.featureKey}">
                      <SearchableSelect
                        id="notify-channel-{feature.featureKey}"
                        bind:value={features[idx].channelId}
                        options={channelOptions}
                        placeholder={m.mn_default_channel_placeholder()}
                        className={selectClass}
                      />
                    </SettingsRow>

                    <SettingsRow label={m.mn_mention_role_label()} labelFor="notify-role-{feature.featureKey}">
                      <SearchableSelect
                        id="notify-role-{feature.featureKey}"
                        bind:value={features[idx].notificationRoleId}
                        options={roleOptions}
                        placeholder={m.mn_no_mention_placeholder()}
                        className={selectClass}
                      />
                    </SettingsRow>

                    <SettingsRow label={m.mn_webhook_url_label()} labelFor="notify-webhook-{feature.featureKey}">
                      <input
                        id="notify-webhook-{feature.featureKey}"
                        type="url"
                        placeholder="https://discord.com/api/webhooks/..."
                        bind:value={features[idx].metadata.webhookUrl}
                        class={inputClass}
                      />
                    </SettingsRow>

                    {#if feature.featureKey === 'absences'}
                      <p class="px-4 py-3 text-[11px] leading-relaxed text-amber-300/80 bg-amber-500/5">
                        {m.mn_absences_note()}
                      </p>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  </div>
</SettingsGroup>
