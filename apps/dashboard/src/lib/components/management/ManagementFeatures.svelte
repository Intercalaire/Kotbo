<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import ToggleSwitch from '../ToggleSwitch.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import SettingsRow from './SettingsRow.svelte';
  import { categoryIcons, categoryLabel, groupByCategory } from './ManagementAccess.svelte';
  import { m } from '../../i18n';

  let {
    features = $bindable([]),
    modules = new Map<string, any>(),
    onToggleModule = (_key: string, _enabled: boolean) => {},
  }: {
    features?: any[];
    modules?: Map<string, any>;
    onToggleModule?: (key: string, enabled: boolean) => void | Promise<void>;
  } = $props();

  const groupedFeatures = $derived(groupByCategory(features));

  let expandedFeature = $state<string | null>(null);
  let query = $state('');

  const matches = (feature: any) =>
    !query || feature.featureName?.toLowerCase().includes(query.toLowerCase())
      || feature.featureKey?.toLowerCase().includes(query.toLowerCase());

  function set(idx: number, key: 'loggingEnabled' | 'userActivityTracking', value: boolean) {
    features[idx][key] = value;
    features = [...features];
  }
</script>

<SettingsGroup title={m.mf_title()} description={m.mf_desc()}>
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
            <span class="font-medium tracking-normal text-on-surface-variant/40 normal-case">
              {items.filter(({ feature }) => feature.enabled).length}/{items.length} {m.ma_word_active()}{items.filter(({ feature }) => feature.enabled).length > 1 ? 's' : ''}
            </span>
          </p>

          <div class="rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/10 overflow-hidden bg-surface-container-high/10">
            {#each items as { feature, idx } (feature.featureKey)}
              {@const expanded = expandedFeature === feature.featureKey}
              {@const registryModule = modules.get(feature.featureKey)}
              <div>
                <div class="flex items-center justify-between gap-3 px-4 py-3">
                  <button
                    type="button"
                    class="flex items-center gap-3 min-w-0 text-left"
                    onclick={() => (expandedFeature = expanded ? null : feature.featureKey)}
                  >
                    <span class="transition-transform shrink-0 {expanded ? 'rotate-180' : ''}">
                      <Papicon icon="CaretDown" size={14} />
                    </span>
                    <span class="min-w-0">
                      <span class="block text-sm font-medium truncate">{feature.featureName}</span>
                      <span class="block text-[10px] text-on-surface-variant/40">{feature.featureKey}</span>
                    </span>
                  </button>
                  {#if registryModule?.lockedByPlan}
                    <a href="/billing" class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold shrink-0">
                      <Papicon icon="Lock" size={12} />
                      {m.mgmt_module_locked()}
                    </a>
                  {:else}
                    <ToggleSwitch
                      checked={feature.enabled}
                      disabled={registryModule?.isFixed}
                      ariaLabel={feature.featureName}
                      onToggle={(value) => onToggleModule(feature.featureKey, value)}
                    />
                  {/if}
                </div>

                {#if expanded}
                  <div class="divide-y divide-outline-variant/5 border-t border-outline-variant/10">
                    <SettingsRow label={m.mf_col_logs()} description={m.mf_logs_desc()}>
                      <ToggleSwitch
                        checked={features[idx].loggingEnabled}
                        ariaLabel="{feature.featureName} - {m.mf_col_logs()}"
                        onToggle={(value) => set(idx, 'loggingEnabled', value)}
                      />
                    </SettingsRow>
                    <SettingsRow label={m.mf_col_tracking()} description={m.mf_tracking_desc()}>
                      <ToggleSwitch
                        checked={features[idx].userActivityTracking}
                        ariaLabel="{feature.featureName} - {m.mf_col_tracking()}"
                        onToggle={(value) => set(idx, 'userActivityTracking', value)}
                      />
                    </SettingsRow>
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
