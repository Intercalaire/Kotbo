<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { unsavedChanges } from '../lib/stores/unsavedChanges.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import { m } from '../lib/i18n';
  import {
    applyGuildPreset,
    fetchFeatureConfigurations,
    updateFeatureConfiguration,
    updateRoleAccess,
    updateGlobalSettings,
    updateModuleStatus,
  } from '../lib/api';

  import ManagementOverview from '../lib/components/management/ManagementOverview.svelte';
  import ManagementFeatures from '../lib/components/management/ManagementFeatures.svelte';
  import ManagementChannelsRoles from '../lib/components/management/ManagementChannelsRoles.svelte';
  import ManagementAccess from '../lib/components/management/ManagementAccess.svelte';
  import ManagementNotifications from '../lib/components/management/ManagementNotifications.svelte';

  const OWNER_ID = 'management-center';

  // Cette page distribue les droits des autres pages : la reserver aux
  // administrateurs evite qu'un role puisse s'y accorder ce qu'on lui refuse.
  // L'API applique la meme regle, elle rejette tout le reste en 403.
  const canManageSettings = $derived(!!dashboardStore.state.access?.canManageSettings);
  const availableChannels = $derived(dashboardStore.state.discordChannels || []);
  const availableVoiceChannels = $derived(dashboardStore.state.discordVoiceChannels || []);
  const availableRoles = $derived(dashboardStore.state.discordRoles || []);

  // Le registre porte ce que la table de configuration ignore : module coeur,
  // verrou par offre, dependances. L'interrupteur d'activation s'en sert pour
  // ne pas proposer une bascule que le serveur refusera.
  const modulesById = $derived(
    new Map(((dashboardStore.state.modules as any[]) ?? []).map((mod) => [mod.id, mod]))
  );

  // L'onglet Acces ne pose de regles que sur les roles qui ouvrent le
  // dashboard : les proposer tous noyait les quelques-uns qui comptent parmi la
  // trentaine du serveur, et une regle posee sur un autre n'aurait rien change.
  const staffRoles = $derived.by(() => {
    const declared = new Set(dashboardStore.state.staffRoleIds || []);
    return availableRoles.filter((role: { id: string }) => declared.has(role.id));
  });

  type FeatureConfig = {
    id: string;
    featureKey: string;
    featureName: string;
    enabled: boolean;
    channelId: string | null;
    secondaryChannelId: string | null;
    requiredRoleId: string | null;
    notificationRoleId: string | null;
    notifyViaDiscordChannel: boolean;
    notifyViaDM: boolean;
    loggingEnabled: boolean;
    userActivityTracking: boolean;
    roleAccess: any[];
    roleAccessByRole: any[];
    notificationTargets: any[];
    metadata?: Record<string, unknown>;
  };

  type GuildSettings = Record<string, string | boolean>;

  const GUILD_SETTINGS_KEYS = [
    'configChannelId', 'regulationChannelId', 'logChannelId', 'publicChannelId',
    'digestChannelId', 'meetingAnnouncementChannelId', 'meetingVoiceChannelId',
    'newsChannelId', 'dailyAlgoChannelId', 'moderatorRoleId', 'baseStaffRoleId',
    'testStaffRoleId',
  ] as const;

  const GUILD_TOGGLE_KEYS = [
    'youtubeEnabled', 'digestEnabled', 'translationEnabled', 'codePoliceEnabled',
    'dailyAlgoEnabled', 'githubReleasesEnabled',
  ] as const;

  // `crossServerSanctionsEnabled` et `analyticsEnabled` sont actifs par defaut :
  // les lire comme les autres eteindrait a la premiere sauvegarde ce que
  // personne n'a demande d'eteindre.
  const GUILD_TOGGLE_KEYS_DEFAULT_ON = ['crossServerSanctionsEnabled', 'analyticsEnabled'] as const;

  const readGuildSettings = (): GuildSettings => {
    const s = dashboardStore.state as any;
    const draft: GuildSettings = {};
    for (const key of GUILD_SETTINGS_KEYS) draft[key] = s[key] || '';
    for (const key of GUILD_TOGGLE_KEYS) draft[key] = s[key] || false;
    for (const key of GUILD_TOGGLE_KEYS_DEFAULT_ON) draft[key] = s[key] ?? true;
    return draft;
  };

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  const SECTIONS = [
    { group: 'server', id: 'overview', icon: 'Grid', label: () => m.mgmt_nav_overview() },
    { group: 'server', id: 'channels', icon: 'Hash', label: () => m.mgmt_tab_channels_roles() },
    { group: 'modules', id: 'features', icon: 'Package', label: () => m.mgmt_nav_features() },
    { group: 'modules', id: 'notifications', icon: 'Bell', label: () => m.mgmt_nav_notifications() },
    { group: 'permissions', id: 'access', icon: 'Shield', label: () => m.mgmt_nav_access() },
  ];

  const GROUPS = [
    { id: 'server', label: () => m.mgmt_group_server() },
    { id: 'modules', label: () => m.mgmt_group_modules() },
    { id: 'permissions', label: () => m.mgmt_group_permissions() },
  ];

  let activeSection = $state('overview');
  let loading = $state(true);
  const saveAction = createAsyncActionState();

  let features = $state<FeatureConfig[]>([]);
  let savedFeatures = $state<FeatureConfig[]>([]);
  let guildSettings = $state<GuildSettings>({});
  let savedGuildSettings = $state<GuildSettings>({});

  const currentSection = $derived(SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0]);

  const settingsDirty = $derived(JSON.stringify(guildSettings) !== JSON.stringify(savedGuildSettings));
  const featuresDirty = $derived(JSON.stringify(features) !== JSON.stringify(savedFeatures));

  onMount(() => {
    void load();
  });
  onDestroy(() => unsavedChanges.release(OWNER_ID));

  // La barre de sauvegarde remplace les boutons d'enregistrement de chaque
  // onglet : sans elle, une modification faite dans « Salons » se perdait des
  // qu'on passait a « Acces » sans avoir vu le bouton reste en haut de page.
  $effect(() => {
    const dirty = settingsDirty || featuresDirty;
    untrack(() => {
      if (dirty) {
        unsavedChanges.register({
          id: OWNER_ID,
          label: m.mgmt_page_title(),
          onSave: () => saveAll(),
          onReset: () => {
            guildSettings = clone(savedGuildSettings);
            features = clone(savedFeatures);
          },
        });
      } else {
        unsavedChanges.release(OWNER_ID);
      }
    });
  });

  async function load({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) loading = true;
    try {
      // Les droits viennent de l'etat de guilde. Le lire avant de decider evite
      // que la page reponde « acces reserve » a un administrateur, au seul
      // motif qu'elle s'est montee avant que l'etat n'arrive.
      await dashboardStore.refresh();
      if (!canManageSettings) return;

      const result = await fetchFeatureConfigurations();
      const loaded: FeatureConfig[] = (result?.features ?? []).map((feature: any) => ({
        ...feature,
        metadata: feature.metadata || {},
        roleAccessByRole: feature.roleAccessByRole || [],
      }));

      features = loaded;
      savedFeatures = clone(loaded);
      guildSettings = readGuildSettings();
      savedGuildSettings = clone(guildSettings);
    } catch (err) {
      console.error('Erreur chargement config:', err);
      saveAction.setError(m.mgmt_load_error());
    } finally {
      if (!silent) loading = false;
    }
  }

  /**
   * `enabled` n'y figure pas : l'activation d'un module ne s'ecrit pas ici.
   * Voir `toggleModule`.
   */
  const featureConfigOf = (feature: FeatureConfig) => ({
    channelId: feature.channelId,
    secondaryChannelId: feature.secondaryChannelId,
    requiredRoleId: feature.requiredRoleId,
    notificationRoleId: feature.notificationRoleId,
    notifyViaDiscordChannel: feature.notifyViaDiscordChannel,
    notifyViaDM: feature.notifyViaDM,
    loggingEnabled: feature.loggingEnabled,
    userActivityTracking: feature.userActivityTracking,
    metadata: feature.metadata,
  });

  /**
   * N'envoie que ce qui a bouge. Pousser les quarante-huit fonctionnalites a
   * chaque enregistrement ferait quarante-huit ecritures, et surtout autant de
   * lignes d'audit pour une seule case cochee.
   */
  async function saveAll() {
    return saveAction.run(
      async () => {
        if (settingsDirty) {
          const ok = await updateGlobalSettings(guildSettings);
          if (!ok) throw new Error(m.mgmt_save_error());
        }

        const previous = new Map(savedFeatures.map((feature) => [feature.featureKey, feature]));

        for (const feature of features) {
          const before = previous.get(feature.featureKey);

          if (!before || JSON.stringify(featureConfigOf(before)) !== JSON.stringify(featureConfigOf(feature))) {
            const ok = await updateFeatureConfiguration(feature.featureKey, featureConfigOf(feature));
            if (!ok) throw new Error(m.mgmt_save_error());
          }

          if (!before || JSON.stringify(before.roleAccessByRole) !== JSON.stringify(feature.roleAccessByRole)) {
            const ok = await updateRoleAccess(feature.featureKey, feature.roleAccessByRole);
            if (!ok) throw new Error(m.mgmt_save_error());
          }
        }

        // Relire plutot que de promouvoir le brouillon : le serveur normalise
        // ce qu'il enregistre - un identifiant de salon est nettoye, un module
        // peut en rallumer un autre dont il depend. Garder l'ecran sur ses
        // propres valeurs le ferait mentir jusqu'au prochain chargement.
        await load({ silent: true });
        return true;
      },
      { successMessage: m.mgmt_saved() }
    );
  }

  /**
   * Allumer un module n'est pas un reglage de plus : le serveur ecrit aussi la
   * table propre au module, propage la cascade des dependances, refuse les
   * modules coeur et ceux hors offre, puis purge son cache d'etats. Ecrire
   * `enabled` sur la ligne de configuration ferait une pastille juste et un bot
   * qui n'a rien change. La bascule part donc seule, tout de suite.
   */
  async function toggleModule(featureKey: string, enabled: boolean) {
    await saveAction.run(async () => {
      const ok = await updateModuleStatus(featureKey, enabled ? 'active' : 'inactive');
      if (!ok) throw new Error(m.mgmt_module_toggle_error());
      await syncModuleStates();
      return true;
    });
  }

  /**
   * Ne relit que les etats d'activation, cascade comprise. Un rechargement
   * complet emporterait les modifications en attente sur le reste de la page :
   * la bascule d'un module est immediate, les reglages qui l'entourent ne le
   * sont pas, et un salon choisi sans avoir encore enregistre disparaitrait au
   * premier interrupteur touche. Les deux copies recoivent la meme valeur, pour
   * qu'un etat venu du serveur ne se presente pas comme une modification a
   * enregistrer.
   */
  async function syncModuleStates() {
    await dashboardStore.refresh();
    const result = await fetchFeatureConfigurations();
    const states = new Map<string, boolean>(
      (result?.features ?? []).map((feature: any) => [feature.featureKey, feature.enabled])
    );
    const apply = (list: FeatureConfig[]) =>
      list.map((feature) =>
        states.has(feature.featureKey) ? { ...feature, enabled: states.get(feature.featureKey)! } : feature
      );

    features = apply(features);
    savedFeatures = apply(savedFeatures);
  }

  /**
   * Un preset reecrit tous les acces d'un coup : c'est une action, pas une
   * modification en attente. Elle part donc immediatement, et recharge la page
   * plutot que de laisser un brouillon decrire un etat qui n'existe plus.
   */
  async function handleApplyPreset(presetKey: string) {
    const confirmed = await confirmDialog.ask({
      title: m.mgmt_preset_confirm_title({ preset: presetKey }),
      description: m.mgmt_preset_confirm_desc(),
      confirmLabel: m.mgmt_preset_confirm_label(),
      variant: 'warning',
    });
    if (!confirmed) return;

    await saveAction.run(async () => {
      const ok = await applyGuildPreset(presetKey);
      if (!ok) throw new Error(m.mgmt_save_error());
      unsavedChanges.release(OWNER_ID);
      await load();
      toast.success(m.mgmt_preset_applied({ preset: presetKey }));
      return true;
    });
  }
