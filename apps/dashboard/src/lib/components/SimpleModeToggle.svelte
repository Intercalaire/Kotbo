<script lang="ts">
  import Papicon from './Papicon.svelte';
  import { m } from '../i18n';

  const { simple, onchange }: { simple: boolean; onchange: (value: boolean) => void } = $props();
</script>

<!-- Les deux options restent visibles cote a cote : un bouton unique
     n'annoncant que la destination se lit comme un lien, pas comme un choix.
     Ce sont des pastilles et non des onglets : le mode change l'affichage du
     meme reglage, pas la section de la page. -->
<div class="filter-pills" role="group" aria-label="{m.common_mode_simple()} / {m.common_mode_advanced()}">
  <button type="button" class="filter-pill" aria-pressed={simple} onclick={() => onchange(true)}>
    <Papicon icon="SlidersHorizontal" size={14} />
    {m.common_mode_simple()}
  </button>
  <button type="button" class="filter-pill" aria-pressed={!simple} onclick={() => onchange(false)}>
    <Papicon icon="Hash" size={14} />
    {m.common_mode_advanced()}
  </button>
</div>
