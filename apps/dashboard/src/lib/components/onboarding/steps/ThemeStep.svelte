<script lang="ts">
  /**
   * A quoi sert ce serveur.
   *
   * La reponse decide des sections de la maquette a retenir - salons a poser,
   * modules a allumer - et des motifs de ticket coches d'office a l'ecran
   * suivant. Elle precede donc la structure, et de peu : c'est la derniere
   * question avant que Kotbo n'ecrive quoi que ce soit sur Discord.
   *
   * L'apercu montre l'arborescence que la vocation retenue produirait. Quatre
   * cartes qui se ressemblent ne se departagent pas ; quatre cartes dont on
   * voit le resultat, si.
   */
  import { wizard } from '../../../stores/onboardingWizard.svelte';
  import { onboardingData } from '../../../stores/onboardingData.svelte';
  import { THEMES, celebrateStep, selectionFor, type ThemeKey } from '../../../onboarding';
  import ChoiceCard from '../ChoiceCard.svelte';
  import Papicon from '../../Papicon.svelte';
  import WizardShell from '../WizardShell.svelte';

  const { onEditTracks }: { onEditTracks: () => void } = $props();

  const kind = $derived(wizard.kind ?? 'new');
  const theme = $derived<ThemeKey>(wizard.theme ?? 'communaute');
  const template = $derived(onboardingData.template);

  /**
   * L'arborescence, telle que la vocation la dessine.
   *
   * On la lit sur la maquette complete plutot que sur la selection reelle :
   * l'apercu doit montrer ce que la vocation propose, y compris ce qu'un
   * serveur habite possede deja - c'est l'ecran de structure qui fera le tri.
   */
  const tree = $derived.by(() => {
    if (!template) return [];
    const keys = new Set(selectionFor(template.plan, 'new', theme));
    const items = template.plan.filter((item) => keys.has(item.key) && item.kind !== 'module');
    const categories = items.filter((item) => item.kind === 'category');
    return categories.map((category) => ({
      key: category.key,
      name: category.name,
      children: items
        .filter((item) => item.parent === category.key)
        .map((item) => ({ key: item.key, name: item.name, voice: item.kind === 'voice' })),
    }));
  });
</script>

<WizardShell
  title="À quoi sert ce serveur ?"
  lead={kind === 'existing'
    ? "La réponse décide de ce que Kotbo complète et des modules à allumer."
    : "La réponse décide des salons à poser et des modules à allumer."}
  {onEditTracks}
>
  <div class="space-y-3">
    {#each THEMES as entry (entry.key)}
      <ChoiceCard
        label={entry.label}
        pitch={entry.pitch}
        icon={entry.icon}
        selected={theme === entry.key}
        onclick={() => { wizard.answer({ theme: entry.key }); celebrateStep(); }}
      />
    {/each}
  </div>

  {#snippet preview()}
    <div class="rounded-xl overflow-hidden border border-black/25 shadow-sm bg-[#2b2d31]">
      <div class="px-3.5 py-2.5 border-b border-black/25 flex items-center gap-2">
        <Papicon icon="layout-grid" size={12} class="text-[#80848e]" />
        <span class="text-[12.5px] font-semibold text-[#dbdee1]">L'arborescence proposée</span>
      </div>

      <div class="px-2 py-2 max-h-[420px] overflow-y-auto">
        {#each tree as category (category.key)}
          <p class="px-2 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#949ba4]">
            {category.name}
          </p>
          {#each category.children as channel (channel.key)}
            <p class="flex items-center gap-1.5 rounded px-2 py-0.5 text-[13px] text-[#dbdee1]">
              <span class="text-[#80848e] text-[14px] leading-none shrink-0">
                {channel.voice ? '🔊' : '#'}
              </span>
              <span class="truncate">{channel.name}</span>
            </p>
          {/each}
        {:else}
          <p class="px-2 py-6 text-center text-[12.5px] text-[#949ba4]">
            Lecture de la maquette…
          </p>
        {/each}
      </div>
    </div>
  {/snippet}

  {#snippet footer()}
    <button
      type="button"
      onclick={() => { wizard.answer({ theme }); wizard.complete('theme'); }}
      class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity"
    >
      Continuer
      <Papicon icon="ChevronRight" size={15} />
    </button>
  {/snippet}
</WizardShell>
