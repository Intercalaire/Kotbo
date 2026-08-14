<script lang="ts">
  /**
   * Prestige - pilotage du classement competitif (RP).
   *
   * Le module se greffe sur le leveling : les gains de RP derivent de l'XP
   * reellement accordee, d'ou l'absence ici de tout reglage de cooldown ou
   * d'exclusion de salon, qui vivent sur la page Niveaux.
   *
   * La page se regle comme celle des niveaux : on entre par des prereglages, et
   * la configuration detaillee attend derriere des onglets, avec les memes
   * curseurs a crans et le meme mode avance. Les paliers, eux, ne se saisissent
   * plus un par un : une courbe les pose tous, et le nombre de paliers - donc de
   * roles a tenir - est le premier curseur de la carte.
   */
  import { onMount, onDestroy, untrack } from 'svelte';
  import { router } from 'tinro';
  import {
    fetchRankedOverview,
    updateRankedConfig,
    setRankedTierRole,
    removeRankedTierRole,
    createRankedEvent,
    cancelRankedEvent,
    previewRankedDecay,
    runRankedDecay,
    fetchRankedLadderImpact,
    provisionRankedTierRoles,
    fetchRankedTierRoleSync,
    runRankedTierRoleSync,
  } from '../lib/api';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { unsavedChanges } from '../lib/stores/unsavedChanges.svelte';
  import { resolveTabFromUrl, gotoTab } from '../lib/tabRouting';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { createSimpleModePreference, nearestStep } from '../lib/simpleMode.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import SectionCard from '../lib/components/SectionCard.svelte';
  import MetricCard from '../lib/components/MetricCard.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';
  import UserDisplay from '../lib/components/UserDisplay.svelte';
  import EmptyState from '../lib/components/EmptyState.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import SimpleModeToggle from '../lib/components/SimpleModeToggle.svelte';
  import SimpleModeNotice from '../lib/components/SimpleModeNotice.svelte';
  import RankedPresetPicker from '../lib/components/RankedPresetPicker.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import { m } from '../lib/i18n';
  import {
    LADDER_CURVE_LIMITS,
    LADDER_EXPONENT_STEPS,
    LADDER_PACE_FACTORS,
    LADDER_REFERENCE_BASE_RP,
    RP_GAIN_STEPS,
    findRankedPreset,
    generateRankedLadder,
    ladderApexRp,
    ladderMatchesCurve,
    ladderPaceBaseRp,
    rankedPresetValues,
    type RankedLadder,
    type RankedPreset,
    type RankedPresetValues,
  } from '@kotbo/shared';

  type Tier = { key: string; tier: string; division: number; name: string; minRp: number; color: string };
  type LeaderboardEntry = { rank: number; userId: string; rp: number; tier: Tier; streakDays: number; flames: number; percent: number };
  type StreakEntry = { rank: number; userId: string; streakDays: number; bestStreak: number; flames: number };
  type RankedEvent = {
    id: string;
    type: string;
    name: string;
    multiplier: number;
    startsAt: string;
    endsAt: string;
    status: string;
    participants: number;
    bonusRpGranted: number;
  };

  const prestigeTabs = ['accueil', 'gains', 'echelle', 'evenements', 'classement'] as const;
  type PrestigeTab = (typeof prestigeTabs)[number];
  const DEFAULT_TAB: PrestigeTab = 'accueil';
  let activeTab = $state<PrestigeTab>(DEFAULT_TAB);

  $effect(() => {
    const _path = $router.path;
    activeTab = resolveTabFromUrl('/prestige', prestigeTabs, DEFAULT_TAB) as PrestigeTab;
  });

  const saveAction = createAsyncActionState();
  const roleAction = createAsyncActionState();

  let loading = $state(true);
  let config = $state<Record<string, any> | null>(null);
  let savedConfig = $state<Record<string, any> | null>(null);
  let savedLadder = $state<RankedLadder>([]);
  let tierRoles = $state<Array<{ tierKey: string; roleId: string }>>([]);
  let stats = $state<any>(null);
  let leaderboard = $state<LeaderboardEntry[]>([]);
  let streaks = $state<StreakEntry[]>([]);
  let events = $state<RankedEvent[]>([]);
  let decayPreview = $state<{ affected: number; rpLost: number } | null>(null);

  let showEventForm = $state(false);
  let newEvent = $state({ type: 'MESSAGE_RUSH', name: '', multiplier: 2, durationMinutes: 60, announceChannelId: '' });

  /**
   * L'API ferme les routes d'un module eteint (403 `module_disabled`), comme
   * pour tous les autres modules. Sans ce garde-fou, ouvrir la page d'un
   * prestige desactive declencherait un appel voue a l'echec et un bandeau
   * d'erreur trompeur : le module n'est pas en panne, il est juste eteint.
   */
  const moduleEnabled = $derived.by(() => {
    const mod = (dashboardStore.state.modules as Array<{ id: string; status: string }>).find((entry) => entry.id === 'prestige');
    return !mod || mod.status === 'active';
  });

  const channels = $derived((dashboardStore.state.discordChannels ?? []) as Array<{ id: string; name: string }>);
  const roles = $derived((dashboardStore.state.discordRoles ?? []) as Array<{ id: string; name: string; color?: number }>);

  const EVENT_TYPES = [
    { value: 'MESSAGE_RUSH', label: 'Message Rush' },
    { value: 'REACTION_STORM', label: 'Reaction Storm' },
    { value: 'VOCAL_TIME', label: 'Vocal Time' },
    { value: 'CUSTOM', label: 'Custom' },
  ];

  /** Colonnes que la page edite : le reste de la config n'est pas renvoye. */
  const EDITABLE_KEYS = [
    'rpPerXp', 'reactionRp', 'reactionDailyCap', 'dailyRpCap',
    'streakEnabled', 'streakBonusPerDay', 'streakMaxBonus', 'streakGraceDays',
    'streakWeeklyFreezes', 'streakMaxFreezes',
    'decayEnabled', 'decayGraceDays', 'decayRpPerDay', 'decayPercentPerDay', 'decayFloorTierKey',
    'ladderTierCount', 'ladderBaseRp', 'ladderExponent', 'ladderDivisions',
    'tierRolesEnabled', 'tierRolesExclusive',
    'announceChannelId', 'announcePromotions', 'announceDemotions', 'globalLeaderboard',
  ] as const;

  function editableSnapshot(source: Record<string, any> | null): Record<string, any> {
    if (!source) return {};
    return Object.fromEntries(EDITABLE_KEYS.map((key) => [key, source[key]]));
  }

  const configDirty = $derived(
    !!config && JSON.stringify(editableSnapshot(config)) !== JSON.stringify(editableSnapshot(savedConfig)),
  );

  $effect(() => {
    const dirty = configDirty;
    if (dirty) {
      untrack(() => {
        unsavedChanges.register({
          id: 'prestige',
          label: m.prg_page_title(),
          onSave: () => handleSave(),
          onReset: () => { config = JSON.parse(JSON.stringify(savedConfig)); },
        });
      });
    } else {
      untrack(() => unsavedChanges.release('prestige'));
    }
  });

  onDestroy(() => {
    unsavedChanges.release('prestige');
    if (syncTimer) clearInterval(syncTimer);
  });

  // ---------------------------------------------------------------------------
  // Courbe de l'echelle
  // ---------------------------------------------------------------------------

  const curveValues = $derived<RankedPresetValues>({
    rpPerXp: config?.rpPerXp ?? 0,
    reactionRp: config?.reactionRp ?? 0,
    reactionDailyCap: config?.reactionDailyCap ?? 0,
    dailyRpCap: config?.dailyRpCap ?? 0,
    ladderTierCount: config?.ladderTierCount ?? 19,
    ladderBaseRp: config?.ladderBaseRp ?? LADDER_REFERENCE_BASE_RP,
    ladderExponent: config?.ladderExponent ?? 1.35,
    ladderDivisions: config?.ladderDivisions ?? 3,
    decayEnabled: config?.decayEnabled ?? false,
    streakEnabled: config?.streakEnabled ?? true,
  });

  /** L'echelle telle que la courbe en cours d'edition la produirait. */
  const previewLadder = $derived(generateRankedLadder({
    tierCount: curveValues.ladderTierCount,
    baseRp: curveValues.ladderBaseRp,
    exponent: curveValues.ladderExponent,
    divisions: curveValues.ladderDivisions,
  }));

  /**
   * L'echelle enregistree est-elle celle que decrivent les curseurs ?
   *
   * Une echelle retouchee palier par palier (par le MCP, une ancienne version,
   * ou un import) ne tombe sur aucune courbe : les curseurs affichent alors une
   * echelle qui n'est pas celle qui tourne, et la page le dit plutot que de la
   * remplacer d'office.
   */
  const ladderOffGrid = $derived(
    savedLadder.length > 0 && savedConfig !== null && !ladderMatchesCurve(savedLadder, {
      tierCount: savedConfig.ladderTierCount,
      baseRp: savedConfig.ladderBaseRp,
      exponent: savedConfig.ladderExponent,
      divisions: savedConfig.ladderDivisions,
    }),
  );

  /** L'echelle qui tourne aujourd'hui : celle du serveur, pas celle en cours d'edition. */
  const activeLadder = $derived<Tier[]>(savedLadder as Tier[]);

  const ladderDirty = $derived(
    !!config && !!savedConfig && (
      config.ladderTierCount !== savedConfig.ladderTierCount
      || config.ladderBaseRp !== savedConfig.ladderBaseRp
      || config.ladderExponent !== savedConfig.ladderExponent
      || config.ladderDivisions !== savedConfig.ladderDivisions
    ),
  );

  const tierCountStep = $derived(curveValues.ladderTierCount);
  const pacePreviewStep = $derived(nearestStep(
    LADDER_PACE_FACTORS,
    (curveValues.ladderBaseRp || LADDER_REFERENCE_BASE_RP) / LADDER_REFERENCE_BASE_RP,
  ));
  const steepPreviewStep = $derived(nearestStep(LADDER_EXPONENT_STEPS, curveValues.ladderExponent));

  const LADDER_PACE_LABELS = [
    m.prg_ladder_pace_1, m.prg_ladder_pace_2, m.prg_ladder_pace_3, m.prg_ladder_pace_4, m.prg_ladder_pace_5,
  ];
  const LADDER_STEEP_LABELS = [
    m.prg_ladder_steep_1, m.prg_ladder_steep_2, m.prg_ladder_steep_3, m.prg_ladder_steep_4, m.prg_ladder_steep_5,
  ];
  const GAIN_LABELS = [
    m.prg_gains_level_1, m.prg_gains_level_2, m.prg_gains_level_3, m.prg_gains_level_4, m.prg_gains_level_5,
  ];

  const ladderMode = createSimpleModePreference('kotbo_ranked_ladder_mode');
  const gainMode = createSimpleModePreference('kotbo_ranked_gain_mode');

  function ladderFitsSimpleMode(): boolean {
    const pace = ladderPaceBaseRp(nearestStep(
      LADDER_PACE_FACTORS,
      (curveValues.ladderBaseRp || LADDER_REFERENCE_BASE_RP) / LADDER_REFERENCE_BASE_RP,
    ));
    const steep = LADDER_EXPONENT_STEPS[nearestStep(LADDER_EXPONENT_STEPS, curveValues.ladderExponent) - 1];
    return pace === curveValues.ladderBaseRp && steep === curveValues.ladderExponent;
  }

  function gainsFitSimpleMode(): boolean {
    return RP_GAIN_STEPS.some((step) =>
      step.rpPerXp === curveValues.rpPerXp
      && step.reactionRp === curveValues.reactionRp
      && step.reactionDailyCap === curveValues.reactionDailyCap
      && step.dailyRpCap === curveValues.dailyRpCap);
  }

  const gainsStep = $derived(nearestStep(RP_GAIN_STEPS.map((step) => step.rpPerXp), curveValues.rpPerXp));
  const gainsOffGrid = $derived(gainMode.simple && !gainsFitSimpleMode());
  const curveOffGrid = $derived(ladderMode.simple && !ladderFitsSimpleMode());

  function applyGainsStep(step: number) {
    if (!config) return;
    const preset = RP_GAIN_STEPS[Math.min(RP_GAIN_STEPS.length, Math.max(1, step)) - 1];
    config.rpPerXp = preset.rpPerXp;
    config.reactionRp = preset.reactionRp;
    config.reactionDailyCap = preset.reactionDailyCap;
    config.dailyRpCap = preset.dailyRpCap;
  }

  function applyLadderPace(step: number) {
    if (!config) return;
    config.ladderBaseRp = ladderPaceBaseRp(step);
  }

  function applyLadderSteepness(step: number) {
    if (!config) return;
    config.ladderExponent = LADDER_EXPONENT_STEPS[Math.min(LADDER_EXPONENT_STEPS.length, Math.max(1, step)) - 1];
  }

  // ---------------------------------------------------------------------------
  // Prereglages
  // ---------------------------------------------------------------------------

  const selectedPreset = $derived(findRankedPreset(curveValues));
  const activePreset = $derived(savedConfig ? findRankedPreset(savedConfig as Partial<RankedPresetValues>) : null);
  const customPresetValues = $derived<RankedPresetValues>(
    selectedPreset && savedConfig
      ? {
          rpPerXp: savedConfig.rpPerXp,
          reactionRp: savedConfig.reactionRp,
          reactionDailyCap: savedConfig.reactionDailyCap,
          dailyRpCap: savedConfig.dailyRpCap,
          ladderTierCount: savedConfig.ladderTierCount,
          ladderBaseRp: savedConfig.ladderBaseRp,
          ladderExponent: savedConfig.ladderExponent,
          ladderDivisions: savedConfig.ladderDivisions,
          decayEnabled: savedConfig.decayEnabled,
          streakEnabled: savedConfig.streakEnabled,
        }
      : curveValues,
  );

  function applyPreset(preset: RankedPreset) {
    if (!config) return;
    Object.assign(config, rankedPresetValues(preset));
    gainMode.resolve(gainsFitSimpleMode());
    ladderMode.resolve(ladderFitsSimpleMode());
  }

  // ---------------------------------------------------------------------------
  // Chargement & enregistrement
  // ---------------------------------------------------------------------------

  function applyOverview(data: any) {
    config = data.config;
    savedConfig = JSON.parse(JSON.stringify(data.config));
    savedLadder = data.ladder ?? [];
    tierRoles = data.tierRoles ?? [];
    stats = data.stats;
    leaderboard = data.leaderboard ?? [];
    streaks = data.streaks ?? [];
    events = data.events ?? [];
    if (data.tierRoleSync) {
      roleSync = data.tierRoleSync;
      if (roleSync.running) watchRoleSync();
    }
  }

  async function load() {
    if (!moduleEnabled) {
      loading = false;
      return;
    }
    loading = true;
    try {
      applyOverview(await fetchRankedOverview());
      gainMode.resolve(gainsFitSimpleMode());
      ladderMode.resolve(ladderFitsSimpleMode());
    } catch {
      toast.error(m.prg_load_error());
    } finally {
      loading = false;
    }
  }

  async function handleSave(): Promise<boolean> {
    if (!config) return false;
    let retiered = 0;
    const success = await saveAction.run(async () => {
      const result: any = await updateRankedConfig(editableSnapshot(config));
      if (!result?.config) throw new Error(m.prg_save_error());
      config = result.config;
      savedConfig = JSON.parse(JSON.stringify(result.config));
      if (result.ladder) savedLadder = result.ladder;
      retiered = result.retiered ?? 0;
      return true;
    }, { successMessage: m.prg_saved(), failureMessage: m.prg_save_error() });

    // Le compte rendu du serveur remplace le message generique : reclasser des
    // membres est la consequence la moins evidente d'un curseur d'echelle.
    if (success && retiered > 0) {
      saveAction.setMessage(m.prg_saved_retiered({ count: retiered.toLocaleString() }));
    }
    return success;
  }

  /**
   * Un reglage isole (interrupteur, salon d'annonce) s'enregistre seul : il n'a
   * aucune raison d'attendre le bandeau de sauvegarde, et le laisser en attente
   * ferait croire a un echec.
   */
  async function patch(changes: Record<string, unknown>) {
    if (!config) return;
    Object.assign(config, changes);
    try {
      const result: any = await updateRankedConfig(changes);
      // Seules les colonnes envoyees passent dans l'instantane : reprendre la
      // config entiere effacerait les curseurs encore en attente d'un
      // enregistrement, sans que rien ne le signale.
      if (result?.config && savedConfig) {
        for (const key of Object.keys(changes)) savedConfig[key] = result.config[key];
        if (result.ladder) savedLadder = result.ladder;
      }
      toast.success(m.prg_saved());
    } catch {
      toast.error(m.prg_save_error());
      await load();
    }
  }

  async function bindRole(tierKey: string, roleId: string) {
    try {
      if (!roleId) {
        await removeRankedTierRole(tierKey);
        tierRoles = tierRoles.filter((mapping) => mapping.tierKey !== tierKey);
      } else {
        await setRankedTierRole(tierKey, roleId);
        tierRoles = [...tierRoles.filter((mapping) => mapping.tierKey !== tierKey), { tierKey, roleId }];
      }
      toast.success(m.prg_saved());
    } catch {
      toast.error(m.prg_save_error());
    }
  }

  function roleFor(tierKey: string): string | null {
    return tierRoles.find((mapping) => mapping.tierKey === tierKey)?.roleId ?? null;
  }

  /** Paliers encore sans role : le chiffre qui decide de l'interet du bouton. */
  const tiersWithoutRole = $derived(
    activeLadder.filter((tier) => {
      const roleId = roleFor(tier.key);
      return !roleId || !roles.some((role) => role.id === roleId);
    }).length,
  );

  // ---------------------------------------------------------------------------
  // Roles de palier : creation et attribution
  // ---------------------------------------------------------------------------

  const PROVISION_ERRORS: Record<string, () => string> = {
    missing_manage_roles: m.prg_roles_err_permission,
    role_limit: m.prg_roles_err_limit,
    guild_unavailable: m.prg_roles_err_guild,
    tier_roles_disabled: m.prg_roles_err_disabled,
    no_tier_roles: m.prg_roles_err_none,
    no_members: m.prg_roles_err_no_members,
  };

  async function handleProvisionRoles() {
    await roleAction.run(async () => {
      const result: any = await provisionRankedTierRoles();
      if (!result) throw new Error(m.prg_roles_err_failed());
      if (result.error && !result.created) {
        throw new Error((PROVISION_ERRORS[result.error] ?? m.prg_roles_err_failed)());
      }
      tierRoles = result.tierRoles ?? tierRoles;
      roleAction.setMessage(
        result.created === 0
          ? m.prg_roles_created_none()
          : m.prg_roles_created({ created: result.created, kept: result.kept }),
      );
      return true;
    });
  }

  let roleSync = $state<{ pending: number; done: number; updated: number; running: boolean }>({ pending: 0, done: 0, updated: 0, running: false });
  let syncTimer: ReturnType<typeof setInterval> | null = null;

  function watchRoleSync() {
    if (syncTimer) return;
    syncTimer = setInterval(async () => {
      const status: any = await fetchRankedTierRoleSync().catch(() => null);
      if (status) roleSync = status;
      if (!roleSync.running && syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
    }, 3000);
  }

  async function startRoleSync() {
    await roleAction.run(async () => {
      const status: any = await runRankedTierRoleSync();
      if (!status) throw new Error(m.prg_roles_err_failed());
      if (status.error && !status.started) {
        throw new Error((PROVISION_ERRORS[status.error] ?? m.prg_roles_err_failed)());
      }
      roleSync = { pending: status.pending ?? 0, done: status.done ?? 0, updated: status.updated ?? 0, running: true };
      watchRoleSync();
      return true;
    }, { successMessage: m.prg_roles_sync_started() });
  }

  async function stopRoleSync() {
    const status: any = await runRankedTierRoleSync({ stop: true }).catch(() => null);
    if (status) roleSync = status;
  }

  // ---------------------------------------------------------------------------
  // Repartition des membres sur l'echelle en cours d'edition
  // ---------------------------------------------------------------------------

  type LadderImpact = { total: number; changed: number; distribution: number[] };
  let impactRaw = $state<LadderImpact | null>(null);

  $effect(() => {
    if (loading || !config) return;
    const curve = {
      tierCount: curveValues.ladderTierCount,
      baseRp: curveValues.ladderBaseRp,
      exponent: curveValues.ladderExponent,
      divisions: curveValues.ladderDivisions,
    };
    let cancelled = false;
    // Debounce : sans lui, un curseur tire une requete par cran traverse.
    const timer = setTimeout(async () => {
      const result: any = await fetchRankedLadderImpact({ curve }).catch(() => null);
      if (!cancelled) impactRaw = Array.isArray(result?.distribution) ? result : null;
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  // Une guilde sans membre classe n'a rien a montrer : ni histogramme vide, ni
  // « aucun membre ne change de palier », qui se lirait comme un resultat.
  const impact = $derived(impactRaw && impactRaw.total > 0 ? impactRaw : null);
  const impactMax = $derived(Math.max(...(impact?.distribution ?? []), 1));

  /** Ecart entre deux paliers : ce que la barre du graphique represente. */
  const ladderGaps = $derived(previewLadder.map((tier, index) => ({
    tier,
    gap: index === 0 ? 0 : tier.minRp - previewLadder[index - 1].minRp,
  })));
  const ladderGapMax = $derived(Math.max(...ladderGaps.map((entry) => entry.gap), 1));

  const apexRp = $derived(ladderApexRp(previewLadder));

  /**
   * Duree estimee pour atteindre le sommet, a partir du rythme de gains reglé
   * ici et d'une activite choisie. Les curseurs repondent chacun a un fragment,
   * aucun ne dit combien de temps l'echelle demande.
   */
  const ACTIVITY_PRESETS = [10, 30, 100];
  const ACTIVITY_LABELS = [m.prg_estimate_activity_low, m.prg_estimate_activity_mid, m.prg_estimate_activity_high];
  /** XP moyenne d'un message, valeur par defaut du module Niveaux. */
  const TYPICAL_XP_PER_MESSAGE = 20;

  let activityStep = $state(2);

  const estimatedRpPerDay = $derived.by(() => {
    const fromXp = ACTIVITY_PRESETS[activityStep - 1] * TYPICAL_XP_PER_MESSAGE * (curveValues.rpPerXp || 0);
    const fromReactions = Math.min(curveValues.reactionDailyCap || 0, 10) * (curveValues.reactionRp || 0);
    const perDay = fromXp + fromReactions;
    return curveValues.dailyRpCap > 0 ? Math.min(perDay, curveValues.dailyRpCap) : perDay;
  });

  function estimateDays(rp: number): number {
    if (estimatedRpPerDay <= 0) return Infinity;
    return rp / estimatedRpPerDay;
  }

  function formatDuration(days: number): string {
    if (!Number.isFinite(days)) return '-';
    if (days < 1) return m.prg_estimate_under_a_day();
    if (days < 60) return m.prg_estimate_days({ days: Math.round(days) });
    if (days < 730) return m.prg_estimate_months({ months: Math.round(days / 30) });
    return m.prg_estimate_years({ years: (days / 365).toFixed(1) });
  }

  /** Quatre reperes de l'echelle : le premier promu, deux paliers intermediaires, le sommet. */
  const ladderMilestones = $derived.by(() => {
    const count = previewLadder.length;
    if (count === 0) return [];
    const indexes = [...new Set([1, Math.floor(count / 3), Math.floor((count * 2) / 3), count - 1])]
      .filter((index) => index > 0 && index < count);
    return indexes.map((index) => previewLadder[index]);
  });

  // ---------------------------------------------------------------------------
  // Decay & evenements
  // ---------------------------------------------------------------------------

  async function handlePreviewDecay() {
    try {
      decayPreview = (await previewRankedDecay()) as any;
    } catch {
      toast.error(m.prg_load_error());
    }
  }

  async function handleRunDecay() {
    try {
      const report: any = await runRankedDecay();
      toast.success(m.prg_decay_ran({ affected: report.affected, rpLost: report.rpLost }));
      await load();
    } catch {
      toast.error(m.prg_save_error());
    }
  }

  async function handleCreateEvent() {
    try {
      await createRankedEvent({
        type: newEvent.type,
        name: newEvent.name || EVENT_TYPES.find((t) => t.value === newEvent.type)?.label || newEvent.type,
        multiplier: newEvent.multiplier,
        durationMinutes: newEvent.durationMinutes,
        announceChannelId: newEvent.announceChannelId || undefined,
      });
      showEventForm = false;
      newEvent = { type: 'MESSAGE_RUSH', name: '', multiplier: 2, durationMinutes: 60, announceChannelId: '' };
      toast.success(m.prg_event_created());
      await load();
    } catch {
      toast.error(m.prg_save_error());
    }
  }

  async function handleCancelEvent(eventId: string) {
    try {
      await cancelRankedEvent(eventId);
      toast.success(m.prg_event_cancelled());
      await load();
    } catch {
      toast.error(m.prg_save_error());
    }
  }

  function statusLabel(status: string): string {
    if (status === 'RUNNING') return m.prg_event_status_running();
    if (status === 'SCHEDULED') return m.prg_event_status_scheduled();
    if (status === 'CANCELLED') return m.prg_event_status_cancelled();
    return m.prg_event_status_ended();
  }

  function statusClass(status: string): string {
    if (status === 'RUNNING') return 'bg-emerald-500/10 text-emerald-500';
    if (status === 'SCHEDULED') return 'bg-primary/10 text-primary';
    if (status === 'CANCELLED') return 'bg-rose-500/10 text-rose-500';
    return 'bg-surface-container-high/40 text-on-surface-variant';
  }

  onMount(load);

  // L'interrupteur de l'en-tete rafraichit le store des modules mais ne sait
  // rien de cette page. Sans ce rappel, allumer le prestige laisserait un ecran
  // vide jusqu'au prochain rechargement manuel.
  $effect(() => {
    if (moduleEnabled && config === null && !loading) void load();
  });
</script>

<!-- Bandeau d'enregistrement des onglets detailles : les curseurs posent
     plusieurs colonnes a la fois, les enregistrer champ par champ ferait
     autant de requetes que de crans traverses. -->
{#snippet saveBar()}
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-container-low/30 border border-outline-variant/10 rounded-xl px-6 py-5">
    <p class="text-[13px] text-on-surface-variant/70">{m.prg_presets_save_hint()}</p>
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={() => { config = JSON.parse(JSON.stringify(savedConfig)); }}
        class="px-5 py-3 rounded-lg text-[13px] font-medium text-on-surface-variant hover:bg-surface-container-high/40 transition-all"
      >
        {m.prg_btn_reset()}
      </button>
      <button
        type="button"
        onclick={handleSave}
        disabled={saveAction.state.loading}
        class="px-6 py-3 bg-primary hover:bg-primary/90 text-on-primary text-[13px] font-medium rounded-lg shadow-md shadow-primary/20 transition-all disabled:opacity-50 flex items-center gap-2"
      >
        <Papicon icon="Check" size={16} />
        {m.prg_presets_save()}
      </button>
    </div>
  </div>
{/snippet}

<ModulePage
  title={m.prg_page_title()}
  description={m.prg_page_desc()}
  icon="crown"
  featureKey="prestige"
>
  {#snippet actions()}
    {#if !loading && config}
      <button
        type="button"
        onclick={() => gotoTab('/prestige', activeTab === 'accueil' ? 'gains' : 'accueil', DEFAULT_TAB)}
        class="group flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold bg-primary text-on-primary shadow-md shadow-primary/20 hover:bg-primary/90 transition-all"
      >
        <Papicon icon={activeTab === 'accueil' ? 'Settings' : 'ArrowLeft'} size={15} />
        {activeTab === 'accueil' ? m.prg_presets_open_advanced() : m.prg_presets_back()}
      </button>
    {/if}
  {/snippet}

  {#if loading}
    <LoadingHint context="config" />
  {:else if config}
    <InlineFeedback state={saveAction} />
    <InlineFeedback state={roleAction} />

    {#if activeTab !== 'accueil'}
      <nav class="tab-group w-fit">
        <button onclick={() => gotoTab('/prestige', 'gains', DEFAULT_TAB)} class="tab-button {activeTab === 'gains' ? 'active' : ''}">
          <Papicon icon="chart" size={16} />
          {m.prg_tab_gains()}
        </button>
        <button onclick={() => gotoTab('/prestige', 'echelle', DEFAULT_TAB)} class="tab-button {activeTab === 'echelle' ? 'active' : ''}">
          <Papicon icon="shield" size={16} />
          {m.prg_tab_ladder()}
        </button>
        <button onclick={() => gotoTab('/prestige', 'evenements', DEFAULT_TAB)} class="tab-button {activeTab === 'evenements' ? 'active' : ''}">
          <Papicon icon="zap" size={16} />
          {m.prg_tab_events()}
        </button>
        <button onclick={() => gotoTab('/prestige', 'classement', DEFAULT_TAB)} class="tab-button {activeTab === 'classement' ? 'active' : ''}">
          <Papicon icon="crown" size={16} />
          {m.prg_tab_leaderboard()}
        </button>
      </nav>
    {/if}

    {#if activeTab === 'accueil'}
      <!-- ==================== ACCUEIL : PREREGLAGES ==================== -->
      <div class="space-y-8">
        <!-- A quoi servent les RP : la page reglait un compteur sans jamais
             dire ce qu'il compte, ni d'ou il vient. -->
        <section class="bg-surface-container-low/30 border border-outline-variant/10 rounded-xl p-6 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Papicon icon="info" size={18} />
            </div>
            <div class="space-y-1">
              <h3 class="text-base font-semibold text-on-surface">{m.prg_about_title()}</h3>
              <p class="text-[13px] text-on-surface-variant/70 leading-relaxed">{m.prg_about_desc()}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="px-4 py-3 bg-surface-container-high/20 border border-outline-variant/5 rounded-lg space-y-1">
              <p class="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.prg_about_earn_title()}</p>
              <p class="text-[12px] text-on-surface-variant/70 leading-relaxed">{m.prg_about_earn_desc()}</p>
            </div>
            <div class="px-4 py-3 bg-surface-container-high/20 border border-outline-variant/5 rounded-lg space-y-1">
              <p class="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.prg_about_lose_title()}</p>
              <p class="text-[12px] text-on-surface-variant/70 leading-relaxed">{m.prg_about_lose_desc()}</p>
            </div>
            <div class="px-4 py-3 bg-surface-container-high/20 border border-outline-variant/5 rounded-lg space-y-1">
              <p class="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.prg_about_spend_title()}</p>
              <p class="text-[12px] text-on-surface-variant/70 leading-relaxed">{m.prg_about_spend_desc()}</p>
            </div>
          </div>
        </section>

        <RankedPresetPicker
          selectedId={selectedPreset?.id ?? null}
          activeId={activePreset?.id ?? null}
          customValues={customPresetValues}
          dirty={configDirty}
          saving={saveAction.state.loading}
          {moduleEnabled}
          onselect={applyPreset}
          onsave={handleSave}
          ondetail={() => gotoTab('/prestige', 'gains', DEFAULT_TAB)}
        />

        <!-- Un preregle pose une echelle, pas les roles qui vont avec : la mise
             en route se termine ici, la ou l'oeil arrive. -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-container-low/30 border border-outline-variant/10 rounded-xl px-6 py-5">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Papicon icon="shield" size={18} />
            </div>
            <div class="space-y-0.5">
              <p class="text-sm font-semibold text-on-surface">{m.prg_setup_roles_title()}</p>
              <p class="text-[13px] text-on-surface-variant/70">
                {tiersWithoutRole === 0
                  ? m.prg_setup_roles_done({ count: activeLadder.length })
                  : m.prg_setup_roles_desc({ count: tiersWithoutRole })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onclick={() => gotoTab('/prestige', 'echelle', DEFAULT_TAB)}
            class="shrink-0 px-6 py-3 bg-surface-container-high/40 hover:bg-surface-container-high/60 text-on-surface text-[13px] font-medium rounded-lg transition-all flex items-center gap-2"
          >
            <Papicon icon="ArrowRight" size={16} />
            {m.prg_setup_roles_open()}
          </button>
        </div>
      </div>
    {:else if activeTab === 'gains'}
      <!-- ==================== GAINS & SERIES ==================== -->
      <div class="space-y-8 animate-in fade-in duration-300">
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard label={m.prg_stat_ranked()} value={stats?.rankedMembers ?? 0} icon="users" />
          <MetricCard label={m.prg_stat_streaks()} value={stats?.activeStreaks ?? 0} icon="activity" toneClass="bg-amber-500/10 text-amber-500" />
          <MetricCard label={m.prg_stat_total_rp()} value={(stats?.totalRp ?? 0).toLocaleString()} icon="chart" toneClass="bg-emerald-500/10 text-emerald-500" />
          <MetricCard label={m.prg_stat_best_streak()} value={stats?.bestStreak ?? 0} icon="crown" toneClass="bg-pink-500/10 text-pink-500" />
        </div>

        <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="text-xl font-semibold flex items-center gap-3">
                <Papicon icon="chart" size={20} class="text-primary" />
                {m.prg_section_gains()}
              </h3>
              <p class="text-xs text-on-surface-variant/70 mt-1">{m.prg_section_gains_hint()}</p>
            </div>
            <SimpleModeToggle simple={gainMode.simple} onchange={(v) => gainMode.set(v)} />
          </div>

          {#if gainMode.simple}
            <div class="space-y-2">
              <div class="flex items-baseline justify-between gap-3">
                <label for="rpGains" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.prg_gains_level_label()}</label>
                <span class="text-xs font-semibold text-primary">{GAIN_LABELS[gainsStep - 1]()}</span>
              </div>
              <input
                id="rpGains"
                type="range" min="1" max="5" step="1"
                value={gainsStep}
                oninput={(e) => applyGainsStep(Number(e.currentTarget.value))}
                class="w-full accent-primary"
              />

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div class="px-3 py-2.5 bg-surface-container-high/20 border border-outline-variant/5 rounded-lg">
                  <p class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.prg_tile_rp_per_xp()}</p>
                  <p class="text-sm font-semibold text-on-surface">×{config.rpPerXp}</p>
                </div>
                <div class="px-3 py-2.5 bg-surface-container-high/20 border border-outline-variant/5 rounded-lg">
                  <p class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.prg_field_reaction_rp()}</p>
                  <p class="text-sm font-semibold text-on-surface">{config.reactionRp} RP</p>
                </div>
                <div class="px-3 py-2.5 bg-surface-container-high/20 border border-outline-variant/5 rounded-lg">
                  <p class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">{m.prg_field_reaction_cap()}</p>
                  <p class="text-sm font-semibold text-on-surface">{config.reactionDailyCap}</p>
                </div>
                <div class="px-3 py-2.5 bg-primary/5 border border-primary/15 rounded-lg">
                  <p class="text-[10px] font-bold text-primary/70 uppercase tracking-widest">{m.prg_tile_daily()}</p>
                  <p class="text-sm font-semibold text-primary">≈ {Math.round(estimatedRpPerDay).toLocaleString()} RP</p>
                </div>
              </div>

              {#if gainsOffGrid}
                <SimpleModeNotice message={m.prg_gains_off_grid()} />
              {/if}
            </div>
          {:else}
            <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <label class="block">
                <span class="field-label">{m.prg_field_rp_per_xp()}</span>
                <input type="number" step="0.05" min="0" max="10" bind:value={config.rpPerXp} class="prestige-input" />
              </label>
              <label class="block">
                <span class="field-label">{m.prg_field_reaction_rp()}</span>
                <input type="number" min="0" max="100" bind:value={config.reactionRp} class="prestige-input" />
              </label>
              <label class="block">
                <span class="field-label">{m.prg_field_reaction_cap()}</span>
                <input type="number" min="0" max="500" bind:value={config.reactionDailyCap} class="prestige-input" />
              </label>
              <label class="block">
                <span class="field-label">{m.prg_field_daily_cap()}</span>
                <input type="number" min="0" bind:value={config.dailyRpCap} class="prestige-input" />
              </label>
            </div>
          {/if}

          <div class="grid sm:grid-cols-2 gap-3 pt-4 border-t border-outline-variant/10">
            <label class="block">
              <span class="field-label">{m.prg_field_announce_channel()}</span>
              <select
                bind:value={config.announceChannelId}
                onchange={() => patch({ announceChannelId: config?.announceChannelId ?? null })}
                class="prestige-input"
              >
                <option value={null}>-</option>
                {#each channels as channel (channel.id)}
                  <option value={channel.id}>#{channel.name}</option>
                {/each}
              </select>
            </label>

            <div class="space-y-2 sm:pt-6">
              <label class="flex items-center justify-between gap-4">
                <span class="text-[13px] text-on-surface-variant">{m.prg_field_announce_promotions()}</span>
                <ToggleSwitch checked={config.announcePromotions} size="sm" onToggle={(v) => patch({ announcePromotions: v })} />
              </label>
              <label class="flex items-center justify-between gap-4">
                <span class="text-[13px] text-on-surface-variant">{m.prg_field_announce_demotions()}</span>
                <ToggleSwitch checked={config.announceDemotions} size="sm" onToggle={(v) => patch({ announceDemotions: v })} />
              </label>
              <label class="flex items-center justify-between gap-4">
                <span class="text-[13px] text-on-surface-variant">{m.prg_field_global()}</span>
                <ToggleSwitch checked={config.globalLeaderboard} size="sm" onToggle={(v) => patch({ globalLeaderboard: v })} />
              </label>
            </div>
          </div>
        </section>

        <!-- ==================== SERIES ==================== -->
        <SectionCard title={m.prg_section_streaks()} description={m.prg_section_streaks_hint()} icon="activity">
          <div class="space-y-4">
            <label class="flex items-center justify-between gap-4">
              <span class="text-[13px] font-medium text-on-surface">{m.prg_field_streak_enabled()}</span>
              <ToggleSwitch checked={config.streakEnabled} onToggle={(v) => { config.streakEnabled = v; }} />
            </label>

            {#if config.streakEnabled}
              <div class="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
                <label class="block">
                  <span class="field-label">{m.prg_field_streak_bonus()}</span>
                  <input
                    type="number" min="0" max="100"
                    value={Math.round((config.streakBonusPerDay ?? 0) * 100)}
                    oninput={(e) => { config!.streakBonusPerDay = Number((e.currentTarget as HTMLInputElement).value) / 100; }}
                    class="prestige-input"
                  />
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_field_streak_max()}</span>
                  <input
                    type="number" min="0" max="500"
                    value={Math.round((config.streakMaxBonus ?? 0) * 100)}
                    oninput={(e) => { config!.streakMaxBonus = Number((e.currentTarget as HTMLInputElement).value) / 100; }}
                    class="prestige-input"
                  />
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_field_streak_grace()}</span>
                  <input type="number" min="0" max="7" bind:value={config.streakGraceDays} class="prestige-input" />
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_field_streak_weekly_freezes()}</span>
                  <input type="number" min="0" max="7" bind:value={config.streakWeeklyFreezes} class="prestige-input" />
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_field_streak_max_freezes()}</span>
                  <input type="number" min="0" max="14" bind:value={config.streakMaxFreezes} class="prestige-input" />
                </label>
              </div>
            {/if}
          </div>
        </SectionCard>

        {#if configDirty}
          {@render saveBar()}
        {/if}
      </div>
    {:else if activeTab === 'echelle'}
      <!-- ==================== ECHELLE & ROLES ==================== -->
      <div class="space-y-8 animate-in fade-in duration-300">
        <section class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="text-xl font-semibold flex items-center gap-3">
                <Papicon icon="shield" size={20} class="text-primary" />
                {m.prg_section_ladder()}
              </h3>
              <p class="text-xs text-on-surface-variant/70 mt-1">{m.prg_ladder_hint()}</p>
            </div>
            <SimpleModeToggle simple={ladderMode.simple} onchange={(v) => ladderMode.set(v)} />
          </div>

          <!-- Quantite de roles : premier curseur de la carte, parce que c'est
               le premier chiffre qu'une guilde doit assumer - un palier, c'est un
               role Discord de plus a tenir. -->
          <div class="space-y-2">
            <div class="flex items-baseline justify-between gap-3">
              <label for="tierCount" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.prg_ladder_count_label()}</label>
              <span class="text-xs font-semibold text-primary">{m.prg_ladder_count_value({ count: tierCountStep })}</span>
            </div>
            <input
              id="tierCount"
              type="range"
              min={LADDER_CURVE_LIMITS.tierCount.min}
              max={LADDER_CURVE_LIMITS.tierCount.max}
              step="1"
              value={tierCountStep}
              oninput={(e) => { config!.ladderTierCount = Number(e.currentTarget.value); }}
              class="w-full accent-primary"
            />
            <p class="text-[10px] text-on-surface-variant/50 ml-2">{m.prg_ladder_count_hint()}</p>
          </div>

          {#if ladderMode.simple}
            <div class="space-y-6">
              <div class="space-y-2">
                <div class="flex items-baseline justify-between gap-3">
                  <label for="ladderPace" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.prg_ladder_pace_label()}</label>
                  <span class="text-xs font-semibold text-primary">{LADDER_PACE_LABELS[pacePreviewStep - 1]()}</span>
                </div>
                <input
                  id="ladderPace"
                  type="range" min="1" max="5" step="1"
                  value={pacePreviewStep}
                  oninput={(e) => applyLadderPace(Number(e.currentTarget.value))}
                  class="w-full accent-primary"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-baseline justify-between gap-3">
                  <label for="ladderSteep" class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.prg_ladder_steep_label()}</label>
                  <span class="text-xs font-semibold text-primary">{LADDER_STEEP_LABELS[steepPreviewStep - 1]()}</span>
                </div>
                <input
                  id="ladderSteep"
                  type="range" min="1" max="5" step="1"
                  value={steepPreviewStep}
                  oninput={(e) => applyLadderSteepness(Number(e.currentTarget.value))}
                  class="w-full accent-primary"
                />
              </div>

              {#if curveOffGrid}
                <SimpleModeNotice message={m.prg_ladder_off_grid()} />
              {/if}
            </div>
          {:else}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <label class="block">
                <span class="field-label">{m.prg_ladder_base_rp()}</span>
                <input
                  type="number"
                  min={LADDER_CURVE_LIMITS.baseRp.min}
                  max={LADDER_CURVE_LIMITS.baseRp.max}
                  bind:value={config.ladderBaseRp}
                  class="prestige-input"
                />
                <span class="text-[10px] text-on-surface-variant/50 ml-2">{m.prg_ladder_base_rp_hint()}</span>
              </label>
              <label class="block">
                <span class="field-label">{m.prg_ladder_exponent()}</span>
                <input
                  type="number" step="0.05"
                  min={LADDER_CURVE_LIMITS.exponent.min}
                  max={LADDER_CURVE_LIMITS.exponent.max}
                  bind:value={config.ladderExponent}
                  class="prestige-input"
                />
                <span class="text-[10px] text-on-surface-variant/50 ml-2">{m.prg_ladder_exponent_hint()}</span>
              </label>
            </div>
          {/if}

          <div class="space-y-2">
            <span class="text-[10px] font-bold text-on-surface-variant/60 ml-2 uppercase tracking-widest">{m.prg_ladder_divisions_label()}</span>
            <nav class="tab-group w-fit">
              {#each [1, 2, 3, 4, 5] as count (count)}
                <button
                  type="button"
                  onclick={() => { config!.ladderDivisions = count; }}
                  class="tab-button {curveValues.ladderDivisions === count ? 'active' : ''}"
                >
                  {count}
                </button>
              {/each}
            </nav>
            <p class="text-[10px] text-on-surface-variant/50 ml-2">{m.prg_ladder_divisions_hint()}</p>
          </div>

          <!-- Apercu : ecart de RP entre paliers successifs, puis repartition
               reelle des membres sous la meme echelle. -->
          <div class="space-y-3 pt-4 border-t border-outline-variant/10">
            <div>
              <h4 class="text-sm font-bold text-on-surface-variant">{m.prg_ladder_preview_title()}</h4>
              <p class="text-[10px] text-on-surface-variant/60 font-medium">{m.prg_ladder_preview_desc()}</p>
            </div>

            <div class="flex items-end gap-[3px] h-32 px-2 py-2 bg-surface-container-high/20 border border-outline-variant/5 rounded-lg">
              {#each ladderGaps as entry (entry.tier.key)}
                <div
                  class="flex-1 rounded-t-sm min-h-[2px]"
                  style="height: {Math.max(2, (entry.gap / ladderGapMax) * 100)}%; background: {entry.tier.color}99"
                  title="{entry.tier.name} · {entry.tier.minRp.toLocaleString()} RP"
                ></div>
              {/each}
            </div>

            {#if impact}
              <div>
                <h4 class="text-sm font-bold text-on-surface-variant">{m.prg_ladder_population_title()}</h4>
                <p class="text-[10px] text-on-surface-variant/60 font-medium">{m.prg_ladder_population_desc()}</p>
              </div>

              <div class="flex items-end gap-[3px] h-16 px-2 py-2 bg-surface-container-high/20 border border-outline-variant/5 rounded-lg">
                {#each impact.distribution as count, index}
                  <div
                    class="flex-1 rounded-t-sm min-h-[2px] {count > 0 ? 'bg-teal-600' : 'bg-outline-variant/20'}"
                    style="height: {count > 0 ? Math.max(4, (count / impactMax) * 100) : 0}%"
                    title="{previewLadder[index]?.name ?? ''} · {count.toLocaleString()}"
                  ></div>
                {/each}
              </div>
            {/if}

            <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p class="text-[11px] text-on-surface-variant/70">{m.prg_estimate_intro()}</p>
              <nav class="tab-group w-fit">
                {#each ACTIVITY_LABELS as label, index}
                  <button type="button" onclick={() => (activityStep = index + 1)} class="tab-button {activityStep === index + 1 ? 'active' : ''}">
                    {label()}
                  </button>
                {/each}
              </nav>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {#each ladderMilestones as tier (tier.key)}
                <div class="px-3 py-2.5 bg-surface-container-high/20 border border-outline-variant/5 rounded-lg">
                  <p class="text-[10px] font-bold uppercase tracking-widest truncate" style="color: {tier.color}">{tier.name}</p>
                  <p class="text-sm font-semibold text-on-surface">{tier.minRp.toLocaleString()} RP</p>
                  <p class="text-[11px] font-semibold text-primary">{formatDuration(estimateDays(tier.minRp))}</p>
                </div>
              {/each}
            </div>

            {#if ladderDirty}
              <div class="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed flex items-start gap-2">
                <Papicon icon="AlertTriangle" size={13} class="shrink-0 mt-0.5" />
                <div class="min-w-0 flex-1">
                  {#if impact && impact.changed > 0}
                    <p class="font-bold mb-1">{m.prg_ladder_impact({ changed: impact.changed.toLocaleString(), total: impact.total.toLocaleString() })}</p>
                  {/if}
                  {m.prg_ladder_warning({ apex: apexRp.toLocaleString() })}
                </div>
              </div>
            {/if}

            {#if ladderOffGrid}
              <SimpleModeNotice message={m.prg_ladder_custom_notice()} />
            {/if}
          </div>
        </section>

        <!-- ==================== ROLES DE PALIER ==================== -->
        <SectionCard title={m.prg_section_tier_roles()} description={m.prg_tier_roles_hint()} icon="shield">
          <div class="space-y-5">
            <div class="grid sm:grid-cols-2 gap-2">
              <label class="flex items-center justify-between gap-4">
                <span class="text-[13px] text-on-surface-variant">{m.prg_field_tier_roles_enabled()}</span>
                <ToggleSwitch checked={config.tierRolesEnabled} size="sm" onToggle={(v) => patch({ tierRolesEnabled: v })} />
              </label>
              <label class="flex items-center justify-between gap-4">
                <span class="text-[13px] text-on-surface-variant">{m.prg_field_tier_roles_exclusive()}</span>
                <ToggleSwitch checked={config.tierRolesExclusive} size="sm" onToggle={(v) => patch({ tierRolesExclusive: v })} />
              </label>
            </div>

            <!-- Creation et attribution : les deux gestes qui manquaient. Rien
                 ne part tout seul - creer vingt roles et en deplacer des
                 milliers sont des decisions, pas des effets de bord. -->
            <div class="rounded-lg border border-outline-variant/20 bg-surface-container-low/30 p-4 space-y-4">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-0.5 min-w-0">
                  <p class="text-[13px] font-semibold text-on-surface">{m.prg_roles_provision_title()}</p>
                  <p class="text-[11px] text-on-surface-variant/70 leading-relaxed">
                    {tiersWithoutRole === 0
                      ? m.prg_roles_provision_done({ count: activeLadder.length })
                      : m.prg_roles_provision_desc({ count: tiersWithoutRole })}
                  </p>
                </div>
                <button
                  type="button"
                  onclick={handleProvisionRoles}
                  disabled={roleAction.state.loading || tiersWithoutRole === 0}
                  class="shrink-0 px-5 py-2.5 bg-primary text-on-primary text-xs font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Papicon icon="sparkles" size={15} />
                  {m.prg_roles_provision_action()}
                </button>
              </div>

              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-outline-variant/10">
                <div class="space-y-0.5 min-w-0">
                  <p class="text-[13px] font-semibold text-on-surface">{m.prg_roles_sync_title()}</p>
                  <p class="text-[11px] text-on-surface-variant/70 leading-relaxed">{m.prg_roles_sync_desc()}</p>
                </div>
                {#if roleSync.running}
                  <div class="flex items-center gap-3 shrink-0">
                    <span class="text-[11px] font-semibold text-on-surface-variant tabular-nums">
                      {m.prg_roles_sync_progress({ done: roleSync.done.toLocaleString(), total: roleSync.pending.toLocaleString() })}
                    </span>
                    <button type="button" onclick={stopRoleSync} class="px-4 py-2 bg-error/10 text-error font-medium text-xs rounded-lg hover:bg-error/20 transition-all">
                      {m.prg_roles_sync_stop()}
                    </button>
                  </div>
                {:else}
                  <button
                    type="button"
                    onclick={startRoleSync}
                    disabled={roleAction.state.loading || !config.tierRolesEnabled}
                    class="shrink-0 px-5 py-2.5 bg-secondary text-on-secondary text-xs font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {m.prg_roles_sync_action()}
                  </button>
                {/if}
              </div>
            </div>

            <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {#each activeLadder as tier (tier.key)}
                <div class="flex items-center gap-3 rounded-lg border border-outline-variant/20 bg-surface-container-low/30 px-3 py-2">
                  <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:{tier.color}"></span>
                  <div class="min-w-0 flex-1">
                    <p class="text-[13px] font-semibold text-on-surface truncate">{tier.name}</p>
                    <p class="text-[11px] text-on-surface-variant">{tier.minRp.toLocaleString()} RP</p>
                  </div>
                  <select
                    value={roleFor(tier.key) ?? ''}
                    onchange={(e) => bindRole(tier.key, (e.currentTarget as HTMLSelectElement).value)}
                    class="prestige-input mt-0! max-w-[45%]"
                  >
                    <option value="">{m.prg_ladder_no_role()}</option>
                    {#each roles as role (role.id)}
                      <option value={role.id}>{role.name}</option>
                    {/each}
                  </select>
                </div>
              {/each}
            </div>
          </div>
        </SectionCard>

        <!-- ==================== DECAY ==================== -->
        <SectionCard title={m.prg_section_decay()} description={m.prg_section_decay_hint()} icon="arrow-down">
          <div class="space-y-4">
            <label class="flex items-center justify-between gap-4">
              <span class="text-[13px] font-medium text-on-surface">{m.prg_field_decay_enabled()}</span>
              <ToggleSwitch checked={config.decayEnabled} onToggle={(v) => { config!.decayEnabled = v; }} />
            </label>

            {#if config.decayEnabled}
              <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <label class="block">
                  <span class="field-label">{m.prg_field_decay_grace()}</span>
                  <input type="number" min="0" max="60" bind:value={config.decayGraceDays} class="prestige-input" />
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_field_decay_rp()}</span>
                  <input type="number" min="0" bind:value={config.decayRpPerDay} class="prestige-input" />
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_field_decay_percent()}</span>
                  <input
                    type="number" min="0" max="50"
                    value={Math.round((config.decayPercentPerDay ?? 0) * 100)}
                    oninput={(e) => { config!.decayPercentPerDay = Number((e.currentTarget as HTMLInputElement).value) / 100; }}
                    class="prestige-input"
                  />
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_field_decay_floor()}</span>
                  <!-- Les paliers proposes sont ceux qui seront enregistres :
                       choisir un plancher dans l'ancienne echelle poserait une
                       cle que la nouvelle ne connait pas. -->
                  <select bind:value={config.decayFloorTierKey} class="prestige-input">
                    <option value={null}>{m.prg_decay_floor_none()}</option>
                    {#each (ladderDirty ? previewLadder : activeLadder) as tier (tier.key)}
                      <option value={tier.key}>{tier.name}</option>
                    {/each}
                  </select>
                </label>
              </div>

              <div class="flex flex-wrap items-center gap-2 pt-1">
                <button class="px-3 py-1.5 rounded-lg bg-surface-container-high/40 text-on-surface-variant text-xs font-bold" onclick={handlePreviewDecay}>
                  {m.prg_btn_preview_decay()}
                </button>
                <button class="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-500 text-xs font-bold" onclick={handleRunDecay}>
                  {m.prg_btn_run_decay()}
                </button>
                {#if decayPreview}
                  <span class="text-xs text-on-surface-variant">
                    {m.prg_decay_preview({ affected: decayPreview.affected, rpLost: decayPreview.rpLost })}
                  </span>
                {/if}
              </div>
            {/if}
          </div>
        </SectionCard>

        {#if configDirty}
          {@render saveBar()}
        {/if}
      </div>
    {:else if activeTab === 'evenements'}
      <!-- ==================== EVENEMENTS ==================== -->
      <SectionCard title={m.prg_section_events()} description={m.prg_events_hint()} icon="zap">
        {#snippet actions()}
          <button
            class="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold flex items-center gap-1.5"
            onclick={() => (showEventForm = !showEventForm)}
          >
            <Papicon icon="plus" size={14} />
            {m.prg_btn_new_event()}
          </button>
        {/snippet}

        <div class="space-y-4">
          {#if showEventForm}
            <div class="rounded-lg border border-outline-variant/20 bg-surface-container-low/30 p-4 space-y-3">
              <div class="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
                <label class="block">
                  <span class="field-label">{m.prg_event_type()}</span>
                  <select bind:value={newEvent.type} class="prestige-input">
                    {#each EVENT_TYPES as type (type.value)}
                      <option value={type.value}>{type.label}</option>
                    {/each}
                  </select>
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_event_name()}</span>
                  <input type="text" bind:value={newEvent.name} class="prestige-input" />
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_event_multiplier()}</span>
                  <input type="number" min="1" max="10" step="0.5" bind:value={newEvent.multiplier} class="prestige-input" />
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_event_duration()}</span>
                  <input type="number" min="5" max="1440" bind:value={newEvent.durationMinutes} class="prestige-input" />
                </label>
                <label class="block">
                  <span class="field-label">{m.prg_event_channel()}</span>
                  <select bind:value={newEvent.announceChannelId} class="prestige-input">
                    <option value="">-</option>
                    {#each channels as channel (channel.id)}
                      <option value={channel.id}>#{channel.name}</option>
                    {/each}
                  </select>
                </label>
              </div>
              <div class="flex justify-end gap-2">
                <button class="px-3 py-1.5 rounded-lg bg-surface-container-high/40 text-on-surface-variant text-xs font-bold" onclick={() => (showEventForm = false)}>
                  {m.prg_btn_cancel()}
                </button>
                <button class="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold" onclick={handleCreateEvent}>
                  {m.prg_btn_create()}
                </button>
              </div>
            </div>
          {/if}

          {#if events.length === 0}
            <EmptyState icon="zap" title={m.prg_event_empty()} />
          {:else}
            <div class="space-y-1">
              {#each events as event (event.id)}
                <div class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-container-high/10">
                  <span class="px-2 py-0.5 rounded-full text-[11px] font-medium {statusClass(event.status)}">{statusLabel(event.status)}</span>
                  <div class="min-w-0 flex-1">
                    <p class="text-[13px] font-semibold text-on-surface truncate">{event.name} · ×{event.multiplier}</p>
                    <p class="text-[11px] text-on-surface-variant">
                      {new Date(event.startsAt).toLocaleString()} → {new Date(event.endsAt).toLocaleString()}
                    </p>
                  </div>
                  <span class="text-[11px] text-on-surface-variant hidden sm:block">
                    {m.prg_event_result({ participants: event.participants, bonus: event.bonusRpGranted })}
                  </span>
                  {#if event.status === 'SCHEDULED' || event.status === 'RUNNING'}
                    <button class="text-[11px] font-bold text-rose-500" onclick={() => handleCancelEvent(event.id)}>
                      {m.prg_btn_cancel_event()}
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </SectionCard>
    {:else}
      <!-- ==================== CLASSEMENTS ==================== -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard title={m.prg_section_leaderboard()} icon="crown">
          {#if leaderboard.length === 0}
            <EmptyState icon="crown" title={m.prg_leaderboard_empty()} />
          {:else}
            <div class="space-y-0.5">
              {#each leaderboard as entry (entry.userId)}
                <div class="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-container-high/10">
                  <span class="w-7 text-right text-[13px] font-semibold text-on-surface-variant">#{entry.rank}</span>
                  <UserDisplay userId={entry.userId} size="sm" class="min-w-0 flex-1" />
                  <span class="px-2 py-0.5 rounded-full text-[11px] font-medium" style="background:{entry.tier.color}22;color:{entry.tier.color}">
                    {entry.tier.name}
                  </span>
                  <span class="text-[12px] font-mono text-on-surface-variant w-16 text-right">{entry.rp.toLocaleString()}</span>
                </div>
              {/each}
            </div>
          {/if}
        </SectionCard>

        <SectionCard title={m.prg_section_streak_board()} icon="activity">
          {#if streaks.length === 0}
            <EmptyState icon="activity" title={m.prg_streak_board_empty()} />
          {:else}
            <div class="space-y-0.5">
              {#each streaks as entry (entry.userId)}
                <div class="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-container-high/10">
                  <span class="w-7 text-right text-[13px] font-semibold text-on-surface-variant">#{entry.rank}</span>
                  <UserDisplay userId={entry.userId} size="sm" class="min-w-0 flex-1" />
                  <span class="text-[13px]">{'🔥'.repeat(Math.max(1, entry.flames))}</span>
                  <span class="text-[12px] font-mono text-on-surface-variant w-14 text-right">
                    {m.prg_streak_days({ days: entry.streakDays })}
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </SectionCard>
      </div>
    {/if}
  {/if}
</ModulePage>

<style>
  .prestige-input {
    margin-top: 0.25rem;
    width: 100%;
    border-radius: 0.5rem;
    background: var(--surface-container, rgba(255, 255, 255, 0.04));
    border: 1px solid rgb(from var(--outline-variant, #444) r g b / 40%);
    padding: 0.5rem 0.75rem;
    font-size: 13px;
    color: var(--on-surface, inherit);
  }
</style>
