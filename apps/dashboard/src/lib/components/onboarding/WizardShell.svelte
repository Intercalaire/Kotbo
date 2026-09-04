<script lang="ts">
  /**
   * Le cadre du parcours de configuration.
   *
   * Il ne porte que trois choses : ou l'on en est, de quoi revenir, et de quoi
   * sortir vers un autre serveur. Pas de barre laterale, pas d'en-tete, pas de
   * fil d'Ariane - il n'y a rien a naviguer. Ce qu'on traverse ici n'est pas
   * une section du tableau de bord, c'est ce qui vient avant lui.
   *
   * La barre de progression est nommee plutot que chiffree : « 3 sur 7 » ne dit
   * pas ou l'on va, alors qu'une suite d'etapes lisibles montre d'un coup d'oeil
   * ce qui reste et rassure sur la longueur du parcours.
   */
  import type { Snippet } from 'svelte';
  import { authStore } from '../../stores/auth.svelte';
  import { wizard } from '../../stores/onboardingWizard.svelte';
  import { WIZARD_STEPS, STEP_TITLES } from '../../onboardingWizard';
  import Papicon from '../Papicon.svelte';

  const {
    title,
    lead,
    children,
    footer,
    canGoBack = true,
  }: {
    title: string;
    lead?: string;
    children?: Snippet;
    footer?: Snippet;
    canGoBack?: boolean;
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
</script>

<div class="min-h-screen bg-background text-on-background flex flex-col">
  <!-- ── En-tête minimal : identité, serveur, sortie ──────────────────────── -->
  <header class="shrink-0 border-b border-outline-variant/25">
    <div class="mx-auto w-full max-w-2xl px-6 py-4 flex items-center justify-between gap-4">
      <div class="flex items-center gap-2.5 min-w-0">
        <img src="/favicon.svg" alt="" class="w-7 h-7 rounded-lg shrink-0" />
        <span class="font-semibold tracking-tight text-on-surface shrink-0">Kotbo</span>
        {#if selectedGuild}
          <span class="text-on-surface-variant/25 shrink-0">/</span>
          <span class="flex items-center gap-1.5 min-w-0">
            {#if guildIconUrl}
              <img src={guildIconUrl} alt="" class="w-4 h-4 rounded shrink-0" />
            {/if}
            <span class="text-[13px] font-medium text-on-surface-variant/70 truncate">
              {selectedGuild.name}
            </span>
          </span>
        {/if}
      </div>

      <a
        href="/servers"
        class="shrink-0 text-[13px] font-medium text-on-surface-variant/50 hover:text-on-surface transition-colors"
      >
        Changer de serveur
      </a>
    </div>
  </header>

  <!-- ── Progression ──────────────────────────────────────────────────────── -->
  <div class="shrink-0 border-b border-outline-variant/25 bg-surface-container-lowest/40">
    <div class="mx-auto w-full max-w-2xl px-6 py-3">
      <div class="flex items-center gap-1.5">
        {#each WIZARD_STEPS as step, position (step)}
          <div class="flex-1 min-w-0">
            <div
              class="h-1 rounded-full transition-colors duration-500
              {position < index
                ? 'bg-primary'
                : position === index
                  ? 'bg-primary/60'
                  : 'bg-outline-variant/30'}"
            ></div>
          </div>
        {/each}
      </div>
      <p class="mt-2 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/45">
        Étape {index + 1} sur {wizard.total} — {STEP_TITLES[wizard.step]}
      </p>
    </div>
  </div>

  <!-- ── L'écran ──────────────────────────────────────────────────────────── -->
  <main class="flex-1 mx-auto w-full max-w-2xl px-6 py-10 sm:py-14">
    <h1 class="text-2xl sm:text-[28px] leading-tight font-semibold tracking-tight text-on-surface font-headline">
      {title}
    </h1>
    {#if lead}
      <p class="mt-2.5 text-[15px] text-on-surface-variant/75 leading-relaxed">{lead}</p>
    {/if}

    <div class="mt-8">
      {@render children?.()}
    </div>
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
