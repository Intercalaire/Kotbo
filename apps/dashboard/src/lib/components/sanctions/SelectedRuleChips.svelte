<script lang="ts">
  import type { ReportRuleOption } from '../../sanctions/reportRules';
  import { reportRuleIcon } from '../../sanctions/reportRules';
  import Papicon from '../Papicon.svelte';

  const {
    selectedRules,
  }: {
    selectedRules: ReportRuleOption[];
  } = $props();
</script>

{#if selectedRules.length > 0}
  <div class="flex flex-wrap gap-2">
    {#each selectedRules as selectedRule}
      <span class="inline-flex items-center gap-1.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200 px-3 py-1 text-2xs font-bold uppercase tracking-wide">
        <Papicon icon={reportRuleIcon(selectedRule)} size={12} />
        <span>{selectedRule.label}</span>
      </span>
    {/each}
  </div>
{/if}
