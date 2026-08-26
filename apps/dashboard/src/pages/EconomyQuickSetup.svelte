<script lang="ts">
  /**
   * Economie > Configuration rapide : les rythmes, seuls.
   *
   * Ils reglent d'un coup les gains du daily, son delai et l'energie, donc ils ne
   * relevent d'aucun onglet de la page Economie. Leur propre entree de menu en fait le
   * chemin le plus court pour qui veut demarrer sans rien regler en detail.
   */
  import ModulePage from '../lib/components/ModulePage.svelte';
  import EconomyQuickSetup from '../lib/components/economy/EconomyQuickSetup.svelte';
  import { m } from '../lib/i18n';
</script>

<!-- Pas de `featureKey` : il grise et fige le corps de page tant que le module est
     eteint, or c'est precisement la qu'on vient choisir un rythme. La page Economie
     n'en passe pas non plus, pour la meme raison ; le choix d'un rythme rappelle de
     lui-meme que le module est a allumer. -->
<ModulePage
  title={m.eco_quick_setup_title()}
  description={m.eco_quick_setup_desc()}
  icon="Sparkles"
>
  <EconomyQuickSetup />
</ModulePage>
