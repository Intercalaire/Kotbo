<script lang="ts">
  /**
   * Ajout d'un partenaire, en trois questions.
   *
   * Le formulaire complet demande une trentaine de decisions - type, niveau,
   * engagements de chaque partie, avantages, invitation - avant meme d'avoir
   * parle a qui que ce soit. L'assistant pose trois questions et deduit le
   * reste d'un prereglage, comme les rythmes de l'economie : qui, quel genre
   * de partenariat, et on verifie avant de creer.
   *
   * Tout reste modifiable ensuite depuis la fiche : le prereglage est un point
   * de depart, pas un moule.
   */
  import { createPartnershipQuick, lookupPartnerInvite } from '../../api';
  import { toast } from '../../stores/toast.svelte';
  import Modal from '../Modal.svelte';
  import ActionButton from '../ActionButton.svelte';
  import FormInput from '../FormInput.svelte';
  import FormSelect from '../FormSelect.svelte';
  import Papicon from '../Papicon.svelte';

  const {
    catalog,
    onclose,
    oncreated,
    onmanual,
  }: {
    catalog: any;
    onclose: () => void;
    oncreated: (partnershipId: string) => void | Promise<void>;
    /** Sortie vers le formulaire complet, pour les cas que rien ne couvre. */
    onmanual: () => void;
  } = $props();

  let open = $state(true);
  let step = $state<1 | 2 | 3>(1);
  let lookingUp = $state(false);
  let creating = $state(false);

  let inviteInput = $state('');
  let presetKey = $state('cross-promo');
  let endAt = $state('');

  let partner = $state({
    displayName: '',
    kind: 'SERVER',
    inviteUrl: '',
    partnerGuildId: '',
    description: '',
    iconUrl: '',
    bannerUrl: '',
    memberCount: 0,
  });

  let lookup = $state<any>(null);

  const presets = $derived((catalog?.presets ?? []) as any[]);
  const preset = $derived(presets.find((item) => item.key === presetKey) ?? null);
  const commitmentLabel = (kind: string) =>
    catalog?.commitments?.find((item: any) => item.key === kind)?.label ?? kind;
  const benefitLabel = (kind: string) => catalog?.benefits?.find((item: any) => item.key === kind)?.label ?? kind;
  const tierLabel = (key: string) => catalog?.tiers?.find((item: any) => item.key === key)?.label ?? key;

  const canContinue = $derived(step === 1 ? partner.displayName.trim().length > 0 : true);

  /**
   * Resout le lien colle et remplit la fiche. C'est le chemin normal : un lien
   * d'invitation suffit a connaitre le nom, la presentation, l'icone et
   * l'effectif du serveur d'en face.
   */
  async function resolveInvite() {
    if (lookingUp || !inviteInput.trim()) return;
    lookingUp = true;
    try {
      const result = await lookupPartnerInvite(inviteInput.trim());
      const found = result?.lookup;
      if (!found) {
        toast.error('Invitation introuvable, expiree ou mal formee');
        return;
      }

      lookup = found;
      partner = {
        ...partner,
        displayName: found.displayName ?? partner.displayName,
        inviteUrl: inviteInput.trim(),
        partnerGuildId: found.guildId ?? '',
        description: found.description ?? '',
        iconUrl: found.iconUrl ?? '',
        bannerUrl: found.bannerUrl ?? '',
        memberCount: found.memberCount ?? 0,
      };
      toast.success(`${found.displayName ?? 'Serveur'} reconnu`);
    } catch (err: any) {
      toast.error(err?.message || 'Lecture du lien impossible');
    } finally {
      lookingUp = false;
    }
  }

  async function create() {
    if (creating) return;
    creating = true;
    try {
      const result = await createPartnershipQuick({
        preset: presetKey,
        partner: {
          displayName: partner.displayName.trim(),
          kind: partner.kind,
          inviteUrl: partner.inviteUrl.trim() || null,
          partnerGuildId: partner.partnerGuildId.trim() || null,
          description: partner.description.trim() || null,
          iconUrl: partner.iconUrl || null,
          bannerUrl: partner.bannerUrl || null,
          memberCount: Number(partner.memberCount) || null,
        },
        endAt: endAt ? new Date(endAt).toISOString() : null,
      });

      for (const warning of result?.warnings ?? []) toast.error(warning);

      const counts = result?.created;
      toast.success(
        `Dossier ouvert : ${counts?.commitments ?? 0} engagement(s), ${counts?.benefits ?? 0} avantage(s)` +
          (counts?.inviteCode ? ', invitation dediee creee' : ''),
      );

      open = false;
      await oncreated(result?.partnershipId);
    } catch (err: any) {
      toast.error(err?.message || 'Creation impossible');
    } finally {
      creating = false;
    }
  }
