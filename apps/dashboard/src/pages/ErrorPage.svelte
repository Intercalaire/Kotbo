<script lang="ts">
  /**
   * Ecran d'erreur plein page.
   *
   * Il partage le langage visuel de la page de connexion - contour crayonne
   * pose derriere une carte aux bords nets - parce que ce sont les deux seuls
   * ecrans qu'un visiteur peut voir avant d'etre entre dans le dashboard : s'ils
   * ne se ressemblent pas, une erreur d'authentification donne l'impression
   * d'avoir change de site.
   */
  import Papicon from '../lib/components/Papicon.svelte';
  import { m } from '../lib/i18n';

  const {
    error = m.err_unexpected(),
    code = '500'
  } = $props<{ error?: string; code?: string }>();
</script>

<div class="min-h-screen flex items-center justify-center bg-background text-on-surface font-body px-5 py-10">
  <div class="w-full max-w-md">
    <div class="sketch-outline relative">
      <div class="relative section-card p-7 sm:p-8 text-center">
        <div class="mx-auto mb-5 w-14 h-14 flex items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/10">
          <Papicon name="error" size={28} class="text-red-600 dark:text-red-400" />
        </div>

        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-on-surface-variant/80 mb-2">
          {m.err_title({ code })}
        </p>

        <h1 class="font-headline text-xl font-semibold tracking-tight mb-2">{m.err_oops()}</h1>

        <p class="text-sm text-on-surface-variant leading-relaxed wrap-break-word">
          {error}
        </p>

        <button
          type="button"
          onclick={() => window.location.reload()}
          class="sketch-button relative mt-7 w-full flex items-center justify-center gap-2.5 py-3 px-4 bg-primary text-on-primary rounded-lg font-semibold text-sm"
        >
          <Papicon name="refresh" size={18} />
          {m.err_refresh_page()}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  /*
   * Meme trait que la page de connexion : la carte garde ses bords nets, le
   * crayon passe derriere, decale et legerement tourne.
   */
  .sketch-outline::before {
    content: '';
    position: absolute;
    inset: -7px;
    border: 1.5px solid color-mix(in srgb, var(--color-error) 30%, transparent);
    border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
    transform: rotate(-0.4deg);
    pointer-events: none;
  }

  .sketch-button::after {
    content: '';
    position: absolute;
    inset: -4px;
    border: 1.5px solid color-mix(in srgb, var(--primary-color) 45%, transparent);
    border-radius: 255px 14px 225px 16px / 16px 225px 14px 255px;
    transform: rotate(0.5deg);
    pointer-events: none;
    transition: inset 0.18s ease, transform 0.18s ease, border-color 0.18s ease;
  }

  .sketch-button:hover::after {
    inset: -2px;
    transform: rotate(-0.6deg);
    border-color: color-mix(in srgb, var(--primary-color) 70%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .sketch-button::after {
      transition: none;
    }
  }
</style>
