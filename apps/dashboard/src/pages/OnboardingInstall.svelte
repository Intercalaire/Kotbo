<script lang="ts">
  /**
   * L'installation : Kotbo monte le serveur, et le montre en le montant.
   *
   * Le parcours precedent disait quoi regler et ou aller le regler - seize
   * points, seize pages, et tout le travail a fournir par quelqu'un qui
   * decouvre le produit. On lui demandait l'effort avant de lui avoir montre le
   * resultat, ce qui est l'ordre inverse de celui qui donne envie d'acheter.
   *
   * Ici il ne reste qu'un bouton. Ce qui suit tient en quatre etapes, et
   * chacune s'affiche pendant qu'elle se fait plutot qu'apres : ce sont de
   * vrais appels, dont on montre les vrais resultats a mesure qu'ils
   * reviennent. Un seul appel silencieux de trente secondes produirait le meme
   * serveur et pas le meme effet - le travail fourni ne se verrait pas, et
   * c'est sa visibilite qui donne au resultat sa valeur percue.
   *
   * Rien ne part sans le clic, y compris sur un serveur neuf. La proposition
   * arrive cochee - c'est tout l'interet - mais personne ne doit decouvrir des
   * salons crees dans son dos.
   *
   * Au bout, l'essai s'ouvre sans carte. C'est le moment ou le serveur qu'on
   * vient de voir se construire se met a fonctionner pour de bon, et c'est
   * volontairement la qu'il tombe : demander une carte pour voir tourner ce
   * qu'on vient de monter arreterait la moitie des gens juste avant.
   */
  import { onMount } from 'svelte';
  import { router } from 'tinro';
  import { authStore } from '../lib/stores/auth.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import {
    fetchServerTemplate,
    applyServerTemplate,
    runAutopilotStep,
    type ServerTemplateState,
    type AutopilotStepResult,
  } from '../lib/api';
  import {
    addCounts,
    estimateManualMinutes,
    formatDuration,
    EMPTY_COUNTS,
    type AutopilotCounts,
  } from '../lib/onboardingEstimate';
  import Papicon from '../lib/components/Papicon.svelte';

  /**
   * La porte choisie a l'aiguillage, lue dans l'URL.
   *
   * Elle ne change pas ce qui est propose - c'est la maturite reelle du serveur
   * qui decide de la selection, et elle est mesuree cote bot - mais elle change
   * ce qui est dit. Quelqu'un qui a repondu « serveur deja en place » doit lire
   * d'abord qu'on ne touchera pas a son arborescence ; c'est sa crainte, et la
   * taire lui ferait fermer l'onglet.
   */
  const path = new URLSearchParams(window.location.search).get('path') === 'existing'
    ? 'existing'
    : 'new';

  type StepKey = 'structure' | 'wiring' | 'demo' | 'trial';
  type StepState = 'waiting' | 'running' | 'done' | 'failed';

  const STEPS: { key: StepKey; label: string; hint: string; icon: string }[] = [
    { key: 'structure', label: 'La structure', hint: 'Catégories, salons, rôles et permissions', icon: 'sparkles' },
    { key: 'wiring', label: 'Les branchements', hint: 'Ce qui relie les réglages aux salons posés', icon: 'link' },
    { key: 'demo', label: 'Ce qui se voit', hint: 'Règlement publié, panneaux en place', icon: 'megaphone' },
    { key: 'trial', label: "L'ouverture", hint: 'Les modules passent en service', icon: 'star' },
  ];

  let template = $state<ServerTemplateState | null>(null);
  let loading = $state(true);
  let loadError = $state('');

  let running = $state(false);
  let finished = $state(false);
  let states = $state<Record<StepKey, StepState>>({
    structure: 'waiting', wiring: 'waiting', demo: 'waiting', trial: 'waiting',
  });
  let lines = $state<Record<StepKey, string[]>>({
    structure: [], wiring: [], demo: [], trial: [],
  });
  let warnings = $state<string[]>([]);
  let fatal = $state('');
  let counts = $state<AutopilotCounts>({ ...EMPTY_COUNTS });
  let trial = $state<AutopilotStepResult['trial'] | null>(null);

  const selectedGuild = $derived(
    authStore.guilds.find((guild) => guild.id === authStore.selectedGuildId)
  );

  const isEstablished = $derived(
    path === 'existing' || template?.maturity.maturity === 'established'
  );

  /** Ce que la proposition va poser, resume par nature plutot qu'enumere. */
  const proposal = $derived.by(() => {
    if (!template) return null;
    const selected = new Set(template.defaultSelection);
    const items = template.plan.filter((entry) => selected.has(entry.key));
    return {
      roles: items.filter((entry) => entry.kind === 'role').length,
      categories: items.filter((entry) => entry.kind === 'category').length,
      channels: items.filter((entry) => entry.kind === 'text' || entry.kind === 'voice').length,
      modules: items.filter((entry) => entry.kind === 'module').length,
      names: items.filter((entry) => entry.kind !== 'module').map((entry) => entry.name),
    };
  });

  const blocked = $derived(!!template && !template.canCreateChannels && !isEstablished);
  const alreadyApplied = $derived(!!template?.applied);

  const manualMinutes = $derived(estimateManualMinutes(counts));

  async function load() {
    loading = true;
    loadError = '';
    try {
      template = await fetchServerTemplate();
    } catch (err: any) {
      loadError = err?.message || "Le plan de mise en place n'a pas pu être lu.";
    } finally {
      loading = false;
    }
  }

  /**
   * Marque l'etape et laisse le rendu la peindre avant de partir.
   *
   * Sans cette respiration, un appel qui revient en 200 ms passe de « en
   * attente » a « fait » sans jamais s'afficher comme en cours : la page
   * clignote au lieu de raconter. Le delai n'invente rien - l'etape tourne
   * bien - il garantit seulement qu'on la voit tourner.
   */
  async function breathe(ms = 420) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  function absorb(step: StepKey, result: AutopilotStepResult | null, done: string[], warn: string[]) {
    lines[step] = done;
    if (warn.length > 0) warnings = [...warnings, ...warn];
    if (result) counts = addCounts(counts, result.counts);
    states[step] = 'done';
  }

  async function install() {
    if (!template || running) return;
    running = true;
    fatal = '';
    warnings = [];
    counts = { ...EMPTY_COUNTS };

    try {
      // ── 1. La structure ────────────────────────────────────────────────
      states.structure = 'running';
      await breathe();

      if (alreadyApplied) {
        // La maquette ne se rejoue pas : elle a son propre verrou cote serveur,
        // et le forcer doublerait des salons. On enchaine sur le reste, qui est
        // idempotent et rattrape ce qui manque.
        lines.structure = ['Structure déjà posée : on enchaîne sur les branchements'];
        states.structure = 'done';
      } else {
        const applied = await applyServerTemplate(template.defaultSelection);
        const created = applied.items.filter((entry) => entry.created);
        const roles = created.filter((entry) => entry.key.startsWith('role.') || entry.key === 'captcha.role').length;
        const categories = created.filter((entry) => entry.key.endsWith('.category')).length;
        const channels = created.length - roles - categories;
        const modules = applied.modules.length + applied.preparedModules.length;

        const done: string[] = [];
        if (roles > 0) done.push(`${roles} rôle${roles > 1 ? 's' : ''} créé${roles > 1 ? 's' : ''}`);
        if (categories > 0) done.push(`${categories} catégorie${categories > 1 ? 's' : ''}`);
        if (channels > 0) done.push(`${channels} salon${channels > 1 ? 's' : ''}`);
        if (modules > 0) done.push(`${modules} modules configurés`);
        if (applied.panelSent) done.push('Panneau de tickets posé');
        if (done.length === 0) done.push('Rien à créer : tout était déjà en place');

        counts = addCounts(counts, { roles, categories, channels, modules });
        lines.structure = done;
        if (applied.warnings.length > 0) warnings = [...warnings, ...applied.warnings];
        states.structure = 'done';
      }

      // ── 2, 3, 4 ────────────────────────────────────────────────────────
      for (const step of ['wiring', 'demo', 'trial'] as const) {
        states[step] = 'running';
        await breathe();
        const result = await runAutopilotStep(step);
        if (step === 'trial') trial = result.trial ?? null;
        absorb(step, result, result.done, result.warnings);
      }

      finished = true;

      // L'essai vient de monter l'offre : sans relecture, la coquille du tunnel
      // resterait en place au-dessus d'un serveur qui n'y est plus.
      await dashboardStore.refresh();
    } catch (err: any) {
      fatal = err?.message || "La mise en place s'est interrompue.";
      for (const step of STEPS) {
        if (states[step.key] === 'running') states[step.key] = 'failed';
      }
    } finally {
      running = false;
    }
  }

  onMount(load);
