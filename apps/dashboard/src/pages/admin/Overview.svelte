<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchAdminStats } from '../../lib/api';
  import Papicon from '../../lib/components/Papicon.svelte';
  import Skeleton from '../../lib/components/Skeleton.svelte';
  import AdminLayout from '../../lib/components/AdminLayout.svelte';

  interface AdminStats {
    guildCount: number;
    userCount: number;
    activeSanctions: number;
    dailyAlgoSubmissions: number;
    uptime: number;
    memoryUsage: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers: number;
    };
    shardCount: number;
    onlineShardCount: number;
    averageShardPing: number;
  }

  let stats = $state<AdminStats | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      stats = await fetchAdminStats() as AdminStats;
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
  });

  function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}j ${h}h ${m}m`;
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  const heapPercent = $derived(
    stats ? Math.round((stats.memoryUsage.heapUsed / stats.memoryUsage.heapTotal) * 100) : 0
  );
</script>

<AdminLayout>
  <div class="space-y-8 pb-12 animate-in fade-in slide-in-from-bottom-3 duration-600">

    <!-- Page header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-container-low/40 p-5 rounded-xl border border-outline-variant/30">
      <div>
        <h2 class="text-lg font-bold text-on-surface tracking-tight">Vue d'ensemble</h2>
        <p class="text-sm text-on-surface-variant/50 font-medium">Statistiques globales et santé du système Kotbo</p>
      </div>
      {#if stats}
        <div class="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-bold">
          <Papicon icon="Zap" size={14} />
          {stats.onlineShardCount}/{stats.shardCount} shards · {stats.averageShardPing}ms
        </div>
      {/if}
    </div>

    {#if loading}
      <!-- Skeleton grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {#each Array(4) as _}
          <Skeleton height="110px" class="rounded-2xl" />
        {/each}
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton height="220px" class="rounded-2xl" />
        <Skeleton height="220px" class="rounded-2xl" />
      </div>

    {:else if error}
      <div class="flex flex-col items-center justify-center py-20 gap-4 text-center bg-error/5 border border-error/15 rounded-2xl">
        <div class="w-14 h-14 rounded-2xl bg-error/10 border border-error/20 flex items-center justify-center text-error">
          <Papicon icon="AlertTriangle" size={28} />
        </div>
        <div>
          <p class="font-bold text-on-surface text-lg">Erreur de chargement</p>
          <p class="text-sm text-on-surface-variant/60 mt-1">{error}</p>
        </div>
      </div>

    {:else if stats}
      <!-- KPI Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {#each [
          { label: 'Serveurs', value: stats.guildCount.toLocaleString(), icon: 'Server', color: 'indigo', change: '+2 ce mois' },
          { label: 'Utilisateurs', value: stats.userCount.toLocaleString(), icon: 'Users', color: 'blue', change: 'total' },
          { label: 'Sanctions', value: stats.activeSanctions.toLocaleString(), icon: 'ShieldAlert', color: 'amber', change: 'actives' },
          { label: 'Exercices', value: stats.dailyAlgoSubmissions.toLocaleString(), icon: 'Code', color: 'emerald', change: 'soumissions' },
        ] as card}
          <div class="group relative overflow-hidden bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl p-5 hover:border-{card.color}-500/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
            <div class="flex items-start justify-between mb-3">
              <div class="w-10 h-10 rounded-xl bg-{card.color}-500/10 border border-{card.color}-500/15 flex items-center justify-center text-{card.color}-400 transition-transform duration-300 group-hover:scale-110">
                <Papicon icon={card.icon} size={18} />
              </div>
            </div>
            <p class="text-2xl font-bold text-on-surface font-mono">{card.value}</p>
            <p class="text-xs font-bold text-on-surface-variant/50 mt-1">{card.label}</p>
            <p class="text-[10px] text-on-surface-variant/30 font-medium mt-0.5">{card.change}</p>
          </div>
        {/each}
      </div>

      <!-- System health + Broadcast -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <!-- System Health Card -->
        <div class="bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl p-6 space-y-5">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center text-indigo-400">
              <Papicon icon="activity" size={16} />
            </div>
            <div>
              <p class="font-bold text-on-surface text-sm">Santé Système</p>
              <p class="text-[10px] text-on-surface-variant/40 font-medium uppercase tracking-wider">Métriques en temps réel</p>
            </div>
          </div>

          <!-- Metrics grid -->
          <div class="grid grid-cols-2 gap-3">
            <div class="bg-on-surface/4 rounded-xl p-3.5 space-y-1">
              <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">Uptime</p>
              <p class="text-sm font-bold font-mono text-indigo-400">{formatUptime(stats.uptime)}</p>
            </div>
            <div class="bg-on-surface/4 rounded-xl p-3.5 space-y-1">
              <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">RAM (RSS)</p>
              <p class="text-sm font-bold font-mono text-blue-400">{formatBytes(stats.memoryUsage.rss)}</p>
            </div>
            <div class="bg-on-surface/4 rounded-xl p-3.5 space-y-1">
              <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">Ping moy.</p>
              <p class="text-sm font-bold font-mono text-emerald-400">{stats.averageShardPing}ms</p>
            </div>
            <div class="bg-on-surface/4 rounded-xl p-3.5 space-y-1">
              <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">External</p>
              <p class="text-sm font-bold font-mono text-purple-400">{formatBytes(stats.memoryUsage.external)}</p>
            </div>
          </div>

          <!-- Heap usage bar -->
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-on-surface-variant/50">Heap Utilisé</span>
              <span class="font-bold font-mono text-on-surface-variant">
                {formatBytes(stats.memoryUsage.heapUsed)} / {formatBytes(stats.memoryUsage.heapTotal)}
                <span class="text-on-surface-variant/40 ml-1">({heapPercent}%)</span>
              </span>
            </div>
            <div class="h-2 bg-on-surface/5 rounded-full overflow-hidden border border-on-surface/5">
              <div
                class="h-full rounded-full transition-all duration-1000 ease-out
 {heapPercent > 80 ? 'bg-red-500 shadow-red-500/30' : heapPercent > 60 ? 'bg-amber-500 shadow-amber-500/30' : 'bg-linear-to-r from-indigo-500 to-purple-500 shadow-indigo-500/20'}
                  shadow-lg"
                style="width: {heapPercent}%"
              ></div>
            </div>
          </div>
        </div>

        <!-- Broadcast Quick Access -->
        <a href="/admin/broadcast" class="group bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl p-6 flex flex-col gap-5 hover:border-blue-500/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/15 flex items-center justify-center text-blue-400 transition-transform duration-300 group-hover:scale-110">
              <Papicon icon="Megaphone" size={16} />
            </div>
            <div>
              <p class="font-bold text-on-surface text-sm">Broadcast</p>
              <p class="text-[10px] text-on-surface-variant/40 font-medium">Diffusion sur {stats.guildCount} serveurs</p>
            </div>
          </div>
          <div class="flex-1 flex items-center justify-center py-6">
            <div class="text-center space-y-2">
              <div class="w-12 h-12 mx-auto rounded-2xl bg-blue-500/10 border border-blue-500/15 flex items-center justify-center text-blue-400">
                <Papicon icon="Send" size={22} />
              </div>
              <p class="text-xs font-bold text-on-surface-variant/50">Composer une annonce</p>
              <p class="text-[10px] text-on-surface-variant/30">Emojis custom, ciblage, aperçu, historique</p>
            </div>
          </div>
        </a>
      </div>

    {/if}
  </div>
</AdminLayout>
