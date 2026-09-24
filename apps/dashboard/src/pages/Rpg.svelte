<script lang="ts">
  /**
   * Jeu RPG : recettes, bestiaire, raid, quetes, titres, aventures, guildes.
   *
   * Ces onglets vivaient dans la page Economie, a cote de la monnaie et de la
   * boutique. Ils ont leur entree de menu, mais le composant reste commun : les
   * deux pages partagent la configuration chargee, les objets et les droits.
   */
  import Economy from './Economy.svelte';
</script>

<Economy section="rpg" />
