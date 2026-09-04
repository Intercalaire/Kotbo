<script lang="ts">
  /**
   * Un reglement pret a publier, qu'on ajuste plutot qu'on ne redige.
   *
   * Personne n'ecrit huit articles depuis une page blanche le jour ou il
   * decouvre un bot. Ceux-ci couvrent ce qu'on retrouve sur presque tous les
   * serveurs ; ils s'editent sur place, et c'est cette edition qui fait qu'on
   * les considere comme les siens - pas le fait d'avoir coche des cases.
   */
  import { authStore } from '../../../stores/auth.svelte';
  import { toast } from '../../../stores/toast.svelte';
  import { wizard } from '../../../stores/onboardingWizard.svelte';
  import { onboardingData } from '../../../stores/onboardingData.svelte';
  import { PANEL_COLORS, RULE_PRESETS, celebrateStep } from '../../../onboarding';
  import { createRegulationArticle, publishRegulation } from '../../../api';
  import DiscordPreview from '../DiscordPreview.svelte';
  import DiscordEmbed from '../DiscordEmbed.svelte';
  import Papicon from '../../Papicon.svelte';
  import WizardShell from '../WizardShell.svelte';

  const { onEditTracks, skip }: { onEditTracks: () => void; skip: () => void } = $props();

  const selectedGuild = $derived(
    authStore.guilds.find((guild) => guild.id === authStore.selectedGuildId)
  );
  const panelColor = $derived(wizard.panelColor ?? PANEL_COLORS[0].value);

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
  let editing = $state<string | null>(null);

  const chosen = $derived(rules.filter((rule) => rule.selected));
  const incomplete = $derived(chosen.some((rule) => !rule.title.trim() || !rule.description.trim()));

  async function apply() {
    if (onboardingData.busy) return;
    if (chosen.length === 0) {
      wizard.complete('rules');
      return;
    }

    onboardingData.busy = true;
    try {
      // En serie et non en parallele : la route renumerote tout le reglement a
      // chaque creation, et deux ecritures concurrentes se disputeraient l'ordre.
      for (const rule of chosen) {
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

      celebrateStep();
      wizard.complete('rules');
    } catch (err: any) {
      toast.error(err?.message || "Le règlement n'a pas pu être enregistré.");
    } finally {
      onboardingData.busy = false;
    }
  }
</script>

<WizardShell
  title="Quelles règles sur ce serveur ?"
  lead="Décochez ce qui ne vous ressemble pas, réécrivez le reste. Kotbo publiera le règlement dans son salon."
  {onEditTracks}
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
            onclick={() => { rule.selected = !rule.selected; celebrateStep(); }}
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
                  onclick={() => (editing = editing === rule.key ? null : rule.key)}
                  class="ml-auto shrink-0 inline-flex items-center gap-1 text-[12px] font-medium text-on-surface-variant/55 hover:text-primary transition-colors"
                >
                  <Papicon icon="pencil" size={11} />
                  {editing === rule.key ? 'Terminer' : 'Modifier'}
                </button>
              {/if}
            </div>

            {#if editing === rule.key}
              <!-- Le titre s'edite au meme titre que le texte : c'est lui qu'on
                   lit en premier dans le reglement publie, et le laisser fige
                   revenait a proposer d'ecrire ses regles sans pouvoir les
                   nommer. -->
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

  {#snippet preview()}
    {#if chosen.length}
      <DiscordPreview channel="règlement">
        <DiscordEmbed
          color={panelColor}
          title={`Règlement de ${selectedGuild?.name ?? 'votre serveur'}`}
          description="En participant à ce serveur, vous acceptez les règles suivantes."
          fields={chosen.map((rule) => ({ emoji: rule.emoji, name: rule.title, value: rule.description }))}
        />
      </DiscordPreview>
    {:else}
      <p class="rounded-xl border border-outline-variant/30 bg-surface-container-low/30 px-4 py-3 text-[13px] text-on-surface-variant/60 leading-relaxed">
        Aucun article retenu : rien ne sera publié. Vous pourrez écrire votre règlement
        depuis le tableau de bord.
      </p>
    {/if}
  {/snippet}

  {#snippet footer()}
    <button
      type="button"
      onclick={skip}
      class="text-[13px] font-medium text-on-surface-variant/50 hover:text-on-surface transition-colors"
    >
      Passer
    </button>
    <button
      type="button"
      onclick={apply}
      disabled={onboardingData.busy || incomplete}
      class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
    >
      {onboardingData.busy ? 'Publication…' : chosen.length ? `Publier ${chosen.length} articles` : 'Continuer'}
      <Papicon icon="ChevronRight" size={15} />
    </button>
  {/snippet}
</WizardShell>
