<script lang="ts">
  /**
   * Le parcours de configuration : sept ecrans, une decision par ecran.
   *
   * C'est tout ce qu'un serveur voit tant qu'il n'a rien pris. Pas de barre
   * laterale, pas d'en-tete, aucune page du tableau de bord a atteindre : il
   * n'y a rien a piloter tant que rien n'est monte. Ce qu'on ouvre en payant,
   * c'est le pilotage ; ce qu'on traverse ici, c'est la mise en place.
   *
   * Un serveur Discord se configure sur une centaine de reglages, et les
   * presenter par pages en fait une administration a laquelle personne ne
   * s'attelle le jour ou il decouvre le produit. Une question a la fois, en
   * plein ecran, avec une reponse deja selectionnee : on avance en confirmant
   * plutot qu'en remplissant.
   *
   * Chaque etape ecrit en la validant. Un parcours abandonne au quatrieme ecran
   * laisse donc un serveur reellement structure, et non un formulaire perdu ;
   * revenir plus tard reprend apres ce qui est deja fait plutot que de tout
   * redemander. En contrepartie « Retour » relit une etape sans la defaire :
   * c'est le prix d'un serveur qui se construit sous les yeux.
   */
  import { onMount } from 'svelte';
  import { router } from 'tinro';
  import { authStore } from '../lib/stores/auth.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { wizard } from '../lib/stores/onboardingWizard.svelte';
  import {
    THEMES,
    MODERATION_LEVELS,
    selectionFor,
    summarize,
    type ModerationLevel,
    type ServerKind,
    type ThemeKey,
  } from '../lib/onboardingWizard';
  import {
    fetchServerTemplate,
    applyServerTemplate,
    updateAutoModConfig,
    updateRaidProtection,
    fetchWelcomeConfig,
    updateWelcomeConfig,
    fetchBillingStatus,
    startCheckout,
    type ServerTemplateState,
    type BillingStatus,
  } from '../lib/api';
  import { AUTOMOD_PRESETS, type AutomodPreset } from '@kotbo/shared';
  import WizardShell from '../lib/components/onboarding/WizardShell.svelte';
  import ChoiceCard from '../lib/components/onboarding/ChoiceCard.svelte';
  import Papicon from '../lib/components/Papicon.svelte';

  let template = $state<ServerTemplateState | null>(null);
  let billing = $state<BillingStatus | null>(null);
  let loading = $state(true);
  let loadError = $state('');
  let busy = $state(false);

  /** Ce que l'etape « structure » a reellement pose, pour le recapitulatif. */
  let built = $state<{ roles: number; categories: number; channels: number; modules: number } | null>(null);

  let welcomeMessage = $state('');

  const selectedGuild = $derived(
    authStore.guilds.find((guild) => guild.id === authStore.selectedGuildId)
  );

  /**
   * Le type de serveur, pre-selectionne d'apres ce qu'on observe.
   *
   * `assessServerMaturity` mesure age, membres, salons et roles cote bot. La
   * reponse est donc deja cochee a l'ecran, avec ses motifs affiches : on
   * confirme au lieu de choisir a l'aveugle entre deux mots dont on ne mesure
   * pas les consequences.
   */
  const suggestedKind = $derived<ServerKind>(
    template?.maturity.maturity === 'established' ? 'existing' : 'new'
  );
  const kind = $derived<ServerKind>(wizard.kind ?? suggestedKind);
  const theme = $derived<ThemeKey>(wizard.theme ?? 'communaute');
  const moderation = $derived<ModerationLevel>(wizard.moderation ?? 'standard');

  const selection = $derived(
    template ? selectionFor(template.plan, kind, theme) : []
  );
  const plannedSummary = $derived(
    template ? summarize(template.plan, selection) : null
  );

  const structureBlocked = $derived(
    !!template && kind === 'new' && !template.canCreateChannels
  );

  async function load() {
    loading = true;
    loadError = '';
    try {
      const [tpl, bill] = await Promise.all([
        fetchServerTemplate(),
        fetchBillingStatus().catch(() => null),
      ]);
      template = tpl;
      billing = bill;

      // Le serveur fait foi : une structure deja posee ne se repropose pas.
      if (tpl?.applied) wizard.resumeAfter('structure');
    } catch (err: any) {
      loadError = err?.message || "La configuration n'a pas pu être chargée.";
    } finally {
      loading = false;
    }
  }

  // ── Étape « structure » ────────────────────────────────────────────────
  async function applyStructure() {
    if (!template || busy) return;
    busy = true;
    try {
      const result = await applyServerTemplate(selection);
      const created = result.items.filter((entry) => entry.created);
      const roles = created.filter((e) => e.key.startsWith('role.') || e.key === 'captcha.role').length;
      const categories = created.filter((e) => e.key.endsWith('.category')).length;
      built = {
        roles,
        categories,
        channels: created.length - roles - categories,
        modules: result.modules.length + result.preparedModules.length,
      };
      for (const warning of result.warnings) toast.info(warning);
      wizard.complete('structure');
    } catch (err: any) {
      toast.error(err?.message || "La structure n'a pas pu être posée.");
    } finally {
      busy = false;
    }
  }

  // ── Étape « modération » ───────────────────────────────────────────────
  async function applyModeration() {
    if (busy) return;
    const preset = AUTOMOD_PRESETS.find((entry: AutomodPreset) => entry.id === moderation);
    if (!preset) {
      toast.error('Niveau de protection inconnu.');
      return;
    }
    busy = true;
    try {
      // Deux ecritures, deux modules : les filtres de message et les seuils
      // anti-raid vivent dans deux configurations distinctes, et un prereglage
      // deplace les deux.
      await updateAutoModConfig(preset.filters);
      await updateRaidProtection(preset.raid);
      wizard.complete('moderation');
    } catch (err: any) {
      toast.error(err?.message || "La protection n'a pas pu être enregistrée.");
    } finally {
      busy = false;
    }
  }

  // ── Étape « accueil » ──────────────────────────────────────────────────
  async function loadWelcome() {
    try {
      const config = await fetchWelcomeConfig();
      welcomeMessage = config?.welcomeMessage
        || 'Bienvenue {user} sur **{server}** ! Prends le temps de lire le règlement. 🎉';
    } catch {
      welcomeMessage = 'Bienvenue {user} ! Prends le temps de lire le règlement. 🎉';
    }
  }

  async function applyGreeting() {
    if (busy) return;
    busy = true;
    try {
      await updateWelcomeConfig({ welcomeEnabled: true, welcomeMessage });
      wizard.complete('greeting');
    } catch (err: any) {
      toast.error(err?.message || "Le message d'accueil n'a pas pu être enregistré.");
    } finally {
      busy = false;
    }
  }

  // ── Étape « mise en service » ──────────────────────────────────────────
  /**
   * L'offre proposee, deduite de la taille du serveur.
   *
   * Le paiement passe par Stripe, et par lui seul : la page ouvre une session
   * et redirige, aucune donnee bancaire ne transite ici. L'essai est decide
   * cote serveur - le reclamer depuis le navigateur permettrait de le rejouer.
   */
  const offer = $derived(
    billing?.plans.find((card) => card.purchasable && card.key !== 'FREE') ?? null
  );

  const trialDays = $derived(billing?.trial.available ? billing.trial.days : 0);

  function formatPrice(cents: number): string {
    return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  }

  async function goToCheckout() {
    if (busy || !offer) return;
    busy = true;
    const url = await startCheckout(offer.key as 'PRO' | 'ULTIMATE', 'month');
    busy = false;
    if (!url) {
      toast.error("La page de paiement n'a pas pu être ouverte. Réessayez dans un instant.");
      return;
    }
    window.location.href = url;
  }

  function finishWithoutBilling() {
    wizard.complete('checkout');
    router.goto('/');
  }

  onMount(load);

  $effect(() => {
    const guildId = authStore.selectedGuildId;
    if (!guildId) return;
    wizard.initialize(guildId);
  });

  $effect(() => {
    if (wizard.step === 'greeting' && !welcomeMessage) void loadWelcome();
  });
