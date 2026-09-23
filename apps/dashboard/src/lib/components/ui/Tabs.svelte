<!--
  Onglets d'une page : ils changent ce que la page affiche.
  Pour trier ou filtrer une liste, c'est FilterPills : les deux se
  ressemblaient, et on ne savait plus si l'on changeait de section ou de vue.

  Clavier : fleches gauche/droite, Debut et Fin deplacent la selection.
-->
<script lang="ts" module>
  export interface TabItem {
    id: string;
    label: string;
    icon?: string;
    /** Compteur ou etiquette courte affichee apres le libelle. */
    badge?: string | number;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import Papicon from '../Papicon.svelte';

  const {
    tabs,
    active,
    onchange,
    label,
    class: className = '',
  }: {
    tabs: TabItem[];
    active: string;
    onchange: (id: string) => void;
    /** Nom de la barre d'onglets pour les lecteurs d'ecran. */
    label: string;
    class?: string;
  } = $props();

  const uid = $props.id();
  let list = $state<HTMLDivElement>();

  async function select(tab: TabItem) {
    if (tab.disabled || tab.id === active) return;
    onchange(tab.id);
    await tick();
    // Sur mobile la barre defile : garder l'onglet choisi a l'ecran.
    list?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tab.id)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function onkeydown(event: KeyboardEvent) {
    const enabled = tabs.filter((tab) => !tab.disabled);
    const index = enabled.findIndex((tab) => tab.id === active);
    let next: TabItem | undefined;
    if (event.key === 'ArrowRight') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowLeft') next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    void select(next).then(() => {
      list?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next.id)}"]`)?.focus();
    });
  }
</script>

<div
  bind:this={list}
  role="tablist"
  aria-label={label}
  class="tab-group w-fit {className}"
  tabindex="-1"
  {onkeydown}
>
  {#each tabs as tab (tab.id)}
    {@const selected = tab.id === active}
    <button
      type="button"
      role="tab"
      id="{uid}-{tab.id}"
      data-tab={tab.id}
      aria-selected={selected}
      tabindex={selected ? 0 : -1}
      disabled={tab.disabled}
      class="tab-button {selected ? 'active' : ''}"
      onclick={() => select(tab)}
    >
      {#if tab.icon}
        <Papicon icon={tab.icon} size={14} />
      {/if}
      {tab.label}
      {#if tab.badge !== undefined && tab.badge !== ''}
        <span class="tab-badge">{tab.badge}</span>
      {/if}
    </button>
  {/each}
</div>
