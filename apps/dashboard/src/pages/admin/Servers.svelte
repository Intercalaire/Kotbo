<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { toast } from '../../lib/stores/toast.svelte';
  import { confirmDialog } from '../../lib/stores/confirmDialog.svelte';
  import {
    fetchAdminStats,
    fetchAdminGuilds,
    fetchAdminGuildInvite,
    leaveAdminGuild,
    deactivateAdminGuild,
    activateAdminGuildAuto,
    rescanAdminGuildStats,
    resyncAdminGuildData,
    reconcileStaffServers,
    resetAdminGuildServerTemplate
  } from '../../lib/api';
  import Papicon from '../../lib/components/Papicon.svelte';
  import Skeleton from '../../lib/components/Skeleton.svelte';
  import AdminLayout from '../../lib/components/AdminLayout.svelte';

  interface AdminStats {
    guildCount: number;
    userCount: number;
    activeSanctions: number;
    dailyAlgoSubmissions: number;
    uptime: number;
    memoryUsage: { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number };
    shardCount: number;
    onlineShardCount: number;
    averageShardPing: number;
  }

  interface AdminGuild {
    id: string;
    name: string;
    icon: string | null;
    memberCount: number;
    joinedAt: string;
    activated: boolean;
    activationCode: string | null;
    serverTemplateAppliedAt: string | null;
    serverTemplateAppliedBy: string | null;
    statsConfig?: {
      historicalScrapeStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
      historicalScrapedMessages?: number;
      historicalScrapeError?: string | null;
      historicalScrapeProgress?: {
        scrapedChannelsCount: number;
        totalChannelsCount: number;
        scrapedMessagesCount: number;
      };
      memberScrapeStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
      memberScrapedCount?: number;
      memberScrapeError?: string | null;
      memberScrapeProgress?: {
        scrapedCount: number;
        totalCount: number;
      };
      fullSyncStatus?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
      fullSyncStage?: 'MEMBERS' | 'HISTORY' | null;
      fullSyncError?: string | null;
    } | null;
    shardId: number;
  }

  let stats = $state<AdminStats | null>(null);
  let guilds = $state<AdminGuild[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let searchQuery = $state('');
  let syncingGuildIds = $state<Set<string>>(new Set());
  let interval: any;

  onMount(async () => {
    try {
      const [statsData, guildsData] = await Promise.all([fetchAdminStats(), fetchAdminGuilds()]);
      stats = statsData as AdminStats;
      guilds = guildsData.guilds as AdminGuild[];
      interval = setInterval(async () => {
        try {
          const data = await fetchAdminGuilds();
          guilds = data.guilds as AdminGuild[];
        } catch {}
      }, 5000);
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
  });

  onDestroy(() => { if (interval) clearInterval(interval); });

  const filteredGuilds = $derived(
    guilds.filter(g =>
      g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.id.includes(searchQuery)
    )
  );

  const activatedCount = $derived(guilds.filter(g => g.activated).length);

  async function handleGetInvite(guildId: string) {
    try {
      const data = await fetchAdminGuildInvite(guildId);
      if (data.url) window.open(data.url, '_blank');
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleLeaveGuild(guildId: string, guildName: string) {
    if (!(await confirmDialog.danger(`Faire quitter le bot de ${guildName} ?`, '', 'Faire quitter'))) return;
    try {
      await leaveAdminGuild(guildId);
      guilds = guilds.filter(g => g.id !== guildId);
      if (stats) stats.guildCount--;
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleActivateGuildAuto(guildId: string, guildName: string) {
    if (!(await confirmDialog.ask({ title: `Activer automatiquement « ${guildName} » ?`, confirmLabel: 'Activer' }))) return;
    try {
      const res = await activateAdminGuildAuto(guildId);
      toast.success(`Serveur activé ! Code : ${res.code}`);
      guilds = (await fetchAdminGuilds()).guilds as AdminGuild[];
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleDeactivateGuild(guildId: string, guildName: string) {
    if (!(await confirmDialog.ask({ title: `Désactiver « ${guildName} » ?`, confirmLabel: 'Désactiver', variant: 'warning' }))) return;
    try {
      await deactivateAdminGuild(guildId);
      toast.success('Serveur désactivé.');
      guilds = (await fetchAdminGuilds()).guilds as AdminGuild[];
    } catch (err: any) { toast.error(err.message); }
  }

  let reconciling = $state(false);

  async function handleReconcileStaffServers() {
    reconciling = true;
    try {
      const res = await reconcileStaffServers();
      toast.success(`Serveurs staff synchronisés : ${res.checked} vérifié${res.checked > 1 ? 's' : ''} · ${res.activated} activé${res.activated > 1 ? 's' : ''} · ${res.deactivated} désactivé${res.deactivated > 1 ? 's' : ''}`);
      guilds = (await fetchAdminGuilds()).guilds as AdminGuild[];
    } catch (err: any) { toast.error(err.message); }
    finally { reconciling = false; }
  }

  async function handleRescanStats(guildId: string) {
    try {
      const res = await rescanAdminGuildStats(guildId, false);
      toast.success(res.message || 'Scan lancé.');
      guilds = (await fetchAdminGuilds()).guilds as AdminGuild[];
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleResyncAll(guildId: string, guildName: string) {
    if (!(await confirmDialog.ask({
      title: `Synchroniser toutes les données de « ${guildName} » ?`,
      description: 'Les membres seront remis à jour, puis le scan historique reprendra à son dernier curseur. Les données existantes ne seront ni supprimées ni comptées deux fois.',
      confirmLabel: 'Tout synchroniser',
      variant: 'warning'
    }))) return;

    syncingGuildIds = new Set(syncingGuildIds).add(guildId);
    try {
      const res = await resyncAdminGuildData(guildId);
      toast.success(res.message || 'Synchronisation complète lancée.');
      guilds = (await fetchAdminGuilds()).guilds as AdminGuild[];
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      const next = new Set(syncingGuildIds);
      next.delete(guildId);
      syncingGuildIds = next;
    }
  }

  function serverTemplateLabel(guild: AdminGuild): string {
    const by = guild.serverTemplateAppliedBy ?? 'un administrateur';
    const at = guild.serverTemplateAppliedAt
      ? new Date(guild.serverTemplateAppliedAt).toLocaleDateString('fr-FR')
      : null;
    return at
      ? `Rouvrir la mise en place du serveur (faite par ${by} le ${at})`
      : 'Rouvrir la mise en place du serveur';
  }

  async function handleResetServerTemplate(guild: AdminGuild) {
    if (!(await confirmDialog.ask({
      title: `Rouvrir la mise en place de « ${guild.name} » ?`,
      description: `Elle a été faite par ${guild.serverTemplateAppliedBy ?? 'un administrateur'}. Les salons déjà créés restent en place : une nouvelle mise en place les reprendra au lieu de les doubler.`,
      confirmLabel: 'Rouvrir',
      variant: 'warning'
    }))) return;

    try {
      const res = await resetAdminGuildServerTemplate(guild.id);
      toast.success(res.message || 'Mise en place rouverte.');
      guilds = (await fetchAdminGuilds()).guilds as AdminGuild[];
    } catch (err: any) { toast.error(err.message); }
  }

  function scanStatusConfig(status: string | undefined) {
    switch (status) {
      case 'IN_PROGRESS': return { label: 'En cours', dot: 'bg-amber-400 animate-pulse', chip: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
      case 'COMPLETED':   return { label: 'Terminé',  dot: 'bg-emerald-400',            chip: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
      case 'FAILED':      return { label: 'Échoué',   dot: 'bg-red-400',                chip: 'text-red-400 bg-red-500/10 border-red-500/20' };
      default:            return { label: 'Non démarré', dot: 'bg-on-surface-variant/30', chip: 'text-on-surface-variant/40 bg-on-surface/5 border-outline-variant/10' };
    }
  }
</script>

<AdminLayout>
  <div class="space-y-6 pb-12 animate-in fade-in slide-in-from-bottom-3 duration-600">

    <!-- Page header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-container-low/40 p-5 rounded-xl border border-outline-variant/30">
      <div>
        <h2 class="text-lg font-semibold text-on-surface tracking-tight">Serveurs</h2>
        <p class="text-sm text-on-surface-variant/50 font-medium">Gestion des serveurs Discord connectés</p>
      </div>
      {#if !loading && stats}
        <div class="flex items-center gap-2 flex-wrap">
          <div class="px-3.5 py-2 rounded-xl bg-on-surface/5 border border-outline-variant/10 text-xs font-semibold text-on-surface-variant flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            {activatedCount} activé{activatedCount > 1 ? 's' : ''}
          </div>
          <div class="px-3.5 py-2 rounded-xl bg-on-surface/5 border border-outline-variant/10 text-xs font-semibold text-on-surface-variant">
            {stats.guildCount} total
          </div>
          <button
            type="button"
            onclick={handleReconcileStaffServers}
            disabled={reconciling}
            title="Réactive automatiquement les serveurs staff liés dont le statut d'activation ne correspond plus à celui de leur serveur principal"
            class="px-3.5 py-2 rounded-xl bg-primary/10 border border-primary/20 text-xs font-semibold text-primary flex items-center gap-2 hover:bg-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span class={reconciling ? 'animate-spin' : ''}>
              <Papicon icon="refresh" size={13} />
            </span>
            Synchroniser les serveurs staff
          </button>
        </div>
      {/if}
    </div>

    {#if loading}
      <div class="space-y-4">
        {#each Array(5) as _}
          <Skeleton height="64px" class="rounded-xl" />
        {/each}
      </div>

    {:else if error}
      <div class="flex flex-col items-center justify-center py-20 gap-4 text-center bg-error/5 border border-error/15 rounded-lg">
        <div class="w-14 h-14 rounded-lg bg-error/10 border border-error/20 flex items-center justify-center text-error">
          <Papicon icon="AlertTriangle" size={28} />
        </div>
        <div>
          <p class="font-semibold text-on-surface text-lg">Erreur de chargement</p>
          <p class="text-sm text-on-surface-variant/60 mt-1">{error}</p>
        </div>
      </div>

    {:else}
      <!-- Search bar -->
      <div class="relative">
        <div class="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/30">
          <Papicon icon="Search" size={15} />
        </div>
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Rechercher un serveur par nom ou ID..."
          class="w-full bg-on-surface/4 border border-outline-variant/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/30 focus:bg-on-surface/6 transition-all font-medium"
        />
      </div>

      <!-- Table -->
      <div class="bg-surface-container-low/50 border border-outline-variant/10 rounded-lg overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-outline-variant/10 bg-on-surface/3">
                <th class="text-left text-xs font-medium text-on-surface-variant/30 px-5 py-3.5">Serveur</th>
                <th class="text-left text-xs font-medium text-on-surface-variant/30 px-5 py-3.5">Shard</th>
                <th class="text-left text-xs font-medium text-on-surface-variant/30 px-5 py-3.5">Statut</th>
                <th class="text-left text-xs font-medium text-on-surface-variant/30 px-5 py-3.5">Synchronisation</th>
                <th class="text-left text-xs font-medium text-on-surface-variant/30 px-5 py-3.5">Rejoint</th>
                <th class="text-right text-xs font-medium text-on-surface-variant/30 px-5 py-3.5">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-outline-variant/8">
              {#each filteredGuilds as guild}
                {@const status = guild.statsConfig?.historicalScrapeStatus}
                {@const scanCfg = scanStatusConfig(status)}
                {@const progress = guild.statsConfig?.historicalScrapeProgress}
                {@const memberStatus = guild.statsConfig?.memberScrapeStatus}
                {@const memberCfg = scanStatusConfig(memberStatus)}
                {@const memberProgress = guild.statsConfig?.memberScrapeProgress}
                {@const syncRunning = guild.statsConfig?.fullSyncStatus === 'IN_PROGRESS' || memberStatus === 'IN_PROGRESS' || status === 'IN_PROGRESS' || syncingGuildIds.has(guild.id)}
                <tr class="group hover:bg-on-surface/3 transition-colors duration-150">
                  <!-- Guild info -->
                  <td class="px-5 py-4">
                    <div class="flex items-center gap-3">
                      {#if guild.icon}
                        <img src={guild.icon} alt={guild.name} class="w-9 h-9 rounded-lg object-cover border border-outline-variant/10 shadow-sm" />
                      {:else}
                        <div class="w-9 h-9 rounded-lg bg-on-surface/10 border border-outline-variant/10 flex items-center justify-center text-sm font-semibold text-on-surface-variant/60">
                          {guild.name.charAt(0)}
                        </div>
                      {/if}
                      <div class="min-w-0">
                        <p class="font-bold text-on-surface text-sm truncate max-w-[180px]">{guild.name}</p>
                        <p class="text-[10px] text-on-surface-variant/30 font-mono">{guild.id}</p>
                      </div>
                    </div>
                  </td>

                  <!-- Shard -->
                  <td class="px-5 py-4">
                    <span class="text-xs font-semibold font-mono text-on-surface-variant/50 bg-on-surface/5 px-2 py-1 rounded-lg border border-outline-variant/10">
                      #{guild.shardId}
                    </span>
                  </td>

                  <!-- Activation status -->
                  <td class="px-5 py-4">
                    {#if guild.activated}
                      <div class="flex flex-col gap-1">
                        <span class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full w-fit">
                          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                          Activé
                        </span>
                        {#if guild.activationCode}
                          <span class="text-[11px] font-mono text-on-surface-variant/30 pl-1">{guild.activationCode}</span>
                        {/if}
                      </div>
                    {:else}
                      <button
                        onclick={() => handleActivateGuildAuto(guild.id, guild.name)}
                        class="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-2.5 py-1 rounded-full cursor-pointer transition-all"
                      >
                        <Papicon icon="Key" size={10} />
                        Activer
                      </button>
                    {/if}
                  </td>

                  <!-- Synchronisation Discord -->
                  <td class="px-5 py-4">
                    {#if guild.activated}
                      <div class="flex min-w-[210px] flex-col gap-2">
                        <div class="flex flex-wrap gap-1.5">
                          <span class="inline-flex items-center gap-1.5 text-[11px] font-medium border px-2 py-1 rounded-full {memberCfg.chip}">
                            <span class="w-1.5 h-1.5 rounded-full {memberCfg.dot}"></span>
                            Membres · {memberCfg.label}
                          </span>
                          <span class="inline-flex items-center gap-1.5 text-[11px] font-medium border px-2 py-1 rounded-full {scanCfg.chip}">
                            <span class="w-1.5 h-1.5 rounded-full {scanCfg.dot}"></span>
                            Historique · {scanCfg.label}
                          </span>
                        </div>
                        {#if memberStatus === 'IN_PROGRESS' && memberProgress}
                          <p class="text-[11px] text-on-surface-variant/40 font-mono pl-1">
                            Membres {memberProgress.scrapedCount}/{memberProgress.totalCount}
                          </p>
                        {/if}
                        {#if status === 'IN_PROGRESS' && progress}
                          <p class="text-[11px] text-on-surface-variant/40 font-mono pl-1">
                            Historique {progress.scrapedChannelsCount}/{progress.totalChannelsCount} ch · {progress.scrapedMessagesCount.toLocaleString()} msgs
                          </p>
                        {:else if status === 'COMPLETED' && guild.statsConfig?.historicalScrapedMessages}
                          <p class="text-[11px] text-on-surface-variant/30 font-mono pl-1">
                            {guild.statsConfig.historicalScrapedMessages.toLocaleString()} msgs
                          </p>
                        {/if}
                        {#if syncRunning}
                          <p class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                            <span class="animate-spin"><Papicon icon="refresh" size={11} /></span>
                            {guild.statsConfig?.fullSyncStage === 'HISTORY' || status === 'IN_PROGRESS' ? "Synchronisation de l'historique…" : 'Synchronisation des membres…'}
                          </p>
                        {:else}
                          <div class="flex flex-wrap gap-1">
                            <button
                              onclick={() => handleRescanStats(guild.id)}
                              class="text-[11px] font-semibold text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 px-2 py-0.5 rounded cursor-pointer transition-all"
                            >Reprendre l’historique</button>
                            <button
                              onclick={() => handleResyncAll(guild.id, guild.name)}
                              class="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 px-2 py-0.5 rounded cursor-pointer transition-all"
                            >Tout synchroniser</button>
                          </div>
                        {/if}
                      </div>
                    {:else}
                      <span class="text-on-surface-variant/20 text-xs">-</span>
                    {/if}
                  </td>

                  <!-- Join date -->
                  <td class="px-5 py-4">
                    <span class="text-xs text-on-surface-variant/50 font-medium">{new Date(guild.joinedAt).toLocaleDateString('fr-FR')}</span>
                  </td>

                  <!-- Actions -->
                  <td class="px-5 py-4">
                    <div class="flex items-center justify-end gap-1">
                      {#if guild.serverTemplateAppliedAt}
                        <button
                          onclick={() => handleResetServerTemplate(guild)}
                          title={serverTemplateLabel(guild)}
                          class="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/40 hover:bg-indigo-500/10 hover:text-indigo-400 transition-all"
                        >
                          <Papicon icon="RotateCcw" size={14} />
                        </button>
                      {/if}
                      {#if guild.activated}
                        <button
                          onclick={() => handleDeactivateGuild(guild.id, guild.name)}
                          title="Désactiver"
                          class="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/40 hover:bg-amber-500/10 hover:text-amber-400 transition-all"
                        >
                          <Papicon icon="Unlock" size={14} />
                        </button>
                      {/if}
                      <button
                        onclick={() => handleGetInvite(guild.id)}
                        title="Invitation"
                        class="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/40 hover:bg-primary/10 hover:text-primary transition-all"
                      >
                        <Papicon icon="ExternalLink" size={14} />
                      </button>
                      <button
                        onclick={() => handleLeaveGuild(guild.id, guild.name)}
                        title="Faire quitter"
                        class="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/40 hover:bg-error/10 hover:text-error transition-all"
                      >
                        <Papicon icon="LogOut" size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}

              {#if filteredGuilds.length === 0}
                <tr>
                  <td colspan="6" class="px-5 py-12 text-center">
                    <p class="text-sm text-on-surface-variant/40 font-medium">Aucun serveur trouvé</p>
                  </td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
</AdminLayout>
