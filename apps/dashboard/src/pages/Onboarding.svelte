<script lang="ts">
  /**
   * Premiere etape apres l'arrivee du bot : d'ou part ce serveur ?
   *
   * Les deux publics de Kotbo n'ont rien a faire du meme ecran. Un serveur qui
   * vient d'etre cree n'a ni salons ni roles et veut qu'on lui pose une
   * structure ; un serveur etabli en a deja trop et veut surtout qu'on ne
   * touche a rien - il veut reprendre ce que ses anciens bots faisaient. Leur
   * servir la meme page de reglages, c'est se tromper pour l'un des deux a
   * coup sur.
   *
   * D'ou cette question posee une fois, en deux cartes. Elle ne se stocke
   * nulle part : elle n'aiguille que vers la page suivante, et on peut revenir
   * en arriere. Une preference enregistree ici serait une preference de plus a
   * maintenir, pour une decision qui ne se prend qu'une fois.
   *
   * La page se rend sans MainLayout (voir App.svelte) : a ce stade aucun
   * module n'est ouvert, une barre laterale pleine de pages fermees ne
   * montrerait que des portes closes.
   */
  import { onMount } from 'svelte';
  import { router } from 'tinro';
  import { authStore } from '../lib/stores/auth.svelte';
  import { fetchOnboardingProfile, type OnboardingProfile } from '../lib/api';
  import Papicon from '../lib/components/Papicon.svelte';

  const selectedGuild = $derived(
    authStore.guilds.find((guild) => guild.id === authStore.selectedGuildId)
  );

  const guildIconUrl = $derived(
    selectedGuild?.icon
      ? `https://cdn.discordapp.com/icons/${selectedGuild.id}/${selectedGuild.icon}.png?size=64`
      : null
  );

  const paths = [
    {
      key: 'new',
      icon: 'sparkles',
      title: 'Un serveur tout neuf',
      pitch: "Peu de salons, peu de rôles, tout reste à poser.",
      detail:
        "Kotbo pose la structure d'un coup : catégories, salons, rôles et permissions cohérents. Vous ajustez ensuite, plutôt que de partir d'une page blanche.",
      cta: 'Monter le serveur',
      href: '/setup',
      accent: 'primary',
    },
    {
      key: 'existing',
      icon: 'robot',
      title: 'Un serveur déjà en place',
      pitch: 'Des salons, des rôles, et déjà un ou plusieurs bots.',
      detail:
        "Kotbo regarde ce qui tourne déjà - MEE6, Dyno, Carl-bot, Ticket Tool et les autres - et propose de reprendre leur configuration. Rien n'est écrit sans votre accord.",
      cta: 'Reprendre l\'existant',
      href: '/migration',
      accent: 'secondary',
    },
  ];

  let profile = $state<OnboardingProfile | null>(null);
  let reading = $state(true);

  const recommended = $derived(profile?.recommendation.path ?? null);
  const reasons = $derived(profile?.recommendation.reasons ?? []);

  /**
   * Ce qui est dit de la recommandation.
   *
   * `likely` quand les signaux se contredisent - un serveur ancien mais vide,
   * un serveur d'une semaine deja peuple. Le formuler franchement vaut mieux
   * que d'affirmer : quelqu'un qui sent l'hesitation relit les raisons, et
   * c'est exactement ce qu'on veut qu'il fasse.
   */
  const verdict = $derived.by(() => {
    if (!profile) return null;
    const { path, confidence } = profile.recommendation;
    if (path === 'existing') {
      return confidence === 'sure'
        ? 'Ce serveur tourne déjà : mieux vaut reprendre que reposer.'
        : 'Ce serveur a de quoi être repris plutôt que reposé.';
    }
    return confidence === 'sure'
      ? "Ce serveur est vierge : il n'y a rien à reprendre, tout à poser."
      : "Ce serveur a peu de choses en place : il y a surtout à poser.";
  });

  onMount(async () => {
    try {
      profile = await fetchOnboardingProfile();
    } catch {
      // La recommandation est un confort, pas une condition : sans elle la
      // page pose sa question comme elle le faisait avant.
      profile = null;
    } finally {
      reading = false;
    }
  });

  function choose(href: string) {
    router.goto(href);
  }
