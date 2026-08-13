<script lang="ts">
  /**
   * Securite > Vue d'ensemble : le hub du groupe.
   *
   * En tete, « Configuration rapide » : les niveaux de protection reglent d'un
   * coup les filtres et les seuils anti-raid, ils relevent donc du hub et non
   * d'une page thematique. C'est aussi la premiere entree du menu Securite,
   * donc le chemin le plus court pour qui veut se proteger sans rien regler en
   * detail.
   *
   * Cible du lot 7 : onglets « Etat » (score d'audit + constats, ce que fait
   * deja SecurityAudit), « Alertes », « Exceptions » (vue agregee des listes
   * d'exemption de tous les modules securite) et « Vie privee & collecte »
   * (statistiques des mots, hygiene des bans, retention des logs — les trois
   * reglages a enjeu vie privee, aujourd'hui disperses).
   */
  import SecurityQuickSetup from '../../lib/components/security/SecurityQuickSetup.svelte';
  import SecurityAudit from '../SecurityAudit.svelte';
</script>

<div class="flex flex-col gap-8">
  <SecurityQuickSetup />
  <SecurityAudit />
</div>
