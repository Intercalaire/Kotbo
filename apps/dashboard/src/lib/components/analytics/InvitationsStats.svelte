<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import { inviteDetailsModal } from '../../stores/inviteDetailsModal.svelte';
  import Chart from '../charts/Chart.svelte';
  import { m, dateLocale } from '../../i18n';

  const { invitesData } = $props<{ 
    invitesData: any;
  }>();

  let showAllInvites = $state(false);
  const invites = $derived(invitesData || []);

  // Svelte 5: Avoid in-place mutation of derived state in template
  const sortedInvites = $derived([...invites].sort((a: any, b: any) => (b.uses || 0) - (a.uses || 0)));
  const displayedInvites = $derived(showAllInvites ? sortedInvites : sortedInvites.slice(0, 5));

  // Statistiques des invites
  const totalUses = $derived(invites.reduce((sum: number, inv: any) => sum + (inv.uses || 0), 0));
  const activeInvites = $derived(invites.filter((inv: any) => inv.uses > 0).length);
  const averageUses = $derived(invites.length > 0 ? Math.round(totalUses / invites.length) : 0);

  function chartForInvite(inv: any) {
    const labels = (inv?.trend?.labels) ? inv.trend.labels.map((d: string) => {
      const parts = d.split('-');
      return `${parts[2]}/${parts[1]}`; // DD/MM for small sparkline
    }) : [];

    const counts = inv?.trend?.counts ?? [];

    return {
      data: {
        labels,
        datasets: [
          {
            label: 'Joins',
            data: counts,
            borderColor: 'var(--color-emerald-500)',
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 0
          }
        ]
      },
      options: {
        scales: {
          x: { display: false },
          y: { display: false }
        },
        plugins: { tooltip: { enabled: true } },
        elements: { line: { borderWidth: 2 } }
      }
    };
  }
</script>

