<script lang="ts">
  import { m } from '../lib/i18n';
  import type { PreviewSample } from '../lib/giveawayPreview';
  import { channelDisplayName } from '../lib/channelUtils';
  import { onMount } from 'svelte';
  import { router } from 'tinro';
  import { fade, scale } from 'svelte/transition';
  import { authStore } from '../lib/stores/auth.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { canViewFeature } from '../lib/permissions.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import { resolveTabFromUrl, gotoTab } from '../lib/tabRouting';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import SectionCard from '../lib/components/SectionCard.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import MultiSelect from '../lib/components/MultiSelect.svelte';
  import SearchableSelect from '../lib/components/SearchableSelect.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';
  import FormColorPicker from '../lib/components/FormColorPicker.svelte';
  import EmojiPicker from '../lib/components/EmojiPicker.svelte';
  import MacroTextField from '../lib/components/MacroTextField.svelte';
  import GiveawayPreview from '../lib/components/GiveawayPreview.svelte';
  import type { MacroOption } from '../lib/macros';
  import {
    fetchGiveaways,
    createGiveaway,
    endGiveaway,
    rerollGiveaway,
    deleteGiveaway,
    fetchGiveawayConfig,
    updateGiveawayConfig,
    fetchGiveawayTemplates,
    fetchGiveawayItems,
    createGiveawayTemplate,
    updateGiveawayTemplate,
    deleteGiveawayTemplate,
    fetchMemberCase,
    type GiveawayAppearance,
    type GiveawayBonusEntry,
    type GiveawayConfigPayload,
    type GiveawayGeneratedLabels,
    type GiveawayRpgItem,
    type GiveawayTemplate
  } from '../lib/api';
  import MemberCaseModal from '../lib/components/MemberCaseModal.svelte';

  const actionState = createAsyncActionState();
  const configAction = createAsyncActionState();
  let loading = $state(false);
  let showModal = $state(false);

  const giveawayTabs = ['concours', 'modeles', 'configuration'] as const;
  type GiveawayTab = (typeof giveawayTabs)[number];
  const DEFAULT_TAB: GiveawayTab = 'concours';
  let activeTab = $state<GiveawayTab>(DEFAULT_TAB);

  $effect(() => {
    const _path = $router.path;
    activeTab = resolveTabFromUrl('/giveaways', giveawayTabs, DEFAULT_TAB) as GiveawayTab;
  });

  /**
   * Vrai quand l'API a reconnu un rôle gestionnaire déclaré dans l'onglet
   * Configuration. Sans ce retour, l'autorisation accordée à une équipe
   * animation resterait invisible : les boutons dépendraient encore des seuls
   * droits d'administration du dashboard, alors que l'API accepterait l'action.
   */
  let canManageFromApi = $state(false);

  const canManageSettings = $derived(
    canManageFromApi
      || !!dashboardStore.state.featureAccess?.giveaways?.canConfigure
      || !!dashboardStore.state.access?.canManageSettings
  );

  // Décider qui pilote les concours est un réglage de serveur : il reste aux
  // administrateurs du dashboard, pas aux rôles gestionnaires qu'il déclare.
  const canEditConfig = $derived(!!dashboardStore.state.access?.canManageSettings);

  const availableChannels = $derived(dashboardStore.state.discordChannels || []);
  const availableRoles = $derived(dashboardStore.state.discordRoles || []);

  // Adresse de la page publique des concours, partageable telle quelle.
  let copySuccess = $state(false);
  const publicGiveawaysUrl = $derived(
    authStore.selectedGuildId
      ? `${window.location.origin}/${authStore.selectedGuildId}/giveaways`
      : ''
  );

  async function copyPublicGiveawaysUrl() {
    if (!publicGiveawaysUrl) return;
    await navigator.clipboard.writeText(publicGiveawaysUrl);
    copySuccess = true;
    setTimeout(() => { copySuccess = false; }, 2000);
  }

  /**
   * Valeurs d'usine, identiques à celles du bot : un serveur qui n'a jamais
   * enregistré voit dans le formulaire ce que Discord affiche vraiment.
   */
  /**
   * Reglages qui ne dependent pas de la langue. Les textes, eux, viennent du
   * bot : lui seul connait la langue du serveur, et les recopier ici les
   * figerait en francais quel que soit le dashboard de la personne connectee.
   */
  const DEFAULT_SETTINGS = {
    managerRoleIds: [] as string[],
    requiredRoleIds: [] as string[],
    blockedRoleIds: [] as string[],
    minAccountAgeDays: 0,
    minMemberAgeDays: 0,
    minLevel: 0,
    blockLinkedAccounts: false,
    bonusEntries: [] as GiveawayBonusEntry[],
    clanBonusEnabled: true,
    clanBonusWeight: 2,
    showBonusRoles: true,
    defaultChannelId: null as string | null,
    embedColorActive: '#5865F2',
    embedColorPending: '#FAA81A',
    embedColorEnded: '#ED4245',
    embedColorValidated: '#57F287',
    thumbnailUrl: null as string | null,
    imageUrl: null as string | null,
    joinButtonStyle: 'PRIMARY' as GiveawayAppearance['joinButtonStyle'],
  };

  /** Gabarits d'usine, renvoyes par l'API avec la configuration. */
  let defaults = $state<GiveawayAppearance | null>(null);

  /** Libelles que le bot genere lui-meme, dans la langue du serveur. */
  let generatedLabels = $state<GiveawayGeneratedLabels | null>(null);

  const emptyTemplates = {
    titleTemplate: '',
    descriptionTemplate: '',
    footerTemplate: '',
    joinButtonLabel: '',
    joinButtonEmoji: '',
    announceWinnersTemplate: '',
    announceNoWinnerTemplate: '',
    joinReplyTemplate: '',
    leaveReplyTemplate: '',
    deniedBlockedTemplate: '',
    deniedRequiredTemplate: '',
    deniedAccountAgeTemplate: '',
    deniedMemberAgeTemplate: '',
    deniedLevelTemplate: '',
    deniedLinkedTemplate: '',
  };

  let config = $state<GiveawayConfigPayload>({ ...DEFAULT_SETTINGS, ...emptyTemplates });

  const buttonStyles: GiveawayConfigPayload['joinButtonStyle'][] = ['PRIMARY', 'SECONDARY', 'SUCCESS', 'DANGER'];

  /**
   * Variables acceptées par les gabarits. Elles sont posées ici plutôt que dans
   * les traductions : le compilateur de messages lit toute accolade comme un
   * paramètre, et afficherait « undefined » à la place de la variable citée.
   */
  const commonMacros: MacroOption[] = [
    { token: '{prize}', label: m.giv_macro_prize() },
    { token: '{winnerCount}', label: m.giv_macro_winner_count() },
    { token: '{participants}', label: m.giv_macro_participants() },
    { token: '{host}', label: m.giv_macro_host() },
    { token: '{server}', label: m.giv_macro_server() },
    { token: '{id}', label: m.giv_macro_id() },
    { token: '{endsAt}', label: m.giv_macro_ends_at() },
    { token: '{endsRelative}', label: m.giv_macro_ends_relative() },
  ];

  const winnersMacro: MacroOption = { token: '{winners}', label: m.giv_macro_winners() };

  const bodyMacros: MacroOption[] = [
    { token: '{description}', label: m.giv_macro_description() },
    { token: '{bonus}', label: m.giv_macro_bonus() },
    { token: '{bonusRoles}', label: m.giv_macro_bonus_roles() },
    ...commonMacros,
  ];

  /**
   * Un refus part avant qu'on sache quel concours le membre visait : ni lot, ni
   * date de fin, ni nombre de participants n'existent à ce moment, et les
   * proposer ne produirait qu'un trou dans la phrase.
   */
  const refusalMacros: MacroOption[] = [
    { token: '{minAccountAgeDays}', label: m.giv_macro_min_account_age() },
    { token: '{minMemberAgeDays}', label: m.giv_macro_min_member_age() },
    { token: '{minLevel}', label: m.giv_macro_min_level() },
    { token: '{server}', label: m.giv_macro_server() },
  ];

  function buttonStyleLabel(style: GiveawayConfigPayload['joinButtonStyle']) {
    if (style === 'SECONDARY') return m.giv_cfg_button_style_secondary();
    if (style === 'SUCCESS') return m.giv_cfg_button_style_success();
    if (style === 'DANGER') return m.giv_cfg_button_style_danger();
    return m.giv_cfg_button_style_primary();
  }

  /** Fusionne la réponse de l'API avec les valeurs d'usine : une clef absente garde son défaut. */
  function adoptConfig(
    raw: Partial<GiveawayConfigPayload> | null | undefined,
    rawDefaults?: GiveawayAppearance | null,
    rawLabels?: GiveawayGeneratedLabels | null,
  ) {
    if (rawDefaults) defaults = rawDefaults;
    if (rawLabels) generatedLabels = rawLabels;
    if (!raw) return;
    config = {
      ...DEFAULT_SETTINGS,
      ...emptyTemplates,
      ...(defaults ?? {}),
      ...raw,
      bonusEntries: raw.bonusEntries ?? [],
    };
  }

  // ─── Modèles de concours ───
  let templates = $state<GiveawayTemplate[]>([]);

  /**
   * Objets RPG remettables sur ce serveur.
   *
   * L'objet se désignait par son identifiant, tapé à la main : un cuid qu'on ne
   * retient pas, qu'une faute de frappe suffisait à rendre inopérant, et que
   * l'annonce affichait tel quel.
   */
  let rpgItems = $state<GiveawayRpgItem[]>([]);

  const rpgItemOptions = $derived(
    rpgItems.map((item) => ({ id: item.id, name: item.emoji ? `${item.emoji} ${item.name}` : item.name })),
  );

  /** Nom affiché d'un objet, vide quand il a disparu du module depuis. */
  function rpgItemLabel(itemId: string | null | undefined): string {
    if (!itemId) return '';
    return rpgItemOptions.find((option) => option.id === itemId)?.name ?? '';
  }

  function minutesFrom(value: number, unit: string) {
    const amount = value || 1;
    if (unit === 'minutes') return amount;
    if (unit === 'hours') return amount * 60;
    return amount * 1440;
  }

  /** Repasse des minutes à l'unité la plus lisible pour le formulaire. */
  function splitDuration(minutes: number) {
    if (minutes % 1440 === 0) return { durationValue: minutes / 1440, durationUnit: 'days' };
    if (minutes % 60 === 0) return { durationValue: minutes / 60, durationUnit: 'hours' };
    return { durationValue: minutes, durationUnit: 'minutes' };
  }

  /** Identité affichable d'un membre, résolue côté API. */
  type MemberProfile = {
    userId: string;
    username: string | null;
    displayName: string;
    avatarUrl: string | null;
  };

  let giveaways = $state<Array<{
    id: string;
    channelId: string;
    messageId: string | null;
    prize: string;
    description: string | null;
    winnerCount: number;
    endsAt: string;
    ended: boolean;
    needValidation: boolean;
    validationStatus: string;
    participants: string[];
    winners: string[];
    pendingWinners: string[];
    createdById: string | null;
    ignoreBonuses: boolean;
    creatorProfile: MemberProfile | null;
    winnerProfiles: MemberProfile[];
    pendingWinnerProfiles: MemberProfile[];
    createdAt: string;
  }>>([]);

  /**
   * Gagnants à montrer : ceux déjà validés, ou ceux tirés en attente de
   * validation. C'est ce que l'embed Discord annonce au même moment.
   */
  function announcedWinners(giveaway: typeof giveaways[number]): MemberProfile[] {
    if (giveaway.validationStatus === 'PENDING' && giveaway.pendingWinnerProfiles?.length) {
      return giveaway.pendingWinnerProfiles;
    }
    return giveaway.winnerProfiles ?? [];
  }

  /**
   * Formulaire unique du lancement et du modèle.
   *
   * Les deux se saisissaient dans deux modales distinctes, et celle du
   * lancement ignorait récompenses, validation et apparence : on ne pouvait les
   * poser qu'en créant un modèle d'abord, qui les injectait ensuite sans rien
   * montrer. Un seul jeu de champs sert désormais aux deux gestes, et le mode
   * ne décide que de ce qu'on en fait.
   */
  const EMPTY_FORM = {
    name: '',
    prize: '',
    description: '',
    winnerCount: 1,
    durationValue: 1,
    durationUnit: 'hours',
    /** « duration » compte à partir du lancement, « date » vise un instant. */
    endMode: 'duration',
    endsAt: '',
    channelId: '',
    ignoreBonuses: false,
    needValidation: false,
    useRewards: false,
    rpgXp: 0,
    rpgCoins: 0,
    rpgItemId: '',
    useOwnColor: false,
    ownColor: DEFAULT_SETTINGS.embedColorActive,
    ownImageUrl: '',
  };

  let form = $state({ ...EMPTY_FORM });
  /** « launch » publie sur Discord, « template » enregistre sous un nom. */
  let formMode = $state<'launch' | 'template'>('launch');
  /** Modèle choisi dans le sélecteur de pré-remplissage. */
  let formTemplateId = $state('');
  /** Modèle que « Réutiliser ce concours » écrasera, vide pour en créer un. */
  let saveTargetId = $state('');

  /**
   * Repli des options du second rang.
   *
   * Le formulaire avait fini par tout montrer au même niveau : lot et durée
   * côtoyaient la validation du staff, les récompenses et l'apparence. Un
   * concours ordinaire n'en règle aucune, et les voir toutes déroulées laissait
   * croire qu'il fallait s'en occuper. La section s'ouvre d'elle-même quand le
   * concours en porte déjà une.
   */
  let showExtras = $state(false);

  /** Vrai quand le formulaire pose autre chose que le lot, la durée et le salon. */
  function hasExtras(fields: typeof EMPTY_FORM): boolean {
    return fields.needValidation
      || fields.ignoreBonuses
      || fields.useRewards
      || fields.useOwnColor
      || !!fields.ownImageUrl;
  }

  /**
   * Durée effective du concours, quelle que soit la façon de l'exprimer.
   *
   * « Fin vendredi 20 h » était l'intention courante, et il fallait la convertir
   * en heures de tête. Le formulaire accepte les deux, et l'API ne connaît
   * toujours qu'une durée.
   */
  const computedDurationMinutes = $derived.by(() => {
    if (form.endMode !== 'date') return minutesFrom(form.durationValue, form.durationUnit);
    const target = new Date(form.endsAt).getTime();
    if (!Number.isFinite(target)) return 0;
    return Math.round((target - Date.now()) / 60_000);
  });

  /** Bornes du service : au moins une minute, au plus un an. */
  const durationIsValid = $derived(computedDurationMinutes >= 1 && computedDurationMinutes <= 525_600);

  /** Valeur d'un `datetime-local`, qui attend l'heure locale sans fuseau. */
  function toLocalInputValue(date: Date): string {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  const presets = [
    { label: m.e8_giveaways_preset_30m(), value: 30, unit: 'minutes' },
    { label: m.e8_giveaways_preset_1h(), value: 1, unit: 'hours' },
    { label: m.e8_giveaways_preset_12h(), value: 12, unit: 'hours' },
    { label: m.e8_giveaways_preset_1d(), value: 1, unit: 'days' },
    { label: m.e8_giveaways_preset_3d(), value: 3, unit: 'days' },
    { label: m.e8_giveaways_preset_7d(), value: 7, unit: 'days' },
  ];

  function applyPreset(preset: typeof presets[0]) {
    form.endMode = 'duration';
    form.durationValue = preset.value;
    form.durationUnit = preset.unit;
  }

  const endModes = [
    { id: 'duration' as const, label: m.giv_field_end_mode_duration() },
    { id: 'date' as const, label: m.giv_field_end_mode_date() },
  ];

  /**
   * Bascule entre durée et date de fin en gardant l'échéance déjà choisie :
   * changer d'unité de saisie ne doit pas changer le concours.
   */
  function setEndMode(mode: 'duration' | 'date') {
    if (form.endMode === mode) return;
    if (mode === 'date') {
      const minutes = minutesFrom(form.durationValue, form.durationUnit);
      form.endsAt = toLocalInputValue(new Date(Date.now() + minutes * 60_000));
    } else {
      const split = splitDuration(Math.max(1, computedDurationMinutes));
      form.durationValue = split.durationValue;
      form.durationUnit = split.durationUnit;
    }
    form.endMode = mode;
  }

  function applyGiveawaysResponse(res: any) {
    if (!res) return;
    if (res.giveaways) giveaways = res.giveaways;
    if (typeof res.canManage === 'boolean') canManageFromApi = res.canManage;
  }

  // ─── Fiche membre (gagnants cliquables) ───
  let userCaseModalOpen = $state(false);
  let selectedUserIdForCase = $state<string | null>(null);
  let selectedUserNameForCase = $state('');
  let caseData = $state<any>(null);
  let loadingCase = $state(false);
  let caseError = $state('');

  /**
   * Le dossier d'un gagnant est la meme fiche que celle de la section Membres.
   * Sans ce test, un role a qui le centre de gestion a ferme « Membres » la
   * rouvrait depuis la liste des gagnants, et l'API repondait 403 apres coup.
   */
  const canOpenMemberCase = $derived(canViewFeature('members'));

  async function openMemberCase(userId: string, name: string) {
    if (!authStore.selectedGuildId || !canOpenMemberCase) return;
    selectedUserIdForCase = userId;
    selectedUserNameForCase = name;
    userCaseModalOpen = true;
    loadingCase = true;
    caseError = '';
    caseData = null;

    try {
      caseData = await fetchMemberCase(userId, authStore.selectedGuildId);
    } catch (err) {
      caseError = err instanceof Error ? err.message : m.giv_case_error();
    } finally {
      loadingCase = false;
    }
  }

  onMount(async () => {
    loading = true;
    try {
      await dashboardStore.refresh();
      applyGiveawaysResponse(await fetchGiveaways());
      const configRes = await fetchGiveawayConfig();
      adoptConfig(configRes?.config, configRes?.defaults, configRes?.labels);
      templates = (await fetchGiveawayTemplates())?.templates ?? [];
      rpgItems = (await fetchGiveawayItems())?.items ?? [];
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  });

  async function handleSaveConfig() {
    if (!canEditConfig) return;
    await configAction.run(async () => {
      const res = await updateGiveawayConfig({ ...config });
      if (!res || !res.config) throw new Error(m.giv_cfg_error_save());
      adoptConfig(res.config, res.defaults, res.labels);
      return true;
    }, { successMessage: m.giv_cfg_success_save() });
  }

  /** Rôles avantagés, nommés, tels que l'annonce les listera. */
  const previewBonusRoles = $derived(
    config.bonusEntries
      .filter((entry) => entry.roleId)
      .map((entry) => ({ name: roleName(entry.roleId), weight: entry.weight })),
  );

  /**
   * Ce qu'un modèle publierait s'il partait maintenant : l'apparence du serveur,
   * recouverte par la sienne quand il en porte une.
   */
  function templateAppearance(template: GiveawayTemplate) {
    return { ...config, ...template.styleOverrides };
  }

  /**
   * Ce que le formulaire publierait en l'état.
   *
   * On y saisissait le lot, la description et l'apparence sans rien voir, alors
   * que la configuration et les cartes de modèles montrent toutes deux l'embed.
   */
  function formAppearance() {
    return { ...config, ...formStyleOverrides() };
  }

  function formSample(): Partial<PreviewSample> {
    const rewards = formRewards();
    return {
      prize: form.prize,
      description: form.description,
      // Un champ numérique vidé vaut `null` : l'annonce dirait « null gagnant ».
      winnerCount: form.winnerCount || 1,
      participants: 0,
      coins: rewards.rpgCoins,
      xp: rewards.rpgXp,
      item: rpgItemLabel(rewards.rpgItemId),
      needValidation: form.needValidation,
      endsAt: new Date(Date.now() + computedDurationMinutes * 60_000),
    };
  }

  /** Valeurs réelles du modèle, à la place de l'exemple de l'aperçu. */
  function templateSample(template: GiveawayTemplate): Partial<PreviewSample> {
    return {
      prize: template.prize,
      description: template.description ?? '',
      winnerCount: template.winnerCount,
      // Personne n'a encore rejoint : un modèle n'est pas un concours.
      participants: 0,
      coins: template.rpgCoins ?? 0,
      xp: template.rpgXp ?? 0,
      item: rpgItemLabel(template.rpgItemId),
      needValidation: template.needValidation ?? false,
      endsAt: new Date(Date.now() + template.durationMinutes * 60_000),
    };
  }

  /**
   * Rôle choisi dans le sélecteur d'ajout.
   *
   * Le rôle se choisit avant d'entrer dans la liste, comme partout ailleurs
   * dans le dashboard : une ligne au rôle encore vide serait rejetée à
   * l'enregistrement, et disparaîtrait sans explication.
   */
  let pendingBonusRoleId = $state('');

  const bonusRoleOptions = $derived(
    availableRoles
      .filter((role: any) => !config.bonusEntries.some((entry) => entry.roleId === role.id))
      .map((role: any) => ({ id: role.id, name: `@${role.name}` })),
  );

  function roleName(roleId: string) {
    return availableRoles.find((role: any) => role.id === roleId)?.name ?? m.giv_preview_role_fallback();
  }

  function addBonusEntry() {
    if (!pendingBonusRoleId) return;
    config.bonusEntries = [...config.bonusEntries, { roleId: pendingBonusRoleId, weight: 2 }];
    pendingBonusRoleId = '';
  }

  function removeBonusEntry(index: number) {
    config.bonusEntries = config.bonusEntries.filter((_, i) => i !== index);
  }

  /** Champs du formulaire portés par un modèle enregistré. */
  function formFromTemplate(template: GiveawayTemplate) {
    const duration = splitDuration(template.durationMinutes);
    return {
      name: template.name,
      prize: template.prize,
      description: template.description ?? '',
      winnerCount: template.winnerCount,
      durationValue: duration.durationValue,
      durationUnit: duration.durationUnit,
      endMode: 'duration',
      endsAt: '',
      channelId: template.channelId ?? '',
      ignoreBonuses: template.ignoreBonuses ?? false,
      needValidation: template.needValidation ?? false,
      useRewards: (template.rpgXp ?? 0) > 0 || (template.rpgCoins ?? 0) > 0 || !!template.rpgItemId,
      rpgXp: template.rpgXp ?? 0,
      rpgCoins: template.rpgCoins ?? 0,
      rpgItemId: template.rpgItemId ?? '',
      useOwnColor: !!template.styleOverrides?.embedColorActive,
      ownColor: template.styleOverrides?.embedColorActive ?? DEFAULT_SETTINGS.embedColorActive,
      ownImageUrl: template.styleOverrides?.imageUrl ?? '',
    };
  }

  /**
   * Récompenses du module RPG envoyées avec le concours.
   *
   * La case décochée les remet à zéro plutôt que de garder les valeurs saisies :
   * elle annonce ce que le concours donne, l'embed doit dire la même chose.
   */
  function formRewards() {
    if (!form.useRewards) return { rpgXp: 0, rpgCoins: 0, rpgItemId: '' };
    return { rpgXp: form.rpgXp, rpgCoins: form.rpgCoins, rpgItemId: form.rpgItemId.trim() };
  }

  /**
   * Surcharges d'apparence portées par le formulaire.
   *
   * Envoyées en entier à chaque enregistrement : une surcharge décochée doit
   * disparaître, pas survivre parce qu'on ne l'a pas mentionnée.
   */
  function formStyleOverrides() {
    return {
      ...(form.useOwnColor ? { embedColorActive: form.ownColor } : {}),
      ...(form.ownImageUrl.trim() ? { imageUrl: form.ownImageUrl.trim() } : {}),
    };
  }

  /** Modale de lancement, vierge hormis le salon que le serveur propose. */
  function openCreateModal() {
    formMode = 'launch';
    formTemplateId = '';
    saveTargetId = '';
    form = { ...EMPTY_FORM, channelId: config.defaultChannelId ?? '' };
    showExtras = false;
    actionState.clearFeedback();
    showModal = true;
  }

  /**
   * La même modale, en mode modèle : elle enregistre au lieu de publier.
   *
   * Elle ne compose qu'un modèle neuf. Corriger un modèle existant passe par le
   * formulaire de lancement, qui le reprend puis le réécrit : ouvrir un second
   * écran de réglages pour les mêmes champs était ce qui faisait passer l'onglet
   * pour un doublon de la configuration.
   */
  function openTemplateModal() {
    formMode = 'template';
    formTemplateId = '';
    // Un jour par défaut : un modèle sert surtout aux concours récurrents, et
    // l'heure du formulaire de lancement y serait rarement le bon choix.
    form = { ...EMPTY_FORM, durationValue: 1, durationUnit: 'days' };
    saveTargetId = '';
    showExtras = false;
    actionState.clearFeedback();
    showModal = true;
  }

  /** Ouvre la modale de lancement déjà remplie par un modèle. */
  function startFromTemplate(template: GiveawayTemplate) {
    openCreateModal();
    formTemplateId = template.id;
    applyTemplateToForm(template);
    gotoTab('/giveaways', 'concours', DEFAULT_TAB);
  }

  /**
   * Recopie un modèle dans le formulaire de lancement, ou le vide quand on
   * repasse sur « aucun modèle ».
   *
   * Ce retour en arrière compte maintenant que le formulaire porte aussi les
   * récompenses et l'apparence : sans lui, désélectionner un modèle laissait
   * les siennes en place, invisibles dans un formulaire qui n'annonce plus
   * aucun modèle.
   *
   * Le nom reste de côté dans les deux sens : il désigne le modèle, pas le
   * concours. Un modèle sans salon laisse en place celui déjà choisi.
   */
  function applyTemplateToForm(template: GiveawayTemplate | null) {
    const filled = template ? formFromTemplate(template) : EMPTY_FORM;
    form = { ...form, ...filled, name: form.name, channelId: filled.channelId || form.channelId };
    showExtras = hasExtras(form);
  }

  /**
   * Premier « Modèle n » encore libre.
   *
   * Un nom est obligatoire, mais le demander pour mettre de côté des réglages
   * qu'on vient de saisir est un obstacle de plus : on en propose un, quitte à
   * le renommer depuis la galerie.
   */
  function defaultTemplateName(): string {
    const taken = new Set(templates.map((entry) => entry.name.trim().toLowerCase()));
    let index = 1;
    while (taken.has(m.giv_form_save_as_default({ n: index }).toLowerCase())) index += 1;
    return m.giv_form_save_as_default({ n: index });
  }

  /** Modèle que l'enregistrement va écraser, `null` quand il en crée un. */
  const saveTarget = $derived(formMode === 'launch' ? saveTargetId || null : null);

  async function handleSaveTemplate() {
    if (!canManageSettings || !form.prize.trim()) return;
    const target = saveTarget;
    // Le nom n'est exigé que dans l'onglet Modèles, où il est la seule chose
    // qu'on vienne poser. Depuis un lancement, on en propose un.
    if (formMode === 'template' && !form.name.trim()) return;
    const name = form.name.trim() || defaultTemplateName();
    const rewards = formRewards();
    const payload = {
      name,
      prize: form.prize.trim(),
      description: form.description.trim() || null,
      winnerCount: form.winnerCount,
      durationMinutes: computedDurationMinutes,
      channelId: form.channelId || null,
      ...rewards,
      // Le modèle stocke l'absence d'objet en `null`, là où l'API du lancement
      // lit une chaîne vide.
      rpgItemId: rewards.rpgItemId || null,
      needValidation: form.needValidation,
      ignoreBonuses: form.ignoreBonuses,
      styleOverrides: formStyleOverrides(),
    };

    await actionState.run(async () => {
      const res = target
        ? await updateGiveawayTemplate(target, payload)
        : await createGiveawayTemplate(payload);
      if (!res || !res.template) throw new Error(m.giv_tpl_error_save());
      // Retrié comme l'API le renvoie : un modèle créé se rangerait sinon en
      // fin de liste, loin de son voisin alphabétique.
      templates = (target
        ? templates.map((entry) => (entry.id === target ? res.template : entry))
        : [...templates, res.template]
      ).sort((a, b) => a.name.localeCompare(b.name));
      // En mode modèle la modale a fini son travail. Depuis un lancement elle
      // reste ouverte, le concours n'étant pas encore parti, et le modèle qu'on
      // vient d'écrire devient la cible : un second clic le corrige au lieu
      // d'en créer un homonyme, que l'API refuserait.
      if (formMode === 'template') {
        showModal = false;
      } else {
        saveTargetId = res.template.id;
        form.name = res.template.name;
      }
      return true;
    }, { successMessage: target ? m.giv_tpl_success_update() : m.giv_tpl_success_create() });
  }

  /** Modèle dont on change le nom sur sa carte, sans rouvrir le formulaire. */
  let renamingId = $state<string | null>(null);
  let renameValue = $state('');

  function startRename(template: GiveawayTemplate) {
    renamingId = template.id;
    renameValue = template.name;
  }

  /**
   * Renomme un modèle sans toucher au reste.
   *
   * L'API veut le modèle entier : on lui renvoie celui qu'on a déjà, avec son
   * seul nom changé. Rouvrir le formulaire pour une lettre serait disproportionné,
   * surtout après un nom posé d'office à l'enregistrement.
   */
  async function handleRenameTemplate(template: GiveawayTemplate) {
    const name = renameValue.trim();
    if (!canManageSettings || !name) return;
    if (name === template.name) {
      renamingId = null;
      return;
    }

    await actionState.run(async () => {
      const { id: _id, guildId: _guildId, ...fields } = template;
      const res = await updateGiveawayTemplate(template.id, { ...fields, name });
      if (!res || !res.template) throw new Error(m.giv_tpl_error_save());
      templates = templates
        .map((entry) => (entry.id === template.id ? res.template : entry))
        .sort((a, b) => a.name.localeCompare(b.name));
      renamingId = null;
      return true;
    }, { successMessage: m.giv_tpl_success_rename() });
  }

  async function handleDeleteTemplate(templateId: string) {
    if (!canManageSettings) return;
    if (!(await confirmDialog.danger(m.giv_tpl_confirm_delete_title(), m.giv_tpl_confirm_delete_desc()))) return;
    await actionState.run(async () => {
      const ok = await deleteGiveawayTemplate(templateId);
      if (!ok) throw new Error(m.giv_tpl_error_delete());
      templates = templates.filter((entry) => entry.id !== templateId);
      // La cible d'enregistrement du formulaire a pu disparaître avec lui.
      if (saveTargetId === templateId) saveTargetId = '';
      if (formTemplateId === templateId) formTemplateId = '';
      return true;
    }, { successMessage: m.giv_tpl_success_delete() });
  }

  async function handleCreate() {
    if (!canManageSettings || !form.prize.trim() || !form.winnerCount || !durationIsValid || !form.channelId) return;
    await actionState.run(async () => {
      // Plus d'identifiant de modèle : le formulaire porte tout ce qu'un modèle
      // portait, jusqu'aux récompenses et à l'apparence. Ce qui part est donc
      // exactement ce que la modale affiche.
      const res = await createGiveaway({
        prize: form.prize.trim(),
        // Toujours envoyée, même vide : sans cela l'API retomberait sur une
        // description héritée, qu'on ne pourrait alors plus retirer.
        description: form.description,
        winnerCount: form.winnerCount,
        durationMinutes: computedDurationMinutes,
        channelId: form.channelId,
        ignoreBonuses: form.ignoreBonuses,
        // `rpgItemId` part vide plutôt qu'en `null`, comme la description :
        // l'API lit une chaîne et traduit le vide en « aucun objet ».
        ...formRewards(),
        needValidation: form.needValidation,
        styleOverrides: formStyleOverrides(),
      });
      if (!res || !res.giveaway) throw new Error(m.e8_giveaways_error_create());
      giveaways = [res.giveaway, ...giveaways];
      showModal = false;
      return true;
    }, { successMessage: m.e8_giveaways_success_create() });
  }

  // Clôturer tire les gagnants et remet les lots sur-le-champ, relancer en
  // ajoute un et le sert aussi. Seule la suppression demandait confirmation,
  // alors que ces deux-là sont les gestes qu'on ne peut pas défaire.
  async function handleEnd(id: string) {
    if (!canManageSettings) return;
    if (!(await confirmDialog.ask({
      title: m.e8_giveaways_confirm_end_title(),
      description: m.e8_giveaways_confirm_end_desc(),
      confirmLabel: m.e8_giveaways_confirm_end_button(),
      variant: 'warning',
    }))) return;
    await actionState.run(async () => {
      const ok = await endGiveaway(id);
      if (!ok) throw new Error(m.e8_giveaways_error_end());
      giveaways = giveaways.map(g => g.id === id ? { ...g, ended: true } : g);
      applyGiveawaysResponse(await fetchGiveaways());
      return true;
    }, { successMessage: m.e8_giveaways_success_end() });
  }

  async function handleReroll(id: string) {
    if (!canManageSettings) return;
    if (!(await confirmDialog.ask({
      title: m.e8_giveaways_confirm_reroll_title(),
      description: m.e8_giveaways_confirm_reroll_desc(),
      confirmLabel: m.e8_giveaways_confirm_reroll_button(),
      variant: 'warning',
    }))) return;
    await actionState.run(async () => {
      const ok = await rerollGiveaway(id);
      if (!ok) throw new Error(m.e8_giveaways_error_reroll());
      applyGiveawaysResponse(await fetchGiveaways());
      return true;
    }, { successMessage: m.e8_giveaways_success_reroll() });
  }

  async function handleDelete(id: string) {
    if (!canManageSettings) return;
    if (!(await confirmDialog.danger(m.e8_giveaways_confirm_delete_title(), m.e8_giveaways_confirm_delete_desc()))) return;
    await actionState.run(async () => {
      const ok = await deleteGiveaway(id);
      if (!ok) throw new Error(m.e8_giveaways_error_delete());
      giveaways = giveaways.filter(g => g.id !== id);
      return true;
    }, { successMessage: m.e8_giveaways_success_delete() });
  }

  function getChannelName(channelId: string) {
    const channel = availableChannels.find(c => c.id === channelId);
    return channel ? channelDisplayName(channel) : m.e8_giveaways_unknown_channel({ channelId });
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

</script>

<ModulePage
  title={m.giv_page_title()}
  description={m.giv_page_desc()}
  icon="sparkles"
  featureKey="giveaways"
>
  <InlineFeedback state={actionState} />

  {#if canManageSettings}
    <nav class="tab-group w-fit">
      <button onclick={() => gotoTab('/giveaways', 'concours', DEFAULT_TAB)} class="tab-button {activeTab === 'concours' ? 'active' : ''}">
        <Papicon icon="Sparkles" size={16} />
        {m.giv_tab_giveaways()}
      </button>
      <button onclick={() => gotoTab('/giveaways', 'modeles', DEFAULT_TAB)} class="tab-button {activeTab === 'modeles' ? 'active' : ''}">
        <Papicon icon="Copy" size={16} />
        {m.giv_tab_templates()}
      </button>
      {#if canEditConfig}
        <button onclick={() => gotoTab('/giveaways', 'configuration', DEFAULT_TAB)} class="tab-button {activeTab === 'configuration' ? 'active' : ''}">
          <Papicon icon="Settings" size={16} />
          {m.giv_tab_config()}
        </button>
      {/if}
    </nav>
  {/if}

  {#if loading}
    <div class="space-y-4">
      <Skeleton height="100px" radius="2rem" />
      <Skeleton height="100px" radius="2rem" />
      <Skeleton height="100px" radius="2rem" />
    </div>
  {:else if activeTab === 'modeles' && canManageSettings}
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="max-w-2xl">
          <p class="text-sm font-semibold text-on-surface">{m.giv_tpl_title()}</p>
          <p class="text-xs text-on-surface-variant/70 font-medium">{m.giv_tpl_desc()}</p>
          <p class="text-xs text-on-surface-variant/50 mt-1">{m.giv_tpl_vs_config_hint()}</p>
        </div>
        <button
          onclick={openTemplateModal}
          class="flex items-center justify-center gap-2 px-5 py-3 bg-primary text-on-primary text-[13px] font-medium rounded-lg transition-all cursor-pointer"
        >
          <Papicon icon="Add" size={14} />
          {m.giv_tpl_create()}
        </button>
      </div>

      {#if templates.length === 0}
        <div class="flex flex-col items-center justify-center py-20 bg-surface-container-low/20 border border-outline-variant/10 rounded-xl text-center">
          <Papicon icon="Copy" size={32} class="text-on-surface-variant/20 mb-3" />
          <p class="text-sm text-on-surface-variant/60 font-medium">{m.giv_tpl_empty()}</p>
        </div>
      {:else}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {#each templates as template (template.id)}
            <div class="bg-surface-container-low/30 border border-outline-variant/10 rounded-xl p-6 space-y-4">
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0 flex-1">
                  {#if renamingId === template.id}
                    <input
                      type="text"
                      bind:value={renameValue}
                      aria-label={m.giv_tpl_rename()}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleRenameTemplate(template); }
                        if (e.key === 'Escape') renamingId = null;
                      }}
                      class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-1.5 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none"
                    />
                  {:else}
                    <p class="text-sm font-semibold text-on-surface truncate">{template.name}</p>
                  {/if}
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  {#if renamingId === template.id}
                    <button
                      onclick={() => handleRenameTemplate(template)}
                      class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-primary/15 hover:text-primary text-on-surface-variant transition-colors cursor-pointer"
                      title={m.giv_tpl_rename_confirm()}
                    >
                      <Papicon icon="Check" size={14} />
                    </button>
                    <button
                      onclick={() => { renamingId = null; }}
                      class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-rose-500/15 hover:text-rose-500 text-on-surface-variant transition-colors cursor-pointer"
                      title={m.giv_tpl_rename_cancel()}
                    >
                      <Papicon icon="Cross" size={14} />
                    </button>
                  {:else}
                    <button
                      onclick={() => startRename(template)}
                      class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-primary/15 hover:text-primary text-on-surface-variant transition-colors cursor-pointer"
                      title={m.giv_tpl_rename()}
                    >
                      <Papicon icon="Pencil" size={14} />
                    </button>
                    <button
                      onclick={() => handleDeleteTemplate(template.id)}
                      class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-rose-500/15 hover:text-rose-500 text-on-surface-variant transition-colors cursor-pointer"
                      title={m.giv_tpl_delete_title()}
                    >
                      <Papicon icon="Trash" size={14} />
                    </button>
                  {/if}
                </div>
              </div>

              <GiveawayPreview
                compact
                appearance={templateAppearance(template)}
                overrides={templateSample(template)}
                bonusRoles={template.ignoreBonuses ? [] : previewBonusRoles}
                showBonusRoles={config.showBonusRoles}
                generated={generatedLabels}
              />

              <!-- Ce que l'annonce ne dit pas : où elle part, et comment on tire. -->
              <div class="flex flex-wrap gap-2 text-[11px] font-medium text-on-surface-variant/70">
                {#if template.channelId}
                  <span class="px-2 py-1 rounded-lg bg-surface-container-high/40">{getChannelName(template.channelId)}</span>
                {/if}
                {#if template.ignoreBonuses}
                  <span class="px-2 py-1 rounded-lg bg-surface-container-high/40">{m.giv_tpl_badge_no_bonus()}</span>
                {/if}
              </div>

              <button
                onclick={() => startFromTemplate(template)}
                class="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary font-medium text-xs rounded-lg transition-all cursor-pointer"
              >
                <Papicon icon="Sparkles" size={14} />
                {m.giv_tpl_use()}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if activeTab === 'configuration' && canEditConfig}
    <div class="space-y-6">
      <InlineFeedback state={configAction} />

      <p class="text-xs text-on-surface-variant/70 bg-surface-container-low/30 border border-outline-variant/10 rounded-xl px-4 py-3">
        {m.giv_cfg_section_hint()}
      </p>

      <SectionCard
        title={m.giv_cfg_managers_title()}
        description={m.giv_cfg_managers_desc()}
        icon="shield"
      >
        <div class="space-y-1.5">
          <MultiSelect
            id="giveaway-manager-roles"
            bind:values={config.managerRoleIds}
            options={availableRoles.map((r: any) => ({ id: r.id, name: `@${r.name}` }))}
            accentClass="bg-primary/20 text-primary border-primary/40"
          />
          <p class="text-[11px] text-on-surface-variant/50">{m.giv_cfg_managers_help()}</p>
        </div>
      </SectionCard>

      <SectionCard
        title={m.giv_cfg_default_channel()}
        description={m.giv_cfg_default_channel_help()}
        icon="channel"
      >
        <SearchableSelect
          id="giveaway-default-channel"
          bind:value={config.defaultChannelId}
          options={availableChannels.map((c: any) => ({ id: c.id, name: channelDisplayName(c) }))}
          placeholder={m.giv_select_channel_placeholder()}
          className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all"
        />
      </SectionCard>

      <SectionCard
        title={m.giv_cfg_participation_title()}
        description={m.giv_cfg_participation_desc()}
        icon="users"
      >
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="space-y-1.5">
            <span class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.giv_cfg_required_label()}</span>
            <MultiSelect
              id="giveaway-required-roles"
              bind:values={config.requiredRoleIds}
              options={availableRoles.map((r: any) => ({ id: r.id, name: `@${r.name}` }))}
              accentClass="bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
            />
            <p class="text-[11px] text-on-surface-variant/50">{m.giv_cfg_required_help()}</p>
          </div>

          <div class="space-y-1.5">
            <span class="text-[10px] font-bold text-on-surface-variant/60 ml-1 uppercase tracking-widest">{m.giv_cfg_blocked_label()}</span>
            <MultiSelect
              id="giveaway-blocked-roles"
              bind:values={config.blockedRoleIds}
              options={availableRoles.map((r: any) => ({ id: r.id, name: `@${r.name}` }))}
              accentClass="bg-rose-500/20 text-rose-300 border-rose-500/40"
            />
            <p class="text-[11px] text-on-surface-variant/50">{m.giv_cfg_blocked_help()}</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={m.giv_cfg_requirements_title()}
        description={m.giv_cfg_requirements_desc()}
        icon="clock"
      >
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label for="giveaway-min-account-age" class="field-label">{m.giv_cfg_min_account_age()}</label>
            <input
              id="giveaway-min-account-age"
              type="number"
              min="0"
              max="3650"
              bind:value={config.minAccountAgeDays}
              class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
            />
            <p class="field-hint">{m.giv_cfg_min_account_age_help()}</p>
          </div>

          <div>
            <label for="giveaway-min-member-age" class="field-label">{m.giv_cfg_min_member_age()}</label>
            <input
              id="giveaway-min-member-age"
              type="number"
              min="0"
              max="3650"
              bind:value={config.minMemberAgeDays}
              class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
            />
            <p class="field-hint">{m.giv_cfg_min_member_age_help()}</p>
          </div>

          <div>
            <label for="giveaway-min-level" class="field-label">{m.giv_cfg_min_level()}</label>
            <input
              id="giveaway-min-level"
              type="number"
              min="0"
              max="1000"
              bind:value={config.minLevel}
              class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
            />
            <p class="field-hint">{m.giv_cfg_min_level_help()}</p>
          </div>
        </div>

        <label class="flex items-start gap-3 cursor-pointer mt-6 pt-6 border-t border-outline-variant/10">
          <input type="checkbox" bind:checked={config.blockLinkedAccounts} class="mt-0.5 w-4 h-4 accent-primary cursor-pointer" />
          <span>
            <span class="block text-sm text-on-surface">{m.giv_cfg_linked_label()}</span>
            <span class="block field-hint">{m.giv_cfg_linked_help()}</span>
          </span>
        </label>
      </SectionCard>

      <SectionCard
        title={m.giv_cfg_bonus_title()}
        description={m.giv_cfg_bonus_desc()}
        icon="trending-up"
      >
        <div class="space-y-3">
          {#each config.bonusEntries as entry, index (entry.roleId)}
            <div class="flex items-center gap-3 bg-surface-container-high/25 border border-outline-variant/10 rounded-lg px-3 py-2">
              <span class="flex-1 text-sm text-on-surface truncate">@{roleName(entry.roleId)}</span>
              <label class="flex items-center gap-2 text-[11px] text-on-surface-variant/70">
                {m.giv_cfg_bonus_weight()}
                <input
                  type="number"
                  min="2"
                  max="10"
                  bind:value={entry.weight}
                  class="w-20 bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none"
                />
              </label>
              <button
                onclick={() => removeBonusEntry(index)}
                class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-rose-500/15 hover:text-rose-500 text-on-surface-variant transition-colors cursor-pointer"
                title={m.giv_cfg_bonus_remove()}
              >
                <Papicon icon="Trash" size={14} />
              </button>
            </div>
          {:else}
            <p class="text-xs text-on-surface-variant/60">{m.giv_cfg_bonus_empty()}</p>
          {/each}

          <div class="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div class="flex-1">
              <SearchableSelect
                id="giveaway-bonus-role-add"
                bind:value={pendingBonusRoleId}
                options={bonusRoleOptions}
                placeholder={m.giv_cfg_bonus_role()}
                clearable={false}
                className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
            <button
              onclick={addBonusEntry}
              disabled={!pendingBonusRoleId}
              class="flex items-center justify-center gap-2 px-4 py-3 bg-primary/10 hover:bg-primary/20 text-primary font-medium text-xs rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Papicon icon="Add" size={14} />
              {m.giv_cfg_bonus_add()}
            </button>
          </div>

          <p class="field-hint">{m.giv_cfg_bonus_help()}</p>
        </div>

        <div class="mt-6 pt-6 border-t border-outline-variant/10 space-y-4">
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" bind:checked={config.clanBonusEnabled} class="mt-0.5 w-4 h-4 accent-primary cursor-pointer" />
            <span>
              <span class="block text-sm text-on-surface">{m.giv_cfg_clan_bonus_label()}</span>
              <span class="block field-hint">{m.giv_cfg_clan_bonus_help()}</span>
            </span>
          </label>

          {#if config.clanBonusEnabled}
            <div class="sm:w-56">
              <label for="giveaway-clan-bonus-weight" class="field-label">{m.giv_cfg_clan_bonus_weight()}</label>
              <input
                id="giveaway-clan-bonus-weight"
                type="number"
                min="2"
                max="10"
                bind:value={config.clanBonusWeight}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
              />
              <p class="field-hint">{m.giv_cfg_clan_bonus_weight_help()}</p>
            </div>
          {/if}

          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" bind:checked={config.showBonusRoles} class="mt-0.5 w-4 h-4 accent-primary cursor-pointer" />
            <span>
              <span class="block text-sm text-on-surface">{m.giv_cfg_show_bonus_roles_label()}</span>
              <span class="block field-hint">{m.giv_cfg_show_bonus_roles_help()}</span>
            </span>
          </label>
        </div>
      </SectionCard>

      <SectionCard
        title={m.giv_cfg_appearance_title()}
        description={m.giv_cfg_appearance_desc()}
        icon="palette"
      >
        <div class="mb-6">
          <GiveawayPreview
            appearance={config}
            bonusRoles={previewBonusRoles}
            showBonusRoles={config.showBonusRoles}
            generated={generatedLabels}
          />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="flex items-center justify-between gap-4 p-4 bg-surface-container rounded-lg border border-outline-variant">
            <p class="text-sm font-medium text-on-surface">{m.giv_cfg_color_active()}</p>
            <FormColorPicker bind:value={config.embedColorActive} />
          </div>
          <div class="flex items-center justify-between gap-4 p-4 bg-surface-container rounded-lg border border-outline-variant">
            <p class="text-sm font-medium text-on-surface">{m.giv_cfg_color_pending()}</p>
            <FormColorPicker bind:value={config.embedColorPending} />
          </div>
          <div class="flex items-center justify-between gap-4 p-4 bg-surface-container rounded-lg border border-outline-variant">
            <p class="text-sm font-medium text-on-surface">{m.giv_cfg_color_ended()}</p>
            <FormColorPicker bind:value={config.embedColorEnded} />
          </div>
          <div class="flex items-center justify-between gap-4 p-4 bg-surface-container rounded-lg border border-outline-variant">
            <p class="text-sm font-medium text-on-surface">{m.giv_cfg_color_validated()}</p>
            <FormColorPicker bind:value={config.embedColorValidated} />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <MacroTextField
            id="giveaway-title-template"
            label={m.giv_cfg_title_label()}
            hint={m.giv_cfg_title_help()}
            bind:value={config.titleTemplate}
            macros={commonMacros}
            defaultValue={defaults?.titleTemplate ?? null}
          />
          <MacroTextField
            id="giveaway-footer-template"
            label={m.giv_cfg_footer_label()}
            hint={m.giv_cfg_footer_help()}
            bind:value={config.footerTemplate}
            macros={commonMacros}
            defaultValue={defaults?.footerTemplate ?? null}
          />
          <div class="md:col-span-2">
            <MacroTextField
              id="giveaway-description-template"
              label={m.giv_cfg_description_label()}
              hint={m.giv_cfg_description_help()}
              bind:value={config.descriptionTemplate}
              macros={bodyMacros}
              defaultValue={defaults?.descriptionTemplate ?? null}
              multiline
              rows={7}
            />
          </div>
          <div>
            <label for="giveaway-thumbnail" class="field-label">{m.giv_cfg_thumbnail_label()}</label>
            <input id="giveaway-thumbnail" type="url" bind:value={config.thumbnailUrl} placeholder="https://" class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none" />
            <p class="field-hint">{m.giv_cfg_thumbnail_help()}</p>
          </div>
          <div>
            <label for="giveaway-image" class="field-label">{m.giv_cfg_image_label()}</label>
            <input id="giveaway-image" type="url" bind:value={config.imageUrl} placeholder="https://" class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none" />
            <p class="field-hint">{m.giv_cfg_image_help()}</p>
          </div>
        </div>
        <p class="field-hint">{m.giv_cfg_images_help()}</p>
      </SectionCard>

      <SectionCard
        title={m.giv_cfg_button_title()}
        description={m.giv_cfg_button_desc()}
        icon="mouse-pointer-click"
      >
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label for="giveaway-button-label" class="field-label">{m.giv_cfg_button_label()}</label>
            <input id="giveaway-button-label" type="text" maxlength="80" bind:value={config.joinButtonLabel} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none" />
            <p class="field-hint">{m.giv_cfg_button_label_help()}</p>
          </div>
          <div>
            <span class="field-label">{m.giv_cfg_button_emoji()}</span>
            <div class="flex items-center gap-2">
              <EmojiPicker bind:value={config.joinButtonEmoji} />
              {#if config.joinButtonEmoji}
                <button
                  type="button"
                  onclick={() => { config.joinButtonEmoji = ''; }}
                  class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-rose-500/15 hover:text-rose-500 text-on-surface-variant transition-colors cursor-pointer"
                  title={m.giv_cfg_button_emoji_clear()}
                >
                  <Papicon icon="Cross" size={14} />
                </button>
              {/if}
            </div>
            <p class="field-hint">{m.giv_cfg_button_emoji_help()}</p>
          </div>
          <div>
            <label for="giveaway-button-style" class="field-label">{m.giv_cfg_button_style()}</label>
            <select
              id="giveaway-button-style"
              bind:value={config.joinButtonStyle}
              class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none cursor-pointer"
            >
              {#each buttonStyles as style}
                <option value={style}>{buttonStyleLabel(style)}</option>
              {/each}
            </select>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={m.giv_cfg_texts_title()}
        description={m.giv_cfg_texts_desc()}
        icon="message-square"
      >
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MacroTextField
            id="giveaway-announce-winners"
            label={m.giv_cfg_announce_winners()}
            hint={m.giv_cfg_announce_winners_help()}
            bind:value={config.announceWinnersTemplate}
            macros={[winnersMacro, ...commonMacros]}
            defaultValue={defaults?.announceWinnersTemplate ?? null}
            multiline
          />
          <MacroTextField
            id="giveaway-announce-no-winner"
            label={m.giv_cfg_announce_no_winner()}
            hint={m.giv_cfg_announce_no_winner_help()}
            bind:value={config.announceNoWinnerTemplate}
            macros={commonMacros}
            defaultValue={defaults?.announceNoWinnerTemplate ?? null}
            multiline
          />
          <MacroTextField
            id="giveaway-join-reply"
            label={m.giv_cfg_join_reply()}
            hint={m.giv_cfg_join_reply_help()}
            bind:value={config.joinReplyTemplate}
            macros={commonMacros}
            defaultValue={defaults?.joinReplyTemplate ?? null}
            multiline
          />
          <MacroTextField
            id="giveaway-leave-reply"
            label={m.giv_cfg_leave_reply()}
            hint={m.giv_cfg_leave_reply_help()}
            bind:value={config.leaveReplyTemplate}
            macros={commonMacros}
            defaultValue={defaults?.leaveReplyTemplate ?? null}
            multiline
          />
        </div>
      </SectionCard>

      <SectionCard
        title={m.giv_cfg_denied_title()}
        description={m.giv_cfg_denied_desc()}
        icon="shield-off"
      >
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MacroTextField
            id="giveaway-denied-blocked"
            label={m.giv_cfg_denied_blocked()}
            bind:value={config.deniedBlockedTemplate}
            macros={refusalMacros}
            defaultValue={defaults?.deniedBlockedTemplate ?? null}
            multiline
          />
          <MacroTextField
            id="giveaway-denied-required"
            label={m.giv_cfg_denied_required()}
            bind:value={config.deniedRequiredTemplate}
            macros={refusalMacros}
            defaultValue={defaults?.deniedRequiredTemplate ?? null}
            multiline
          />
          <MacroTextField
            id="giveaway-denied-account-age"
            label={m.giv_cfg_denied_account_age()}
            bind:value={config.deniedAccountAgeTemplate}
            macros={refusalMacros}
            defaultValue={defaults?.deniedAccountAgeTemplate ?? null}
            multiline
          />
          <MacroTextField
            id="giveaway-denied-member-age"
            label={m.giv_cfg_denied_member_age()}
            bind:value={config.deniedMemberAgeTemplate}
            macros={refusalMacros}
            defaultValue={defaults?.deniedMemberAgeTemplate ?? null}
            multiline
          />
          <MacroTextField
            id="giveaway-denied-level"
            label={m.giv_cfg_denied_level()}
            bind:value={config.deniedLevelTemplate}
            macros={refusalMacros}
            defaultValue={defaults?.deniedLevelTemplate ?? null}
            multiline
          />
          <MacroTextField
            id="giveaway-denied-linked"
            label={m.giv_cfg_denied_linked()}
            bind:value={config.deniedLinkedTemplate}
            macros={refusalMacros}
            defaultValue={defaults?.deniedLinkedTemplate ?? null}
            multiline
          />
        </div>
      </SectionCard>

      <div class="flex justify-end">
        <button
          onclick={handleSaveConfig}
          disabled={configAction.state.loading}
          class="px-8 py-3 bg-primary text-on-primary font-medium text-[13px] rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {configAction.state.loading ? m.giv_cfg_saving() : m.giv_cfg_save()}
        </button>
      </div>
    </div>
  {:else}
    <div class="space-y-6">
      <!-- Page publique : consultable sans compte, elle sert de vitrine aux concours -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-linear-to-r from-tertiary/10 to-secondary/10 border border-tertiary/20 rounded-xl p-6 px-8 shadow-xs relative overflow-hidden">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-lg bg-tertiary/10 border border-tertiary/20 flex items-center justify-center text-tertiary shadow-inner">
            <Papicon icon="Globe" size={22} />
          </div>
          <div>
            <p class="text-sm font-semibold text-on-surface">{m.giv_public_banner_title()}</p>
            <p class="text-xs text-on-surface-variant/70 font-medium">{m.giv_public_page_desc()}</p>
          </div>
        </div>
        <div class="flex items-center gap-3 shrink-0 w-full sm:w-auto">
          <a
            href={publicGiveawaysUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-2 px-5 py-3 bg-tertiary/20 text-tertiary border border-tertiary/25 rounded-lg text-xs font-semibold hover:bg-tertiary/30 transition-all hover:scale-103 w-full sm:w-auto text-center"
          >
            <Papicon icon="ExternalLink" size={14} />
            {m.giv_public_page_view()}
          </a>
          <button
            onclick={copyPublicGiveawaysUrl}
            class="flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-xs font-semibold transition-all hover:scale-103 w-full sm:w-auto {copySuccess ? 'bg-green-500/15 text-green-400 border border-green-500/20' : 'bg-surface-container-high/40 text-on-surface-variant border border-outline-variant/10 hover:bg-surface-container-high/60'}"
          >
            {#if copySuccess}
              <Papicon icon="Check" size={14} />
              {m.giv_public_page_copied()}
            {:else}
              <Papicon icon="Copy" size={14} />
              {m.giv_public_page_copy()}
            {/if}
          </button>
        </div>
      </div>

      <!-- Title & Actions Bar -->
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <h3 class="text-xl font-semibold flex items-center gap-3">
          <Papicon icon="List" size={20} class="text-secondary" />
          {m.giv_list_title({ count: giveaways.length })}
        </h3>

        {#if canManageSettings}
          <button
            onclick={openCreateModal}
            class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary font-medium text-[13px] rounded-lg transition-all cursor-pointer"
          >
            <Papicon icon="Add" size={16} />
            {m.giv_btn_create()}
          </button>
        {/if}
      </div>

      <!-- Giveaways list -->
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {#each giveaways as giveaway}
          <div class="bg-surface-container-low/30 border border-outline-variant/10 p-6 rounded-xl flex flex-col justify-between hover:bg-surface-container-low/50 hover:border-outline-variant/20 hover:shadow-sm hover:shadow-primary/5 transition-all duration-300 relative group">
            <div class="space-y-4">
              <!-- Status & Destination -->
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-xl {giveaway.ended ? 'bg-outline-variant/20 text-on-surface-variant' : 'bg-primary/10 text-primary border border-primary/20 animate-pulse'}">
                    {giveaway.ended ? m.giv_status_ended() : m.giv_status_active()}
                  </span>
                  {#if giveaway.ignoreBonuses}
                    <span class="text-[10px] font-semibold px-2.5 py-1 rounded-xl bg-surface-container-high/50 text-on-surface-variant" title={m.giv_field_ignore_bonuses_help()}>
                      {m.giv_field_ignore_bonuses()}
                    </span>
                  {/if}
                </div>
                <span class="text-[11px] font-bold text-on-surface-variant/70 flex items-center gap-1 bg-surface-container-high/40 px-2 py-1 rounded-lg">
                  <Papicon icon="Hash" size={11} />{getChannelName(giveaway.channelId)}
                </span>
              </div>

              <!-- Prize & Description -->
              <div class="space-y-1">
                <h4 class="text-lg font-semibold text-on-surface leading-tight group-hover:text-primary transition-colors duration-300">{giveaway.prize}</h4>
                {#if giveaway.description}
                  <p class="text-xs text-on-surface-variant/70 font-medium line-clamp-3 leading-relaxed">{giveaway.description}</p>
                {/if}
              </div>

              <!-- Stats row -->
              <div class="flex flex-wrap gap-2 pt-3 border-t border-outline-variant/10">
                <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/10">
                  <Papicon icon="Users" size={10} />{m.giv_participants_count({ count: giveaway.participants.length })}
                </span>
                <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/10">
                  <Papicon icon="Crown" size={10} />{m.giv_winners_count({ count: giveaway.winnerCount })}
                </span>
              </div>

              <!-- Winners or Clock -->
              {#if giveaway.ended}
                <div class="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-3 space-y-2">
                  <span class="text-xs font-medium text-emerald-400 flex items-center gap-1">
                    <Papicon icon="Crown" size={10} />
                    {giveaway.validationStatus === 'PENDING' ? m.giv_winners_header_pending() : m.giv_winners_header()}
                  </span>
                  {#if announcedWinners(giveaway).length > 0}
                    <div class="flex flex-wrap gap-1.5">
                      {#each announcedWinners(giveaway) as winner (winner.userId)}
                        <button
                          type="button"
                          disabled={!canOpenMemberCase}
                          onclick={() => openMemberCase(winner.userId, winner.displayName)}
                          title={canOpenMemberCase ? m.giv_winner_open_case({ name: winner.displayName }) : undefined}
                          class="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/15 transition-colors max-w-full {canOpenMemberCase ? 'hover:bg-emerald-500/20 hover:border-emerald-500/30 cursor-pointer' : 'cursor-default'}"
                        >
                          {#if winner.avatarUrl}
                            <img src={winner.avatarUrl} alt="" class="w-5 h-5 rounded-full object-cover shrink-0" />
                          {:else}
                            <span class="w-5 h-5 rounded-full bg-emerald-500/20 text-[9px] font-bold text-emerald-300 flex items-center justify-center shrink-0">
                              {winner.displayName.slice(0, 2).toUpperCase()}
                            </span>
                          {/if}
                          <span class="text-xs font-semibold text-emerald-300/95 truncate">{winner.displayName}</span>
                        </button>
                      {/each}
                    </div>
                  {:else}
                    <p class="text-xs font-bold text-emerald-300/95 wrap-break-word">{m.giv_no_winners()}</p>
                  {/if}
                </div>
              {:else}
                <div class="bg-surface-container-high/20 border border-outline-variant/5 rounded-lg p-3 flex items-center gap-2 text-on-surface-variant/60">
                  <Papicon icon="Clock" size={12} class="text-primary" />
                  <span class="text-[10px] font-semibold">
                    {m.giv_ends_at({ date: formatDate(giveaway.endsAt) })}
                  </span>
                </div>
              {/if}
            </div>

            <!-- Actions -->
            {#if canManageSettings}
              <div class="flex items-center gap-2 pt-4 mt-4 border-t border-outline-variant/10 justify-end">
                {#if !giveaway.ended}
                  <button
                    onclick={() => handleEnd(giveaway.id)}
                    class="px-3.5 py-2 bg-secondary hover:bg-secondary-hover text-on-secondary text-[10px] font-semibold uppercase tracking-wider rounded-xl transition-all shadow-md shadow-secondary/10 cursor-pointer flex items-center gap-1.5"
                    title={m.giv_title_pick_winner()}
                  >
                    <Papicon icon="Sparkles" size={11} />
                    {m.giv_btn_pick_winner()}
                  </button>
                {:else}
                  <button
                    onclick={() => handleReroll(giveaway.id)}
                    class="px-3.5 py-2 bg-outline-variant/20 hover:bg-outline-variant/35 text-on-surface text-[10px] font-semibold uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                    title={m.giv_title_reroll()}
                  >
                    <Papicon icon="Refresh" size={11} />
                    {m.giv_btn_reroll()}
                  </button>
                {/if}
                <button
                  onclick={() => handleDelete(giveaway.id)}
                  class="p-2 text-error hover:bg-error/10 border border-transparent rounded-xl transition-all cursor-pointer"
                  title={m.giv_title_delete()}
                >
                  <Papicon icon="Trash" size={16} />
                </button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="col-span-full flex flex-col items-center justify-center py-20 bg-surface-container-low/20 border border-outline-variant/10 rounded-xl text-center">
            <Papicon icon="Sparkles" size={32} class="text-on-surface-variant/20 mb-3" />
            <p class="text-sm text-on-surface-variant/60 font-medium">{m.giv_empty_text()}</p>
            {#if canManageSettings}
              <button
                onclick={openCreateModal}
                class="mt-4 flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-xs rounded-lg transition-all cursor-pointer"
              >
                <Papicon icon="Add" size={14} /> {m.giv_empty_btn()}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</ModulePage>

<!-- Fiche membre, ouverte depuis un gagnant -->
<MemberCaseModal
  open={userCaseModalOpen}
  userId={selectedUserIdForCase}
  userName={selectedUserNameForCase}
  {caseData}
  loading={loadingCase}
  error={caseError}
  onClose={() => { userCaseModalOpen = false; }}
  onSelectUser={(newUserId) => {
    const node = caseData?.interactionGraph?.nodes?.find((n: any) => n.id === newUserId);
    openMemberCase(newUserId, node?.label || m.giv_winner_fallback_name());
  }}
/>

<!-- Modale unique : lancer un concours, ou enregistrer les mêmes champs comme modèle -->
{#if showModal}
  <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" transition:fade={{ duration: 150 }}>
    <div class="bg-surface-container-low/95 border border-outline-variant/20 max-w-2xl w-full rounded-xl p-8 space-y-6 shadow-sm relative max-h-[90vh] overflow-y-auto" transition:scale={{ start: 0.97, duration: 150 }}>

      <!-- Close button -->
      <button
        onclick={() => showModal = false}
        class="absolute top-6 right-6 p-2 rounded-full bg-surface-container-high/40 hover:bg-rose-500/15 hover:text-rose-500 text-on-surface-variant transition-colors cursor-pointer"
        title={m.giv_modal_close_title()}
      >
        <Papicon icon="Cross" size={20} />
      </button>

      <!-- Modal Header -->
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center text-primary shadow-inner">
          <Papicon icon={formMode === 'template' ? 'Copy' : 'Sparkles'} size={24} />
        </div>
        <div>
          <h3 class="text-2xl font-semibold tracking-tight">
            {formMode === 'template' ? m.giv_tpl_create() : m.giv_modal_title()}
          </h3>
          <p class="text-xs text-on-surface-variant/80 font-medium">
            {formMode === 'template' ? m.giv_tpl_modal_subtitle() : m.giv_modal_subtitle()}
          </p>
        </div>
      </div>

      <form
        onsubmit={(e) => { e.preventDefault(); if (formMode === 'template') handleSaveTemplate(); else handleCreate(); }}
        class="space-y-5 pt-2"
      >
        {#if formMode === 'template'}
          <div>
            <label for="modal-template-name" class="field-label">{m.giv_tpl_name_label()}</label>
            <input
              id="modal-template-name"
              type="text"
              bind:value={form.name}
              placeholder={m.giv_tpl_name_placeholder()}
              class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
              required
            />
          </div>
        {:else if templates.length > 0}
          <div>
            <label for="modal-template" class="field-label">{m.giv_tpl_apply_label()}</label>
            <select
              id="modal-template"
              value={formTemplateId}
              onchange={(e) => {
                formTemplateId = (e.currentTarget as HTMLSelectElement).value;
                applyTemplateToForm(templates.find((entry) => entry.id === formTemplateId) ?? null);
              }}
              class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none cursor-pointer"
            >
              <option value="">{m.giv_tpl_none()}</option>
              {#each templates as template (template.id)}
                <option value={template.id}>{template.name}</option>
              {/each}
            </select>
            <p class="field-hint">{m.giv_tpl_apply_help()}</p>
          </div>
        {/if}

        <div>
          <label for="modal-prize" class="field-label">{m.giv_field_prize_label()}</label>
          <input
            id="modal-prize"
            type="text"
            bind:value={form.prize}
            placeholder={m.giv_field_prize_placeholder()}
            class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
            required
          />
        </div>

        <div>
          <label for="modal-desc" class="field-label">{m.giv_field_desc_label()}</label>
          <textarea
            id="modal-desc"
            bind:value={form.description}
            placeholder={m.giv_field_desc_placeholder()}
            class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none h-20 resize-none"
          ></textarea>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="modal-winners" class="field-label">{m.giv_field_winners_label()}</label>
            <input
              id="modal-winners"
              type="number"
              min="1"
              max="20"
              bind:value={form.winnerCount}
              class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
              required
            />
          </div>

          <div>
            <span class="field-label">
              {form.endMode === 'date' ? m.giv_field_end_at_label() : m.giv_field_duration_label()}
            </span>

            <!-- Un modèle se relance plus tard : une date fixe n'y aurait pas de sens. -->
            {#if formMode === 'launch'}
              <div class="flex gap-1 mb-2">
                {#each endModes as mode (mode.id)}
                  <button
                    type="button"
                    onclick={() => setEndMode(mode.id)}
                    class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer {form.endMode === mode.id ? 'bg-primary/15 text-primary' : 'bg-surface-container-high/35 text-on-surface-variant hover:bg-primary/10'}"
                  >
                    {mode.label}
                  </button>
                {/each}
              </div>
            {/if}

            {#if form.endMode === 'date'}
              <input
                id="modal-ends-at"
                type="datetime-local"
                bind:value={form.endsAt}
                aria-label={m.giv_field_end_at_label()}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
                required
              />
              <p class="field-hint">
                {durationIsValid ? m.giv_field_end_at_help() : m.giv_field_end_at_invalid()}
              </p>
            {:else}
              <div class="flex gap-2">
                <input
                  id="modal-duration-value"
                  type="number"
                  min="1"
                  bind:value={form.durationValue}
                  aria-label={m.giv_field_duration_label()}
                  class="w-2/3 bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
                  required
                />
                <select
                  bind:value={form.durationUnit}
                  aria-label={m.giv_field_duration_label()}
                  class="w-1/3 bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-3 py-3 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none cursor-pointer"
                >
                  <option value="minutes">{m.giv_unit_minutes()}</option>
                  <option value="hours">{m.giv_unit_hours()}</option>
                  <option value="days">{m.giv_unit_days()}</option>
                </select>
              </div>
            {/if}
          </div>
        </div>

        <!-- Presets -->
        {#if form.endMode !== 'date'}
        <div>
          <span class="field-label">{m.giv_field_presets_label()}</span>
          <div class="flex flex-wrap gap-2">
            {#each presets as preset}
              <button
                type="button"
                onclick={() => applyPreset(preset)}
                class="px-3 py-1.5 bg-surface-container-high/35 hover:bg-primary/10 border border-outline-variant/10 hover:border-primary/30 rounded-xl text-xs font-bold text-on-surface transition-all cursor-pointer {form.durationValue === preset.value && form.durationUnit === preset.unit ? 'bg-primary/15 border-primary/40 text-primary' : ''}"
              >
                {preset.label}
              </button>
            {/each}
          </div>
        </div>
        {/if}

        <div>
          <label for="modal-channel" class="field-label">
            {formMode === 'template' ? m.giv_tpl_channel_label() : m.giv_field_channel_label()}
          </label>
          <SearchableSelect
            id="modal-channel"
            bind:value={form.channelId}
            options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))}
            placeholder={m.giv_select_channel_placeholder()}
            className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all"
          />
          {#if formMode === 'template'}
            <p class="field-hint">{m.giv_tpl_channel_help()}</p>
          {/if}
        </div>

        <div class="pt-4 border-t border-outline-variant/10 space-y-3">
          <p class="text-sm font-medium text-on-surface">{m.giv_preview_title()}</p>
          <GiveawayPreview
            compact
            appearance={formAppearance()}
            overrides={formSample()}
            bonusRoles={form.ignoreBonuses ? [] : previewBonusRoles}
            showBonusRoles={config.showBonusRoles}
            generated={generatedLabels}
          />
        </div>

        <div class="pt-4 border-t border-outline-variant/10 space-y-4">
          <button
            type="button"
            onclick={() => { showExtras = !showExtras; }}
            class="flex items-center gap-2 text-sm font-medium text-on-surface cursor-pointer"
            aria-expanded={showExtras}
          >
            <Papicon icon={showExtras ? 'chevron-down' : 'chevron-right'} size={16} />
            {m.giv_form_extras_toggle()}
          </button>
          <p class="field-hint -mt-3 ml-6">{m.giv_form_extras_help()}</p>

          {#if showExtras}
            <label class="flex items-center gap-3 text-sm text-on-surface cursor-pointer">
              <input type="checkbox" bind:checked={form.needValidation} class="w-4 h-4 accent-primary cursor-pointer" />
              {m.giv_tpl_validation_label()}
            </label>

            <label class="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" bind:checked={form.ignoreBonuses} class="mt-0.5 w-4 h-4 accent-primary cursor-pointer" />
              <span>
                <span class="block text-sm text-on-surface">{m.giv_field_ignore_bonuses()}</span>
                <span class="block field-hint">{m.giv_field_ignore_bonuses_help()}</span>
              </span>
            </label>

            <div class="pt-4 border-t border-outline-variant/10 space-y-4">
              <label class="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" bind:checked={form.useRewards} class="mt-0.5 w-4 h-4 accent-primary cursor-pointer" />
                <span>
                  <span class="block text-sm text-on-surface">{m.giv_form_rewards_toggle()}</span>
                  <span class="block field-hint">{m.giv_form_rewards_help()}</span>
                </span>
              </label>

              {#if form.useRewards}
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label for="modal-xp" class="field-label">{m.giv_tpl_xp_label()}</label>
                    <input id="modal-xp" type="number" min="0" bind:value={form.rpgXp} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none" />
                  </div>
                  <div>
                    <label for="modal-coins" class="field-label">{m.giv_tpl_coins_label()}</label>
                    <input id="modal-coins" type="number" min="0" bind:value={form.rpgCoins} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none" />
                  </div>
                  <div>
                    <label for="modal-item" class="field-label">{m.giv_tpl_item_label()}</label>
                    <SearchableSelect
                      id="modal-item"
                      bind:value={form.rpgItemId}
                      options={rpgItemOptions}
                      placeholder={m.giv_tpl_item_placeholder()}
                      className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all"
                    />
                  </div>
                </div>
              {/if}
            </div>

            <div class="pt-4 border-t border-outline-variant/10 space-y-4">
              <div>
                <p class="text-sm font-medium text-on-surface">{m.giv_tpl_look_title()}</p>
                <p class="field-hint">{m.giv_tpl_look_help()}</p>
              </div>

              <label class="flex items-center gap-3 text-sm text-on-surface cursor-pointer">
                <input type="checkbox" bind:checked={form.useOwnColor} class="w-4 h-4 accent-primary cursor-pointer" />
                {m.giv_tpl_look_color()}
              </label>

              {#if form.useOwnColor}
                <FormColorPicker bind:value={form.ownColor} />
              {/if}

              <div>
                <label for="modal-image" class="field-label">{m.giv_cfg_image_label()}</label>
                <input
                  id="modal-image"
                  type="url"
                  bind:value={form.ownImageUrl}
                  placeholder="https://"
                  class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
                />
                <p class="field-hint">{m.giv_cfg_image_help()}</p>
              </div>
            </div>
          {/if}
        </div>

        {#if formMode === 'launch'}
          <div class="pt-4 border-t border-outline-variant/10 space-y-3">
            <div>
              <p class="text-sm font-medium text-on-surface">{m.giv_form_save_as_title()}</p>
              <p class="field-hint">{m.giv_form_save_as_help()}</p>
            </div>
            {#if templates.length > 0}
              <div>
                <label for="modal-save-target" class="field-label">{m.giv_form_save_as_target()}</label>
                <select
                  id="modal-save-target"
                  value={saveTargetId}
                  onchange={(e) => {
                    saveTargetId = (e.currentTarget as HTMLSelectElement).value;
                    form.name = templates.find((entry) => entry.id === saveTargetId)?.name ?? '';
                  }}
                  class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none cursor-pointer"
                >
                  <option value="">{m.giv_form_save_as_new()}</option>
                  {#each templates as template (template.id)}
                    <option value={template.id}>{template.name}</option>
                  {/each}
                </select>
              </div>
            {/if}

            <div class="flex flex-col sm:flex-row gap-3 sm:items-center">
              <input
                type="text"
                bind:value={form.name}
                placeholder={defaultTemplateName()}
                aria-label={m.giv_form_save_as_placeholder()}
                class="flex-1 bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
              />
              <button
                type="button"
                onclick={handleSaveTemplate}
                disabled={!form.prize.trim() || !durationIsValid}
                class="flex items-center justify-center gap-2 px-4 py-3 bg-primary/10 hover:bg-primary/20 text-primary font-medium text-xs rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Papicon icon="Copy" size={14} />
                {saveTargetId ? m.giv_form_save_as_update() : m.giv_form_save_as_button()}
              </button>
            </div>
          </div>
        {/if}

        <div class="flex justify-end gap-3 pt-4 border-t border-outline-variant/10">
          <button
            type="button"
            onclick={() => showModal = false}
            class="px-6 py-3 bg-outline-variant/20 hover:bg-outline-variant/30 text-on-surface text-[13px] font-medium rounded-lg transition-all cursor-pointer"
          >
            {m.giv_btn_cancel()}
          </button>
          <button
            type="submit"
            disabled={formMode === 'launch' && (!form.channelId || !durationIsValid)}
            class="px-8 py-3 bg-primary text-on-primary font-medium text-[13px] rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {formMode === 'template' ? m.giv_tpl_save() : m.giv_btn_submit_discord()}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
