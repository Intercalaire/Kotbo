<script lang="ts">
  /**
   * Securite > Vue d'ensemble : le hub du groupe.
   *
   * La configuration rapide a quitte cette page pour son propre onglet : elle
   * passait derriere le score d'audit, alors que c'est par elle qu'on commence.
   *
   * Cible du lot 7 : onglets « Etat » (score d'audit + constats, ce que fait
   * deja SecurityAudit), « Alertes », « Exceptions » (vue agregee des listes
   * d'exemption de tous les modules securite) et « Vie privee & collecte »
   * (statistiques des mots, hygiene des bans, retention des logs - les trois
   * reglages a enjeu vie privee, aujourd'hui disperses).
   */
  import SecurityAudit from '../SecurityAudit.svelte';
</script>

<SecurityAudit />