</script>

<div class="mgmt animate-in fade-in duration-500">
  <header class="mgmt__header">
    <div class="mgmt__identity">
      <div class="mgmt__badge bg-primary/10 text-primary">
        <Papicon icon="Gear" size={20} />
      </div>
      <div class="min-w-0">
        <h1 class="text-lg font-semibold tracking-tight leading-tight">{m.mgmt_page_title()}</h1>
        <p class="text-sm text-on-surface-variant/70 font-medium">{m.mgmt_page_desc()}</p>
      </div>
    </div>
    <InlineFeedback state={saveAction} />
  </header>

  {#if loading}
    <div class="space-y-4">
      {#each Array(4) as _}
        <div class="p-5 rounded-xl bg-surface-container/30 border border-outline-variant/5 space-y-3">
          <Skeleton width="180px" height="16px" />
          <Skeleton width="100%" height="56px" radius="12px" />
        </div>
      {/each}
      <div class="flex justify-center pt-2">
        <LoadingHint context="config" />
      </div>
    </div>
  {:else if !canManageSettings}
    <div class="mgmt__denied bg-error/5 border border-error/10">
      <div class="w-16 h-16 bg-error/10 rounded-full flex items-center justify-center mx-auto text-error">
        <Papicon icon="ShieldWarning" size={32} />
      </div>
      <div class="space-y-2">
        <h2 class="text-xl font-semibold text-error">{m.mgmt_no_access_title()}</h2>
        <p class="text-on-surface-variant text-sm max-w-xs mx-auto">{m.mgmt_no_access_desc()}</p>
      </div>
    </div>
  {:else}
    <div class="mgmt__layout">
      <nav class="mgmt__nav" aria-label={m.mgmt_page_title()}>
        {#each GROUPS as group}
          {@const items = SECTIONS.filter((section) => section.group === group.id)}
          {#if items.length > 0}
            <div class="mgmt__nav-group">
              <p class="mgmt__nav-title">{group.label()}</p>
              {#each items as section}
                <button
                  type="button"
                  class="mgmt__nav-item {activeSection === section.id ? 'is-active' : ''}"
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  onclick={() => (activeSection = section.id)}
                >
                  <Papicon icon={section.icon} size={16} />
                  <span>{section.label()}</span>
                </button>
              {/each}
            </div>
          {/if}
        {/each}
      </nav>

      <div class="mgmt__panel">
        <h2 class="mgmt__panel-title">{currentSection.label()}</h2>

        {#key activeSection}
          <div in:fade={{ duration: 150 }}>
            {#if activeSection === 'overview'}
              <ManagementOverview {features} {guildSettings} onNavigate={(id) => (activeSection = id)} />
            {:else if activeSection === 'features'}
              <ManagementFeatures bind:features modules={modulesById} onToggleModule={toggleModule} />
            {:else if activeSection === 'channels'}
              <ManagementChannelsRoles
                bind:features
                bind:guildSettings
                {availableChannels}
                {availableVoiceChannels}
                {availableRoles}
              />
            {:else if activeSection === 'access'}
              <ManagementAccess
                bind:features
                availableRoles={staffRoles}
                onApplyPreset={handleApplyPreset}
              />
            {:else if activeSection === 'notifications'}
              <ManagementNotifications bind:features {availableChannels} {availableRoles} />
            {/if}
          </div>
        {/key}
      </div>
    </div>
  {/if}
</div>

<style>
  .mgmt {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    /* La barre de sauvegarde flotte au-dessus du bas de page. Sans cette marge
       elle recouvre la derniere ligne de reglages, qui est justement celle
       qu'on vient de modifier. */
    padding-bottom: 5rem;
  }

  .mgmt__header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.25rem;
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--surface-container-low) 40%, transparent);
    border: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
  }

  .mgmt__identity {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-width: 0;
  }

  .mgmt__badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.5rem;
    flex-shrink: 0;
  }

  .mgmt__denied {
    padding: 3rem;
    border-radius: 0.75rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .mgmt__layout {
    display: grid;
    grid-template-columns: 14rem minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }

  .mgmt__nav {
    position: sticky;
    top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 0.75rem;
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--surface-container-low) 40%, transparent);
    border: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
  }

  .mgmt__nav-group {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .mgmt__nav-title {
    margin: 0 0 0.375rem 0.75rem;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--on-surface-variant) 60%, transparent);
  }

  .mgmt__nav-item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: color-mix(in srgb, var(--on-surface-variant) 85%, transparent);
    font-size: 0.875rem;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .mgmt__nav-item:hover {
    background: color-mix(in srgb, var(--on-surface) 6%, transparent);
    color: var(--on-surface);
  }

  .mgmt__nav-item.is-active {
    background: var(--surface-container-high);
    color: var(--on-surface);
    font-weight: 600;
  }

  .mgmt__panel {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .mgmt__panel-title {
    margin: 0;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
    font-size: 1.25rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--on-surface);
  }

  @media (max-width: 900px) {
    .mgmt__layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .mgmt__nav {
      position: static;
      flex-direction: row;
      gap: 1rem;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .mgmt__nav::-webkit-scrollbar {
      display: none;
    }

    .mgmt__nav-group {
      flex-direction: row;
      gap: 0.25rem;
    }

    .mgmt__nav-title {
      display: none;
    }

    .mgmt__nav-item {
      width: auto;
      white-space: nowrap;
    }
  }
</style>
