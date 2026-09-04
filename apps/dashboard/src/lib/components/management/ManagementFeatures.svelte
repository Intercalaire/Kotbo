<script module>
  import { categoryMap, categoryIcons, categoryColors, categoryOrder, categoryLabel } from './ManagementAccess.svelte';
</script>

<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import ToggleSwitch from '../ToggleSwitch.svelte';
  import { m } from '../../i18n';

  let {
    features = $bindable([]),
    onSave = (_key?: string) => {}
  }: {
    features?: any[];
    onSave?: (key?: string) => void | Promise<void>;
  } = $props();

  // Group features by category - Use $derived.by for better performance
  const groupedFeatures = $derived.by(() => {
    const groups: Array<{ category: string; items: Array<{ feature: any; idx: number }> }> = [];
    const catMap = new Map<string, Array<{ feature: any; idx: number }>>();

    features.forEach((feature, idx) => {
      const cat = categoryMap[feature.featureKey] || 'other';
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push({ feature, idx });
    });

    for (const cat of categoryOrder) {
      if (catMap.has(cat)) {
        groups.push({ category: cat, items: catMap.get(cat)! });
        catMap.delete(cat);
      }
    }
    for (const [cat, items] of catMap) {
      groups.push({ category: cat, items });
    }

    return groups;
  });

  let expandedCategory = $state<string | null>(null);
</script>

<div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6 animate-in fade-in duration-500">
  <div class="flex justify-between items-center">
    <div>
      <h3 class="text-2xl font-semibold">{m.mf_title()}</h3>
      <p class="text-xs text-on-surface-variant/50 mt-1">{m.mf_desc()}</p>
    </div>
    <button onclick={() => onSave()} class="px-7 py-3 bg-primary text-on-primary font-semibold uppercase tracking-widest text-[10px] rounded-lg transition-transform">
      {m.common_save()}
    </button>
  </div>

  <div class="space-y-4">
    {#each groupedFeatures as group}
      {@const catColor = categoryColors[group.category] || { text: 'text-on-surface-variant', bg: 'bg-surface-container-high/20', border: 'border-outline-variant/10' }}
      {@const catIcon = categoryIcons[group.category] || 'Grid'}
      {@const isCatExpanded = expandedCategory === group.category}

      <div class="space-y-2">
        <!-- Category header -->
        <button
          onclick={() => expandedCategory = isCatExpanded ? null : group.category}
          class="w-full flex items-center gap-3 px-5 py-3 rounded-lg {catColor.bg} border {catColor.border} hover:opacity-90 transition-all cursor-pointer"
        >
          <Papicon icon={catIcon} size={18} class={catColor.text} />
          <span class="text-[11px] font-semibold uppercase tracking-widest {catColor.text}">{categoryLabel(group.category)}</span>
          <span class="text-[10px] text-on-surface-variant/40 ml-1">{group.items.length} {m.ma_word_module()}{group.items.length > 1 ? 's' : ''}</span>
          <div class="ml-auto transform transition-transform {isCatExpanded ? 'rotate-180' : ''}">
            <Papicon icon="CaretDown" size={14} class="text-on-surface-variant/40" />
          </div>
        </button>

        <!-- Category items table -->
        {#if isCatExpanded}
          <div class="overflow-hidden rounded-xl border border-outline-variant/5 animate-in fade-in slide-in-from-top-1 duration-300">
            <table class="w-full text-left border-collapse">
              <thead class="bg-surface-container-high/40 text-xs font-medium text-on-surface-variant/60">
                <tr>
                  <th class="px-6 py-4">{m.mf_col_module()}</th>
                  <th class="px-6 py-4 text-center">{m.mf_col_enabled()}</th>
                  <th class="px-6 py-4 text-center">{m.mf_col_logs()}</th>
                  <th class="px-6 py-4 text-center">{m.mf_col_tracking()}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-outline-variant/5">
                {#each group.items as { feature, idx }}
                  <tr class="hover:bg-surface-container-high/20 transition-colors">
                    <td class="px-6 py-5">
                      <div class="flex items-center gap-3">
                        <span class="w-2 h-2 rounded-full {feature.enabled ? 'bg-emerald-500' : 'bg-red-400'}"></span>
                        <div>
                          <p class="text-sm font-bold">{feature.featureName}</p>
                          <p class="text-[10px] text-on-surface-variant/40">{feature.featureKey}</p>
                        </div>
                      </div>
                    </td>
                    <td class="px-6 py-5 text-center">
                      <div class="flex justify-center">
                        <ToggleSwitch 
                          checked={features[idx].enabled || features[idx].isFixed} 
                          disabled={features[idx].isFixed}
                          onToggle={(v) => { features[idx].enabled = v; features = [...features]; }} 
                        />
                      </div>
                    </td>
                    <td class="px-6 py-5 text-center">
                      <div class="flex justify-center">
                        <ToggleSwitch checked={features[idx].loggingEnabled} onToggle={(v) => { features[idx].loggingEnabled = v; features = [...features]; }} />
                      </div>
                    </td>
                    <td class="px-6 py-5 text-center">
                      <div class="flex justify-center">
                        <ToggleSwitch checked={features[idx].userActivityTracking} onToggle={(v) => { features[idx].userActivityTracking = v; features = [...features]; }} />
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
