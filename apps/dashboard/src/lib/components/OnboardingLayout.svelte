<script lang="ts">
  /**
   * Coquille des pages du tunnel, tant que le serveur n'est pas active.
   *
   * `Setup` et `Migration` sont des pages du dashboard comme les autres une
   * fois le serveur active : elles vivent alors dans MainLayout, avec la barre
   * laterale et le fil d'Ariane. Avant l'activation, elles sont les deux seules
   * pages ouvertes - les envelopper dans la coquille complete afficherait une
   * navigation entierement fermee autour d'elles.
   *
   * Cette coquille-ci ne porte donc que ce dont le tunnel a besoin : de quoi
   * savoir ou l'on en est, de quoi revenir en arriere, et la sortie - le
   * reglement, qui est ce qui ouvre le reste.
   *
   * La barre du bas est volontairement presente des la premiere page plutot
   * qu'a la fin d'un parcours lineaire : personne ne configure un serveur d'une
   * traite, et quelqu'un qui a assez vu doit pouvoir activer sans avoir a
   * terminer un formulaire.
   *
   * Elle ne dit pas la meme chose du debut a la fin pour autant. Reclamer le
   * paiement au premier ecran, c'est le reclamer avant d'avoir rien montre ;
   * l'ordre du tunnel est l'inverse - on monte le serveur, on voit ce que ca
   * donne, et l'activation arrive quand il y a quelque chose a perdre a
   * s'arreter la. Tant que les points essentiels manquent, la barre affiche
   * donc ce qu'il reste et laisse l'activation en retrait ; une fois le
   * serveur debout, elle passe devant et dit ce qui a ete monte.
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { router } from 'tinro';
  import { authStore } from '../stores/auth.svelte';
  import { toast } from '../stores/toast.svelte';
  import { dashboardLifecycle } from '../dashboardLifecycle';
  import { setupJourney } from '../stores/setupJourney.svelte';
  import { markOnboardingCheckout } from '../onboardingHandoff';
  import { startCheckout } from '../api';
  import Papicon from './Papicon.svelte';

  const { children }: { children?: Snippet } = $props();

  const progress = $derived(setupJourney.progress);
  const ready = $derived(progress.ready && progress.essentialTotal > 0);
  const nextEssential = $derived(setupJourney.remainingEssentials[0] ?? null);

  // La barre se rend au-dessus de `/setup`, qui charge deja le parcours :
  // `ensure` s'efface alors devant lui plutot que de le recalculer. Sur
  // `/migration`, qui ne le charge pas, c'est cet appel qui le remplit.
  /**
   * La coquille du tunnel porte le cycle de vie du dashboard, comme MainLayout.
   *
   * C'est lui qui declenche le premier chargement de l'etat et tient la
   * connexion temps reel. Sans ce relais, passer sous cette coquille coupait
   * les deux : l'etat cessait de se rafraichir, et comme c'est lui qui dit si
   * le serveur est encore dans le tunnel, la coquille se serait retiree au
   * rechargement suivant faute de savoir pourquoi elle etait la.
   *
   * Une seule des deux coquilles est montee a la fois : le gestionnaire ne voit
   * donc jamais deux `init` concurrents.
   */
  onMount(() => {
    dashboardLifecycle.init();

    void setupJourney.ensure().catch(() => {
      // Sans parcours, la barre garde sa forme neutre : le bouton d'activation
      // reste la, il n'est simplement pas mis en avant.
    });

    return () => dashboardLifecycle.destroy();
  });

  const selectedGuild = $derived(
    authStore.guilds.find((guild) => guild.id === authStore.selectedGuildId)
  );

  let pending = $state(false);

  /**
   * L'offre n'est pas demandee ici.
   *
   * Le palier se deduit de la taille du serveur (`planForMemberCount` cote
   * contrats), et la page de reglement Stripe affiche le montant avant tout
   * engagement. Faire choisir entre Pro et Ultimate au milieu du tunnel, c'est
   * poser une question dont la reponse est deja connue.
   */
  async function activate() {
    pending = true;
    const url = await startCheckout('PRO', 'month');
    pending = false;

    if (!url) {
      toast.error("Impossible d'ouvrir la page de paiement. Réessayez dans un instant.");
      return;
    }

    // Stripe ramene tout le monde sur la facturation. Ce drapeau distingue au
    // retour celui qui sort du tunnel - et qu'il faut mener a la formation -
    // de celui qui a simplement change d'offre. Pose ici parce que c'est le
    // seul bouton d'activation du tunnel.
    markOnboardingCheckout(authStore.selectedGuildId);
    window.location.href = url;
  }
