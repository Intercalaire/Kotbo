<script lang="ts">
  /**
   * Prise en main : le parcours de configuration, d'un seul ecran.
   *
   * Kotbo compte une centaine de reglages repartis sur autant de pages. Un
   * serveur qui vient de l'activer n'a aucun moyen de savoir par ou commencer,
   * ni de verifier qu'il n'a rien oublie. Cette page lit la configuration reelle
   * plutot qu'un compteur d'etapes franchies : un reglage efface redevient
   * « a faire », ce qu'un tutoriel lineaire ne saurait pas montrer.
   */
  import { onMount } from 'svelte';
  import { authStore } from '../lib/stores/auth.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { fetchSetupJourney } from '../lib/api';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import SectionCard from '../lib/components/SectionCard.svelte';
  import RefreshButton from '../lib/components/RefreshButton.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import EmptyState from '../lib/components/EmptyState.svelte';
  import Papicon from '../lib/components/Papicon.svelte';

  type Step = {
    key: string;
    group: 'essentiel' | 'moderation' | 'engagement';
    label: string;
    why: string;
    done: boolean;
    href: string;
    detail?: string;
  };

  let steps = $state<Step[]>([]);
  let progress = $state({ done: 0, total: 0 });
  let loading = $state(true);

  const GROUPS: { key: Step['group']; title: string; description: string; icon: string }[] = [
    {
      key: 'essentiel',
      title: 'Essentiel',
      description: "Sans ces trois-là, le reste fonctionne mal ou en silence.",
      icon: 'star',
    },
    {
      key: 'moderation',
      title: 'Modération',
      description: 'De quoi encadrer le serveur et rendre les décisions défendables.',
      icon: 'shield',
    },
    {
      key: 'engagement',
      title: 'Vie du serveur',
      description: "Ce qui fait revenir les membres : accueil, entraide, réponse aux demandes.",
      icon: 'users',
    },
  ];

  const percent = $derived(progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0);
  const remaining = $derived(steps.filter((s) => !s.done));

  function ringColor(value: number): string {
    if (value >= 85) return 'stroke-emerald-500';
    if (value >= 50) return 'stroke-amber-500';
    return 'stroke-primary';
  }

  function textColor(value: number): string {
    if (value >= 85) return 'text-emerald-500';
    if (value >= 50) return 'text-amber-500';
    return 'text-primary';
  }

  const RING_RADIUS = 42;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const ringOffset = $derived(RING_CIRCUMFERENCE * (1 - percent / 100));

  async function load() {
    if (!authStore.selectedGuildId) return;
    loading = true;
    try {
      const data = await fetchSetupJourney();
      steps = data?.steps ?? [];
      progress = data?.progress ?? { done: 0, total: 0 };
    } catch (err: any) {
      toast.error(err?.message || 'Chargement du parcours impossible');
      steps = [];
    } finally {
      loading = false;
    }
  }

  onMount(load);

  $effect(() => {
    const guildId = authStore.selectedGuildId;
    if (guildId) void load();
  });
</script>

<ModulePage
  title="Prise en main"
  description="Ce qui est en place, ce qui manque, et où aller le régler"
  icon="compass"
  featureKey="settings"
