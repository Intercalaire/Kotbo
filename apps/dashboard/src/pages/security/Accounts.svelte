<script lang="ts">
  /**
   * Securite > Multi-comptes.
   *
   * Cible du lot 5 : onglets « Liens », « Detections », « Reseau » et
   * « Verification d'identite » (ex-onglet `verification`, renomme pour ne plus
   * entrer en collision avec le captcha d'entree de l'Anti-raid).
   *
   * L'onglet `config` actuel est demantele : les warns ponderes et l'hygiene
   * des bans partent vers Securite > Sanctions, les statistiques des mots vers
   * l'onglet « Vie privee » de la Vue d'ensemble.
   */
  import DoubleAccounts from '../DoubleAccounts.svelte';
</script>

<DoubleAccounts />
