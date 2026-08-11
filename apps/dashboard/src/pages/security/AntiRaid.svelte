<script lang="ts">
  /**
   * Securite > Anti-raid.
   *
   * Cible du lot 3 : onglets « Detection & verrous d'urgence », « Captcha
   * d'entree », « Honeypot » (rapatrie depuis Configuration > Salons),
   * « Arnaques & empreintes » et « Files d'attente », le tout sur le chassis
   * <SecurityPage>.
   *
   * En attendant, la page monte l'UI existante afin que la nouvelle URL soit
   * fonctionnelle des le lot 1. L'onglet « Securite » d'AutoMod, qui editait la
   * meme RaidProtectionConfig, disparait au lot 3.
   */
  import RaidProtection from '../RaidProtection.svelte';
</script>

<RaidProtection />
