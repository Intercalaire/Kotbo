<!--
  Vue détaillée d'une catégorie : son poids dans le serveur, ses membres
  actifs jour par jour (texte seul, vocal seul, les deux), le comparatif de
  ses salons et les membres qui la font vivre.
-->
<script lang="ts">
  import Modal from '../Modal.svelte';
  import Chart from '../charts/Chart.svelte';
  import { Callout, SectionCard } from '../ui';
  import BarList, { type BarListItem } from './BarList.svelte';
  import KpiTile from './KpiTile.svelte';
  import { fetchCategoryDetail, type CategoryDetail } from '../../api';
  import { channelDetailsModal } from '../../stores/channelDetailsModal.svelte';
  import { m } from '../../i18n';
  import { errorMessage } from '@kotbo/shared';
  import { analyticsFilters as filters, relativeDelta } from './analyticsFilters.svelte';
  import { daysSince, fmtMinutes, fmtNumber, fmtPct, shortDate, SERIES } from './analyticsFormat';

  const {
    categoryId,
    categoryName,
    onClose,
    onOpenMember,
  }: {
    categoryId: string;
    categoryName: string;
    onClose: () => void;
    onOpenMember: (userId: string, name: string) => void;
  } = $props();

  let open = $state(true);
  let detail = $state<CategoryDetail | null>(null);
  let loading = $state(true);
  let error = $state('');

  $effect(() => {
    const query = filters.query;
    loading = true;
    error = '';
    fetchCategoryDetail(categoryId, query)
      .then((res) => (detail = res))
      .catch((e) => (error = errorMessage(e) || m.an_error_generic()))
      .finally(() => (loading = false));
  });

  function close() {
    open = false;
    onClose();
  }

  // Les fiches salon et membre sont montées avant cette modale : elle passerait
  // par-dessus. On la referme avant de les ouvrir.
  function openChannel(id: string, name: string) {
    close();
    channelDetailsModal.show(id, name);
  }

  function openMember(id: string, name: string) {
    close();
    onOpenMember(id, name);
  }

  const chartData = $derived({
    labels: (detail?.daily ?? []).map((d) => shortDate(d.dateKey)),
    datasets: [
      { label: m.anx_category_text_only(), data: (detail?.daily ?? []).map((d) => d.textOnly), backgroundColor: SERIES[0], stack: 'members', borderRadius: 2, maxBarThickness: 24 },
      { label: m.anx_category_voice_only(), data: (detail?.daily ?? []).map((d) => d.voiceOnly), backgroundColor: SERIES[1], stack: 'members', borderRadius: 2, maxBarThickness: 24 },
      { label: m.anx_category_both(), data: (detail?.daily ?? []).map((d) => d.both), backgroundColor: SERIES[2], stack: 'members', borderRadius: 2, maxBarThickness: 24 },
    ],
  });

  const chartOptions = {
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 8 } },
      y: { stacked: true, beginAtZero: true, ticks: { maxTicksLimit: 5, precision: 0 } },
    },
  };

  function quiet(lastActiveDate: string | null): string | undefined {
    const days = daysSince(lastActiveDate);
    if (days === null) return m.anx_channel_never_active();
    return days >= 7 ? m.anx_channel_quiet({ days: String(days) }) : undefined;
  }

  const textChannels: BarListItem[] = $derived(
    (detail?.channels ?? []).filter((c) => c.kind !== 'voice').map((c) => ({
      id: c.id, label: `#${c.name}`, value: c.messages, sub: quiet(c.lastActiveDate),
    })),
  );

  const voiceChannels: BarListItem[] = $derived(
    (detail?.channels ?? []).filter((c) => c.kind === 'voice').map((c) => ({
      id: c.id, label: c.name, value: c.voiceMinutes, display: fmtMinutes(c.voiceMinutes),
    })),
  );

  type MemberItem = BarListItem & { avatarUrl: string | null };
  const memberItems: MemberItem[] = $derived(
    (detail?.topMembers ?? []).map((mb) => ({
      id: mb.userId,
      label: mb.name ?? mb.userId,
      value: mb.messages,
      display: m.anx_category_member_messages({ count: fmtNumber(mb.messages) }),
      sub: mb.voiceMinutes > 0 ? m.anx_category_member_voice({ time: fmtMinutes(mb.voiceMinutes) }) : undefined,
      avatarUrl: mb.avatarUrl,
    })),
  );
</script>

<Modal bind:open title={categoryName} subtitle={m.anx_category_subtitle()} size="full" onClose={close}>
  {#if loading && !detail}
    <p class="py-10 text-center text-body-sm text-on-surface-variant">{m.an_loading_short()}</p>
  {:else if error}
    <Callout variant="danger" title={m.an_error_generic()}>{error}</Callout>
  {:else if detail}
    {@const k = detail.kpis}
    <div class="flex flex-col gap-4" aria-busy={loading}>
      <div class="kpi-grid kpi-grid--4">
        <KpiTile label={m.anx_kpi_messages()} value={fmtNumber(k.messages.value)} delta={relativeDelta(k.messages.value, k.messages.previous)} compare={filters.compare} />
        <KpiTile label={m.anx_kpi_voice()} value={fmtMinutes(k.voiceMinutes.value)} delta={relativeDelta(k.voiceMinutes.value, k.voiceMinutes.previous)} compare={filters.compare} />
        <KpiTile label={m.anx_kpi_active_members()} value={fmtNumber(k.activeMembers)} hint={m.anx_category_active_hint()} />
        <KpiTile
          label={m.anx_category_share()}
          value={fmtPct(k.messageShare.value)}
          delta={k.messageShare.value - k.messageShare.previous}
          unit="pts"
          compare={filters.compare}
          hint={m.anx_category_share_hint({ voice: fmtPct(k.voiceShare) })}
        />
      </div>

      {#if detail.range.days > detail.voiceHistoryDays}
        <Callout variant="info">{m.anx_category_voice_history({ days: String(detail.voiceHistoryDays) })}</Callout>
      {/if}

      <SectionCard title={m.anx_category_daily_title()} description={m.anx_category_daily_desc()}>
        <Chart type="bar" data={chartData} options={chartOptions} height={220} />
      </SectionCard>

      <div class="section-grid">
        <div class="span-6">
          <SectionCard title={m.anx_category_channels_title()}>
            <div class="flex flex-col gap-5">
              <BarList items={textChannels} empty={m.anx_category_no_text()} onselect={(item) => openChannel(item.id, item.label)} />
              {#if voiceChannels.length > 0}
                <div class="flex flex-col gap-2 border-t border-outline-variant pt-4">
                  <span class="text-body-sm font-medium text-on-surface">{m.anx_category_voice_channels()}</span>
                  <BarList items={voiceChannels} color={SERIES[1]} onselect={(item) => openChannel(item.id, item.label)} />
                </div>
              {/if}
            </div>
          </SectionCard>
        </div>
        <div class="span-6">
          <SectionCard title={m.anx_category_members_title()}>
            <BarList items={memberItems} empty={m.anx_category_no_members()} onselect={(item) => openMember(item.id, item.label)}>
              {#snippet leading(item)}
                {#if item.avatarUrl}
                  <img src={item.avatarUrl} alt="" width="28" height="28" class="h-7 w-7 shrink-0 rounded-full" loading="lazy" />
                {:else}
                  <span class="h-7 w-7 shrink-0 rounded-full bg-surface-container"></span>
                {/if}
              {/snippet}
            </BarList>
          </SectionCard>
        </div>
      </div>
    </div>
  {/if}
</Modal>
