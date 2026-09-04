<script lang="ts">
  /**
   * Formation : apprendre a conduire le serveur qu'on vient de monter.
   *
   * Le parcours de prise en main dit ce qui est regle. Il ne dit pas comment on
   * s'en sert, et ce n'est pas la meme question : quelqu'un peut avoir designe
   * un salon de logs sans avoir jamais ouvert le journal, avoir un role
   * moderateur sans savoir ou l'on pose une sanction. Un serveur entierement
   * configure par une personne qui n'a rien manipule reste un serveur que
   * personne ne sait conduire - et c'est ainsi qu'on perd quelqu'un le
   * lendemain de son paiement.
   *
   * D'ou une piste par categorie du parcours - les memes quatre, pas un
   * decoupage de plus - en deux temps : les reglages, lus de la configuration
   * reelle, et les gestes, qu'on fait une fois pour comprendre ou ca se passe.
   *
   * C'est aussi la page ou l'on arrive apres l'activation. Le paiement debloque
   * tout d'un coup : une centaine de reglages qui etaient fermes s'ouvrent a la
   * seconde ou Stripe repond. Renvoyer sur un dashboard soudain entierement
   * ouvert, sans rien dire, c'est rendre le moment illisible - on ne voit pas
   * ce qu'on a gagne, et on ne sait pas par ou commencer. La banniere de
   * deverrouillage le dit, et cette page enchaine.
   */
  import { onMount } from 'svelte';
  import { authStore } from '../lib/stores/auth.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { setupJourney } from '../lib/stores/setupJourney.svelte';
  import { formationStore } from '../lib/stores/formation.svelte';
  import { onboardingStore } from '../lib/stores/tutorial.svelte';
  import { formationTracks } from '../lib/formationTracks';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import SectionCard from '../lib/components/SectionCard.svelte';
  import RefreshButton from '../lib/components/RefreshButton.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import Papicon from '../lib/components/Papicon.svelte';

  const steps = $derived(setupJourney.steps);
  const loading = $derived(setupJourney.loading);

  /**
   * Le deverrouillage se signale par l'URL, pas par une deduction.
   *
   * On pourrait deviner « ce serveur vient d'etre active » en comparant des
   * dates, mais la mauvaise reponse est couteuse des deux cotes : une banniere
   * de fete sur un serveur actif depuis six mois, ou rien du tout a la seconde
   * ou elle comptait. Le retour de paiement passe donc le drapeau lui-meme.
   */
  let showUnlock = $state(false);

  const gesturesDone = $derived(formationStore.doneCount);
  const gesturesTotal = $derived(formationStore.totalCount);

  const settingsDone = $derived(steps.filter((step) => step.done).length);
  const settingsTotal = $derived(steps.length);

  const percent = $derived.by(() => {
    const total = settingsTotal + gesturesTotal;
    if (total === 0) return 0;
    return Math.round(((settingsDone + gesturesDone) / total) * 100);
  });

  async function load() {
    if (!authStore.selectedGuildId) return;
    try {
      await setupJourney.load();
    } catch (err: any) {
      toast.error(err?.message || 'Chargement du parcours impossible');
    }
  }

  function dismissUnlock() {
    showUnlock = false;
    formationStore.markUnlockSeen();
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('unlocked') === '1' && !formationStore.unlockSeen) showUnlock = true;
    // Le drapeau a servi : le laisser dans l'URL ferait rejouer la fete a
    // chaque rechargement, et surtout a chaque partage du lien.
    if (params.has('unlocked')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  });

  $effect(() => {
    const guildId = authStore.selectedGuildId;
    if (!guildId) return;
    formationStore.initialize(guildId);

    // La modale de bienvenue du dashboard ferait doublon ici, et se poserait
    // par-dessus la bannière de déverrouillage : cette page est l'accueil, en
    // plus long et en plus utile. On la marque vue plutôt que de la laisser
    // interrompre.
    onboardingStore.initialize(guildId);
    onboardingStore.skipWelcome();

    void setupJourney.ensure(guildId);
  });
</script>

<ModulePage
  title="Formation"
  description="Apprendre à conduire le serveur, catégorie par catégorie"
  icon="compass"
  featureKey="settings"
