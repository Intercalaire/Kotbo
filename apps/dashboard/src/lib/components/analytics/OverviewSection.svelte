<!--
  Vue d'ensemble : les chiffres clés de la période, leurs tendances jour par
  jour, et trois faits marquants qui mènent vers la section concernée.
-->
<script lang="ts">
  import { Button, Callout, SectionCard } from '../ui';
  import KpiTile from './KpiTile.svelte';
  import TrendChart from './TrendChart.svelte';
  import AnalyticsSkeleton from './AnalyticsSkeleton.svelte';
  import { fetchActivityAnalytics, fetchContentAnalytics, type ActivityAnalytics, type ContentAnalytics } from '../../api';
  import { m } from '../../i18n';
  import { errorMessage } from '@kotbo/shared';
  import { analyticsExport, analyticsFilters as filters, pct, relativeDelta } from './analyticsFilters.svelte';
  import { fmtMinutes, fmtNumber, fmtPct, SERIES } from './analyticsFormat';

  const { onNavigate }: { onNavigate: (section: string) => void } = $props();

  let activity = $state<ActivityAnalytics | null>(null);
  let content = $state<ContentAnalytics | null>(null);
  let loading = $state(true);
  let error = $state('');
  let requestId = 0;

  $effect(() => {
    const query = filters.query;
    const id = ++requestId;
    loading = true;
    error = '';
    Promise.all([fetchActivityAnalytics(query), fetchContentAnalytics(query).catch(() => null)])
      .then(([a, c]) => {
        if (id !== requestId) return;
        activity = a;
        content = c;
        analyticsExport.activity = a;
      })
      .catch((e) => {
        if (id === requestId) error = errorMessage(e) || m.an_error_generic();
      })
      .finally(() => {
        if (id === requestId) loading = false;
      });
  });

  const k = $derived(activity?.kpis);
  const dates = $derived(activity?.series.map((d) => d.dateKey) ?? []);

  const TYPE_KEYS: Array<[string, () => string]> = [
    ['typeImage', () => m.anx_type_image()], ['typeGif', () => m.anx_type_gif()], ['typeLink', () => m.anx_type_link()],
    ['typeVideo', () => m.anx_type_video()], ['typeSticker', () => m.anx_type_sticker()], ['typeForward', () => m.anx_type_forward()],
    ['typeVoice', () => m.anx_type_voice()],
  ];

  /** Le type (hors texte) dont la part a le plus progressé. */
  const risingType = $derived.by(() => {
    const t = content?.totals;
    const p = content?.previous;
    if (!t || !(t.messages > 0)) return null;
    let best: { label: string; share: number; delta: number | null } | null = null;
    for (const [key, label] of TYPE_KEYS) {
      const share = pct(t[key] ?? 0, t.messages);
      const delta = p && p.messages > 0 ? share - pct(p[key] ?? 0, p.messages) : null;
      const score = delta ?? share;
      if (!best || score > (best.delta ?? best.share)) best = { label: label(), share, delta };
    }
    return best;
  });

  const topEmoji = $derived(content?.emojis[0] ?? null);
  const topChannel = $derived(activity?.topChannels[0] ?? null);
</script>