</script>

{#if loading}
  <div class="min-h-screen bg-background flex items-center justify-center">
    <div class="w-full max-w-2xl px-6 space-y-3">
      <div class="h-8 w-1/2 rounded-lg bg-surface-container-low/50 animate-pulse"></div>
      <div class="h-24 rounded-2xl bg-surface-container-low/40 animate-pulse"></div>
      <div class="h-24 rounded-2xl bg-surface-container-low/40 animate-pulse"></div>
    </div>
  </div>

{:else if loadError}
  <div class="min-h-screen bg-background flex items-center justify-center px-6">
    <div class="w-full max-w-md rounded-2xl border border-error/30 bg-error/[0.04] p-6 text-center">
      <p class="text-sm font-semibold text-on-surface mb-1">Configuration indisponible</p>
      <p class="text-[13px] text-on-surface-variant leading-relaxed mb-4">{loadError}</p>
      <button
        type="button"
        onclick={load}
        class="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Réessayer
      </button>
    </div>
  </div>

<!-- ══ 1. Bienvenue ═══════════════════════════════════════════════════════ -->
{:else if wizard.step === 'welcome'}
  <WizardShell
    title={`Kotbo est arrivé sur ${selectedGuild?.name ?? 'votre serveur'}.`}
    lead="Sept questions, deux minutes, et votre serveur est configuré. Vous pourrez tout ajuster ensuite — rien de ce qui suit n'est définitif."
  >
    <ul class="space-y-3">
      {#each [
        { icon: 'sparkles', text: 'On pose les salons, les rôles et les permissions qui vont ensemble.' },
        { icon: 'shield', text: 'On règle la modération au niveau que vous choisissez.' },
        { icon: 'users', text: 'On prépare l\'accueil des arrivants.' },
      ] as row (row.text)}
        <li class="flex items-start gap-3">
          <div class="w-8 h-8 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Papicon icon={row.icon} size={15} />
          </div>
          <p class="text-[14px] text-on-surface-variant leading-relaxed pt-1">{row.text}</p>
        </li>
      {/each}
    </ul>

    {#snippet footer()}
      <button
        type="button"
        onclick={() => wizard.next()}
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        Commencer
        <Papicon icon="ChevronRight" size={15} />
      </button>
    {/snippet}
  </WizardShell>

<!-- ══ 2. Type de serveur ═════════════════════════════════════════════════ -->
{:else if wizard.step === 'kind'}
  <WizardShell
    title="D'où part ce serveur ?"
    lead="La suite n'est pas la même selon la réponse. Nous avons regardé votre serveur et coché la plus probable."
  >
    <div class="space-y-3">
      <ChoiceCard
        label="Un serveur tout neuf"
        pitch="Peu de salons, peu de rôles, tout reste à poser."
        detail="Kotbo pose la structure d'un coup : catégories, salons, rôles et permissions cohérents."
        icon="sparkles"
        selected={kind === 'new'}
        badge={suggestedKind === 'new' ? 'Recommandé' : undefined}
        onclick={() => wizard.answer({ kind: 'new' })}
      />
      <ChoiceCard
        label="Un serveur déjà en place"
        pitch="Des salons, des rôles, et peut-être déjà d'autres bots."
        detail="Kotbo ne touche à rien de votre arborescence : il se branche dessus et allume ses modules."
        icon="robot"
        selected={kind === 'existing'}
        badge={suggestedKind === 'existing' ? 'Recommandé' : undefined}
        onclick={() => wizard.answer({ kind: 'existing' })}
      />
    </div>

    {#if template?.maturity.reasons.length}
      <div class="mt-5 flex flex-wrap items-center gap-2">
        <span class="text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/40">
          Ce qu'on a lu
        </span>
        {#each template.maturity.reasons as reason (reason)}
          <span class="text-[12px] font-medium px-2 py-1 rounded-lg bg-surface-container-low/60 border border-outline-variant/30 text-on-surface-variant/70">
            {reason}
          </span>
        {/each}
      </div>
    {/if}

    {#snippet footer()}
      <button
        type="button"
        onclick={() => { wizard.answer({ kind }); wizard.next(); }}
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        Continuer
        <Papicon icon="ChevronRight" size={15} />
      </button>
    {/snippet}
  </WizardShell>

<!-- ══ 3. Vocation ════════════════════════════════════════════════════════ -->
{:else if wizard.step === 'theme'}
  <WizardShell
    title="À quoi sert ce serveur ?"
    lead={kind === 'existing'
      ? "La réponse décide des modules à allumer. Aucun salon ne sera créé."
      : "La réponse décide des salons à poser et des modules à allumer."}
  >
    <div class="space-y-3">
      {#each THEMES as entry (entry.key)}
        <ChoiceCard
          label={entry.label}
          pitch={entry.pitch}
          icon={entry.icon}
          selected={theme === entry.key}
          onclick={() => wizard.answer({ theme: entry.key })}
        />
      {/each}
    </div>

    {#snippet footer()}
      <button
        type="button"
        onclick={() => { wizard.answer({ theme }); wizard.next(); }}
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        Continuer
        <Papicon icon="ChevronRight" size={15} />
      </button>
    {/snippet}
  </WizardShell>

<!-- ══ 4. Structure ═══════════════════════════════════════════════════════ -->
{:else if wizard.step === 'structure'}
  <WizardShell
    title={kind === 'existing' ? 'Voilà ce que Kotbo va allumer.' : 'Voilà ce que Kotbo va poser.'}
    lead={kind === 'existing'
      ? "Rien ne sera créé ni déplacé sur votre serveur : seuls les modules changent d'état."
      : "Tout est prêt. Un clic, et ces salons existent sur votre serveur."}
  >
    {#if plannedSummary}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {#each [
          { n: plannedSummary.roles, label: 'rôles' },
          { n: plannedSummary.categories, label: 'catégories' },
          { n: plannedSummary.channels, label: 'salons' },
          { n: plannedSummary.modules, label: 'modules' },
        ] as stat (stat.label)}
          <div class="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 px-4 py-3">
            <p class="text-2xl font-bold tracking-tight text-primary">{stat.n}</p>
            <p class="text-[12px] font-medium text-on-surface-variant/60">{stat.label}</p>
          </div>
        {/each}
      </div>

      {#if plannedSummary.names.length > 0}
        <details class="rounded-xl border border-outline-variant/30 bg-surface-container-low/30">
          <summary class="cursor-pointer px-4 py-3 text-[13px] font-medium text-on-surface-variant hover:text-on-surface">
            Voir le détail
          </summary>
          <div class="px-4 pb-4 flex flex-wrap gap-1.5">
            {#each plannedSummary.names as name (name)}
              <span class="text-[12px] px-2 py-1 rounded-lg bg-surface-container text-on-surface-variant/80">{name}</span>
            {/each}
          </div>
        </details>
      {/if}
    {/if}

    {#if template?.applied}
      <p class="mt-4 text-[13px] text-on-surface-variant leading-relaxed rounded-xl border border-outline-variant/30 bg-surface-container-low/30 px-4 py-3">
        La structure a déjà été posée sur ce serveur : elle ne se rejoue pas, sans quoi
        les salons se dédoubleraient. Vous pouvez passer à la suite.
      </p>
    {:else if structureBlocked}
      <p class="mt-4 text-[13px] leading-relaxed rounded-xl border border-error/30 bg-error/[0.04] px-4 py-3 text-on-surface">
        Kotbo n'a pas la permission « Gérer les salons » : il ne peut rien créer. Donnez-la
        lui dans les paramètres du serveur, puis rechargez cette page.
      </p>
    {/if}

    {#snippet footer()}
      {#if template?.applied}
        <button
          type="button"
          onclick={() => wizard.next()}
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Continuer
          <Papicon icon="ChevronRight" size={15} />
        </button>
      {:else}
        <button
          type="button"
          onclick={applyStructure}
          disabled={busy || structureBlocked}
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'En cours…' : kind === 'existing' ? 'Allumer les modules' : 'Poser la structure'}
          <Papicon icon="ChevronRight" size={15} />
        </button>
      {/if}
    {/snippet}
  </WizardShell>

<!-- ══ 5. Modération ══════════════════════════════════════════════════════ -->
{:else if wizard.step === 'moderation'}
  <WizardShell
    title="Quel niveau de modération ?"
    lead="Filtres de messages et seuils anti-raid, réglés d'un coup. Vous pourrez affiner chaque filtre plus tard."
  >
    <div class="space-y-3">
      {#each MODERATION_LEVELS as level (level.key)}
        <ChoiceCard
          label={level.label}
          pitch={level.pitch}
          detail={level.detail}
          icon={level.icon}
          selected={moderation === level.key}
          badge={level.key === 'standard' ? 'Recommandé' : undefined}
          onclick={() => wizard.answer({ moderation: level.key })}
        />
      {/each}
    </div>

    {#snippet footer()}
      <button
        type="button"
        onclick={applyModeration}
        disabled={busy}
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {busy ? 'Enregistrement…' : 'Appliquer'}
        <Papicon icon="ChevronRight" size={15} />
      </button>
    {/snippet}
  </WizardShell>

<!-- ══ 6. Accueil ═════════════════════════════════════════════════════════ -->
{:else if wizard.step === 'greeting'}
  <WizardShell
    title="Comment accueillir les arrivants ?"
    lead="Ce message part automatiquement à chaque arrivée. Un serveur qui n'accueille pas perd la moitié de ses arrivants dans la première heure."
  >
    <label for="welcome-message" class="block text-[13px] font-semibold text-on-surface mb-2">
      Message de bienvenue
    </label>
    <textarea
      id="welcome-message"
      bind:value={welcomeMessage}
      rows="4"
      class="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low/40 px-4 py-3 text-[14px] text-on-surface
             placeholder-on-surface-variant/40 focus:outline-none focus:border-primary/50 resize-none"
      placeholder="Bienvenue {'{user}'} !"
    ></textarea>

    <p class="mt-2 text-[12px] text-on-surface-variant/55 leading-relaxed">
      <code class="px-1 py-0.5 rounded bg-surface-container text-on-surface-variant">{'{user}'}</code>
      mentionne l'arrivant,
      <code class="px-1 py-0.5 rounded bg-surface-container text-on-surface-variant">{'{server}'}</code>
      donne le nom du serveur. Les deux sont remplacés à l'envoi.
    </p>

    <!-- L'aperçu montre le résultat, pas le gabarit : personne ne relit une
         chaîne à variables pour savoir si sa phrase sonne bien. -->
    <div class="mt-5 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-4">
      <p class="text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/40 mb-2">
        Aperçu
      </p>
      <p class="text-[14px] text-on-surface leading-relaxed">
        {welcomeMessage
          .replaceAll('{user}', `@${authStore.user?.username ?? 'nouveau'}`)
          .replaceAll('{server}', selectedGuild?.name ?? 'votre serveur')
          .replaceAll('**', '')}
      </p>
    </div>

    {#snippet footer()}
      <button
        type="button"
        onclick={applyGreeting}
        disabled={busy || !welcomeMessage.trim()}
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {busy ? 'Enregistrement…' : 'Enregistrer'}
        <Papicon icon="ChevronRight" size={15} />
      </button>
    {/snippet}
  </WizardShell>

<!-- ══ 7. Mise en service ═════════════════════════════════════════════════ -->
{:else}
  <WizardShell
    title="Votre serveur est configuré."
    lead="Il ne manque plus que la mise en service : c'est elle qui allume les modules sur Discord."
  >
    {#if built}
      <div class="rounded-2xl border border-primary/35 bg-primary/[0.04] p-5 mb-5">
        <p class="text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/45 mb-3">
          Ce qui vient d'être monté
        </p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {#each [
            { n: built.roles, label: 'rôles' },
            { n: built.categories, label: 'catégories' },
            { n: built.channels, label: 'salons' },
            { n: built.modules, label: 'modules' },
          ] as stat (stat.label)}
            <div>
              <p class="text-2xl font-bold tracking-tight text-primary">{stat.n}</p>
              <p class="text-[12px] font-medium text-on-surface-variant/60">{stat.label}</p>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <ul class="space-y-2 mb-6">
      {#each [
        'Structure et permissions posées',
        `Modération réglée en « ${MODERATION_LEVELS.find((l) => l.key === moderation)?.label ?? 'équilibré'} »`,
        "Accueil des arrivants activé",
      ] as line (line)}
        <li class="flex items-start gap-2.5 text-[14px] text-on-surface-variant">
          <Papicon icon="check" size={13} class="mt-1 shrink-0 text-emerald-500" />
          <span>{line}</span>
        </li>
      {/each}
    </ul>

    {#if billing && !billing.enabled}
      <div class="rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 p-5">
        <p class="text-sm font-semibold text-on-surface mb-1">Pas de facturation sur cette instance</p>
        <p class="text-[13px] text-on-surface-variant leading-relaxed">
          Cette installation de Kotbo n'a pas de clé Stripe : tous les modules suivent la
          configuration du serveur, sans offre commerciale.
        </p>
      </div>
    {:else if offer}
      <div class="rounded-2xl border border-outline-variant/35 bg-surface-container-low/40 p-5">
        <div class="flex items-baseline justify-between gap-4 mb-2">
          <p class="text-sm font-semibold text-on-surface">{offer.name}</p>
          {#if offer.priceCents}
            <p class="text-lg font-bold tracking-tight text-on-surface">
              {formatPrice(offer.priceCents.month)}<span class="text-[13px] font-medium text-on-surface-variant/60">/mois</span>
            </p>
          {/if}
        </div>
        <p class="text-[13px] text-on-surface-variant leading-relaxed">
          {offer.description}
        </p>
        {#if trialDays > 0}
          <p class="mt-3 text-[13px] font-medium text-emerald-500">
            {trialDays} jours d'essai gratuit — vous ne serez débité qu'après, et vous pouvez
            arrêter avant.
          </p>
        {/if}
        <p class="mt-3 text-[12px] text-on-surface-variant/55 leading-relaxed">
          Le paiement se déroule entièrement sur Stripe : aucune donnée bancaire ne passe
          par Kotbo.
        </p>
      </div>
    {/if}

    {#snippet footer()}
      {#if offer}
        <button
          type="button"
          onclick={goToCheckout}
          disabled={busy}
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {busy ? 'Ouverture…' : trialDays > 0 ? `Démarrer l'essai de ${trialDays} jours` : 'Mettre en service'}
          <Papicon icon="ChevronRight" size={15} />
        </button>
      {:else}
        <button
          type="button"
          onclick={finishWithoutBilling}
          disabled={busy}
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          Accéder au tableau de bord
          <Papicon icon="ChevronRight" size={15} />
        </button>
      {/if}
    {/snippet}
  </WizardShell>
{/if}