>
  {#snippet actions()}
    <RefreshButton onclick={load} {loading} />
  {/snippet}

  <div class="space-y-4">
    <!-- ── Le moment du déverrouillage ──────────────────────────────────── -->
    {#if showUnlock}
      <div class="rounded-2xl border border-primary/40 bg-primary/[0.06] p-6 relative overflow-hidden">
        <div class="absolute -top-20 -right-20 w-48 h-48 bg-primary/10 rounded-full blur-[70px]"></div>

        <div class="relative">
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Papicon icon="sparkles" size={20} />
              </div>
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-on-surface">Le serveur est activé.</h2>
                <p class="text-[13px] text-on-surface-variant/70 font-medium">
                  Tout ce que le tunnel gardait fermé vient de s'ouvrir.
                </p>
              </div>
            </div>

            <button
              type="button"
              onclick={dismissUnlock}
              class="shrink-0 text-[12px] font-medium text-on-surface-variant/50 hover:text-on-surface transition-colors"
            >
              Fermer
            </button>
          </div>

          <p class="mt-4 text-[13px] text-on-surface-variant leading-relaxed max-w-2xl">
            Les modules tournent, les pages du dashboard sont ouvertes, et la configuration
            montée pendant la mise en place est celle qui s'applique — rien n'a été perdu en
            route. Reste à savoir s'en servir : les quatre pistes ci-dessous reprennent les
            catégories du parcours et se font une fois, dans l'ordre qu'on veut.
          </p>
        </div>
      </div>
    {/if}

    <!-- ── Avancement d'ensemble ────────────────────────────────────────── -->
    <SectionCard>
      <div class="flex flex-col sm:flex-row sm:items-center gap-5">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-on-surface">
            {#if formationStore.allDone}
              Formation terminée.
            {:else}
              {gesturesTotal - gesturesDone} geste{gesturesTotal - gesturesDone > 1 ? 's' : ''} à faire
            {/if}
          </p>
          <p class="text-[13px] text-on-surface-variant mt-1 leading-relaxed">
            {settingsDone}/{settingsTotal} réglages en place, {gesturesDone}/{gesturesTotal} gestes faits.
            Les réglages se lisent de la configuration&nbsp;; les gestes, eux, se déclarent —
            personne ne peut deviner ce que vous avez compris.
          </p>
        </div>

        <div class="sm:w-56 shrink-0">
          <div class="flex items-baseline justify-between mb-1.5">
            <span class="text-[11px] uppercase tracking-widest text-on-surface-variant/50">Ensemble</span>
            <span class="text-sm font-bold text-primary">{percent}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
            <div
              class="h-full rounded-full bg-primary transition-all duration-700"
              style="width: {percent}%"
            ></div>
          </div>
        </div>
      </div>
    </SectionCard>

    {#if loading && steps.length === 0}
      <LoadingHint context="config" />
    {/if}

    <!-- ── Une piste par catégorie ──────────────────────────────────────── -->
    {#each formationTracks as track (track.group)}
      {@const trackSteps = steps.filter((step) => step.group === track.group)}
      {@const settings = setupJourney.doneIn(track.group)}
      {@const gestures = formationStore.doneIn(track.group)}
      {@const complete = gestures.done === gestures.total && settings.done === settings.total && settings.total > 0}

      <SectionCard title={track.title} description={track.promise} icon={track.icon}>
        {#snippet actions()}
          <span
            class="text-[11px] px-2 py-0.5 rounded-full font-semibold
            {complete ? 'bg-emerald-500/10 text-emerald-500' : 'bg-surface-container text-on-surface-variant'}"
          >
            {settings.done + gestures.done}/{settings.total + gestures.total}
          </span>
        {/snippet}

        <p class="text-[13px] text-on-surface-variant leading-relaxed mb-4">{track.intro}</p>

        <div class="grid gap-4 lg:grid-cols-2">
          <!-- Les réglages : lus de la configuration, jamais cochés à la main. -->
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant/50 mb-2">
              Réglages ({settings.done}/{settings.total})
            </p>
            {#if trackSteps.length === 0}
              <p class="text-[13px] text-on-surface-variant/60">Parcours non chargé.</p>
            {:else}
              <ul class="space-y-1">
                {#each trackSteps as step (step.key)}
                  <li>
                    <a
                      href={step.href}
                      class="flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors
                      {step.done ? 'hover:bg-surface-container/60' : 'bg-primary/[0.04] hover:bg-primary/[0.08]'}"
                    >
                      <Papicon
                        icon={step.done ? 'check' : 'arrow-right'}
                        size={13}
                        class={step.done ? 'text-emerald-500 shrink-0' : 'text-primary shrink-0'}
                      />
                      <span class="text-[13px] {step.done ? 'text-on-surface-variant' : 'font-medium text-on-surface'}">
                        {step.label}
                      </span>
                      {#if !step.done && step.essential}
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-error/10 text-error shrink-0">essentiel</span>
                      {/if}
                    </a>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <!-- Les gestes : la partie qui forme réellement. -->
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant/50 mb-2">
              À faire une fois ({gestures.done}/{gestures.total})
            </p>
            <ul class="space-y-1.5">
              {#each track.gestures as gesture (gesture.id)}
                {@const done = formationStore.isDone(gesture.id)}
                <li class="rounded-xl border px-3 py-2.5 transition-colors
                  {done ? 'border-outline-variant/20 bg-surface-container-low/30' : 'border-outline-variant/40'}">
                  <div class="flex items-start gap-2.5">
                    <button
                      type="button"
                      onclick={() => formationStore.toggle(gesture.id)}
                      aria-pressed={done}
                      class="mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center transition-colors
                      {done
                        ? 'bg-emerald-500 text-white'
                        : 'border-2 border-outline-variant hover:border-primary'}"
                    >
                      {#if done}<Papicon icon="check" size={12} />{/if}
                    </button>

                    <div class="min-w-0 flex-1">
                      <p class="text-[13px] font-medium leading-snug {done ? 'text-on-surface-variant line-through' : 'text-on-surface'}">
                        {gesture.label}
                      </p>
                      <p class="text-[12px] text-on-surface-variant/70 mt-0.5 leading-relaxed">
                        {gesture.learns}
                      </p>
                      {#if gesture.href && !done}
                        <a
                          href={gesture.href}
                          class="inline-flex items-center gap-1 mt-1.5 text-[12px] font-semibold text-primary hover:underline"
                        >
                          Y aller
                          <Papicon icon="ChevronRight" size={12} />
                        </a>
                      {/if}
                    </div>
                  </div>
                </li>
              {/each}
            </ul>
          </div>
        </div>
      </SectionCard>
    {/each}

    <SectionCard title="Il manque encore des réglages ?">
      <p class="text-[13px] text-on-surface-variant leading-relaxed">
        La <a href="/setup" class="text-primary hover:underline font-medium">prise en main</a>
        liste les seize points du parcours au même endroit, avec ce qui manque précisément
        pour chacun.
      </p>
    </SectionCard>
  </div>
</ModulePage>
