<script lang="ts">
  /**
   * Banniere de coupure du backend.
   *
   * Sans elle, une panne se lisait comme une absence de donnees : des listes
   * vides, des compteurs a zero, et des formulaires qui semblaient enregistrer.
   * La banniere nomme la panne, dit que les modifications sont suspendues, et
   * propose de retenter.
   *
   * Elle ne s'affiche qu'a la coupure confirmee (`down`), pas au premier echec :
   * un creux reseau passager ne doit pas faire clignoter un bandeau rouge.
   */
  import { backendHealth } from '../stores/backendHealth.svelte';
  import { m } from '../i18n';
  import Papicon from './Papicon.svelte';

  const description = $derived(() => {
    switch (backendHealth.lastFailureKind) {
      case 'offline':
        return m.backend_down_offline();
      case 'timeout':
        return m.backend_down_timeout();
      default:
        return m.backend_down_unavailable();
    }
  });

  function retry() {
    // Rechargement complet plutot qu'une simple remise a zero de la sante :
    // pendant la coupure, chaque page a echoue de son cote et garde des
    // donnees partielles. Relancer les appels un par un laisserait un ecran
    // moitie vide, moitie perime.
    window.location.reload();
  }
</script>

{#if backendHealth.isDown}
  <div
    role="alert"
    aria-live="assertive"
    class="sticky top-0 z-[9000] flex flex-wrap items-center gap-3 border-b border-red-500/30 bg-red-950/90 px-4 py-3 text-sm backdrop-blur"
  >
    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-300">
      <Papicon icon="CloudOff" size={18} />
    </span>

    <div class="min-w-0 flex-1">
      <p class="font-semibold text-red-100">{m.backend_down_title()}</p>
      <p class="text-red-200/80">{description()}</p>
    </div>

    <button
      type="button"
      onclick={retry}
      class="shrink-0 rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-1.5 font-semibold text-red-100 transition-colors hover:bg-red-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
    >
      {m.backend_down_retry()}
    </button>
  </div>
{/if}
