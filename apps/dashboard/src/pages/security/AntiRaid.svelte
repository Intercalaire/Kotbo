<script lang="ts">
  import { onMount } from 'svelte';
  import { authStore } from '../../lib/stores/auth.svelte';
  import { dashboardStore } from '../../lib/stores/dashboard.svelte';
  import {
    fetchRaidProtection,
    updateRaidProtection,
    setRaidMode,
    setJoinLock,
    setDmLock,
    setInviteEmergency,
    fetchMemberReports,
    decideMemberReport,
    fetchInviteRequests,
    decideInviteRequest,
    fetchScamImages,
    deleteScamImage,
    fetchInviteLineage,
    quarantineInviteLineage,
  } from '../../lib/api';
  import { toast } from '../../lib/stores/toast.svelte';
  import SecurityPage, { type SecurityTab } from '../../lib/components/security/SecurityPage.svelte';
  import SectionCard from '../../lib/components/SectionCard.svelte';
  import ToggleSwitch from '../../lib/components/ToggleSwitch.svelte';
  import RefreshButton from '../../lib/components/RefreshButton.svelte';
  import EmptyState from '../../lib/components/EmptyState.svelte';
  import LoadingHint from '../../lib/components/LoadingHint.svelte';

  type Config = Record<string, any>;

  type Report = {
    id: string;
    reporterId: string;
    targetId: string;
    reason: string;
    channelId: string | null;
    messageContent: string | null;
    status: string;
    createdAt: string;
  };

  type InviteRequest = {
    id: string;
    creatorId: string;
    channelId: string;
    inviteCode: string | null;
    maxUses: number;
    maxAgeSec: number;
    status: string;
    createdAt: string;
  };

  type ScamImage = {
    id: string;
    guildId: string | null;
    hash: string;
    filename: string | null;
    source: string;
    createdAt: string;
  };

  let config = $state<Config>({});
  let original = $state<Config>({});
  let reportStats = $state<{ pending: number; resolved: number; dismissed: number } | null>(null);
  let pendingInvites = $state(0);
  let scamImageCount = $state(0);

  let reports = $state<Report[]>([]);
  let inviteRequests = $state<InviteRequest[]>([]);
  let scamImages = $state<ScamImage[]>([]);

  let loading = $state(true);
  let saving = $state(false);
  let busyAction = $state<string | null>(null);
  let error = $state('');

  type Lineage = {
    userId: string;
    chain: string[];
    trust: { penalty: number; taintedBy: string | null; depth: number };
    directInvites: number;
    totalDescendants: number;
    taintedDescendants: number;
  };

  let lineageUserId = $state('');
  let lineage = $state<Lineage | null>(null);
  let lineageLoading = $state(false);
  /** Nombre de membres qu'une application réelle toucherait, issu de la simulation. */
  let quarantinePreview = $state<number | null>(null);

  const dirty = $derived(JSON.stringify(config) !== JSON.stringify(original));

  const channels = $derived((dashboardStore.state.discordChannels ?? []) as { id: string; name: string }[]);
  const voiceChannels = $derived((dashboardStore.state.discordVoiceChannels ?? []) as { id: string; name: string }[]);
  const roles = $derived((dashboardStore.state.discordRoles ?? []) as { id: string; name: string }[]);

  // « Captcha d'entree » et non « Verification » : la verification d'identite
  // OAuth du multi-comptes porte deja ce nom, et la confusion entre les deux
  // etait l'une des raisons du reagencement.
  const TABS = $derived<SecurityTab[]>([
    { key: 'detection', label: 'Détection & verrous', icon: 'ShieldAlert' },
    { key: 'captcha',   label: "Captcha d'entrée",    icon: 'UserCheck' },
    { key: 'scams',     label: 'Arnaques & tag',      icon: 'Fishing' },
    { key: 'invites',   label: 'Invitations',         icon: 'Link' },
    {
      key: 'queues',
      label: "Files d'attente",
      icon: 'Inbox',
      count: reports.length + inviteRequests.length,
    },
  ]);

  function channelName(id: string | null | undefined): string {
    if (!id) return '-';
    return channels.find((c) => c.id === id)?.name ?? id;
  }

  function formatRelative(value: string): string {
    const diff = Date.now() - new Date(value).getTime();
    const minutes = Math.max(1, Math.floor(diff / 60000));
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return `il y a ${Math.floor(hours / 24)} j`;
  }

  async function load() {
    if (!authStore.selectedGuildId) return;
    loading = true;
    error = '';
    try {
      const res = await fetchRaidProtection(authStore.selectedGuildId);
      const loaded = res?.config ?? {};
      config = { ...loaded };
      original = { ...loaded };
      reportStats = res?.reportStats ?? null;
      pendingInvites = res?.pendingInvites ?? 0;
      scamImageCount = res?.scamImageCount ?? 0;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Impossible de charger la configuration';
    } finally {
      loading = false;
    }
  }

  async function loadQueues() {
    if (!authStore.selectedGuildId) return;
    try {
      const [r, i, s] = await Promise.all([
        fetchMemberReports('PENDING', authStore.selectedGuildId),
        fetchInviteRequests(authStore.selectedGuildId),
        fetchScamImages(authStore.selectedGuildId),
      ]);
      reports = r?.reports ?? [];
      inviteRequests = (i?.requests ?? []).filter((req: InviteRequest) => req.status === 'PENDING');
      scamImages = s?.images ?? [];
    } catch {
      toast.error('Impossible de charger les files d\'attente');
    }
  }

  async function save() {
    if (!dirty || saving) return;
    saving = true;
    try {
      const res = await updateRaidProtection({ ...config }, authStore.selectedGuildId);
      const saved = res?.config ?? config;
      config = { ...saved };
      original = { ...saved };
      toast.success('Configuration enregistrée');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      saving = false;
    }
  }

  /** Les bascules d'urgence agissent immédiatement : elles ne passent pas par le formulaire. */
  async function runEmergency(
    id: string,
    fn: () => Promise<any>,
    successMessage: string,
    confirmMessage?: string
  ) {
    if (busyAction) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;

    busyAction = id;
    try {
      const res = await fn();
      if (res?.config) {
        config = { ...res.config };
        original = { ...res.config };
      }
      toast.success(successMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action impossible');
    } finally {
      busyAction = null;
    }
  }

  async function decideReport(report: Report, resolved: boolean) {
    busyAction = report.id;
    try {
      await decideMemberReport(report.id, resolved, authStore.selectedGuildId);
      reports = reports.filter((r) => r.id !== report.id);
      if (reportStats) reportStats.pending = Math.max(0, reportStats.pending - 1);
      toast.success(resolved ? 'Signalement traité' : 'Signalement rejeté');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Décision impossible');
    } finally {
      busyAction = null;
    }
  }

  async function decideInvite(request: InviteRequest, approved: boolean) {
    busyAction = request.id;
    try {
      await decideInviteRequest(request.id, approved, authStore.selectedGuildId);
      inviteRequests = inviteRequests.filter((r) => r.id !== request.id);
      pendingInvites = Math.max(0, pendingInvites - 1);
      toast.success(approved ? 'Invitation approuvée et recréée' : 'Demande rejetée');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Décision impossible');
    } finally {
      busyAction = null;
    }
  }

  async function removeScamImage(image: ScamImage) {
    busyAction = image.id;
    try {
      await deleteScamImage(image.id, authStore.selectedGuildId);
      scamImages = scamImages.filter((i) => i.id !== image.id);
      scamImageCount = Math.max(0, scamImageCount - 1);
      toast.success('Empreinte supprimée');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression impossible');
    } finally {
      busyAction = null;
    }
  }

  async function loadLineage() {
    const userId = lineageUserId.trim();
    if (!userId) return;

    lineageLoading = true;
    quarantinePreview = null;
    try {
      const res = await fetchInviteLineage(userId, authStore.selectedGuildId);
      lineage = res?.report ?? null;
    } catch (err) {
      lineage = null;
      toast.error(err instanceof Error ? err.message : 'Analyse impossible');
    } finally {
      lineageLoading = false;
    }
  }

  async function runQuarantine(dryRun: boolean) {
    if (!lineage || busyAction) return;
    if (!dryRun) {
      const confirmed = window.confirm(
        `${quarantinePreview} membre(s) vont être mis en quarantaine. Cette action est réversible mais visible par eux. Confirmer ?`
      );
      if (!confirmed) return;
    }

    busyAction = 'quarantine';
    try {
      const res = await quarantineInviteLineage(lineage.userId, { dryRun }, authStore.selectedGuildId);
      const result = res?.result;
      if (dryRun) {
        quarantinePreview = result?.targets?.length ?? 0;
      } else {
        toast.success(`${result?.applied ?? 0} membre(s) mis en quarantaine, ${result?.skipped ?? 0} ignoré(s).`);
        quarantinePreview = null;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Quarantaine impossible');
    } finally {
      busyAction = null;
    }
  }

  function toggleInList(field: string, value: string) {
    const list: string[] = config[field] ?? [];
    config[field] = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  onMount(async () => {
    await load();
    await loadQueues();
  });

  $effect(() => {
    const guildId = authStore.selectedGuildId;
    if (guildId) {
      void load();
      void loadQueues();
    }
  });
</script>

{#snippet channelSelect(field: string, label: string, help = '', list = channels)}
  <label class="block">
    <span class="text-[12.5px] font-medium text-on-surface-variant">{label}</span>
    <select
      bind:value={config[field]}
      class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface"
    >
      <option value={null}>Aucun</option>
      {#each list as item (item.id)}
        <option value={item.id}>{item.name}</option>
      {/each}
    </select>
    {#if help}<p class="text-[11.5px] text-on-surface-variant/70 mt-1">{help}</p>{/if}
  </label>
{/snippet}

{#snippet roleSelect(field: string, label: string, help = '')}
  <label class="block">
    <span class="text-[12.5px] font-medium text-on-surface-variant">{label}</span>
    <select
      bind:value={config[field]}
      class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface"
    >
      <option value={null}>Aucun</option>
      {#each roles as role (role.id)}
        <option value={role.id}>{role.name}</option>
      {/each}
    </select>
    {#if help}<p class="text-[11.5px] text-on-surface-variant/70 mt-1">{help}</p>{/if}
  </label>
{/snippet}

{#snippet numberField(field: string, label: string, min: number, max: number, help = '')}
  <label class="block">
    <span class="text-[12.5px] font-medium text-on-surface-variant">{label}</span>
    <input
      type="number" {min} {max}
      bind:value={config[field]}
      class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface"
    />
    {#if help}<p class="text-[11.5px] text-on-surface-variant/70 mt-1">{help}</p>{/if}
  </label>
{/snippet}

{#snippet switchRow(field: string, label: string, help: string)}
  <div class="flex items-start justify-between gap-4 rounded-xl border border-outline-variant/30 px-4 py-3">
    <div class="min-w-0">
      <p class="text-[13.5px] font-medium text-on-surface">{label}</p>
      <p class="text-[12.5px] text-on-surface-variant mt-1 leading-relaxed">{help}</p>
    </div>
    <ToggleSwitch checked={Boolean(config[field])} onToggle={(v) => (config[field] = v)} />
  </div>
{/snippet}

<SecurityPage
  basePath="/security/anti-raid"
  title="Anti-raid"
  description="Détection de raid, verrous d'urgence, captcha d'entrée et contrôle des invitations"
  icon="shieldwarning"
  tabs={TABS}
>
  {#snippet actions()}
    <RefreshButton onclick={load} loading={loading} />
  {/snippet}

  {#snippet children(activeTab: string)}
  {#if loading}
    <LoadingHint context="config" />
  {:else if error}
    <EmptyState icon="AlertTriangle" title="Configuration indisponible" description={error} />
  {:else}
    <!-- ── Barre d'etat & actions d'urgence ───────────────────────────── -->
    <SectionCard
      title="État du serveur"
      description="Ces bascules s'appliquent immédiatement, sans passer par l'enregistrement."
      icon="Zap"
    >
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {#each [
          {
            id: 'raidmode',
            label: 'Mode raid',
            active: Boolean(config.raidModeActive),
            help: config.raidModeActive
              ? `Actif${config.raidModeManual ? ' (manuel)' : ` (auto, levée dans ${config.antiRaidAutoDisableMinutes ?? '?'} min)`}`
              : 'Inactif',
            run: () => setRaidMode(!config.raidModeActive, authStore.selectedGuildId),
            confirm: config.raidModeActive ? undefined : 'Activer le mode raid appliquera immédiatement l\'action configurée à toutes les arrivées. Confirmer ?',
          },
          {
            id: 'joinlock',
            label: 'Verrou des arrivées',
            active: Boolean(config.joinLockEnabled),
            help: config.joinLockEnabled ? 'Les invitations sont suspendues' : 'Les arrivées sont ouvertes',
            run: () => setJoinLock(!config.joinLockEnabled, undefined, authStore.selectedGuildId),
            confirm: config.joinLockEnabled ? undefined : 'Plus personne ne pourra rejoindre le serveur. Confirmer ?',
          },
          {
            id: 'dmlock',
            label: 'Verrou des MP',
            active: Boolean(config.dmLockEnabled),
            help: config.dmLockEnabled ? 'Les MP entre membres sont suspendus' : 'Les MP sont ouverts',
            run: () => setDmLock(!config.dmLockEnabled, undefined, authStore.selectedGuildId),
            confirm: undefined,
          },
          {
            id: 'invite-emergency',
            label: 'Urgence invitations',
            active: Boolean(config.inviteEmergencyEnabled),
            help: config.inviteEmergencyEnabled ? 'Toute invitation est supprimée' : 'Création normale',
            run: () => setInviteEmergency(!config.inviteEmergencyEnabled, authStore.selectedGuildId),
            confirm: config.inviteEmergencyEnabled ? undefined : 'Toutes les invitations existantes seront supprimées, et toute nouvelle invitation le sera aussi. Confirmer ?',
          },
        ] as control (control.id)}
          <button
            type="button"
            class="text-left rounded-xl border px-4 py-3.5 transition-colors disabled:opacity-50
            {control.active
              ? 'border-error/40 bg-error/10 hover:bg-error/15'
              : 'border-outline-variant/30 bg-surface-container-low/40 hover:border-outline-variant/60'}"
            disabled={busyAction !== null}
            onclick={() => runEmergency(control.id, control.run, `${control.label} : ${control.active ? 'désactivé' : 'activé'}`, control.confirm)}
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-[13px] font-medium text-on-surface">{control.label}</span>
              <span
                class="w-2 h-2 rounded-full shrink-0 {control.active ? 'bg-error animate-pulse' : 'bg-outline-variant'}"
              ></span>
            </div>
            <p class="text-[12px] mt-1 {control.active ? 'text-error' : 'text-on-surface-variant'}">
              {busyAction === control.id ? 'Application…' : control.help}
            </p>
          </button>
        {/each}
      </div>

      <div class="mt-4 grid grid-cols-3 gap-3 text-center">
        <div class="rounded-lg bg-surface-container/60 px-3 py-2">
          <div class="text-[15px] font-semibold text-on-surface tabular-nums">{reportStats?.pending ?? 0}</div>
          <div class="text-[11px] text-on-surface-variant">signalements en attente</div>
        </div>
        <div class="rounded-lg bg-surface-container/60 px-3 py-2">
          <div class="text-[15px] font-semibold text-on-surface tabular-nums">{pendingInvites}</div>
          <div class="text-[11px] text-on-surface-variant">invitations à valider</div>
        </div>
        <div class="rounded-lg bg-surface-container/60 px-3 py-2">
          <div class="text-[15px] font-semibold text-on-surface tabular-nums">{scamImageCount}</div>
          <div class="text-[11px] text-on-surface-variant">empreintes d'arnaque</div>
        </div>
      </div>
    </SectionCard>

    {#if activeTab === 'detection'}
      <SectionCard
        title="Détection de raid"
        description="Une vague d'arrivées anormale déclenche automatiquement le mode raid."
        icon="ShieldAlert"
      >
        <div class="space-y-3">
          {@render switchRow('antiRaidEnabled', 'Anti-raid', 'Surveille le rythme des arrivées sur une fenêtre glissante et bascule le serveur en mode raid au-delà du seuil.')}

          <div class="grid sm:grid-cols-2 gap-3">
            {@render numberField('antiRaidJoinThreshold', 'Seuil d\'arrivées', 2, 200, 'Nombre d\'arrivées déclenchant le mode raid.')}
            {@render numberField('antiRaidJoinWindowSec', 'Fenêtre (secondes)', 5, 600, 'Durée sur laquelle les arrivées sont comptées.')}
          </div>

          <label class="block">
            <span class="text-[12.5px] font-medium text-on-surface-variant">Action au déclenchement</span>
            <select
              bind:value={config.antiRaidAction}
              class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface"
            >
              <option value="LOCK">Verrouiller les arrivées</option>
              <option value="CAPTCHA">Forcer le captcha pour tous les arrivants</option>
              <option value="KICK">Expulser automatiquement les arrivants</option>
            </select>
            <p class="text-[11.5px] text-on-surface-variant/70 mt-1">
              « Expulser » est la plus brutale : elle rejette aussi les arrivées légitimes pendant toute la durée du mode raid.
            </p>
          </label>

          <div class="grid sm:grid-cols-2 gap-3">
            {@render channelSelect('antiRaidAlertChannelId', 'Salon d\'alerte', 'Sans salon d\'alerte, le mode raid s\'active sans que personne ne soit prévenu.')}
            {@render numberField('antiRaidAutoDisableMinutes', 'Levée automatique (minutes)', 1, 1440, 'Durée du mode raid déclenché automatiquement.')}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Verrou des arrivées" description="Comportement quand le verrou est actif." icon="Lock">
        <div class="space-y-3">
          {@render switchRow('joinLockKick', 'Expulser les arrivées malgré le verrou', 'La suspension des invitations par Discord n\'est pas absolue : ce filet expulse les membres qui passent quand même.')}
          <label class="block">
            <span class="text-[12.5px] font-medium text-on-surface-variant">Message envoyé en MP</span>
            <textarea
              rows="2"
              bind:value={config.joinLockMessage}
              class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface resize-y"
            ></textarea>
          </label>
        </div>
      </SectionCard>
    {/if}

    {#if activeTab === 'captcha'}
      <SectionCard
        title="Captcha des nouveaux membres"
        description="Filtre les comptes automatisés à l'entrée."
        icon="UserCheck"
      >
        <div class="space-y-3">
          {@render switchRow('captchaEnabled', 'Captcha', 'Les arrivants doivent résoudre un code avant d\'accéder au serveur.')}

          <label class="block">
            <span class="text-[12.5px] font-medium text-on-surface-variant">Mode</span>
            <select
              bind:value={config.captchaMode}
              class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface"
            >
              <option value="IMAGE">Image - le code est affiché</option>
              <option value="VOICE">Vocal - le code est énoncé en salon vocal</option>
            </select>
            <p class="text-[11.5px] text-on-surface-variant/70 mt-1">
              Le vocal est bien plus difficile à automatiser, mais la diffusion est sérielle : au-delà de la file configurée, les arrivants suivants basculent sur l'image.
            </p>
          </label>

          <div class="grid sm:grid-cols-2 gap-3">
            {@render channelSelect('captchaChannelId', 'Salon de vérification')}
            {@render roleSelect('captchaUnverifiedRoleId', 'Rôle « non vérifié »', 'Appliqué à l\'arrivée, retiré après réussite.')}
            {@render roleSelect('captchaVerifiedRoleId', 'Rôle « vérifié »', 'Accordé après réussite.')}
            {@render channelSelect('captchaLogChannelId', 'Salon de logs du captcha')}
          </div>

          {#if config.captchaMode === 'VOICE'}
            <div class="grid sm:grid-cols-3 gap-3 rounded-xl border border-outline-variant/30 p-3">
              {@render channelSelect('captchaVoiceChannelId', 'Salon vocal', '', voiceChannels)}
              <label class="block">
                <span class="text-[12.5px] font-medium text-on-surface-variant">Langue d'énonciation</span>
                <select
                  bind:value={config.captchaVoiceLocale}
                  class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface"
                >
                  <option value="FR">Français</option>
                  <option value="EN">Anglais</option>
                </select>
              </label>
              {@render numberField('captchaVoiceQueueLimit', 'Limite de file', 1, 200, 'Au-delà, bascule sur l\'image.')}
            </div>
          {/if}

          <div class="grid sm:grid-cols-3 gap-3">
            {@render numberField('captchaTimeoutMinutes', 'Délai (minutes)', 1, 120)}
            {@render numberField('captchaMaxAttempts', 'Tentatives', 1, 10)}
            <label class="block">
              <span class="text-[12.5px] font-medium text-on-surface-variant">Échec</span>
              <select
                bind:value={config.captchaFailAction}
                class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface"
              >
                <option value="KICK">Expulser</option>
                <option value="BAN">Bannir</option>
              </select>
            </label>
          </div>
        </div>
      </SectionCard>
    {/if}

    {#if activeTab === 'scams'}
      <SectionCard
        title="Filtre anti-arnaque"
        description="Bloque les liens de phishing (faux Nitro, faux Steam) et les images d'arnaque connues."
        icon="Fishing"
      >
        <div class="space-y-3">
          {@render switchRow('scamFilterEnabled', 'Filtre anti-arnaque', 'Analyse les domaines et les combinaisons de texte typiques des campagnes de phishing.')}
          {@render switchRow('scamImageFilterEnabled', 'Filtre d\'images', 'Compare les images postées aux empreintes d\'arnaques déjà identifiées sur le serveur, alimentées automatiquement par le honeypot. La comparaison est perceptuelle : une capture recompressée ou légèrement recadrée reste reconnue.')}
          {@render switchRow('scamQrFilterEnabled', 'Filtre de codes QR', 'Le phishing par QR de connexion Discord ne contient aucun lien : aucun filtre de domaine ne peut l\'attraper. Les images porteuses d\'un code QR envoyées par un compte sans historique sont bloquées.')}

          {#if config.scamQrFilterEnabled}
            <div class="rounded-xl border border-outline-variant/30 p-3">
              {@render numberField('scamQrTrustedMessages', 'Messages avant d\'être considéré comme installé', 0, 10000, 'Au-delà, les codes QR du membre ne sont plus bloqués : partager un QR wifi ou 2FA est légitime.')}
            </div>
          {/if}

          <div class="grid sm:grid-cols-3 gap-3">
            <label class="block">
              <span class="text-[12.5px] font-medium text-on-surface-variant">Action</span>
              <select
                bind:value={config.scamFilterAction}
                class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface"
              >
                <option value="DELETE">Supprimer</option>
                <option value="DELETE_AND_WARN">Supprimer et avertir</option>
                <option value="DELETE_AND_TIMEOUT">Supprimer et exclure</option>
                <option value="DELETE_AND_BAN">Supprimer et bannir</option>
              </select>
            </label>
            {@render numberField('scamFilterTimeoutMin', 'Exclusion (minutes)', 1, 40320)}
            {@render channelSelect('scamFilterAlertChannelId', 'Salon d\'alerte')}
          </div>

          <div class="grid sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="text-[12.5px] font-medium text-on-surface-variant">Domaines bloqués supplémentaires</span>
              <textarea
                rows="3"
                value={(config.scamFilterCustomDomains ?? []).join('\n')}
                oninput={(e) => (config.scamFilterCustomDomains = e.currentTarget.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                placeholder="exemple-scam.com"
                class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface font-mono resize-y"
              ></textarea>
            </label>
            <label class="block">
              <span class="text-[12.5px] font-medium text-on-surface-variant">Domaines exemptés</span>
              <textarea
                rows="3"
                value={(config.scamFilterWhitelist ?? []).join('\n')}
                oninput={(e) => (config.scamFilterWhitelist = e.currentTarget.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                placeholder="mon-site.fr"
                class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface font-mono resize-y"
              ></textarea>
            </label>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Rôle de tag"
        description="Récompense les membres qui arborent le tag du serveur sur leur profil."
        icon="Tag"
      >
        <div class="space-y-3">
          {@render switchRow('tagRoleEnabled', 'Rôle de tag', 'Le rôle est attribué automatiquement dès qu\'un membre affiche le tag du serveur, et retiré dès qu\'il l\'enlève.')}
          {@render roleSelect('tagRoleId', 'Rôle attribué')}
        </div>
      </SectionCard>

      <SectionCard
        title="Signalements communautaires"
        description="Donne aux membres un canal structuré pour remonter les abus."
        icon="Flag"
      >
        <div class="space-y-3">
          {@render switchRow('reportsEnabled', 'Signalements', 'Les membres peuvent signaler un message ou un membre vers un salon staff.')}
          {@render switchRow('reportsAnonymous', 'Signalements anonymes', 'Masque l\'auteur du signalement dans l\'embed staff. Réduit la peur des représailles, au prix de la traçabilité des abus de signalement.')}
          <div class="grid sm:grid-cols-2 gap-3">
            {@render channelSelect('reportsChannelId', 'Salon des signalements')}
            {@render numberField('reportsCooldownSec', 'Délai entre deux signalements (s)', 0, 3600, 'Anti-abus.')}
          </div>
        </div>
      </SectionCard>
    {/if}

    {#if activeTab === 'invites'}
      <SectionCard
        title="Invite Guard"
        description="Contrôle qui ouvre le serveur, et comment."
        icon="Link"
      >
        <div class="space-y-3">
          {@render switchRow('inviteGuardEnabled', 'Invite Guard', 'Surveille et journalise les créations d\'invitations.')}
          {@render switchRow('inviteRequireUnitary', 'Exiger des invitations unitaires', 'Toute invitation à usages multiples ou illimités est supprimée. C\'est ce qui rend la source d\'un raid identifiable après coup.')}
          {@render switchRow('inviteValidationEnabled', 'Validation par le staff', 'Chaque invitation est supprimée puis recréée seulement après approbation.')}

          <div class="grid sm:grid-cols-3 gap-3">
            {@render numberField('inviteSpamThreshold', 'Seuil de création', 1, 100, 'Alerte au-delà de N créations.')}
            {@render numberField('inviteSpamWindowSec', 'Fenêtre (secondes)', 5, 3600)}
            {@render channelSelect('inviteAlertChannelId', 'Salon d\'alerte')}
          </div>

          <div>
            <p class="text-[12.5px] font-medium text-on-surface-variant mb-2">Rôles exemptés</p>
            <div class="flex flex-wrap gap-1.5">
              {#each roles as role (role.id)}
                <button
                  type="button"
                  class="px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors
                  {(config.inviteBypassRoleIds ?? []).includes(role.id)
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'bg-surface-container-low border-outline-variant/40 text-on-surface-variant hover:text-on-surface'}"
                  onclick={() => toggleInList('inviteBypassRoleIds', role.id)}
                >
                  {role.name}
                </button>
              {/each}
            </div>
          </div>
        </div>
      </SectionCard>
    {/if}

    {#if activeTab === 'queues'}
      <SectionCard title="Signalements en attente" icon="Flag">
        {#snippet actions()}
          <RefreshButton onclick={loadQueues} iconOnly />
        {/snippet}

        {#if reports.length === 0}
          <EmptyState icon="ShieldCheck" title="Aucun signalement en attente" description="La file est vide." />
        {:else}
          <div class="space-y-2.5">
            {#each reports as report (report.id)}
              <article class="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-3.5">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="text-[13px] text-on-surface">
                      <code class="text-[11.5px]">{report.reporterId}</code> signale
                      <code class="text-[11.5px]">{report.targetId}</code>
                      <span class="text-on-surface-variant/60 ml-1">· {formatRelative(report.createdAt)}</span>
                    </p>
                    <p class="mt-1 text-[12.5px] text-on-surface-variant leading-relaxed">{report.reason}</p>
                    {#if report.messageContent}
                      <p class="mt-2 text-[12px] text-on-surface-variant bg-surface-container/60 rounded px-2.5 py-1.5 font-mono break-words">
                        {report.messageContent}
                      </p>
                    {/if}
                    {#if report.channelId}
                      <p class="mt-1 text-[11.5px] text-on-surface-variant/60">dans #{channelName(report.channelId)}</p>
                    {/if}
                  </div>
                  <div class="flex flex-col gap-1.5 shrink-0">
                    <button
                      type="button"
                      class="px-2.5 py-1 rounded-lg text-[12px] font-medium bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-50 transition-colors"
                      disabled={busyAction !== null}
                      onclick={() => decideReport(report, true)}
                    >
                      Traiter
                    </button>
                    <button
                      type="button"
                      class="px-2.5 py-1 rounded-lg text-[12px] font-medium text-on-surface-variant border border-outline-variant/40 hover:text-on-surface disabled:opacity-50 transition-colors"
                      disabled={busyAction !== null}
                      onclick={() => decideReport(report, false)}
                    >
                      Rejeter
                    </button>
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </SectionCard>

      <SectionCard title="Invitations à valider" icon="Link">
        {#if inviteRequests.length === 0}
          <EmptyState icon="ShieldCheck" title="Aucune demande" description="Aucune invitation en attente de validation." />
        {:else}
          <div class="space-y-2.5">
            {#each inviteRequests as request (request.id)}
              <article class="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-3.5 flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-[13px] text-on-surface">
                    <code class="text-[11.5px]">{request.creatorId}</code> pour #{channelName(request.channelId)}
                  </p>
                  <p class="text-[12px] text-on-surface-variant mt-0.5">
                    {request.maxUses === 0 ? 'usages illimités' : `${request.maxUses} usage(s)`} ·
                    {request.maxAgeSec === 0 ? 'sans expiration' : `${Math.round(request.maxAgeSec / 3600)} h`} ·
                    {formatRelative(request.createdAt)}
                  </p>
                </div>
                <div class="flex flex-col gap-1.5 shrink-0">
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded-lg text-[12px] font-medium bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
                    disabled={busyAction !== null}
                    onclick={() => decideInvite(request, true)}
                  >
                    Approuver
                  </button>
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded-lg text-[12px] font-medium bg-error/15 text-error border border-error/30 hover:bg-error/25 disabled:opacity-50 transition-colors"
                    disabled={busyAction !== null}
                    onclick={() => decideInvite(request, false)}
                  >
                    Rejeter
                  </button>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </SectionCard>

      <SectionCard
        title="Lignage des invitations"
        description="D'où vient un membre, et qui est entré par la même porte. Quand un raideur est démasqué, ses invités le sont rarement seuls."
        icon="GitBranch"
      >
        <div class="flex flex-wrap items-end gap-2">
          <label class="block flex-1 min-w-55">
            <span class="text-[12.5px] font-medium text-on-surface-variant">Identifiant du membre</span>
            <input
              type="text"
              bind:value={lineageUserId}
              placeholder="123456789012345678"
              class="mt-1 w-full rounded-lg bg-surface-container border border-outline-variant/40 px-3 py-2 text-[13px] text-on-surface font-mono"
            />
          </label>
          <button
            type="button"
            class="px-3 py-2 rounded-lg text-[12.5px] font-medium bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-50 transition-colors"
            disabled={!lineageUserId.trim() || lineageLoading}
            onclick={loadLineage}
          >
            {lineageLoading ? 'Analyse…' : 'Analyser'}
          </button>
        </div>

        {#if lineage}
          <div class="mt-4 space-y-3">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div class="rounded-lg bg-surface-container/60 px-2 py-2">
                <div class="text-[15px] font-semibold text-on-surface tabular-nums">{lineage.chain.length}</div>
                <div class="text-[11px] text-on-surface-variant">niveaux de parrainage</div>
              </div>
              <div class="rounded-lg bg-surface-container/60 px-2 py-2">
                <div class="text-[15px] font-semibold text-on-surface tabular-nums">{lineage.directInvites}</div>
                <div class="text-[11px] text-on-surface-variant">invités directs</div>
              </div>
              <div class="rounded-lg bg-surface-container/60 px-2 py-2">
                <div class="text-[15px] font-semibold text-on-surface tabular-nums">{lineage.totalDescendants}</div>
                <div class="text-[11px] text-on-surface-variant">descendance totale</div>
              </div>
              <div class="rounded-lg px-2 py-2 {lineage.taintedDescendants > 0 ? 'bg-error/10' : 'bg-surface-container/60'}">
                <div class="text-[15px] font-semibold tabular-nums {lineage.taintedDescendants > 0 ? 'text-error' : 'text-on-surface'}">
                  {lineage.taintedDescendants}
                </div>
                <div class="text-[11px] text-on-surface-variant">déjà sanctionnés</div>
              </div>
            </div>

            {#if lineage.trust.penalty > 0}
              <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                <p class="text-[12.5px] text-on-surface-variant leading-relaxed">
                  Pénalité de confiance héritée : <span class="font-semibold text-amber-500">−{lineage.trust.penalty}</span>.
                  Parrain problématique au degré {lineage.trust.depth} :
                  <code class="text-[11.5px]">{lineage.trust.taintedBy}</code>.
                </p>
              </div>
            {/if}

            {#if lineage.chain.length > 0}
              <div>
                <p class="text-[12px] text-on-surface-variant mb-1">Chaîne de parrainage</p>
                <div class="flex flex-wrap items-center gap-1">
                  {#each [...lineage.chain].reverse() as ancestor}
                    <code class="text-[11.5px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">{ancestor}</code>
                    <span class="text-on-surface-variant/40">→</span>
                  {/each}
                  <code class="text-[11.5px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">{lineage.userId}</code>
                </div>
              </div>
            {/if}

            {#if lineage.totalDescendants > 0}
              <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-outline-variant/30">
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-surface-container text-on-surface border border-outline-variant/40 hover:border-outline-variant disabled:opacity-50 transition-colors"
                  disabled={busyAction !== null}
                  onclick={() => runQuarantine(true)}
                >
                  Simuler la quarantaine
                </button>
                {#if quarantinePreview !== null}
                  <span class="text-[12px] text-on-surface-variant">
                    {quarantinePreview} membre(s) seraient mis en quarantaine.
                  </span>
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-error/15 text-error border border-error/30 hover:bg-error/25 disabled:opacity-50 transition-colors"
                    disabled={busyAction !== null || quarantinePreview === 0}
                    onclick={() => runQuarantine(false)}
                  >
                    Appliquer
                  </button>
                {/if}
              </div>
              <p class="text-[11.5px] text-on-surface-variant/70">
                La quarantaine pose un rôle restrictif ou une exclusion de 24 h - jamais un bannissement.
                Le staff n'est jamais touché. La décision définitive reste humaine.
              </p>
            {/if}
          </div>
        {/if}
      </SectionCard>

      <SectionCard
        title="Empreintes d'arnaque"
        description="Alimentées automatiquement par le honeypot. Les empreintes globales sont partagées entre serveurs et ne peuvent pas être supprimées ici."
        icon="Fingerprint"
      >
        {#if scamImages.length === 0}
          <EmptyState icon="Image" title="Aucune empreinte" description="Le honeypot n'a encore capté aucune image d'arnaque." />
        {:else}
          <div class="space-y-1.5">
            {#each scamImages as image (image.id)}
              <div class="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/30 px-3 py-2">
                <div class="min-w-0">
                  <p class="text-[12.5px] text-on-surface truncate">{image.filename ?? 'sans nom'}</p>
                  <p class="text-[11px] text-on-surface-variant/60 font-mono truncate">
                    {image.hash.slice(0, 24)}… · {image.source}{image.guildId === null ? ' · global' : ''}
                  </p>
                </div>
                {#if image.guildId !== null}
                  <button
                    type="button"
                    class="px-2 py-1 rounded text-[11.5px] text-error hover:bg-error/10 disabled:opacity-50 transition-colors shrink-0"
                    disabled={busyAction !== null}
                    onclick={() => removeScamImage(image)}
                  >
                    Supprimer
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </SectionCard>
    {/if}

    {#if dirty}
      <div class="sticky bottom-4 z-10">
        <div class="flex items-center justify-between gap-4 rounded-xl border border-primary/40 bg-surface-container-high/95 backdrop-blur px-4 py-3 shadow-lg">
          <p class="text-[13px] text-on-surface">Modifications non enregistrées</p>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-on-surface-variant hover:text-on-surface transition-colors"
              onclick={() => (config = { ...original })}
              disabled={saving}
            >
              Annuler
            </button>
            <button
              type="button"
              class="px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium bg-primary text-on-primary hover:opacity-90 disabled:opacity-50 transition-opacity"
              onclick={save}
              disabled={saving}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    {/if}
  {/if}
  {/snippet}
</SecurityPage>