</script>

<Modal
  bind:open
  title="Ajouter un partenaire"
  subtitle={step === 1 ? 'Avec qui ?' : step === 2 ? 'Quel genre de partenariat ?' : 'On verifie et on cree'}
  size="lg"
  onClose={onclose}
  closeOnBackdropClick={!creating}
>
  <div class="p-5 space-y-4">
    <!-- Fil des etapes : savoir ou l'on en est et combien il en reste. -->
    <div class="flex items-center gap-2">
      {#each [1, 2, 3] as index (index)}
        <div class="flex-1 h-1 rounded-full {index <= step ? 'bg-primary' : 'bg-surface-container'}"></div>
      {/each}
    </div>

    {#if step === 1}
      <div class="space-y-3">
        <label class="block">
          <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">
            Lien d'invitation de leur serveur
          </span>
          <div class="flex gap-2">
            <div class="flex-1">
              <FormInput bind:value={inviteInput} placeholder="https://discord.gg/…" />
            </div>
            <ActionButton
              variant="primary"
              size="sm"
              icon="sparkles"
              label={lookingUp ? 'Lecture…' : 'Reconnaitre'}
              onclick={resolveInvite}
            />
          </div>
          <span class="text-[11px] text-on-surface-variant ml-1 mt-1 block">
            Le nom, la presentation, l'icone et l'effectif sont lus depuis Discord. Rien a recopier.
          </span>
        </label>

        {#if lookup}
          <div class="rounded-xl border border-outline-variant/20 bg-surface-container-low/60 px-3 py-2.5 flex items-center gap-3">
            {#if lookup.iconUrl}
              <img src={lookup.iconUrl} alt="" class="w-10 h-10 rounded-lg object-cover" />
            {/if}
            <div class="min-w-0">
              <p class="text-[13px] font-medium text-on-surface truncate">{lookup.displayName}</p>
              <p class="text-[11px] text-on-surface-variant">
                {#if lookup.memberCount}{lookup.memberCount.toLocaleString('fr-FR')} membres{/if}
                {#if lookup.onlineCount} · {lookup.onlineCount.toLocaleString('fr-FR')} en ligne{/if}
                {#if !lookup.permanent} · lien temporaire{/if}
              </p>
            </div>
          </div>
        {/if}

        <div class="pt-2 border-t border-outline-variant/10 space-y-3">
          <p class="text-[11px] text-on-surface-variant">
            Pas de lien sous la main, ou un partenaire qui n'est pas un serveur ? Remplissez a la main.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput label="Nom du partenaire" bind:value={partner.displayName} />
            <label class="block">
              <span class="text-[11px] font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Nature</span>
              <FormSelect bind:value={partner.kind} className="w-full">
                {#each catalog?.kinds ?? [] as kind (kind.key)}
                  <option value={kind.key}>{kind.label}</option>
                {/each}
              </FormSelect>
            </label>
          </div>
        </div>
      </div>
    {:else if step === 2}
      <div class="space-y-2">
        {#each presets as item (item.key)}
          <button
            class="w-full text-left rounded-xl border px-3 py-2.5 transition-colors {presetKey === item.key
              ? 'border-primary bg-primary/5'
              : 'border-outline-variant/20 bg-surface-container-low/40 hover:bg-surface-container'}"
            onclick={() => (presetKey = item.key)}
          >
            <div class="flex items-start gap-2.5">
              <Papicon icon={item.icon} size={16} class="mt-0.5 shrink-0 text-on-surface-variant" />
              <div class="min-w-0">
                <p class="text-[13px] font-medium text-on-surface flex items-center gap-2">
                  {item.label}
                  {#if item.recommended}
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">le plus courant</span>
                  {/if}
                </p>
                <p class="text-[11.5px] text-on-surface-variant mt-0.5">{item.description}</p>
              </div>
            </div>
          </button>
        {/each}

        <button class="text-[11.5px] text-primary hover:underline pt-1" onclick={onmanual}>
          Aucun ne correspond : ouvrir le formulaire complet
        </button>
      </div>
    {:else if preset}
      <div class="space-y-3">
        <div class="rounded-xl bg-surface-container-low/60 px-3 py-2.5">
          <p class="text-[13px] text-on-surface">
            <span class="font-medium">{partner.displayName || 'Partenaire'}</span>
            <span class="text-on-surface-variant"> · {preset.label} · suivi {tierLabel(preset.tier)}</span>
          </p>
        </div>

        <div>
          <p class="text-[11px] font-bold text-on-surface-variant/80 mb-1.5">Ce qui sera posé</p>
          <div class="space-y-1">
            {#each preset.commitments as commitment (commitment.kind + commitment.party)}
              <p class="text-[12px] text-on-surface flex items-start gap-1.5">
                <Papicon icon="check" size={12} class="mt-0.5 shrink-0 text-emerald-500" />
                <span>
                  {commitmentLabel(commitment.kind)}
                  <span class="text-on-surface-variant">
                    · {commitment.party === 'US' ? 'à notre charge' : commitment.party === 'BOTH' ? 'des deux côtés' : 'à leur charge'}
                    {#if commitment.targetCount} · {commitment.targetCount} par {commitment.targetPeriod}{/if}
                  </span>
                </span>
              </p>
            {/each}
            {#each preset.benefits as benefit (benefit)}
              <p class="text-[12px] text-on-surface flex items-start gap-1.5">
                <Papicon icon="check" size={12} class="mt-0.5 shrink-0 text-emerald-500" />
                <span>{benefitLabel(benefit)} <span class="text-on-surface-variant">· accordé à l'activation</span></span>
              </p>
            {/each}
            {#if preset.trackInvite}
              <p class="text-[12px] text-on-surface flex items-start gap-1.5">
                <Papicon icon="check" size={12} class="mt-0.5 shrink-0 text-emerald-500" />
                <span>Invitation dédiée <span class="text-on-surface-variant">· pour compter ce que ce partenaire apporte</span></span>
              </p>
            {/if}
          </div>
        </div>

        <FormInput label="Échéance (facultatif)" type="date" bind:value={endAt} />

        <p class="text-[11px] text-on-surface-variant">
          Le dossier s'ouvre à l'étape « Piste ». Les avantages ne seront appliqués qu'à l'activation, et tout
          reste modifiable depuis la fiche.
        </p>
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <div class="flex items-center justify-between gap-2 px-5 py-3">
      <ActionButton
        variant="neutral"
        size="sm"
        label={step === 1 ? 'Annuler' : 'Retour'}
        onclick={() => (step === 1 ? (open = false, onclose()) : (step = (step - 1) as 1 | 2))}
      />
      {#if step < 3}
        <ActionButton
          variant="primary"
          size="sm"
          label="Continuer"
          disabled={!canContinue}
          onclick={() => (step = (step + 1) as 2 | 3)}
        />
      {:else}
        <ActionButton
          variant="primary"
          size="sm"
          icon="check"
          label={creating ? 'Création…' : 'Créer le partenariat'}
          onclick={create}
        />
      {/if}
    </div>
  {/snippet}
</Modal>
