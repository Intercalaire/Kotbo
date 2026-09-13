<script lang="ts">
  /**
   * Fiche d'un partenariat, en panneau modal.
   *
   * Cinq onglets, dans l'ordre du travail : ce qu'il rapporte, ce qui a été
   * promis, ce qu'on lui accorde, ce qu'on publie, et ce qui s'est passé. Les
   * accords et les échéances n'apparaissent que pour les dossiers qui les
   * exigent - afficher un échéancier sur un échange de pubs entre amis n'aide
   * personne.
   */
  import { onMount } from 'svelte';
  import {
    fetchPartnership,
    setPartnershipStage,
    approvePartnership,
    ensurePartnershipInvite,
    refreshPartnershipHealth,
    checkPartnershipReciprocity,
    refreshPartnershipShowcase,
    addPartnershipBenefit,
    removePartnershipBenefit,
    applyPartnershipBenefits,
    revokePartnershipBenefits,
    addPartnershipCommitment,
    setCommitmentState,
    removeCommitment,
    savePartnershipPromotion,
    publishPartnershipPromotion,
    draftPartnershipAgreement,
    agreementAction,
    createGuestAccess,
    addPartnershipPayment,
    settlePartnershipPayment,
    addPartnershipNote,
  } from '../../api';
  import { toast } from '../../stores/toast.svelte';
  import Modal from '../Modal.svelte';
  import ActionButton from '../ActionButton.svelte';
  import FormInput from '../FormInput.svelte';
  import FormTextarea from '../FormTextarea.svelte';
  import FormSelect from '../FormSelect.svelte';
  import Papicon from '../Papicon.svelte';
  import { dateLocale } from '../../i18n';

  const {
    partnershipId,
    catalog,
    channels = [],
    roles = [],
    onclose,
    onchanged,
  }: {
    partnershipId: string;
    catalog: any;
    channels?: { id: string; name: string }[];
    roles?: { id: string; name: string }[];
    onclose: () => void;
    onchanged: () => void | Promise<void>;
    /** Conservé pour l'appelant : le pipeline pilote aussi les étapes. */
    onstage?: (row: any, stage: string) => void | Promise<void>;
  } = $props();

  let open = $state(true);
  let loading = $state(true);
  let data = $state<any>(null);
  let report = $state<any>(null);
  let bridged = $state<any>(null);
  let nextStages = $state<string[]>([]);
  let tab = $state<'resume' | 'commitments' | 'benefits' | 'promotions' | 'journal'>('resume');

  let noteDraft = $state('');
  let agreementDraft = $state('');
  let benefitKind = $state('PARTNER_ROLE');
  let benefitTarget = $state('');
  let commitmentKind = $state('PROMO_POST');
  let commitmentCount = $state(1);
  let commitmentPeriod = $state('month');
  let promoTitle = $state('');
  let promoContent = $state('');
  let promoChannel = $state('');
  let paymentAmount = $state(0);
  let paymentDue = $state('');

  const tierMeta = $derived(catalog?.tiers?.find((tier: any) => tier.key === data?.tier));
  const stageMeta = $derived(catalog?.stages?.find((stage: any) => stage.key === data?.stage));
  const typeMeta = $derived(catalog?.types?.find((type: any) => type.key === data?.type));

  /** Le niveau contractuel seul ouvre accords et échéancier. */
  const showAgreements = $derived(data?.tier === 'CONTRACT');
  const showFinance = $derived(data?.tier === 'CONTRACT' || (data?.payments?.length ?? 0) > 0);

  async function load() {
    loading = true;
    try {
      const result = await fetchPartnership(partnershipId);
      data = result?.partnership ?? null;
      report = result?.report ?? null;
      bridged = result?.bridged ?? null;
      nextStages = result?.nextStages ?? [];

      promoChannel = data?.promotions?.[0]?.channelId ?? '';
      promoTitle = data?.promotions?.[0]?.title ?? '';
      promoContent = data?.promotions?.[0]?.content ?? '';
    } catch (err: any) {
      toast.error(err?.message || 'Chargement du dossier impossible');
    } finally {
      loading = false;
    }
  }

  /** Enveloppe commune : rafraîchit la fiche et la liste, signale l'échec. */
  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
      await load();
      await onchanged();
    } catch (err: any) {
      toast.error(err?.message || 'Action impossible');
    }
  }

  async function move(stage: string) {
    let reason: string | undefined;
    if (stage === 'BREACHED') {
      reason = window.prompt('Motif de la rupture (obligatoire)')?.trim() || undefined;
      if (!reason) {
        toast.error('Une rupture demande un motif.');
        return;
      }
    }
    await run(() => setPartnershipStage(partnershipId, stage, reason), 'Étape mise à jour');
  }

  async function createGuestLink() {
    try {
      const result = await createGuestAccess(partnershipId, { capability: 'sign', days: 30 });
      const token = result?.token;
      if (!token) throw new Error('Lien non créé');

      const url = `${window.location.origin}/partner-portal/${token}`;
      await navigator.clipboard?.writeText(url).catch(() => null);
      // Affiché une seule fois : la base n'en garde que l'empreinte.
      window.prompt('Lien à transmettre au partenaire (affiché une seule fois)', url);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Création du lien impossible');
    }
  }

  function money(cents: number, currency = 'EUR'): string {
    return new Intl.NumberFormat(dateLocale(), { style: 'currency', currency }).format(cents / 100);
  }

  function date(value: string | null | undefined): string {
    return value ? new Date(value).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  }

  const commitmentTone: Record<string, string> = {
    ON_TRACK: 'text-emerald-500',
    FULFILLED: 'text-emerald-500',
    AT_RISK: 'text-amber-500',
    BREACHED: 'text-error',
    PENDING: 'text-on-surface-variant',
    WAIVED: 'text-on-surface-variant',
  };

  onMount(load);
