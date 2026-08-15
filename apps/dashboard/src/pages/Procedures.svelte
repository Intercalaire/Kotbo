<script lang="ts">
  import { onMount } from 'svelte';
  import { authStore } from '../lib/stores/auth.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import { fetchProcedures, upsertProcedure, deleteProcedure, markProcedureRead } from '../lib/api';
  import Papicon from '../lib/components/Papicon.svelte';

  let procedures = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  
  let selectedProcedure = $state<any>(null);
  let showEditModal = $state(false);
  let editingProcedure = $state<any>({ title: '', content: '', sortOrder: 0 });

  const isAdmin = $derived(
    authStore.guilds.find((g) => g.id === authStore.selectedGuildId)?.accessLevel === 'admin'
  );

  async function loadData() {
    loading = true;
    try {
      procedures = await fetchProcedures();
      if (procedures.length > 0 && !selectedProcedure) {
        selectedProcedure = procedures[0];
      }
    } catch (err) {
      error = 'Erreur lors du chargement des procédures';
    } finally {
      loading = false;
    }
  }

  onMount(loadData);

  function isRead(proc: any) {
    return proc.reads?.some((r: any) => r.staffUserId === authStore.user?.id);
  }

  async function handleMarkAsRead() {
    if (!selectedProcedure) return;
    try {
      await markProcedureRead(selectedProcedure.id);
      await loadData();
      selectedProcedure = procedures.find(p => p.id === selectedProcedure.id);
    } catch (err) {
      toast.error('Erreur lors du marquage comme lu');
    }
  }

  async function handleSave() {
    try {
      await upsertProcedure(editingProcedure.id, editingProcedure.title, editingProcedure.content, editingProcedure.sortOrder);
      showEditModal = false;
      await loadData();
    } catch (err) {
      toast.error('Erreur lors de la sauvegarde');
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirmDialog.danger('Supprimer cette procédure ?'))) return;
    try {
      await deleteProcedure(id);
      await loadData();
      if (selectedProcedure?.id === id) selectedProcedure = procedures[0] || null;
    } catch (err) {
      toast.error('Erreur lors de la suppression');
    }
  }

  function openCreate() {
    editingProcedure = { title: '', content: '', sortOrder: procedures.length };
    showEditModal = true;
  }

  function openEdit(proc: any) {
    editingProcedure = { ...proc };
    showEditModal = true;
  }

  const readCount = $derived(procedures.filter(isRead).length);
  const totalCount = $derived(procedures.length);
  const progressPercent = $derived(totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0);
</script>

