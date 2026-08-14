<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import { memberAvatarSrc } from '../../discordMedia';
  import Chart from '../charts/Chart.svelte';

  const { data, chartLabels, invitesData, onOpenMember } = $props<{
    data: any;
    chartLabels: any[];
    invitesData: any;
    onOpenMember?: (userId: string, name: string) => void;
  }>();

  let showAllInvites = $state(false);
  const invites = $derived(invitesData || []);

  // Un repli sur l'avatar Discord generique donnerait la meme vignette a tous
  // les membres sans photo : on passe le nom et l'id pour obtenir une
  // initiale coloree distincte (issue #211).
  const getAvatar = (url: string | null, name?: string | null, userId?: string | null) =>
    memberAvatarSrc(url, name, userId);
</script>

<div class="space-y-6">
  <!-- Population Chart -->
  <div class="premium-card p-8 rounded-xl space-y-8">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <div class="bg-emerald-500/10 p-3 rounded-lg text-emerald-500">
          <Papicon icon="Users" size={24} />
        </div>
        <div>
          <h3 class="text-xl font-semibold text-on-surface">Flux de Population</h3>
          <p class="text-xs font-bold text-on-surface-variant/40">Arrivées vs Départs</p>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex flex-col items-end">
           <span class="text-sm font-semibold text-emerald-500">+{chartLabels.reduce((a, b) => a + (b.membersJoined || 0), 0)}</span>
           <span class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40">Entrées</span>
        </div>
        <div class="flex flex-col items-end">
           <span class="text-sm font-semibold text-rose-500">-{chartLabels.reduce((a, b) => a + (b.membersLeft || 0), 0)}</span>
           <span class="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/40">Sorties</span>
        </div>
      </div>
    </div>
    
    <div class="h-[300px]">
      <Chart 
        data={{
          labels: chartLabels.map(l => l.label),
          datasets: [
            {
              label: 'Arrivées',
              data: chartLabels.map(l => l.membersJoined),
              borderColor: '#10b981',
              borderWidth: 3,
              pointRadius: 0,
              pointHoverRadius: 6,
              pointHoverBackgroundColor: '#10b981',
              pointHoverBorderColor: '#fff',
              pointHoverBorderWidth: 3,
              fill: true,
              tension: 0.4,
              gradient: {
                backgroundColor: {
                  axis: 'y',
                  colors: { 0: 'rgba(16, 185, 129, 0)', 100: 'rgba(16, 185, 129, 0.2)' }
                }
              }
            },
            {
              label: 'Départs',
              data: chartLabels.map(l => l.membersLeft),
              borderColor: '#f43f5e',
              borderWidth: 3,
              pointRadius: 0,
              pointHoverRadius: 6,
              pointHoverBackgroundColor: '#f43f5e',
              pointHoverBorderColor: '#fff',
              pointHoverBorderWidth: 3,
              fill: true,
              tension: 0.4,
              gradient: {
                backgroundColor: {
                  axis: 'y',
                  colors: { 0: 'rgba(244, 63, 94, 0)', 100: 'rgba(244, 63, 94, 0.2)' }
                }
              }
            }
          ]
        }}
        height={300}
      />
    </div>
  </div>

  <!-- Invites Grid -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div class="lg:col-span-2 premium-card p-8 rounded-xl space-y-8">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
           <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Papicon icon="MailOpen" size={20} />
           </div>
           <h3 class="text-lg font-semibold text-on-surface">Codes d'Invitation Actifs</h3>
        </div>
        <div class="flex items-center gap-4">
          <span class="px-3 py-1 rounded-full bg-surface-container-high text-xs font-medium text-on-surface-variant/60">{invites.length} codes</span>
          <button 
            onclick={() => showAllInvites = !showAllInvites}
            class="p-2 rounded-xl bg-surface-container-high/40 hover:bg-surface-container-high text-on-surface-variant transition-colors"
          >
            <Papicon icon={showAllInvites ? 'ArrowsIn' : 'ArrowsOut'} size={18} />
          </button>
        </div>
      </div>
      
      <div class="overflow-x-auto {showAllInvites ? 'max-h-125 overflow-y-auto custom-scrollbar pr-2' : ''}">
        <table class="w-full text-left">
          <thead>
            <tr class="border-b border-outline-variant/10">
              <th class="pb-4 text-xs font-medium text-on-surface-variant/40 px-2">Code</th>
              <th class="pb-4 text-xs font-medium text-on-surface-variant/40">Créateur</th>
              <th class="pb-4 text-xs font-medium text-on-surface-variant/40 text-right px-2">Utilisations</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant/5">
            {#each (showAllInvites ? invites : invites.slice(0, 5)) as invite}
              <tr class="group hover:bg-primary/5 transition-all cursor-default">
                <td class="py-4 px-2">
                   <span class="font-semibold text-primary bg-primary/10 px-2 py-1 rounded-lg text-sm">{invite.code}</span>
                </td>
                <td class="py-4 text-xs font-bold text-on-surface-variant">
                   <div class="flex items-center gap-2">
                      <img src={getAvatar(invite.inviterAvatarUrl, invite.inviterTag, invite.inviterId)} alt="" class="w-6 h-6 rounded-md object-cover" />
                      @{invite.inviterTag || 'Inconnu'}
                   </div>
                </td>
                <td class="py-4 text-right px-2">
                   <span class="font-semibold text-on-surface text-base">{invite.uses}</span>
                </td>
              </tr>
            {/each}
            {#if invites.length === 0}
              <tr>
                <td colspan="3" class="py-10 text-center text-on-surface-variant/40 font-bold text-sm">Aucune invitation active</td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <div class="premium-card p-8 rounded-xl flex flex-col justify-center items-center text-center space-y-6 group">
      <div class="relative">
        <div class="absolute -inset-4 bg-emerald-500/10 rounded-full blur-none hidden group-hover:scale-150 transition-transform duration-700"></div>
        <div class="relative w-20 h-20 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-inner group-hover:rotate-6 transition-transform">
          <Papicon icon="ChartPieSlice" size={40} />
        </div>
      </div>
      <div>
        <h4 class="text-lg font-semibold text-on-surface tracking-tighter">{data?.totals?.retentionRate ?? '0'}%</h4>
        <p class="text-xs font-medium text-emerald-500 mt-1">Taux de Rétention</p>
      </div>
      <p class="text-xs font-medium text-on-surface-variant/60 max-w-[200px] leading-relaxed">
        Proportion des nouveaux membres restés sur le serveur après 7 jours.
      </p>
    </div>
  </div>
  <!-- Joins & Leaves -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
    <!-- Joins -->
    <div class="premium-card p-8 rounded-xl space-y-6">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
          <Papicon icon="UserPlus" size={20} />
        </div>
        <h3 class="text-lg font-semibold text-on-surface">Nouveaux Membres</h3>
      </div>
      
      <div class="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
        {#each (data?.recentJoins || []) as member}
          <div class="flex items-center justify-between group p-2 hover:bg-emerald-500/5 rounded-lg transition-all">
            <div class="flex items-center gap-3">
              <img src={getAvatar(member.avatarUrl, member.name, member.userId)} alt="" class="w-10 h-10 rounded-xl shadow-sm" />
              <div>
                <p class="text-sm font-semibold text-on-surface">@{member.name}</p>
                <p class="text-[10px] font-bold text-on-surface-variant/60">Rejoint le {new Date(member.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
            {#if onOpenMember}
              <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onclick={() => onOpenMember(member.userId, member.name)}
                  class="p-2 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors"
                >
                  <Papicon icon="ArrowSquareOut" size={16} />
                </button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="py-10 text-center text-on-surface-variant/40 font-bold text-sm">Aucun nouveau membre récent</div>
        {/each}
      </div>
    </div>

    <!-- Leaves -->
    <div class="premium-card p-8 rounded-xl space-y-6">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500">
          <Papicon icon="UserMinus" size={20} />
        </div>
        <h3 class="text-lg font-semibold text-on-surface">Départs Récents</h3>
      </div>
      
      <div class="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
        {#each (data?.recentLeaves || []) as member}
          <div class="flex items-center justify-between group p-2 hover:bg-rose-500/5 rounded-lg transition-all">
            <div class="flex items-center gap-3">
              <img src={getAvatar(member.avatarUrl, member.name, member.userId)} alt="" class="w-10 h-10 rounded-xl shadow-sm grayscale opacity-60" />
              <div>
                <p class="text-sm font-semibold text-on-surface">@{member.name}</p>
                <p class="text-[10px] font-bold text-on-surface-variant/60">Parti le {new Date(member.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
            {#if onOpenMember}
              <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onclick={() => onOpenMember(member.userId, member.name)}
                  class="p-2 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors"
                >
                  <Papicon icon="ArrowSquareOut" size={16} />
                </button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="py-10 text-center text-on-surface-variant/40 font-bold text-sm">Aucun départ récent</div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .premium-card {
    background: rgba(var(--color-surface-container-low), 0.4);
    backdrop-filter: blur(24px);
    border: 1px solid rgba(var(--color-outline-variant), 0.1);
    transition: all 0.4s cubic-bezier(0.2, 1, 0.3, 1);
  }

  .custom-scrollbar::-webkit-scrollbar {
    width: 4px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(var(--color-outline-variant), 0.2);
    border-radius: 10px;
  }
</style>