</script>

<div class="min-h-screen bg-background text-on-background pb-24">
  <header class="border-b border-outline-variant/30">
    <div class="mx-auto w-full max-w-6xl px-6 py-4 flex items-center justify-between gap-4">
      <div class="flex items-center gap-2.5 min-w-0">
        <img src="/favicon.svg" alt="" class="w-7 h-7 rounded-lg shrink-0" />
        <span class="font-semibold tracking-tight text-on-surface shrink-0">Kotbo</span>
        {#if selectedGuild}
          <span class="text-on-surface-variant/30 shrink-0">/</span>
          <span class="text-[13px] font-medium text-on-surface-variant/70 truncate">{selectedGuild.name}</span>
        {/if}
      </div>

      <!-- Les deux seules sorties du tunnel, en dehors du paiement. « Mes
           serveurs » parce qu'il faut pouvoir aller en equiper un autre sans
           avoir a finir celui-ci ; le code parce que l'activation offerte, le
           partenariat et la reprise par le support passent encore par la, et
           que cette page n'accueille plus personne d'office. -->
      <div class="shrink-0 flex items-center gap-4">
        <a
          href="/servers"
          class="text-[13px] font-medium text-on-surface-variant/60 hover:text-on-surface transition-colors"
        >
          Mes serveurs
        </a>
        <a
          href="/activation"
          class="hidden sm:inline text-[13px] font-medium text-on-surface-variant/40 hover:text-on-surface transition-colors"
        >
          J'ai un code
        </a>
        <button
          type="button"
          onclick={() => router.goto('/onboarding')}
          class="inline-flex items-center gap-1.5 text-[13px] font-medium text-on-surface-variant/60 hover:text-on-surface transition-colors"
        >
          <Papicon icon="ChevronLeft" size={14} />
          Retour
        </button>
      </div>
    </div>
  </header>

  <div class="mx-auto w-full max-w-6xl px-6 py-8">
    {@render children?.()}
  </div>

  <!-- La sortie du tunnel, toujours visible - mais pas toujours au premier plan. -->
  <div
    class="fixed bottom-0 inset-x-0 border-t backdrop-blur-sm transition-colors duration-300
           {ready
             ? 'border-primary/30 bg-primary/[0.06]'
             : 'border-outline-variant/30 bg-surface-container-lowest/95'}"
  >
    <div class="mx-auto w-full max-w-6xl px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        {#if ready}
          <p class="text-[13px] font-semibold text-on-surface">
            Le serveur est monté : {progress.done} réglage{progress.done > 1 ? 's' : ''} en place,
            dont les {progress.essentialTotal} essentiels.
          </p>
          <p class="text-[12px] text-on-surface-variant/70 font-medium mt-0.5">
            L'activation allume les modules et ouvre le reste du dashboard.
          </p>
        {:else if nextEssential}
          <p class="text-[13px] font-semibold text-on-surface">
            {progress.essentialDone}/{progress.essentialTotal} points essentiels —
            il reste <a href={nextEssential.href} class="text-primary hover:underline">{nextEssential.label}</a>.
          </p>
          <p class="text-[12px] text-on-surface-variant/70 font-medium mt-0.5">
            La configuration est gardée. Les modules s'allument à l'activation.
          </p>
        {:else}
          <p class="text-[13px] text-on-surface-variant/70 font-medium">
            La configuration est gardée. Les modules s'allument à l'activation.
          </p>
        {/if}
      </div>

      <button
        type="button"
        onclick={activate}
        disabled={pending}
        class="shrink-0 inline-flex items-center gap-2 rounded-lg text-sm font-medium
               transition-opacity disabled:opacity-50
               {ready
                 ? 'px-5 py-2.5 bg-primary text-on-primary hover:opacity-90 shadow-sm shadow-primary/20'
                 : 'px-4 py-2 border border-outline-variant/50 text-on-surface-variant hover:text-on-surface hover:border-primary/40'}"
      >
        {#if pending}
          Ouverture…
        {:else if ready}
          Activer le serveur
        {:else}
          Activer maintenant
        {/if}
        <Papicon icon="ChevronRight" size={14} />
      </button>
    </div>
  </div>
</div>
