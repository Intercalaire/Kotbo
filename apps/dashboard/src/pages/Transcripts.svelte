<script lang="ts">
  import { onMount } from 'svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { router } from 'tinro';
  import {
    fetchTranscripts,
    deleteTranscript,
    type TranscriptSummary,
  } from '../lib/api';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import RefreshButton from '../lib/components/RefreshButton.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import { m, dateLocale } from '../lib/i18n';

  const PAGE_SIZE = 30;

  let transcripts = $state<TranscriptSummary[]>([]);
  let total = $state(0);
  let offset = $state(0);
  let loading = $state(true);
  let loadingMore = $state(false);
  let query = $state('');
  let pendingDeleteId = $state<string | null>(null);

  const isAdmin = $derived(dashboardStore.state.access?.canManageSettings === true);

  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  async function load(reset = true) {
    if (reset) {
      loading = true;
      offset = 0;
    } else {
      loadingMore = true;
    }
    try {
      const res = await fetchTranscripts({
        q: query.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
        includeTotal: reset,
      });
      if (reset && res.total != null) total = res.total;
      transcripts = reset ? res.transcripts : [...transcripts, ...res.transcripts];
    } catch {
      if (reset) transcripts = [];
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  function onSearchInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(true), 300);
  }

  async function loadMore() {
    offset += PAGE_SIZE;
    await load(false);
  }

  /**
   * La liste renvoie vers la page transcript du dashboard, pas vers l'URL
   * signee de l'API : celle-ci reste un detail interne, consomme uniquement
   * par l'iframe de cette page apres verification des droits.
   */
  function openTranscript(t: TranscriptSummary) {
    router.goto(`/transcripts/${t.id}`);
  }

  async function confirmDelete(id: string) {
    const ok = await deleteTranscript(id);
    if (ok) {
      transcripts = transcripts.filter((t) => t.id !== id);
      total = Math.max(0, total - 1);
      pendingDeleteId = null;
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(dateLocale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  onMount(() => load(true));
</script>

<ModulePage
  title={m.ts_page_title()}
  description={m.ts_page_desc()}
  icon="file"
  featureKey=""
>
  {#snippet actions()}
    <RefreshButton onClick={() => load(true)} />
  {/snippet}

  {#snippet children()}
    <div class="flex flex-col gap-6">
      <!-- Search bar -->
      <div class="flex items-center gap-3">
        <div class="relative flex-1">
          <div class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50">
            <Papicon icon="search" size={18} />
          </div>
          <input
            type="text"
            bind:value={query}
            oninput={onSearchInput}
            placeholder={m.ts_search_placeholder()}
            class="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary/60 transition-colors"
          />
        </div>
        <p class="text-sm text-on-surface-variant/70 whitespace-nowrap">{m.ts_count({ count: total })}</p>
      </div>

      {#if loading}
        <div class="flex items-center justify-center py-16">
          <div class="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full"></div>
        </div>
      {:else if transcripts.length === 0}
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="w-16 h-16 bg-surface-container-low rounded-2xl flex items-center justify-center mb-4">
            <Papicon icon="file" size={32} class="text-on-surface-variant/40" />
          </div>
          <h3 class="text-lg font-semibold text-on-surface mb-1">{m.ts_no_transcript_title()}</h3>
          <p class="text-sm text-on-surface-variant/60 max-w-sm">
            {query ? m.ts_empty_no_match() : m.ts_empty_default()}
          </p>
        </div>
      {:else}
        <div class="flex flex-col gap-2">
          {#each transcripts as t (t.id)}
            <div class="flex items-center gap-4 p-4 bg-surface-container-low/60 border border-outline-variant/20 rounded-lg hover:border-outline-variant/40 transition-colors">
              <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Papicon icon="hashtag" size={18} class="text-primary" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-on-surface truncate">#{t.channelName}</p>
                <p class="text-xs text-on-surface-variant/60">
                  {formatDate(t.createdAt)} · <span class="font-mono">{t.id}</span>
                </p>
              </div>

              {#if pendingDeleteId === t.id}
                <div class="flex items-center gap-2">
                  <span class="text-xs text-on-surface-variant">{m.ts_confirm_q()}</span>
                  <button
                    onclick={() => confirmDelete(t.id)}
                    class="px-3 py-1.5 text-xs font-medium bg-error text-white rounded-md hover:bg-error/90 transition-colors"
                  >{m.common_delete()}</button>
                  <button
                    onclick={() => (pendingDeleteId = null)}
                    class="px-3 py-1.5 text-xs font-medium bg-surface-container text-on-surface rounded-md hover:bg-surface-container-high transition-colors"
                  >{m.common_cancel()}</button>
                </div>
              {:else}
                <div class="flex items-center gap-2">
                  <button
                    onclick={() => openTranscript(t)}
                    class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
                  >
                    <Papicon icon="eye" size={14} />
                    {m.ts_open()}
                  </button>
                  {#if isAdmin}
                    <button
                      onclick={() => (pendingDeleteId = t.id)}
                      class="flex items-center justify-center w-8 h-8 text-on-surface-variant hover:text-error hover:bg-error/10 rounded-md transition-colors"
                      title={m.ts_delete_title()}
                      aria-label={m.ts_delete_aria()}
                    >
                      <Papicon icon="trash" size={15} />
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>

        {#if transcripts.length < total}
          <div class="flex justify-center">
            <button
              onclick={loadMore}
              disabled={loadingMore}
              class="px-4 py-2 text-sm font-medium bg-surface-container-low border border-outline-variant/30 text-on-surface rounded-lg hover:bg-surface-container transition-colors disabled:opacity-50"
            >
              {loadingMore ? m.common_loading() : m.ts_load_more()}
            </button>
          </div>
        {/if}
      {/if}
    </div>
  {/snippet}
</ModulePage>
