<script lang="ts">
  import Papicon from './Papicon.svelte';
  import { m } from '../i18n';

  const { simple, onchange }: { simple: boolean; onchange: (value: boolean) => void } = $props();
</script>

<!-- Les deux options restent visibles cote a cote : un bouton unique
     n'annoncant que la destination se lit comme un lien, pas comme un choix. -->
<nav class="tab-group w-fit">
  <button
    type="button"
    onclick={() => onchange(true)}
    class="tab-button {simple ? 'active' : ''}"
  >
    <Papicon icon="SlidersHorizontal" size={15} />
    {m.common_mode_simple()}
  </button>
  <button
    type="button"
    onclick={() => onchange(false)}
    class="tab-button {simple ? '' : 'active'}"
  >
    <Papicon icon="Hash" size={15} />
    {m.common_mode_advanced()}
  </button>
</nav>
