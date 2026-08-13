<script lang="ts">
  /**
   * Securite > Sanctions.
   *
   * Cible du lot 6 : onglets « Historique », « Appels de ban » (ex-page
   * /appeals), « Warns ponderes » et « Hygiene des bans » (rapatries depuis
   * Multi-comptes) et « Approbation des permissions » (ex-page /admin-lock,
   * renommee : elle n'a rien a voir avec les verrous d'urgence de l'Anti-raid).
   *
   * L'onglet « Approbation des permissions » reste conditionne a
   * `adminLockEnabled`, garde qui vivait auparavant dans la config de la
   * sidebar.
   */
  import { router } from 'tinro';
  import SanctionsPage from '../Sanctions.svelte';
  import BanAppeals from '../BanAppeals.svelte';
  import AdminLockRequests from '../AdminLockRequests.svelte';

  const tab = $derived($router.path.split('/')[3] ?? '');
</script>

{#if tab === 'appeals'}
  <BanAppeals />
{:else if tab === 'admin-approval'}
  <AdminLockRequests />
{:else}
  <SanctionsPage />
{/if}
