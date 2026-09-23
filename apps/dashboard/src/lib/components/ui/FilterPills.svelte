<!--
  Filtre a choix unique au-dessus d'une liste (Tous / Actifs / Archives).
  Volontairement different des onglets : des pastilles arrondies, pas une
  barre, pour qu'on sache qu'on reste sur la meme section.
-->
<script lang="ts" module>
  export interface FilterOption<T extends string = string> {
    value: T;
    label: string;
    count?: number;
  }
</script>

<script lang="ts" generics="T extends string">
  const {
    options,
    value,
    onchange,
    label,
    disabled = false,
    class: className = '',
  }: {
    options: FilterOption<T>[];
    value: T;
    onchange: (value: T) => void;
    /** Ce que l'on filtre, pour les lecteurs d'ecran. */
    label: string;
    disabled?: boolean;
    class?: string;
  } = $props();
</script>

<div role="group" aria-label={label} class="filter-pills {className}">
  {#each options as option (option.value)}
    <button
      type="button"
      class="filter-pill"
      aria-pressed={option.value === value}
      {disabled}
      onclick={() => onchange(option.value)}
    >
      {option.label}
      {#if option.count !== undefined}
        <span class="filter-pill__count">{option.count}</span>
      {/if}
    </button>
  {/each}
</div>
