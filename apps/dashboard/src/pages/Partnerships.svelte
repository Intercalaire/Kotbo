<script lang="ts">
  /**
   * Partenariats : les dossiers, leur avancement et ce qu'ils rapportent.
   *
   * Trois vues pour trois moments du travail, et pas une page par objet :
   *   - le pipeline, pour voir où en est chaque dossier ;
   *   - les demandes, pour trancher ce qui arrive ;
   *   - les réglages, qu'on ouvre une fois puis plus jamais.
   *
   * La fiche d'un dossier s'ouvre en panneau plutôt qu'en page : on y revient
   * sans cesse depuis le pipeline, et perdre la colonne de départ à chaque
   * consultation rendait le suivi pénible.
   */
  import { onMount } from 'svelte';
  import { authStore } from '../lib/stores/auth.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import {
    fetchPartnerships,
    fetchPartners,
    fetchPartnerApplications,
    createPartnership,
    createPartner,
    setPartnershipStage,
    decidePartnerApplication,
    updatePartnershipSettings,
    fetchPartnershipFinance,
    lookupPartnerInvite,
  } from '../lib/api';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import SectionCard from '../lib/components/SectionCard.svelte';
  import EmptyState from '../lib/components/EmptyState.svelte';
  import RefreshButton from '../lib/components/RefreshButton.svelte';
  import ActionButton from '../lib/components/ActionButton.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import Modal from '../lib/components/Modal.svelte';
  import FormInput from '../lib/components/FormInput.svelte';
  import FormTextarea from '../lib/components/FormTextarea.svelte';
  import FormSelect from '../lib/components/FormSelect.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import PartnershipDetail from '../lib/components/partnerships/PartnershipDetail.svelte';
  import PartnershipSettingsPanel from '../lib/components/partnerships/PartnershipSettingsPanel.svelte';
  import { dateLocale } from '../lib/i18n';

  type Catalog = {
    types: { key: string; label: string; description: string; kinds: string[]; defaultTier: string }[];
    tiers: { key: string; label: string; description: string }[];
    stages: { key: string; label: string; description: string; tone: string; order: number; live: boolean; terminal: boolean }[];
    benefits: { key: string; label: string; description: string; needsTarget: boolean; requiresModule?: string }[];
    commitments: { key: string; label: string; description: string; quantified: boolean; measure: string }[];
    kinds: { key: string; label: string; description: string }[];
    reputationReasons: Record<string, string>;
  };

  type PartnershipRow = {
    id: string;
    type: string;
    tier: string;
    stage: string;
    title: string | null;
    priority: number;
    endAt: string | null;
    healthScore: number;
    referredJoins: number;
    referredActive: number;
    ownerUserId: string | null;
    partner: { id: string; displayName: string; kind: string; iconUrl: string | null; trustScore: number };
  };

  type ApplicationRow = {
    id: string;
    projectName: string;
    description: string | null;
    memberCount: number | null;
    applicantTag: string | null;
    inviteUrl: string | null;
    status: string;
    createdAt: string;
    screening: { flags?: string[] } | null;
  };

  let loading = $state(true);
  let view = $state<'pipeline' | 'requests' | 'settings'>('pipeline');
  let partnerships = $state<PartnershipRow[]>([]);
  let applications = $state<ApplicationRow[]>([]);
  let partners = $state<{ id: string; displayName: string; kind: string }[]>([]);
  let catalog = $state<Catalog | null>(null);
  let settings = $state<Record<string, unknown> | null>(null);
  let finance = $state<{ receivedCents: number; pendingInCents: number; lateCount: number; currency: string } | null>(null);
  let search = $state('');
  let detailId = $state<string | null>(null);

  const discordRoles = $derived(dashboardStore.state.discordRoles || []);
  const discordChannels = $derived(dashboardStore.state.discordChannels || []);

  let createOpen = $state(false);
  let creating = $state(false);
  let lookingUp = $state(false);
  /** Ce que Discord a dit du lien colle, affiche sous le champ. */
  let lookup = $state<{ displayName: string | null; memberCount: number | null; onlineCount: number | null; permanent: boolean } | null>(null);
  let form = $state({
    mode: 'existing' as 'existing' | 'new',
    partnerId: '',
    displayName: '',
    kind: 'SERVER',
    inviteUrl: '',
    partnerGuildId: '',
    description: '',
    iconUrl: '',
    bannerUrl: '',
    memberCount: 0,
    type: 'CROSS_PROMO',
    tier: '',
    title: '',
    summary: '',
    endAt: '',
  });

  /** Dossiers visibles, filtrés par la recherche locale. */
  const visible = $derived(
    search.trim()
      ? partnerships.filter((row) =>
          `${row.partner.displayName} ${row.title ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : partnerships,
  );

  /**
   * Colonnes du pipeline. Seules les étapes qui portent au moins un dossier
   * sont affichées : douze colonnes vides masquent les trois qui comptent.
   */
  const columns = $derived.by(() => {
    if (!catalog) return [];
    const used = new Set(visible.map((row) => row.stage));
    return catalog.stages
      .filter((stage) => used.has(stage.key))
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({ stage, rows: visible.filter((row) => row.stage === stage.key) }));
  });

  const pendingCount = $derived(applications.filter((row) => row.status === 'PENDING' || row.status === 'REVIEWING').length);

  const toneClass: Record<string, string> = {
    neutral: 'bg-surface-container text-on-surface-variant',
    info: 'bg-primary/10 text-primary',
    success: 'bg-emerald-500/10 text-emerald-500',
    warning: 'bg-amber-500/10 text-amber-500',
    danger: 'bg-error/10 text-error',
  };

  function healthClass(score: number): string {
    if (score >= 60) return 'text-emerald-500';
    if (score >= 40) return 'text-amber-500';
    return 'text-error';
  }

  async function load() {
    loading = true;
    try {
      const [list, apps, partnerList, financeSummary] = await Promise.all([
        fetchPartnerships(),
        fetchPartnerApplications(),
        fetchPartners(),
        fetchPartnershipFinance(),
      ]);

      partnerships = list?.partnerships ?? [];
      catalog = list?.catalog ?? null;
      settings = list?.settings ?? null;
      applications = apps?.applications ?? [];
      partners = partnerList?.partners ?? [];
      finance = financeSummary?.summary ?? null;
    } catch (err: any) {
      toast.error(err?.message || 'Chargement des partenariats impossible');
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    form = {
      mode: partners.length > 0 ? 'existing' : 'new',
      partnerId: partners[0]?.id ?? '',
      displayName: '',
      kind: 'SERVER',
      inviteUrl: '',
      partnerGuildId: '',
      description: '',
      iconUrl: '',
      bannerUrl: '',
      memberCount: 0,
      type: 'CROSS_PROMO',
      tier: '',
      title: '',
      summary: '',
      endAt: '',
    };
    lookup = null;
    createOpen = true;
  }

  /**
   * Remplit la fiche a partir du lien d'invitation colle.
   *
   * Nom, presentation, icone, banniere, effectif et identifiant du serveur
   * viennent de Discord : les faire recopier a la main garantissait une fiche
   * fausse au premier changement de nom. Ce qui a deja ete saisi est conserve.
   */
  async function fillFromInvite() {
    if (lookingUp || !form.inviteUrl.trim()) return;
    lookingUp = true;
    try {
      const result = await lookupPartnerInvite(form.inviteUrl.trim());
      const found = result?.lookup;
      if (!found) {
        toast.error('Invitation introuvable, expiree ou mal formee');
        lookup = null;
        return;
      }

      form.displayName = form.displayName.trim() || found.displayName || '';
      form.description = form.description.trim() || found.description || '';
      form.partnerGuildId = form.partnerGuildId.trim() || found.guildId || '';
      form.iconUrl = form.iconUrl || found.iconUrl || '';
      form.bannerUrl = form.bannerUrl || found.bannerUrl || '';
      form.memberCount = Number(form.memberCount) || found.memberCount || 0;
      lookup = found;

      toast.success(`Fiche completee depuis ${found.displayName ?? 'le serveur'}`);
    } catch (err: any) {
      toast.error(err?.message || 'Lecture du lien impossible');
    } finally {
      lookingUp = false;
    }
  }

  /**
   * Ouvre un dossier. Quand le partenaire n'existe pas encore, sa fiche est
   * créée d'abord : c'est elle qui survivra aux dossiers successifs.
   */
  async function submitCreate() {
    if (creating) return;

    if (form.mode === 'new' && !form.displayName.trim()) {
      toast.error('Donnez un nom au partenaire.');
      return;
    }
    if (form.mode === 'existing' && !form.partnerId) {
      toast.error('Choisissez une fiche partenaire.');
      return;
    }

    creating = true;
    try {
      let partnerId = form.partnerId;

      if (form.mode === 'new') {
        const created = await createPartner({
          displayName: form.displayName.trim(),
          kind: form.kind,
          inviteUrl: form.inviteUrl.trim() || null,
          partnerGuildId: form.partnerGuildId.trim() || null,
          description: form.description.trim() || null,
          iconUrl: form.iconUrl || null,
          bannerUrl: form.bannerUrl || null,
          memberCount: Number(form.memberCount) || null,
        });
        partnerId = created?.partner?.id;
        if (!partnerId) throw new Error("La fiche partenaire n'a pas été créée.");
      }

      const result = await createPartnership({
        partnerId,
        type: form.type,
        tier: form.tier || undefined,
        title: form.title.trim() || null,
        summary: form.summary.trim() || null,
        endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
      });

      toast.success('Dossier ouvert');
      createOpen = false;
      await load();
      if (result?.partnership?.id) detailId = result.partnership.id;
    } catch (err: any) {
      toast.error(err?.message || "Ouverture du dossier impossible");
    } finally {
      creating = false;
    }
  }

  /**
   * Fait avancer un dossier depuis le pipeline. Une rupture demande son motif
   * ici plutôt que d'échouer côté serveur : c'est le seul endroit où la
   * personne a le contexte en tête.
   */
  async function moveStage(row: PartnershipRow, stage: string) {
    let reason: string | undefined;

    if (stage === 'BREACHED') {
      const confirmed = await confirmDialog.ask({
        title: `Rompre le partenariat avec ${row.partner.displayName} ?`,
        description:
          'Les avantages accordés sont retirés, la vitrine est dépubliée et le motif sera conservé dans son historique.',
        confirmLabel: 'Rompre',
        variant: 'danger',
      });
      if (!confirmed) return;
      reason = window.prompt('Motif de la rupture (obligatoire)')?.trim() || undefined;
      if (!reason) {
        toast.error('Une rupture demande un motif.');
        return;
      }
    }

    try {
      await setPartnershipStage(row.id, stage, reason);
      toast.success('Étape mise à jour');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Changement d\'étape refusé');
    }
  }

  async function decide(application: ApplicationRow, status: 'ACCEPTED' | 'REJECTED') {
    let reason: string | undefined;
    if (status === 'REJECTED') {
      reason = window.prompt('Motif du refus (communiqué au demandeur)')?.trim() || undefined;
    }

    try {
      await decidePartnerApplication(application.id, { status, reason });
      toast.success(status === 'ACCEPTED' ? 'Demande acceptée' : 'Demande refusée');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Décision impossible');
    }
  }

  async function saveSettings(patch: Record<string, unknown>) {
    try {
      const result = await updatePartnershipSettings(patch);
      settings = result?.settings ?? settings;
      toast.success('Réglages enregistrés');
    } catch (err: any) {
      toast.error(err?.message || 'Enregistrement impossible');
    }
  }

  function money(cents: number, currency: string): string {
    return new Intl.NumberFormat(dateLocale(), { style: 'currency', currency: currency || 'EUR' }).format(cents / 100);
  }

  onMount(() => {
    if (authStore.selectedGuildId) void load();
  });
</script>

<ModulePage
  title="Partenariats"
  description="Partenaires, accords, avantages accordés et retombées mesurées"
  icon="handshake"
  featureKey="partnerships"
>
  {#snippet actions()}
    <ActionButton variant="primary" size="sm" icon="plus" label="Nouveau dossier" onclick={openCreate} />
    <RefreshButton onclick={load} loading={loading} />
  {/snippet}

  <!-- Bandeau de synthèse : ce qu'on veut savoir avant de descendre dans le détail. -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
    <div class="rounded-xl bg-surface-container px-3 py-2.5">
      <div class="text-[18px] font-semibold text-on-surface tabular-nums">
        {partnerships.filter((row) => row.stage === 'ACTIVE' || row.stage === 'RENEWAL').length}
      </div>
      <div class="text-[11px] text-on-surface-variant">Partenariats actifs</div>
    </div>
    <div class="rounded-xl bg-surface-container px-3 py-2.5">
      <div class="text-[18px] font-semibold text-on-surface tabular-nums">
        {partnerships.reduce((total, row) => total + row.referredJoins, 0)}
      </div>
      <div class="text-[11px] text-on-surface-variant">Arrivées apportées</div>
    </div>
    <div class="rounded-xl bg-surface-container px-3 py-2.5">
      <div class="text-[18px] font-semibold text-on-surface tabular-nums">{pendingCount}</div>
      <div class="text-[11px] text-on-surface-variant">Demandes en attente</div>
    </div>
    <div class="rounded-xl bg-surface-container px-3 py-2.5">
      <div class="text-[18px] font-semibold text-on-surface tabular-nums">
        {finance ? money(finance.receivedCents, finance.currency) : '-'}
      </div>
      <div class="text-[11px] text-on-surface-variant">
        Encaissé{finance && finance.lateCount > 0 ? ` · ${finance.lateCount} en retard` : ''}
      </div>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-2 mb-4">
    <div class="inline-flex rounded-lg bg-surface-container p-0.5">
      <button
        class="px-3 py-1.5 text-[12px] rounded-md {view === 'pipeline' ? 'bg-surface text-on-surface' : 'text-on-surface-variant'}"
        onclick={() => (view = 'pipeline')}
      >
        Pipeline
      </button>
      <button
        class="px-3 py-1.5 text-[12px] rounded-md {view === 'requests' ? 'bg-surface text-on-surface' : 'text-on-surface-variant'}"
        onclick={() => (view = 'requests')}
      >
        Demandes{pendingCount > 0 ? ` (${pendingCount})` : ''}
      </button>
      <button
        class="px-3 py-1.5 text-[12px] rounded-md {view === 'settings' ? 'bg-surface text-on-surface' : 'text-on-surface-variant'}"
        onclick={() => (view = 'settings')}
      >
        Réglages
      </button>
    </div>

    {#if view === 'pipeline'}
      <input
        class="flex-1 min-w-[180px] max-w-xs rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 text-[12px] text-on-surface"
        placeholder="Rechercher un partenaire"
        bind:value={search}
      />
    {/if}
  </div>

  {#if loading && partnerships.length === 0}
    <LoadingHint context="config" />
  {:else if view === 'pipeline'}
    {#if visible.length === 0}
      <EmptyState
        icon="handshake"
        title="Aucun partenariat"
        description="Ouvrez un dossier pour suivre un échange de pubs, une alliance ou un sponsor : avantages appliqués, engagements mesurés, retombées comptées."
      />
    {:else}
      <div class="flex gap-3 overflow-x-auto pb-2 items-start">
        {#each columns as column (column.stage.key)}
          <div class="min-w-[260px] w-[260px] shrink-0">
            <div class="flex items-center justify-between mb-2 px-1">
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full {toneClass[column.stage.tone] ?? toneClass.neutral}">
                {column.stage.label}
              </span>
              <span class="text-[11px] text-on-surface-variant tabular-nums">{column.rows.length}</span>
            </div>

            <div class="space-y-2">
              {#each column.rows as row (row.id)}
                {@const typeMeta = catalog?.types.find((t) => t.key === row.type)}
                <button
                  class="w-full text-left rounded-xl border border-outline-variant/20 bg-surface-container-low/60 hover:bg-surface-container px-3 py-2.5 transition-colors"
                  onclick={() => (detailId = row.id)}
                >
                  <div class="flex items-start gap-2">
                    {#if row.partner.iconUrl}
                      <img src={row.partner.iconUrl} alt="" class="w-7 h-7 rounded-lg object-cover shrink-0" />
                    {:else}
                      <div class="w-7 h-7 rounded-lg bg-surface-container grid place-items-center shrink-0">
                        <Papicon icon="server" size={13} />
                      </div>
                    {/if}
                    <div class="min-w-0 flex-1">
                      <p class="text-[13px] font-medium text-on-surface truncate">{row.partner.displayName}</p>
                      <p class="text-[11px] text-on-surface-variant truncate">{typeMeta?.label ?? row.type}</p>
                    </div>
                    <span class="text-[11px] font-semibold tabular-nums {healthClass(row.healthScore)}">{row.healthScore}</span>
                  </div>

                  <div class="flex items-center gap-3 mt-2 text-[10.5px] text-on-surface-variant">
                    <span class="inline-flex items-center gap-1">
                      <Papicon icon="user-plus" size={11} />
                      {row.referredJoins}
                    </span>
                    {#if row.endAt}
                      <span class="inline-flex items-center gap-1">
                        <Papicon icon="calendar" size={11} />
                        {new Date(row.endAt).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' })}
                      </span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {:else if view === 'requests'}
    {#if applications.length === 0}
      <EmptyState
        icon="inbox"
        title="Aucune demande"
        description="Les candidatures arrivent par la commande /partenariat proposer, par un formulaire ou par l'annuaire, selon ce que vous avez ouvert dans les réglages."
      />
    {:else}
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
        {#each applications as application (application.id)}
          {@const flags = application.screening?.flags ?? []}
          <SectionCard title={application.projectName} description={application.applicantTag ?? undefined}>
            {#snippet actions()}
              <span class="text-[11px] px-2 py-0.5 rounded-full font-semibold {application.status === 'PENDING' ? toneClass.info : toneClass.neutral}">
                {application.status}
              </span>
            {/snippet}

            <div class="space-y-3">
              {#if application.description}
                <p class="text-[12px] text-on-surface-variant whitespace-pre-wrap">{application.description}</p>
              {/if}

              <div class="flex flex-wrap gap-3 text-[11px] text-on-surface-variant">
                {#if application.memberCount}
                  <span class="inline-flex items-center gap-1"><Papicon icon="users" size={12} />{application.memberCount} membres</span>
                {/if}
                {#if application.inviteUrl}
                  <a class="inline-flex items-center gap-1 text-primary hover:underline" href={application.inviteUrl} target="_blank" rel="noopener noreferrer">
                    <Papicon icon="link" size={12} />Voir le serveur
                  </a>
                {/if}
                <span class="inline-flex items-center gap-1">
                  <Papicon icon="calendar" size={12} />
                  {new Date(application.createdAt).toLocaleDateString(dateLocale())}
                </span>
              </div>

              {#if flags.length > 0}
                <!-- Points de vigilance : affichés, jamais bloquants. Le réseau
                     informe, il ne décide pas. -->
                <div class="rounded-lg bg-amber-500/10 px-3 py-2 space-y-1">
                  {#each flags as flag (flag)}
                    <p class="text-[11px] text-amber-500 flex items-start gap-1.5">
                      <Papicon icon="alert-triangle" size={12} class="mt-0.5 shrink-0" />
                      <span>{flag}</span>
                    </p>
                  {/each}
                </div>
              {/if}

              {#if application.status === 'PENDING' || application.status === 'REVIEWING'}
                <div class="flex gap-2 pt-1 border-t border-outline-variant/10">
                  <ActionButton variant="primary" size="sm" icon="check" label="Accepter" onclick={() => decide(application, 'ACCEPTED')} />
                  <ActionButton variant="danger" size="sm" icon="x" label="Refuser" onclick={() => decide(application, 'REJECTED')} />
                </div>
              {/if}
            </div>
          </SectionCard>
        {/each}
      </div>
    {/if}
  {:else}
    <PartnershipSettingsPanel
      settings={settings}
      channels={discordChannels}
      roles={discordRoles}
      tiers={catalog?.tiers ?? []}
      onsave={saveSettings}
    />
  {/if}
</ModulePage>

<!-- ── Ouverture d'un dossier ────────────────────────────────────────────── -->
<Modal bind:open={createOpen} title="Nouveau dossier" subtitle="Avec qui, et de quel type" size="lg" closeOnBackdropClick={!creating}>
  <div class="p-5 space-y-4">
    <div class="inline-flex rounded-lg bg-surface-container p-0.5">
      <button
        class="px-3 py-1.5 text-[12px] rounded-md {form.mode === 'existing' ? 'bg-surface text-on-surface' : 'text-on-surface-variant'}"
        onclick={() => (form.mode = 'existing')}
        disabled={partners.length === 0}
      >
        Partenaire connu
      </button>
      <button
        class="px-3 py-1.5 text-[12px] rounded-md {form.mode === 'new' ? 'bg-surface text-on-surface' : 'text-on-surface-variant'}"
        onclick={() => (form.mode = 'new')}
      >
        Nouveau partenaire
      </button>
    </div>

    {#if form.mode === 'existing'}
      <label class="block">
        <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Fiche partenaire</span>
        <FormSelect bind:value={form.partnerId} className="w-full">
          {#each partners as partner (partner.id)}
            <option value={partner.id}>{partner.displayName}</option>
          {/each}
        </FormSelect>
      </label>
    {:else}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormInput label="Nom du partenaire" bind:value={form.displayName} placeholder="Nom de la communauté" />
        <label class="block">
          <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Nature</span>
          <FormSelect bind:value={form.kind} className="w-full">
            {#each catalog?.kinds ?? [] as kind (kind.key)}
              <option value={kind.key}>{kind.label}</option>
            {/each}
          </FormSelect>
        </label>
        <div class="sm:col-span-2 space-y-1.5">
          <FormInput label="Lien d'invitation" bind:value={form.inviteUrl} placeholder="https://discord.gg/…" />
          <div class="flex flex-wrap items-center gap-2">
            <ActionButton
              variant="neutral"
              size="sm"
              icon="sparkles"
              label={lookingUp ? 'Lecture…' : 'Remplir depuis le lien'}
              onclick={fillFromInvite}
            />
            {#if lookup}
              <span class="text-[11px] text-on-surface-variant">
                {lookup.displayName ?? 'Serveur'}
                {#if lookup.memberCount} · {lookup.memberCount.toLocaleString('fr-FR')} membres{/if}
                {#if lookup.onlineCount} · {lookup.onlineCount.toLocaleString('fr-FR')} en ligne{/if}
                {#if !lookup.permanent} · lien temporaire, il expirera{/if}
              </span>
            {/if}
          </div>
        </div>
        <FormInput label="Identifiant du serveur" bind:value={form.partnerGuildId} placeholder="Rempli par le lien" />
      </div>
    {/if}

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Type de partenariat</span>
        <FormSelect bind:value={form.type} className="w-full">
          {#each catalog?.types ?? [] as type (type.key)}
            <option value={type.key}>{type.label}</option>
          {/each}
        </FormSelect>
      </label>
      <label class="block">
        <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Niveau de suivi</span>
        <FormSelect bind:value={form.tier} className="w-full">
          <option value="">Celui du type</option>
          {#each catalog?.tiers ?? [] as tier (tier.key)}
            <option value={tier.key}>{tier.label}</option>
          {/each}
        </FormSelect>
      </label>
    </div>

    {#if catalog}
      {@const typeMeta = catalog.types.find((t) => t.key === form.type)}
      {#if typeMeta}
        <p class="text-[11.5px] text-on-surface-variant">{typeMeta.description}</p>
      {/if}
    {/if}

    <FormInput label="Intitulé du dossier" bind:value={form.title} placeholder="Optionnel" />
    <label class="block">
      <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Résumé</span>
      <FormTextarea bind:value={form.summary} rows={3} placeholder="Ce qui est convenu, en deux lignes" />
    </label>
    <FormInput label="Échéance" type="date" bind:value={form.endAt} />

    <p class="text-[11px] text-on-surface-variant">
      Le dossier s'ouvre à l'étape « Piste ». Les avantages ne sont appliqués qu'à l'activation.
    </p>
  </div>

  {#snippet footer()}
    <div class="flex justify-end gap-2 px-5 py-3">
      <ActionButton variant="neutral" size="sm" label="Annuler" onclick={() => (createOpen = false)} />
      <ActionButton variant="primary" size="sm" label={creating ? 'Création…' : 'Ouvrir le dossier'} onclick={submitCreate} />
    </div>
  {/snippet}
</Modal>

<!-- ── Fiche d'un dossier ────────────────────────────────────────────────── -->
{#if detailId && catalog}
  <PartnershipDetail
    partnershipId={detailId}
    catalog={catalog}
    channels={discordChannels}
    roles={discordRoles}
    onclose={() => (detailId = null)}
    onchanged={load}
    onstage={moveStage}
  />
{/if}
