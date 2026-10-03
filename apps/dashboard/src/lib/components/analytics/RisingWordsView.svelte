<!--
  Mots en hausse : ceux qui prennent de la place dans les conversations par
  rapport à la période d'avant, les nouveaux venus, et ceux qui reculent.
  Comparés en part du total, pour qu'un serveur plus actif ne fasse pas tout
  monter d'un coup. Dépend du suivi des mots (option à part, anonyme).
-->
<script lang="ts">
  import { Callout, SectionCard } from '../ui';
  import AnalyticsSkeleton from './AnalyticsSkeleton.svelte';
  import { fetchRisingWords, type RisingWords, type WordTrend } from '../../api';
  import { m } from '../../i18n';
  import { analyticsLoader } from './analyticsLoader.svelte';
  import { analyticsFilters as filters } from './analyticsFilters.svelte';
  import { fmtDelta, fmtNumber } from './analyticsFormat';

  const loader = analyticsLoader(() => fetchRisingWords(filters.periodQuery), 'risingWords');
  const data = $derived(loader.data as RisingWords | null);
</script>

{#snippet column(title: string, description: string, words: WordTrend[], kind: 'up' | 'new' | 'down')}
  <SectionCard {title} {description}>
    {#if words.length === 0}
      <p class="py-4 text-body-sm text-on-surface-variant">{m.anx_words_none()}</p>
    {:else}
      <ol class="words">
        {#each words as w (w.word)}
          <li class="word">
            <span class="word__text">{w.word}</span>
            <span class="word__count">{fmtNumber(w.count)}</span>
            <span class="word__change {kind === 'down' ? 'text-error' : kind === 'up' ? 'text-success' : 'text-on-surface-variant'}">
              {kind === 'new' ? m.anx_words_new_badge() : fmtDelta(w.change, 'pct')}
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  </SectionCard>
{/snippet}

{#if loader.loading && !data}
  <AnalyticsSkeleton />
{:else if loader.error && !data}
  <Callout variant="danger" title={m.an_error_generic()}>{loader.error}</Callout>
{:else if data}
  {#if !data.hasData}
    <Callout variant="info">{data.enabled ? m.anx_words_no_data() : m.anx_words_disabled()}</Callout>
  {:else}
    <div class="words-grid" class:opacity-60={loader.loading}>
      {@render column(m.anx_words_rising(), m.anx_words_rising_desc(), data.rising, 'up')}
      {@render column(m.anx_words_fresh(), m.anx_words_fresh_desc(), data.fresh, 'new')}
      {@render column(m.anx_words_falling(), m.anx_words_falling_desc(), data.falling, 'down')}
    </div>
  {/if}
{/if}

<style>
  .words-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    align-items: start;
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    max-height: 24rem;
    overflow-y: auto;
  }

  .word {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.3125rem 0.25rem;
    border-bottom: 1px solid var(--color-outline-variant);
    font-size: 0.875rem;
  }

  .word__text {
    flex: 1;
    min-width: 0;
    color: var(--color-on-surface);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .word__count {
    font-variant-numeric: tabular-nums;
    color: var(--color-on-surface-variant);
  }

  .word__change {
    min-width: 3.75rem;
    text-align: right;
    font-size: 0.75rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
</style>