<div class="h-[calc(100vh-8rem)] flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
  <!-- Header -->
  <div class="rounded-xl border border-outline-variant/20 bg-linear-to-br from-surface-container/90 to-surface-container-low/80 p-5 shrink-0">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div class="flex items-center gap-4">
        <div class="bg-primary/10 p-2 rounded-xl text-primary">
          <Papicon icon="file-text" size={20} />
        </div>
        <div>
          <span class="text-xs font-medium text-primary">Manuel des Procédures</span>
          <h1 class="text-lg font-semibold tracking-tight text-on-surface">Guide Interne Staff</h1>
          <p class="text-sm font-medium text-on-surface-variant/70">Consultez et validez les étapes clés de nos protocoles de modération.</p>
        </div>
      </div>

      <div class="flex items-center gap-4">
        <div class="flex flex-col items-end gap-1">
          <span class="text-xs font-medium text-on-surface-variant/50">Progression</span>
          <div class="flex items-center gap-2">
             <div class="w-24 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                <div class="h-full bg-primary transition-all duration-1000" style="width: {progressPercent}%"></div>
             </div>
             <span class="text-xs font-semibold text-primary">{readCount}/{totalCount}</span>
          </div>
        </div>
        {#if isAdmin}
          <button onclick={openCreate} class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-medium text-white active:scale-[0.98] transition-all">
             <Papicon icon="plus" size={16} />
             Nouveau
          </button>
        {/if}
      </div>
    </div>
  </div>

  <div class="flex-1 flex gap-6 overflow-hidden min-h-0">
    <!-- Sidebar List -->
    <aside class="w-80 flex flex-col gap-3 overflow-y-auto pr-2 scrollbar-hide shrink-0">
      {#each procedures as proc}
         <div 
           role="button"
           tabindex="0"
           onclick={() => { selectedProcedure = proc }}
           onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedProcedure = proc } }}
           class="flex items-start gap-4 p-4 rounded-xl border transition-all text-left cursor-pointer group {selectedProcedure?.id === proc.id ? 'bg-primary border-primary text-white shadow-sm shadow-primary/20 ' : 'bg-surface-container-low border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high'}"
         >
           <div class="mt-1 rounded-full p-2 {selectedProcedure?.id === proc.id ? 'bg-white/20' : 'bg-primary/10 text-primary'}">
              <Papicon icon={isRead(proc) ? 'check' : 'file-text'} size={18} />
           </div>
           <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold tracking-tight line-clamp-1">{proc.title}</div>
              <div class="text-[10px] font-bold uppercase opacity-60 mt-0.5 tracking-wider">Ordre: {proc.sortOrder}</div>
           </div>
           {#if isAdmin}
              <button onclick={(e) => { e.stopPropagation(); openEdit(proc); }} class="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-white/20 rounded-lg transition-opacity">
                 <Papicon icon="settings" size={14} />
              </button>
           {/if}
         </div>
      {/each}
    </aside>

    <!-- Main Content -->
    <main class="flex-1 bg-surface-container-low/50 rounded-xl border border-outline-variant/20 overflow-hidden flex flex-col">
       {#if selectedProcedure}
          <div class="p-8 md:p-12 overflow-y-auto flex-1 scrollbar-hide">
             <div class="max-w-3xl mx-auto space-y-8">
                <div class="space-y-4">
                   <h2 class="text-lg font-semibold tracking-tighter text-on-surface leading-tight">{selectedProcedure.title}</h2>
                   <div class="flex items-center gap-4 text-xs font-bold text-on-surface-variant/40 uppercase tracking-widest">
                      <span>Dernière mise à jour: {new Date(selectedProcedure.updatedAt).toLocaleDateString('fr')}</span>
                      {#if isRead(selectedProcedure)}
                         <span class="flex items-center gap-1.5 text-emerald-500 bg-emerald-500/10 px-3 py-1 rounded-full">
                            <Papicon icon="check" size={12} />
                            Validé par vous
                         </span>
                      {/if}
                   </div>
                </div>

                <div class="prose prose-invert max-w-none text-on-surface-variant/90 leading-relaxed font-medium whitespace-pre-wrap">
                   {selectedProcedure.content}
                </div>
             </div>
          </div>
          
          <div class="p-6 border-t border-outline-variant/10 bg-surface-container/30 flex items-center justify-between">
             <div class="flex items-center gap-3">
                <div class="flex -space-x-2">
                   {#each (selectedProcedure.reads || []).slice(0, 5) as _read}
                      <div class="w-8 h-8 rounded-full border-2 border-surface bg-primary/20 flex items-center justify-center text-[10px] font-semibold" title="Lu">
                         ?
                      </div>
                   {/each}
                   {#if (selectedProcedure.reads?.length || 0) > 5}
                      <div class="w-8 h-8 rounded-full border-2 border-surface bg-surface-container-high flex items-center justify-center text-[10px] font-semibold">
                         +{(selectedProcedure.reads?.length || 0) - 5}
                      </div>
                   {/if}
                </div>
                <span class="text-xs font-bold text-on-surface-variant/50">{(selectedProcedure.reads?.length || 0)} lectures enregistrées</span>
             </div>

             {#if !isRead(selectedProcedure)}
                <button onclick={handleMarkAsRead} class="flex items-center gap-2 rounded-lg bg-emerald-600 px-8 py-4 text-sm font-semibold uppercase tracking-widest text-white shadow-sm shadow-emerald-500/20 hover: active:scale-95 transition-all">
                   J'ai lu et j'accepte
                   <Papicon icon="check" size={20} />
                </button>
             {:else}
                <div class="text-sm font-semibold text-emerald-500 flex items-center gap-2">
                   <Papicon icon="check-circle" size={20} />
                   PROCÉDURE VALIDÉE
                </div>
             {/if}
          </div>
       {:else}
          <div class="flex-1 flex flex-col items-center justify-center text-on-surface-variant/20">
             <Papicon icon="Grid" size={120} />
             <p class="mt-8 text-xl font-semibold uppercase tracking-wider">Sélectionnez une procédure</p>
          </div>
       {/if}
    </main>
  </div>
</div>

{#if showEditModal}
  <div class="fixed inset-0 z-100 flex items-center justify-center p-6 bg-black/40 animate-in fade-in duration-300">
    <div class="w-full max-w-2xl bg-surface-container rounded-xl border border-outline-variant/30 shadow-sm overflow-hidden p-8 space-y-6">
       <h3 class="text-2xl font-semibold tracking-tighter">Édition / Création</h3>
       <div class="space-y-4">
          <input bind:value={editingProcedure.title} placeholder="Titre de la procédure" class="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-5 py-4 text-sm outline-none focus:border-primary transition-all" />
          <textarea bind:value={editingProcedure.content} placeholder="Contenu (Markdown possible)..." rows="12" class="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-5 py-4 text-sm outline-none focus:border-primary transition-all resize-none"></textarea>
          <div class="flex items-center gap-4">
             <div class="flex-1 flex items-center gap-3">
                <span class="text-[13px] font-medium opacity-50">Ordre</span>
                <input type="number" bind:value={editingProcedure.sortOrder} class="w-20 bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-2 text-sm" />
             </div>
             {#if editingProcedure.id}
                <button onclick={() => { handleDelete(editingProcedure.id); showEditModal = false; }} class="text-rose-500 p-3 hover:bg-rose-500/10 rounded-xl transition-all">
                   <Papicon icon="trash" size={20} />
                </button>
             {/if}
          </div>
       </div>
       <div class="flex gap-4 pt-4">
          <button onclick={() => showEditModal = false} class="flex-1 py-4 text-sm font-semibold uppercase tracking-widest text-on-surface-variant/60 hover:bg-surface-container-high rounded-lg transition-all">Annuler</button>
          <button onclick={handleSave} class="flex-1 py-4 bg-primary text-white text-sm font-semibold uppercase tracking-widest rounded-lg shadow-sm shadow-primary/20 hover: transition-all">Sauvegarder</button>
       </div>
    </div>
  </div>
{/if}

<style>
  .scrollbar-hide::-webkit-scrollbar { display: none; }
  .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
</style>