{#if loading && !activity}
  <AnalyticsSkeleton />
{:else if error}
  <Callout variant="danger" title={m.an_error_generic()}>{error}</Callout>
{:else if activity && k}
  <div class="flex flex-col gap-4" aria-busy={loading}>
    <div class="kpi-grid kpi-grid--5">
      <KpiTile label={m.anx_kpi_messages()} value={fmtNumber(k.messages.value)} delta={relativeDelta(k.messages.value, k.messages.previous)} compare={filters.compare} />
      <KpiTile label={m.anx_kpi_active_members()} value={fmtNumber(k.activeMembers.value)} delta={relativeDelta(k.activeMembers.value, k.activeMembers.previous)} compare={filters.compare} hint={m.anx_kpi_active_members_hint()} />
      {#if activity.voiceAvailable}
        <KpiTile label={m.anx_kpi_voice()} value={fmtMinutes(k.voiceMinutes.value)} delta={relativeDelta(k.voiceMinutes.value, k.voiceMinutes.previous)} compare={filters.compare} />
      {/if}
      <KpiTile label={m.anx_kpi_net_joins()} value={`${k.netJoins.value > 0 ? '+' : ''}${fmtNumber(k.netJoins.value)}`} delta={k.netJoins.value - k.netJoins.previous} unit="abs" compare={filters.compare} hint={m.anx_kpi_net_joins_hint({ joined: fmtNumber(k.joined), left: fmtNumber(k.left) })} />
      {#if k.memberCount !== null}
        <KpiTile label={filters.includeBots ? m.anx_kpi_members_with_bots() : m.anx_kpi_members()} value={fmtNumber(k.memberCount)} />
      {/if}
    </div>

    <div class="section-grid">
      <div class={activity.voiceAvailable ? 'span-6' : 'span-12'}>
        <SectionCard title={m.anx_trend_messages_title()}>
          <TrendChart
            {dates}
            values={activity.series.map((d) => d.messages)}
            previous={activity.series.map((d) => d.prevMessages)}
            label={m.anx_trend_current()}
            previousLabel={m.anx_trend_previous()}
            compare={filters.compare}
            format={fmtNumber}
          />
        </SectionCard>
      </div>
      {#if activity.voiceAvailable}
        <div class="span-6">
          <SectionCard title={m.anx_trend_voice_title()}>
            <TrendChart
              {dates}
              values={activity.series.map((d) => d.voiceMinutes)}
              previous={activity.series.map((d) => d.prevVoiceMinutes)}
              label={m.anx_trend_current()}
              previousLabel={m.anx_trend_previous()}
              compare={filters.compare}
              color={SERIES[1]}
              format={fmtMinutes}
            />
          </SectionCard>
        </div>
      {/if}
    </div>

    <div class="section-grid">
      <div class="span-4">
        <SectionCard>
          <div class="highlight">
            <span class="text-body-sm text-on-surface-variant">{m.anx_highlight_channel()}</span>
            <span class="highlight__title">{topChannel ? `#${topChannel.name ?? '?'}` : '—'}</span>
            {#if topChannel}
              <span class="text-body-sm text-on-surface-variant">{m.anx_highlight_channel_desc({ count: fmtNumber(topChannel.messages), share: fmtPct(pct(topChannel.messages, k.messages.value)) })}</span>
            {/if}
            <Button size="sm" variant="ghost" iconRight="arrow-right" onclick={() => onNavigate('channels')}>{m.anx_highlight_channel_cta()}</Button>
          </div>
        </SectionCard>
      </div>
      <div class="span-4">
        <SectionCard>
          <div class="highlight">
            <span class="text-body-sm text-on-surface-variant">{m.anx_highlight_emoji()}</span>
            <span class="highlight__title flex items-center gap-2">
              {#if topEmoji?.imageUrl}
                <img src={topEmoji.imageUrl} alt="" width="28" height="28" class="h-7 w-7 object-contain" />
                <span>:{topEmoji.name ?? '?'}:</span>
              {:else}
                {topEmoji?.key ?? '—'}
              {/if}
            </span>
            {#if topEmoji}
              <span class="text-body-sm text-on-surface-variant">{m.anx_highlight_emoji_desc({ count: fmtNumber(topEmoji.count) })}</span>
            {/if}
            <Button size="sm" variant="ghost" iconRight="arrow-right" onclick={() => onNavigate('content')}>{m.anx_highlight_content_cta()}</Button>
          </div>
        </SectionCard>
      </div>
      <div class="span-4">
        <SectionCard>
          <div class="highlight">
            <span class="text-body-sm text-on-surface-variant">{risingType?.delta !== null && filters.compare ? m.anx_highlight_type_rising() : m.anx_highlight_type_top()}</span>
            <span class="highlight__title">{risingType?.label ?? '—'}</span>
            {#if risingType}
              <span class="text-body-sm text-on-surface-variant">
                {m.anx_highlight_type_desc({ share: fmtPct(risingType.share) })}{#if risingType.delta !== null && filters.compare}, {risingType.delta >= 0 ? '+' : '−'}{m.anx_unit_points({ value: Math.abs(risingType.delta).toFixed(1).replace('.', ',') })}{/if}
              </span>
            {/if}
            <Button size="sm" variant="ghost" iconRight="arrow-right" onclick={() => onNavigate('content')}>{m.anx_highlight_content_cta()}</Button>
          </div>
        </SectionCard>
      </div>
    </div>
  </div>
{/if}

<style>
  .highlight {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.375rem;
  }

  .highlight__title {
    font-family: var(--font-headline);
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-on-surface);
  }
</style>
