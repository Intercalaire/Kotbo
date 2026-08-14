<script lang="ts">
  const { message }: { message: string } = $props();
</script>

<!-- Affiche pendant le mode simple quand la configuration enregistree ne tombe
     sur aucun cran : le curseur montre alors le plus proche, qui n'est pas la
     valeur reelle. On le dit plutot que de modifier la configuration d'office. -->
<p class="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
  {message}
</p>
