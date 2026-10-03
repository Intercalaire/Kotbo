<!--
  Destinataires d'une alerte ou d'un rapport : un salon texte et/ou des
  membres du staff qui le reçoivent en message privé. Les options sont
  chargées une fois par page (salons d'Analytics, annuaire du staff).
-->
<script lang="ts" module>
  import { fetchAnalyticsFilterOptions, fetchStaffMembers } from '../../api';

  type Option = { id: string; name: string };
  let cache: Promise<{ channels: Option[]; staff: Option[] }> | null = null;
  let cachedGuild: string | null = null;

  /** Salons texte et membres du staff, partagés par tous les formulaires ouverts. */
  export function loadRecipientOptions(guildId: string | null): Promise<{ channels: Option[]; staff: Option[] }> {
    if (cache && cachedGuild === guildId) return cache;
    cachedGuild = guildId;
    cache = Promise.all([fetchAnalyticsFilterOptions().catch(() => null), fetchStaffMembers().catch(() => null)]).then(([filters, staff]) => ({
      channels: (filters?.categories ?? []).flatMap((cat) =>
        cat.channels.filter((c) => c.kind !== 'voice').map((c) => ({ id: c.id, name: cat.name ? `#${c.name} · ${cat.name}` : `#${c.name}` }))),
      staff: (Array.isArray(staff) ? staff : ((staff as { members?: unknown[] } | null)?.members ?? []))
        .map((s) => s as Record<string, unknown>)
        .map((s) => ({
          id: String(s.userId ?? s.id ?? ''),
          name: String(s.displayName ?? s.username ?? s.userTag ?? s.userId ?? ''),
        }))
        .filter((o) => /^\d{17,20}$/.test(o.id)),
    }));
    return cache;
  }
</script>

<script lang="ts">
  import SearchableSelect from '../SearchableSelect.svelte';
  import MultiSelect from '../MultiSelect.svelte';
  import { authStore } from '../../stores/auth.svelte';
  import { m } from '../../i18n';

  let {
    channelId = $bindable<string | null>(null),
    userIds = $bindable<string[]>([]),
    idPrefix,
  }: { channelId?: string | null; userIds?: string[]; idPrefix: string } = $props();

  let options = $state<{ channels: Option[]; staff: Option[] }>({ channels: [], staff: [] });

  $effect(() => {
    void loadRecipientOptions(authStore.selectedGuildId).then((res) => (options = res));
  });
</script>

<div class="flex flex-col gap-3">
  <label class="field" for="{idPrefix}-channel">
    <span class="field__label">{m.anx_rcpt_channel()}</span>
    <SearchableSelect id="{idPrefix}-channel" bind:value={channelId} options={options.channels} placeholder={m.anx_rcpt_channel_placeholder()} className="input w-full" showId={false} />
  </label>
  <div class="field">
    <span class="field__label" id="{idPrefix}-users-label">{m.anx_rcpt_users()}</span>
    <MultiSelect id="{idPrefix}-users" bind:values={userIds} options={options.staff} placeholder={m.anx_rcpt_users_placeholder()} />
    <span class="field__hint">{m.anx_rcpt_users_hint()}</span>
  </div>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .field__label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-on-surface);
  }

  .field__hint {
    font-size: 0.75rem;
    color: var(--color-on-surface-variant);
  }
</style>
