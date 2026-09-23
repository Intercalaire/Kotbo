<script lang="ts">
  import { onMount } from 'svelte';
  import { authStore } from '../lib/stores/auth.svelte';
  import { API_BASE_URL } from '../lib/api';
  import { consumeLoginReturn } from '../lib/loginReturn';
  import { router } from 'tinro';
  import Papicon from '../lib/components/Papicon.svelte';
  import { brandingStore } from '../lib/stores/branding.svelte';
  import PrivacyNotice from '../lib/components/PrivacyNotice.svelte';
  import DashboardSketch from '../lib/components/login/DashboardSketch.svelte';
  import { m } from '../lib/i18n';

  let errorMessage = $state<string | null>(null);
  /**
   * Le va-et-vient vers Discord est une navigation plein page : entre le clic
   * et le changement d'URL, l'appel a `/api/config` peut prendre une seconde
   * sur une connexion lente. Sans ce drapeau la page restait parfaitement
   * immobile et le visiteur recliquait, relancant l'echange OAuth.
   */
  let isRedirecting = $state(false);
  /** Le bouton « Reessayer » ne redirige pas : il resonde seulement l'API. */
  let isRetrying = $state(false);

  /**
   * Ou revenir apres le va-et-vient Discord.
   *
   * L'API sait deja reposer quelqu'un ou il allait - `?returnTo=`, garde en
   * cookie pendant l'echange et relu au retour. Sans ce parametre, tout le
   * monde atterrit sur `/` : le visiteur venu de « Ajouter le bot » se
   * retrouvait sur le tableau de bord d'un serveur quelconque, au lieu de la
   * liste ou il devait choisir celui a equiper.
   *
   * L'adresse est consommee a la construction du lien, pas au clic : la page
   * de connexion ne se traverse qu'une fois par tentative, et une intention
   * qui survivrait a un retour en arriere detournerait la connexion suivante.
   */
  const returnTo = consumeLoginReturn();
  const oauthLoginUrl = `${API_BASE_URL || ''}/api/auth/discord/login${
    returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
  }`;

  async function hydrateOAuthConfig() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/config`, {
        headers: { Accept: 'application/json' }
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        errorMessage = API_BASE_URL
          ? m.login_api_config_invalid_url({ url: API_BASE_URL })
          : m.login_api_config_invalid();
        return;
      }

      const data = await response.json() as { discordClientId?: string; error?: string; missing?: string[] };

      if (!response.ok) {
        if (data?.missing?.length) {
          errorMessage = m.login_oauth_invalid({ missing: data.missing.join(', ') });
        } else if (data?.error) {
          errorMessage = data.error;
        }
        return;
      }
    } catch {
      errorMessage = API_BASE_URL
        ? m.login_api_unreachable_url({ url: API_BASE_URL })
        : m.login_api_unreachable();
    }
  }

  const loginWithDiscord = async () => {
    if (isRedirecting) return;

    isRedirecting = true;
    errorMessage = null;
    await hydrateOAuthConfig();

    if (errorMessage) {
      isRedirecting = false;
      return;
    }

    window.location.href = oauthLoginUrl;
  };

  /**
   * Une API momentanement injoignable condamnait la page : le message d'erreur
   * s'affichait au chargement et plus rien ne le relisait sans rechargement
   * complet. Ce bouton retente la sonde seule, sans engager de redirection.
   */
  const retryConfig = async () => {
    if (isRetrying) return;

    isRetrying = true;
    errorMessage = null;
    await hydrateOAuthConfig();
    isRetrying = false;
  };

  onMount(async () => {
    await hydrateOAuthConfig();

    if (authStore.isAuthenticated) {
      router.goto('/');
    }

    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('error');
    if (errorParam) {
      if (errorParam === 'auth_failed') {
        errorMessage = m.login_auth_failed();
      } else if (errorParam === 'no_code') {
        errorMessage = m.login_no_code();
      } else {
        errorMessage = m.login_unexpected_error();
      }

      window.history.replaceState({}, document.title, window.location.pathname);
    }
  });

  const year = new Date().getFullYear();

  /**
   * Les trois arguments que le croquis illustre.
   *
   * Ils remplacent l'ancienne ligne « OAuth 2.0 / AES-256 / 99.98% » : les deux
   * premiers etaient des details d'implementation, le troisieme un chiffre
   * ecrit en dur qu'aucune sonde ne mesurait.
   *
   * La liste sert deux fois : visible sous la carte tant que le croquis est
   * masque, puis reservee aux lecteurs d'ecran une fois qu'il apparait - le
   * SVG etant decoratif, c'est elle qui en porte le sens.
   */
  const highlights = $derived([
    { icon: 'server', label: m.login_sketch_servers() },
    { icon: 'chart', label: m.login_sketch_analytics() },
    { icon: 'shield', label: m.login_sketch_logs() }
  ]);
</script>

<div class="min-h-screen w-full bg-background text-on-surface font-body lg:grid lg:grid-cols-[1.05fr_1fr]">

  <!--
    Panneau vitrine. Masque sous `lg` : a cette largeur le croquis passerait
    sous 340px de large et ses annotations se chevaucheraient. Le mobile garde
    la liste d'arguments, qui dit la meme chose en trois lignes.
  -->
  <aside class="sketch-paper relative hidden lg:flex flex-col justify-between border-r border-outline-variant px-12 py-10 xl:px-16">
    <div class="flex items-center gap-3">
      <img src={brandingStore.logoUrl || '/favicon.svg'} alt="" class="w-8 h-8 rounded-lg" />
      <span class="text-lg font-semibold tracking-tight">{brandingStore.brandName}</span>
    </div>

    <div class="relative max-w-xl">
      <p class="text-xs font-semibold text-on-surface-variant/80 mb-4">
        {m.login_pitch_eyebrow()}
      </p>

      <!--
        Accroche stylee comme un titre, mais ecrite en `<p>`.

        Ce panneau precede le formulaire dans le DOM : en `<h2>` il aurait
        annonce un niveau 2 avant le `<h1>` de la carte, et l'ordre des titres
        n'aurait plus rien voulu dire. Le mobile le masque de toute facon, il
        n'y aurait alors plus eu aucun titre de niveau 2 a rattacher.
      -->
      <p class="font-headline text-3xl xl:text-[2.1rem] leading-[1.3] tracking-tight text-balance">
        {m.login_pitch_lead()}
        <span class="sketch-struck">
          {m.login_pitch_struck()}
          <svg class="sketch-struck__line" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path d="M3 8 C 42 3.5, 64 11, 101 6.5 S 161 3, 197 7.5" />
          </svg>
        </span>
        <span class="text-primary">{m.login_pitch_tail()}</span>
      </p>

      <p class="mt-4 flex items-center gap-2 text-sm italic text-on-surface-variant/80">
        <svg class="w-7 h-5 shrink-0" viewBox="0 0 28 20" fill="none" aria-hidden="true" focusable="false">
          <path d="M2 4 C 10 4, 16 8, 21 15" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          <path d="M16 13.5 L 21.5 15.5 L 19.5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {m.login_pitch_note()}
      </p>

      <figure class="mt-8">
        <DashboardSketch
          labelServers={m.login_sketch_servers()}
          labelAnalytics={m.login_sketch_analytics()}
          labelLogs={m.login_sketch_logs()}
        />
        <figcaption class="sr-only">{m.login_preview_caption()}</figcaption>
      </figure>
    </div>

    <p class="text-xs text-on-surface-variant/80">
      {brandingStore.brandName} &copy; {year}
    </p>
  </aside>

  <!-- Panneau de connexion -->
  <main class="flex flex-col min-h-screen lg:min-h-0 px-5 sm:px-8 py-8 lg:py-10">

    <!-- Le panneau de gauche porte deja la marque : ce rappel ne sert qu'au
         mobile, qui masque ce panneau. -->
    <div class="flex items-center gap-2.5 lg:hidden">
      <img src={brandingStore.logoUrl || '/favicon.svg'} alt="" class="w-7 h-7 rounded-lg" />
      <span class="text-base font-semibold tracking-tight">{brandingStore.brandName}</span>
    </div>

    <div class="grow flex items-center justify-center py-10">
      <div class="w-full max-w-sm">

        <div class="sketch-outline relative">
          <div class="relative section-card p-7 sm:p-8">
            <img
              src={brandingStore.logoUrl || '/favicon.svg'}
              alt="{brandingStore.brandName} logo"
              class="w-14 h-14 rounded-xl mb-5"
            />

            <h1 class="font-headline text-xl font-semibold tracking-tight mb-1.5">{m.login_title()}</h1>
            <p class="text-sm text-on-surface-variant leading-relaxed mb-6">
              {m.login_subtitle()}
            </p>

            {#if errorMessage}
              <div role="alert" class="sketch-alert mb-5 px-3.5 py-3 text-left bg-error/10">
                <div class="flex items-start gap-2.5">
                  <Papicon icon="warning" size={15} class="text-error shrink-0 mt-0.5" />
                  <div class="min-w-0">
                    <p class="text-xs font-semibold text-error">{m.login_error_heading()}</p>
                    <p class="mt-1 text-xs text-error/90 wrap-break-word">{errorMessage}</p>
                    <button
                      type="button"
                      onclick={retryConfig}
                      disabled={isRetrying}
                      class="mt-2 text-xs font-semibold text-error underline underline-offset-2 hover:no-underline disabled:opacity-60"
                    >
                      {m.login_retry()}
                    </button>
                  </div>
                </div>
              </div>
            {/if}

            <button
              type="button"
              onclick={loginWithDiscord}
              disabled={isRedirecting}
              aria-busy={isRedirecting}
              class="sketch-button relative w-full flex items-center justify-center gap-2.5 py-3 px-4 bg-primary text-on-primary rounded-lg font-semibold text-sm disabled:cursor-wait"
            >
              {#if isRedirecting}
                <span class="sketch-spinner" aria-hidden="true"></span>
                {m.login_redirecting()}
              {:else}
                <Papicon icon="discord" size={18} />
                {m.login_with_discord()}
              {/if}
            </button>

            <div class="mt-4">
              <PrivacyNotice compact text={m.login_privacy_notice()} />
            </div>
          </div>
        </div>

        <!--
          Visible tant que le croquis est masque, puis reservee au lecteur
          d'ecran : au-dela de `lg` le panneau de gauche dit deja tout cela, en
          double ce serait du bruit a l'ecran mais pas a l'oreille.
        -->
        <ul class="mt-8 lg:sr-only flex flex-col gap-2.5">
          {#each highlights as highlight (highlight.label)}
            <li class="flex items-center gap-2.5 text-sm text-on-surface-variant">
              <Papicon icon={highlight.icon} size={15} class="text-primary shrink-0" />
              {highlight.label}
            </li>
          {/each}
        </ul>

        <p class="mt-8 text-center text-xs text-on-surface-variant/80 lg:hidden">
          {brandingStore.brandName} &copy; {year}
        </p>
      </div>
    </div>
  </main>
</div>

<style>
  /*
   * Le papier du panneau vitrine.
   *
   * Une grille plutot qu'un aplat, mais assez pale pour ne pas concurrencer le
   * croquis ; le masque radial la fait disparaitre avant les bords, sinon les
   * lignes se coupaient net contre la bordure et le fond ressemblait a un
   * tableur plutot qu'a une feuille.
   */
  .sketch-paper {
    background-color: var(--surface-container-lowest);
    background-image:
      linear-gradient(to right, color-mix(in srgb, var(--on-surface-variant) 7%, transparent) 1px, transparent 1px),
      linear-gradient(to bottom, color-mix(in srgb, var(--on-surface-variant) 7%, transparent) 1px, transparent 1px);
    background-size: 30px 30px;
    background-position: center;
  }

  .sketch-paper::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      ellipse at 45% 45%,
      transparent 35%,
      var(--surface-container-lowest) 88%
    );
  }

  .sketch-paper > * {
    position: relative;
  }

  /* La rature : le mot reste lisible sous le trait, c'est tout l'effet. */
  .sketch-struck {
    position: relative;
    display: inline-block;
    color: var(--on-surface-variant);
    opacity: 0.65;
    white-space: nowrap;
  }

  .sketch-struck__line {
    position: absolute;
    left: -2%;
    top: 50%;
    width: 104%;
    height: 0.55em;
    transform: translateY(-52%);
    overflow: visible;
    pointer-events: none;
  }

  .sketch-struck__line path {
    fill: none;
    stroke: var(--primary-color);
    stroke-width: 2.4;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  /*
   * Double contour de la carte de connexion.
   *
   * La carte elle-meme garde ses bords nets - c'est un formulaire, pas une
   * illustration. Le trait « au crayon » passe derriere, decale et legerement
   * tourne : le rayon asymetrique suffit a casser la regularite sans qu'aucun
   * cote paraisse rate.
   */
  .sketch-outline::before {
    content: '';
    position: absolute;
    inset: -7px;
    border: 1.5px solid color-mix(in srgb, var(--primary-color) 34%, transparent);
    border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
    transform: rotate(-0.4deg);
    pointer-events: none;
  }

  /* Meme langage pour l'alerte, en rouge : bord trace, pas bord dessine. */
  .sketch-alert {
    border: 1.5px solid color-mix(in srgb, var(--color-error) 38%, transparent);
    border-radius: 200px 12px 180px 14px / 14px 180px 12px 200px;
  }

  /*
   * Le bouton reste plein et franc - c'est l'action de la page - mais porte le
   * contour crayonne par-dessus. Au survol le trait se resserre : le griffonnage
   * repond au geste au lieu d'etre un decor fixe.
   */
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

  .sketch-button:hover:not(:disabled)::after {
    inset: -2px;
    transform: rotate(-0.6deg);
    border-color: color-mix(in srgb, var(--primary-color) 70%, transparent);
  }

  .sketch-button:disabled::after {
    border-color: color-mix(in srgb, var(--primary-color) 22%, transparent);
  }

  .sketch-spinner {
    width: 15px;
    height: 15px;
    border-radius: 9999px;
    border: 2px solid color-mix(in srgb, var(--color-on-primary) 35%, transparent);
    border-top-color: var(--color-on-primary);
    animation: sketch-spin 0.7s linear infinite;
  }

  @keyframes sketch-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sketch-button::after {
      transition: none;
    }

    .sketch-spinner {
      animation-duration: 2s;
    }
  }
</style>