</script>

<div class="min-h-screen bg-background text-on-background">
  <div class="mx-auto w-full max-w-3xl px-6 py-10 sm:py-14">

    <div class="mb-10 flex items-center justify-between gap-4">
      <div class="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" class="w-7 h-7 rounded-lg" />
        <span class="font-semibold tracking-tight text-on-surface">Kotbo</span>
      </div>
      {#if !running && !finished}
        <a
          href="/onboarding"
          class="text-[13px] font-medium text-on-surface-variant/60 hover:text-on-surface transition-colors"
        >
          Retour
        </a>
      {/if}
    </div>

    {#if loading}
      <div class="space-y-3">
        {#each Array(3) as _}
          <div class="h-24 rounded-2xl bg-surface-container-low/40 animate-pulse"></div>
        {/each}
      </div>

    {:else if loadError}
      <div class="rounded-2xl border border-error/30 bg-error/[0.04] p-6">
        <p class="text-sm font-semibold text-on-surface mb-1">Plan de mise en place indisponible</p>
        <p class="text-[13px] text-on-surface-variant leading-relaxed">{loadError}</p>
        <button
          type="button"
          onclick={load}
          class="mt-4 px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Réessayer
        </button>
      </div>

    {:else if !running && !finished}
      <!-- ── La proposition, cochée, un clic ────────────────────────────── -->
      <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight text-on-surface font-headline mb-2">
        {isEstablished ? 'Voilà ce que Kotbo va reprendre' : 'Voilà ce que Kotbo va monter'}
      </h1>
      <p class="text-on-surface-variant/70 font-medium max-w-xl mb-8">
        {#if isEstablished}
          Votre serveur tourne déjà : rien de son arborescence ne sera touché. Kotbo se
          branche sur ce qui existe et allume ce qu'il sait faire.
        {:else}
          Tout est préparé et coché. Un clic, et le serveur est debout dans deux minutes —
          vous ajusterez ensuite, plutôt que de partir d'une page blanche.
        {/if}
      </p>

      {#if selectedGuild}
        <p class="text-[13px] text-on-surface-variant/60 font-medium mb-6">
          Sur <span class="font-semibold text-on-surface">{selectedGuild.name}</span>
        </p>
      {/if}

      {#if proposal}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {#each [
            { n: proposal.roles, label: 'rôles' },
            { n: proposal.categories, label: 'catégories' },
            { n: proposal.channels, label: 'salons' },
            { n: proposal.modules, label: 'modules' },
          ] as stat (stat.label)}
            <div class="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 px-4 py-3">
              <p class="text-2xl font-bold tracking-tight text-primary">{stat.n}</p>
              <p class="text-[12px] font-medium text-on-surface-variant/60">{stat.label}</p>
            </div>
          {/each}
        </div>

        {#if proposal.names.length > 0}
          <details class="mb-6 rounded-xl border border-outline-variant/30 bg-surface-container-low/30">
            <summary class="cursor-pointer px-4 py-3 text-[13px] font-medium text-on-surface-variant hover:text-on-surface">
              Voir le détail de ce qui sera créé
            </summary>
            <div class="px-4 pb-4 flex flex-wrap gap-1.5">
              {#each proposal.names as name (name)}
                <span class="text-[12px] px-2 py-1 rounded-lg bg-surface-container text-on-surface-variant/80">{name}</span>
              {/each}
            </div>
          </details>
        {/if}
      {/if}

      {#if alreadyApplied}
        <p class="mb-6 text-[13px] text-on-surface-variant leading-relaxed rounded-xl border border-outline-variant/30 bg-surface-container-low/30 px-4 py-3">
          La structure a déjà été posée sur ce serveur : elle ne se rejoue pas. Le reste de
          la mise en place — branchements, publications, ouverture — s'exécutera quand même
          et rattrapera ce qui manque.
        </p>
      {/if}

      {#if blocked}
        <p class="mb-6 text-[13px] leading-relaxed rounded-xl border border-error/30 bg-error/[0.04] px-4 py-3 text-on-surface">
          Kotbo n'a pas la permission « Gérer les salons » sur ce serveur : il ne peut rien
          créer. Donnez-la lui dans les paramètres du serveur, puis rechargez cette page.
        </p>
      {/if}

      <button
        type="button"
        onclick={install}
        disabled={blocked}
        class="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary text-on-primary text-sm font-semibold
               hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shadow-primary/20"
      >
        {isEstablished ? 'Reprendre mon serveur' : 'Monter mon serveur'}
        <Papicon icon="ChevronRight" size={15} />
      </button>

      <p class="mt-3 text-[12px] text-on-surface-variant/50 font-medium">
        Rien n'est écrit avant ce clic. Aucune carte bancaire n'est demandée.
      </p>

    {:else}
      <!-- ── L'installation en direct, puis le récapitulatif ────────────── -->
      <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight text-on-surface font-headline mb-2">
        {finished ? 'Votre serveur est prêt.' : 'Kotbo monte votre serveur…'}
      </h1>
      <p class="text-on-surface-variant/70 font-medium mb-8">
        {finished
          ? 'Tout ce qui suit existe vraiment : allez le voir sur Discord.'
          : 'Restez sur cette page, ça prend moins de deux minutes.'}
      </p>

      <ol class="space-y-2 mb-8">
        {#each STEPS as step (step.key)}
          {@const state = states[step.key]}
          <li
            class="rounded-2xl border px-5 py-4 transition-colors duration-300
            {state === 'done'
              ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
              : state === 'running'
                ? 'border-primary/40 bg-primary/[0.04]'
                : state === 'failed'
                  ? 'border-error/40 bg-error/[0.04]'
                  : 'border-outline-variant/25'}"
          >
            <div class="flex items-start gap-3">
              <div
                class="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center mt-0.5
                {state === 'done'
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : state === 'running'
                    ? 'bg-primary/15 text-primary animate-pulse'
                    : state === 'failed'
                      ? 'bg-error/15 text-error'
                      : 'bg-surface-container text-on-surface-variant/40'}"
              >
                <Papicon icon={state === 'done' ? 'check' : step.icon} size={14} />
              </div>

              <div class="min-w-0 flex-1">
                <p class="text-[14px] font-semibold text-on-surface leading-tight">{step.label}</p>
                <p class="text-[12.5px] text-on-surface-variant/60 mt-0.5">{step.hint}</p>

                {#if lines[step.key].length > 0}
                  <ul class="mt-2.5 space-y-1">
                    {#each lines[step.key] as line (line)}
                      <li class="flex items-start gap-2 text-[13px] text-on-surface-variant">
                        <Papicon icon="check" size={12} class="mt-1 shrink-0 text-emerald-500" />
                        <span>{line}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ol>

      {#if fatal}
        <div class="rounded-2xl border border-error/30 bg-error/[0.04] p-5 mb-6">
          <p class="text-sm font-semibold text-on-surface mb-1">La mise en place s'est arrêtée</p>
          <p class="text-[13px] text-on-surface-variant leading-relaxed mb-3">{fatal}</p>
          <p class="text-[12.5px] text-on-surface-variant/60 leading-relaxed mb-3">
            Rien n'est perdu : ce qui a été posé est enregistré, et relancer reprend là où
            ça s'est arrêté sans rien créer deux fois.
          </p>
          <button
            type="button"
            onclick={install}
            class="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Reprendre
          </button>
        </div>
      {/if}

      {#if finished}
        <!-- ── Le récapitulatif chiffré ─────────────────────────────────── -->
        <div class="rounded-2xl border border-primary/40 bg-primary/[0.05] p-6 mb-4">
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-5">
            {#each [
              { n: counts.roles, label: 'rôles' },
              { n: counts.categories, label: 'catégories' },
              { n: counts.channels, label: 'salons' },
              { n: counts.modules, label: 'modules' },
              { n: counts.settings, label: 'réglages' },
            ] as stat (stat.label)}
              <div>
                <p class="text-2xl font-bold tracking-tight text-primary">{stat.n}</p>
                <p class="text-[12px] font-medium text-on-surface-variant/60">{stat.label}</p>
              </div>
            {/each}
          </div>

          {#if manualMinutes > 0}
            <p class="text-[13px] text-on-surface-variant leading-relaxed">
              À la main, dans Discord et dans le dashboard, il aurait fallu compter
              <span class="font-semibold text-on-surface">environ {formatDuration(manualMinutes)}</span>
              — et savoir quoi brancher sur quoi. C'est une estimation basse&nbsp;: elle ne
              compte pas le temps passé à chercher les bons réglages.
            </p>
          {/if}
        </div>

        {#if trial?.granted}
          <div class="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5 mb-4">
            <p class="text-sm font-semibold text-on-surface mb-1">
              Tout est en service pour {trial.days} jours.
            </p>
            <p class="text-[13px] text-on-surface-variant leading-relaxed">
              L'essai a été ouvert sans carte bancaire : les modules de l'offre
              {trial.plan} tournent réellement sur votre serveur dès maintenant. Vous
              choisirez de continuer — ou non — avant la fin. Rien ne se déclenche tout seul.
            </p>
          </div>
        {:else if trial && !trial.granted}
          <div class="rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 p-5 mb-4">
            <p class="text-sm font-semibold text-on-surface mb-1">L'essai n'a pas pu être ouvert</p>
            <p class="text-[13px] text-on-surface-variant leading-relaxed">
              {trial.reason === 'already_used'
                ? "L'essai gratuit a déjà été utilisé, sur ce serveur ou avec ce compte : il est offert une seule fois."
                : 'Ce serveur a déjà un abonnement en cours.'}
              La configuration, elle, est bien en place.
            </p>
          </div>
        {/if}

        {#if warnings.length > 0}
          <details class="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-5 mb-4">
            <summary class="cursor-pointer text-sm font-semibold text-on-surface">
              {warnings.length} point{warnings.length > 1 ? 's' : ''} à regarder
            </summary>
            <ul class="mt-3 space-y-1.5">
              {#each warnings as warning (warning)}
                <li class="text-[13px] text-on-surface-variant leading-relaxed">— {warning}</li>
              {/each}
            </ul>
          </details>
        {/if}

        {#if isEstablished}
          <p class="text-[13px] text-on-surface-variant leading-relaxed mb-4">
            Votre ancien bot avait des réglages que Kotbo ne peut pas deviner —
            niveaux, messages, tickets. La page
            <a href="/migration" class="text-primary hover:underline font-medium">Reprise</a>
            détecte ce qui tourne encore et propose de le récupérer.
          </p>
        {/if}

        <div class="flex flex-wrap gap-3">
          <button
            type="button"
            onclick={() => router.goto('/formation?unlocked=1')}
            class="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Apprendre à m'en servir
            <Papicon icon="ChevronRight" size={15} />
          </button>
          <a
            href={`https://discord.com/channels/${authStore.selectedGuildId}`}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-outline-variant/50 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-colors"
          >
            Voir le serveur sur Discord
          </a>
        </div>
      {/if}
    {/if}
  </div>
</div>
