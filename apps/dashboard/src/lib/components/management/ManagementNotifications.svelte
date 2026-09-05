<script lang="ts">
  import Papicon from '../Papicon.svelte';
  import ToggleSwitch from '../ToggleSwitch.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import SettingsRow from './SettingsRow.svelte';
  import { m } from '../../i18n';
  import { moduleName } from '../../moduleLabels';

  let {
    features = $bindable([]),
    onNavigate = (_section: string) => {},
  }: {
    features?: any[];
    onNavigate?: (section: string) => void;
  } = $props();

  /**
   * Fonctionnalites dont le bot lit vraiment ces reglages. `notifyViaDM`,
   * `notifyViaDiscordChannel` et `metadata.webhookUrl` n'ont qu'un lecteur,
   * `staffLeadershipService`, et il ne les consulte que pour les absences. Les
   * proposer sur les quarante-six autres lignes donnait une page entiere de
   * reglages sans effet. Toute fonctionnalite qui apprend a les lire s'ajoute ici.
   */
  const NOTIFICATION_AWARE_FEATURES = ['absences'];

  const notifiableFeatures = $derived(
    features
      .map((feature: any, idx: number) => ({ feature, idx }))
      .filter(({ feature }) => NOTIFICATION_AWARE_FEATURES.includes(feature.featureKey))
  );

  const notificationMethods = $derived([
    { key: 'notifyViaDiscordChannel', label: m.mn_method_channel_label(), desc: m.mn_method_channel_desc() },
    { key: 'notifyViaDM', label: m.mn_method_dm_label(), desc: m.mn_method_dm_desc() },
  ]);

  const inputClass = 'w-full md:w-72 bg-surface-container-high text-on-surface text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 outline-none focus:ring-2 focus:ring-primary/30 transition-all';

  function setMethod(idx: number, key: string, value: boolean) {
    features[idx][key] = value;
    features = [...features];
  }
</script>

<div class="space-y-6">
  <SettingsGroup title={m.mn_title()} description={m.mn_desc()}>
    {#each notifiableFeatures as { feature, idx } (feature.featureKey)}
      <div class="rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/10 overflow-hidden bg-surface-container-high/10">
        <p class="px-4 py-3 text-sm font-medium">{moduleName(feature.featureKey, feature.featureName)}</p>

        {#each notificationMethods as method}
          <SettingsRow label={method.label} description={method.desc}>
            <ToggleSwitch
              checked={features[idx][method.key]}
              ariaLabel="{moduleName(feature.featureKey, feature.featureName)} - {method.label}"
              onToggle={(value) => setMethod(idx, method.key, value)}
            />
          </SettingsRow>
        {/each}

        <SettingsRow label={m.mn_webhook_url_label()} description={m.mn_webhook_url_desc()} labelFor="notify-webhook-{feature.featureKey}">
          <input
            id="notify-webhook-{feature.featureKey}"
            type="url"
            placeholder="https://discord.com/api/webhooks/..."
            bind:value={features[idx].metadata.webhookUrl}
            class={inputClass}
          />
        </SettingsRow>

        {#if feature.featureKey === 'absences'}
          <p class="px-4 py-3 text-[11px] leading-relaxed text-amber-300/80 bg-amber-500/5">
            {m.mn_absences_note()}
          </p>
        {/if}
      </div>
    {/each}

    <div class="flex items-start gap-3 p-4 rounded-lg bg-surface-container-high/20 border border-outline-variant/10">
      <Papicon icon="Hash" size={16} class="text-on-surface-variant/50 shrink-0 mt-0.5" />
      <p class="text-[12px] leading-relaxed text-on-surface-variant/70">
        {m.mn_channel_lives_in_channels_tab()}
        <button type="button" class="font-semibold text-primary hover:underline" onclick={() => onNavigate('channels')}>
          {m.mgmt_tab_channels_roles()}
        </button>
      </p>
    </div>
  </SettingsGroup>
</div>
