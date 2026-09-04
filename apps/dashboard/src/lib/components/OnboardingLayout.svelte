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
   */
  import type { Snippet } from 'svelte';
  import { router } from 'tinro';
  import { authStore } from '../stores/auth.svelte';
  import { toast } from '../stores/toast.svelte';
  import { startCheckout } from '../api';
  import Papicon from './Papicon.svelte';

  const { children }: { children?: Snippet } = $props();

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

      <button
        type="button"
        onclick={() => router.goto('/onboarding')}
        class="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-medium text-on-surface-variant/60 hover:text-on-surface transition-colors"
      >
        <Papicon icon="ChevronLeft" size={14} />
        Retour
      </button>
    </div>
  </header>

  <div class="mx-auto w-full max-w-6xl px-6 py-8">
    {@render children?.()}
  </div>

  <!-- La sortie du tunnel, toujours visible. -->
  <div class="fixed bottom-0 inset-x-0 border-t border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-sm">
    <div class="mx-auto w-full max-w-6xl px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
      <p class="text-[13px] text-on-surface-variant/70 font-medium">
        La configuration est gardée. Les modules s'allument à l'activation.
      </p>
      <button
        type="button"
        onclick={activate}
        disabled={pending}
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium
               hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {pending ? 'Ouverture…' : 'Activer le serveur'}
        <Papicon icon="ChevronRight" size={14} />
      </button>
    </div>
  </div>
</div>
