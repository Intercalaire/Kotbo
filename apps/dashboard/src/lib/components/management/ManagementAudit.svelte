<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import { m } from '../../i18n';

  const { auditLogs = [] } = $props();
  let searchQuery = $state('');
  let moduleFilter = $state('');

  const modules = $derived([...new Set(auditLogs.map((l: any) => l.module).filter(Boolean))]);
  const filtered = $derived(
    auditLogs.filter((log: any) => {
      if (moduleFilter && log.module !== moduleFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (log.user?.toLowerCase().includes(q) || log.action?.toLowerCase().includes(q) || log.details?.toLowerCase().includes(q));
      }
      return true;
    }).slice(0, 100)
  );
</script>

<div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6 animate-in fade-in duration-500">
  <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
    <div>
      <h3 class="text-2xl font-semibold">Journal d'Audit</h3>
      <p class="text-xs text-on-surface-variant/50 mt-1">Historique de toutes les modifications de configuration.</p>
    </div>
    <div class="flex items-center gap-3">
      <div class="relative">
        <input
          type="text"
          placeholder="Rechercher..."
          bind:value={searchQuery}
          class="bg-surface-container-high/40 border border-outline-variant/10 rounded-xl px-4 py-2.5 pl-9 text-xs w-48 focus:ring-2 focus:ring-primary/30 transition-all"
        />
        <Papicon icon="MagnifyingGlass" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
      </div>
      <select
        bind:value={moduleFilter}
        class="bg-surface-container-high/40 border border-outline-variant/10 rounded-xl px-3 py-2.5 text-xs"
      >
        <option value="">Tous les modules</option>
        {#each modules as mod}<option value={mod}>{mod}</option>{/each}
      </select>
    </div>
  </div>

  <div class="overflow-hidden rounded-lg border border-outline-variant/5">
    <table class="w-full text-left border-collapse">
      <thead class="bg-surface-container-high/40 text-xs font-medium text-on-surface-variant/60">
        <tr>
          <th class="px-5 py-3.5">Date</th>
          <th class="px-5 py-3.5">Utilisateur</th>
          <th class="px-5 py-3.5">Module</th>
          <th class="px-5 py-3.5">Action</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/5">
        {#each filtered as log}
          <tr class="hover:bg-surface-container-high/20 transition-colors text-sm">
            <td class="px-5 py-3.5 text-on-surface-variant/60 text-xs">{new Date(log.dateIso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
            <td class="px-5 py-3.5 font-bold text-xs">{log.user}</td>
            <td class="px-5 py-3.5"><span class="px-2 py-1 bg-surface-container-high rounded text-[10px] font-semibold uppercase">{log.module}</span></td>
            <td class="px-5 py-3.5 text-xs">{log.action}</td>
          </tr>
        {:else}
          <tr><td colspan="4" class="px-6 py-12 text-center text-on-surface-variant/40 italic">{m.maud_no_events()}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
