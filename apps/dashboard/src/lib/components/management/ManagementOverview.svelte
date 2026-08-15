<script module>
  import { categoryMap, categoryOrder, categoryLabel } from './ManagementAccess.svelte';
</script>

<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import { m } from '../../i18n';

  const { features = [], guildSettings = {} as any } = $props();

  const enabledCount = $derived(features.filter((f: any) => f.enabled).length);
  const loggingCount = $derived(features.filter((f: any) => f.loggingEnabled).length);
  const trackingCount = $derived(features.filter((f: any) => f.userActivityTracking).length);
  const dmNotifCount = $derived(features.filter((f: any) => f.notifyViaDM).length);
  const channelNotifCount = $derived(features.filter((f: any) => f.notifyViaDiscordChannel).length);

  const criticalChannels = $derived.by(() => [
    { label: m.mgmt_chan_logs(), value: guildSettings.logChannelId, key: 'logChannelId' },
    { label: m.mgmt_chan_regulation(), value: guildSettings.regulationChannelId, key: 'regulationChannelId' },
    { label: m.mgmt_chan_meeting_announcements(), value: guildSettings.meetingAnnouncementChannelId, key: 'meetingAnnouncementChannelId' },
    { label: m.mgmt_chan_digest(), value: guildSettings.digestChannelId, key: 'digestChannelId' },
  ]);

  const missingChannels = $derived(criticalChannels.filter(c => !c.value));
  const healthScore = $derived(Math.round(((criticalChannels.length - missingChannels.length) / criticalChannels.length) * 100));

  const groupedFeatures = $derived.by(() => {
    const groups: Array<{ category: string; items: any[] }> = [];
    const catMap = new Map<string, any[]>();

    features.forEach((feature) => {
      const cat = categoryMap[feature.featureKey] || 'other';
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(feature);
    });

    for (const cat of categoryOrder) {
      if (catMap.has(cat)) {
        groups.push({ category: cat, items: catMap.get(cat)! });
      }
    }
    return groups;
  });
</script>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 animate-in fade-in duration-500">
  <div class="bg-surface-container-low/30 border border-outline-variant/10 p-7 rounded-xl space-y-3 group hover:border-primary/20 transition-colors">
    <div class="bg-primary/10 w-11 h-11 rounded-lg flex items-center justify-center text-primary group- transition-transform"><Papicon icon="Package" size={22} /></div>
    <h3 class="text-sm font-bold text-on-surface-variant/70">{m.mgmt_active_modules()}</h3>
    <p class="text-lg font-semibold">{enabledCount} <span class="text-sm font-normal text-on-surface-variant/40">/ {features.length}</span></p>
  </div>
  <div class="bg-surface-container-low/30 border border-outline-variant/10 p-7 rounded-xl space-y-3 group hover:border-secondary/20 transition-colors">
    <div class="bg-secondary/10 w-11 h-11 rounded-lg flex items-center justify-center text-secondary group- transition-transform"><Papicon icon="Bell" size={22} /></div>
    <h3 class="text-sm font-bold text-on-surface-variant/70">{m.mgmt_notifications()}</h3>
    <p class="text-[11px] text-on-surface-variant/60 font-medium">{m.mgmt_notif_summary({ channel: channelNotifCount, dm: dmNotifCount })}</p>
  </div>
  <div class="bg-surface-container-low/30 border border-outline-variant/10 p-7 rounded-xl space-y-3 group hover:border-tertiary/20 transition-colors">
    <div class="bg-tertiary/10 w-11 h-11 rounded-lg flex items-center justify-center text-tertiary group- transition-transform"><Papicon icon="FileText" size={22} /></div>
    <h3 class="text-sm font-bold text-on-surface-variant/70">Logging</h3>
    <p class="text-[11px] text-on-surface-variant/60 font-medium">{m.mgmt_logging_summary({ logging: loggingCount, tracking: trackingCount })}</p>
  </div>
  <div class="bg-surface-container-low/30 border border-outline-variant/10 p-7 rounded-xl space-y-3 group hover:border-emerald-500/20 transition-colors">
    <div class="w-11 h-11 rounded-lg flex items-center justify-center {healthScore >= 80 ? 'bg-emerald-500/10 text-emerald-500' : healthScore >= 50 ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'} group- transition-transform"><Papicon icon="HeartBeat" size={22} /></div>
    <h3 class="text-sm font-bold text-on-surface-variant/70">{m.mgmt_health_score()}</h3>
    <p class="text-lg font-semibold {healthScore >= 80 ? 'text-emerald-500' : healthScore >= 50 ? 'text-amber-500' : 'text-red-500'}">{healthScore}%</p>
  </div>
</div>

{#if missingChannels.length > 0}
  <div class="bg-amber-500/5 border border-amber-500/20 p-6 rounded-xl flex items-start gap-4">
    <div class="bg-amber-500/10 p-2 rounded-xl text-amber-500 shrink-0"><Papicon icon="Warning" size={18} /></div>
    <div>
      <h4 class="font-bold text-sm text-amber-500 uppercase tracking-widest text-[10px]">{m.mgmt_incomplete_config()}</h4>
      <p class="text-xs text-on-surface-variant/60 mt-1">{m.mgmt_missing_channels({ list: missingChannels.map(c => c.label).join(', ') })} <b>{m.mgmt_tab_channels_roles()}</b> {m.mgmt_to_configure()}</p>
    </div>
  </div>
{/if}

<div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-8">
  <div class="flex items-center justify-between">
    <h3 class="text-lg font-semibold flex items-center gap-3"><Papicon icon="List" size={20} class="text-primary" /> {m.mgmt_features_status()}</h3>
    <div class="flex gap-4 text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40">
      <span class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> {m.common_active()}</span>
      <span class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-red-400"></span> {m.common_inactive()}</span>
    </div>
  </div>

  <div class="space-y-8">
    {#each groupedFeatures as group}
      <div class="space-y-4">
        <div class="flex items-center gap-3">
          <div class="h-[1px] flex-1 bg-outline-variant/10"></div>
          <span class="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/30">{categoryLabel(group.category)}</span>
          <div class="h-[1px] flex-1 bg-outline-variant/10"></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {#each group.items as f}
            <div class="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 hover:bg-surface-container-high/40 transition-colors">
              <span class="w-2 h-2 rounded-full shrink-0 {f.enabled ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]' : 'bg-red-400'}"></span>
              <span class="text-sm font-bold flex-1 truncate text-on-surface/80">{f.featureName}</span>
              <div class="flex items-center gap-1.5 text-[10px] font-semibold">
                {#if f.loggingEnabled}<span class="px-1.5 py-0.5 rounded bg-surface-container-high/60 text-on-surface-variant/60">LOG</span>{/if}
                {#if f.notifyViaDM}<span class="px-1.5 py-0.5 rounded bg-primary/10 text-primary">MP</span>{/if}
                {#if f.notifyViaDiscordChannel}<span class="px-1.5 py-0.5 rounded bg-secondary/10 text-secondary">CH</span>{/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>
