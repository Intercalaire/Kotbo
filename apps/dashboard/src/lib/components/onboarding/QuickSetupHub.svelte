<!--
  Les configurations rapides du dashboard, reunies.

  Chaque module qui propose des preselections (un niveau de protection, un
  rythme d'economie, une courbe d'XP) avait son entree a lui, dispersee dans
  son groupe de menu : on ne savait pas qu'elles existaient avant de tomber
  dessus. Elles sont listees ici, dans Prise en main, et seules celles que le
  compte peut ouvrir apparaissent.
-->
<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import SectionCard from '../SectionCard.svelte';
  import { navigationStore } from '../../stores/navigation.svelte';

  const ASSISTANTS = [
    {
      href: '/security/quick-setup',
      icon: 'shield',
      title: 'Sécurité',
      description: 'Un niveau de protection règle d\'un coup les filtres et l\'anti-raid.',
    },
    {
      href: '/economy-setup',
      icon: 'coins',
      title: 'Économie',
      description: 'Un rythme fixe les gains, le délai du daily et l\'énergie.',
    },
    {
      href: '/leveling',
      icon: 'trophy',
      title: 'Niveaux',
      description: 'Une courbe d\'XP toute prête, à ajuster ensuite si besoin.',
    },
    {
      href: '/prestige',
      icon: 'crown',
      title: 'Prestige',
      description: 'Une échelle de rangs et ses gains, en un choix.',
    },
    {
      href: '/channel-health',
      icon: 'activity',
      title: 'Santé des salons',
      description: 'Des seuils d\'alerte adaptés à la taille du serveur.',
    },
  ];

  // `allItems` porte deja les droits du compte et les modules eteints.
  const available = $derived(
    ASSISTANTS.filter((assistant) => navigationStore.allItems.some((item) => item.href === assistant.href)),
  );
</script>

{#if available.length > 0}
  <SectionCard
    title="Configurations rapides"
    description="Des réglages complets en un seul choix. Tu pourras tout affiner ensuite, module par module."
    icon="sparkles"
  >
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each available as assistant (assistant.href)}
        <a
          href={assistant.href}
          class="group flex items-start gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 transition-colors hover:border-primary/50 hover:bg-surface-hover"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-container text-on-primary-container">
            <Papicon icon={assistant.icon} size={17} />
          </span>
          <span class="min-w-0">
            <span class="flex items-center gap-1 text-sm font-semibold text-on-surface">
              {assistant.title}
              <Papicon icon="arrow-right" size={13} class="text-on-surface-variant transition-transform group-hover:translate-x-0.5" />
            </span>
            <span class="mt-0.5 block text-body-sm leading-relaxed text-on-surface-variant">{assistant.description}</span>
          </span>
        </a>
      {/each}
    </div>
  </SectionCard>
{/if}
