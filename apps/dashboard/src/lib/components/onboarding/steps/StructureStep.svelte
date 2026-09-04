<script lang="ts">
  /**
   * Le seul moment ou l'on voit Kotbo agir sur son propre serveur.
   *
   * Trois temps : ce qui va etre pose, la pose, ce qui a ete pose. Le deuxieme
   * n'existait pas - un bouton passait a « En cours… » et l'ecran suivant
   * annoncait des chiffres qu'on n'avait pas vus arriver. Il dure maintenant le
   * temps du travail reel, en plein ecran, et c'est cette minute-la qui donne
   * envie de garder ce qu'on vient de voir apparaitre.
   *
   * Sur un serveur habite, l'ecran ne posait rien : la maquette complete y
   * aurait double des salons dont des gens se servent. Le bot dit desormais ce
   * que le serveur porte deja, et l'on complete - les elements reconnus sont
   * listes en grise, ceux qui manquent sont crees. Un serveur de trois ans qui
   * n'a jamais eu de salon de tickets voit ses tickets se poser, et son
   * `#reglement` ecrit a la main rester intact.
   */
  import { toast } from '../../../stores/toast.svelte';
  import { wizard } from '../../../stores/onboardingWizard.svelte';
  import { onboardingData } from '../../../stores/onboardingData.svelte';
  import {
    alreadyPresent,
    buildSequence,
    celebrateFinale,
    selectionFor,
    summarize,
    type ThemeKey,
  } from '../../../onboarding';
  import { applyServerTemplate } from '../../../api';
  import BuildSequence from '../BuildSequence.svelte';
  import CountUp from '../CountUp.svelte';
  import KotboMark from '../KotboMark.svelte';
  import Papicon from '../../Papicon.svelte';
  import WizardShell from '../WizardShell.svelte';

  const { onEditTracks }: { onEditTracks: () => void } = $props();

  const template = $derived(onboardingData.template);
  const kind = $derived(wizard.kind ?? 'new');
  const theme = $derived<ThemeKey>(wizard.theme ?? 'communaute');

  const selection = $derived(
    template ? selectionFor(template.plan, kind, theme, template.present ?? []) : []
  );
  const planned = $derived(template ? summarize(template.plan, selection) : null);
  const present = $derived(
    template ? alreadyPresent(template.plan, theme, template.present ?? []) : []
  );

  const blocked = $derived(!!template && !template.canCreateChannels && planned !== null && planned.channels > 0);

  let phase = $state<'plan' | 'building' | 'built'>('plan');
  let ready = $state(false);
  let sequence = $state<{ key: string; name: string; kind: string }[]>([]);

  const built = $derived(onboardingData.built);

  async function apply() {
    if (!template || onboardingData.busy) return;

    sequence = buildSequence(template.plan, selection);
    // Une selection qui ne contient que des modules n'a rien a regarder se
    // poser : une sequence vide se contenterait d'un ecran fige.
    const animated = sequence.length > 0;

    onboardingData.busy = true;
    if (animated) { phase = 'building'; ready = false; }

    try {
      const result = await applyServerTemplate(selection);
      const created = result.items.filter((entry) => entry.created);
      const roles = created.filter((e) => e.key.startsWith('role.') || e.key === 'captcha.role').length;
      const categories = created.filter((e) => e.key.endsWith('.category')).length;
      onboardingData.built = {
        roles,
        categories,
        channels: created.length - roles - categories,
        modules: result.modules.length + result.preparedModules.length,
      };
      for (const warning of result.warnings) toast.info(warning);

      if (animated) {
        // L'animation finit d'elle-meme, puis bascule sur le recapitulatif :
        // l'etape n'est validee qu'a ce moment-la.
        ready = true;
      } else {
        wizard.complete('structure');
      }
    } catch (err: any) {
      phase = 'plan';
      toast.error(err?.message || "La structure n'a pas pu être posée.");
    } finally {
      onboardingData.busy = false;
    }
  }
</script>

<WizardShell
  layout={phase === 'plan' ? 'split' : 'stage'}
  title={phase === 'plan'
    ? (kind === 'existing' ? 'Voilà ce que Kotbo va compléter.' : 'Voilà ce que Kotbo va poser.')
    : undefined}
  lead={phase === 'plan'
    ? (kind === 'existing'
        ? "Ce que votre serveur porte déjà n'est ni recréé ni déplacé : Kotbo ne pose que ce qui manque."
        : "Tout est prêt. Un clic, et ces salons existent sur votre serveur.")
    : undefined}
  canGoBack={phase === 'plan'}
  {onEditTracks}
