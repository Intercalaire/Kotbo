<!--
  Cohortes d'activité : une ligne par semaine d'arrivée, une colonne par
  semaine écoulée depuis (S0 = semaine d'arrivée). Chaque case donne la part
  de la cohorte active cette semaine-là, sur une seule teinte du clair au
  foncé. Les cases encore dans le futur restent vides.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Callout, SectionCard } from '../ui';
  import AnalyticsSkeleton from './AnalyticsSkeleton.svelte';
  import { fetchActivityCohorts, type ActivityCohorts } from '../../api';
  import { m } from '../../i18n';
  import { analyticsExport, analyticsFilters as filters } from './analyticsFilters.svelte';
  import { fmtNumber, shortDate } from './analyticsFormat';

  let data = $state<ActivityCohorts | null>(null);
  let failed = $state(false);

  $effect(() => {
    const query = filters.query;
    untrack(() => {
      failed = false;
      fetchActivityCohorts(query)
        .then((res) => {
          data = res;
          analyticsExport.activityCohorts = res;
        })
        .catch(() => (failed = true));
    });
  });

  /** Fond de case : la teinte principale, plus dense quand la part monte. */
  function cell(value: number | null): string {
    if (value === null) return '';
    const strength = Math.round(8 + Math.min(100, value) * 0.8);
    return `background: color-mix(in srgb, var(--color-primary) ${strength}%, var(--color-surface-container-lowest, var(--color-surface)));${strength > 55 ? ' color: var(--color-on-primary);' : ''}`;
  }

  const average = $derived.by(() => {
    if (!data) return [];
    return Array.from({ length: data.weeks }, (_, offset) => {
      let weighted = 0;
      let size = 0;
      for (const c of data!.cohorts) {
        const v = c.retention[offset];
        if (v === null || v === undefined || c.size === 0) continue;
        weighted += v * c.size;
        size += c.size;
      }
      return size > 0 ? Math.round((weighted / size) * 10) / 10 : null;
    });
  });
</script>

<SectionCard title={m.anx_cohort_title()} description={m.anx_cohort_desc()}>
  {#if failed}
    <Callout variant="danger">{m.an_error_generic()}</Callout>
  {:else if !data}
    <AnalyticsSkeleton />
  {:else}
    {#if data.channelIgnored}
      <Callout variant="info">{m.anx_channel_filter_ignored()}</Callout>
    {/if}
    <div class="cohort-wrap">
      <table class="cohort">
        <thead>
          <tr>
            <th scope="col" class="cohort__head">{m.anx_cohort_week()}</th>
            <th scope="col" class="cohort__num">{m.anx_cohort_size()}</th>
            {#each Array.from({ length: data.weeks }, (_, i) => i) as offset (offset)}
              <th scope="col" class="cohort__num">S{offset}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each data.cohorts as cohort (cohort.week)}
            <tr>
              <th scope="row" class="cohort__head">{shortDate(cohort.week)}</th>
              <td class="cohort__num">{fmtNumber(cohort.size)}</td>
              {#each cohort.retention as value, offset (offset)}
                <td class="cohort__cell" style={cell(cohort.size > 0 ? value : null)}>
                  {value === null || cohort.size === 0 ? '' : `${fmtNumber(Math.round(value))} %`}
                </td>
              {/each}
            </tr>
          {/each}
          <tr class="cohort__avg">
            <th scope="row" class="cohort__head">{m.anx_cohort_average()}</th>
            <td></td>
            {#each average as value, offset (offset)}
              <td class="cohort__num">{value === null ? '' : `${fmtNumber(Math.round(value))} %`}</td>
            {/each}
          </tr>
        </tbody>
      </table>
    </div>
  {/if}
</SectionCard>

<style>
  .cohort-wrap {
    overflow-x: auto;
    margin-top: 0.5rem;
  }

  .cohort {
    width: 100%;
    border-collapse: separate;
    border-spacing: 2px;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .cohort th,
  .cohort td {
    padding: 0.375rem 0.4375rem;
    white-space: nowrap;
  }

  .cohort thead th {
    font-weight: 500;
    color: var(--color-on-surface-variant);
  }

  .cohort__head {
    text-align: left;
    font-weight: 500;
    color: var(--color-on-surface);
  }

  .cohort__num {
    text-align: right;
    color: var(--color-on-surface-variant);
  }

  .cohort__cell {
    min-width: 2.75rem;
    text-align: center;
    border-radius: 0.25rem;
    color: var(--color-on-surface);
  }

  .cohort__avg th,
  .cohort__avg td {
    border-top: 1px solid var(--color-outline-variant);
    font-weight: 600;
    color: var(--color-on-surface);
  }
</style>
