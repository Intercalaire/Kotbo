<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from 'tinro';
  import { resolveTabFromUrl, gotoTab } from '../lib/tabRouting';
  import { fetchMarketplaceData } from '../lib/api';
  import { toast } from '../lib/stores/toast.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import { m } from '../lib/i18n';

  let loading = $state(true);
  let data: any = $state(null);
  const marketTabs = ['listings', 'history'] as const;
  let tab = $state<'listings' | 'history'>('listings');

  $effect(() => {
    const _path = $router.path;
    tab = resolveTabFromUrl('/marketplace', marketTabs, 'listings') as typeof tab;
  });

  async function load() {
    loading = true;
    try {
      data = await fetchMarketplaceData();
    } catch {
      toast.error(m.mar_load_error());
    } finally {
      loading = false;
    }
  }

  function getStatusClass(status: string): string {
    const map: Record<string, string> = {
      ACTIVE: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/15',
      SOLD: 'bg-primary/10 text-primary border border-primary/15',
      CANCELLED: 'bg-surface-container-high/40 text-on-surface-variant border border-outline-variant/10',
      EXPIRED: 'bg-amber-500/10 text-amber-500 border border-amber-500/15',
    };
    return map[status] ?? '';
  }

  function getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      ACTIVE: m.mar_status_active(),
      SOLD: m.mar_status_sold(),
      CANCELLED: m.mar_status_cancelled(),
      EXPIRED: m.mar_status_expired()
    };
    return map[status] ?? status;
  }

  function getTypeLabel(type: string): string {
    return type === 'AUCTION' ? m.mar_type_auction() : m.mar_type_buy_now();
  }

  function formatTimeLeft(expiresAt: string): string {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return m.mar_expired();
    const hours = Math.floor(diff / 3600000);
    if (hours > 24) return m.mar_days_left({ days: Math.floor(hours / 24) });
    return m.mar_hours_left({ hours });
  }

  onMount(load);
</script>

<ModulePage
  title={m.mar_page_title()}
  description={m.mar_page_desc()}
  icon="shopping-bag"
  featureKey="marketplace"
>

