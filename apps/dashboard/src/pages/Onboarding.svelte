<script lang="ts">
  /**
   * Le parcours de configuration : onze ecrans, une decision par ecran.
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
   *
   * Quatre ecrans - la langue, le support, le reglement, la progression - ont
   * ete ajoutes aux sept d'origine. Ils ne servent pas a configurer davantage :
   * ils servent a ce qu'on reconnaisse son serveur a l'ecran de paiement. Un
   * reglement qu'on a relu, des motifs de ticket qu'on a coches, une couleur
   * qu'on a choisie : ce sont ces choses-la qu'on ne veut pas perdre. Trois des
   * quatre sont facultatifs, et le disent - c'est ce qui les empeche de peser.
   */
  import { onMount } from 'svelte';
  import { router } from 'tinro';
  import { authStore } from '../lib/stores/auth.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { wizard } from '../lib/stores/onboardingWizard.svelte';
  import {
    THEMES,
    MODERATION_LEVELS,
    LEVEL_RHYTHMS,
    RULE_PRESETS,
    TICKET_PRESETS,
    PANEL_COLORS,
    COMMON_TIMEZONES,
    REWARD_TIERS,
    OPTIONAL_STEPS,
    defaultTicketKeys,
    selectionFor,
    summarize,
    buildSequence,
    type LevelRhythm,
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
    fetchGuildLanguage,
    updateGuildLanguage,
    fetchGuildTimezone,
    updateGuildTimezone,
    fetchGuildState,
    completeOnboarding,
    createRegulationArticle,
    publishRegulation,
    patchTicketsConfig,
    updateLevelingConfig,
    addLevelingReward,
    type ServerTemplateState,
    type BillingStatus,
  } from '../lib/api';
  import { AUTOMOD_PRESETS, type AutomodPreset } from '@kotbo/shared';
  import WizardShell from '../lib/components/onboarding/WizardShell.svelte';
  import ChoiceCard from '../lib/components/onboarding/ChoiceCard.svelte';
  import KotboMark from '../lib/components/onboarding/KotboMark.svelte';
  import BuildSequence from '../lib/components/onboarding/BuildSequence.svelte';
  import CountUp from '../lib/components/onboarding/CountUp.svelte';
  import DiscordPreview from '../lib/components/onboarding/DiscordPreview.svelte';
  import DiscordEmbed from '../lib/components/onboarding/DiscordEmbed.svelte';
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

  const guildIconUrl = $derived(
    selectedGuild?.icon
      ? `https://cdn.discordapp.com/icons/${selectedGuild.id}/${selectedGuild.icon}.png?size=128`
      : null
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
  const rhythm = $derived<LevelRhythm>(wizard.rhythm ?? 'standard');
  const panelColor = $derived(wizard.panelColor ?? PANEL_COLORS[0].value);

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
      // Le saut passe par-dessus l'ecran « support », et c'est voulu : le
      // panneau de tickets a ete poste pendant cette pose, et le regler
      // maintenant ne le changerait plus. La page Tickets s'en charge.
      if (tpl?.applied) wizard.resumeAfter('structure');
    } catch (err: any) {
      loadError = err?.message || "La configuration n'a pas pu être chargée.";
    } finally {
      loading = false;
    }
  }

  // ── Étape « langue » ───────────────────────────────────────────────────
  let language = $state<'fr' | 'en'>('fr');
  let timezone = $state('Europe/Paris');
  let identityLoaded = $state(false);
  /** La langue en vigueur avant l'ecran : rien n'est reecrit si elle ne bouge pas. */
  let savedLanguage = $state<'fr' | 'en'>('fr');
  let savedTimezone = $state('Europe/Paris');

  async function loadIdentity() {
    identityLoaded = true;
    const [lang, zone] = await Promise.all([
      fetchGuildLanguage().catch(() => null),
      fetchGuildTimezone().catch(() => null),
    ]);
    if (lang?.locale) { language = lang.locale; savedLanguage = lang.locale; }
    if (zone?.timezone) { timezone = zone.timezone; savedTimezone = zone.timezone; }
  }

  /** L'heure qu'il est dans le fuseau retenu, pour verifier d'un coup d'oeil. */
  const localTime = $derived.by(() => {
    try {
      return new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit', minute: '2-digit', timeZone: timezone,
      }).format(new Date());
    } catch {
      return null;
    }
  });

  async function applyIdentity() {
    if (busy) return;
    busy = true;
    try {
      if (language !== savedLanguage) {
        await updateGuildLanguage({ language }, undefined, { silent: true });
        savedLanguage = language;
        // La maquette est nommee dans la langue du serveur : sans relecture,
        // l'ecran « structure » annoncerait des salons dans l'ancienne.
        template = await fetchServerTemplate();
      }
      if (timezone !== savedTimezone) {
        await updateGuildTimezone(timezone, undefined, { silent: true });
        savedTimezone = timezone;
      }
      wizard.complete('identity');
    } catch (err: any) {
      toast.error(err?.message || "La langue n'a pas pu être enregistrée.");
    } finally {
      busy = false;
    }
  }

  // ── Étape « structure » ────────────────────────────────────────────────
  /**
   * Trois temps : ce qui va etre pose, la pose, ce qui a ete pose.
   *
   * Le deuxieme n'existait pas - un bouton passait a « En cours… » et l'ecran
   * suivant annoncait des chiffres. C'est pourtant le seul moment ou l'on voit
   * le produit agir sur son propre serveur, et il durait autant que l'appel
   * reseau sans rien montrer.
   */
  let buildPhase = $state<'plan' | 'building' | 'built'>('plan');
  let buildReady = $state(false);
  let sequence = $state<{ key: string; name: string; kind: string }[]>([]);

  async function applyStructure() {
    if (!template || busy) return;

    sequence = buildSequence(template.plan, selection);
    // Sur un serveur habite, la selection ne contient que des modules : il n'y
    // a rien a regarder se poser, et une sequence vide se contenterait d'un
    // ecran fige. On garde alors l'attente courte d'origine.
    const animated = sequence.length > 0;

    busy = true;
    if (animated) { buildPhase = 'building'; buildReady = false; }

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

      if (animated) {
        // L'animation finit d'elle-meme, puis `onfinished` bascule sur le
        // recapitulatif : l'etape n'est validee qu'a ce moment-la.
        buildReady = true;
      } else {
        wizard.complete('structure');
      }
    } catch (err: any) {
      buildPhase = 'plan';
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
      await updateAutoModConfig(preset.filters, undefined, { silent: true });
      await updateRaidProtection(preset.raid, undefined, { silent: true });
      wizard.complete('moderation');
    } catch (err: any) {
      toast.error(err?.message || "La protection n'a pas pu être enregistrée.");
    } finally {
      busy = false;
    }
  }

  // ── Étape « accueil » ──────────────────────────────────────────────────
  /** Trois tons prets a poser : on part d'une phrase, on ne redige pas. */
  const GREETING_TONES = [
    { key: 'warm', label: 'Chaleureux', icon: 'heart', text: 'Bienvenue {user} sur **{server}** ! Installe-toi, présente-toi, et n\'hésite pas si tu as la moindre question. 🎉' },
    { key: 'plain', label: 'Sobre', icon: 'align-left', text: 'Bienvenue {user} sur **{server}**. Merci de lire le règlement avant de participer.' },
    { key: 'playful', label: 'Enjoué', icon: 'star', text: 'Un nouveau membre est apparu ! {user} rejoint **{server}**. 👋 Fais-toi plaisir, on ne mord pas.' },
  ];

  async function loadWelcome() {
    try {
      const config = await fetchWelcomeConfig();
      welcomeMessage = config?.welcomeMessage
        || 'Bienvenue {user} sur **{server}** ! Prends le temps de lire le règlement. 🎉';
    } catch {
      welcomeMessage = 'Bienvenue {user} ! Prends le temps de lire le règlement. 🎉';
    }
  }

  /** Le gabarit, avec ses variables remplacees : c'est ce que l'arrivant lira. */
  const greetingRendered = $derived(
    welcomeMessage
      .replaceAll('{user}', `@${authStore.user?.username ?? 'nouveau'}`)
      .replaceAll('{server}', selectedGuild?.name ?? 'votre serveur')
  );

  async function applyGreeting() {
    if (busy) return;
    busy = true;
    try {
      await updateWelcomeConfig({ welcomeEnabled: true, welcomeMessage }, undefined, { silent: true });
      wizard.complete('greeting');
    } catch (err: any) {
      toast.error(err?.message || "Le message d'accueil n'a pas pu être enregistré.");
    } finally {
      busy = false;
    }
  }

  // ── Étape « règlement » ────────────────────────────────────────────────
  /** Les articles retenus, editables : c'est l'edition qui en fait les siens. */
  let rules = $state(
    RULE_PRESETS.map((preset) => ({
      key: preset.key,
      emoji: preset.emoji,
      title: preset.title,
      description: preset.description,
      selected: preset.byDefault,
    }))
  );
  let editingRule = $state<string | null>(null);

  const selectedRules = $derived(rules.filter((rule) => rule.selected));

  async function applyRules() {
    if (busy) return;
    const wanted = selectedRules;
    if (wanted.length === 0) {
      wizard.complete('rules');
      return;
    }

    busy = true;
    try {
      // En serie et non en parallele : la route renumerote tout le reglement a
      // chaque creation, et deux ecritures concurrentes se disputeraient l'ordre.
      for (const rule of wanted) {
        // `dashboardMutation` rend un booleen et a deja signale l'echec : on
        // s'arrete la plutot que d'annoncer un reglement publie a moitie.
        const ok = await createRegulationArticle({
          title: rule.title.trim(),
          description: rule.description.trim(),
          emoji: rule.emoji,
          enabled: true,
        }, undefined, { silent: true });
        if (!ok) return;
      }

      // La publication demande un salon de reglement. La maquette en pose un,
      // mais un serveur habite peut ne pas en avoir : l'echec ne perd rien -
      // les articles sont ecrits et la page Règlement les publiera.
      try {
        await publishRegulation(undefined, { silent: true });
      } catch {
        toast.info("Le règlement est enregistré. Il sera publié depuis le tableau de bord, une fois son salon choisi.");
      }

      wizard.complete('rules');
    } catch (err: any) {
      toast.error(err?.message || "Le règlement n'a pas pu être enregistré.");
    } finally {
      busy = false;
    }
  }

  // ── Étape « support » ──────────────────────────────────────────────────
  let ticketKeys = $state<string[] | null>(null);

  /** Coches d'apres la vocation, tant que rien n'a ete touche a l'ecran. */
  const activeTicketKeys = $derived(ticketKeys ?? defaultTicketKeys(theme));
  const selectedTickets = $derived(
    TICKET_PRESETS.filter((entry) => activeTicketKeys.includes(entry.key))
  );

  function toggleTicket(key: string) {
    const current = activeTicketKeys;
    ticketKeys = current.includes(key)
      ? current.filter((entry) => entry !== key)
      : [...current, key];
  }

  async function applyTickets() {
    if (busy) return;
    busy = true;
    try {
      // `patchTicketsConfig` relit la configuration avant de la renvoyer : la
      // route des tickets remplace tout ce qu'elle recoit, et un corps partiel
      // reinitialiserait les quotas, l'archivage et le reste.
      await patchTicketsConfig({
        ticketEmbedColor: panelColor,
        ticketTypes: selectedTickets.map((entry) => ({
          id: entry.key,
          label: entry.label,
          description: entry.description,
          emoji: entry.emoji,
        })),
      }, undefined, { silent: true });
      wizard.complete('tickets');
    } catch (err: any) {
      toast.error(err?.message || "Le support n'a pas pu être enregistré.");
    } finally {
      busy = false;
    }
  }

  // ── Étape « progression » ──────────────────────────────────────────────
  let roles = $state<{ id: string; name: string; color?: string }[]>([]);
  let rolesLoaded = $state(false);
  let rewards = $state<Record<number, string>>({});

  async function loadRoles() {
    rolesLoaded = true;
    try {
      const state = await fetchGuildState();
      // Les roles geres par Discord lui-meme - @everyone, roles de bots - ne
      // peuvent pas etre attribues en recompense : les proposer serait offrir
      // un choix qui echouerait a l'enregistrement.
      const discordRoles = (state?.discordRoles ?? []) as { id?: string; name?: string; color?: string }[];
      roles = discordRoles.filter(
        (role): role is { id: string; name: string; color?: string } =>
          !!role?.id && !!role?.name && role.name !== '@everyone',
      );
    } catch {
      roles = [];
    }
  }

  const rhythmConfig = $derived(
    LEVEL_RHYTHMS.find((entry) => entry.key === rhythm)?.config ?? LEVEL_RHYTHMS[1].config
  );

  async function applyLevels() {
    if (busy) return;
    busy = true;
    try {
      await updateLevelingConfig({ enabled: true, ...rhythmConfig }, undefined, { silent: true });

      // Un palier deja pris - la table impose un role par niveau et par serveur -
      // fait echouer sa seule ligne. Le reste des paliers doit passer quand meme.
      for (const level of REWARD_TIERS) {
        const roleId = rewards[level];
        if (!roleId) continue;
        try {
          await addLevelingReward(level, roleId, undefined, { silent: true });
        } catch {
          toast.info(`Le palier ${level} avait déjà une récompense : il n'a pas été remplacé.`);
        }
      }

      wizard.complete('levels');
    } catch (err: any) {
      toast.error(err?.message || "La progression n'a pas pu être enregistrée.");
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

  /**
   * Ce serveur a-t-il quelque chose a payer pour finir ?
   *
   * Le bot repond (`onboardingCanFinishWithoutPayment`) : instance sans
   * facturation, ou acces deja accorde - offre posee a la main, abonnement en
   * cours, code de partenariat. Ces serveurs traversent le parcours comme les
   * autres, mais on ne leur reclame pas une seconde fois ce qu'ils ont deja.
   */
  const canFinishWithoutPayment = $derived(
    dashboardStore.state.onboardingCanFinishWithoutPayment === true
  );

  const trialDays = $derived(billing?.trial.available ? billing.trial.days : 0);

  /** Ce qui a ete regle pendant le parcours, relu a l'ecran de paiement. */
  const achievements = $derived([
    { icon: 'layout-grid', label: 'Structure et permissions', value: 'posées sur Discord' },
    { icon: 'shield', label: 'Modération', value: MODERATION_LEVELS.find((l) => l.key === moderation)?.label ?? 'Équilibré' },
    { icon: 'door-open', label: 'Accueil des arrivants', value: 'activé' },
    ...(wizard.isDone('rules') && selectedRules.length
      ? [{ icon: 'book-open', label: 'Règlement', value: `${selectedRules.length} articles` }]
      : []),
    ...(wizard.isDone('tickets') && selectedTickets.length
      ? [{ icon: 'inbox', label: 'Support', value: `${selectedTickets.length} motifs de ticket` }]
      : []),
    ...(wizard.isDone('levels')
      ? [{ icon: 'crown', label: 'Progression', value: LEVEL_RHYTHMS.find((l) => l.key === rhythm)?.label ?? 'Équilibré' }]
      : []),
  ]);

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

  /**
   * Sortie du parcours quand il n'y a rien a payer.
   *
   * La cloture s'ecrit sur le serveur, pas dans le navigateur : c'est elle qui
   * ouvre le tableau de bord, et c'est le bot qui verifie qu'elle est due. Sans
   * cet aller-retour, le parcours se rouvrirait au prochain chargement - et un
   * simple drapeau local aurait suffi a le sauter sur n'importe quel serveur.
   */
  async function finishWithoutBilling() {
    if (busy) return;
    busy = true;
    try {
      await completeOnboarding();
      wizard.complete('checkout');
      // Le drapeau `onboardingRequired` vient du bot : sans relecture, la page
      // resterait sur le parcours qu'on vient de clore.
      await dashboardStore.refresh();
      router.goto('/');
    } catch (err: any) {
      toast.error(err?.message || "La mise en service n'a pas pu être enregistrée.");
    } finally {
      busy = false;
    }
  }

  /** Traverser sans rien decider : reserve aux ecrans facultatifs. */
  function skip() {
    wizard.next();
  }

  const isOptional = $derived(OPTIONAL_STEPS.includes(wizard.step));

  onMount(load);

  $effect(() => {
    const guildId = authStore.selectedGuildId;
    if (!guildId) return;
    wizard.initialize(guildId);
  });

  $effect(() => {
    if (wizard.step === 'identity' && !identityLoaded) void loadIdentity();
    if (wizard.step === 'greeting' && !welcomeMessage) void loadWelcome();
    if (wizard.step === 'levels' && !rolesLoaded) void loadRoles();
  });
</script>

{#snippet skipLink()}
  {#if isOptional}
    <button
      type="button"
      onclick={skip}
      class="text-[13px] font-medium text-on-surface-variant/50 hover:text-on-surface transition-colors"
    >
      Passer
    </button>
  {/if}
{/snippet}

{#if loading}
  <div class="min-h-screen bg-background flex flex-col items-center justify-center gap-6">
    <KotboMark size={52} halo />
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

<!-- ══ 1. Bienvenue ══════════════════════════════════════════════════════════ -->
{:else if wizard.step === 'welcome'}
  <WizardShell title="" bare>
    <!-- La rencontre : le bot et le serveur, cote a cote. C'est la seule image
         du parcours, et elle dit ce qui vient de se passer mieux qu'une phrase. -->
    <div class="flex flex-col items-center text-center">
      <div class="flex items-center gap-4 sm:gap-5">
        <KotboMark size={72} halo />
        <Papicon icon="plus" size={18} class="text-on-surface-variant/35" />
        {#if guildIconUrl}
          <img src={guildIconUrl} alt="" class="w-[72px] h-[72px] rounded-[22%] object-cover" />
        {:else}
          <div class="w-[72px] h-[72px] rounded-[22%] bg-surface-container flex items-center justify-center text-xl font-bold text-on-surface-variant/60">
            {(selectedGuild?.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
        {/if}
      </div>

      <h1 class="mt-7 text-2xl sm:text-[30px] leading-tight font-semibold tracking-tight text-on-surface font-headline">
        Kotbo est arrivé sur {selectedGuild?.name ?? 'votre serveur'}.
      </h1>
      <p class="mt-3 max-w-lg text-[15px] text-on-surface-variant/75 leading-relaxed">
        Quelques questions, et votre serveur est monté, protégé et prêt à accueillir.
        Vous pourrez tout ajuster ensuite — rien de ce qui suit n'est définitif.
      </p>

      <div class="mt-4 inline-flex items-center gap-2 rounded-full border border-outline-variant/35 bg-surface-container-low/40 px-3 py-1.5">
        <Papicon icon="clock" size={13} class="text-primary" />
        <span class="text-[12.5px] font-medium text-on-surface-variant/70">Environ 3 minutes</span>
      </div>
    </div>

    <ul class="mt-9 grid gap-3 sm:grid-cols-2">
      {#each [
        { icon: 'layout-grid', title: 'Une structure complète', text: 'Salons, catégories, rôles et permissions cohérents, posés d\'un coup.' },
        { icon: 'shield', title: 'Une modération réglée', text: 'Filtres de messages et seuils anti-raid, au niveau que vous choisissez.' },
        { icon: 'door-open', title: 'Un accueil préparé', text: 'Message de bienvenue, règlement publié, rôles à l\'arrivée.' },
        { icon: 'inbox', title: 'Un support ouvert', text: 'Un panneau de tickets avec vos motifs et votre couleur.' },
      ] as row (row.title)}
        <li class="rounded-2xl border border-outline-variant/30 bg-surface-container-low/30 p-4">
          <div class="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-2.5">
            <Papicon icon={row.icon} size={16} />
          </div>
          <p class="text-[14px] font-semibold text-on-surface">{row.title}</p>
          <p class="mt-1 text-[13px] text-on-surface-variant/65 leading-relaxed">{row.text}</p>
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

<!-- ══ 2. Type de serveur ════════════════════════════════════════════════════ -->
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
        <span class="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/40">
          <Papicon icon="check-circle" size={12} />
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

<!-- ══ 3. Langue et fuseau ═══════════════════════════════════════════════════ -->
{:else if wizard.step === 'identity'}
  <WizardShell
    title="Dans quelle langue Kotbo doit-il parler ?"
    lead="Elle vaut pour tout ce que le bot écrit : ses réponses, ses panneaux, et le nom des salons qu'il va poser."
  >
    <div class="grid gap-3 sm:grid-cols-2">
      {#each [
        { key: 'fr' as const, label: 'Français', flag: '🇫🇷', samples: ['#règlement', '#bienvenue', '#général'] },
        { key: 'en' as const, label: 'English', flag: '🇬🇧', samples: ['#rules', '#welcome', '#general'] },
      ] as option (option.key)}
        <button
          type="button"
          onclick={() => (language = option.key)}
          aria-pressed={language === option.key}
          class="text-left rounded-2xl border p-4 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
          {language === option.key
            ? 'border-primary bg-primary/[0.05] shadow-sm shadow-primary/10'
            : 'border-outline-variant/40 hover:border-primary/45 hover:bg-surface-container-low/50'}"
        >
          <div class="flex items-center gap-2.5">
            <span class="text-xl leading-none">{option.flag}</span>
            <span class="text-[15px] font-semibold text-on-surface">{option.label}</span>
            {#if language === option.key}
              <span class="ml-auto w-4 h-4 rounded-full bg-primary text-on-primary flex items-center justify-center">
                <Papicon icon="check" size={10} />
              </span>
            {/if}
          </div>
          <!-- Les noms de salons sont l'effet le plus visible du choix : les
               montrer evite d'avoir a l'expliquer. -->
          <div class="mt-3 flex flex-wrap gap-1.5">
            {#each option.samples as sample (sample)}
              <span class="text-[12px] px-1.5 py-0.5 rounded-md bg-surface-container text-on-surface-variant/70">{sample}</span>
            {/each}
          </div>
        </button>
      {/each}
    </div>

    <div class="mt-6">
      <label for="timezone" class="flex items-center gap-2 text-[13px] font-semibold text-on-surface mb-2">
        <Papicon icon="clock" size={14} class="text-primary" />
        Fuseau horaire
      </label>
      <div class="flex items-center gap-3">
        <select
          id="timezone"
          bind:value={timezone}
          class="flex-1 min-w-0 rounded-xl border border-outline-variant/40 bg-surface-container-low/40 px-4 py-2.5 text-[14px] text-on-surface focus:outline-none focus:border-primary/50"
        >
          {#each COMMON_TIMEZONES as zone (zone.value)}
            <option value={zone.value}>{zone.label}</option>
          {/each}
          <!-- Un fuseau deja regle et absent de la liste courte resterait
               invisible dans le menu, et le simple fait d'ouvrir cet ecran le
               remplacerait par Paris. -->
          {#if !COMMON_TIMEZONES.some((zone) => zone.value === timezone)}
            <option value={timezone}>{timezone}</option>
          {/if}
        </select>
        {#if localTime}
          <span class="shrink-0 text-[13px] font-medium text-on-surface-variant/60 tabular-nums">
            il est {localTime}
          </span>
        {/if}
      </div>
      <p class="mt-2 text-[12px] text-on-surface-variant/55 leading-relaxed">
        Il décide de l'heure des rapports, des concours programmés et des statistiques quotidiennes.
      </p>
    </div>

    {#snippet footer()}
      <button
        type="button"
        onclick={applyIdentity}
        disabled={busy}
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {busy ? 'Enregistrement…' : 'Continuer'}
        <Papicon icon="ChevronRight" size={15} />
      </button>
    {/snippet}
  </WizardShell>

<!-- ══ 4. Vocation ═══════════════════════════════════════════════════════════ -->
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

<!-- ══ 5. Support ════════════════════════════════════════════════════════════ -->
{:else if wizard.step === 'tickets'}
  <WizardShell
    title="Pourquoi vous écrit-on ?"
    lead="Chaque motif retenu devient un bouton sur le panneau que Kotbo posera dans un instant. Un ticket ouvert crée un salon privé entre le membre et votre staff."
  >
    <div class="grid gap-2 sm:grid-cols-2">
      {#each TICKET_PRESETS as preset (preset.key)}
        {@const selected = activeTicketKeys.includes(preset.key)}
        <button
          type="button"
          onclick={() => toggleTicket(preset.key)}
          aria-pressed={selected}
          class="text-left rounded-xl border p-3.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
          {selected
            ? 'border-primary bg-primary/[0.05]'
            : 'border-outline-variant/35 hover:border-primary/40 hover:bg-surface-container-low/40'}"
        >
          <div class="flex items-center gap-2">
            <span class="text-[15px] leading-none">{preset.emoji}</span>
            <span class="text-[14px] font-semibold text-on-surface">{preset.label}</span>
            {#if selected}
              <span class="ml-auto w-4 h-4 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center">
                <Papicon icon="check" size={10} />
              </span>
            {/if}
          </div>
          <p class="mt-1 text-[12.5px] text-on-surface-variant/60 leading-relaxed">{preset.description}</p>
        </button>
      {/each}
    </div>

    <div class="mt-6">
      <p class="flex items-center gap-2 text-[13px] font-semibold text-on-surface mb-2.5">
        <Papicon icon="palette" size={14} class="text-primary" />
        La couleur de vos panneaux
      </p>
      <div class="flex flex-wrap gap-2">
        {#each PANEL_COLORS as color (color.value)}
          <button
            type="button"
            onclick={() => wizard.answer({ panelColor: color.value })}
            aria-pressed={panelColor === color.value}
            aria-label={color.label}
            title={color.label}
            class="w-9 h-9 rounded-xl border-2 transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
            {panelColor === color.value ? 'border-on-surface/70' : 'border-transparent'}"
            style="background-color: {color.value}"
          ></button>
        {/each}
      </div>
    </div>

    <div class="mt-6">
      <p class="text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/40 mb-2">
        Le panneau tel qu'il sera posté
      </p>
      <DiscordPreview channel="support">
        <DiscordEmbed
          color={panelColor}
          title="Besoin d'aide ?"
          description={selectedTickets.length
            ? "Choisissez un motif ci-dessous : un salon privé s'ouvrira avec l'équipe."
            : "Aucun motif retenu : le panneau proposera un ticket générique."}
          buttons={selectedTickets.map((entry) => ({ emoji: entry.emoji, label: entry.label }))}
        />
      </DiscordPreview>
    </div>

    {#snippet footer()}
      {@render skipLink()}
      <button
        type="button"
        onclick={applyTickets}
        disabled={busy}
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {busy ? 'Enregistrement…' : 'Enregistrer'}
        <Papicon icon="ChevronRight" size={15} />
      </button>
    {/snippet}
  </WizardShell>

<!-- ══ 6. Structure ══════════════════════════════════════════════════════════ -->
{:else if wizard.step === 'structure'}
  <WizardShell
    title={buildPhase === 'built'
      ? 'Votre serveur vient de prendre forme.'
      : buildPhase === 'building'
        ? 'Kotbo travaille sur votre serveur.'
        : kind === 'existing' ? 'Voilà ce que Kotbo va allumer.' : 'Voilà ce que Kotbo va poser.'}
    lead={buildPhase === 'built'
      ? "Tout est en place sur Discord. Vous pouvez déjà aller voir — la suite continue ici."
      : buildPhase === 'building'
        ? "Ouvrez Discord dans un autre onglet : ce que vous voyez défiler apparaît en direct."
        : kind === 'existing'
          ? "Rien ne sera créé ni déplacé sur votre serveur : seuls les modules changent d'état."
          : "Tout est prêt. Un clic, et ces salons existent sur votre serveur."}
    canGoBack={buildPhase === 'plan'}
  >
    {#if buildPhase === 'building'}
      <BuildSequence
        items={sequence}
        ready={buildReady}
        onfinished={() => (buildPhase = 'built')}
      />

    {:else if buildPhase === 'built' && built}
      <div class="rounded-2xl border border-primary/35 bg-primary/[0.04] p-6 text-center">
        <div class="flex justify-center mb-4">
          <KotboMark size={48} halo />
        </div>
        <p class="text-[15px] font-semibold text-on-surface mb-5">
          {built.roles + built.categories + built.channels} éléments créés sur Discord
        </p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {#each [
            { n: built.roles, label: 'rôles' },
            { n: built.categories, label: 'catégories' },
            { n: built.channels, label: 'salons' },
            { n: built.modules, label: 'modules' },
          ] as stat (stat.label)}
            <div>
              <p class="text-2xl font-bold tracking-tight text-primary"><CountUp value={stat.n} /></p>
              <p class="text-[12px] font-medium text-on-surface-variant/60">{stat.label}</p>
            </div>
          {/each}
        </div>
      </div>

    {:else}
      {#if plannedSummary}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {#each [
            { n: plannedSummary.roles, label: 'rôles', icon: 'shield' },
            { n: plannedSummary.categories, label: 'catégories', icon: 'folder' },
            { n: plannedSummary.channels, label: 'salons', icon: 'message-circle' },
            { n: plannedSummary.modules, label: 'modules', icon: 'toggle-right' },
          ] as stat (stat.label)}
            <div class="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 px-4 py-3">
              <Papicon icon={stat.icon} size={14} class="text-primary/70 mb-1.5" />
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
              <!-- Deux salons peuvent legitimement porter le meme nom dans des
                   categories differentes. Leur position garde chaque ligne
                   distincte sans provoquer de cle Svelte dupliquee. -->
              {#each plannedSummary.names as name, index (index)}
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
    {/if}

    {#snippet footer()}
      {#if buildPhase === 'building'}
        <span class="text-[13px] font-medium text-on-surface-variant/50">Montage en cours…</span>
      {:else if buildPhase === 'built'}
        <button
          type="button"
          onclick={() => wizard.complete('structure')}
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Continuer
          <Papicon icon="ChevronRight" size={15} />
        </button>
      {:else if template?.applied}
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

<!-- ══ 7. Modération ═════════════════════════════════════════════════════════ -->
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

<!-- ══ 8. Accueil ════════════════════════════════════════════════════════════ -->
{:else if wizard.step === 'greeting'}
  <WizardShell
    title="Comment accueillir les arrivants ?"
    lead="Ce message part automatiquement à chaque arrivée. Un serveur qui n'accueille pas perd la moitié de ses arrivants dans la première heure."
  >
    <div class="flex flex-wrap gap-2 mb-4">
      {#each GREETING_TONES as tone (tone.key)}
        <button
          type="button"
          onclick={() => (welcomeMessage = tone.text)}
          class="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/40 bg-surface-container-low/40 px-3 py-1.5 text-[12.5px] font-medium text-on-surface-variant/80
                 hover:border-primary/45 hover:text-on-surface transition-colors"
        >
          <Papicon icon={tone.icon} size={13} />
          {tone.label}
        </button>
      {/each}
    </div>

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
    <div class="mt-5">
      <p class="text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/40 mb-2">
        Ce que verra l'arrivant
      </p>
      <DiscordPreview channel="bienvenue" content={greetingRendered} />
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

<!-- ══ 9. Règlement ══════════════════════════════════════════════════════════ -->
{:else if wizard.step === 'rules'}
  <WizardShell
    title="Quelles règles sur ce serveur ?"
    lead="Décochez ce qui ne vous ressemble pas, réécrivez le reste. Kotbo publiera le règlement dans son salon."
  >
    <div class="space-y-2">
      {#each rules as rule (rule.key)}
        <div
          class="rounded-2xl border transition-colors
          {rule.selected ? 'border-primary/45 bg-primary/[0.04]' : 'border-outline-variant/35 bg-surface-container-low/20'}"
        >
          <div class="flex items-start gap-3 p-4">
            <button
              type="button"
              onclick={() => (rule.selected = !rule.selected)}
              aria-pressed={rule.selected}
              aria-label={rule.selected ? `Retirer « ${rule.title} »` : `Ajouter « ${rule.title} »`}
              class="mt-0.5 w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors
              {rule.selected
                ? 'bg-primary border-primary text-on-primary'
                : 'border-outline-variant/60 text-transparent hover:border-primary/50'}"
            >
              <Papicon icon="check" size={11} />
            </button>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-[15px] leading-none">{rule.emoji}</span>
                <p class="text-[14px] font-semibold text-on-surface">{rule.title}</p>
                {#if rule.selected}
                  <button
                    type="button"
                    onclick={() => (editingRule = editingRule === rule.key ? null : rule.key)}
                    class="ml-auto shrink-0 inline-flex items-center gap-1 text-[12px] font-medium text-on-surface-variant/55 hover:text-primary transition-colors"
                  >
                    <Papicon icon="pencil" size={11} />
                    {editingRule === rule.key ? 'Terminer' : 'Modifier'}
                  </button>
                {/if}
              </div>

              {#if editingRule === rule.key}
                <!-- Le titre s'edite au meme titre que le texte : c'est lui
                     qu'on lit en premier dans le reglement publie, et le laisser
                     fige revenait a proposer d'ecrire ses regles sans pouvoir
                     les nommer. -->
                <input
                  bind:value={rule.title}
                  maxlength="80"
                  aria-label="Titre de l'article"
                  class="mt-2 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low/50 px-3 py-2 text-[13px] font-semibold text-on-surface
                         focus:outline-none focus:border-primary/50"
                />
                <textarea
                  bind:value={rule.description}
                  rows="3"
                  aria-label="Texte de l'article"
                  class="mt-2 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low/50 px-3 py-2 text-[13px] text-on-surface
                         focus:outline-none focus:border-primary/50 resize-none"
                ></textarea>
              {:else}
                <p class="mt-1 text-[13px] text-on-surface-variant/65 leading-relaxed">{rule.description}</p>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>

    <div class="mt-6">
      <p class="text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/40 mb-2">
        Ce qui sera publié
      </p>
      {#if selectedRules.length}
        <DiscordPreview channel="règlement">
          <DiscordEmbed
            color={panelColor}
            title={`Règlement de ${selectedGuild?.name ?? 'votre serveur'}`}
            description="En participant à ce serveur, vous acceptez les règles suivantes."
            fields={selectedRules.map((rule) => ({ emoji: rule.emoji, name: rule.title, value: rule.description }))}
          />
        </DiscordPreview>
      {:else}
        <p class="rounded-xl border border-outline-variant/30 bg-surface-container-low/30 px-4 py-3 text-[13px] text-on-surface-variant/60">
          Aucun article retenu : rien ne sera publié. Vous pourrez écrire votre règlement
          depuis le tableau de bord.
        </p>
      {/if}
    </div>

    {#snippet footer()}
      {@render skipLink()}
      <button
        type="button"
        onclick={applyRules}
        disabled={busy || selectedRules.some((rule) => !rule.title.trim() || !rule.description.trim())}
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {busy ? 'Publication…' : selectedRules.length ? `Publier ${selectedRules.length} articles` : 'Continuer'}
        <Papicon icon="ChevronRight" size={15} />
      </button>
    {/snippet}
  </WizardShell>

<!-- ══ 10. Progression ═══════════════════════════════════════════════════════ -->
{:else if wizard.step === 'levels'}
  <WizardShell
    title="Faut-il récompenser les membres actifs ?"
    lead="Chaque message et chaque minute en vocal rapportent de l'expérience. Les membres montent en niveau, et peuvent gagner des rôles en chemin."
  >
    <div class="space-y-3">
      {#each LEVEL_RHYTHMS as entry (entry.key)}
        <ChoiceCard
          label={entry.label}
          pitch={entry.pitch}
          detail={entry.detail}
          icon={entry.icon}
          selected={rhythm === entry.key}
          badge={entry.key === 'standard' ? 'Recommandé' : undefined}
          onclick={() => wizard.answer({ rhythm: entry.key })}
        />
      {/each}
    </div>

    <div class="mt-6">
      <p class="flex items-center gap-2 text-[13px] font-semibold text-on-surface mb-1">
        <Papicon icon="award" size={14} class="text-primary" />
        Des rôles à débloquer
        <span class="font-normal text-on-surface-variant/50">— facultatif</span>
      </p>
      <p class="text-[12.5px] text-on-surface-variant/60 leading-relaxed mb-3">
        Le rôle est donné automatiquement au passage du niveau. C'est ce qui fait qu'on
        regarde sa progression.
      </p>

      {#if roles.length === 0}
        <p class="rounded-xl border border-outline-variant/30 bg-surface-container-low/30 px-4 py-3 text-[13px] text-on-surface-variant/60">
          {rolesLoaded
            ? "Aucun rôle attribuable n'a été trouvé. Vous ajouterez vos paliers depuis la page Niveaux."
            : 'Lecture des rôles du serveur…'}
        </p>
      {:else}
        <div class="space-y-2">
          {#each REWARD_TIERS as level (level)}
            <div class="flex items-center gap-3 rounded-xl border border-outline-variant/35 bg-surface-container-low/25 px-4 py-2.5">
              <span class="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-surface">
                <span class="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-[12px] font-bold">
                  {level}
                </span>
                Niveau {level}
              </span>
              <select
                bind:value={rewards[level]}
                aria-label={`Rôle offert au niveau ${level}`}
                class="flex-1 min-w-0 rounded-lg border border-outline-variant/40 bg-surface-container-lowest/60 px-3 py-1.5 text-[13px] text-on-surface focus:outline-none focus:border-primary/50"
              >
                <option value={undefined}>Aucun rôle</option>
                {#each roles as role (role.id)}
                  <option value={role.id}>@{role.name}</option>
                {/each}
              </select>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#snippet footer()}
      {@render skipLink()}
      <button
        type="button"
        onclick={applyLevels}
        disabled={busy}
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {busy ? 'Enregistrement…' : 'Activer la progression'}
        <Papicon icon="ChevronRight" size={15} />
      </button>
    {/snippet}
  </WizardShell>

<!-- ══ 11. Mise en service ═══════════════════════════════════════════════════ -->
{:else}
  <WizardShell
    title="Votre serveur est configuré."
    lead="Il ne manque plus que la mise en service : c'est elle qui allume les modules sur Discord."
  >
    <!-- La carte du serveur : son icone, son nom, ce qu'il porte maintenant.
         C'est ce qu'on s'apprete a laisser derriere soi en fermant l'onglet. -->
    <div class="rounded-2xl border border-primary/35 bg-primary/[0.04] overflow-hidden mb-5">
      <div class="flex items-center gap-3.5 px-5 py-4 border-b border-primary/20">
        {#if guildIconUrl}
          <img src={guildIconUrl} alt="" class="w-12 h-12 rounded-2xl object-cover shrink-0" />
        {:else}
          <div class="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center text-base font-bold text-on-surface-variant/60 shrink-0">
            {(selectedGuild?.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
        {/if}
        <div class="min-w-0">
          <p class="text-[15px] font-semibold text-on-surface truncate">{selectedGuild?.name ?? 'Votre serveur'}</p>
          <p class="text-[12.5px] text-on-surface-variant/60">Configuré avec Kotbo</p>
        </div>
        <KotboMark size={28} class="ml-auto shrink-0" />
      </div>

      {#if built}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 px-5 py-4 border-b border-primary/15">
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
      {/if}

      <ul class="px-5 py-4 space-y-2.5">
        {#each achievements as item (item.label)}
          <li class="flex items-center gap-2.5 text-[13.5px]">
            <span class="w-6 h-6 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Papicon icon={item.icon} size={12} />
            </span>
            <span class="text-on-surface-variant/85">{item.label}</span>
            <span class="ml-auto text-on-surface-variant/55 text-right">{item.value}</span>
          </li>
        {/each}
      </ul>
    </div>

    {#if billing && !billing.enabled}
      <div class="rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 p-5">
        <p class="text-sm font-semibold text-on-surface mb-1">Pas de facturation sur cette instance</p>
        <p class="text-[13px] text-on-surface-variant leading-relaxed">
          Cette installation de Kotbo n'a pas de clé Stripe : tous les modules suivent la
          configuration du serveur, sans offre commerciale.
        </p>
      </div>
    {:else if canFinishWithoutPayment}
      <!-- Acces deja accorde : abonnement en cours, offre posee a la main, code
           de partenariat. Le parcours se traverse quand meme - c'est lui qui
           monte le serveur - mais il ne se conclut pas par une caisse. -->
      <div class="rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 p-5">
        <p class="text-sm font-semibold text-on-surface mb-1">Votre accès est déjà ouvert</p>
        <p class="text-[13px] text-on-surface-variant leading-relaxed">
          Ce serveur dispose déjà de son accès à Kotbo : il n'y a rien à régler ici. La
          configuration que vous venez de poser s'applique dès maintenant.
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
          <p class="mt-3 flex items-start gap-2 text-[13px] font-medium text-emerald-500">
            <Papicon icon="gift" size={14} class="mt-0.5 shrink-0" />
            <span>
              {trialDays} jours d'essai gratuit — vous ne serez débité qu'après, et vous pouvez
              arrêter avant.
            </span>
          </p>
        {/if}
        <p class="mt-3 flex items-start gap-2 text-[12px] text-on-surface-variant/55 leading-relaxed">
          <Papicon icon="lock" size={12} class="mt-0.5 shrink-0" />
          <span>
            Le paiement se déroule entièrement sur Stripe : aucune donnée bancaire ne passe
            par Kotbo.
          </span>
        </p>
      </div>
    {/if}

    {#snippet footer()}
      {#if offer && !canFinishWithoutPayment}
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