<div class="space-y-6">
  <!-- Invites Overview -->
  <div class="premium-card p-8 rounded-xl space-y-8">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <div class="bg-purple-500/10 p-3 rounded-lg text-purple-500">
          <Papicon icon="MailOpen" size={24} />
        </div>
        <div>
          <h3 class="text-xl font-semibold text-on-surface">{m.an_inv_codes_title()}</h3>
          <p class="text-xs font-bold text-on-surface-variant/40">{m.an_inv_codes_subtitle()}</p>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-4 gap-4">
      <div class="bg-surface-container-high/30 p-6 rounded-lg border border-outline-variant/5">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.an_inv_total_codes()}</p>
        <p class="text-lg font-semibold text-purple-500">{invites.length}</p>
      </div>
      <div class="bg-surface-container-high/30 p-6 rounded-lg border border-outline-variant/5">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.an_inv_active_codes()}</p>
        <p class="text-lg font-semibold text-cyan-500">{activeInvites}</p>
      </div>
      <div class="bg-surface-container-high/30 p-6 rounded-lg border border-outline-variant/5">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.an_inv_total_uses()}</p>
        <p class="text-lg font-semibold text-emerald-500">{totalUses}</p>
      </div>
      <div class="bg-surface-container-high/30 p-6 rounded-lg border border-outline-variant/5">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-2">{m.an_inv_avg_per_code()}</p>
        <p class="text-lg font-semibold text-orange-500">{averageUses}</p>
      </div>
    </div>
  </div>

  <!-- Top Invites -->
  <div class="premium-card p-8 rounded-xl space-y-6">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <div class="bg-emerald-500/10 p-3 rounded-lg text-emerald-500">
          <Papicon icon="Fire" size={24} />
        </div>
        <div>
          <h3 class="text-xl font-semibold text-on-surface">{m.an_inv_popular_title()}</h3>
          <p class="text-xs font-bold text-on-surface-variant/40">{m.an_inv_popular_subtitle()}</p>
        </div>
      </div>
      <button 
        onclick={() => showAllInvites = !showAllInvites}
        class="px-4 py-2 rounded-xl bg-surface-container-high/40 hover:bg-surface-container-high text-xs font-bold text-on-surface transition-colors flex items-center gap-2"
      >
        <Papicon icon={showAllInvites ? 'ArrowsIn' : 'ArrowsOut'} size={18} />
        {showAllInvites ? m.an_inv_collapse() : m.an_inv_see_more()}
      </button>
    </div>

    <div class="overflow-x-auto {showAllInvites ? 'max-h-125 overflow-y-auto custom-scrollbar pr-2' : ''}">
      <div class="space-y-2">
        {#each displayedInvites as invite}
          <div class="p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/5 hover:border-primary/20 transition-all">
            <!-- Toute la ligne ouvre la vue détaillée : le badge du code n'est
                 plus qu'un repère visuel, pas une seconde cible cliquable. -->
            <div
              class="flex items-center justify-between gap-4 cursor-pointer"
              role="button"
              tabindex="0"
              title={m.an_inv_open_view()}
              onclick={() => inviteDetailsModal.show(invite.code)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  inviteDetailsModal.show(invite.code);
                }
              }}
            >
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-sm font-semibold text-primary bg-primary/10 px-3 py-1 rounded-lg">
                    {invite.code}
                  </span>
                  {#if invite.uses > 0}
                    <span class="px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-[11px] font-semibold">
                      {m.an_inv_uses_badge({ count: invite.uses })}
                    </span>
                  {/if}
                </div>
                <p class="text-xs text-on-surface-variant/60">
                  {m.an_inv_created_expires({
                    author: invite.createdBy || m.an_inv_unknown_author(),
                    expiry: invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString(dateLocale()) : m.an_inv_never()
                  })}
                </p>
              </div>
              <div class="flex items-center gap-4">
                <div class="w-40">
                  <Chart data={chartForInvite(invite).data} options={chartForInvite(invite).options} height={60} />
                </div>
                <div class="text-right">
                  <p class="text-2xl font-semibold text-emerald-500">{invite.uses || 0}</p>
                  <p class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40">{m.an_inv_uses_label()}</p>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>

    {#if invites.length === 0}
      <div class="text-center py-10">
        <Papicon icon="MailOpen" size={40} class="text-on-surface-variant/20 mx-auto mb-3" />
        <p class="text-on-surface-variant/60 font-bold text-sm">{m.an_inv_empty()}</p>
      </div>
    {/if}
  </div>

  <!-- Inactive Codes -->
  {#if invites.filter((inv: any) => !inv.uses).length > 0}
    <div class="premium-card p-8 rounded-xl space-y-6">
      <div class="flex items-center gap-4">
        <div class="bg-orange-500/10 p-3 rounded-lg text-orange-500">
          <Papicon icon="Warning" size={24} />
        </div>
        <div>
          <h3 class="text-xl font-semibold text-on-surface">{m.an_inv_inactive_title()}</h3>
          <p class="text-xs font-bold text-on-surface-variant/40">{m.an_inv_inactive_subtitle({ count: invites.filter((inv: any) => !inv.uses).length })}</p>
        </div>
      </div>

      <div class="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
        {#each invites.filter((inv: any) => !inv.uses) as invite}
          <button
            type="button"
            class="w-full p-3 rounded-xl bg-surface-container-high/20 border border-outline-variant/5 hover:border-primary/20 transition-all flex items-center justify-between text-left"
            onclick={() => inviteDetailsModal.show(invite.code)}
            title={m.an_inv_open_view()}
          >
            <code class="text-xs font-bold text-on-surface-variant/60">{invite.code}</code>
            <span class="text-[11px] text-on-surface-variant/40">{m.an_inv_created_on({ date: new Date(invite.createdAt).toLocaleDateString(dateLocale()) })}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  </div>

  <style>
  .premium-card {
    background: rgba(var(--color-surface-container-low), 0.4);
    backdrop-filter: blur(24px);
    border: 1px solid rgba(var(--color-outline-variant), 0.1);
    transition: all 0.4s cubic-bezier(0.2, 1, 0.3, 1);
  }

  :global(.custom-scrollbar) {
    scrollbar-width: thin;
    scrollbar-color: rgba(var(--color-primary), 0.3) transparent;
  }

  :global(.custom-scrollbar::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.custom-scrollbar::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(.custom-scrollbar::-webkit-scrollbar-thumb) {
    background-color: rgba(var(--color-primary), 0.3);
    border-radius: 3px;
  }
</style>