>
  {#if phase === 'building'}
    <div class="max-w-xl mx-auto">
      <h1 class="mb-2 text-center text-2xl font-semibold tracking-tight text-on-surface font-headline">
        Kotbo travaille sur votre serveur.
      </h1>
      <p class="mb-7 text-center text-[14px] text-on-surface-variant/65 leading-relaxed">
        Ouvrez Discord dans un autre onglet : ce que vous voyez défiler apparaît en direct.
      </p>

      <BuildSequence
        items={sequence}
        {ready}
        onfinished={() => { phase = 'built'; celebrateFinale(); }}
      />
    </div>

  {:else if phase === 'built' && built}
    <div class="max-w-xl mx-auto rounded-2xl border border-primary/35 bg-primary/[0.04] p-7 text-center">
      <div class="flex justify-center mb-4">
        <KotboMark size={48} halo />
      </div>
      <p class="text-[17px] font-semibold text-on-surface mb-6">
        Votre serveur vient de prendre forme.
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
    {#if planned}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {#each [
          { n: planned.roles, label: 'rôles', icon: 'shield' },
          { n: planned.categories, label: 'catégories', icon: 'folder' },
          { n: planned.channels, label: 'salons', icon: 'message-circle' },
          { n: planned.modules, label: 'modules', icon: 'toggle-right' },
        ] as stat (stat.label)}
          <div class="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 px-4 py-3">
            <Papicon icon={stat.icon} size={14} class="text-primary/70 mb-1.5" />
            <p class="text-2xl font-bold tracking-tight text-primary">{stat.n}</p>
            <p class="text-[12px] font-medium text-on-surface-variant/60">{stat.label}</p>
          </div>
        {/each}
      </div>
    {/if}

    {#if template?.applied}
      <p class="mt-4 text-[13px] text-on-surface-variant leading-relaxed rounded-xl border border-outline-variant/30 bg-surface-container-low/30 px-4 py-3">
        La structure a déjà été posée sur ce serveur : elle ne se rejoue pas, sans quoi
        les salons se dédoubleraient. Vous pouvez passer à la suite.
      </p>
    {:else if blocked}
      <p class="mt-4 text-[13px] leading-relaxed rounded-xl border border-error/30 bg-error/[0.04] px-4 py-3 text-on-surface">
        Kotbo n'a pas la permission « Gérer les salons » : il ne peut rien créer. Donnez-la
        lui dans les paramètres du serveur, puis rechargez cette page.
      </p>
    {/if}
  {/if}

  {#snippet preview()}
    <div class="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest/50 overflow-hidden">
      <div class="px-4 py-2.5 border-b border-outline-variant/20 flex items-center gap-2">
        <Papicon icon="list" size={12} class="text-on-surface-variant/40" />
        <span class="text-[12.5px] font-semibold text-on-surface">Le détail</span>
      </div>

      <div class="max-h-[420px] overflow-y-auto p-3 space-y-1">
        {#each planned?.names ?? [] as name, index (index)}
          <p class="flex items-center gap-2 text-[13px] text-on-surface-variant/80">
            <Papicon icon="plus" size={11} class="shrink-0 text-emerald-500" />
            <span class="truncate">{name}</span>
          </p>
        {/each}

        {#if present.length}
          <!-- Ce qui est deja la, grise. Une reprise qui ne cree que trois
               salons sur quinze donne l'impression de n'avoir rien fait ; avec
               cette liste, on lit que douze etaient deja bons. -->
          <p class="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant/35">
            Déjà en place
          </p>
          {#each present as item (item.key)}
            <p class="flex items-center gap-2 text-[13px] text-on-surface-variant/40 line-through decoration-on-surface-variant/25">
              <Papicon icon="check" size={11} class="shrink-0" />
              <span class="truncate">{item.name}</span>
            </p>
          {/each}
        {/if}
      </div>
    </div>
  {/snippet}

  {#snippet footer()}
    {#if phase === 'building'}
      <span class="text-[13px] font-medium text-on-surface-variant/50">Montage en cours…</span>
    {:else if phase === 'built'}
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
        onclick={apply}
        disabled={onboardingData.busy || blocked}
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {onboardingData.busy
          ? 'En cours…'
          : kind === 'existing' ? 'Compléter le serveur' : 'Poser la structure'}
        <Papicon icon="ChevronRight" size={15} />
      </button>
    {/if}
  {/snippet}
</WizardShell>
