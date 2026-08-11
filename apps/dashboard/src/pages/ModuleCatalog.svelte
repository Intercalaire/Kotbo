<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { applyGuildPreset, updateModuleStatus } from '../lib/api';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';
  import { getModuleIcon } from '../lib/moduleMeta';
  import Papicon from '../lib/components/Papicon.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';

  const canManageSettings = $derived(
    !!dashboardStore.state.featureAccess?.modules?.canConfigure
      || !!dashboardStore.state.access?.canManageSettings
  );

  function canConfigureModule(moduleId: string) {
    return canManageSettings || !!dashboardStore.state.featureAccess?.[moduleId]?.canConfigure;
  }
  
  const canApplyPreset = $derived(
    !!dashboardStore.state.access?.canManageSettings
      || (!!dashboardStore.state.featureAccess?.modules?.canConfigure
        && !!dashboardStore.state.featureAccess?.commands?.canConfigure)
  );

  async function toggleModule(moduleId, currentStatus) {
    if (!canConfigureModule(moduleId)) return;
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    const success = await updateModuleStatus(moduleId, newStatus);
    if (success) {
      dashboardStore.refresh();
    }
  }

  const presets = [
    {
      key: 'general',
      title: 'Communauté générale',
      description: 'Traduction active, modules dev en veille, commandes admin sous contrôle.',
      accent: 'from-emerald-500/20 via-emerald-500/10 to-transparent',
      icon: 'UserList',
      color: 'emerald',
      badge: 'Polyvalent'
    },
    {
      key: 'gaming',
      title: 'Gaming/Esport',
      description: 'Traduction active, stack de modération simple, focus salons joueurs.',
      accent: 'from-amber-500/20 via-amber-500/10 to-transparent',
      icon: 'GameController',
      color: 'amber',
      badge: 'Performance'
    },
    {
      key: 'dev',
      title: 'Dev/Tech',
      description: 'Daily Algo + Code Police actifs, commandes techniques ouvertes.',
      accent: 'from-indigo-500/20 via-indigo-500/10 to-transparent',
      icon: 'Code',
      color: 'indigo',
      badge: 'Avancé'
    },
  ];

  let applyingPreset = $state(false);
  async function applyPreset(presetKey) {
    if (!canApplyPreset || applyingPreset) return;
    if (!(await confirmDialog.ask({ title: `Appliquer le preset « ${presetKey} » ?`, description: 'Certains réglages actuels seront remplacés.', confirmLabel: 'Appliquer', variant: 'warning' }))) return;
    
    applyingPreset = true;
    const success = await applyGuildPreset(presetKey);
    applyingPreset = false;
    if (success) {
      dashboardStore.refresh();
    }
  }

  let filter = $state('Tous');
  const filteredModules = $derived(
    dashboardStore.state.modules.filter(m => {
      if (filter === 'Tous') return true;
      if (filter === 'Actifs') return m.status === 'active';
      if (filter === 'Inactifs') return m.status === 'inactive';
      if (filter === 'Erreurs') return m.status === 'error';
      return true;
    })
  );

  const activeCount = $derived(dashboardStore.state.modules.filter(m => m.status === 'active').length);
  const inactiveCount = $derived(dashboardStore.state.modules.filter(m => m.status === 'inactive').length);
  const errorCount = $derived(dashboardStore.state.modules.filter(m => m.status === 'error').length);

  function getModulePage(moduleId: string) {
    const mapping: Record<string, string> = {
      'regulation': '/regulation',
      'staff_management': '/staff-management',
      'sanctions': '/security/sanctions',
      'members': '/members',
      'logs': '/logs',
      'activity': '/activity',
      'analytics': '/analytics',
      'profile': '/profile',
      'daily_algo': '/dailyalgo',
      'auto_thread': '/auto-thread',
      'recruitment': '/recruitment',
      'meetings': '/planning',
      'absences': '/planning',
      'inbox': '/inbox',
      'tutoring': '/tutoring',
      'double_accounts': '/security/accounts',
      'fun': '/fun',
      'leveling': '/leveling',
      'economy': '/economy',
      'tickets': '/tickets'
    };
    return mapping[moduleId] || `/module-settings/${moduleId}`;
  }
</script>