<!-- ======================== CONTENT ======================== -->
{#if loading}
  <div class="flex flex-col items-center justify-center py-16 text-on-surface-variant/50 gap-4">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    <p class="text-sm">{m.mar_loading()}</p>
  </div>
{:else if data}
  <!-- ======================== STATS ROW ======================== -->
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
    <div class="bg-surface-container-low/30 border border-outline-variant/10 rounded-xl p-4 flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-500/10 text-emerald-500">
        <Papicon icon="shopping-bag" size={20} />
      </div>
      <div class="flex flex-col">
        <span class="text-2xl font-bold">{data.activeListings.length}</span>
        <span class="text-xs font-medium text-on-surface-variant/60 mt-0.5">{m.mar_active_listings_stat()}</span>
      </div>
    </div>
    <div class="bg-surface-container-low/30 border border-outline-variant/10 rounded-xl p-4 flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 text-primary">
        <Papicon icon="trending-up" size={20} />
      </div>
      <div class="flex flex-col">
        <span class="text-2xl font-bold">{data.totalTransactions}</span>
        <span class="text-xs font-medium text-on-surface-variant/60 mt-0.5">{m.mar_total_tx_stat()}</span>
      </div>
    </div>
    <div class="bg-surface-container-low/30 border border-outline-variant/10 rounded-xl p-4 flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-500/10 text-amber-500">
        <Papicon icon="dollar-sign" size={20} />
      </div>
      <div class="flex flex-col">
        <span class="text-2xl font-bold">{data.totalVolume.toLocaleString()}</span>
        <span class="text-xs font-medium text-on-surface-variant/60 mt-0.5">{m.mar_total_volume_stat()}</span>
      </div>
    </div>
  </div>

  <!-- ======================== TABS ======================== -->
  <div class="tab-group w-fit">
    <button
      class="px-5 py-2.5 rounded-xl text-[13px] font-medium transition-all flex items-center gap-1.5 {tab === 'listings' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/30'}"
      onclick={() => gotoTab('/marketplace', 'listings', 'listings')}
    >
      <Papicon icon="grid" size={14} />
      {m.mar_tab_listings({ count: data.activeListings.length })}
    </button>
    <button
      class="px-5 py-2.5 rounded-xl text-[13px] font-medium transition-all flex items-center gap-1.5 {tab === 'history' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/30'}"
      onclick={() => gotoTab('/marketplace', 'history', 'listings')}
    >
      <Papicon icon="clock" size={14} />
      {m.mar_tab_history({ count: data.recentTransactions.length })}
    </button>
  </div>

  <!-- ======================== TAB: LISTINGS ======================== -->
  {#if tab === 'listings'}
    {#if data.activeListings.length === 0}
      <div class="flex flex-col items-center justify-center py-16 text-on-surface-variant/50 gap-4">
        <Papicon icon="shopping-bag" size={48} />
        <p class="text-sm">{m.mar_empty_listings_title()}</p>
        <p class="text-xs text-on-surface-variant/40">{m.mar_empty_listings_desc()}</p>
      </div>
    {:else}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {#each data.activeListings as listing}
          <div class="bg-surface-container-low/30 border border-outline-variant/10 rounded-xl p-5 space-y-3 hover:border-primary/30 transition-colors">
            <!-- Top: name + status badge -->
            <div class="flex justify-between items-center">
              <h4 class="text-sm font-semibold text-on-surface">{listing.itemId}</h4>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-medium {getStatusClass(listing.status)}">{getStatusLabel(listing.status)}</span>
            </div>

            <!-- Price row -->
            <div class="flex justify-between items-center">
              <span class="flex items-center gap-1.5 text-base font-bold text-amber-500">
                <Papicon icon="dollar-sign" size={14} />
                {m.mar_price_coins({ price: listing.price.toLocaleString() })}
              </span>
              <span class="text-xs text-on-surface-variant/60 font-medium">x{listing.quantity}</span>
            </div>

            <!-- Auction bid -->
            {#if listing.type === 'AUCTION' && listing.currentBid}
              <div class="flex items-center gap-1.5 text-xs text-primary font-medium">
                <Papicon icon="trending-up" size={13} />
                {m.mar_current_bid({ amount: listing.currentBid.toLocaleString() })}
              </div>
            {/if}

            <!-- Meta: type + time left -->
            <div class="flex items-center gap-3">
              <span class="px-2 py-0.5 rounded-lg text-xs font-medium bg-surface-container-high/40 text-on-surface-variant">{getTypeLabel(listing.type)}</span>
              <span class="flex items-center gap-1 text-xs text-on-surface-variant/60">
                <Papicon icon="clock" size={12} />
                {formatTimeLeft(listing.expiresAt)}
              </span>
            </div>

            <!-- Footer: seller -->
            <div class="pt-3 border-t border-outline-variant/10">
              <span class="flex items-center gap-1.5 font-mono text-xs text-on-surface-variant/60">
                <Papicon icon="user" size={12} />
                {listing.sellerId}
              </span>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  <!-- ======================== TAB: HISTORY ======================== -->
  {:else}
    {#if data.recentTransactions.length === 0}
      <div class="flex flex-col items-center justify-center py-16 text-on-surface-variant/50 gap-4">
        <Papicon icon="clock" size={48} />
        <p class="text-sm">{m.mar_empty_history_title()}</p>
        <p class="text-xs text-on-surface-variant/40">{m.mar_empty_history_desc()}</p>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each data.recentTransactions as tx}
          <div class="bg-surface-container-low/30 border border-outline-variant/10 rounded-xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <!-- Item info -->
            <div class="flex items-baseline gap-2 min-w-30">
              <span class="text-sm font-semibold text-on-surface">{tx.itemId}</span>
              <span class="text-xs text-on-surface-variant/60">x{tx.quantity}</span>
            </div>

            <!-- Flow: seller -> buyer -->
            <div class="flex items-center gap-2 flex-1">
              <div class="flex items-center gap-1.5">
                <Papicon icon="user" size={13} />
                <span class="font-mono text-xs text-on-surface-variant">{tx.sellerId}</span>
              </div>
              <div class="text-primary flex items-center">
                <Papicon icon="arrow-right" size={16} />
              </div>
              <div class="flex items-center gap-1.5">
                <Papicon icon="user" size={13} />
                <span class="font-mono text-xs text-on-surface-variant">{tx.buyerId}</span>
              </div>
            </div>

            <!-- Price + date -->
            <div class="flex flex-col items-end gap-0.5 shrink-0">
              <span class="flex items-center gap-1 text-sm font-semibold text-amber-500">
                <Papicon icon="dollar-sign" size={13} />
                {m.mar_price_coins({ price: tx.price.toLocaleString() })}
              </span>
              <span class="text-[10px] text-on-surface-variant/60">{new Date(tx.createdAt).toLocaleDateString('fr-FR')}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
{/if}
</ModulePage>
