<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import ToggleSwitch from '../ToggleSwitch.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import { categoryIcons, categoryLabel, groupModulesByCategory } from './ManagementAccess.svelte';
  import { m } from '../../i18n';

  const {
    modules = [],
    onToggleModule = (_key: string, _enabled: boolean) => {},
  }: {
    modules?: any[];
    onToggleModule?: (key: string, enabled: boolean) => void | Promise<void>;
  } = $props();

  const nameOf = (id: string) => modules.find((mod) => mod.id === id)?.name ?? id;

  let query = $state('');

  const matches = (mod: any) =>
    !query || mod.name?.toLowerCase().includes(query.toLowerCase())
      || mod.id?.toLowerCase().includes(query.toLowerCase());

  const groupedModules = $derived(groupModulesByCategory(modules));
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
    {#each groupedModules as group}
      {@const items = group.items.filter(matches)}
      {#if items.length > 0}
        <section class="space-y-1">
          <p class="flex items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/50">
            <Papicon icon={categoryIcons[group.category] || 'Grid'} size={12} />
            {categoryLabel(group.category)}
            <span class="font-medium tracking-normal text-on-surface-variant/40 normal-case">
              {m.mf_active_count({ active: items.filter((mod) => mod.status === 'active').length, total: items.length })}
            </span>
          </p>

          <div class="rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/10 overflow-hidden bg-surface-container-high/10">
            {#each items as mod (mod.id)}
              {@const blockedBy = (mod.blockedBy ?? []) as string[]}
              <div class="flex items-center justify-between gap-3 px-4 py-3">
                <div class="min-w-0">
                  <span class="flex items-center gap-2.5 min-w-0">
                    <span class="w-1.5 h-1.5 rounded-full shrink-0 {mod.status === 'active' ? 'bg-emerald-500' : 'bg-on-surface-variant/30'}"></span>
                    <span class="text-sm font-medium truncate">{mod.name}</span>
                  </span>
                  <span class="block pl-5 text-[10px] text-on-surface-variant/40">{mod.id}</span>
                  {#if blockedBy.length > 0 && !mod.lockedByPlan}
                    <span class="block pl-5 mt-0.5 text-[11px] text-amber-500">
                      {m.mf_blocked_by({ list: blockedBy.map(nameOf).join(', ') })}
                    </span>
                  {/if}
                </div>

                {#if mod.lockedByPlan}
                  <a href="/billing" class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold shrink-0">
                    <Papicon icon="Lock" size={12} />
                    {m.mgmt_module_locked()}
                  </a>
                {:else if mod.isFixed}
                  <span class="px-2.5 py-1 rounded-lg bg-surface-container-high/60 text-on-surface-variant/60 text-[11px] font-semibold shrink-0">
                    {m.mf_module_core()}
                  </span>
                {:else}
                  <ToggleSwitch
                    checked={mod.status === 'active'}
                    ariaLabel={mod.name}
                    onToggle={(value) => onToggleModule(mod.id, value)}
                  />
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  </div>
</SettingsGroup>