</script>

<div class="min-h-screen bg-background text-on-background">
  <div class="mx-auto w-full max-w-4xl px-6 py-10 sm:py-16">

    <div class="mb-10 flex items-center justify-between gap-4">
      <div class="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" class="w-7 h-7 rounded-lg" />
        <span class="font-semibold tracking-tight text-on-surface">Kotbo</span>
      </div>
      <a
        href="/servers"
        class="text-[13px] font-medium text-on-surface-variant/60 hover:text-on-surface transition-colors"
      >
        Changer de serveur
      </a>
    </div>

    <div class="mb-10">
      {#if selectedGuild}
        <div class="flex items-center gap-3 mb-5">
          {#if guildIconUrl}
            <img src={guildIconUrl} alt="" class="w-10 h-10 rounded-xl shrink-0" />
          {:else}
            <div class="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0">
              {selectedGuild.name.slice(0, 1).toUpperCase()}
            </div>
          {/if}
          <div class="min-w-0">
            <p class="text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/50">Kotbo est arrivé sur</p>
            <p class="font-semibold tracking-tight text-on-surface truncate">{selectedGuild.name}</p>
          </div>
        </div>
      {/if}

      <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight text-on-surface font-headline mb-2">
        D'où part ce serveur ?
      </h1>
      <p class="text-on-surface-variant/70 font-medium max-w-xl">
        {verdict ?? "La suite n'est pas la même selon la réponse."}
        Vous pourrez revenir sur ce choix.
      </p>

      <!-- Les observations qui fondent la recommandation. Les montrer permet
           de la contredire en connaissance de cause - c'est la difference
           entre un conseil et une case pre-cochee. -->
      {#if reasons.length > 0}
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <span class="text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/40">
            Ce qu'on a lu
          </span>
          {#each reasons as reason (reason)}
            <span class="text-[12px] font-medium px-2 py-1 rounded-lg bg-surface-container-low/60 border border-outline-variant/30 text-on-surface-variant/70">
              {reason}
            </span>
          {/each}
        </div>
      {/if}
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      {#each paths as path (path.key)}
        {@const isRecommended = recommended === path.key}
        <button
          type="button"
          onclick={() => choose(path.href)}
          class="group relative text-left rounded-2xl border bg-surface-container-low/40 p-6
                 hover:bg-surface-container-low/70 transition-all duration-200
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                 {isRecommended
                   ? 'border-primary/60 bg-primary/[0.04] shadow-sm shadow-primary/10'
                   : 'border-outline-variant/40 hover:border-primary/50'}
                 {reading ? 'opacity-90' : ''}"
        >
          {#if isRecommended}
            <span class="absolute top-4 right-4 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full bg-primary/15 text-primary">
              <Papicon icon="star" size={10} />
              Recommandé
            </span>
          {/if}

          <div
            class="w-11 h-11 rounded-xl flex items-center justify-center mb-4
                   {path.accent === 'primary'
                     ? 'bg-primary/10 text-primary'
                     : 'bg-secondary/10 text-secondary'}"
          >
            <Papicon icon={path.icon} size={20} />
          </div>

          <h2 class="text-base font-semibold text-on-surface mb-1">{path.title}</h2>
          <p class="text-[13px] font-medium text-on-surface-variant/70 mb-3">{path.pitch}</p>
          <p class="text-[13px] text-on-surface-variant/60 leading-relaxed mb-5">{path.detail}</p>

          <span class="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
            {path.cta}
            <Papicon icon="ChevronRight" size={14} class="group-hover:translate-x-0.5 transition-transform" />
          </span>
        </button>
      {/each}
    </div>

    <!-- La sortie de secours. Sans elle, quelqu'un qui ne se reconnait dans
         aucune des deux cartes n'a plus qu'a fermer l'onglet. -->
    <p class="mt-8 text-[13px] text-on-surface-variant/50 font-medium">
      Vous savez déjà où aller ?
      <button
        type="button"
        onclick={() => choose('/setup')}
        class="font-semibold text-on-surface-variant/70 hover:text-primary transition-colors underline underline-offset-2"
      >
        Aller directement à la prise en main
      </button>
    </p>
  </div>
</div>