</script>

<Modal
  bind:open
  title={data?.partner?.displayName ?? 'Partenariat'}
  subtitle={typeMeta ? `${typeMeta.label} · ${tierMeta?.label ?? data?.tier}` : undefined}
  size="xl"
  onClose={onclose}
>
  {#if loading}
    <div class="p-8 text-center text-[12px] text-on-surface-variant">Chargement…</div>
  {:else if !data}
    <div class="p-8 text-center text-[12px] text-on-surface-variant">Dossier introuvable.</div>
  {:else}
    <div class="p-5 space-y-4">
      <!-- Entête : l'état et les gestes qui le changent. -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-surface-container text-on-surface-variant">
          {stageMeta?.label ?? data.stage}
        </span>
        <span class="text-[11px] text-on-surface-variant">Santé {data.healthScore}/100</span>
        <span class="text-[11px] text-on-surface-variant">Confiance {data.partner.trustScore}/100</span>
        {#if bridged}
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary inline-flex items-center gap-1">
            <Papicon icon="link" size={11} />
            Pont confirmé · {bridged.stage}
          </span>
        {/if}
      </div>

      <div class="flex flex-wrap gap-2">
        {#each nextStages as stage (stage)}
          {@const meta = catalog?.stages?.find((s: any) => s.key === stage)}
          <ActionButton
            variant={stage === 'BREACHED' ? 'danger' : stage === 'ACTIVE' ? 'primary' : 'neutral'}
            size="sm"
            label={meta?.label ?? stage}
            onclick={() => move(stage)}
          />
        {/each}
        {#if !data.secondApprovedByUserId}
          <ActionButton variant="neutral" size="sm" icon="check" label="Valider" onclick={() => run(() => approvePartnership(partnershipId), 'Validation posée')} />
        {/if}
      </div>

      <!-- Onglets -->
      <div class="inline-flex rounded-lg bg-surface-container p-0.5 flex-wrap">
        {#each [['resume', 'Résumé'], ['commitments', 'Engagements'], ['benefits', 'Avantages'], ['promotions', 'Publicité'], ['journal', 'Journal']] as [key, label] (key)}
          <button
            class="px-3 py-1.5 text-[12px] rounded-md {tab === key ? 'bg-surface text-on-surface' : 'text-on-surface-variant'}"
            onclick={() => (tab = key as typeof tab)}
          >
            {label}
          </button>
        {/each}
      </div>

      {#if tab === 'resume'}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {#each [['Arrivées', report?.joins ?? 0], ['Encore là', report?.stillHere ?? 0], ['Rétention', report?.retentionRate === null || report?.retentionRate === undefined ? '-' : `${report.retentionRate}%`], ['Publicités', report?.adsPublished ?? 0]] as [label, value] (label)}
            <div class="rounded-lg bg-surface-container px-2 py-1.5 text-center">
              <div class="text-[14px] font-semibold text-on-surface tabular-nums">{value}</div>
              <div class="text-[10px] text-on-surface-variant">{label}</div>
            </div>
          {/each}
        </div>

        {#if data.summary}
          <p class="text-[12px] text-on-surface-variant whitespace-pre-wrap">{data.summary}</p>
        {/if}

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
          <div class="rounded-lg bg-surface-container-low/50 px-3 py-2">
            <p class="text-[11px] text-on-surface-variant">Période</p>
            <p class="text-on-surface">{date(data.startAt)} → {date(data.endAt)}</p>
          </div>
          <div class="rounded-lg bg-surface-container-low/50 px-3 py-2">
            <p class="text-[11px] text-on-surface-variant">Invitation dédiée</p>
            <p class="text-on-surface">
              {#if data.inviteCode}
                discord.gg/{data.inviteCode}
              {:else}
                <button class="text-primary hover:underline" onclick={() => run(() => ensurePartnershipInvite(partnershipId), 'Invitation créée')}>
                  En créer une
                </button>
              {/if}
            </p>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <ActionButton variant="neutral" size="sm" icon="refresh-cw" label="Recalculer la santé" onclick={() => run(() => refreshPartnershipHealth(partnershipId), 'Santé recalculée')} />
          <ActionButton variant="neutral" size="sm" icon="eye" label="Vérifier la réciprocité" onclick={() => run(() => checkPartnershipReciprocity(partnershipId), 'Contrôle effectué')} />
          <ActionButton variant="neutral" size="sm" icon="layout-grid" label="Republier la vitrine" onclick={() => run(() => refreshPartnershipShowcase(partnershipId), 'Vitrine mise à jour')} />
          <ActionButton variant="neutral" size="sm" icon="link" label="Lien pour le partenaire" onclick={createGuestLink} />
        </div>

        {#if data.checks?.length}
          <div class="space-y-1">
            <p class="text-[11px] font-bold text-on-surface-variant/80">Derniers contrôles</p>
            {#each data.checks.slice(0, 3) as check (check.id)}
              <p class="text-[11px] text-on-surface-variant">
                {date(check.checkedAt)} · {check.result}{check.detail ? ` - ${check.detail}` : ''}
              </p>
            {/each}
          </div>
        {/if}

        {#if showAgreements}
          <div class="pt-3 border-t border-outline-variant/10 space-y-2">
            <p class="text-[11px] font-bold text-on-surface-variant/80">Accord</p>
            {#each data.agreements ?? [] as agreement (agreement.id)}
              <div class="rounded-lg bg-surface-container-low/50 px-3 py-2 flex items-center justify-between gap-3">
                <span class="text-[12px] text-on-surface">
                  Version {agreement.version} · {agreement.state}
                  {#if agreement.acceptedByUs}· nous ✓{/if}
                  {#if agreement.acceptedByPartner}· partenaire ✓{/if}
                </span>
                <span class="flex gap-1.5">
                  {#if agreement.state === 'DRAFT'}
                    <ActionButton variant="primary" size="sm" label="Proposer" onclick={() => run(() => agreementAction(partnershipId, agreement.id, 'propose'), 'Version proposée')} />
                  {/if}
                  {#if agreement.state === 'PROPOSED' && !agreement.acceptedByUs}
                    <ActionButton variant="neutral" size="sm" label="Accepter" onclick={() => run(() => agreementAction(partnershipId, agreement.id, 'accept'), 'Accord accepté')} />
                  {/if}
                </span>
              </div>
            {/each}

            <FormTextarea bind:value={agreementDraft} rows={3} placeholder="Texte de l'accord" />
            <ActionButton
              variant="neutral"
              size="sm"
              icon="file-text"
              label="Rédiger une version"
              onclick={() => run(async () => {
                if (!agreementDraft.trim()) throw new Error('Le texte est vide.');
                await draftPartnershipAgreement(partnershipId, agreementDraft.trim());
                agreementDraft = '';
              }, 'Version rédigée')}
            />
          </div>
        {/if}

        {#if showFinance}
          <div class="pt-3 border-t border-outline-variant/10 space-y-2">
            <p class="text-[11px] font-bold text-on-surface-variant/80">Échéances</p>
            {#each data.payments ?? [] as payment (payment.id)}
              <div class="rounded-lg bg-surface-container-low/50 px-3 py-2 flex items-center justify-between gap-3">
                <span class="text-[12px] text-on-surface">
                  {money(payment.amountCents, payment.currency)} · {date(payment.dueAt)} · {payment.status}
                </span>
                {#if payment.status !== 'RECEIVED'}
                  <ActionButton variant="neutral" size="sm" label="Reçu" onclick={() => run(() => settlePartnershipPayment(partnershipId, payment.id, {}), 'Versement enregistré')} />
                {/if}
              </div>
            {/each}

            <div class="flex gap-2 items-end">
              <label class="block flex-1">
                <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Montant (centimes)</span>
                <FormInput type="number" bind:value={paymentAmount} />
              </label>
              <label class="block flex-1">
                <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Échéance</span>
                <FormInput type="date" bind:value={paymentDue} />
              </label>
              <ActionButton
                variant="neutral"
                size="sm"
                icon="plus"
                label="Ajouter"
                onclick={() => run(async () => {
                  if (!paymentDue) throw new Error('Choisissez une date.');
                  await addPartnershipPayment(partnershipId, {
                    amountCents: Number(paymentAmount),
                    dueAt: new Date(paymentDue).toISOString(),
                  });
                  paymentAmount = 0;
                  paymentDue = '';
                }, 'Échéance ajoutée')}
              />
            </div>
          </div>
        {/if}
      {:else if tab === 'commitments'}
        <div class="space-y-2">
          {#each data.commitments ?? [] as commitment (commitment.id)}
            {@const meta = catalog?.commitments?.find((c: any) => c.key === commitment.kind)}
            <div class="rounded-lg bg-surface-container-low/50 px-3 py-2">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[12px] text-on-surface">
                  {commitment.label ?? meta?.label ?? commitment.kind}
                  {#if commitment.targetCount}
                    <span class="text-on-surface-variant"> · {commitment.targetCount}/{commitment.targetPeriod}</span>
                  {/if}
                </span>
                <span class="text-[11px] font-semibold {commitmentTone[commitment.state] ?? ''}">{commitment.state}</span>
              </div>
              <div class="flex flex-wrap items-center gap-2 mt-1.5">
                <span class="text-[10.5px] text-on-surface-variant">
                  {commitment.party === 'US' ? 'À notre charge' : commitment.party === 'BOTH' ? 'Des deux côtés' : 'À leur charge'}
                  {#if meta} · constat {meta.measure === 'AUTOMATIC' ? 'automatique' : meta.measure === 'RECIPROCITY' ? 'par réciprocité' : 'manuel'}{/if}
                </span>
                <button class="text-[10.5px] text-emerald-500 hover:underline" onclick={() => run(() => setCommitmentState(partnershipId, commitment.id, { state: 'FULFILLED' }), 'Pointé comme tenu')}>
                  Tenu
                </button>
                <button class="text-[10.5px] text-error hover:underline" onclick={() => run(() => setCommitmentState(partnershipId, commitment.id, { state: 'BREACHED' }), 'Pointé comme non tenu')}>
                  Non tenu
                </button>
                <button class="text-[10.5px] text-on-surface-variant hover:underline" onclick={() => run(() => removeCommitment(partnershipId, commitment.id), 'Engagement retiré')}>
                  Retirer
                </button>
              </div>
            </div>
          {/each}

          <div class="flex flex-wrap gap-2 items-end pt-2 border-t border-outline-variant/10">
            <label class="block flex-1 min-w-[160px]">
              <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Engagement</span>
              <FormSelect bind:value={commitmentKind} className="w-full">
                {#each catalog?.commitments ?? [] as item (item.key)}
                  <option value={item.key}>{item.label}</option>
                {/each}
              </FormSelect>
            </label>
            <label class="block w-24">
              <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Quantité</span>
              <FormInput type="number" bind:value={commitmentCount} />
            </label>
            <label class="block w-32">
              <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Période</span>
              <FormSelect bind:value={commitmentPeriod} className="w-full">
                <option value="day">Par jour</option>
                <option value="week">Par semaine</option>
                <option value="month">Par mois</option>
                <option value="total">Au total</option>
              </FormSelect>
            </label>
            <ActionButton
              variant="neutral"
              size="sm"
              icon="plus"
              label="Ajouter"
              onclick={() => run(() => addPartnershipCommitment(partnershipId, {
                kind: commitmentKind,
                targetCount: Number(commitmentCount),
                targetPeriod: commitmentPeriod,
              }), 'Engagement ajouté')}
            />
          </div>
        </div>
      {:else if tab === 'benefits'}
        <div class="space-y-2">
          {#each data.benefits ?? [] as benefit (benefit.id)}
            {@const meta = catalog?.benefits?.find((b: any) => b.key === benefit.kind)}
            <div class="rounded-lg bg-surface-container-low/50 px-3 py-2 flex items-center justify-between gap-3">
              <span class="text-[12px] text-on-surface">
                {meta?.label ?? benefit.kind}
                <span class="text-on-surface-variant"> · {benefit.state}</span>
                {#if benefit.grants?.length}
                  <span class="text-on-surface-variant"> · {benefit.grants.length} application(s)</span>
                {/if}
                {#if benefit.lastError}
                  <span class="text-error block text-[10.5px]">{benefit.lastError}</span>
                {/if}
              </span>
              <button class="text-[10.5px] text-error hover:underline shrink-0" onclick={() => run(() => removePartnershipBenefit(partnershipId, benefit.id), 'Avantage retiré')}>
                Retirer
              </button>
            </div>
          {/each}

          <div class="flex flex-wrap gap-2 items-end pt-2 border-t border-outline-variant/10">
            <label class="block flex-1 min-w-[160px]">
              <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Avantage</span>
              <FormSelect bind:value={benefitKind} className="w-full">
                {#each catalog?.benefits ?? [] as item (item.key)}
                  <option value={item.key}>{item.label}</option>
                {/each}
              </FormSelect>
            </label>
            <label class="block flex-1 min-w-[160px]">
              <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Cible</span>
              <FormSelect bind:value={benefitTarget} className="w-full">
                <option value="">Par défaut</option>
                {#each roles as role (role.id)}
                  <option value={role.id}>@{role.name}</option>
                {/each}
                {#each channels as channel (channel.id)}
                  <option value={channel.id}>#{channel.name}</option>
                {/each}
              </FormSelect>
            </label>
            <ActionButton
              variant="neutral"
              size="sm"
              icon="plus"
              label="Ajouter"
              onclick={() => run(() => addPartnershipBenefit(partnershipId, { kind: benefitKind, targetRef: benefitTarget || null }), 'Avantage ajouté')}
            />
          </div>

          <div class="flex gap-2">
            <ActionButton variant="primary" size="sm" icon="check" label="Appliquer maintenant" onclick={() => run(() => applyPartnershipBenefits(partnershipId), 'Avantages appliqués')} />
            <ActionButton variant="warning" size="sm" icon="x" label="Tout retirer" onclick={() => run(() => revokePartnershipBenefits(partnershipId), 'Avantages retirés')} />
          </div>

          <p class="text-[11px] text-on-surface-variant">
            Ce qui existait avant le partenariat n'est jamais retiré : le module rend l'état comme il l'a trouvé.
          </p>
        </div>
      {:else if tab === 'promotions'}
        <div class="space-y-3">
          {#each data.promotions ?? [] as promotion (promotion.id)}
            <div class="rounded-lg bg-surface-container-low/50 px-3 py-2">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[12px] text-on-surface">
                  {promotion.title ?? 'Publicité'} · {promotion.postCount} publication(s)
                </span>
                <ActionButton variant="neutral" size="sm" icon="send" label="Publier" onclick={() => run(() => publishPartnershipPromotion(partnershipId, promotion.id), 'Publiée')} />
              </div>
              {#if promotion.posts?.length}
                <p class="text-[10.5px] text-on-surface-variant mt-1">Dernière : {date(promotion.posts[0].postedAt)}</p>
              {/if}
            </div>
          {/each}

          <div class="space-y-2 pt-2 border-t border-outline-variant/10">
            <FormInput label="Titre" bind:value={promoTitle} placeholder="Titre de l'annonce" />
            <label class="block">
              <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Texte</span>
              <FormTextarea bind:value={promoContent} rows={4} placeholder="Ce que le partenaire souhaite annoncer" />
            </label>
            <label class="block">
              <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Salon</span>
              <FormSelect bind:value={promoChannel} className="w-full">
                <option value="">Salon des publicités</option>
                {#each channels as channel (channel.id)}
                  <option value={channel.id}>#{channel.name}</option>
                {/each}
              </FormSelect>
            </label>
            <ActionButton
              variant="neutral"
              size="sm"
              icon="save"
              label="Enregistrer la publicité"
              onclick={() => run(() => savePartnershipPromotion(partnershipId, {
                id: data.promotions?.[0]?.id,
                title: promoTitle,
                content: promoContent,
                channelId: promoChannel || null,
              }), 'Publicité enregistrée')}
            />
            <p class="text-[11px] text-on-surface-variant">
              Les mentions du texte sont neutralisées à la publication : un partenaire ne fait pas mentionner
              @everyone par votre bot.
            </p>
          </div>
        </div>
      {:else}
        <div class="space-y-3">
          <div class="flex gap-2 items-end">
            <label class="block flex-1">
              <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Note interne</span>
              <FormTextarea bind:value={noteDraft} rows={2} placeholder="Jamais visible du partenaire" />
            </label>
            <ActionButton
              variant="neutral"
              size="sm"
              icon="plus"
              label="Ajouter"
              onclick={() => run(async () => {
                if (!noteDraft.trim()) throw new Error('Note vide.');
                await addPartnershipNote(partnershipId, { body: noteDraft.trim() });
                noteDraft = '';
              }, 'Note ajoutée')}
            />
          </div>

          {#each data.notes ?? [] as note (note.id)}
            <div class="rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2">
              <p class="text-[12px] text-on-surface whitespace-pre-wrap">{note.body}</p>
              <p class="text-[10.5px] text-on-surface-variant mt-1">{date(note.createdAt)}</p>
            </div>
          {/each}

          <div class="space-y-1 pt-2 border-t border-outline-variant/10">
            {#each data.events ?? [] as event (event.id)}
              <div class="flex items-start gap-2 text-[11.5px]">
                <span class="text-on-surface-variant tabular-nums shrink-0">{date(event.createdAt)}</span>
                <span class="text-on-surface">{event.summary}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</Modal>
