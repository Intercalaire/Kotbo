<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from 'tinro';
  import { authStore } from '../lib/stores/auth.svelte';
  import { API_BASE_URL } from '../lib/api';
  import Papicon from '../lib/components/Papicon.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';

  const { formId }: { formId: string } = $props();

  interface Candidature {
    id: string;
    discordId: string | null;
    username: string | null;
    email: string | null;
    status: 'PENDING'|'ORAL'|'APPROVED'|'REJECTED'|'AUTO_REJECTED';
    data: Record<string, unknown>;
    createdAt: string;
  }

  interface FormInfo { id: string; name: string; submissionsCount: number; structure?: { fields?: { id: string; label: string }[] }; }

  let form = $state<FormInfo | null>(null);
  let responses = $state<Candidature[]>([]);
  let responseTotal = $state(0);
  let loadingMore = $state(false);
  let loading = $state(true);
  let error = $state('');
  let selectedResponse = $state<Candidature | null>(null);
  let searchQuery = $state('');
  let statusFilter = $state('ALL');

  const STATUS_LABELS: Record<string, string> = {
    PENDING: 'En attente', ORAL: 'Entretien', APPROVED: 'Accepté',
    REJECTED: 'Refusé', AUTO_REJECTED: 'Refusé (auto)',
  };
  const STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-amber-500/15 text-amber-600',
    ORAL: 'bg-blue-500/15 text-blue-600',
    APPROVED: 'bg-emerald-500/15 text-emerald-600',
    REJECTED: 'bg-rose-500/15 text-rose-600',
    AUTO_REJECTED: 'bg-rose-500/10 text-rose-500',
  };

  const fieldLabelMap = $derived<Record<string, string>>(
    Object.fromEntries((form?.structure?.fields || []).map((f) => [f.id, f.label]))
  );

  const filtered = $derived(responses.filter(r => {
    const matchesStatus = statusFilter === 'ALL' || r.status === statusFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      r.discordId?.includes(q) ||
      r.username?.toLowerCase().includes(q) ||
      r.email?.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  }));

  onMount(async () => {
    if (!authStore.selectedGuildId) return;
    try {
      const requestHeaders = { Authorization: `Bearer ${authStore.token}` };
      const [fRes, rRes] = await Promise.all([
        fetch(
          `${API_BASE_URL}/api/dashboard/guilds/${authStore.selectedGuildId}/recruitment/forms/${formId}`,
          { headers: requestHeaders },
        ),
        fetch(
          `${API_BASE_URL}/api/dashboard/guilds/${authStore.selectedGuildId}/recruitment/forms/${formId}/responses?limit=100`,
          { headers: requestHeaders },
        ),
      ]);
      if (fRes.ok) {
        const data = await fRes.json();
        form = data.form;
      }

      if (!rRes.ok) throw new Error('Impossible de charger les réponses');
      const rData = await rRes.json();
      responses = rData.responses || [];
      responseTotal = rData.total ?? responses.length;
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Erreur inconnue';
    } finally {
      loading = false;
    }
  });

  async function loadMore() {
    if (!authStore.selectedGuildId || loadingMore || responses.length >= responseTotal) return;
    loadingMore = true;
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/dashboard/guilds/${authStore.selectedGuildId}/recruitment/forms/${formId}/responses?limit=100&offset=${responses.length}`,
        { headers: { Authorization: `Bearer ${authStore.token}` } },
      );
      if (!res.ok) throw new Error('Impossible de charger les réponses suivantes');
      const data = await res.json();
      responses = [...responses, ...(data.responses || [])];
      responseTotal = data.total ?? responseTotal;
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Erreur de chargement';
    } finally {
      loadingMore = false;
    }
  }

  function exportCsv() {
    if (!responses.length) return;
    // Collect all field keys
    const allKeys = new Set<string>();
    responses.forEach(r => Object.keys(r.data || {}).forEach(k => allKeys.add(k)));
    const keys = ['id', 'discordId', 'username', 'email', 'status', 'createdAt', ...allKeys];

    const header = keys.join(',');
    const rows = filtered.map(r =>
      keys.map(k => {
        const val = k in r ? (r as any)[k] : (r.data || {})[k];
        const str = Array.isArray(val) ? val.join('; ') : (val ?? '');
        return `"${String(str).replace(/"/g, '""')}"`;
      }).join(',')
    );

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `responses-${formId}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
</script>

<ModulePage
  title={form ? `Réponses - ${form.name}` : 'Réponses au formulaire'}
  description="Consultez et exportez toutes les réponses soumises."
  icon="assignment_turned_in"
  featureKey="recruitment"
>
  <div class="space-y-5">

    <!-- Top bar -->
    <div class="flex flex-wrap items-center gap-3">
      <button onclick={() => router.goto('/recruitment-forms')}
        class="flex items-center gap-2 text-sm font-semibold text-on-surface-variant/60 hover:text-primary transition-colors">
        <Papicon icon="arrow_back" size={16} />
        Retour aux formulaires
      </button>
      <div class="flex-1"></div>
      {#if form}
        <span class="text-xs font-semibold text-on-surface-variant/50 bg-surface-container px-3 py-1.5 rounded-full">
          {form.submissionsCount} soumission{form.submissionsCount !== 1 ? 's' : ''}
        </span>
      {/if}
      {#if responses.length < responseTotal}
        <button onclick={loadMore} disabled={loadingMore}
          class="px-3 py-1.5 rounded-xl bg-surface-container text-xs font-bold disabled:opacity-50">
          {loadingMore ? 'Chargement…' : `Charger plus (${responses.length}/${responseTotal})`}
        </button>
      {/if}
      <button onclick={exportCsv}
        class="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-sm font-bold transition-colors">
        <Papicon icon="download" size={16} />
        Export CSV
      </button>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap gap-3">
      <div class="relative flex-1 min-w-48">
        <Papicon icon="search" size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
        <input bind:value={searchQuery} placeholder="Rechercher par ID, nom, email…"
          class="w-full bg-surface-container rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 ring-primary/20 transition-all" />
      </div>
      <select bind:value={statusFilter}
        class="bg-surface-container rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 ring-primary/20 transition-all cursor-pointer">
        <option value="ALL">Tous les statuts</option>
        {#each Object.entries(STATUS_LABELS) as [val, label]}
          <option value={val}>{label}</option>
        {/each}
      </select>
    </div>

    <!-- Table -->
    {#if loading}
      <div class="flex items-center justify-center py-20">
        <div class="w-10 h-10 border-3 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    {:else if error}
      <div class="rounded-lg bg-rose-500/10 border border-rose-500/20 p-5 text-rose-600 text-sm">{error}</div>
    {:else if filtered.length === 0}
      <div class="rounded-lg border-2 border-dashed border-outline-variant/20 p-16 text-center text-on-surface-variant/40">
        <Papicon icon="inbox" size={48} class="mb-3" />
        <p class="text-sm">Aucune réponse trouvée</p>
      </div>
    {:else}
      <div class="rounded-lg border border-outline-variant/20 overflow-hidden shadow-sm">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-surface-container-low/60 border-b border-outline-variant/10">
              <th class="text-left px-5 py-3 font-bold text-on-surface-variant/60 text-xs uppercase tracking-wide">ID</th>
              <th class="text-left px-5 py-3 font-bold text-on-surface-variant/60 text-xs uppercase tracking-wide">Candidat</th>
              <th class="text-left px-5 py-3 font-bold text-on-surface-variant/60 text-xs uppercase tracking-wide">Statut</th>
              <th class="text-left px-5 py-3 font-bold text-on-surface-variant/60 text-xs uppercase tracking-wide">Date</th>
              <th class="text-left px-5 py-3 font-bold text-on-surface-variant/60 text-xs uppercase tracking-wide"></th>
            </tr>
          </thead>
          <tbody>
            {#each filtered as r}
              <tr class="border-b border-outline-variant/5 hover:bg-surface-container-low/40 transition-colors cursor-pointer"
                onclick={() => selectedResponse = r}>
                <td class="px-5 py-3 font-mono text-xs text-on-surface-variant/50">{r.id.slice(0,8)}…</td>
                <td class="px-5 py-3">
                  {#if r.username}
                    <span class="font-semibold text-on-surface">{r.username}</span>
                    {#if r.discordId}<span class="text-xs text-on-surface-variant/40 ml-1">({r.discordId})</span>{/if}
                  {:else if r.discordId}
                    <span class="font-semibold text-on-surface">{r.discordId}</span>
                  {:else if r.email}
                    <span class="text-on-surface">{r.email}</span>
                  {:else}
                    <span class="text-on-surface-variant/30 italic">Anonyme</span>
                  {/if}
                </td>
                <td class="px-5 py-3">
                  <span class="px-2.5 py-1 rounded-full text-xs font-bold {STATUS_COLORS[r.status] || ''}">
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                </td>
                <td class="px-5 py-3 text-xs text-on-surface-variant/50">{formatDate(r.createdAt)}</td>
                <td class="px-5 py-3">
                  <Papicon icon="chevron_right" size={16} class="text-on-surface-variant/30" />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <p class="text-xs text-on-surface-variant/40 text-right">{filtered.length} résultat{filtered.length !== 1 ? 's' : ''}</p>
    {/if}
  </div>
</ModulePage>

<!-- Detail modal -->
{#if selectedResponse}
  <div class="fixed inset-0 z-55 flex items-center justify-center p-4"
    role="dialog" aria-modal="true" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') selectedResponse = null; }}>
    <!-- Backdrop -->
    <button
      type="button"
      class="absolute inset-0 bg-black/40 border-none cursor-default w-full h-full text-left p-0"
      onclick={() => selectedResponse = null}
      aria-label="Fermer"
    ></button>

    <!-- Detail panel -->
    <div class="relative z-10 bg-surface rounded-xl shadow-sm max-w-lg w-full max-h-[80vh] overflow-y-auto">
      <div class="sticky top-0 bg-surface border-b border-outline-variant/10 px-6 py-4 flex items-start justify-between rounded-t-3xl">
        <div>
          <h2 class="font-semibold text-on-surface text-lg">Réponse détaillée</h2>
          <p class="text-xs font-mono text-on-surface-variant/40 mt-0.5">{selectedResponse.id}</p>
        </div>
        <button onclick={() => selectedResponse = null}
          class="p-2 rounded-xl hover:bg-surface-container transition-colors">
          <Papicon icon="close" size={18} />
        </button>
      </div>

      <div class="p-6 space-y-4">
        <!-- Metadata -->
        <div class="grid grid-cols-2 gap-3 text-sm">
          {#if selectedResponse.discordId}
            <div class="bg-surface-container rounded-xl p-3">
              <p class="text-xs text-on-surface-variant/50 font-semibold mb-1">Discord ID</p>
              <p class="font-mono text-on-surface">{selectedResponse.discordId}</p>
            </div>
          {/if}
          {#if selectedResponse.username}
            <div class="bg-surface-container rounded-xl p-3">
              <p class="text-xs text-on-surface-variant/50 font-semibold mb-1">Nom</p>
              <p class="text-on-surface">{selectedResponse.username}</p>
            </div>
          {/if}
          {#if selectedResponse.email}
            <div class="bg-surface-container rounded-xl p-3">
              <p class="text-xs text-on-surface-variant/50 font-semibold mb-1">Email</p>
              <p class="text-on-surface">{selectedResponse.email}</p>
            </div>
          {/if}
          <div class="bg-surface-container rounded-xl p-3">
            <p class="text-xs text-on-surface-variant/50 font-semibold mb-1">Statut</p>
            <span class="px-2 py-0.5 rounded-full text-xs font-bold {STATUS_COLORS[selectedResponse.status] || ''}">
              {STATUS_LABELS[selectedResponse.status] || selectedResponse.status}
            </span>
          </div>
          <div class="bg-surface-container rounded-xl p-3">
            <p class="text-xs text-on-surface-variant/50 font-semibold mb-1">Date</p>
            <p class="text-xs text-on-surface">{formatDate(selectedResponse.createdAt)}</p>
          </div>
        </div>

        <!-- Answers -->
        <div>
          <h3 class="text-sm font-semibold text-on-surface-variant/60 uppercase tracking-wide mb-3">Réponses</h3>
          <div class="space-y-3">
            {#each Object.entries(selectedResponse.data || {}) as [key, value]}
              <div class="bg-surface-container/60 rounded-xl p-3">
                <p class="text-xs font-bold text-on-surface-variant/50 mb-1">{fieldLabelMap[key] || key}</p>
                <p class="text-sm text-on-surface">
                  {Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '-')}
                </p>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
