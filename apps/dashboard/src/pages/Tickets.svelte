<script lang="ts">
  import { m } from '../lib/i18n';
  import { canViewFeature } from '../lib/permissions.svelte';
  import { channelDisplayName } from '../lib/channelUtils';
  import { onMount, onDestroy, untrack } from 'svelte';
  import { router } from 'tinro';
  import { resolveTabFromUrl, gotoTab } from '../lib/tabRouting';
  import { guide } from '../lib/stores/guide.svelte';
  import { pageTabItems } from '../lib/config/pageTabs';
  import { Callout, Tabs } from '../lib/components/ui';
  import { authStore } from '../lib/stores/auth.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { isMissingReference } from '../lib/discordReferences';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { useUnsavedChanges } from '../lib/useUnsavedChanges.svelte';
  import { unsavedChanges } from '../lib/stores/unsavedChanges.svelte';
  import { subscribeRealtime } from '../lib/stores/realtime.svelte';
  import {
    fetchMemberCase,
    runMemberCaseAction,
    fetchStaffServerChannels, dashboardFetch } from '../lib/api';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import RefreshButton from '../lib/components/RefreshButton.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import FormInput from '../lib/components/FormInput.svelte';
  import FormTextarea from '../lib/components/FormTextarea.svelte';
  import FormSelect from '../lib/components/FormSelect.svelte';
  import MultiSelect from '../lib/components/MultiSelect.svelte';
  import FormColorPicker from '../lib/components/FormColorPicker.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';

  import { errorMessage } from '@kotbo/shared';
  import TicketInboxList from '../lib/components/tickets/TicketInboxList.svelte';
  import TicketProperties from '../lib/components/tickets/TicketProperties.svelte';
  import TicketPerformance from '../lib/components/tickets/TicketPerformance.svelte';
  import TicketBlacklist from '../lib/components/tickets/TicketBlacklist.svelte';
  import TicketTranscripts from '../lib/components/tickets/TicketTranscripts.svelte';
  import TicketSatisfactionTab from '../lib/components/tickets/TicketSatisfactionTab.svelte';
  import TicketMacros from '../lib/components/tickets/TicketMacros.svelte';
  import type { InboxTicket, InboxView } from '../lib/api';
  import { resolveUserAvatarSrc } from '../lib/discordMedia';
  // Navigation & Tabs
  const ticketsTabs = ['tickets', 'performance', 'transcripts', 'satisfaction', 'macros', 'blacklist', 'config'] as const;
  const DEFAULT_TICKETS_TAB = 'tickets';
  let activeTab = $state<'tickets' | 'performance' | 'transcripts' | 'satisfaction' | 'macros' | 'blacklist' | 'config'>(DEFAULT_TICKETS_TAB);

  $effect(() => {
    const _path = $router.path;
    activeTab = resolveTabFromUrl('/tickets', ticketsTabs, DEFAULT_TICKETS_TAB) as typeof activeTab;
  });

  const TICKETS_PAGE_SIZE = 75;
  let ticketsOffset = $state(0);
  let ticketsHasMore = $state(false);
  let loadingMoreTickets = $state(false);

  // Centre de support : la file affichée est une vue (non attribués, mes
  // tickets, en attente du staff...), plus un simple filtre de statut.
  let inboxView = $state<InboxView>('open');
  let inboxQuery = $state('');
  let inboxSort = $state<'newest' | 'oldest'>('newest');
  let viewCounts = $state<Partial<Record<InboxView, number>>>({});

  function inboxParams(params: URLSearchParams) {
    params.set('view', inboxView);
    params.set('sort', inboxSort);
    if (inboxQuery) params.set('q', inboxQuery);
  }

  function changeInbox(patch: { view?: InboxView; query?: string; sort?: 'newest' | 'oldest' }) {
    if (patch.view !== undefined) inboxView = patch.view;
    if (patch.query !== undefined) inboxQuery = patch.query;
    if (patch.sort !== undefined) inboxSort = patch.sort;
    void loadTicketsAndConfig(true);
  }
  
  // Data State
  let tickets = $state<any[]>([]);
  let config = $state<any>({});
  let selectedTicketId = $state<string | null>(null);
  let selectedTicketDetail = $state<any>(null);
  let messages = $state<any[]>([]);
  
  // Loading & Error State
  let loading = $state(true);
  let loadingDetail = $state(false);
  let error = $state('');
  
  // Forms & Actions State
  let chatInput = $state('');
  let closeReason = $state('');
  let ticketRenameName = $state('');
  let showCloseModal = $state(false);
  let showDeleteConfirmModal = $state(false);
  let chatScrollContainer = $state<HTMLDivElement | null>(null);
  let unsubscribeRealtime: (() => void) | null = null;
  
  // Configuration Bindings
  let ticketCategoryId = $state('');
  let ticketLogChannelId = $state('');
  let ticketStaffRoleId = $state('');
  let ticketChannelId = $state('');
  let ticketEmbedTitle = $state('');
  let ticketEmbedDesc = $state('');
  let ticketEmbedButtonText = $state('');
  let ticketEmbedColor = $state('');
  let ticketEmbedType = $state<'BUTTONS' | 'DROPDOWN'>('BUTTONS');
  let ticketMode = $state<'CHANNEL' | 'DM' | 'THREAD'>('CHANNEL');
  let ticketDmRelayChannelId = $state('');
  let ticketAllowOverclaim = $state(true);
  let ticketOverclaimPermission = $state('ANY');
  let ticketAutoClaimOnReply = $state(false);
  let ticketInactivityEnabled = $state(false);
  let ticketInactivityHours = $state(24);
  let ticketInactivityMessage = $state('');
  let ticketSatisfactionCommentEnabled = $state(true);
  let ticketSatisfactionCommentQuestion = $state('');
  let ticketSatisfactionCommentTimeout = $state(120);
  let ticketSatisfactionLogChannelId = $state('');
  let ticketSatisfactionLogAnonymous = $state(false);
  let ticketLockUntilClaim = $state(false);
  let ticketApprovalEnabled = $state(false);
  let ticketApprovalChannelId = $state('');
  let ticketArchiveCategoryId = $state('');
  let ticketArchiveKeepOpenerView = $state(false);
  let ticketHistoryPanelEnabled = $state(true);
  let ticketSelfReopenEnabled = $state(true);
  let ticketSelfDeleteEnabled = $state(false);
  // ── Quotas tickets : chaque interrupteur commande, la valeur est un seuil.
  let ticketQuotaOpenEnabled = $state(false);
  let ticketQuotaOpenMax = $state(1);
  let ticketQuotaCooldownEnabled = $state(false);
  let ticketQuotaCooldownMinutes = $state(30);
  let ticketQuotaPeriodEnabled = $state(false);
  let ticketQuotaPeriodMax = $state(5);
  let ticketQuotaPeriodHours = $state(24);
  let ticketQuotaStaffLoadMode = $state('OFF');
  let ticketQuotaStaffLoadMax = $state(5);
  let ticketQuotaStaffLoadBypassRoleIds = $state([] as string[]);
  let ticketQuotaReopenEnabled = $state(false);
  let ticketQuotaReopenMax = $state(3);
  // Objectifs de service, en minutes et en heures ; vide = pas d'objectif.
  let ticketSlaFirstResponseMinutes = $state<number | null>(null);
  let ticketSlaResolutionHours = $state<number | null>(null);
  let ticketEmbedThumbnail = $state('');
  let ticketEmbedImage = $state('');
  let ticketEmbedFooter = $state('');
  let ticketEmbedAuthorName = $state('');
  let ticketEmbedAuthorIcon = $state('');
  let ticketWelcomeTitle = $state('');
  let ticketWelcomeDesc = $state('');
  let ticketWelcomeColor = $state('');
  let ticketWelcomeThumbnail = $state('');
  let ticketWelcomeImage = $state('');
  let ticketWelcomeFooter = $state('');
  let ticketTypes = $state<Array<{
    id: string;
    label: string;
    description: string;
    emoji: string;
    categoryId: string;
    staffRoleId: string;
    buttonStyle: 'PRIMARY' | 'SECONDARY' | 'SUCCESS' | 'DANGER';
    mode: '' | 'CHANNEL' | 'DM' | 'THREAD';
    anonymous: boolean;
    staffServerRelay: boolean;
    staffServerChannel: boolean;
    staffServerCategoryId: string;
    /** Tri-etat : '' herite du serveur, 'YES'/'NO' tranchent pour ce type. */
    lockUntilClaim: '' | 'YES' | 'NO';
    requireApproval: '' | 'YES' | 'NO';
    formEnabled: boolean;
    formCustomFields: Array<{
      id: string;
      label: string;
      placeholder: string;
      style: 'SHORT' | 'PARAGRAPH' | 'SELECT' | 'RADIO' | 'FILE';
      required: boolean;
      choices?: string[];
      choicesString?: string;
    }>;
  }>>([]);

  // Config sections accordion
  let expandedConfigSection = $state<string | null>('mode');
  let expandedTicketTypeIndex = $state<number | null>(null);
  let showMobileChat = $state(false);

  function toggleConfigSection(section: string) {
    expandedConfigSection = expandedConfigSection === section ? null : section;
  }

  // « Me guider » depuis l'accueil vise un reglage range dans une section
  // repliee : on la deplie pour que le champ soit visible sous la mise en
  // evidence.
  const GUIDED_SECTIONS: Record<string, string> = {
    'tickets-channels': 'channels',
    'tickets-quotas': 'quotas',
  };
  $effect(() => {
    const section = guide.target ? GUIDED_SECTIONS[guide.target] : undefined;
    if (section) untrack(() => (expandedConfigSection = section));
  });

  // Member Case Modal Integration
  let caseModalOpen = $state(false);
  let selectedCaseUser = $state<{ name: string; id: string | null } | null>(null);
  let selectedCaseData = $state<any>(null);
  let selectedCaseLoading = $state(false);
  let selectedCaseError = $state('');
  let memberActionReason = $state(m.e1_tickets_member_action_default_reason());
  let memberActionDuration = $state('30m');
  let memberActionBusy = $state(false);
  let memberActionFeedback = $state('');
  let memberActionIsError = $state(false);

  let savedSettingsConfig = $state<any>(null);

  const currentSettings = $derived({
    ticketCategoryId,
    ticketLogChannelId,
    ticketStaffRoleId,
    ticketChannelId,
    ticketEmbedTitle,
    ticketEmbedDesc,
    ticketEmbedButtonText,
    ticketEmbedColor,
    ticketEmbedType,
    ticketMode,
    ticketDmRelayChannelId,
    ticketAllowOverclaim,
    ticketOverclaimPermission,
    ticketAutoClaimOnReply,
    ticketInactivityEnabled,
    ticketInactivityHours,
    ticketInactivityMessage,
    ticketSatisfactionCommentEnabled,
    ticketSatisfactionCommentQuestion,
    ticketSatisfactionCommentTimeout,
    ticketSatisfactionLogChannelId,
    ticketSatisfactionLogAnonymous,
    ticketLockUntilClaim,
    ticketApprovalEnabled,
    ticketApprovalChannelId,
    ticketArchiveCategoryId,
    ticketArchiveKeepOpenerView,
    ticketHistoryPanelEnabled,
    ticketSelfReopenEnabled,
    ticketSelfDeleteEnabled,
    ticketQuotaOpenEnabled,
    ticketQuotaOpenMax,
    ticketQuotaCooldownEnabled,
    ticketQuotaCooldownMinutes,
    ticketQuotaPeriodEnabled,
    ticketQuotaPeriodMax,
    ticketQuotaPeriodHours,
    ticketQuotaStaffLoadMode,
    ticketQuotaStaffLoadMax,
    ticketQuotaStaffLoadBypassRoleIds,
    ticketQuotaReopenEnabled,
    ticketQuotaReopenMax,
    ticketSlaFirstResponseMinutes,
    ticketSlaResolutionHours,
    ticketTypes,
    ticketEmbedThumbnail,
    ticketEmbedImage,
    ticketEmbedFooter,
    ticketEmbedAuthorName,
    ticketEmbedAuthorIcon,
    ticketWelcomeTitle,
    ticketWelcomeDesc,
    ticketWelcomeColor,
    ticketWelcomeThumbnail,
    ticketWelcomeImage,
    ticketWelcomeFooter
  });

  useUnsavedChanges({
    id: 'tickets',
    label: m.e1_tickets_config_label(),
    getConfig: () => currentSettings,
    getSaved: () => savedSettingsConfig,
    onSave: () => saveSettings(),
    onReset: () => restoreSettingsConfig(),
    canEdit: () => activeTab === 'config' && savedSettingsConfig !== null
  });

  function restoreSettingsConfig() {
    if (!savedSettingsConfig) return;
    ticketCategoryId = savedSettingsConfig.ticketCategoryId;
    ticketLogChannelId = savedSettingsConfig.ticketLogChannelId;
    ticketStaffRoleId = savedSettingsConfig.ticketStaffRoleId;
    ticketChannelId = savedSettingsConfig.ticketChannelId;
    ticketEmbedTitle = savedSettingsConfig.ticketEmbedTitle;
    ticketEmbedDesc = savedSettingsConfig.ticketEmbedDesc;
    ticketEmbedButtonText = savedSettingsConfig.ticketEmbedButtonText;
    ticketEmbedColor = savedSettingsConfig.ticketEmbedColor;
    ticketEmbedType = savedSettingsConfig.ticketEmbedType;
    ticketMode = savedSettingsConfig.ticketMode;
    ticketDmRelayChannelId = savedSettingsConfig.ticketDmRelayChannelId;
    ticketAllowOverclaim = savedSettingsConfig.ticketAllowOverclaim;
    ticketOverclaimPermission = savedSettingsConfig.ticketOverclaimPermission;
    ticketAutoClaimOnReply = savedSettingsConfig.ticketAutoClaimOnReply;
    ticketInactivityEnabled = savedSettingsConfig.ticketInactivityEnabled;
    ticketInactivityHours = savedSettingsConfig.ticketInactivityHours;
    ticketInactivityMessage = savedSettingsConfig.ticketInactivityMessage;
    ticketSatisfactionCommentEnabled = savedSettingsConfig.ticketSatisfactionCommentEnabled;
    ticketSatisfactionCommentQuestion = savedSettingsConfig.ticketSatisfactionCommentQuestion;
    ticketSatisfactionCommentTimeout = savedSettingsConfig.ticketSatisfactionCommentTimeout;
    ticketSatisfactionLogChannelId = savedSettingsConfig.ticketSatisfactionLogChannelId;
    ticketSatisfactionLogAnonymous = savedSettingsConfig.ticketSatisfactionLogAnonymous;
    ticketLockUntilClaim = savedSettingsConfig.ticketLockUntilClaim;
    ticketApprovalEnabled = savedSettingsConfig.ticketApprovalEnabled;
    ticketApprovalChannelId = savedSettingsConfig.ticketApprovalChannelId;
    ticketArchiveCategoryId = savedSettingsConfig.ticketArchiveCategoryId;
    ticketArchiveKeepOpenerView = savedSettingsConfig.ticketArchiveKeepOpenerView;
    ticketHistoryPanelEnabled = savedSettingsConfig.ticketHistoryPanelEnabled;
    ticketSelfReopenEnabled = savedSettingsConfig.ticketSelfReopenEnabled;
    ticketSelfDeleteEnabled = savedSettingsConfig.ticketSelfDeleteEnabled;
    ticketQuotaOpenEnabled = savedSettingsConfig.ticketQuotaOpenEnabled;
    ticketQuotaOpenMax = savedSettingsConfig.ticketQuotaOpenMax;
    ticketQuotaCooldownEnabled = savedSettingsConfig.ticketQuotaCooldownEnabled;
    ticketQuotaCooldownMinutes = savedSettingsConfig.ticketQuotaCooldownMinutes;
    ticketQuotaPeriodEnabled = savedSettingsConfig.ticketQuotaPeriodEnabled;
    ticketQuotaPeriodMax = savedSettingsConfig.ticketQuotaPeriodMax;
    ticketQuotaPeriodHours = savedSettingsConfig.ticketQuotaPeriodHours;
    ticketQuotaStaffLoadMode = savedSettingsConfig.ticketQuotaStaffLoadMode;
    ticketQuotaStaffLoadMax = savedSettingsConfig.ticketQuotaStaffLoadMax;
    ticketQuotaStaffLoadBypassRoleIds = savedSettingsConfig.ticketQuotaStaffLoadBypassRoleIds;
    ticketQuotaReopenEnabled = savedSettingsConfig.ticketQuotaReopenEnabled;
    ticketQuotaReopenMax = savedSettingsConfig.ticketQuotaReopenMax;
    ticketTypes = JSON.parse(JSON.stringify(savedSettingsConfig.ticketTypes));
    ticketEmbedThumbnail = savedSettingsConfig.ticketEmbedThumbnail;
    ticketEmbedImage = savedSettingsConfig.ticketEmbedImage;
    ticketEmbedFooter = savedSettingsConfig.ticketEmbedFooter;
    ticketEmbedAuthorName = savedSettingsConfig.ticketEmbedAuthorName;
    ticketEmbedAuthorIcon = savedSettingsConfig.ticketEmbedAuthorIcon;
    ticketWelcomeTitle = savedSettingsConfig.ticketWelcomeTitle;
    ticketWelcomeDesc = savedSettingsConfig.ticketWelcomeDesc;
    ticketWelcomeColor = savedSettingsConfig.ticketWelcomeColor;
    ticketWelcomeThumbnail = savedSettingsConfig.ticketWelcomeThumbnail;
    ticketWelcomeImage = savedSettingsConfig.ticketWelcomeImage;
    ticketWelcomeFooter = savedSettingsConfig.ticketWelcomeFooter;
    ticketSlaFirstResponseMinutes = savedSettingsConfig.ticketSlaFirstResponseMinutes ?? null;
    ticketSlaResolutionHours = savedSettingsConfig.ticketSlaResolutionHours ?? null;
  }

  async function changeTab(tab: typeof activeTab) {
    if (unsavedChanges.isDirty && unsavedChanges.ownerId === 'tickets') {
      const confirmLeave = await confirmDialog.ask({
        title: m.e1_tickets_unsaved_title(),
        description: m.e1_tickets_unsaved_desc(),
        confirmLabel: m.e1_tickets_unsaved_confirm(),
        variant: 'warning',
      });
      if (!confirmLeave) return;
      unsavedChanges.clear();
      restoreSettingsConfig();
    }
    gotoTab('/tickets', tab, DEFAULT_TICKETS_TAB);
  }

  // Derived values from Dashboard Store
  const discordChannels = $derived(dashboardStore.state.discordChannels || []);
  const discordCategories = $derived(dashboardStore.state.discordCategories || []);
  const discordRoles = $derived(dashboardStore.state.discordRoles || []);

  /**
   * Les seuls reglages qui empechent un ticket d'exister. Tout le reste de la
   * page en affine le comportement : les melanger ferait passer pour egales
   * une categorie manquante et une couleur d'embed non choisie.
   */
  const configBlockers = $derived(
    [
      { key: 'category', label: 'la catégorie', ok: !!ticketCategoryId },
      { key: 'staffRole', label: 'le rôle du staff', ok: !!ticketStaffRoleId },
      { key: 'panelChannel', label: 'le salon du panneau', ok: !!ticketChannelId },
    ].filter((item) => !item.ok)
  );

  const STAFF_LOAD_MODES = [
    { value: 'OFF', label: 'Désactivé' },
    { value: 'WARN', label: 'Avertir' },
    { value: 'BLOCK', label: 'Bloquer' },
  ] as const;

  /** Badge de l'accordeon : combien de quotas imposent effectivement une limite. */
  const activeQuotaCount = $derived(
    [
      ticketQuotaOpenEnabled,
      ticketQuotaCooldownEnabled,
      ticketQuotaPeriodEnabled,
      ticketQuotaStaffLoadMode !== 'OFF',
      ticketQuotaReopenEnabled,
    ].filter(Boolean).length
  );

  const saveAction = createAsyncActionState();
  const sendEmbedAction = createAsyncActionState();
  const setupAction = createAsyncActionState();
  const renameAction = createAsyncActionState();

  /**
   * Les réglages « verrouillage » et « validation » d'un type de ticket sont
   * tri-états côté bot (`true` / `false` / `null` = suivre le serveur). Un
   * `<select>` ne manipulant que des chaînes, la conversion se fait ici, dans
   * les deux sens, plutôt que d'éparpiller des ternaires dans le balisage.
   */
  function inheritedToSelect(value: unknown): '' | 'YES' | 'NO' {
    if (value === true) return 'YES';
    if (value === false) return 'NO';
    return '';
  }

  function selectToInherited(value: '' | 'YES' | 'NO'): boolean | null {
    if (value === 'YES') return true;
    if (value === 'NO') return false;
    return null;
  }

  /** Choix d'une question : le texte saisi reste la source de vérité. */
  function parseChoices(raw: string | undefined): string[] {
    return (raw ?? '')
      .split(',')
      .map((choice) => choice.trim())
      .filter(Boolean);
  }

  /**
   * Types de tickets prêts pour l'API : tri-états reconvertis en booléens et
   * questions nettoyées. `choicesString` n'existe que pour l'édition, on ne
   * l'envoie pas ; les choix sont recalculés depuis lui au moment de sauver
   * pour qu'un collage ou une correction ne soit jamais perdu.
   */
  function serializeTicketTypes() {
    return ticketTypes.map((type) => ({
      ...type,
      lockUntilClaim: selectToInherited(type.lockUntilClaim),
      requireApproval: selectToInherited(type.requireApproval),
      formCustomFields: (type.formCustomFields || []).map((field) => ({
        id: field.id,
        label: (field.label || '').trim(),
        placeholder: (field.placeholder || '').trim(),
        style: field.style,
        required: field.required !== false,
        choices: field.style === 'SELECT' || field.style === 'RADIO' ? parseChoices(field.choicesString) : [],
      })),
    }));
  }

  /** Une question sans intitulé est refusée par Discord : on bloque avant l'envoi. */
  function findInvalidQuestion(): { typeLabel: string; index: number } | null {
    for (const type of ticketTypes) {
      if (!type.formEnabled) continue;
      const fields = type.formCustomFields || [];
      for (let index = 0; index < fields.length; index++) {
        if (!(fields[index].label || '').trim()) {
          return { typeLabel: type.label || '', index: index + 1 };
        }
      }
    }
    return null;
  }

  function createTicketTypeDraft(index = 0, legacy?: any) {
    return {
      id: legacy?.ticketTypeId || crypto.randomUUID(),
      label: legacy?.ticketEmbedButtonText || m.e1_tickets_default_ticket_label({ index: index + 1 }),
      description: legacy?.ticketEmbedDesc || '',
      emoji: '📩',
      categoryId: legacy?.ticketCategoryId || ticketCategoryId || '',
      staffRoleId: legacy?.ticketStaffRoleId || ticketStaffRoleId || '',
      buttonStyle: 'PRIMARY' as const,
      mode: '' as '' | 'CHANNEL' | 'DM' | 'THREAD',
      anonymous: false,
      staffServerRelay: false,
      staffServerChannel: false,
      staffServerCategoryId: '',
      lockUntilClaim: '' as '' | 'YES' | 'NO',
      requireApproval: '' as '' | 'YES' | 'NO',
      formEnabled: true,
      formCustomFields: [] as Array<{
        id: string;
        label: string;
        placeholder: string;
        style: 'SHORT' | 'PARAGRAPH' | 'SELECT' | 'RADIO' | 'FILE';
        required: boolean;
        choices?: string[];
        choicesString?: string;
      }>
    };
  }

  function normalizeTicketTypes(config: any): Array<{
    id: string;
    label: string;
    description: string;
    emoji: string;
    categoryId: string;
    staffRoleId: string;
    buttonStyle: 'PRIMARY' | 'SECONDARY' | 'SUCCESS' | 'DANGER';
    mode: '' | 'CHANNEL' | 'DM' | 'THREAD';
    anonymous: boolean;
    staffServerRelay: boolean;
    staffServerChannel: boolean;
    staffServerCategoryId: string;
    /** Tri-etat : '' herite du serveur, 'YES'/'NO' tranchent pour ce type. */
    lockUntilClaim: '' | 'YES' | 'NO';
    requireApproval: '' | 'YES' | 'NO';
    formEnabled: boolean;
    formCustomFields: Array<{
      id: string;
      label: string;
      placeholder: string;
      style: 'SHORT' | 'PARAGRAPH' | 'SELECT' | 'RADIO' | 'FILE';
      required: boolean;
      choices?: string[];
      choicesString?: string;
    }>;
  }> {
    if (Array.isArray(config?.ticketTypes) && config.ticketTypes.length > 0) {
      return config.ticketTypes
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any, index: number) => ({
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : crypto.randomUUID(),
          label: typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 80) : m.e1_tickets_default_ticket_label({ index: index + 1 }),
          description: typeof item.description === 'string' ? item.description.trim().slice(0, 200) : '',
          emoji: typeof item.emoji === 'string' && item.emoji.trim() ? item.emoji.trim().slice(0, 16) : '📩',
          categoryId: typeof item.categoryId === 'string' ? item.categoryId : '',
          staffRoleId: typeof item.staffRoleId === 'string' ? item.staffRoleId : '',
          buttonStyle: item.buttonStyle === 'SECONDARY' || item.buttonStyle === 'SUCCESS' || item.buttonStyle === 'DANGER'
            ? item.buttonStyle
            : 'PRIMARY',
          mode: item.mode === 'CHANNEL' || item.mode === 'DM' || item.mode === 'THREAD' ? item.mode : '',
          anonymous: item.anonymous === true,
          staffServerRelay: item.staffServerRelay === true,
          staffServerChannel: item.staffServerChannel === true,
          staffServerCategoryId: typeof item.staffServerCategoryId === 'string' ? item.staffServerCategoryId : '',
          lockUntilClaim: inheritedToSelect(item.lockUntilClaim),
          requireApproval: inheritedToSelect(item.requireApproval),
          formEnabled: item.formEnabled !== undefined ? item.formEnabled : true,
          formCustomFields: Array.isArray(item.formCustomFields)
            ? item.formCustomFields.map((f: any, fieldIndex: number) => ({
                // Un identifiant vide ferait doublon dans le modal Discord,
                // qui refuse alors le formulaire entier.
                id: typeof f.id === 'string' && f.id.trim() ? f.id.trim() : `field_${index + 1}_${fieldIndex + 1}`,
                label: f.label || '',
                placeholder: f.placeholder || '',
                style: f.style || 'SHORT',
                required: f.required !== false,
                choices: Array.isArray(f.choices) ? f.choices : [],
                choicesString: Array.isArray(f.choices) ? f.choices.join(', ') : '',
              }))
            : [],
        }));
    }

      return [createTicketTypeDraft(0, config)];
  }

  function addCustomField(typeIndex: number) {
    const ticketType = ticketTypes[typeIndex];
    if (!ticketType.formCustomFields) {
      ticketType.formCustomFields = [];
    }
    if (ticketType.formCustomFields.length >= 5) {
      toast.error(m.e1_tickets_err_max_fields());
      return;
    }
    const newId = 'field_' + Math.random().toString(36).substring(2, 10);
    ticketType.formCustomFields = [...ticketType.formCustomFields, {
      id: newId,
      label: m.e1_tickets_default_question_label({ index: ticketType.formCustomFields.length + 1 }),
      placeholder: '',
      style: 'SHORT',
      required: true,
      // Ces deux champs doivent exister des la creation : `bind:value` sur une
      // valeur `undefined` fait planter la page des qu'on choisit un type a choix.
      choices: [],
      choicesString: ''
    }];
  }

  function removeCustomField(typeIndex: number, fieldId: string) {
    const ticketType = ticketTypes[typeIndex];
    ticketType.formCustomFields = ticketType.formCustomFields.filter(f => f.id !== fieldId);
  }

  function addTicketType() {
    ticketTypes = [...ticketTypes, createTicketTypeDraft(ticketTypes.length)];
    expandedTicketTypeIndex = ticketTypes.length - 1; // Expands the newly created ticket type
  }

  function removeTicketType(index: number) {
    ticketTypes = ticketTypes.filter((_, currentIndex) => currentIndex !== index);
    if (expandedTicketTypeIndex === index) {
      expandedTicketTypeIndex = null;
    } else if (expandedTicketTypeIndex !== null && expandedTicketTypeIndex > index) {
      expandedTicketTypeIndex--;
    }
    if (ticketTypes.length === 0) {
      ticketTypes = [createTicketTypeDraft(0)];
      expandedTicketTypeIndex = 0;
    }
  }

  function moveTicketType(index: number, direction: 'UP' | 'DOWN') {
    if (direction === 'UP' && index > 0) {
      const temp = ticketTypes[index];
      ticketTypes[index] = ticketTypes[index - 1];
      ticketTypes[index - 1] = temp;
      ticketTypes = [...ticketTypes];
      if (expandedTicketTypeIndex === index) {
        expandedTicketTypeIndex = index - 1;
      } else if (expandedTicketTypeIndex === index - 1) {
        expandedTicketTypeIndex = index;
      }
    } else if (direction === 'DOWN' && index < ticketTypes.length - 1) {
      const temp = ticketTypes[index];
      ticketTypes[index] = ticketTypes[index + 1];
      ticketTypes[index + 1] = temp;
      ticketTypes = [...ticketTypes];
      if (expandedTicketTypeIndex === index) {
        expandedTicketTypeIndex = index + 1;
      } else if (expandedTicketTypeIndex === index + 1) {
        expandedTicketTypeIndex = index;
      }
    }
  }

  // Fetch all tickets and config
  async function loadTicketsAndConfig(reset = true) {
    if (!authStore.selectedGuildId) return;
    if (reset) {
      loading = true;
      ticketsOffset = 0;
    } else {
      loadingMoreTickets = true;
    }
    error = '';
    try {
      const params = new URLSearchParams({
        limit: String(TICKETS_PAGE_SIZE),
        offset: String(reset ? 0 : ticketsOffset),
      });
      inboxParams(params);

      const res = await dashboardFetch(`/tickets?${params}`);
      if (!res.ok) throw new Error(m.e1_tickets_err_load_system());
      const data = await res.json();
      const incomingTickets = data.tickets || [];
      tickets = reset ? incomingTickets : [...tickets, ...incomingTickets];
      ticketsHasMore = data.pagination?.hasMore === true;
      ticketsOffset = data.pagination?.nextOffset ?? ticketsOffset;
      if (data.views) viewCounts = data.views;
      config = data.config || {};
      
      // Populate config bindings
      ticketCategoryId = config.ticketCategoryId || '';
      ticketLogChannelId = config.ticketLogChannelId || '';
      ticketStaffRoleId = config.ticketStaffRoleId || '';
      ticketChannelId = config.ticketChannelId || '';
      // Laisses vides quand ils le sont : le bot compose alors le texte par
      // defaut dans la langue du serveur. Les remplir ici reviendrait a figer
      // en base la langue du dashboard de celui qui enregistre. Le champ
      // montre le defaut en filigrane.
      ticketEmbedTitle = config.ticketEmbedTitle || '';
      ticketEmbedDesc = config.ticketEmbedDesc || '';
      ticketEmbedButtonText = config.ticketEmbedButtonText || '';
      ticketEmbedColor = config.ticketEmbedColor || '#5865F2';
      ticketEmbedType = config.ticketEmbedType === 'DROPDOWN' ? 'DROPDOWN' : 'BUTTONS';
      ticketMode = config.ticketMode || 'CHANNEL';
      ticketDmRelayChannelId = config.ticketDmRelayChannelId || '';
      ticketAllowOverclaim = config.ticketAllowOverclaim !== undefined ? config.ticketAllowOverclaim : true;
      ticketOverclaimPermission = config.ticketOverclaimPermission || 'ANY';
      ticketAutoClaimOnReply = config.ticketAutoClaimOnReply === true;
      ticketInactivityEnabled = config.ticketInactivityEnabled !== undefined ? config.ticketInactivityEnabled : false;
      ticketInactivityHours = config.ticketInactivityHours !== undefined ? config.ticketInactivityHours : 24;
      ticketInactivityMessage = config.ticketInactivityMessage || '';
      ticketSatisfactionCommentEnabled = config.ticketSatisfactionCommentEnabled !== undefined ? config.ticketSatisfactionCommentEnabled : true;
      // Laisse vide : le bot pose alors sa question par defaut, comme pour les embeds.
      ticketSatisfactionCommentQuestion = config.ticketSatisfactionCommentQuestion || '';
      ticketSatisfactionCommentTimeout = config.ticketSatisfactionCommentTimeout !== undefined ? config.ticketSatisfactionCommentTimeout : 120;
      ticketSatisfactionLogChannelId = config.ticketSatisfactionLogChannelId || '';
      ticketSatisfactionLogAnonymous = config.ticketSatisfactionLogAnonymous === true;
      ticketLockUntilClaim = config.ticketLockUntilClaim === true;
      ticketApprovalEnabled = config.ticketApprovalEnabled === true;
      ticketApprovalChannelId = config.ticketApprovalChannelId || '';
      ticketArchiveCategoryId = config.ticketArchiveCategoryId || '';
      ticketArchiveKeepOpenerView = config.ticketArchiveKeepOpenerView === true;
      // Actifs par defaut cote serveur : `!== false` pour qu'une config lue
      // avant migration ne les affiche pas eteints.
      ticketHistoryPanelEnabled = config.ticketHistoryPanelEnabled !== false;
      ticketSelfReopenEnabled = config.ticketSelfReopenEnabled !== false;
      ticketSelfDeleteEnabled = config.ticketSelfDeleteEnabled === true;
      ticketQuotaOpenEnabled = config.ticketQuotaOpenEnabled === true;
      ticketQuotaOpenMax = config.ticketQuotaOpenMax ?? 1;
      ticketQuotaCooldownEnabled = config.ticketQuotaCooldownEnabled === true;
      ticketQuotaCooldownMinutes = config.ticketQuotaCooldownMinutes ?? 30;
      ticketQuotaPeriodEnabled = config.ticketQuotaPeriodEnabled === true;
      ticketQuotaPeriodMax = config.ticketQuotaPeriodMax ?? 5;
      ticketQuotaPeriodHours = config.ticketQuotaPeriodHours ?? 24;
      ticketQuotaStaffLoadMode = config.ticketQuotaStaffLoadMode || 'OFF';
      ticketQuotaStaffLoadMax = config.ticketQuotaStaffLoadMax ?? 5;
      ticketQuotaStaffLoadBypassRoleIds = config.ticketQuotaStaffLoadBypassRoleIds || [];
      ticketQuotaReopenEnabled = config.ticketQuotaReopenEnabled === true;
      ticketQuotaReopenMax = config.ticketQuotaReopenMax ?? 3;
      ticketSlaFirstResponseMinutes = config.ticketSlaFirstResponseMinutes ?? null;
      ticketSlaResolutionHours = config.ticketSlaResolutionHours ?? null;
      ticketTypes = normalizeTicketTypes(config);
      ticketEmbedThumbnail = config.ticketEmbedThumbnail || '';
      ticketEmbedImage = config.ticketEmbedImage || '';
      ticketEmbedFooter = config.ticketEmbedFooter || '';
      ticketEmbedAuthorName = config.ticketEmbedAuthorName || '';
      ticketEmbedAuthorIcon = config.ticketEmbedAuthorIcon || '';
      ticketWelcomeTitle = config.ticketWelcomeTitle || '';
      ticketWelcomeDesc = config.ticketWelcomeDesc || '';
      ticketWelcomeColor = config.ticketWelcomeColor || '#5865F2';
      ticketWelcomeThumbnail = config.ticketWelcomeThumbnail || '';
      ticketWelcomeImage = config.ticketWelcomeImage || '';
      ticketWelcomeFooter = config.ticketWelcomeFooter || '';
      savedSettingsConfig = {
        ticketCategoryId,
        ticketLogChannelId,
        ticketStaffRoleId,
        ticketChannelId,
        ticketEmbedTitle,
        ticketEmbedDesc,
        ticketEmbedButtonText,
        ticketEmbedColor,
        ticketEmbedType,
        ticketMode,
        ticketDmRelayChannelId,
        ticketAllowOverclaim,
        ticketOverclaimPermission,
        ticketAutoClaimOnReply,
        ticketInactivityEnabled,
        ticketInactivityHours,
        ticketInactivityMessage,
        ticketSatisfactionCommentEnabled,
        ticketSatisfactionCommentQuestion,
        ticketSatisfactionCommentTimeout,
        ticketSatisfactionLogChannelId,
        ticketSatisfactionLogAnonymous,
        ticketLockUntilClaim,
        ticketApprovalEnabled,
        ticketApprovalChannelId,
        ticketArchiveCategoryId,
        ticketArchiveKeepOpenerView,
        ticketHistoryPanelEnabled,
        ticketSelfReopenEnabled,
        ticketSelfDeleteEnabled,
        ticketQuotaOpenEnabled,
        ticketQuotaOpenMax,
        ticketQuotaCooldownEnabled,
        ticketQuotaCooldownMinutes,
        ticketQuotaPeriodEnabled,
        ticketQuotaPeriodMax,
        ticketQuotaPeriodHours,
        ticketQuotaStaffLoadMode,
        ticketQuotaStaffLoadMax,
        ticketQuotaStaffLoadBypassRoleIds,
        ticketQuotaReopenEnabled,
        ticketQuotaReopenMax,
        ticketSlaFirstResponseMinutes,
        ticketSlaResolutionHours,
        ticketTypes: JSON.parse(JSON.stringify(ticketTypes)),
        ticketEmbedThumbnail,
        ticketEmbedImage,
        ticketEmbedFooter,
        ticketEmbedAuthorName,
        ticketEmbedAuthorIcon,
        ticketWelcomeTitle,
        ticketWelcomeDesc,
        ticketWelcomeColor,
        ticketWelcomeThumbnail,
        ticketWelcomeImage,
        ticketWelcomeFooter
      };
    } catch (err) {
      error = errorMessage(err) || 'Une erreur est survenue';
    } finally {
      loading = false;
      loadingMoreTickets = false;
    }
  }

  async function refreshTicketsOnly() {
    if (!authStore.selectedGuildId || !authStore.token) return;
    try {
      const params = new URLSearchParams({
        limit: String(Math.max(TICKETS_PAGE_SIZE, tickets.length || TICKETS_PAGE_SIZE)),
        offset: '0',
      });
      inboxParams(params);

      const res = await dashboardFetch(`/tickets?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      tickets = data.tickets || [];
      if (data.views) viewCounts = data.views;
      ticketsHasMore = data.pagination?.hasMore === true;
      ticketsOffset = data.pagination?.nextOffset ?? tickets.length;

      if (selectedTicketId) {
        const found = tickets.find((t) => t.id === selectedTicketId);
        if (found && selectedTicketDetail) {
          selectedTicketDetail = { ...selectedTicketDetail, ...found };
        }
      }
    } catch {
      // Échec silencieux pour un rafraîchissement d'arrière-plan
    }
  }

  /** Relecture des onglets devenus composants : ils écoutent ce compteur. */
  let refreshToken = $state(0);

  async function handleRefresh() {
    if (activeTab === 'transcripts') {
      refreshToken += 1;
    } else if (activeTab === 'satisfaction') {
      refreshToken += 1;
    } else if (activeTab === 'blacklist') {
      refreshToken += 1;
    } else if (activeTab === 'macros') {
      refreshToken += 1;
    } else {
      await loadTicketsAndConfig();
    }
  }

  // Fetch details & messages for selected ticket
  const selectedInboxRow = $derived(tickets.find((t) => t.id === selectedTicketId) as InboxTicket | undefined);
  const knownTags = $derived([...new Set(tickets.flatMap((t) => (t as InboxTicket).tags ?? []))].sort());

  /** Reporte une modification de propriétés sur la liste et le détail. */
  function patchSelectedTicket(patch: Record<string, unknown>) {
    tickets = tickets.map((t) => (t.id === selectedTicketId ? { ...t, ...patch } : t));
    if (selectedTicketDetail) selectedTicketDetail = { ...selectedTicketDetail, ...patch };
    void refreshTicketsOnly();
  }

  async function loadTicketDetail(ticketId: string, autoScroll = true) {
    if (!authStore.selectedGuildId) return;
    loadingDetail = true;
    try {
      const res = await dashboardFetch(`/tickets/${ticketId}`);
      if (!res.ok) throw new Error(m.e1_tickets_err_load_detail());
      const data = await res.json();
      selectedTicketDetail = data.ticket;
      messages = data.messages || [];
      ticketRenameName = data.ticket?.channelName || '';

      if (autoScroll) {
        setTimeout(scrollToBottom, 50);
      }
    } catch (err) {
      console.error(err);
    } finally {
      loadingDetail = false;
    }
  }

  // L'evenement temps reel ne porte que l'identifiant du ticket : on relit ses
  // messages par l'API. Seuls les messages sont remplaces, pour ne pas ecraser
  // un renommage en cours de saisie, et une reponse arrivee apres une plus
  // recente est ignoree.
  let messagesRefreshSeq = 0;
  async function refreshTicketMessages(ticketId: string) {
    const seq = ++messagesRefreshSeq;
    try {
      const res = await dashboardFetch(`/tickets/${ticketId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (seq !== messagesRefreshSeq || selectedTicketId !== ticketId) return;
      messages = data.messages || [];
      setTimeout(scrollToBottom, 50);
    } catch {
      // Le prochain message ou un rafraichissement manuel rattrapera
    }
  }

  function selectTicket(ticketId: string) {
    selectedTicketId = ticketId;
    void loadTicketDetail(ticketId, true);
  }

  // Scroll chat window to bottom
  function scrollToBottom() {
    if (chatScrollContainer) {
      chatScrollContainer.scrollTop = chatScrollContainer.scrollHeight;
    }
  }

  // Send message from Svelte Panel to Discord
  async function sendMessage() {
    if (!chatInput.trim() || !selectedTicketId || !authStore.selectedGuildId) return;
    const textToSend = chatInput;
    chatInput = '';
    
    // Add locally immediately with a temp ID for high responsiveness
    const tempMsg = {
      id: `temp-${Date.now()}`,
      content: textToSend,
      authorName: authStore.user?.username || 'Staff',
      authorAvatar: resolveUserAvatarSrc(authStore.user?.id, authStore.user?.avatar),
      isStaff: true,
      createdAt: new Date().toISOString()
    };
    messages = [...messages, tempMsg];
    setTimeout(scrollToBottom, 30);

    try {
      const res = await dashboardFetch(`/tickets/${selectedTicketId}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: textToSend })
      });
      if (!res.ok) throw new Error(m.e1_tickets_err_send_message());
      // Reload actual messages
      await loadTicketDetail(selectedTicketId, false);
    } catch (err) {
      toast.error(errorMessage(err) || m.e1_tickets_err_generic());
    }
  }

  // Claim Ticket
  async function claimTicket() {
    if (!selectedTicketId || !authStore.selectedGuildId) return;
    try {
      const res = await dashboardFetch(`/tickets/${selectedTicketId}/claim`, {
        method: 'POST'
        });
      if (!res.ok) throw new Error(m.e1_tickets_err_claim());
      await loadTicketDetail(selectedTicketId, false);
      await loadTicketsAndConfig();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // Close Ticket
  async function closeTicket() {
    if (!selectedTicketId || !authStore.selectedGuildId) return;
    try {
      const res = await dashboardFetch(`/tickets/${selectedTicketId}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: closeReason })
      });
      if (!res.ok) throw new Error(m.e1_tickets_err_close());
      showCloseModal = false;
      closeReason = '';
      await loadTicketDetail(selectedTicketId, false);
      await loadTicketsAndConfig();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // Rename Ticket
  async function renameTicket() {
    if (!selectedTicketId || !authStore.selectedGuildId || !ticketRenameName.trim()) return;
    const ticketId = selectedTicketId;
    await renameAction.run(async () => {
      const res = await dashboardFetch(`/tickets/${ticketId}/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: ticketRenameName.trim() })
      });
      if (!res.ok) throw new Error(m.e1_tickets_err_rename());
      const data = await res.json().catch(() => null);
      if (data?.channelName) {
        ticketRenameName = data.channelName;
      }
      await loadTicketDetail(ticketId, false);
      await loadTicketsAndConfig();
      return true;
    }, { successMessage: m.e1_tickets_renamed_toast() });
  }

  // Reopen Ticket
  async function reopenTicket() {
    if (!selectedTicketId || !authStore.selectedGuildId) return;
    try {
      const res = await dashboardFetch(`/tickets/${selectedTicketId}/reopen`, {
        method: 'POST'
        });
      if (!res.ok) throw new Error(m.e1_tickets_err_reopen());
      await loadTicketDetail(selectedTicketId, false);
      await loadTicketsAndConfig();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // Restore Ticket
  let showRestoreModal = $state(false);
  let restoring = $state(false);

  async function restoreTicket() {
    if (!selectedTicketId || !authStore.selectedGuildId) return;
    restoring = true;
    try {
      const res = await dashboardFetch(`/tickets/${selectedTicketId}/restore`, {
        method: 'POST'
        });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || m.e1_tickets_err_restore());
      }
      showRestoreModal = false;
      toast.success(m.e1_tickets_restored_toast());
      await loadTicketDetail(selectedTicketId, false);
      await loadTicketsAndConfig();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      restoring = false;
    }
  }

  // ─── Archivage et verrou anti-suppression ──────────────────────────────────

  /**
   * Le verrou peut porter une échéance : un ticket dont la date est passée n'est
   * plus protégé, même si le drapeau est resté à vrai en base. On le recalcule
   * ici plutôt que de se fier au seul booléen, comme le fait le bot.
   */
  const deletionLock = $derived.by(() => {
    const t = selectedTicketDetail;
    if (!t?.deletionLocked) return null;
    const until = t.deletionLockedUntil ? new Date(t.deletionLockedUntil) : null;
    if (until && until.getTime() <= Date.now()) return null;
    return { until, reason: t.deletionLockReason ?? null, byName: t.deletionLockedByName ?? null };
  });

  let showLockModal = $state(false);
  let lockDuration = $state<'7d' | '30d' | '90d' | 'permanent'>('30d');
  let lockReason = $state('');
  let lockBusy = $state(false);

  const LOCK_DURATION_MS: Record<string, number | null> = {
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
    permanent: null,
  };

  async function postTicketAction(action: string, body?: unknown): Promise<any> {
    const res = await dashboardFetch(`/tickets/${selectedTicketId}/${action}`, {
        method: 'POST',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || m.e1_tickets_action_failed());
    return data;
  }

  async function archiveTicket(unarchive = false) {
    if (!selectedTicketId || !authStore.selectedGuildId) return;
    try {
      await postTicketAction(unarchive ? 'unarchive' : 'archive');
      toast.success(unarchive ? m.e1_tickets_unarchived_toast() : m.e1_tickets_archived_toast());
      await loadTicketDetail(selectedTicketId, false);
      await loadTicketsAndConfig();
    } catch (err) {
      toast.error(errorMessage(err) || m.e1_tickets_err_archive());
    }
  }

  async function lockTicket() {
    if (!selectedTicketId || !authStore.selectedGuildId) return;
    lockBusy = true;
    try {
      await postTicketAction('lock', {
        durationMs: LOCK_DURATION_MS[lockDuration],
        reason: lockReason.trim() || null,
      });
      showLockModal = false;
      lockReason = '';
      toast.success(m.e1_tickets_locked_toast());
      await loadTicketDetail(selectedTicketId, false);
      await loadTicketsAndConfig();
    } catch (err) {
      toast.error(errorMessage(err) || m.e1_tickets_err_lock());
    } finally {
      lockBusy = false;
    }
  }

  async function unlockTicket() {
    if (!selectedTicketId || !authStore.selectedGuildId) return;
    try {
      await postTicketAction('unlock');
      toast.success(m.e1_tickets_unlocked_toast());
      await loadTicketDetail(selectedTicketId, false);
      await loadTicketsAndConfig();
    } catch (err) {
      toast.error(errorMessage(err) || m.e1_tickets_err_lock());
    }
  }

  // Delete Ticket
  async function deleteTicket() {
    if (!selectedTicketId || !authStore.selectedGuildId) return;
    try {
      const res = await dashboardFetch(`/tickets/${selectedTicketId}/delete`, {
        method: 'POST'
        });
      if (!res.ok) throw new Error(m.e1_tickets_err_delete());
      showDeleteConfirmModal = false;
      selectedTicketId = null;
      selectedTicketDetail = null;
      messages = [];
      await loadTicketsAndConfig();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // Save Settings Config
  async function saveSettings(): Promise<boolean> {
    const invalidQuestion = findInvalidQuestion();
    if (invalidQuestion) {
      toast.error(m.e1_tickets_err_empty_question({ index: invalidQuestion.index, type: invalidQuestion.typeLabel }));
      return false;
    }
    let success = false;
    await saveAction.run(async () => {
      const res = await dashboardFetch(`/tickets/config`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ticketCategoryId,
          ticketLogChannelId,
          ticketStaffRoleId,
          ticketChannelId,
          ticketEmbedTitle,
          ticketEmbedDesc,
          ticketEmbedButtonText,
          ticketEmbedColor,
          ticketEmbedType,
          ticketMode,
          ticketDmRelayChannelId,
          ticketLockUntilClaim,
          ticketApprovalEnabled,
          ticketApprovalChannelId,
          ticketArchiveCategoryId,
          ticketArchiveKeepOpenerView,
          ticketHistoryPanelEnabled,
          ticketSelfReopenEnabled,
          ticketSelfDeleteEnabled,
          ticketQuotaOpenEnabled,
          ticketQuotaOpenMax,
          ticketQuotaCooldownEnabled,
          ticketQuotaCooldownMinutes,
          ticketQuotaPeriodEnabled,
          ticketQuotaPeriodMax,
          ticketQuotaPeriodHours,
          ticketQuotaStaffLoadMode,
          ticketQuotaStaffLoadMax,
          ticketQuotaStaffLoadBypassRoleIds,
          ticketQuotaReopenEnabled,
          ticketQuotaReopenMax,
          ticketSlaFirstResponseMinutes: ticketSlaFirstResponseMinutes || null,
          ticketSlaResolutionHours: ticketSlaResolutionHours || null,
          ticketTypes: serializeTicketTypes(),
          ticketAllowOverclaim,
          ticketOverclaimPermission,
          ticketAutoClaimOnReply,
          ticketInactivityEnabled,
          ticketInactivityHours,
          ticketInactivityMessage,
          ticketSatisfactionCommentEnabled,
          ticketSatisfactionCommentQuestion,
          ticketSatisfactionCommentTimeout,
          ticketSatisfactionLogChannelId,
          ticketSatisfactionLogAnonymous,
          ticketEmbedThumbnail,
          ticketEmbedImage,
          ticketEmbedFooter,
          ticketEmbedAuthorName,
          ticketEmbedAuthorIcon,
          ticketWelcomeTitle,
          ticketWelcomeDesc,
          ticketWelcomeColor,
          ticketWelcomeThumbnail,
          ticketWelcomeImage,
          ticketWelcomeFooter
        })
      });
      if (!res.ok) throw new Error(m.e1_tickets_err_save());
      await dashboardStore.refresh();
      await loadTicketsAndConfig();
      success = true;
      return true;
    }, { successMessage: m.e1_tickets_config_saved() });
    return success;
  }

  async function runTicketSetup() {
    if (!(await confirmDialog.ask({
      title: m.e1_tickets_confirm_setup_title(),
      description: m.e1_tickets_confirm_setup_desc(),
      confirmLabel: m.e1_tickets_confirm_setup_btn()
    }))) return;

    // `run` range l'erreur dans son etat au lieu de la relancer, et cette page
    // n'affiche aucun InlineFeedback : sans ce relais, un refus de permission
    // ou un delai d'attente ne se verrait nulle part.
    const ok = await setupAction.run(async () => {
      const res = await dashboardFetch(`/tickets/config/setup`, {
        method: 'POST'
        });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || m.e1_tickets_err_setup());

      const created = (payload?.items ?? []).filter((item: any) => item.created).map((item: any) => `#${item.name}`);
      toast.success(created.length > 0
        ? m.e1_tickets_setup_created({ names: created.join(', ') })
        : m.e1_tickets_setup_nothing());

      await dashboardStore.refresh();
      await loadTicketsAndConfig();
      return true;
    });

    if (!ok) toast.error(setupAction.state.error || m.e1_tickets_err_setup());
  }

  // Send Panel to Discord
  async function sendEmbedPanel() {
    if (!(await confirmDialog.ask({ title: m.e1_tickets_confirm_panel_title(), description: m.e1_tickets_confirm_panel_desc(), confirmLabel: m.e1_tickets_confirm_panel_btn() }))) return;
    await sendEmbedAction.run(async () => {
      const res = await dashboardFetch(`/tickets/config/send-embed`, {
        method: 'POST'
        });
      if (!res.ok) throw new Error(m.e1_tickets_err_send_panel());
      return true;
    }, { successMessage: m.e1_tickets_panel_sent() });
  }

  // Member Case Logic

  /**
   * Le dossier membre appartient a la section Membres : la fenetre ne s'ouvre
   * pas pour un role a qui le centre de gestion l'a fermee, quelle que soit la
   * page qui la demande.
   */
  const canOpenMemberCase = $derived(canViewFeature('members'));

  async function loadMemberCaseDetails(userId: string) {
    if (!canOpenMemberCase) return;
    selectedCaseLoading = true;
    selectedCaseError = '';
    try {
      selectedCaseData = await fetchMemberCase(userId);
    } catch (err) {
      selectedCaseError = errorMessage(err) || m.e1_tickets_err_load_case();
      selectedCaseData = null;
    } finally {
      selectedCaseLoading = false;
    }
  }

  function openMemberCase(userId: string, userName: string) {
    if (!canOpenMemberCase) return;
    selectedCaseUser = { name: userName, id: userId };
    selectedCaseData = null;
    selectedCaseError = '';
    memberActionReason = m.e1_tickets_member_action_default_reason();
    memberActionDuration = '30m';
    memberActionFeedback = '';
    memberActionIsError = false;
    caseModalOpen = true;
    if (userId) {
      void loadMemberCaseDetails(userId);
    }
  }

  function closeCaseModal() {
    caseModalOpen = false;
    selectedCaseUser = null;
    selectedCaseData = null;
    selectedCaseError = '';
  }

  async function executeMemberAction(action: 'WARN' | 'KICK' | 'TIMEOUT' | 'BAN') {
    if (!selectedCaseUser?.id) return;
    memberActionBusy = true;
    memberActionFeedback = '';
    memberActionIsError = false;
    try {
      const durationMs = action === 'TIMEOUT' ? 30 * 60 * 1000 : null;
      await runMemberCaseAction(selectedCaseUser.id, action, {
        reason: memberActionReason.trim() || m.e1_tickets_action_reason_short(),
        durationMs: durationMs ?? undefined
      });
      memberActionFeedback = m.e1_tickets_action_success();
      await loadMemberCaseDetails(selectedCaseUser.id);
    } catch (err) {
      memberActionIsError = true;
      memberActionFeedback = errorMessage(err) || m.e1_tickets_action_failed();
    } finally {
      memberActionBusy = false;
    }
  }

  function getStatusLabel(status: string) {
    switch (status) {
      case 'PENDING': return m.e1_tickets_status_pending();
      case 'OPEN': return m.e1_tickets_status_open();
      case 'CLAIMED': return m.e1_tickets_status_claimed();
      case 'CLOSED': return m.e1_tickets_status_closed();
      case 'ARCHIVED': return m.e1_tickets_status_archived();
      case 'REJECTED': return m.e1_tickets_status_rejected();
      case 'ORPHANED': return m.e1_tickets_status_orphaned();
      default: return status;
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'PENDING': return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
      case 'OPEN': return 'bg-success/10 text-success border-success/20';
      case 'CLAIMED': return 'bg-warning/10 text-warning border-warning/20';
      case 'CLOSED': return 'bg-error/10 text-error border-error/20';
      case 'ARCHIVED': return 'bg-slate-500/10 text-on-surface-variant border-slate-500/20';
      case 'REJECTED': return 'bg-error/10 text-error border-error/20';
      // Orange et non rouge : ce n'est pas une decision du staff, c'est un accident.
      case 'ORPHANED': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      default: return 'bg-outline-variant/10 text-on-surface-variant border-outline-variant/20';
    }
  }

  // Serveur staff lié - pour l'option "ticket interne"
  let staffServerInfo = $state<{ staffGuildId: string | null; staffGuildName: string | null; categories: any[] }>({
    staffGuildId: null, staffGuildName: null, categories: [],
  });

  async function loadStaffServerInfo() {
    try {
      const data = await fetchStaffServerChannels();
      if (data?.staffGuildId) {
        staffServerInfo = {
          staffGuildId: data.staffGuildId,
          staffGuildName: data.staffGuildName ?? data.staffGuildId,
          categories: data.categories ?? [],
        };
      }
    } catch {
      // pas de lien staff
    }
  }

  onMount(async () => {
    await loadTicketsAndConfig();
    void loadStaffServerInfo();

    unsubscribeRealtime = subscribeRealtime({
      reasons: ['tickets_updated'],
      types: ['new_ticket_message'],
      onUpdate: (event) => {
        if (!event) {
          void refreshTicketsOnly();
          return;
        }

        if (event.type === 'new_ticket_message' && selectedTicketId && event.ticketId === selectedTicketId) {
          void refreshTicketMessages(selectedTicketId);
          return;
        }

        if (event.reason === 'tickets_updated') {
          void refreshTicketsOnly();
        }
      },
    });
  });

  onDestroy(() => {
    unsubscribeRealtime?.();
  });
</script>

<ModulePage 
  title={m.e1_tickets_page_title()}
  description={m.e1_tickets_page_desc()}

  icon="message-square"
  featureKey="tickets"
>
  {#snippet actions()}
    <div class="flex items-center gap-3">
      <RefreshButton onClick={handleRefresh} loading={loading} label={m.e1_tickets_refresh()} />
      <button 
      onclick={() => changeTab(activeTab === 'config' ? 'tickets' : 'config')}
        class="p-3 rounded-xl bg-surface-container-high hover:bg-primary/10 hover:text-primary transition-all text-on-surface-variant/70"
        title={m.e1_tickets_settings_tooltip()}
      >
        <Papicon icon="settings" size={20} />
      </button>
    </div>
  {/snippet}

  <Tabs
    label={m.e1_tickets_page_title()}
    class="mb-6"
    tabs={pageTabItems('/tickets')}
    active={activeTab}
    onchange={(id) => changeTab(id as typeof activeTab)}
  />

  {#if activeTab === 'tickets'}
    {#if error}
      <Callout variant="danger" class="mb-4">{error}</Callout>
    {/if}
    <!-- Tickets Main View - mobile: master/detail pattern -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 h-auto lg:h-[75vh]">

      <!-- Left Panel: Tickets Browser -->
      <div data-tour="tickets-list" class="lg:col-span-4 bg-surface-container-low/40 border border-outline-variant/10 rounded-xl p-4 lg:p-6 flex flex-col overflow-hidden {showMobileChat && selectedTicketId ? 'hidden lg:flex' : 'flex'} h-[50vh] lg:h-full">
        <TicketInboxList
          tickets={tickets as InboxTicket[]}
          view={inboxView}
          counts={viewCounts}
          sort={inboxSort}
          {loading}
          loadingMore={loadingMoreTickets}
          hasMore={ticketsHasMore}
          selectedId={selectedTicketId}
          slaConfigured={!!(config.ticketSlaFirstResponseMinutes || config.ticketSlaResolutionHours)}
          statusLabel={getStatusLabel}
          onview={(view) => { selectedTicketId = null; selectedTicketDetail = null; messages = []; changeInbox({ view }); }}
          onsearch={(query) => changeInbox({ query })}
          onsort={(sort) => changeInbox({ sort })}
          onselect={(id) => { selectTicket(id); showMobileChat = true; }}
          onloadmore={() => loadTicketsAndConfig(false)}
        />
      </div>

      <!-- Right Panel: Live Chat & Actions -->
      <div data-tour="tickets-chat" class="lg:col-span-8 bg-surface-container-low/40 border border-outline-variant/10 rounded-xl flex flex-col overflow-hidden {!showMobileChat && selectedTicketId ? 'hidden lg:flex' : !selectedTicketId ? 'hidden lg:flex' : 'flex'} h-[75vh] lg:h-full">
        {#if !selectedTicketId}
          <div class="flex-1 flex flex-col items-center justify-center text-on-surface-variant/30 py-20">
            <div class="w-16 h-16 rounded-xl bg-surface-container flex items-center justify-center mb-4 shadow-inner">
              <Papicon icon="message-square" size={32} />
            </div>
            <h3 class="text-lg font-semibold text-on-surface/40">{m.e1_tickets_no_selection_title()}</h3>
            <p class="text-xs opacity-60 mt-1">{m.e1_tickets_no_selection_desc()}</p>
          </div>
        {:else}
          <!-- Chat Header -->
          <div class="p-3 lg:p-5 border-b border-outline-variant/10 bg-surface-container/20">
            <div class="flex items-center gap-3">
              <!-- Mobile back button -->
              <button onclick={() => showMobileChat = false} class="lg:hidden p-2 -ml-1 rounded-lg hover:bg-surface-container transition-colors">
                <Papicon icon="arrow-left" size={18} />
              </button>
              {#if selectedTicketDetail?.userAvatar}
                <img src={selectedTicketDetail.userAvatar} alt={selectedTicketDetail.username} class="w-10 h-10 rounded-xl object-cover shadow-inner shrink-0" />
              {:else}
                <div class="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-semibold text-base shadow-inner shrink-0">
                  {selectedTicketDetail?.username?.charAt(0).toUpperCase() || '?'}
                </div>
              {/if}
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="text-sm lg:text-base font-semibold text-on-surface truncate">@{selectedTicketDetail?.username || m.e1_tickets_user_fallback()}</h3>
                  <span class="px-2 py-0.5 rounded-full text-xs font-semibold border {getStatusColor(selectedTicketDetail?.status)}">
                    {getStatusLabel(selectedTicketDetail?.status)}
                  </span>
                  {#if selectedTicketDetail?.mode && selectedTicketDetail.mode !== 'CHANNEL'}
                    <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      {selectedTicketDetail.mode === 'DM' ? m.e1_tickets_mode_dm() : m.e1_tickets_mode_thread()}
                    </span>
                  {/if}
                </div>
                {#if selectedTicketDetail?.claimedByName}
                  <div class="flex items-center gap-1 text-2xs text-primary/80 font-bold">
                    {#if selectedTicketDetail.claimedByAvatar}
                      <img src={selectedTicketDetail.claimedByAvatar} alt={selectedTicketDetail.claimedByName} class="w-4 h-4 rounded-full object-cover" />
                    {/if}
                    {m.e1_tickets_assigned_to({ name: selectedTicketDetail.claimedByName })}
                  </div>
                {/if}
              </div>
            </div>

            {#if selectedTicketDetail}
              <TicketProperties
                ticket={{ ...(selectedInboxRow ?? {}), ...selectedTicketDetail, sla: selectedInboxRow?.sla ?? null }}
                {knownTags}
                onchange={patchSelectedTicket}
              />
            {/if}

            <!-- Demande en attente ou refusée : aucun salon n'existe, l'écran
                 doit dire pourquoi plutôt que rester vide. -->
            {#if selectedTicketDetail?.status === 'PENDING'}
              <div class="mt-3 flex items-start gap-2 p-3 rounded-xl bg-sky-500/5 border border-sky-500/20">
                <Papicon icon="clock" size={14} class="text-sky-400 shrink-0 mt-0.5" />
                <p class="text-2xs text-on-surface-variant">{m.e1_tickets_pending_notice()}</p>
              </div>
            {:else if selectedTicketDetail?.status === 'REJECTED'}
              <div class="mt-3 flex items-start gap-2 p-3 rounded-xl bg-error/5 border border-error/20">
                <Papicon icon="x-circle" size={14} class="text-error shrink-0 mt-0.5" />
                <p class="text-2xs text-on-surface-variant">
                  {m.e1_tickets_rejected_notice({ name: selectedTicketDetail.reviewedByName || '-' })}
                  {#if selectedTicketDetail.rejectionReason}<br />{m.e1_tickets_rejected_reason({ reason: selectedTicketDetail.rejectionReason })}{/if}
                </p>
              </div>
            {/if}

            <!-- Quick actions - scrollable on mobile -->
            <div class="flex items-center gap-2 mt-3 overflow-x-auto pb-1 scrollbar-hide">
              <button
                onclick={() => openMemberCase(selectedTicketDetail.userId, selectedTicketDetail.username)}
                class="px-3 py-1.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg text-xs font-semibold hover:bg-indigo-500 hover:text-white transition-all flex items-center gap-1.5 shrink-0"
              >
                <Papicon icon="shield" size={12} /> {m.e1_tickets_btn_case()}
              </button>

              {#if selectedTicketDetail?.status === 'OPEN'}
                {#if selectedTicketDetail.claimedBy !== authStore.user?.id}
                  <button onclick={claimTicket}
                    class="px-3 py-1.5 bg-warning/10 text-warning border border-warning/20 rounded-lg text-xs font-semibold hover:bg-amber-500 hover:text-white transition-all flex items-center gap-1.5 shrink-0"
                  >
                    <Papicon icon="user-check" size={12} /> {m.e1_tickets_btn_claim()}
                  </button>
                {/if}
                <button onclick={() => showCloseModal = true}
                  class="px-3 py-1.5 bg-error/10 text-error border border-error/20 rounded-lg text-xs font-semibold hover:bg-rose-500 hover:text-white transition-all flex items-center gap-1.5 shrink-0"
                >
                  <Papicon icon="x-circle" size={12} /> {m.e1_tickets_btn_close()}
                </button>
              {/if}

              {#if selectedTicketDetail?.status === 'CLAIMED' && selectedTicketDetail.claimedById !== authStore.user?.id && (config.ticketAllowOverclaim ?? true) && config.ticketOverclaimPermission !== 'NONE'}
                <button onclick={claimTicket}
                  class="px-3 py-1.5 bg-warning/10 text-warning border border-warning/20 rounded-lg text-xs font-semibold hover:bg-amber-500 hover:text-white transition-all flex items-center gap-1.5 shrink-0"
                >
                  <Papicon icon="user-check" size={12} /> {m.e1_tickets_btn_overclaim()}
                </button>
              {/if}

              {#if selectedTicketDetail?.status === 'CLOSED' || selectedTicketDetail?.status === 'ARCHIVED'}
                {#if selectedTicketDetail.channelId}
                  <button onclick={reopenTicket}
                    class="px-3 py-1.5 bg-success/10 text-success border border-success/20 rounded-lg text-xs font-semibold hover:bg-emerald-500 hover:text-white transition-all flex items-center gap-1.5 shrink-0"
                  >
                    <Papicon icon="refresh" size={12} /> {m.e1_tickets_btn_reopen()}
                  </button>

                  <!-- Archiver conserve tout : le salon passe en lecture seule
                       au lieu d'être détruit. C'est l'alternative à Supprimer,
                       posée juste avant lui pour se présenter d'abord. -->
                  {#if selectedTicketDetail.status === 'ARCHIVED'}
                    <button onclick={() => archiveTicket(true)}
                      class="px-3 py-1.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-lg text-xs font-semibold hover:bg-sky-500 hover:text-white transition-all flex items-center gap-1.5 shrink-0"
                    >
                      <Papicon icon="upload" size={12} /> {m.e1_tickets_btn_unarchive()}
                    </button>
                  {:else}
                    <button onclick={() => archiveTicket(false)}
                      class="px-3 py-1.5 bg-slate-500/10 text-on-surface-variant border border-slate-500/20 rounded-lg text-xs font-semibold hover:bg-slate-500 hover:text-white transition-all flex items-center gap-1.5 shrink-0"
                    >
                      <Papicon icon="archive" size={12} /> {m.e1_tickets_btn_archive()}
                    </button>
                  {/if}

                  {#if deletionLock}
                    <button onclick={unlockTicket}
                      class="px-3 py-1.5 bg-warning/10 text-warning border border-warning/20 rounded-lg text-xs font-semibold hover:bg-amber-500 hover:text-white transition-all flex items-center gap-1.5 shrink-0"
                    >
                      <Papicon icon="unlock" size={12} /> {m.e1_tickets_btn_unlock()}
                    </button>
                  {:else}
                    <button onclick={() => showLockModal = true}
                      class="px-3 py-1.5 bg-outline-variant/10 text-on-surface-variant border border-outline-variant/20 rounded-lg text-xs font-semibold hover:bg-on-surface-variant hover:text-surface transition-all flex items-center gap-1.5 shrink-0"
                    >
                      <Papicon icon="lock" size={12} /> {m.e1_tickets_btn_lock()}
                    </button>
                  {/if}

                  <!-- Sous verrou le bouton reste visible mais inerte : le
                       masquer laisserait croire que la suppression n'existe pas. -->
                  <button onclick={() => { if (!deletionLock) showDeleteConfirmModal = true; }}
                    disabled={!!deletionLock}
                    title={deletionLock ? m.e1_tickets_delete_locked_hint() : undefined}
                    class="px-3 py-1.5 rounded-lg text-2xs font-semibold uppercase tracking-wider active:scale-[0.98] transition-all flex items-center gap-1.5 shrink-0 {deletionLock ? 'bg-surface-container text-on-surface-variant/30 border border-outline-variant/10 cursor-not-allowed' : 'bg-rose-600 text-white'}"
                  >
                    <Papicon icon="delete" size={12} /> {m.e1_tickets_btn_delete()}
                  </button>
                {/if}
                {#if selectedTicketDetail?.transcriptId}
                  {@const restoresLeft = 3 - (selectedTicketDetail.restoreCount ?? 0)}
                  <button
                    onclick={() => { if (restoresLeft > 0) showRestoreModal = true; }}
                    disabled={restoresLeft <= 0}
                    title={restoresLeft <= 0 ? m.e1_tickets_restore_limit_tooltip() : m.e1_tickets_restore_left_tooltip({ count: restoresLeft })}
                    class="px-3 py-1.5 rounded-lg text-2xs font-semibold uppercase tracking-wider flex items-center gap-1.5 shrink-0 transition-all {restoresLeft > 0 ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500 hover:text-white cursor-pointer' : 'bg-surface-container text-on-surface-variant/30 border border-outline-variant/10 cursor-not-allowed'}"
                  >
                    <Papicon icon="refresh-ccw" size={12} /> {m.e1_tickets_btn_restore({ left: restoresLeft })}
                  </button>
                {/if}
              {/if}

              {#if selectedTicketDetail?.transcriptId}
                <a href="/transcripts/{selectedTicketDetail.transcriptId}" target="_blank"
                  class="px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg text-xs font-semibold hover:bg-blue-500 hover:text-white transition-all flex items-center gap-1.5 shrink-0"
                >
                  <Papicon icon="external-link" size={12} /> {m.e1_tickets_original_transcript()}
                </a>
              {/if}
            </div>

            {#if deletionLock}
              <div class="mt-3 flex items-start gap-2 p-3 rounded-lg bg-warning/5 border border-warning/20">
                <Papicon icon="lock" size={14} class="text-warning mt-0.5 shrink-0" />
                <div class="text-2xs text-warning/90 leading-relaxed">
                  <p class="font-semibold">
                    {m.e1_tickets_lock_banner()}
                    · {deletionLock.until ? m.e1_tickets_lock_until({ date: new Date(deletionLock.until).toLocaleDateString() }) : m.e1_tickets_lock_permanent()}
                    {#if deletionLock.byName}· {m.e1_tickets_lock_by({ name: deletionLock.byName })}{/if}
                  </p>
                  {#if deletionLock.reason}<p class="mt-0.5 opacity-80">{deletionLock.reason}</p>{/if}
                </div>
              </div>
            {/if}

            {#if selectedTicketDetail?.channelId && selectedTicketDetail?.mode !== 'DM'}
              <div class="mt-3 flex gap-2 items-center">
                <FormInput type="text" bind:value={ticketRenameName} placeholder={m.e1_tickets_rename_ph()} className="flex-1" />
                <button onclick={renameTicket} disabled={renameAction.state.loading || !ticketRenameName.trim()}
                  class="px-3 py-2.5 bg-primary text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                >
                  <Papicon icon="edit" size={12} />
                  {renameAction.state.loading ? '...' : m.e1_tickets_rename_btn()}
                </button>
              </div>
            {/if}
          </div>

          <!-- Chat Messages Container -->
          <div
            bind:this={chatScrollContainer}
            class="flex-1 overflow-y-auto bg-[#313338] scrollbar-hide"
            class:p-4={!selectedTicketDetail?.transcriptId || messages.length > 0}
            class:lg:p-6={!selectedTicketDetail?.transcriptId || messages.length > 0}
            class:space-y-3={!selectedTicketDetail?.transcriptId || messages.length > 0}
          >
            {#if loadingDetail && messages.length === 0}
              <div class="flex items-center justify-center h-full">
                <div class="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
              </div>
            {:else if messages.length === 0}
              <div class="flex flex-col items-center justify-center text-white/30 h-full">
                <Papicon icon="forum" size={28} class="opacity-50 mb-2" />
                <p class="text-xs">{m.e1_tickets_no_message()}</p>
              </div>
            {:else}
              {#each messages as msg (msg.id)}
                <div class="flex items-start gap-2.5 lg:gap-4 p-2 rounded-xl hover:bg-white/5 transition-colors group">
                  <div class="shrink-0">
                    {#if msg.authorAvatar}
                      <img src={msg.authorAvatar} alt="Avatar" class="h-8 w-8 lg:h-10 lg:w-10 rounded-full object-cover border border-white/10" />
                    {:else}
                      <div class="h-8 w-8 lg:h-10 lg:w-10 rounded-full bg-white/10 flex items-center justify-center text-xs lg:text-sm font-semibold text-white/80">
                        {msg.authorName?.slice(0, 1).toUpperCase()}
                      </div>
                    {/if}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-baseline gap-1.5 flex-wrap">
                      <span class="text-xs lg:text-sm font-bold text-white">{msg.authorName || m.e1_tickets_anonymous()}</span>
                      {#if msg.isStaff}
                        <span class="bg-[#5865F2] text-white text-xs lg:text-2xs font-semibold px-1 py-0.5 rounded leading-none">{m.e1_tickets_staff_badge()}</span>
                      {/if}
                      <span class="text-2xs lg:text-2xs text-white/40">{new Date(msg.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {#if msg.htmlContent}
                      <div class="text-xs lg:text-sm text-white/90 mt-1 whitespace-pre-wrap leading-relaxed select-text flex flex-wrap gap-x-1 items-center message-html-content">
                        {@html msg.htmlContent}
                      </div>
                    {:else if msg.content}
                      <p class="text-xs lg:text-sm text-white/90 mt-1 whitespace-pre-wrap leading-relaxed select-text">{msg.content}</p>
                    {/if}

                    {#if msg.mediaUrls && msg.mediaUrls.length > 0}
                      <div class="mt-2 space-y-2">
                        {#each msg.mediaUrls.filter((media: any) => {
                          if (msg.attachments?.some((att: any) => att.url === media.url)) return false;
                          const getFilename = (url: any) => { if (!url) return ''; const clean = url.split('?')[0]; const parts = clean.split('/'); return parts[parts.length - 1] || ''; };
                          const mediaFilename = getFilename(media.url);
                          if (msg.embeds?.some((embed: any) => {
                            const embedUrl = embed.url || ''; const embedImg = embed.image?.url || ''; const embedThumb = embed.thumbnail?.url || ''; const embedVid = embed.video?.url || '';
                            if (embedUrl === media.url || embedImg === media.url || embedThumb === media.url || embedVid === media.url) return true;
                            if (mediaFilename && (getFilename(embedUrl).includes(mediaFilename) || getFilename(embedImg).includes(mediaFilename) || getFilename(embedThumb).includes(mediaFilename) || getFilename(embedVid).includes(mediaFilename))) return true;
                            if (media.url.includes('giphy.com') && (embedUrl.includes('giphy.com') || embedImg.includes('giphy.com') || embedVid.includes('giphy.com') || embedThumb.includes('giphy.com'))) return true;
                            if (media.url.includes('tenor.com') && (embedUrl.includes('tenor.com') || embedImg.includes('tenor.com') || embedVid.includes('tenor.com') || embedThumb.includes('tenor.com'))) return true;
                            return false;
                          })) return false;
                          return true;
                        }) as media}
                          {#if media.type === 'image'}
                            <img src={media.url} alt="media-preview" class="max-w-[80%] lg:max-w-md rounded-lg border border-white/10 max-h-60 object-contain bg-[#1e1f22]" />
                          {:else if media.type === 'video'}
                            <!-- svelte-ignore a11y_media_has_caption -->
                            <video src={media.url} controls class="max-w-[80%] lg:max-w-md rounded-lg border border-white/10 max-h-60 bg-[#1e1f22]"></video>
                          {:else if media.type === 'audio'}
                            <audio src={media.url} controls class="max-w-[80%] lg:max-w-md"></audio>
                          {/if}
                        {/each}
                      </div>
                    {/if}

                    {#if msg.stickers && msg.stickers.length > 0}
                      <div class="mt-2 space-y-2">
                        {#each msg.stickers as sticker}
                          <div class="relative group max-w-[50%]">
                            <img src={sticker.url} alt={sticker.name} class="h-32 w-auto rounded-lg object-contain transition-transform" />
                          </div>
                        {/each}
                      </div>
                    {/if}

                    {#if msg.embeds && msg.embeds.length > 0}
                      <div class="mt-2 space-y-2">
                        {#each msg.embeds as embed}
                          <div class="bg-[#2b2d31] border-l-4 rounded-r-md p-2.5 max-w-full lg:max-w-lg" style="border-left-color: {embed.color || '#1e1f22'}">
                            {#if embed.title}
                              <div class="font-bold text-[#00a8fc] text-xs lg:text-sm mb-1">{embed.title}</div>
                            {/if}
                            {#if embed.htmlDescription}
                              <div class="text-xs lg:text-sm text-white/80 whitespace-pre-wrap leading-relaxed select-text message-html-content">{@html embed.htmlDescription}</div>
                            {:else if embed.description}
                              <div class="text-xs lg:text-sm text-white/80 whitespace-pre-wrap leading-relaxed select-text">{embed.description}</div>
                            {/if}
                            {#if embed.fields && embed.fields.length > 0}
                              <div class="mt-2 flex flex-wrap gap-2">
                                {#each embed.fields as field}
                                  <div class="flex-1 min-w-[45%]">
                                    <div class="text-2xs font-bold text-white/60 uppercase">{field.name}</div>
                                    {#if field.htmlValue}
                                      <div class="text-xs text-white/80 select-text message-html-content">{@html field.htmlValue}</div>
                                    {:else}
                                      <div class="text-xs text-white/80 select-text">{field.value}</div>
                                    {/if}
                                  </div>
                                {/each}
                              </div>
                            {/if}
                            {#if embed.image?.url}
                              <img src={embed.image.url} alt="embed-img" class="mt-2 max-w-full rounded-lg border border-white/10 max-h-60 object-contain bg-[#1e1f22]" />
                            {:else if embed.video?.url}
                              {#if embed.video.url.includes('giphy.com') || embed.video.url.includes('tenor.com') || embed.video.url.includes('gifv')}
                                <video src={embed.video.url} autoplay loop muted playsinline class="mt-2 max-w-full rounded-lg border border-white/10 max-h-60 bg-[#1e1f22]"></video>
                              {:else}
                                <!-- svelte-ignore a11y_media_has_caption -->
                                <video src={embed.video.url} controls class="mt-2 max-w-full rounded-lg border border-white/10 max-h-60 bg-[#1e1f22]"></video>
                              {/if}
                            {:else if embed.thumbnail?.url}
                              <img src={embed.thumbnail.url} alt="embed-thumbnail" class="mt-2 max-w-full rounded-lg border border-white/10 max-h-32 object-contain bg-[#1e1f22]" />
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {/if}

                    {#if msg.attachments && msg.attachments.length > 0}
                      <div class="mt-2 space-y-2">
                        {#each msg.attachments as att}
                          {#if att.contentType?.startsWith('image/')}
                            <img src={att.url} alt="discord-att" class="max-w-[80%] lg:max-w-md rounded-lg border border-white/10 max-h-60 object-cover" />
                          {:else if att.contentType?.startsWith('video/')}
                            <!-- svelte-ignore a11y_media_has_caption -->
                            <video src={att.url} controls class="max-w-[80%] lg:max-w-md rounded-lg border border-white/10 max-h-60"></video>
                          {:else if att.contentType?.startsWith('audio/')}
                            <audio src={att.url} controls class="max-w-[80%] lg:max-w-md"></audio>
                          {:else}
                            <a href={att.url} target="_blank" class="flex items-center gap-2 p-2.5 bg-white/5 border border-white/10 rounded-lg text-xs font-bold text-white hover:bg-white/10 transition-colors w-fit">
                              <Papicon icon="file" size={14} /> {m.e1_tickets_attachment()}
                            </a>
                          {/if}
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>

          <!-- Chat Input Bar -->
          {#if selectedTicketDetail?.status === 'OPEN' || selectedTicketDetail?.status === 'CLAIMED'}
            <div class="p-3 lg:p-4 border-t border-outline-variant/10 bg-surface-container/20 flex gap-2 lg:gap-3">
              <input
                type="text"
                bind:value={chatInput}
                onkeydown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder={m.e1_tickets_message_ph()}
                class="flex-1 bg-surface-container rounded-lg px-4 py-3 focus:outline-hidden border-2 border-transparent focus:border-primary/50 text-sm"
              />
              <button
                onclick={sendMessage}
                disabled={!chatInput.trim()}
                class="w-11 h-11 rounded-lg bg-primary text-white flex items-center justify-center active:scale-[0.98] transition-transform disabled:opacity-50 shrink-0"
              >
                <Papicon icon="send" size={18} />
              </button>
            </div>
          {:else}
            <div class="p-3 lg:p-4 border-t border-outline-variant/10 bg-error/10 text-error flex items-center justify-center text-xs font-medium gap-2">
              <Papicon icon="lock" size={14} /> {m.e1_tickets_closed_banner()}
            </div>
          {/if}
        {/if}
      </div>

    </div>
  {:else if activeTab === 'performance'}
    <TicketPerformance />
  {:else if activeTab === 'config'}
    {#await Promise.all([
      import('../lib/components/SearchableSelect.svelte'),
      import('../lib/components/EmojiPicker.svelte')
    ]) then configComponents}
    {@const SearchableSelect = configComponents[0].default}
    {@const EmojiPicker = configComponents[1].default}
    <!-- Configuration Panel - redesigned sections -->
    <div class="max-w-4xl mx-auto space-y-4">

      <!-- Header actions -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2">
        <div>
          <h3 class="text-lg font-semibold text-on-surface">{m.e1_tickets_config_title()}</h3>
          <p class="text-on-surface-variant text-xs mt-0.5">{m.e1_tickets_config_desc()}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            onclick={runTicketSetup}
            disabled={setupAction.state.loading}
            class="px-4 py-2.5 bg-surface-container-high text-on-surface rounded-xl text-xs font-semibold active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            <Papicon icon="sparkles" size={13} />
            {setupAction.state.loading ? m.e1_tickets_setup_running() : m.e1_tickets_setup()}
          </button>
          <button
            onclick={sendEmbedPanel}
            disabled={sendEmbedAction.state.loading || !ticketChannelId}
            class="px-4 py-2.5 bg-primary text-white rounded-xl text-xs font-semibold active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            <Papicon icon="send" size={13} />
            {sendEmbedAction.state.loading ? m.e1_tickets_sending() : m.e1_tickets_send_embed()}
          </button>
        </div>
      </div>

      <!-- ─── Préparation ────────────────────────────────────────────────
           Les trois réglages sans lesquels un membre ne peut pas ouvrir de
           ticket, séparés de la trentaine d'options d'affinage qui suivent.
           Ils étaient noyés dans le premier accordéon, replié par défaut. -->
      {#if configBlockers.length > 0}
        <div class="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3.5">
          <div class="flex items-start gap-3">
            <Papicon icon="alert-triangle" size={16} class="text-warning mt-0.5 shrink-0" />
            <div class="min-w-0">
              <p class="text-body-sm font-semibold text-on-surface">
                Les tickets ne sont pas encore opérationnels
              </p>
              <p class="text-xs text-on-surface-variant mt-1 leading-relaxed">
                Il manque {configBlockers.length === 1 ? 'un réglage' : `${configBlockers.length} réglages`} :
                {configBlockers.map((b) => b.label).join(', ')}.
                Un membre qui clique sur le panneau n'obtiendra rien tant qu'ils ne sont pas remplis.
              </p>
              <button
                type="button"
                class="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25 transition-colors"
                onclick={() => (expandedConfigSection = 'channels')}
              >
                <Papicon icon="arrow-right" size={13} />
                Compléter
              </button>
            </div>
          </div>
        </div>
      {:else}
        <div class="rounded-xl border border-success/25 bg-success/5 px-4 py-3 flex items-center gap-3">
          <Papicon icon="check-circle" size={16} class="text-success shrink-0" />
          <p class="text-xs text-on-surface">
            Les tickets sont opérationnels. Le reste de cette page en affine le comportement.
          </p>
        </div>
      {/if}

      <!-- ─── Section 1: Salons & Rôles ──────────────────────────────────── -->
      <div data-guide="tickets-channels" class="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 overflow-hidden">
        <button onclick={() => toggleConfigSection('channels')} class="w-full flex items-center justify-between p-4 lg:p-5 hover:bg-white/3 transition-colors text-left">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-success/10 text-success flex items-center justify-center shrink-0">
              <Papicon icon="hash" size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-on-surface">{m.e1_tickets_sec_channels_title()}</p>
              <p class="text-2xs text-on-surface-variant/60 mt-0.5">{m.e1_tickets_sec_channels_desc()}</p>
            </div>
          </div>
          <Papicon icon={expandedConfigSection === 'channels' ? 'chevron-up' : 'chevron-down'} size={16} class="text-on-surface-variant/40 shrink-0" />
        </button>
        {#if expandedConfigSection === 'channels'}
          <div class="px-4 lg:px-5 pb-5 space-y-4 border-t border-outline-variant/10 pt-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_category()}</span>
                <SearchableSelect bind:value={ticketCategoryId} options={discordCategories.map(c => ({ id: c.id, name: c.name }))} placeholder={m.e1_tickets_select_ph()} className="w-full" />
                {#if isMissingReference(ticketCategoryId, discordCategories)}
                  <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
                {/if}
              </label>
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_panel_channel()}</span>
                <SearchableSelect bind:value={ticketChannelId} options={discordChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.e1_tickets_select_ph()} className="w-full" />
                {#if isMissingReference(ticketChannelId, discordChannels)}
                  <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
                {/if}
              </label>
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_log_channel()}</span>
                <SearchableSelect bind:value={ticketLogChannelId} options={discordChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.e1_tickets_select_ph()} className="w-full" />
                {#if isMissingReference(ticketLogChannelId, discordChannels)}
                  <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
                {/if}
              </label>
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_staff_role()}</span>
                <SearchableSelect bind:value={ticketStaffRoleId} options={discordRoles.map(r => ({ id: r.id, name: `@${r.name}` }))} placeholder={m.e1_tickets_select_ph()} className="w-full" />
                {#if isMissingReference(ticketStaffRoleId, discordRoles)}
                  <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
                {/if}
              </label>
              <label class="block col-span-1 md:col-span-2">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_dm_relay()}</span>
                <SearchableSelect bind:value={ticketDmRelayChannelId} options={discordChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.e1_tickets_select_channel_ph()} className="w-full" />
                {#if isMissingReference(ticketDmRelayChannelId, discordChannels)}
                  <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
                {/if}
              </label>
            </div>

            <div class="border-t border-outline-variant/10 pt-4 space-y-3">
              <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                <input type="checkbox" bind:checked={ticketAllowOverclaim} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                <div>
                  <span class="text-xs font-bold text-on-surface">{m.e1_tickets_overclaim_label()}</span>
                  <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_overclaim_desc()}</p>
                </div>
              </label>
              {#if ticketAllowOverclaim}
                <label class="block ml-7">
                  <span class="text-xs font-bold text-on-surface-variant/80 mb-2 block">{m.e1_tickets_overclaim_who()}</span>
                  <FormSelect bind:value={ticketOverclaimPermission} className="w-full">
                    <option value="ANY">{m.e1_tickets_overclaim_any()}</option>
                    <option value="SUPERIOR_OR_EQUAL">{m.e1_tickets_overclaim_superior()}</option>
                  </FormSelect>
                </label>
              {/if}
              <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                <input type="checkbox" bind:checked={ticketAutoClaimOnReply} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                <div>
                  <span class="text-xs font-bold text-on-surface">{m.e1_tickets_autoclaim_label()}</span>
                  <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_autoclaim_desc()}</p>
                </div>
              </label>
            </div>
          </div>
        {/if}
      </div>

      <!-- ─── Section 3: Personnalisation Embed ──────────────────────────── -->
      <div class="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 overflow-hidden">
        <button onclick={() => toggleConfigSection('embed')} class="w-full flex items-center justify-between p-4 lg:p-5 hover:bg-white/3 transition-colors text-left">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
              <Papicon icon="palette" size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-on-surface">{m.e1_tickets_sec_embed_title()}</p>
              <p class="text-2xs text-on-surface-variant/60 mt-0.5">{m.e1_tickets_sec_embed_desc()}</p>
            </div>
          </div>
          <Papicon icon={expandedConfigSection === 'embed' ? 'chevron-up' : 'chevron-down'} size={16} class="text-on-surface-variant/40 shrink-0" />
        </button>
        {#if expandedConfigSection === 'embed'}
          <div class="px-4 lg:px-5 pb-5 space-y-4 border-t border-outline-variant/10 pt-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_title()}</span>
                <FormInput type="text" bind:value={ticketEmbedTitle} placeholder={m.e1_tickets_embed_title_ph()} className="w-full" />
              </label>
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_button_text()}</span>
                <FormInput type="text" bind:value={ticketEmbedButtonText} placeholder={m.e1_tickets_embed_button_ph()} className="w-full" />
              </label>
            </div>
            <label class="block">
              <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_description()}</span>
              <FormTextarea bind:value={ticketEmbedDesc} placeholder={m.e1_tickets_embed_desc_ph()} className="w-full h-20" />
              <p class="text-2xs text-on-surface-variant/50 mt-1.5">{m.e1_tickets_default_hint()}</p>
            </label>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_thumbnail()}</span>
                <FormInput type="text" bind:value={ticketEmbedThumbnail} placeholder="https://..." className="w-full" />
              </label>
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_image()}</span>
                <FormInput type="text" bind:value={ticketEmbedImage} placeholder="https://..." className="w-full" />
              </label>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_author_name()}</span>
                <FormInput type="text" bind:value={ticketEmbedAuthorName} placeholder={m.e1_tickets_embed_author_ph()} className="w-full" />
              </label>
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_author_icon()}</span>
                <FormInput type="text" bind:value={ticketEmbedAuthorIcon} placeholder="https://..." className="w-full" />
              </label>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_color()}</span>
                <FormColorPicker bind:value={ticketEmbedColor} />
              </label>
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_footer()}</span>
                <FormInput type="text" bind:value={ticketEmbedFooter} placeholder={m.e1_tickets_embed_footer_ph()} className="w-full" />
              </label>
            </div>

            <div class="border-t border-outline-variant/10 pt-4">
              <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-3 block">{m.e1_tickets_interaction_type()}</span>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {#each [
                  { value: 'BUTTONS', label: m.e1_tickets_interaction_buttons(), icon: 'mouse-pointer', desc: m.e1_tickets_interaction_buttons_desc() },
                  { value: 'DROPDOWN', label: m.e1_tickets_interaction_dropdown(), icon: 'list', desc: m.e1_tickets_interaction_dropdown_desc() }
                ] as typeOption}
                  <button
                    onclick={() => ticketEmbedType = typeOption.value as any}
                    class="p-4 rounded-xl border-2 text-left transition-all {ticketEmbedType === typeOption.value ? 'border-primary bg-primary/5' : 'border-outline-variant/10 hover:border-outline-variant/30 bg-surface-container/20'}"
                  >
                    <div class="flex items-center gap-2.5 mb-2">
                      <div class="w-8 h-8 rounded-lg flex items-center justify-center {ticketEmbedType === typeOption.value ? 'bg-primary/15 text-primary' : 'bg-surface-container text-on-surface-variant/50'}">
                        <Papicon icon={typeOption.icon} size={16} />
                      </div>
                      <span class="text-sm font-semibold {ticketEmbedType === typeOption.value ? 'text-primary' : 'text-on-surface'}">{typeOption.label}</span>
                    </div>
                    <p class="text-2xs text-on-surface-variant/60 leading-relaxed">{typeOption.desc}</p>
                  </button>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- ─── Section: Message d'accueil dans le ticket ──────────────────────────── -->
      <div class="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 overflow-hidden">
        <button onclick={() => toggleConfigSection('welcome')} class="w-full flex items-center justify-between p-4 lg:p-5 hover:bg-white/3 transition-colors text-left">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
              <Papicon icon="message-square" size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-on-surface">{m.e1_tickets_sec_welcome_title()}</p>
              <p class="text-2xs text-on-surface-variant/60 mt-0.5">{m.e1_tickets_sec_welcome_desc()}</p>
            </div>
          </div>
          <Papicon icon={expandedConfigSection === 'welcome' ? 'chevron-up' : 'chevron-down'} size={16} class="text-on-surface-variant/40 shrink-0" />
        </button>
        {#if expandedConfigSection === 'welcome'}
          <div class="px-4 lg:px-5 pb-5 space-y-4 border-t border-outline-variant/10 pt-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="block col-span-1 md:col-span-2">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_welcome_title_label()}</span>
                <FormInput type="text" bind:value={ticketWelcomeTitle} placeholder={m.e1_tickets_welcome_title_ph({ type_label: '{type_label}' })} className="w-full" />
              </label>
            </div>
            <label class="block">
              <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_welcome_desc_label()}</span>
              <FormTextarea bind:value={ticketWelcomeDesc} placeholder={m.e1_tickets_welcome_desc_ph({ user: '{user}', staff_mention: '{staff_mention}' })} className="w-full h-32" />
              <p class="text-2xs text-on-surface-variant/50 mt-1.5">{m.e1_tickets_default_hint()}</p>
            </label>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_thumbnail()}</span>
                <FormInput type="text" bind:value={ticketWelcomeThumbnail} placeholder="https://..." className="w-full" />
              </label>
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_image()}</span>
                <FormInput type="text" bind:value={ticketWelcomeImage} placeholder="https://..." className="w-full" />
              </label>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_embed_color()}</span>
                <FormColorPicker bind:value={ticketWelcomeColor} />
              </label>
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_field_footer()}</span>
                <FormInput type="text" bind:value={ticketWelcomeFooter} placeholder={m.e1_tickets_welcome_footer_ph({ ticket_id: '{ticket_id}' })} className="w-full" />
              </label>
            </div>
          </div>
        {/if}
      </div>

      <!-- ─── Section : Validation & verrouillage ────────────────────────── -->
      <div class="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 overflow-hidden">
        <button onclick={() => toggleConfigSection('gatekeeping')} class="w-full flex items-center justify-between p-4 lg:p-5 hover:bg-white/3 transition-colors text-left">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
              <Papicon icon="shield" size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-on-surface">{m.e1_tickets_sec_gatekeeping_title()}</p>
              <p class="text-2xs text-on-surface-variant/60 mt-0.5">{m.e1_tickets_sec_gatekeeping_desc()}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {#if ticketLockUntilClaim || ticketApprovalEnabled}
              <span class="px-2 py-0.5 rounded-full text-2xs font-semibold uppercase bg-success/10 text-success border border-success/20">{m.e1_tickets_active_badge()}</span>
            {/if}
            <Papicon icon={expandedConfigSection === 'gatekeeping' ? 'chevron-up' : 'chevron-down'} size={16} class="text-on-surface-variant/40" />
          </div>
        </button>
        {#if expandedConfigSection === 'gatekeeping'}
          <div class="px-4 lg:px-5 pb-5 space-y-4 border-t border-outline-variant/10 pt-4">
            <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
              <input type="checkbox" bind:checked={ticketLockUntilClaim} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
              <div>
                <span class="text-xs font-bold text-on-surface">{m.e1_tickets_lock_until_claim()}</span>
                <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_lock_until_claim_desc()}</p>
              </div>
            </label>

            <div class="border-t border-outline-variant/10 pt-4 space-y-3">
              <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                <input type="checkbox" bind:checked={ticketApprovalEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                <div>
                  <span class="text-xs font-bold text-on-surface">{m.e1_tickets_approval_enable()}</span>
                  <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_approval_enable_desc()}</p>
                </div>
              </label>
              {#if ticketApprovalEnabled}
                <label class="block ml-7">
                  <span class="text-xs font-bold text-on-surface-variant/80 mb-2 block">{m.e1_tickets_approval_channel()}</span>
                  <SearchableSelect bind:value={ticketApprovalChannelId} options={discordChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.e1_tickets_approval_channel_ph()} className="w-full" />
                  {#if isMissingReference(ticketApprovalChannelId, discordChannels)}
                    <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
                  {/if}
                  <p class="text-2xs text-on-surface-variant/50 mt-1.5">{m.e1_tickets_approval_channel_hint()}</p>
                </label>
              {/if}
            </div>

            <p class="text-2xs text-on-surface-variant/50 border-t border-outline-variant/10 pt-3">{m.e1_tickets_gatekeeping_override_hint()}</p>
          </div>
        {/if}
      </div>

      <!-- ─── Section : Archivage & historique côté membre ───────────────── -->
      <div class="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 overflow-hidden">
        <button onclick={() => toggleConfigSection('archive')} class="w-full flex items-center justify-between p-4 lg:p-5 hover:bg-white/3 transition-colors text-left">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-slate-500/10 text-on-surface-variant flex items-center justify-center shrink-0">
              <Papicon icon="archive" size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-on-surface">{m.e1_tickets_cfg_archive_title()}</p>
              <p class="text-2xs text-on-surface-variant/60 mt-0.5">{m.e1_tickets_cfg_archive_desc()}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {#if ticketArchiveCategoryId || ticketHistoryPanelEnabled}
              <span class="px-2 py-0.5 rounded-full text-2xs font-semibold uppercase bg-success/10 text-success border border-success/20">{m.e1_tickets_active_badge()}</span>
            {/if}
            <Papicon icon={expandedConfigSection === 'archive' ? 'chevron-up' : 'chevron-down'} size={16} class="text-on-surface-variant/40" />
          </div>
        </button>
        {#if expandedConfigSection === 'archive'}
          <div class="px-4 lg:px-5 pb-5 space-y-4 border-t border-outline-variant/10 pt-4">
            <label class="block">
              <span class="text-xs font-bold text-on-surface-variant/80 mb-2 block">{m.e1_tickets_cfg_archive_category()}</span>
              <SearchableSelect bind:value={ticketArchiveCategoryId} options={discordCategories.map(c => ({ id: c.id, name: c.name }))} placeholder={m.e1_tickets_select_ph()} className="w-full" />
              {#if isMissingReference(ticketArchiveCategoryId, discordCategories)}
                <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
              {/if}
              <p class="text-2xs text-on-surface-variant/50 mt-1.5">{m.e1_tickets_cfg_archive_category_hint()}</p>
            </label>

            <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
              <input type="checkbox" bind:checked={ticketArchiveKeepOpenerView} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
              <div>
                <span class="text-xs font-bold text-on-surface">{m.e1_tickets_cfg_archive_keep_view()}</span>
                <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_cfg_archive_keep_view_desc()}</p>
              </div>
            </label>

            <div class="border-t border-outline-variant/10 pt-4 space-y-3">
              <div>
                <p class="text-xs font-bold text-on-surface">{m.e1_tickets_cfg_history_title()}</p>
                <p class="text-2xs text-on-surface-variant/60 mt-0.5">{m.e1_tickets_cfg_history_desc()}</p>
              </div>

              <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                <input type="checkbox" bind:checked={ticketHistoryPanelEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                <div>
                  <span class="text-xs font-bold text-on-surface">{m.e1_tickets_cfg_history_panel()}</span>
                  <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_cfg_history_panel_desc()}</p>
                </div>
              </label>

              {#if ticketHistoryPanelEnabled}
                <div class="ml-7 space-y-3">
                  <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                    <input type="checkbox" bind:checked={ticketSelfReopenEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                    <div>
                      <span class="text-xs font-bold text-on-surface">{m.e1_tickets_cfg_self_reopen()}</span>
                      <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_cfg_self_reopen_desc()}</p>
                    </div>
                  </label>
                  <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                    <input type="checkbox" bind:checked={ticketSelfDeleteEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                    <div>
                      <span class="text-xs font-bold text-on-surface">{m.e1_tickets_cfg_self_delete()}</span>
                      <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_cfg_self_delete_desc()}</p>
                    </div>
                  </label>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <!-- ─── Section 4: Inactivité ──────────────────────────────────────── -->
      <div class="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 overflow-hidden">
        <button onclick={() => toggleConfigSection('inactivity')} class="w-full flex items-center justify-between p-4 lg:p-5 hover:bg-white/3 transition-colors text-left">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-warning/10 text-warning flex items-center justify-center shrink-0">
              <Papicon icon="clock" size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-on-surface">{m.e1_tickets_sec_inactivity_title()}</p>
              <p class="text-2xs text-on-surface-variant/60 mt-0.5">{m.e1_tickets_sec_inactivity_desc()}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {#if ticketInactivityEnabled}
              <span class="px-2 py-0.5 rounded-full text-2xs font-semibold uppercase bg-success/10 text-success border border-success/20">{m.e1_tickets_active_badge()}</span>
            {/if}
            <Papicon icon={expandedConfigSection === 'inactivity' ? 'chevron-up' : 'chevron-down'} size={16} class="text-on-surface-variant/40" />
          </div>
        </button>
        {#if expandedConfigSection === 'inactivity'}
          <div class="px-4 lg:px-5 pb-5 space-y-4 border-t border-outline-variant/10 pt-4">
            <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
              <input type="checkbox" bind:checked={ticketInactivityEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
              <div>
                <span class="text-xs font-bold text-on-surface">{m.e1_tickets_enable_reminders()}</span>
                <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_reminders_desc()}</p>
              </div>
            </label>
            {#if ticketInactivityEnabled}
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <label class="block">
                  <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_delay_hours()}</span>
                  <input type="number" bind:value={ticketInactivityHours} min={1} max={168} class="w-full bg-surface-container-high text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 focus:ring-1 ring-primary/30 transition-all outline-none" />
                </label>
                <label class="block sm:col-span-2">
                  <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_inactivity_message_label()}</span>
                  <FormTextarea bind:value={ticketInactivityMessage} placeholder={m.e1_tickets_inactivity_ph({ user: '{user}' })} className="w-full h-20" />
                </label>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- ─── Objectifs de service ───────────────────────────────────────── -->
      <div class="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 overflow-hidden">
        <button onclick={() => toggleConfigSection('sla')} class="w-full flex items-center justify-between p-4 lg:p-5 hover:bg-white/3 transition-colors text-left">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Papicon icon="timer" size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-on-surface">{m.th_sla_section_title()}</p>
              <p class="text-2xs text-on-surface-variant mt-0.5">{m.th_sla_section_desc()}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {#if ticketSlaFirstResponseMinutes || ticketSlaResolutionHours}
              <span class="px-2 py-0.5 rounded-full text-2xs font-semibold bg-success/10 text-success border border-success/20">{m.e1_tickets_active_badge()}</span>
            {/if}
            <Papicon icon={expandedConfigSection === 'sla' ? 'chevron-up' : 'chevron-down'} size={16} class="text-on-surface-variant/40" />
          </div>
        </button>
        {#if expandedConfigSection === 'sla'}
          <div class="px-4 lg:px-5 pb-5 space-y-4 border-t border-outline-variant/10 pt-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label class="block">
                <span class="text-xs font-semibold text-on-surface-variant ml-1 mb-2 block">{m.th_sla_first_label()}</span>
                <input type="number" min="1" max="10080" placeholder={m.th_sla_none_placeholder()} bind:value={ticketSlaFirstResponseMinutes} class="input" />
                <span class="text-2xs text-on-surface-variant ml-1 mt-1 block">{m.th_sla_first_hint()}</span>
              </label>
              <label class="block">
                <span class="text-xs font-semibold text-on-surface-variant ml-1 mb-2 block">{m.th_sla_resolution_label()}</span>
                <input type="number" min="1" max="720" placeholder={m.th_sla_none_placeholder()} bind:value={ticketSlaResolutionHours} class="input" />
                <span class="text-2xs text-on-surface-variant ml-1 mt-1 block">{m.th_sla_resolution_hint()}</span>
              </label>
            </div>
          </div>
        {/if}
      </div>

      <!-- ─── Quotas ─────────────────────────────────────────────────────── -->
      <div data-guide="tickets-quotas" class="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 overflow-hidden">
        <button onclick={() => toggleConfigSection('quotas')} class="w-full flex items-center justify-between p-4 lg:p-5 hover:bg-white/3 transition-colors text-left">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
              <Papicon icon="gauge" size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-on-surface">Quotas</p>
              <p class="text-2xs text-on-surface-variant/60 mt-0.5">Limites d'ouverture côté membre, plafond de charge côté staff</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {#if activeQuotaCount > 0}
              <span class="px-2 py-0.5 rounded-full text-2xs font-semibold uppercase bg-success/10 text-success border border-success/20">
                {activeQuotaCount} actif{activeQuotaCount > 1 ? 's' : ''}
              </span>
            {/if}
            <Papicon icon={expandedConfigSection === 'quotas' ? 'chevron-up' : 'chevron-down'} size={16} class="text-on-surface-variant/40" />
          </div>
        </button>
        {#if expandedConfigSection === 'quotas'}
          <div class="px-4 lg:px-5 pb-5 space-y-4 border-t border-outline-variant/10 pt-4">
            <p class="text-2xs text-on-surface-variant/70 leading-relaxed">
              Chaque quota s'active indépendamment. Décoché, il n'impose aucune limite.
              Un type de ticket peut ajuster le seuil depuis l'onglet Types.
            </p>

            <div class="border-t border-outline-variant/10 pt-4 space-y-3">
              <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                <input type="checkbox" bind:checked={ticketQuotaOpenEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                <div>
                  <span class="text-xs font-bold text-on-surface">Tickets ouverts simultanément</span>
                  <p class="text-2xs text-on-surface-variant/60">Nombre de tickets qu'un membre peut avoir en cours en même temps.</p>
                </div>
              </label>
              {#if ticketQuotaOpenEnabled}
                <label class="block ml-7 max-w-[220px]">
                  <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">Maximum par membre</span>
                  <input type="number" bind:value={ticketQuotaOpenMax} min={1} max={50} class="w-full bg-surface-container-high text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 focus:ring-1 ring-primary/30 transition-all outline-none" />
                </label>
              {/if}
            </div>

            <div class="border-t border-outline-variant/10 pt-4 space-y-3">
              <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                <input type="checkbox" bind:checked={ticketQuotaCooldownEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                <div>
                  <span class="text-xs font-bold text-on-surface">Délai entre deux ouvertures</span>
                  <p class="text-2xs text-on-surface-variant/60">Empêche d'enchaîner les tickets sans laisser le temps de répondre.</p>
                </div>
              </label>
              {#if ticketQuotaCooldownEnabled}
                <label class="block ml-7 max-w-[220px]">
                  <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">Délai (minutes)</span>
                  <input type="number" bind:value={ticketQuotaCooldownMinutes} min={1} max={10080} class="w-full bg-surface-container-high text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 focus:ring-1 ring-primary/30 transition-all outline-none" />
                </label>
              {/if}
            </div>

            <div class="border-t border-outline-variant/10 pt-4 space-y-3">
              <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                <input type="checkbox" bind:checked={ticketQuotaPeriodEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                <div>
                  <span class="text-xs font-bold text-on-surface">Quota sur une période</span>
                  <p class="text-2xs text-on-surface-variant/60">Plafonne le nombre d'ouvertures sur une fenêtre glissante.</p>
                </div>
              </label>
              {#if ticketQuotaPeriodEnabled}
                <div class="ml-7 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[460px]">
                  <label class="block">
                    <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">Tickets maximum</span>
                    <input type="number" bind:value={ticketQuotaPeriodMax} min={1} max={500} class="w-full bg-surface-container-high text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 focus:ring-1 ring-primary/30 transition-all outline-none" />
                  </label>
                  <label class="block">
                    <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">Sur (heures)</span>
                    <input type="number" bind:value={ticketQuotaPeriodHours} min={1} max={720} class="w-full bg-surface-container-high text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 focus:ring-1 ring-primary/30 transition-all outline-none" />
                  </label>
                </div>
              {/if}
            </div>

            <div class="border-t border-outline-variant/10 pt-4 space-y-3">
              <div>
                <p class="text-xs font-bold text-on-surface">Charge maximale par modérateur</p>
                <p class="text-2xs text-on-surface-variant/60 mt-0.5">
                  Tickets pris en charge et encore ouverts. Au-delà, le staff est averti ou refusé.
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                {#each STAFF_LOAD_MODES as opt (opt.value)}
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded-lg text-2xs font-semibold border transition-colors
                    {ticketQuotaStaffLoadMode === opt.value
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'bg-surface-container-high border-outline-variant/20 text-on-surface-variant hover:text-on-surface'}"
                    onclick={() => (ticketQuotaStaffLoadMode = opt.value)}
                  >
                    {opt.label}
                  </button>
                {/each}
              </div>
              {#if ticketQuotaStaffLoadMode !== 'OFF'}
                <div class="space-y-3">
                  <label class="block max-w-[220px]">
                    <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">Tickets par modérateur</span>
                    <input type="number" bind:value={ticketQuotaStaffLoadMax} min={1} max={200} class="w-full bg-surface-container-high text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 focus:ring-1 ring-primary/30 transition-all outline-none" />
                  </label>
                  <div>
                    <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-1 block">Rôles qui passent outre</span>
                    <p class="text-2xs text-on-surface-variant/60 ml-1 mb-2">
                      Sans eux, un serveur dont tout le staff est plein ne peut plus prendre aucun ticket.
                    </p>
                    <MultiSelect
                      bind:values={ticketQuotaStaffLoadBypassRoleIds}
                      options={discordRoles.map(r => ({ id: r.id, name: `@${r.name}` }))}
                      placeholder="Aucun rôle"
                    />
                  </div>
                </div>
              {/if}
            </div>

            <div class="border-t border-outline-variant/10 pt-4 space-y-3">
              <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                <input type="checkbox" bind:checked={ticketQuotaReopenEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                <div>
                  <span class="text-xs font-bold text-on-surface">Limiter les réouvertures</span>
                  <p class="text-2xs text-on-surface-variant/60">
                    Nombre de fois qu'un même ticket peut être rouvert. Les délais entre deux réouvertures
                    (24 h, puis 7 jours) s'appliquent quoi qu'il arrive.
                  </p>
                </div>
              </label>
              {#if ticketQuotaReopenEnabled}
                <label class="block ml-7 max-w-[220px]">
                  <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">Réouvertures maximum</span>
                  <input type="number" bind:value={ticketQuotaReopenMax} min={1} max={50} class="w-full bg-surface-container-high text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 focus:ring-1 ring-primary/30 transition-all outline-none" />
                </label>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <!-- ─── Section 5: Sondage de satisfaction ─────────────────────────── -->
      <div class="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 overflow-hidden">
        <button onclick={() => toggleConfigSection('satisfaction')} class="w-full flex items-center justify-between p-4 lg:p-5 hover:bg-white/3 transition-colors text-left">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-success/10 text-success flex items-center justify-center shrink-0">
              <Papicon icon="smile" size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-on-surface">{m.e1_tickets_sec_satisfaction_title()}</p>
              <p class="text-2xs text-on-surface-variant/60 mt-0.5">{m.e1_tickets_sec_satisfaction_desc()}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {#if ticketSatisfactionCommentEnabled || ticketSatisfactionLogChannelId}
              <span class="px-2 py-0.5 rounded-full text-2xs font-semibold uppercase bg-success/10 text-success border border-success/20">{m.e1_tickets_active_badge()}</span>
            {/if}
            <Papicon icon={expandedConfigSection === 'satisfaction' ? 'chevron-up' : 'chevron-down'} size={16} class="text-on-surface-variant/40" />
          </div>
        </button>
        {#if expandedConfigSection === 'satisfaction'}
          <div class="px-4 lg:px-5 pb-5 space-y-4 border-t border-outline-variant/10 pt-4">
            <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
              <input type="checkbox" bind:checked={ticketSatisfactionCommentEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
              <div>
                <span class="text-xs font-bold text-on-surface">{m.e1_tickets_sat_comment_enable()}</span>
                <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_sat_comment_enable_desc()}</p>
              </div>
            </label>
            {#if ticketSatisfactionCommentEnabled}
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <label class="block sm:col-span-2">
                  <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_sat_comment_question_label()}</span>
                  <FormInput type="text" bind:value={ticketSatisfactionCommentQuestion} placeholder={m.e1_tickets_sat_comment_question_ph()} className="w-full" />
                </label>
                <label class="block">
                  <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_sat_comment_timeout_label()}</span>
                  <input type="number" bind:value={ticketSatisfactionCommentTimeout} min={30} max={900} step={10} class="w-full bg-surface-container-high text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 focus:ring-1 ring-primary/30 transition-all outline-none" />
                </label>
              </div>
              <p class="text-2xs text-on-surface-variant/50 ml-1">{m.e1_tickets_sat_comment_hint()}</p>
            {/if}

            <div class="pt-2 border-t border-outline-variant/10 space-y-4">
              <label class="block">
                <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_sat_log_label()}</span>
                <SearchableSelect bind:value={ticketSatisfactionLogChannelId} options={discordChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.e1_tickets_select_ph()} className="w-full" />
                {#if isMissingReference(ticketSatisfactionLogChannelId, discordChannels)}
                  <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
                {/if}
                <p class="text-2xs text-on-surface-variant/50 ml-1 mt-1.5">{m.e1_tickets_sat_log_desc()}</p>
              </label>
              {#if ticketSatisfactionLogChannelId}
                <label class="flex items-center gap-3 cursor-pointer p-2.5 hover:bg-white/5 rounded-xl transition-colors">
                  <input type="checkbox" bind:checked={ticketSatisfactionLogAnonymous} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                  <div>
                    <span class="text-xs font-bold text-on-surface">{m.e1_tickets_sat_log_anonymous()}</span>
                    <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_sat_log_anonymous_desc()}</p>
                  </div>
                </label>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <!-- ─── Section 2: Types de tickets ────────────────────────────────── -->
      <div class="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 overflow-hidden">
        <button onclick={() => toggleConfigSection('types')} class="w-full flex items-center justify-between p-4 lg:p-5 hover:bg-white/3 transition-colors text-left">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-error/10 text-error flex items-center justify-center shrink-0">
              <Papicon icon="layers" size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-on-surface">{m.e1_tickets_sec_types_title()}</p>
              <p class="text-2xs text-on-surface-variant/60 mt-0.5">{m.e1_tickets_sec_types_desc({ count: ticketTypes.length })}</p>
            </div>
          </div>
          <Papicon icon={expandedConfigSection === 'types' ? 'chevron-up' : 'chevron-down'} size={16} class="text-on-surface-variant/40 shrink-0" />
        </button>
        {#if expandedConfigSection === 'types'}
          <div class="px-4 lg:px-5 pb-5 border-t border-outline-variant/10 pt-4 space-y-4">
            <div class="flex justify-end">
              <button onclick={addTicketType}
                class="px-3 py-2 bg-primary text-white rounded-lg text-xs font-semibold active:scale-[0.98] transition-transform flex items-center gap-1.5"
              >
                <Papicon icon="plus" size={13} /> {m.e1_tickets_add_type()}
              </button>
            </div>

            <div class="space-y-3">
              {#each ticketTypes as ticketType, index}
                {@const isExpanded = expandedTicketTypeIndex === index}
                <div class="rounded-xl border transition-all {isExpanded ? 'border-primary/40 bg-surface-container/35 shadow-sm' : 'border-outline-variant/10 bg-surface-container/15 hover:border-outline-variant/20'}">
                  
                  <!-- Accordion Header -->
                  <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-3.5 gap-3">
                    <button
                      onclick={() => expandedTicketTypeIndex = isExpanded ? null : index}
                      class="flex-1 flex flex-wrap items-center gap-2.5 text-left outline-none"
                    >
                      <span class="text-lg shrink-0">{ticketType.emoji || '📩'}</span>
                      <div class="min-w-0 flex-1">
                        <span class="text-sm font-semibold text-on-surface block truncate">{ticketType.label || `Type #${index + 1}`}</span>
                        
                        <!-- Badges summary of configuration -->
                        <div class="flex flex-wrap items-center gap-1.5 mt-1">
                          <!-- Mode badge -->
                          {#if ticketType.mode === 'CHANNEL'}
                            <span class="px-1.5 py-0.5 rounded text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/15">{m.e1_tickets_badge_channel()}</span>
                          {:else if ticketType.mode === 'DM'}
                            <span class="px-1.5 py-0.5 rounded text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/15">{m.e1_tickets_badge_dm()}</span>
                          {:else if ticketType.mode === 'THREAD'}
                            <span class="px-1.5 py-0.5 rounded text-xs font-semibold bg-warning/10 text-warning border border-warning/15">{m.e1_tickets_badge_thread()}</span>
                          {:else}
                            <span class="px-1.5 py-0.5 rounded text-xs font-semibold bg-surface-container-high text-on-surface-variant/60 border border-outline-variant/10">{m.e1_tickets_badge_global_mode()}</span>
                          {/if}

                          <!-- Staff Role Badge -->
                          {#if ticketType.staffRoleId}
                            {@const role = discordRoles.find(r => r.id === ticketType.staffRoleId)}
                            <span class="px-1.5 py-0.5 rounded text-2xs font-semibold tracking-wider bg-success/10 text-success border border-success/15">Staff: @{role?.name || m.e1_tickets_unknown_role()}</span>
                          {:else}
                            <span class="px-1.5 py-0.5 rounded text-2xs font-semibold tracking-wider bg-surface-container-high text-on-surface-variant/40 border border-outline-variant/10">{m.e1_tickets_badge_inherited_staff()}</span>
                          {/if}

                          <!-- Form Enabled Badge -->
                          {#if ticketType.formEnabled}
                            <span class="px-1.5 py-0.5 rounded text-2xs font-semibold tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/15">{m.e1_tickets_badge_form_with_questions({ count: (ticketType.formCustomFields || []).length })}</span>
                          {:else}
                            <span class="px-1.5 py-0.5 rounded text-2xs font-semibold tracking-wider bg-surface-container-high text-on-surface-variant/40 border border-outline-variant/10">{m.e1_tickets_badge_direct_creation()}</span>
                          {/if}
                        </div>
                      </div>
                    </button>

                    <!-- Reorder & Delete actions in header -->
                    <div class="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      <!-- Reordering buttons -->
                      <button
                        onclick={() => moveTicketType(index, 'UP')}
                        disabled={index === 0}
                        class="p-1.5 rounded-lg border border-outline-variant/10 text-on-surface-variant hover:bg-white/5 disabled:opacity-30 transition-colors"
                        title={m.e1_tickets_move_up()}
                      >
                        <Papicon icon="arrow-up" size={13} />
                      </button>
                      <button
                        onclick={() => moveTicketType(index, 'DOWN')}
                        disabled={index === ticketTypes.length - 1}
                        class="p-1.5 rounded-lg border border-outline-variant/10 text-on-surface-variant hover:bg-white/5 disabled:opacity-30 transition-colors"
                        title={m.e1_tickets_move_down()}
                      >
                        <Papicon icon="arrow-down" size={13} />
                      </button>

                      <div class="w-px h-5 bg-outline-variant/10 mx-1"></div>

                      <!-- Edit expansion toggle button -->
                      <button
                        onclick={() => expandedTicketTypeIndex = isExpanded ? null : index}
                        class="px-2.5 py-1.5 rounded-lg border text-2xs font-semibold uppercase tracking-wider transition-colors {isExpanded ? 'bg-primary text-white border-primary' : 'bg-surface-container text-on-surface hover:bg-white/5 border-outline-variant/10'}"
                      >
                        {isExpanded ? m.e1_tickets_type_collapse() : m.e1_tickets_type_edit()}
                      </button>

                      <!-- Delete button -->
                      <button
                        onclick={() => removeTicketType(index)}
                        class="p-1.5 rounded-lg bg-error/10 text-error hover:bg-rose-500 hover:text-white border border-error/15 transition-all"
                        title={m.e1_tickets_type_delete()}
                      >
                        <Papicon icon="trash-2" size={13} />
                      </button>
                    </div>
                  </div>

                  <!-- Accordion Content -->
                  {#if isExpanded}
                    <div class="px-4 pb-4 pt-3 border-t border-outline-variant/10 bg-surface-container-low/10 space-y-4 animate-fade-in">
                      
                      <!-- Button label, emoji, style select -->
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label class="block">
                          <span class="text-2xs font-bold text-on-surface-variant/70 ml-1 mb-1.5 block">{m.e1_tickets_type_label()}</span>
                          <FormInput type="text" bind:value={ticketType.label} placeholder={m.e1_tickets_type_label_ph()} className="w-full" />
                        </label>
                        <div class="grid grid-cols-2 gap-3">
                          <label class="block">
                            <span class="text-2xs font-bold text-on-surface-variant/70 ml-1 mb-1.5 block">{m.e1_tickets_type_emoji()}</span>
                            <div class="flex gap-1.5">
                              <FormInput type="text" bind:value={ticketType.emoji} placeholder="📩" className="w-full" />
                              <EmojiPicker bind:value={ticketType.emoji} />
                            </div>
                          </label>
                          <label class="block">
                            <span class="text-2xs font-bold text-on-surface-variant/70 ml-1 mb-1.5 block">{m.e1_tickets_type_style()}</span>
                            <FormSelect bind:value={ticketType.buttonStyle} className="w-full">
                              <option value="PRIMARY">{m.e1_tickets_style_primary()}</option>
                              <option value="SECONDARY">{m.e1_tickets_style_secondary()}</option>
                              <option value="SUCCESS">{m.e1_tickets_style_success()}</option>
                              <option value="DANGER">{m.e1_tickets_style_danger()}</option>
                            </FormSelect>
                          </label>
                        </div>
                      </div>

                      <label class="block">
                        <span class="text-2xs font-bold text-on-surface-variant/70 ml-1 mb-1.5 block">{m.e1_tickets_type_desc()}</span>
                        <FormTextarea bind:value={ticketType.description} placeholder={m.e1_tickets_type_desc_ph()} className="w-full h-16" />
                      </label>

                      <!-- Salons & Rôles targets -->
                      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label class="block">
                          <span class="text-2xs font-bold text-on-surface-variant/70 ml-1 mb-1.5 block">{m.e1_tickets_type_mode()}</span>
                          <FormSelect bind:value={ticketType.mode} className="w-full">
                            <option value="">{m.e1_tickets_mode_default()}</option>
                            <option value="CHANNEL">{m.e1_tickets_mode_channel_opt()}</option>
                            <option value="DM">{m.e1_tickets_mode_dm_opt()}</option>
                            <option value="THREAD">{m.e1_tickets_mode_thread_opt()}</option>
                          </FormSelect>
                        </label>
                        <label class="block">
                          <span class="text-2xs font-bold text-on-surface-variant/70 ml-1 mb-1.5 block">{m.e1_tickets_type_category()}</span>
                          <SearchableSelect bind:value={ticketType.categoryId} options={discordCategories.map(c => ({ id: c.id, name: c.name }))} placeholder={m.e1_tickets_inherited_ph()} className="w-full" />
                          {#if isMissingReference(ticketType.categoryId, discordCategories)}
                            <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
                          {/if}
                        </label>
                        <label class="block">
                          <span class="text-2xs font-bold text-on-surface-variant/70 ml-1 mb-1.5 block">{m.e1_tickets_type_staff_role()}</span>
                          <SearchableSelect bind:value={ticketType.staffRoleId} options={discordRoles.map(r => ({ id: r.id, name: `@${r.name}` }))} placeholder={m.e1_tickets_inherited_ph()} className="w-full" />
                          {#if isMissingReference(ticketType.staffRoleId, discordRoles)}
                            <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
                          {/if}
                        </label>
                      </div>

                      <!-- Surcharges validation / verrouillage propres au type -->
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label class="block">
                          <span class="text-2xs font-bold text-on-surface-variant/70 ml-1 mb-1.5 block">{m.e1_tickets_type_lock_until_claim()}</span>
                          <FormSelect bind:value={ticketType.lockUntilClaim} className="w-full">
                            <option value="">{m.e1_tickets_type_inherit({ value: ticketLockUntilClaim ? m.e1_tickets_type_enabled() : m.e1_tickets_type_disabled() })}</option>
                            <option value="YES">{m.e1_tickets_type_enabled()}</option>
                            <option value="NO">{m.e1_tickets_type_disabled()}</option>
                          </FormSelect>
                        </label>
                        <label class="block">
                          <span class="text-2xs font-bold text-on-surface-variant/70 ml-1 mb-1.5 block">{m.e1_tickets_type_require_approval()}</span>
                          <FormSelect bind:value={ticketType.requireApproval} className="w-full">
                            <option value="">{m.e1_tickets_type_inherit({ value: ticketApprovalEnabled ? m.e1_tickets_type_enabled() : m.e1_tickets_type_disabled() })}</option>
                            <option value="YES">{m.e1_tickets_type_enabled()}</option>
                            <option value="NO">{m.e1_tickets_type_disabled()}</option>
                          </FormSelect>
                        </label>
                      </div>

                      <!-- Toggle Options -->
                      {#if ticketType.mode === 'DM' || (ticketType.mode === '' && ticketMode === 'DM')}
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                          <div class="flex items-center gap-2.5 p-1">
                            <ToggleSwitch checked={ticketType.anonymous} onToggle={(v) => { ticketType.anonymous = v; }} size="sm" />
                            <div>
                              <span class="text-xs font-semibold text-on-surface">{m.e1_tickets_staff_anonymity()}</span>
                              <p class="text-2xs text-on-surface-variant/50 leading-none mt-0.5">{m.e1_tickets_staff_anonymity_desc()}</p>
                            </div>
                          </div>
                          <div class="flex items-center gap-2.5 p-1">
                            <ToggleSwitch checked={ticketType.staffServerRelay} onToggle={(v) => { ticketType.staffServerRelay = v; }} size="sm" />
                            <div>
                              <span class="text-xs font-semibold text-on-surface">{m.e1_tickets_thread_on_staff_server()}</span>
                              <p class="text-2xs text-on-surface-variant/50 leading-none mt-0.5">{m.e1_tickets_thread_on_staff_server_desc()}</p>
                            </div>
                          </div>
                        </div>
                      {/if}

                      <!-- Ticket interne sur le serveur staff (mode CHANNEL uniquement) -->
                      {#if staffServerInfo.staffGuildId && (ticketType.mode === 'CHANNEL' || (ticketType.mode === '' && ticketMode === 'CHANNEL'))}
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                          <div class="flex items-center gap-2.5 p-1">
                            <ToggleSwitch checked={ticketType.staffServerChannel} onToggle={(v) => { ticketType.staffServerChannel = v; }} size="sm" />
                            <div>
                              <span class="text-xs font-semibold text-on-surface">{m.e1_tickets_channel_on_staff_server()}</span>
                              <p class="text-2xs text-on-surface-variant/50 leading-none mt-0.5">{m.e1_tickets_channel_on_staff_server_desc({ name: staffServerInfo.staffGuildName ?? "" })}</p>
                            </div>
                          </div>
                          {#if ticketType.staffServerChannel}
                            <label class="block">
                              <span class="text-2xs font-bold text-on-surface-variant/70 ml-1 mb-1.5 block">{m.e1_tickets_staff_server_category()}</span>
                              <SearchableSelect bind:value={ticketType.staffServerCategoryId} options={staffServerInfo.categories.map((c: any) => ({ id: c.id, name: c.name }))} placeholder={m.e1_tickets_select_category_ph()} className="w-full" />
                              {#if isMissingReference(ticketType.staffServerCategoryId, staffServerInfo.categories)}
                                <p class="text-2xs text-warning mt-1.5">{m.e1_tickets_missing_ref()}</p>
                              {/if}
                            </label>
                          {/if}
                        </div>
                      {/if}

                      <!-- Modal Form Configurator -->
                      <div class="pt-4 border-t border-outline-variant/10 mt-3">
                        <label class="flex items-center gap-3 cursor-pointer p-1 rounded-xl transition-colors">
                          <input type="checkbox" bind:checked={ticketType.formEnabled} class="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant/30" />
                          <div>
                            <span class="text-xs font-bold text-on-surface">{m.e1_tickets_enable_form()}</span>
                            <p class="text-2xs text-on-surface-variant/60">{m.e1_tickets_enable_form_desc()}</p>
                          </div>
                        </label>

                        {#if ticketType.formEnabled}
                          <div class="space-y-4 pt-4 pl-7">
                            <div class="flex items-center justify-between">
                              <span class="text-xs font-bold text-on-surface-variant/80">{m.e1_tickets_custom_questions()}</span>
                              <button
                                onclick={() => addCustomField(index)}
                                disabled={(ticketType.formCustomFields || []).length >= 5}
                                class="px-2 py-1 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                              >
                                <Papicon icon="plus" size={11} /> {m.e1_tickets_add_question()}
                              </button>
                            </div>

                            {#if !(ticketType.formCustomFields || []).length}
                              <div class="p-4 rounded-xl border border-dashed border-outline-variant/20 bg-surface-container/10 text-center">
                                <p class="text-xs text-on-surface-variant/60">{m.e1_tickets_no_question()}</p>
                                <p class="text-2xs text-on-surface-variant/40 mt-1">{m.e1_tickets_no_question_hint()}</p>
                              </div>
                            {:else}
                              <div class="space-y-3">
                                {#each ticketType.formCustomFields as field, fieldIndex}
                                  <div class="p-3 rounded-lg border border-outline-variant/10 bg-surface-container/10 space-y-3 relative group">
                                    <div class="flex items-center justify-between">
                                      <span class="text-2xs font-bold text-primary">{m.e1_tickets_question_number({ index: fieldIndex + 1 })}</span>
                                      <button
                                        onclick={() => removeCustomField(index, field.id)}
                                        class="text-error hover:text-error p-1 rounded-lg hover:bg-error/10 transition-colors"
                                      >
                                        <Papicon icon="trash-2" size={13} />
                                      </button>
                                    </div>

                                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      <label class="block">
                                        <span class="text-2xs font-bold text-on-surface-variant/70 mb-1 block">{m.e1_tickets_field_question()}</span>
                                        <FormInput type="text" bind:value={field.label} placeholder={m.e1_tickets_field_question_ph()} className="w-full" />
                                      </label>
                                      <label class="block">
                                        <span class="text-2xs font-bold text-on-surface-variant/70 mb-1 block">{m.e1_tickets_field_hint()}</span>
                                        <FormInput type="text" bind:value={field.placeholder} placeholder={m.e1_tickets_field_hint_ph()} className="w-full" />
                                      </label>
                                    </div>

                                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      <label class="block">
                                        <span class="text-2xs font-bold text-on-surface-variant/70 mb-1 block">{m.e1_tickets_answer_type()}</span>
                                        <FormSelect bind:value={field.style} className="w-full">
                                          <option value="SHORT">{m.e1_tickets_answer_short()}</option>
                                          <option value="PARAGRAPH">{m.e1_tickets_answer_paragraph()}</option>
                                          <option value="SELECT">{m.e1_tickets_answer_select()}</option>
                                          <option value="RADIO">{m.e1_tickets_answer_radio()}</option>
                                          <option value="FILE">{m.e1_tickets_answer_file()}</option>
                                        </FormSelect>
                                      </label>
                                      <label class="flex items-center gap-2 cursor-pointer pt-5">
                                        <input type="checkbox" bind:checked={field.required} class="w-3.5 h-3.5 rounded text-primary focus:ring-primary border-outline-variant/30" />
                                        <span class="text-2xs font-bold text-on-surface">{m.e1_tickets_field_required()}</span>
                                      </label>
                                    </div>

                                    {#if field.style === 'SELECT' || field.style === 'RADIO'}
                                      <div class="pt-1">
                                        <label class="block">
                                          <span class="text-2xs font-bold text-on-surface-variant/70 mb-1 block">{m.e1_tickets_field_choices()}</span>
                                          <FormInput
                                            type="text"
                                            bind:value={field.choicesString}
                                            placeholder={m.e1_tickets_field_choices_ph()}
                                            className="w-full"
                                          />
                                        </label>
                                        {#if field.style === 'RADIO'}
                                          <p class="text-2xs text-on-surface-variant/40 mt-1">{m.e1_tickets_field_choices_radio_hint()}</p>
                                        {/if}
                                      </div>
                                    {/if}

                                    {#if field.style === 'SELECT' || field.style === 'RADIO' || field.style === 'FILE'}
                                      <p class="text-2xs text-primary/70 leading-snug">{m.e1_tickets_field_interactive_hint()}</p>
                                    {/if}
                                  </div>
                                {/each}
                              </div>
                            {/if}
                          </div>
                        {/if}
                      </div>

                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

    </div>
    {/await}
  {:else if activeTab === 'transcripts'}
    <TicketTranscripts {refreshToken} />
  {:else if activeTab === 'satisfaction'}
    <TicketSatisfactionTab {refreshToken} onopenmember={openMemberCase} />
  {:else if activeTab === 'macros'}
    <TicketMacros {refreshToken} ticketTypes={ticketTypes.map((type) => ({ id: type.id, label: type.label }))} />
  {:else if activeTab === 'blacklist'}
    <TicketBlacklist {refreshToken} />
  {/if}
</ModulePage>

<!-- ============================================== -->
<!-- MODALS -->
<!-- ============================================== -->

<!-- Ticket Close Modal -->
{#if showCloseModal}
  <div class="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60">
    <div class="bg-surface border border-outline-variant/30 rounded-xl w-full max-w-lg shadow-sm p-10 animate-in zoom-in-95 duration-300">
      <div class="flex items-center gap-4 mb-2 text-error">
        <Papicon icon="x-circle" size={36} />
        <h3 class="text-2xl font-semibold">{m.e1_tickets_close_modal_title()}</h3>
      </div>
      <p class="text-sm text-on-surface-variant/80 mb-6">{m.e1_tickets_close_modal_desc()}</p>
      
      <div>
        <label for="close-reason-input" class="field-label">{m.e1_tickets_close_reason_label()}</label>
        <textarea id="close-reason-input" bind:value={closeReason} class="w-full h-32 bg-surface-container rounded-lg p-4 focus:outline-hidden border-2 border-transparent focus:border-primary/50 text-sm" placeholder={m.e1_tickets_close_reason_ph()}></textarea>
      </div>
      
      <div class="flex gap-4 mt-8 pt-6 border-t border-outline-variant/20">
        <button onclick={() => showCloseModal = false} class="flex-1 py-4 rounded-xl font-bold bg-surface-container hover:bg-surface-container-high transition-colors">{m.common_cancel()}</button>
        <button 
          onclick={closeTicket} 
          class="flex-1 py-4 rounded-xl font-bold bg-rose-600 text-white active:scale-[0.98] transition-transform shadow-sm"
        >
          {m.e1_tickets_close_confirm()}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Ticket Delete Confirm Modal -->
{#if showDeleteConfirmModal}
  <div class="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60">
    <div class="bg-surface border border-outline-variant/30 rounded-xl w-full max-w-md shadow-sm p-10 animate-in zoom-in-95 duration-300">
      <div class="flex items-center gap-4 mb-2 text-error">
        <Papicon icon="delete" size={36} />
        <h3 class="text-2xl font-semibold">{m.e1_tickets_delete_modal_title()}</h3>
      </div>
      <p class="text-sm text-on-surface-variant/80 mb-6">{m.e1_tickets_delete_modal_desc()}</p>
      
      <div class="flex gap-4 mt-8 pt-6 border-t border-outline-variant/20">
        <button onclick={() => showDeleteConfirmModal = false} class="flex-1 py-4 rounded-xl font-bold bg-surface-container hover:bg-surface-container-high transition-colors">{m.common_cancel()}</button>
        <button 
          onclick={deleteTicket} 
          class="flex-1 py-4 rounded-xl font-bold bg-rose-600 text-white active:scale-[0.98] transition-transform shadow-sm"
        >
          {m.e1_tickets_delete_confirm()}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Ticket Deletion Lock Modal -->
{#if showLockModal}
  <div class="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60">
    <div class="bg-surface border border-outline-variant/30 rounded-xl w-full max-w-md shadow-sm p-10 animate-in zoom-in-95 duration-300">
      <div class="flex items-center gap-4 mb-2 text-warning">
        <Papicon icon="lock" size={36} />
        <h3 class="text-2xl font-semibold">{m.e1_tickets_lock_modal_title()}</h3>
      </div>
      <p class="text-sm text-on-surface-variant/80 mb-6">{m.e1_tickets_lock_modal_intro()}</p>

      <label class="block text-xs font-semibold text-on-surface-variant/70 mb-2" for="ticket-lock-duration">
        {m.e1_tickets_lock_duration()}
      </label>
      <div id="ticket-lock-duration" class="grid grid-cols-2 gap-2 mb-6">
        {#each [['7d', m.e1_tickets_lock_duration_7d()], ['30d', m.e1_tickets_lock_duration_30d()], ['90d', m.e1_tickets_lock_duration_90d()], ['permanent', m.e1_tickets_lock_duration_permanent()]] as [value, label]}
          <button
            type="button"
            onclick={() => lockDuration = value as typeof lockDuration}
            class="py-2.5 rounded-lg text-xs font-semibold transition-all border {lockDuration === value ? 'bg-amber-500 text-white border-warning' : 'bg-surface-container border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high'}"
          >
            {label}
          </button>
        {/each}
      </div>

      <label class="block">
        <span class="text-xs font-bold text-on-surface-variant/80 ml-1 mb-2 block">{m.e1_tickets_lock_reason()}</span>
        <FormTextarea bind:value={lockReason} placeholder={m.e1_tickets_lock_reason_ph()} rows={3} className="w-full" />
      </label>

      <div class="flex gap-4 mt-8 pt-6 border-t border-outline-variant/20">
        <button onclick={() => showLockModal = false} class="flex-1 py-4 rounded-xl font-bold bg-surface-container hover:bg-surface-container-high transition-colors">{m.common_cancel()}</button>
        <button
          onclick={lockTicket}
          disabled={lockBusy}
          class="flex-1 py-4 rounded-xl font-bold bg-amber-500 text-white active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50"
        >
          {lockBusy ? '…' : m.e1_tickets_lock_confirm()}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Ticket Restore Modal -->
{#if showRestoreModal}
  {@const rc = selectedTicketDetail?.restoreCount ?? 0}
  {@const maxRestores = 3}
  {@const remaining = maxRestores - rc}
  <div class="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60">
    <div class="bg-surface border border-outline-variant/30 rounded-xl w-full max-w-lg shadow-sm p-10 animate-in zoom-in-95 duration-300">
      <div class="flex items-center gap-4 mb-2 text-purple-400">
        <Papicon icon="refresh-ccw" size={36} />
        <h3 class="text-2xl font-semibold">{m.e1_tickets_restore_modal_title()}</h3>
      </div>
      <p class="text-sm text-on-surface-variant/80 mb-4">{m.e1_tickets_restore_modal_intro()}</p>
      <ul class="text-sm text-on-surface-variant/80 mb-6 space-y-2 list-disc ml-5">
        <li>{m.e1_tickets_restore_step1_pre()}<strong>{m.e1_tickets_restore_step1_strong()}</strong>{m.e1_tickets_restore_step1_post()}</li>
        <li>{m.e1_tickets_restore_step2_pre()}<strong>{m.e1_tickets_restore_step2_strong()}</strong>{m.e1_tickets_restore_step2_post()}</li>
        <li>{m.e1_tickets_restore_step3_pre()}<strong>{m.e1_tickets_restore_step3_strong()}</strong></li>
      </ul>

      <div class="flex items-start gap-2 p-3 rounded-lg bg-purple-500/5 border border-purple-500/15 mb-4">
        <Papicon icon="info" size={14} class="text-purple-400 mt-0.5 shrink-0" />
        <div class="text-2xs text-purple-300/80 leading-relaxed">
          <p class="font-semibold mb-1">{m.e1_tickets_restore_limits_title({ remaining, max: maxRestores })}</p>
          <p>{m.e1_tickets_restore_limits_desc()}</p>
        </div>
      </div>

      <div class="flex items-start gap-2 p-3 rounded-lg bg-warning/5 border border-warning/15 mb-6">
        <Papicon icon="alert-triangle" size={14} class="text-warning mt-0.5 shrink-0" />
        <p class="text-2xs text-warning/80 leading-relaxed">{m.e1_tickets_restore_warning()}</p>
      </div>

      <div class="flex gap-4 mt-8 pt-6 border-t border-outline-variant/20">
        <button onclick={() => showRestoreModal = false} disabled={restoring} class="flex-1 py-4 rounded-xl font-bold bg-surface-container hover:bg-surface-container-high transition-colors disabled:opacity-50">{m.common_cancel()}</button>
        <button
          onclick={restoreTicket}
          disabled={restoring}
          class="flex-1 py-4 rounded-xl font-bold bg-purple-600 text-white active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {#if restoring}
            <div class="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
            {m.e1_tickets_restoring()}
          {:else}
            {m.e1_tickets_restore_confirm()}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Member Case Modal -->
{#if caseModalOpen}
  {#await import('../lib/components/MemberCaseModal.svelte') then module}
    {@const MemberCaseModal = module.default}
    <MemberCaseModal
      open={caseModalOpen}
      userId={selectedCaseUser?.id}
      userName={selectedCaseUser?.name || ''}
      caseData={selectedCaseData}
      loading={selectedCaseLoading}
      error={selectedCaseError}
      actionReason={memberActionReason}
      actionDuration={memberActionDuration}
      actionBusy={memberActionBusy}
      actionFeedback={memberActionFeedback}
      actionIsError={memberActionIsError}
      onClose={closeCaseModal}
      onAction={executeMemberAction}
    />
  {/await}
{/if}

<style>
  .scrollbar-hide::-webkit-scrollbar { display: none; }
  .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }


</style>
