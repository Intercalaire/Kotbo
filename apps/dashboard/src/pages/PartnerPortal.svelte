<script lang="ts">
  /**
   * Portail partenaire : ce qu'un partenaire sans Kotbo voit de son dossier.
   *
   * Page publique, sans compte ni connexion. Le jeton de l'URL est le seul
   * secret, et il n'ouvre que ce dossier : ni les notes internes, ni les autres
   * partenariats, ni quoi que ce soit du serveur. C'est la condition pour qu'un
   * lien transmis de bonne foi ne devienne pas une fuite.
   *
   * Un lien inconnu, révoqué ou expiré donne la même réponse - distinguer
   * renseignerait qui essaie des jetons au hasard.
   */
  import { onMount } from 'svelte';
  import { API_BASE_URL } from '../lib/api';
  import Papicon from '../lib/components/Papicon.svelte';

  const { token = '' }: { token?: string } = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let data = $state<any>(null);
  let signing = $state(false);
  let signed = $state(false);

  const partyLabel: Record<string, string> = {
    US: 'À la charge du serveur',
    PARTNER: 'À votre charge',
    BOTH: 'Des deux côtés',
  };

  /** Le portail vit hors du dashboard : pas de store d'auth, pas d'en-tête. */
  function portalUrl(suffix = ''): string {
    const base = API_BASE_URL.replace(/\/api\/dashboard$/, '/api/public');
    return `${base}/partner-portal/${encodeURIComponent(token)}${suffix}`;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await fetch(portalUrl());
      if (!response.ok) {
        error = response.status === 404 ? "Ce lien n'est plus valide." : 'Chargement impossible.';
        return;
      }
      data = await response.json();
    } catch {
      error = 'Chargement impossible.';
    } finally {
      loading = false;
    }
  }

  async function sign() {
    if (signing) return;
    signing = true;
    try {
      const response = await fetch(portalUrl('/accept'), { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        error = body?.error ?? "L'accord n'a pas pu être accepté.";
        return;
      }
      signed = true;
      await load();
    } catch {
      error = "L'accord n'a pas pu être accepté.";
    } finally {
      signing = false;
    }
  }

  function date(value: string | null | undefined): string {
    return value ? new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  }

  onMount(load);
</script>

<div class="min-h-screen bg-surface px-4 py-10">
  <div class="mx-auto max-w-2xl space-y-4">
    {#if loading}
      <p class="text-[13px] text-on-surface-variant text-center">Chargement…</p>
    {:else if error && !data}
      <div class="rounded-2xl border border-outline-variant/20 bg-surface-container px-5 py-8 text-center">
        <Papicon icon="alert-triangle" size={28} class="mx-auto mb-3 text-amber-500" />
        <p class="text-[14px] text-on-surface">{error}</p>
        <p class="text-[12px] text-on-surface-variant mt-2">
          Demandez un nouveau lien à l'équipe qui vous a contacté.
        </p>
      </div>
    {:else if data}
      <!-- Entête : qui propose, à qui. -->
      <div class="rounded-2xl border border-outline-variant/20 bg-surface-container px-5 py-4 flex items-center gap-3">
        {#if data.host.icon}
          <img src={data.host.icon} alt="" class="w-11 h-11 rounded-xl object-cover" />
        {/if}
        <div class="min-w-0">
          <p class="text-[15px] font-semibold text-on-surface truncate">{data.host.name}</p>
          <p class="text-[12px] text-on-surface-variant truncate">
            Partenariat avec {data.partner.displayName}
          </p>
        </div>
      </div>

      <div class="rounded-2xl border border-outline-variant/20 bg-surface-container px-5 py-4 space-y-3">
        <div class="flex flex-wrap gap-3 text-[12px] text-on-surface-variant">
          <span>Type : <span class="text-on-surface">{data.partnership.type}</span></span>
          <span>État : <span class="text-on-surface">{data.partnership.stage}</span></span>
          <span>Période : <span class="text-on-surface">{date(data.partnership.startAt)} → {date(data.partnership.endAt)}</span></span>
        </div>

        {#if data.partnership.summary}
          <p class="text-[13px] text-on-surface whitespace-pre-wrap">{data.partnership.summary}</p>
        {/if}
        {#if data.partnership.terms}
          <p class="text-[12.5px] text-on-surface-variant whitespace-pre-wrap">{data.partnership.terms}</p>
        {/if}
      </div>

      {#if data.commitments.length > 0}
        <div class="rounded-2xl border border-outline-variant/20 bg-surface-container px-5 py-4">
          <p class="text-[11px] font-bold text-on-surface-variant/80 mb-2">Engagements</p>
          <div class="space-y-1.5">
            {#each data.commitments as commitment (commitment.kind + commitment.label)}
              <div class="flex items-start justify-between gap-3 text-[12.5px]">
                <span class="text-on-surface">
                  {commitment.label ?? commitment.kind}
                  {#if commitment.targetCount}
                    <span class="text-on-surface-variant"> · {commitment.targetCount} par {commitment.targetPeriod}</span>
                  {/if}
                </span>
                <span class="text-[11px] text-on-surface-variant shrink-0">{partyLabel[commitment.party] ?? ''}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if data.agreement}
        <div class="rounded-2xl border border-outline-variant/20 bg-surface-container px-5 py-4 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <p class="text-[11px] font-bold text-on-surface-variant/80">Accord — version {data.agreement.version}</p>
            <span class="text-[11px] text-on-surface-variant">
              {data.agreement.acceptedByUs ? 'Signé par le serveur' : 'En attente du serveur'}
              {#if data.agreement.acceptedByPartner} · signé par vous{/if}
            </span>
          </div>

          <p class="text-[12.5px] text-on-surface whitespace-pre-wrap">{data.agreement.body}</p>

          {#if data.capability === 'sign' && !data.agreement.acceptedByPartner}
            <button
              class="rounded-lg bg-primary text-on-primary px-4 py-2 text-[13px] font-medium disabled:opacity-60"
              onclick={sign}
              disabled={signing}
            >
              {signing ? 'Enregistrement…' : "J'accepte cet accord"}
            </button>
            <p class="text-[11px] text-on-surface-variant">
              Votre acceptation est horodatée et conservée avec l'accord. Elle ne vaut que pour cette version : une
              modification ultérieure vous sera reproposée.
            </p>
          {:else if data.agreement.acceptedByPartner || signed}
            <p class="text-[12px] text-emerald-500 flex items-center gap-1.5">
              <Papicon icon="check" size={13} />
              Accord accepté.
            </p>
          {:else if data.capability !== 'sign'}
            <p class="text-[11px] text-on-surface-variant">Ce lien permet de consulter l'accord, pas de le signer.</p>
          {/if}
        </div>
      {/if}

      {#if data.documents.length > 0}
        <div class="rounded-2xl border border-outline-variant/20 bg-surface-container px-5 py-4">
          <p class="text-[11px] font-bold text-on-surface-variant/80 mb-2">Documents partagés</p>
          <div class="space-y-1">
            {#each data.documents as document (document.url)}
              <a class="text-[12.5px] text-primary hover:underline block truncate" href={document.url} target="_blank" rel="noopener noreferrer">
                {document.label}
              </a>
            {/each}
          </div>
        </div>
      {/if}

      {#if error}
        <p class="text-[12px] text-error text-center">{error}</p>
      {/if}

      <p class="text-[11px] text-on-surface-variant text-center">
        Lien valable jusqu'au {date(data.expiresAt)}. Il ne donne accès qu'à ce dossier.
      </p>
    {/if}
  </div>
</div>