<div class="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20 max-w-7xl mx-auto px-4 md:px-8">
  
  <!-- Header Section -->
  <div class="relative overflow-hidden bg-surface-container-low/30 p-5 md:p-6 rounded-xl border border-outline-variant/10 group">
    <div class="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 w-64 h-64 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors duration-1000"></div>

    <div class="relative flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div class="flex items-center gap-4">
        <div class="bg-primary/10 p-2 rounded-xl text-primary">
          <Papicon icon="Package" size={20} />
        </div>
        <div>
          <span class="text-xs font-medium text-primary">Modules & Extensions</span>
          <h2 class="text-lg font-semibold tracking-tight text-on-surface font-headline leading-tight">
            Catalogue <span class="text-primary">Système</span>
          </h2>
          <p class="text-on-surface-variant/60 text-sm max-w-md">Personnalisez votre instance Kotbo en activant les modules adaptés à votre communauté.</p>
        </div>
      </div>

      <div class="flex flex-col items-end gap-3 w-full md:w-auto">
        <div class="flex gap-1 bg-surface-container-high/40 p-1.5 rounded-lg border border-outline-variant/10 overflow-x-auto no-scrollbar">
          {#each ['Tous', 'Actifs', 'Inactifs', 'Erreurs'] as f}
            <button
              onclick={() => filter = f}
              class="px-4 py-2 rounded-lg text-xs font-medium transition-all duration-300 whitespace-nowrap {filter === f ? 'bg-primary text-on-primary shadow-sm ' : 'text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high'}"
            >
              {f}
            </button>
          {/each}
        </div>

        <div class="flex items-center gap-3 text-xs font-medium text-on-surface-variant/40 bg-surface-container-low/40 px-4 py-2 rounded-lg border border-outline-variant/5">
           <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/20"></span>
              <span>{activeCount} Actifs</span>
           </div>
           <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-red-400 shadow-sm shadow-red-500/20"></span>
              <span>{errorCount} Erreurs</span>
           </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Presets Section -->
  <div class="space-y-6">
    <div class="flex items-center gap-4 px-2">
      <div class="h-px flex-1 bg-gradient-to-r from-transparent via-outline-variant/20 to-transparent"></div>
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.4em] text-on-surface-variant/40">Presets de Configuration</h3>
      <div class="h-px flex-1 bg-gradient-to-r from-transparent via-outline-variant/20 to-transparent"></div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      {#each presets as preset}
        <div class="relative overflow-hidden bg-surface-container-low/40 rounded-xl border border-outline-variant/10 p-8 group hover:bg-surface-container-low transition-all duration-500">
          <div class={`absolute top-0 right-0 p-12 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity duration-700 text-on-surface`}>
             <Papicon icon={preset.icon} size={120} />
          </div>
          
          <div class="relative space-y-6">
            <div class="flex justify-between items-start">
               <div class={`p-4 rounded-lg bg-primary/10 text-primary shadow-inner`}>
                  <Papicon icon={preset.icon} size={28} />
               </div>
               <span class={`px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface-variant text-[11px] font-semibold uppercase tracking-widest border border-outline-variant/10`}>
                 {preset.badge}
               </span>
            </div>

            <div>
              <h4 class="text-xl font-semibold text-on-surface tracking-tight">{preset.title}</h4>
              <p class="mt-2 text-sm text-on-surface-variant/60 leading-relaxed line-clamp-2">{preset.description}</p>
            </div>

            <button
              onclick={() => applyPreset(preset.key)}
              disabled={!canApplyPreset || applyingPreset}
              class={`w-full py-4 rounded-lg text-xs font-medium transition-all duration-300
                ${!canApplyPreset || applyingPreset 
                  ? 'bg-surface-container-high text-on-surface-variant/40 cursor-not-allowed' 
                  : `bg-primary text-on-primary hover: shadow-sm shadow-primary/20 hover:shadow-primary/30 active:scale-95`}`}
            >
              {applyingPreset ? 'Application...' : 'Appliquer le preset'}
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Modules Grid -->
  <div class="space-y-6">
    <div class="flex items-center justify-between px-2">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.4em] text-on-surface-variant/40">Tous les Modules</h3>
      <span class="text-[10px] font-bold text-on-surface-variant/30">{filteredModules.length} extensions disponibles</span>
    </div>

    {#if dashboardStore.state.loading && dashboardStore.state.modules.length === 0}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {#each Array(8) as _}
          <div class="h-64 rounded-xl bg-surface-container-low/20 animate-pulse border border-outline-variant/5"></div>
        {/each}
      </div>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {#each filteredModules as module}
          <div 
            class="group relative bg-surface-container-low/30 rounded-xl border border-outline-variant/10 p-7 hover:bg-surface-container-low transition-all duration-500 hover:shadow-sm hover:shadow-surface/20 {module.status === 'inactive' ? 'opacity-65 grayscale' : ''}"
            in:fly={{ y: 20, duration: 400 }}
          >
            <!-- Status Badge -->
            <div class="absolute top-7 right-7">
               <ToggleSwitch
                 checked={module.status === 'active' || module.isFixed}
                 disabled={!canConfigureModule(module.id) || module.isFixed}
                 onToggle={() => toggleModule(module.id, module.status)}
               />
            </div>

            <div class="space-y-5">
              <div class={`w-14 h-14 rounded-lg flex items-center justify-center shadow-inner transition-transform group- duration-500
                ${module.status === 'active' ? 'bg-primary/10 text-primary' : module.status === 'error' ? 'bg-error/10 text-error' : 'bg-surface-container-highest text-on-surface-variant/40'}`}>
                <Papicon icon={getModuleIcon(module.id)} size={28} />
              </div>

              <div>
                <h3 class="text-lg font-semibold text-on-surface tracking-tight group-hover:text-primary transition-colors">{module.name}</h3>
                <p class="mt-2 text-xs text-on-surface-variant/50 leading-relaxed line-clamp-3 font-medium">{module.description}</p>
              </div>

              <div class="pt-2 flex items-center justify-between">
                <div class="flex items-center gap-2">
                   <div class={`w-1.5 h-1.5 rounded-full ${module.status === 'active' ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse' : module.status === 'error' ? 'bg-error shadow-sm shadow-error/50' : 'bg-on-surface-variant/20'}`}></div>
                   <span class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40">
                     {module.status === 'active' ? 'Actif' : module.status === 'error' ? 'Erreur' : 'Inactif'}
                   </span>
                </div>

                <a 

                  href={getModulePage(module.id)} 
                  class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary hover:gap-2.5 transition-all"
                >
                  Détails <Papicon icon="ArrowRight" size={10} />
                </a>
              </div>

              {#if module.isFixed}
                <div class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 px-4 py-1 rounded-full bg-surface-container-high border border-outline-variant/10 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                   <span class="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/40">Module Essentiel</span>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Bottom Stats / Status -->
  <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
    <div class="md:col-span-2 bg-slate-900 rounded-xl p-10 text-white flex flex-col justify-between shadow-sm relative overflow-hidden group border border-white/5">
      <div class="absolute top-0 right-0 p-12 opacity-5 group- group-hover:opacity-10 transition-all duration-1000">
        <Papicon icon="HardDrive" size={120} />
      </div>
      
      <div class="relative space-y-2">
        <div class="flex items-center gap-2 opacity-60">
           <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
           <span class="text-[10px] font-semibold uppercase tracking-wider">État du Cluster</span>
        </div>
        <p class="text-lg font-semibold font-headline tracking-tight leading-tight">
          Instance {dashboardStore.state.loading ? '...' : (errorCount > 0 ? 'Partiellement Dégradée' : '100% Opérationnelle')}
        </p>
      </div>

      <div class="relative mt-8 flex items-center gap-6">
        <div class="flex items-center gap-3 bg-white/5 px-4 py-2.5 rounded-lg border border-white/10">
          <div class="flex -space-x-1.5">
            <div class="w-8 h-8 rounded-full border-2 border-slate-900 bg-emerald-500 flex items-center justify-center text-[10px] font-semibold">{activeCount}</div>
            <div class="w-8 h-8 rounded-full border-2 border-slate-900 bg-amber-500 flex items-center justify-center text-[10px] font-semibold">{inactiveCount}</div>
            <div class="w-8 h-8 rounded-full border-2 border-slate-900 bg-red-500 flex items-center justify-center text-[10px] font-semibold">{errorCount}</div>
          </div>
          <span class="text-[10px] font-bold opacity-60 uppercase tracking-widest">Répartition</span>
        </div>
        <div class="text-[10px] font-bold opacity-40 uppercase tracking-widest">
           API: {dashboardStore.state.error ? 'Hors-Ligne' : 'En Ligne'}
        </div>
      </div>
    </div>
    
    <div class="bg-primary/5 dark:bg-primary/10 rounded-xl p-10 flex flex-col justify-between border border-primary/10 hover:bg-primary/10 transition-colors duration-500">
      <div class="bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center text-primary shadow-inner">
         <Papicon icon="Lightning" size={24} />
      </div>
      <div>
        <p class="text-lg font-semibold text-primary font-headline tracking-tighter">{dashboardStore.state.analytics.totalAutomations || 0}</p>
        <p class="text-[11px] font-semibold text-primary/60 uppercase tracking-wider mt-2">Interactions Totales</p>
      </div>
    </div>
    
    <div class="bg-surface-container-low/40 rounded-xl p-10 flex flex-col justify-between border border-outline-variant/10 hover:bg-surface-container-low transition-colors duration-500">
      <div class="bg-surface-container-highest w-12 h-12 rounded-lg flex items-center justify-center text-on-surface-variant/40 shadow-inner">
         <Papicon icon="CloudArrowUp" size={24} />
      </div>
      <div>
        <p class="text-lg font-semibold text-on-surface font-headline tracking-tighter">Sync</p>
        <p class="text-[11px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mt-2">Dernière Pulsation: {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
    </div>
  </div>
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
