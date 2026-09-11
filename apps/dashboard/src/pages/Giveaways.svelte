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
    fetchGiveawayConfigPresets,
    createGiveawayConfigPreset,
    updateGiveawayConfigPreset,
    deleteGiveawayConfigPreset,
    fetchMemberCase,
    type GiveawayAppearance,
    type GiveawayBonusEntry,
    type GiveawayConfigPayload,
    type GiveawayConfigPreset,
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
    // `null` et non `''` : le sélecteur cherchable remet la valeur à `null`
    // quand on vide le champ, et le type doit le dire.
    channelId: null as string | null,
    ignoreBonuses: false,
    needValidation: false,
    /** Fige l'apparence du concours au lieu de suivre celle du serveur. */
    useAppearance: false,
    useRewards: false,
    rpgXp: 0,
    rpgCoins: 0,
    rpgItemId: null as string | null,
  };

  let form = $state({ ...EMPTY_FORM });
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
    return fields.needValidation || fields.ignoreBonuses || fields.useRewards || fields.useAppearance;
  }

  /**
   * Apparence qu'un concours peut figer pour lui seul.
   *
   * Une carte de modèle montrait l'apparence du serveur, et changeait donc
   * d'image dès qu'on touchait à l'onglet Configuration : rien n'attachait un
   * visuel à un modèle. Ces clefs-là partent avec le concours quand on le
   * demande, et recouvrent celles du serveur au moment de publier. Les autres,
   * refus et réponses au clic, restent des règles du serveur.
   */
  const APPEARANCE_KEYS = [
    'embedColorActive',
    'embedColorPending',
    'embedColorEnded',
    'embedColorValidated',
    'titleTemplate',
    'descriptionTemplate',
    'footerTemplate',
    'thumbnailUrl',
    'imageUrl',
    'joinButtonLabel',
    'joinButtonEmoji',
    'joinButtonStyle',
  ] as const satisfies readonly (keyof GiveawayAppearance)[];

  type FormAppearance = Record<(typeof APPEARANCE_KEYS)[number], string>;

  /**
   * Champs d'apparence du formulaire, remplis par le serveur puis recouverts.
   *
   * Une image absente vaut ici la chaîne vide : un champ de saisie ne porte pas
   * `null`, et l'API relit ce vide comme un retrait assumé.
   */
  function styleFieldsFrom(overrides: Partial<GiveawayAppearance> | null | undefined): FormAppearance {
    const merged = { ...config, ...(overrides ?? {}) } as Record<string, unknown>;
    const fields = {} as Record<string, string>;
    for (const key of APPEARANCE_KEYS) fields[key] = (merged[key] as string | null) ?? '';
    return fields as FormAppearance;
  }

  let formStyle = $state<FormAppearance>(styleFieldsFrom(null));

  /** Ce que le concours emporte : son apparence figée, ou rien. */
  function formStyleOverrides(): Partial<GiveawayAppearance> {
    return form.useAppearance ? { ...formStyle } as Partial<GiveawayAppearance> : {};
  }

  /** L'embed tel que le formulaire le publierait, apparence figée comprise. */
  function formPreviewAppearance() {
    return { ...config, ...formStyleOverrides() };
  }

  /**
   * Durée effective du concours, quelle que soit la façon de l'exprimer.
   *
   * « Fin vendredi 20 h » était l'intention courante, et il fallait la convertir
   * en heures de tête. Le formulaire accepte les deux, et l'API ne connaît
   * toujours qu'une durée.
   */
  function durationMinutes(): number {
    if (form.endMode !== 'date') return minutesFrom(form.durationValue, form.durationUnit);
    const target = new Date(form.endsAt).getTime();
    if (!Number.isFinite(target)) return 0;
    // Arrondi au-dessus : un champ date-heure n'a pas les secondes, et arrondir
    // au plus proche faisait perdre une minute à chaque aller-retour entre les
    // deux modes. « Fin à 20 h » ne doit pas non plus se clôturer à 19 h 59.
    return Math.ceil((target - Date.now()) / 60_000);
  }

  /**
   * Même durée, pour l'affichage et la validation.
   *
   * `Date.now()` n'est pas réactif : en mode date, cette valeur vieillit tant
   * que la modale reste ouverte. C'est sans importance pour un aperçu, mais
   * l'envoi rappelle la fonction pour ne pas décaler la fin de ce qu'on a
   * laissé passer entre la saisie et le clic.
   */
  const computedDurationMinutes = $derived.by(() => durationMinutes());

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
      configPresets = (await fetchGiveawayConfigPresets())?.presets ?? [];
      rpgItems = (await fetchGiveawayItems())?.items ?? [];
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  });

  /**
   * Sauvegardes nommées de la configuration.
   *
   * Le serveur n'a qu'une configuration de concours, et l'enregistrement
   * l'écrasait : une apparence de fin d'année remplacée par la suivante était
   * perdue, et y revenir demandait de ressaisir couleurs, gabarits et
   * conditions de mémoire. Chaque enregistrement porte maintenant un nom et
   * laisse en place ceux d'avant, qu'un bouton réapplique.
   */
  let configPresets = $state<GiveawayConfigPreset[]>([]);
  let showConfigSaveModal = $state(false);
  let configPresetName = $state('');
  /** Sauvegarde que l'enregistrement réécrira, vide pour en créer une. */
  let configPresetTargetId = $state('');
  /**
   * Pose aussi un modèle au nom de la configuration.
   *
   * Une configuration enregistrée ne servait qu'à elle-même : pour lancer un
   * concours qui lui ressemble, il fallait la réappliquer au serveur entier. Le
   * modèle jumeau porte son apparence et se lance quand on veut, sans rien
   * changer pour les autres concours.
   */
  let configAsTemplate = $state(true);
  let renamingPresetId = $state<string | null>(null);
  let renamePresetValue = $state('');

  /** Premier « Configuration n » encore libre, proposé d'office dans la modale. */
  function defaultPresetName(): string {
    const taken = new Set(configPresets.map((preset) => preset.name.trim().toLowerCase()));
    let index = 1;
    while (taken.has(m.giv_cfg_preset_default({ n: index }).toLowerCase())) index += 1;
    return m.giv_cfg_preset_default({ n: index });
  }

  /** La plus récente d'abord : on réapplique presque toujours la dernière. */
  function sortedPresets(list: GiveawayConfigPreset[]): GiveawayConfigPreset[] {
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function openConfigSaveModal() {
    if (!canEditConfig) return;
    configPresetTargetId = '';
    configPresetName = defaultPresetName();
    configAsTemplate = true;
    configAction.clearFeedback();
    showConfigSaveModal = true;
  }

  async function handleSaveConfig() {
    if (!canEditConfig) return;
    const target = configPresetTargetId || null;
    const name = configPresetName.trim() || defaultPresetName();
    // Réécrire une sauvegarde sous un autre nom la renomme : son modèle jumeau
    // suit, sinon la galerie garderait l'ancien nom à côté du nouveau.
    const previousName = target
      ? configPresets.find((preset) => preset.id === target)?.name ?? ''
      : '';

    await configAction.run(async () => {
      // Le nom se vérifie avant d'écrire quoi que ce soit : refusé après coup,
      // il laisserait la configuration appliquée sans la sauvegarde promise.
      const clash = configPresets.some((preset) => (
        preset.id !== target && preset.name.trim().toLowerCase() === name.toLowerCase()
      ));
      if (clash) throw new Error(m.giv_cfg_preset_error_name());

      const res = await updateGiveawayConfig({ ...config });
      if (!res || !res.config) throw new Error(m.giv_cfg_error_save());
      adoptConfig(res.config, res.defaults, res.labels);

      // On fige ce que le serveur a réellement écrit, et non ce que le
      // formulaire portait : un gabarit ramené au texte d'usine n'est pas un
      // choix du serveur, et la sauvegarde ne doit pas le rendre définitif.
      const saved = target
        ? await updateGiveawayConfigPreset(target, { name, settings: res.config })
        : await createGiveawayConfigPreset({ name, settings: res.config });
      if (!saved || !saved.preset) throw new Error(m.giv_cfg_error_save());

      configPresets = sortedPresets(target
        ? configPresets.map((preset) => (preset.id === target ? saved.preset : preset))
        : [...configPresets, saved.preset]);

      if (configAsTemplate) {
        if (previousName && previousName.toLowerCase() !== name.toLowerCase()) {
          await renameTwinTemplate(previousName, name);
        }
        await syncTemplateWithConfig(name);
      }
      showConfigSaveModal = false;
      return true;
    }, { successMessage: configAsTemplate ? m.giv_cfg_success_save_template() : m.giv_cfg_success_save() });
  }

  /**
   * Modèle jumeau d'une configuration enregistrée.
   *
   * Il fige l'apparence qu'on vient d'écrire, et rien d'autre : le lot, la
   * durée et les gagnants restent à poser, ici d'office puis au lancement. Un
   * modèle du même nom est mis à jour au lieu d'être doublé, sinon réenregistrer
   * une configuration deux fois en laisserait deux dans la galerie, et
   * l'écraser effacerait le lot déjà saisi dans le premier.
   */
  async function syncTemplateWithConfig(name: string) {
    const existing = templates.find((entry) => entry.name.trim().toLowerCase() === name.toLowerCase());
    const payload = {
      name,
      prize: existing?.prize || m.giv_tpl_config_prize(),
      description: existing?.description ?? null,
      winnerCount: existing?.winnerCount ?? 1,
      durationMinutes: existing?.durationMinutes ?? 1_440,
      channelId: existing?.channelId ?? config.defaultChannelId ?? null,
      rpgXp: existing?.rpgXp ?? 0,
      rpgCoins: existing?.rpgCoins ?? 0,
      rpgItemId: existing?.rpgItemId ?? null,
      needValidation: existing?.needValidation ?? false,
      ignoreBonuses: existing?.ignoreBonuses ?? false,
      // `config` porte déjà les réglages que le serveur vient de renvoyer.
      styleOverrides: styleFieldsFrom(null) as Partial<GiveawayAppearance>,
    };

    const res = existing
      ? await updateGiveawayTemplate(existing.id, payload)
      : await createGiveawayTemplate(payload);
    if (!res || !res.template) throw new Error(m.giv_tpl_error_save());

    templates = (existing
      ? templates.map((entry) => (entry.id === existing.id ? res.template : entry))
      : [...templates, res.template]
    ).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Remet une sauvegarde en place, d'un seul geste.
   *
   * Seuls ses réglages partent : l'API n'écrit que les clefs reçues, donc une
   * sauvegarde écrite avant qu'un réglage existe laisse celui-ci intact au lieu
   * de l'effacer. Le formulaire n'est pas envoyé avec : une modification en
   * cours, jamais enregistrée, n'a pas à partir dans le dos de qui réapplique
   * une sauvegarde.
   */
  async function handleApplyPreset(preset: GiveawayConfigPreset) {
    if (!canEditConfig) return;
    const confirmed = await confirmDialog.ask({
      title: m.giv_cfg_preset_confirm_apply_title({ name: preset.name }),
      description: m.giv_cfg_preset_confirm_apply_desc(),
      confirmLabel: m.giv_cfg_preset_apply(),
      variant: 'warning',
    });
    if (!confirmed) return;

    await configAction.run(async () => {
      const res = await updateGiveawayConfig({ ...preset.settings });
      if (!res || !res.config) throw new Error(m.giv_cfg_error_save());
      adoptConfig(res.config, res.defaults, res.labels);
      return true;
    }, { successMessage: m.giv_cfg_preset_success_apply({ name: preset.name }) });
  }

  function startPresetRename(preset: GiveawayConfigPreset) {
    renamingPresetId = preset.id;
    renamePresetValue = preset.name;
  }

  /** Renomme sans toucher aux réglages figés : l'API les laisse en place. */
  async function handleRenamePreset(preset: GiveawayConfigPreset) {
    const name = renamePresetValue.trim();
    if (!canEditConfig || !name) return;
    if (name === preset.name) {
      renamingPresetId = null;
      return;
    }

    await configAction.run(async () => {
      const res = await updateGiveawayConfigPreset(preset.id, { name });
      if (!res || !res.preset) throw new Error(m.giv_cfg_error_save());
      configPresets = sortedPresets(configPresets.map((entry) => (entry.id === preset.id ? res.preset : entry)));
      await renameTwinTemplate(preset.name, name);
      renamingPresetId = null;
      return true;
    }, { successMessage: m.giv_cfg_preset_success_rename() });
  }

  /**
   * Suit le nom de la sauvegarde sur son modèle jumeau.
   *
   * Sans cela, renommer une sauvegarde laissait dans la galerie un modèle au
   * nom d'avant, sans plus rien qui les relie. On s'abstient quand un autre
   * modèle porte déjà le nouveau nom : l'API le refuserait, et la sauvegarde,
   * elle, est déjà renommée.
   */
  async function renameTwinTemplate(previousName: string, name: string) {
    const twin = templates.find((entry) => entry.name.trim().toLowerCase() === previousName.trim().toLowerCase());
    if (!twin) return;
    const taken = templates.some((entry) => (
      entry.id !== twin.id && entry.name.trim().toLowerCase() === name.toLowerCase()
    ));
    if (taken) return;

    const { id: _id, guildId: _guildId, ...fields } = twin;
    const res = await updateGiveawayTemplate(twin.id, { ...fields, name });
    if (!res || !res.template) return;
    templates = templates
      .map((entry) => (entry.id === twin.id ? res.template : entry))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function handleDeletePreset(presetId: string) {
    if (!canEditConfig) return;
    if (!(await confirmDialog.danger(m.giv_cfg_preset_confirm_delete_title(), m.giv_cfg_preset_confirm_delete_desc()))) return;
    await configAction.run(async () => {
      const ok = await deleteGiveawayConfigPreset(presetId);
      if (!ok) throw new Error(m.giv_cfg_preset_error_delete());
      configPresets = configPresets.filter((preset) => preset.id !== presetId);
      if (configPresetTargetId === presetId) configPresetTargetId = '';
      return true;
    }, { successMessage: m.giv_cfg_preset_success_delete() });
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
      // Le lot d'attente d'un modèle né d'une configuration n'est pas un lot :
      // le recopier dans le formulaire obligerait à l'effacer avant d'écrire.
      prize: template.prize === m.giv_tpl_config_prize() ? '' : template.prize,
      description: template.description ?? '',
      winnerCount: template.winnerCount,
      durationValue: duration.durationValue,
      durationUnit: duration.durationUnit,
      endMode: 'duration',
      endsAt: '',
      channelId: template.channelId ?? null,
      ignoreBonuses: template.ignoreBonuses ?? false,
      needValidation: template.needValidation ?? false,
      useAppearance: Object.keys(template.styleOverrides ?? {}).length > 0,
      useRewards: (template.rpgXp ?? 0) > 0 || (template.rpgCoins ?? 0) > 0 || !!template.rpgItemId,
      rpgXp: template.rpgXp ?? 0,
      rpgCoins: template.rpgCoins ?? 0,
      rpgItemId: template.rpgItemId ?? null,
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
    return { rpgXp: form.rpgXp, rpgCoins: form.rpgCoins, rpgItemId: (form.rpgItemId ?? '').trim() };
  }

  /**
   * Venu de la galerie, on cherche à mettre des réglages de côté, pas à
   * publier. Le formulaire reste le même, mais sa section d'enregistrement
   * passe sous les yeux et garde un liseré : sans cela, le premier bouton
   * rencontré est « Envoyer sur Discord », qui n'est pas ce qu'on venait faire.
   */
  let saveIntent = $state(false);
  let saveSection = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!showModal || !saveIntent || !saveSection) return;
    saveSection.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  /**
   * Formulaire de lancement, vierge hormis le salon que le serveur propose.
   *
   * Il n'en existe plus qu'un. L'onglet Modèles ouvrait le même jeu de champs
   * sous un autre titre, avec pour seul écart un champ nom en haut et un bouton
   * qui enregistrait au lieu d'envoyer : « Réutiliser ce concours » fait déjà
   * les deux, et son enregistrement ne réclame pas de salon.
   */
  function openCreateModal() {
    formTemplateId = '';
    saveTargetId = '';
    saveIntent = false;
    form = { ...EMPTY_FORM, channelId: config.defaultChannelId };
    formStyle = styleFieldsFrom(null);
    showExtras = false;
    actionState.clearFeedback();
    showModal = true;
  }

  /** Depuis la galerie : on repart sur l'onglet qui porte le formulaire. */
  function startBlankFromTemplates() {
    openCreateModal();
    saveIntent = true;
    gotoTab('/giveaways', 'concours', DEFAULT_TAB);
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
    formStyle = styleFieldsFrom(template?.styleOverrides ?? null);
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

  async function handleSaveTemplate() {
    if (!canManageSettings || !form.prize.trim()) return;
    /** Modèle que l'enregistrement écrase, `null` quand il en crée un. */
    const target = saveTargetId || null;
    const name = form.name.trim() || defaultTemplateName();
    const rewards = formRewards();
    const payload = {
      name,
      prize: form.prize.trim(),
      description: form.description.trim() || null,
      winnerCount: form.winnerCount,
      durationMinutes: durationMinutes(),
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
      // La modale reste ouverte, le concours n'étant pas encore parti, et le
      // modèle qu'on vient d'écrire devient la cible : un second clic le corrige
      // au lieu d'en créer un homonyme, que l'API refuserait.
      saveTargetId = res.template.id;
      form.name = res.template.name;
      return true;
    }, { successMessage: target ? m.giv_tpl_success_update() : m.giv_tpl_success_create() });
  }

  /** Durée d'un modèle, dans l'unité où elle a été saisie. */
  function durationLabel(minutes: number): string {
    const { durationValue, durationUnit } = splitDuration(minutes);
    if (durationUnit === 'days') return m.e8_giveaways_duration_days({ days: durationValue });
    if (durationUnit === 'hours') return m.e8_giveaways_duration_hours({ hours: durationValue });
    return m.e8_giveaways_duration_min({ minutes: durationValue });
  }

  /**
   * Modèle dont l'aperçu est déplié dans la liste.
   *
   * La galerie montrait l'annonce entière de chaque modèle : une image de
   * concours fait plusieurs centaines de pixels de haut, et trois modèles
   * suffisaient à ce qu'on ne puisse plus les voir ensemble. La liste ne garde
   * que ce qui les distingue, et l'annonce se déplie à la demande. Un seul à la
   * fois : deux aperçus ouverts ramènent le défilement qu'on voulait éviter.
   */
  let expandedTemplateId = $state<string | null>(null);

  function toggleTemplatePreview(templateId: string) {
    expandedTemplateId = expandedTemplateId === templateId ? null : templateId;
  }

  /**
   * Envoie un modèle tel quel, sans repasser par le formulaire.
   *
   * Un modèle existe pour n'avoir plus rien à saisir, et « Lancer depuis ce
   * modèle » rouvrait pourtant dix champs déjà remplis. Le formulaire reste à
   * côté pour ajuster avant l'envoi, et reprend la main quand le modèle n'a pas
   * de salon : l'API en exige un, et le choisir est le seul geste qui manque.
   */
  async function handlePublishTemplate(template: GiveawayTemplate) {
    if (!canManageSettings) return;
    const channelId = template.channelId;
    if (!channelId) {
      startFromTemplate(template);
      actionState.setError(m.giv_tpl_publish_no_channel());
      return;
    }

    const confirmed = await confirmDialog.ask({
      title: m.giv_tpl_publish_confirm_title({ name: template.name }),
      description: m.giv_tpl_publish_confirm_desc({
        prize: template.prize,
        channel: getChannelName(channelId),
        duration: durationLabel(template.durationMinutes),
      }),
      confirmLabel: m.giv_tpl_publish(),
      variant: 'warning',
    });
    if (!confirmed) return;

    await actionState.run(async () => {
      const res = await createGiveaway({
        prize: template.prize,
        description: template.description ?? '',
        winnerCount: template.winnerCount,
        durationMinutes: template.durationMinutes,
        channelId,
        ignoreBonuses: template.ignoreBonuses ?? false,
        rpgXp: template.rpgXp ?? 0,
        rpgCoins: template.rpgCoins ?? 0,
        // Le modèle garde `null` pour « aucun objet », l'API du lancement lit
        // une chaîne vide.
        rpgItemId: template.rpgItemId ?? '',
        needValidation: template.needValidation ?? false,
        styleOverrides: template.styleOverrides ?? {},
      });
      if (!res || !res.giveaway) throw new Error(m.e8_giveaways_error_create());
      giveaways = [res.giveaway, ...giveaways];
      // Le concours parti, ce qu'on veut voir est la liste des concours.
      gotoTab('/giveaways', 'concours', DEFAULT_TAB);
      return true;
    }, { successMessage: m.e8_giveaways_success_create() });
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
    const channelId = form.channelId;
    if (!canManageSettings || !form.prize.trim() || !form.winnerCount || !durationIsValid || !channelId) return;
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
        durationMinutes: durationMinutes(),
        channelId,
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
          onclick={startBlankFromTemplates}
          class="flex items-center justify-center gap-2 px-5 py-3 bg-primary text-on-primary text-[13px] font-medium rounded-lg transition-all cursor-pointer"
        >
          <Papicon icon="Sparkles" size={14} />
          {m.giv_btn_create()}
        </button>
      </div>

      {#if templates.length === 0}
        <div class="flex flex-col items-center justify-center py-20 bg-surface-container-low/20 border border-outline-variant/10 rounded-xl text-center">
          <Papicon icon="Copy" size={32} class="text-on-surface-variant/20 mb-3" />
          <p class="text-sm text-on-surface-variant/60 font-medium">{m.giv_tpl_empty()}</p>
          <button
            onclick={startBlankFromTemplates}
            class="mt-4 flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-xs rounded-lg transition-all cursor-pointer"
          >
            <Papicon icon="Sparkles" size={14} /> {m.giv_btn_create()}
          </button>
        </div>
      {:else}
        <div class="space-y-2">
          {#each templates as template (template.id)}
            <div class="bg-surface-container-low/30 border border-outline-variant/10 rounded-xl">
              <div class="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                <button
                  type="button"
                  onclick={() => toggleTemplatePreview(template.id)}
                  aria-expanded={expandedTemplateId === template.id}
                  class="shrink-0 self-start sm:self-center p-2 rounded-lg bg-surface-container-high/40 hover:bg-primary/15 hover:text-primary text-on-surface-variant transition-colors cursor-pointer"
                  title={m.giv_tpl_preview_toggle()}
                >
                  <Papicon icon={expandedTemplateId === template.id ? 'chevron-down' : 'chevron-right'} size={14} />
                </button>

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
                    <p class="text-xs text-on-surface-variant/70 truncate">{template.prize}</p>
                  {/if}

                  <!-- Ce que l'annonce ne dit pas : où elle part, et comment on tire. -->
                  <div class="flex flex-wrap items-center gap-2 mt-2 text-[11px] font-medium text-on-surface-variant/70">
                    <span class="px-2 py-1 rounded-lg bg-surface-container-high/40">{durationLabel(template.durationMinutes)}</span>
                    <span class="px-2 py-1 rounded-lg bg-surface-container-high/40">{m.giv_winners_count({ count: template.winnerCount })}</span>
                    {#if template.channelId}
                      <span class="px-2 py-1 rounded-lg bg-surface-container-high/40">{getChannelName(template.channelId)}</span>
                    {:else}
                      <span class="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-600">{m.giv_tpl_badge_no_channel()}</span>
                    {/if}
                    {#if template.ignoreBonuses}
                      <span class="px-2 py-1 rounded-lg bg-surface-container-high/40">{m.giv_tpl_badge_no_bonus()}</span>
                    {/if}
                    {#if Object.keys(template.styleOverrides ?? {}).length > 0}
                      <span class="px-2 py-1 rounded-lg bg-surface-container-high/40">{m.giv_tpl_badge_own_style()}</span>
                    {/if}
                  </div>
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
                    <!--
                      Le formulaire prérempli passe devant l'envoi direct : le
                      lot, la durée et le salon se règlent presque toujours au
                      moment de lancer, et un bouton qui part sans rien demander
                      ne sert que le jour où un modèle est déjà prêt tel quel.
                    -->
                    <button
                      onclick={() => startFromTemplate(template)}
                      class="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-medium text-xs transition-all cursor-pointer"
                      title={m.giv_tpl_use()}
                    >
                      <Papicon icon="Sparkles" size={14} />
                      {m.giv_tpl_launch()}
                    </button>
                    <button
                      onclick={() => handlePublishTemplate(template)}
                      disabled={actionState.state.loading}
                      class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-primary/15 hover:text-primary text-on-surface-variant transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      title={m.giv_tpl_publish_now()}
                    >
                      <Papicon icon="PaperPlaneTilt" size={14} />
                    </button>
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

              {#if expandedTemplateId === template.id}
                <div class="px-4 pb-4">
                  <GiveawayPreview
                    compact
                    appearance={templateAppearance(template)}
                    overrides={templateSample(template)}
                    bonusRoles={template.ignoreBonuses ? [] : previewBonusRoles}
                    showBonusRoles={config.showBonusRoles}
                    generated={generatedLabels}
                  />
                </div>
              {/if}
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

      <SectionCard
        title={m.giv_cfg_presets_title()}
        description={m.giv_cfg_presets_desc()}
      >
        {#if configPresets.length === 0}
          <p class="text-xs text-on-surface-variant/60">{m.giv_cfg_presets_empty()}</p>
        {:else}
          <div class="space-y-2">
            {#each configPresets as preset (preset.id)}
              <div class="flex items-center gap-3 bg-surface-container-high/35 border border-outline-variant/10 rounded-lg px-4 py-3">
                <div class="min-w-0 flex-1">
                  {#if renamingPresetId === preset.id}
                    <input
                      type="text"
                      bind:value={renamePresetValue}
                      aria-label={m.giv_cfg_preset_rename()}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleRenamePreset(preset); }
                        if (e.key === 'Escape') renamingPresetId = null;
                      }}
                      class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-1.5 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none"
                    />
                  {:else}
                    <p class="text-sm font-semibold text-on-surface truncate">{preset.name}</p>
                    <p class="text-[11px] text-on-surface-variant/60">
                      {m.giv_cfg_preset_saved_at({ date: formatDate(preset.updatedAt) })}
                    </p>
                  {/if}
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  {#if renamingPresetId === preset.id}
                    <button
                      onclick={() => handleRenamePreset(preset)}
                      class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-primary/15 hover:text-primary text-on-surface-variant transition-colors cursor-pointer"
                      title={m.giv_cfg_preset_rename_confirm()}
                    >
                      <Papicon icon="Check" size={14} />
                    </button>
                    <button
                      onclick={() => { renamingPresetId = null; }}
                      class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-rose-500/15 hover:text-rose-500 text-on-surface-variant transition-colors cursor-pointer"
                      title={m.giv_cfg_preset_rename_cancel()}
                    >
                      <Papicon icon="Cross" size={14} />
                    </button>
                  {:else}
                    <button
                      onclick={() => handleApplyPreset(preset)}
                      disabled={configAction.state.loading}
                      class="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-medium text-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Papicon icon="Refresh" size={14} />
                      {m.giv_cfg_preset_apply()}
                    </button>
                    <button
                      onclick={() => startPresetRename(preset)}
                      class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-primary/15 hover:text-primary text-on-surface-variant transition-colors cursor-pointer"
                      title={m.giv_cfg_preset_rename()}
                    >
                      <Papicon icon="Pencil" size={14} />
                    </button>
                    <button
                      onclick={() => handleDeletePreset(preset.id)}
                      class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-rose-500/15 hover:text-rose-500 text-on-surface-variant transition-colors cursor-pointer"
                      title={m.giv_cfg_preset_delete()}
                    >
                      <Papicon icon="Trash" size={14} />
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </SectionCard>

      <div class="flex justify-end">
        <button
          onclick={openConfigSaveModal}
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
          <Papicon icon="Sparkles" size={24} />
        </div>
        <div>
          <h3 class="text-2xl font-semibold tracking-tight">
            {m.giv_modal_title()}
          </h3>
          <p class="text-xs text-on-surface-variant/80 font-medium">
            {m.giv_modal_subtitle()}
          </p>
        </div>
      </div>

      <form
        onsubmit={(e) => { e.preventDefault(); handleCreate(); }}
        class="space-y-5 pt-2"
      >
        {#if templates.length > 0}
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

            {#if form.endMode === 'date'}
              <input
                id="modal-ends-at"
                type="datetime-local"
                bind:value={form.endsAt}
                aria-label={m.giv_field_end_at_label()}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none"
                required
              />
              {#if durationIsValid}
                <p class="field-hint">{m.giv_field_end_at_help()}</p>
              {:else}
                <p class="field-hint text-rose-500">{m.giv_field_end_at_invalid()}</p>
              {/if}
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
            {m.giv_field_channel_label()}
          </label>
          <SearchableSelect
            id="modal-channel"
            bind:value={form.channelId}
            options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))}
            placeholder={m.giv_select_channel_placeholder()}
            className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all"
          />
        </div>

        <div class="pt-4 border-t border-outline-variant/10 space-y-3">
          <p class="text-sm font-medium text-on-surface">{m.giv_preview_title()}</p>
          <GiveawayPreview
            compact
            appearance={formPreviewAppearance()}
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
                      showId={false}
                      placeholder={m.giv_tpl_item_placeholder()}
                      className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all"
                    />
                  </div>
                </div>
              {/if}
            </div>

            <div class="pt-4 border-t border-outline-variant/10 space-y-4">
              <label class="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" bind:checked={form.useAppearance} class="mt-0.5 w-4 h-4 accent-primary cursor-pointer" />
                <span>
                  <span class="block text-sm text-on-surface">{m.giv_form_style_toggle()}</span>
                  <span class="block field-hint">{m.giv_form_style_help()}</span>
                </span>
              </label>

              {#if form.useAppearance}
                <div class="flex justify-end">
                  <button
                    type="button"
                    onclick={() => { formStyle = styleFieldsFrom(null); }}
                    class="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-high/40 hover:bg-primary/15 hover:text-primary text-on-surface-variant text-xs font-medium transition-colors cursor-pointer"
                  >
                    <Papicon icon="Refresh" size={14} />
                    {m.giv_form_style_reset()}
                  </button>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div class="flex items-center justify-between gap-4 p-3 bg-surface-container rounded-lg border border-outline-variant">
                    <p class="text-sm font-medium text-on-surface">{m.giv_cfg_color_active()}</p>
                    <FormColorPicker bind:value={formStyle.embedColorActive} />
                  </div>
                  <div class="flex items-center justify-between gap-4 p-3 bg-surface-container rounded-lg border border-outline-variant">
                    <p class="text-sm font-medium text-on-surface">{m.giv_cfg_color_pending()}</p>
                    <FormColorPicker bind:value={formStyle.embedColorPending} />
                  </div>
                  <div class="flex items-center justify-between gap-4 p-3 bg-surface-container rounded-lg border border-outline-variant">
                    <p class="text-sm font-medium text-on-surface">{m.giv_cfg_color_ended()}</p>
                    <FormColorPicker bind:value={formStyle.embedColorEnded} />
                  </div>
                  <div class="flex items-center justify-between gap-4 p-3 bg-surface-container rounded-lg border border-outline-variant">
                    <p class="text-sm font-medium text-on-surface">{m.giv_cfg_color_validated()}</p>
                    <FormColorPicker bind:value={formStyle.embedColorValidated} />
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <MacroTextField
                    id="modal-style-title"
                    label={m.giv_cfg_title_label()}
                    bind:value={formStyle.titleTemplate}
                    macros={commonMacros}
                    defaultValue={config.titleTemplate}
                  />
                  <MacroTextField
                    id="modal-style-footer"
                    label={m.giv_cfg_footer_label()}
                    bind:value={formStyle.footerTemplate}
                    macros={commonMacros}
                    defaultValue={config.footerTemplate}
                  />
                  <div class="sm:col-span-2">
                    <MacroTextField
                      id="modal-style-description"
                      label={m.giv_cfg_description_label()}
                      bind:value={formStyle.descriptionTemplate}
                      macros={bodyMacros}
                      defaultValue={config.descriptionTemplate}
                      multiline
                      rows={5}
                    />
                  </div>
                  <div>
                    <label for="modal-style-thumbnail" class="field-label">{m.giv_cfg_thumbnail_label()}</label>
                    <input id="modal-style-thumbnail" type="url" bind:value={formStyle.thumbnailUrl} placeholder="https://" class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none" />
                  </div>
                  <div>
                    <label for="modal-style-image" class="field-label">{m.giv_cfg_image_label()}</label>
                    <input id="modal-style-image" type="url" bind:value={formStyle.imageUrl} placeholder="https://" class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none" />
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label for="modal-style-button-label" class="field-label">{m.giv_cfg_button_label()}</label>
                    <input id="modal-style-button-label" type="text" maxlength="80" bind:value={formStyle.joinButtonLabel} class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all text-on-surface focus:outline-none" />
                  </div>
                  <div>
                    <span class="field-label">{m.giv_cfg_button_emoji()}</span>
                    <div class="flex items-center gap-2">
                      <EmojiPicker bind:value={formStyle.joinButtonEmoji} />
                      {#if formStyle.joinButtonEmoji}
                        <button
                          type="button"
                          onclick={() => { formStyle.joinButtonEmoji = ''; }}
                          class="p-2 rounded-lg bg-surface-container-high/40 hover:bg-rose-500/15 hover:text-rose-500 text-on-surface-variant transition-colors cursor-pointer"
                          title={m.giv_cfg_button_emoji_clear()}
                        >
                          <Papicon icon="Cross" size={14} />
                        </button>
                      {/if}
                    </div>
                  </div>
                  <div>
                    <label for="modal-style-button-style" class="field-label">{m.giv_cfg_button_style()}</label>
                    <select
                      id="modal-style-button-style"
                      bind:value={formStyle.joinButtonStyle}
                      class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none cursor-pointer"
                    >
                      {#each buttonStyles as style}
                        <option value={style}>{buttonStyleLabel(style)}</option>
                      {/each}
                    </select>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div
          bind:this={saveSection}
          class={saveIntent
            ? 'rounded-xl ring-2 ring-primary/30 p-4 space-y-3'
            : 'pt-4 border-t border-outline-variant/10 space-y-3'}
        >
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
            disabled={!form.channelId || !durationIsValid}
            class="px-8 py-3 bg-primary text-on-primary font-medium text-[13px] rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {m.giv_btn_submit_discord()}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Enregistrer la configuration : le nom sous lequel on la retrouvera -->
{#if showConfigSaveModal}
  <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" transition:fade={{ duration: 150 }}>
    <div class="bg-surface-container-low/95 border border-outline-variant/20 max-w-lg w-full rounded-xl p-8 space-y-6 shadow-sm relative" transition:scale={{ start: 0.97, duration: 150 }}>
      <button
        onclick={() => showConfigSaveModal = false}
        class="absolute top-6 right-6 p-2 rounded-full bg-surface-container-high/40 hover:bg-rose-500/15 hover:text-rose-500 text-on-surface-variant transition-colors cursor-pointer"
        title={m.giv_modal_close_title()}
      >
        <Papicon icon="Cross" size={20} />
      </button>

      <div class="flex items-center gap-4">
        <div class="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center text-primary shadow-inner">
          <Papicon icon="Save" size={24} />
        </div>
        <div>
          <h3 class="text-2xl font-semibold tracking-tight">{m.giv_cfg_save_modal_title()}</h3>
          <p class="text-xs text-on-surface-variant/80 font-medium">{m.giv_cfg_save_modal_desc()}</p>
        </div>
      </div>

      <form
        onsubmit={(e) => { e.preventDefault(); handleSaveConfig(); }}
        class="space-y-5"
      >
        <InlineFeedback state={configAction} />

        {#if configPresets.length > 0}
          <div>
            <label for="config-preset-target" class="field-label">{m.giv_cfg_preset_target_label()}</label>
            <select
              id="config-preset-target"
              value={configPresetTargetId}
              onchange={(e) => {
                configPresetTargetId = (e.currentTarget as HTMLSelectElement).value;
                configPresetName = configPresets.find((preset) => preset.id === configPresetTargetId)?.name
                  ?? defaultPresetName();
              }}
              class="w-full bg-surface-container-high/45 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none cursor-pointer"
            >
              <option value="">{m.giv_cfg_preset_target_new()}</option>
              {#each configPresets as preset (preset.id)}
                <option value={preset.id}>{preset.name}</option>
              {/each}
            </select>
          </div>
        {/if}

        <div>
          <label for="config-preset-name" class="field-label">{m.giv_cfg_preset_name_label()}</label>
          <input
            id="config-preset-name"
            type="text"
            bind:value={configPresetName}
            placeholder={defaultPresetName()}
            class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-4 py-3 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 transition-all focus:outline-none"
          />
        </div>

        <label class="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" bind:checked={configAsTemplate} class="mt-0.5 w-4 h-4 accent-primary cursor-pointer" />
          <span>
            <span class="block text-sm text-on-surface">{m.giv_cfg_save_template_toggle()}</span>
            <span class="block field-hint">{m.giv_cfg_save_template_help()}</span>
          </span>
        </label>

        <div class="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onclick={() => showConfigSaveModal = false}
            class="px-6 py-3 bg-outline-variant/20 hover:bg-outline-variant/30 text-on-surface text-[13px] font-medium rounded-lg transition-all cursor-pointer"
          >
            {m.giv_btn_cancel()}
          </button>
          <button
            type="submit"
            disabled={configAction.state.loading}
            class="px-8 py-3 bg-primary text-on-primary font-medium text-[13px] rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {configAction.state.loading ? m.giv_cfg_saving() : m.giv_cfg_save_confirm()}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
