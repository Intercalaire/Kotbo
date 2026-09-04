<script lang="ts">
  /**
   * Le cadre du parcours de configuration.
   *
   * Il ne porte que quatre choses : qui parle, ou l'on en est, de quoi revenir,
   * et de quoi sortir vers un autre serveur. Pas de barre laterale, pas
   * d'en-tete, pas de fil d'Ariane - il n'y a rien a naviguer. Ce qu'on traverse
   * ici n'est pas une section du tableau de bord, c'est ce qui vient avant lui.
   *
   * « Qui parle » a ete ajoute : le logo, lisible, et le serveur ou le bot vient
   * d'arriver, presentes cote a cote. C'est le seul moment du produit ou l'on
   * ne sait pas encore ce qu'on installe.
   *
   * La progression est groupee en phases nommees. Onze barres identiques
   * disaient « c'est long » ; quatre groupes disent « voila la forme du
   * parcours, et vous etes la ». Le compte exact reste ecrit dessous pour qui
   * le cherche, mais il n'est plus ce qu'on lit en premier.
   */
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { authStore } from '../../stores/auth.svelte';
  import { wizard } from '../../stores/onboardingWizard.svelte';
  import { WIZARD_PHASES, WIZARD_STEPS, STEP_TITLES, STEP_ICONS, phaseOf } from '../../onboardingWizard';
  import Papicon from '../Papicon.svelte';
  import KotboMark from './KotboMark.svelte';

  const {
    title,
    lead,
    children,
    footer,
    canGoBack = true,
    /** Remplace l'en-tete de titre par le contenu, pour les ecrans qui se rendent seuls. */
    bare = false,
  }: {
    title: string;
    lead?: string;
    children?: Snippet;
    footer?: Snippet;
    canGoBack?: boolean;
    bare?: boolean;
  } = $props();

  const selectedGuild = $derived(
    authStore.guilds.find((guild) => guild.id === authStore.selectedGuildId)
  );

  const guildIconUrl = $derived(
    selectedGuild?.icon
      ? `https://cdn.discordapp.com/icons/${selectedGuild.id}/${selectedGuild.icon}.png?size=64`
      : null
  );

  const index = $derived(wizard.index);
  const currentPhase = $derived(phaseOf(wizard.step));
</script>

<div class="min-h-screen bg-background text-on-background flex flex-col">
  <!-- ── En-tête : identité, serveur, sortie ──────────────────────────────── -->
  <header class="shrink-0 border-b border-outline-variant/25">
    <div class="mx-auto w-full max-w-2xl px-6 py-3.5 flex items-center justify-between gap-4">
      <div class="flex items-center gap-2.5 min-w-0">
        <KotboMark size={26} />
        <span class="font-semibold tracking-tight text-on-surface shrink-0">Kotbo</span>
        {#if selectedGuild}
          <Papicon icon="plus" size={11} class="shrink-0 text-on-surface-variant/30" />
          <span class="flex items-center gap-1.5 min-w-0">
            {#if guildIconUrl}
              <img src={guildIconUrl} alt="" class="w-5 h-5 rounded-md shrink-0" />
            {:else}
              <span class="w-5 h-5 rounded-md shrink-0 bg-surface-container text-on-surface-variant/60 text-[10px] font-bold flex items-center justify-center">
                {selectedGuild.name.slice(0, 1).toUpperCase()}
              </span>
            {/if}
            <span class="text-[13px] font-medium text-on-surface-variant/70 truncate">
              {selectedGuild.name}
            </span>
          </span>
        {/if}
      </div>

      <a
        href="/servers"
        class="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-medium text-on-surface-variant/50 hover:text-on-surface transition-colors"
      >
        <Papicon icon="arrow-left-right" size={13} />
        <span class="hidden sm:inline">Changer de serveur</span>
      </a>
    </div>
  </header>

  <!-- ── Progression, par phases ──────────────────────────────────────────── -->
  <div class="shrink-0 border-b border-outline-variant/25 bg-surface-container-lowest/40">
    <div class="mx-auto w-full max-w-2xl px-6 py-3">
      <div class="flex items-center gap-3">
        {#each WIZARD_PHASES as phase (phase.key)}
          <div class="flex-1 min-w-0 flex items-center gap-1" style="flex-grow: {phase.steps.length}">
            {#each phase.steps as step (step)}
              {@const position = WIZARD_STEPS.indexOf(step)}
              <div
                class="h-1 flex-1 rounded-full transition-colors duration-500
                {position < index
                  ? 'bg-primary'
                  : position === index
                    ? 'bg-primary/60'
                    : 'bg-outline-variant/30'}"
              ></div>
            {/each}
          </div>
        {/each}
      </div>

      <div class="mt-2 flex items-baseline justify-between gap-3">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-primary/75 truncate">
          {currentPhase}
        </p>
        <p class="text-[11px] font-medium text-on-surface-variant/40 shrink-0">
          {STEP_TITLES[wizard.step]} · {index + 1}/{wizard.total}
        </p>
      </div>
    </div>
  </div>

  <!-- ── L'écran ──────────────────────────────────────────────────────────── -->
  <main class="flex-1 mx-auto w-full max-w-2xl px-6 py-9 sm:py-12">
    <!-- La clef sur l'etape rejoue la transition a chaque changement d'ecran :
         sans elle, Svelte reutilise le bloc et rien ne bouge. -->
    {#key wizard.step}
      <div in:fly={{ y: 10, duration: 260 }}>
        {#if !bare}
          <div class="flex items-center gap-2 mb-3">
            <span class="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Papicon icon={STEP_ICONS[wizard.step]} size={14} />
            </span>
            <span class="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant/45">
              {STEP_TITLES[wizard.step]}
            </span>
          </div>

          <h1 class="text-2xl sm:text-[28px] leading-tight font-semibold tracking-tight text-on-surface font-headline">
            {title}
          </h1>
          {#if lead}
            <p class="mt-2.5 text-[15px] text-on-surface-variant/75 leading-relaxed">{lead}</p>
          {/if}
        {/if}

        <div class={bare ? '' : 'mt-8'}>
          {@render children?.()}
        </div>
      </div>
    {/key}
  </main>

  <!-- ── Pied : retour et action ──────────────────────────────────────────── -->
  <footer class="shrink-0 border-t border-outline-variant/25 bg-surface-container-lowest/60 backdrop-blur-sm">
    <div class="mx-auto w-full max-w-2xl px-6 py-4 flex items-center justify-between gap-4">
      {#if canGoBack && !wizard.isFirst}
        <button
          type="button"
          onclick={() => wizard.back()}
          class="inline-flex items-center gap-1.5 text-[13px] font-medium text-on-surface-variant/60 hover:text-on-surface transition-colors"
        >
          <Papicon icon="ChevronLeft" size={14} />
          Retour
        </button>
      {:else}
        <span></span>
      {/if}

      <div class="flex items-center gap-3">
        {@render footer?.()}
      </div>
    </div>
  </footer>
</div>