>
  {#snippet actions()}
    <RefreshButton onclick={load} loading={loading} />
  {/snippet}

  {#if loading && steps.length === 0}
    <LoadingHint context="config" />
  {:else if steps.length === 0}
    <EmptyState icon="compass" title="Parcours indisponible" description="Relancez le calcul." />
  {:else}
    <div class="space-y-4">
      <!-- ── Avancement ─────────────────────────────────────────────────── -->
      <SectionCard>
        <div class="flex flex-col sm:flex-row items-center gap-5">
          <div class="relative w-[110px] h-[110px] shrink-0">
            <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r={RING_RADIUS} class="stroke-outline-variant/30" stroke-width="8" fill="none" />
              <circle
                cx="50" cy="50" r={RING_RADIUS}
                class="{ringColor(percent)} transition-all duration-700"
                stroke-width="8" fill="none" stroke-linecap="round"
                stroke-dasharray={RING_CIRCUMFERENCE}
                stroke-dashoffset={ringOffset}
              />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-2xl font-bold tracking-tight {textColor(percent)}">{percent}%</span>
              <span class="text-[10px] uppercase tracking-widest text-on-surface-variant/70">
                {progress.done}/{progress.total}
              </span>
            </div>
          </div>

          <div class="min-w-0 flex-1 text-center sm:text-left">
            {#if remaining.length === 0}
              <p class="text-sm font-semibold text-emerald-500">Tout est configuré.</p>
              <p class="text-[13px] text-on-surface-variant mt-1 leading-relaxed">
                Les points essentiels sont couverts. Le reste se règle module par module,
                au fil de ce dont le serveur a besoin.
              </p>
            {:else}
              <p class="text-sm font-semibold text-on-surface">
                {remaining.length} point{remaining.length > 1 ? 's' : ''} à régler
              </p>
              <p class="text-[13px] text-on-surface-variant mt-1 leading-relaxed">
                Le prochain : <a href={remaining[0].href} class="text-primary hover:underline font-medium">{remaining[0].label}</a>.
                {remaining[0].why}
              </p>
            {/if}
          </div>
        </div>
      </SectionCard>

      <!-- ── Étapes par groupe ──────────────────────────────────────────── -->
      {#each GROUPS as group (group.key)}
        {@const groupSteps = steps.filter((s) => s.group === group.key)}
        {#if groupSteps.length > 0}
          {@const groupDone = groupSteps.filter((s) => s.done).length}
          <SectionCard title={group.title} description={group.description} icon={group.icon}>
            {#snippet actions()}
              <span class="text-[11px] px-2 py-0.5 rounded-full font-semibold
                {groupDone === groupSteps.length ? 'bg-emerald-500/10 text-emerald-500' : 'bg-surface-container text-on-surface-variant'}">
                {groupDone}/{groupSteps.length}
              </span>
            {/snippet}

            <ul class="space-y-1.5">
              {#each groupSteps as step (step.key)}
                <li>
                  <a
                    href={step.href}
                    class="flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors
                    {step.done
                      ? 'border-outline-variant/20 bg-surface-container-low/30 hover:border-outline-variant/40'
                      : 'border-primary/25 bg-primary/[0.04] hover:border-primary/45'}"
                  >
                    <div class="w-6 h-6 shrink-0 rounded-full flex items-center justify-center mt-0.5
                      {step.done ? 'bg-emerald-500/15 text-emerald-500' : 'bg-primary/15 text-primary'}">
                      <Papicon icon={step.done ? 'check' : 'arrow-right'} size={13} />
                    </div>

                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-[13.5px] font-semibold {step.done ? 'text-on-surface-variant' : 'text-on-surface'}">
                          {step.label}
                        </span>
                        {#if !step.done && step.detail}
                          <span class="text-[10.5px] px-1.5 py-0.5 rounded bg-error/10 text-error">
                            manque : {step.detail}
                          </span>
                        {:else if step.done && step.detail}
                          <span class="text-[10.5px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">
                            {step.detail}
                          </span>
                        {/if}
                      </div>
                      <p class="mt-0.5 text-[12.5px] text-on-surface-variant leading-relaxed">{step.why}</p>
                    </div>
                  </a>
                </li>
              {/each}
            </ul>
          </SectionCard>
        {/if}
      {/each}

      <SectionCard title="Vous venez d'un autre bot ?">
        <p class="text-[13px] text-on-surface-variant leading-relaxed">
          La page <a href="/migration" class="text-primary hover:underline font-medium">Reprise</a>
          détecte les bots déjà présents, récupère ce qui est lisible du serveur, et liste
          ce qu'il faudra ressaisir à la main.
        </p>
      </SectionCard>
    </div>
  {/if}
</ModulePage>
