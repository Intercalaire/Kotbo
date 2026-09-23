<script lang="ts">
  /**
   * Réglages du module Partenariats.
   *
   * Rangés dans l'ordre où on les rencontre : d'abord les salons et rôles sans
   * lesquels rien ne peut se poser, puis les candidatures, puis les
   * automatismes, puis ce qui sort du serveur (annuaire, réseau).
   *
   * Tous les automatismes sont éteints par défaut : ils touchent à des rôles,
   * à des salons et à des exemptions d'automod. Chaque bascule enregistre
   * immédiatement - un formulaire de trente champs avec un bouton final ne
   * pardonne pas une fermeture d'onglet.
   */
  import SectionCard from '../SectionCard.svelte';
  import FormSelect from '../FormSelect.svelte';
  import FormInput from '../FormInput.svelte';
  import Papicon from '../Papicon.svelte';

  import type { DashboardChannel } from '@kotbo/contracts';
  // Le panneau n'affiche qu'un nom : la forme complete est celle que l'API
  // rend, et la redeclarer ici avait fini par diverger - `type` y etait
  // annonce en nombre alors que la reponse porte une chaine.
  type Channel = Pick<DashboardChannel, 'id' | 'name'>;
  type Role = { id: string; name: string };

  const {
    settings,
    channels = [],
    roles = [],
    tiers = [],
    onsave,
  }: {
    settings: Record<string, any> | null;
    channels?: Channel[];
    roles?: Role[];
    tiers?: { key: string; label: string; description: string }[];
    onsave: (patch: Record<string, unknown>) => void | Promise<void>;
  } = $props();

  function set(key: string, value: unknown) {
    void onsave({ [key]: value });
  }

  function toggle(key: string) {
    set(key, !settings?.[key]);
  }

  function number(key: string, event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) set(key, value);
  }

  /** Bascules regroupées, pour ne pas répéter trente fois le même balisage. */
  const automations = [
    { key: 'autoPublishAds', label: 'Publier et faire tourner les publicités', hint: 'Publication programmée dans le salon des publicités.' },
    { key: 'reciprocityChecks', label: 'Vérifier la réciprocité', hint: 'Contrôle que notre publicité est toujours en place chez le partenaire.' },
    { key: 'autoApplyBenefits', label: 'Appliquer les avantages automatiquement', hint: 'À l\'activation, et les retirer à la fin.' },
    { key: 'autoBreachOnFailure', label: 'Rompre en cas de manquement répété', hint: 'Une rupture est une décision : à n\'activer qu\'en connaissance de cause.' },
    { key: 'trackInvites', label: 'Créer une invitation par partenariat', hint: 'Base de toute l\'attribution des arrivées.' },
    { key: 'trackReferredActivity', label: 'Suivre l\'activité des membres apportés', hint: 'Distingue un partenaire utile d\'un pourvoyeur de comptes inactifs.' },
  ];

  const notifications = [
    { key: 'notifyStaffChannel', label: 'Salon staff' },
    { key: 'notifyDashboard', label: 'Notifications du dashboard' },
    { key: 'notifyOwnerDm', label: 'Message privé au responsable' },
  ];
</script>

{#if !settings}
  <p class="text-xs text-on-surface-variant">Réglages indisponibles.</p>
{:else}
  <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
    <!-- ── Activation ──────────────────────────────────────────────────── -->
    <SectionCard title="Module" description="Coupe les automatismes sans rien effacer">
      <label class="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={settings.enabled} onchange={() => toggle('enabled')} class="mt-0.5" />
        <span>
          <span class="text-body-sm text-on-surface block">Activer les partenariats</span>
          <span class="text-2xs text-on-surface-variant">
            Éteint, les pages et les données restent : seuls les traitements automatiques s'arrêtent.
          </span>
        </span>
      </label>

      <div class="mt-3">
        <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Niveau de suivi par défaut</span>
        <FormSelect
          value={settings.defaultTier}
          className="w-full"
          onchange={(event) => set('defaultTier', (event.target as HTMLSelectElement).value)}
        >
          {#each tiers as tier (tier.key)}
            <option value={tier.key}>{tier.label}</option>
          {/each}
        </FormSelect>
      </div>

      <label class="flex items-start gap-3 cursor-pointer mt-3">
        <input type="checkbox" checked={settings.requireDualApproval} onchange={() => toggle('requireDualApproval')} class="mt-0.5" />
        <span>
          <span class="text-body-sm text-on-surface block">Exiger une double validation</span>
          <span class="text-2xs text-on-surface-variant">Deux personnes différentes avant qu'un dossier devienne actif.</span>
        </span>
      </label>
    </SectionCard>

    <!-- ── Salons et rôles ─────────────────────────────────────────────── -->
    <SectionCard title="Salons et rôles" description="Où le module travaille, et ce qu'il accorde">
      <div class="space-y-3">
        {#each [['staffChannelId', 'Salon de travail du staff'], ['showcaseChannelId', 'Salon vitrine'], ['adsChannelId', 'Salon des publicités'], ['digestChannelId', 'Salon du bilan périodique']] as [key, label] (key)}
          <label class="block">
            <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">{label}</span>
            <FormSelect
              value={settings[key] ?? ''}
              className="w-full"
              onchange={(event) => set(key, (event.target as HTMLSelectElement).value || null)}
            >
              <option value="">Aucun</option>
              {#each channels as channel (channel.id)}
                <option value={channel.id}>#{channel.name}</option>
              {/each}
            </FormSelect>
          </label>
        {/each}

        {#each [['partnerRoleId', 'Rôle « Partenaire »'], ['referredRoleId', 'Rôle des membres venus d\'un partenaire']] as [key, label] (key)}
          <label class="block">
            <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">{label}</span>
            <FormSelect
              value={settings[key] ?? ''}
              className="w-full"
              onchange={(event) => set(key, (event.target as HTMLSelectElement).value || null)}
            >
              <option value="">Aucun</option>
              {#each roles as role (role.id)}
                <option value={role.id}>{role.name}</option>
              {/each}
            </FormSelect>
          </label>
        {/each}
      </div>
    </SectionCard>

    <!-- ── Candidatures ────────────────────────────────────────────────── -->
    <SectionCard title="Candidatures" description="Ce que vous acceptez de recevoir">
      <label class="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={settings.applicationsOpen} onchange={() => toggle('applicationsOpen')} class="mt-0.5" />
        <span>
          <span class="text-body-sm text-on-surface block">Ouvrir les demandes</span>
          <span class="text-2xs text-on-surface-variant">Fermées, la commande répond que les demandes n'ont pas lieu.</span>
        </span>
      </label>

      <div class="grid grid-cols-2 gap-3 mt-3">
        <label class="block">
          <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Effectif minimal</span>
          <FormInput type="number" value={settings.minMemberCount} onchange={(event) => number('minMemberCount', event)} />
        </label>
        <label class="block">
          <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Ancienneté minimale (jours)</span>
          <FormInput type="number" value={settings.minServerAgeDays} onchange={(event) => number('minServerAgeDays', event)} />
        </label>
      </div>

      <label class="flex items-start gap-3 cursor-pointer mt-3">
        <input type="checkbox" checked={settings.autoRejectBelowThreshold} onchange={() => toggle('autoRejectBelowThreshold')} class="mt-0.5" />
        <span>
          <span class="text-body-sm text-on-surface block">Refuser automatiquement sous ces seuils</span>
          <span class="text-2xs text-on-surface-variant">
            Le seul filtrage qui décide seul. Tout le reste est affiché au staff, qui tranche.
          </span>
        </span>
      </label>
    </SectionCard>

    <!-- ── Automatismes ────────────────────────────────────────────────── -->
    <SectionCard title="Automatismes" description="Ce que le bot fait sans qu'on le lui demande">
      <div class="space-y-3">
        {#each automations as item (item.key)}
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={settings[item.key]} onchange={() => toggle(item.key)} class="mt-0.5" />
            <span>
              <span class="text-body-sm text-on-surface block">{item.label}</span>
              <span class="text-2xs text-on-surface-variant">{item.hint}</span>
            </span>
          </label>
        {/each}

        <div class="grid grid-cols-2 gap-3 pt-2 border-t border-outline-variant/10">
          <label class="block">
            <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Contrôle toutes les (heures)</span>
            <FormInput type="number" value={settings.reciprocityIntervalHours} onchange={(event) => number('reciprocityIntervalHours', event)} />
          </label>
          <label class="block">
            <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Tolérance avant manquement</span>
            <FormInput type="number" value={settings.reciprocityGraceCount} onchange={(event) => number('reciprocityGraceCount', event)} />
          </label>
          <label class="block">
            <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Préavis de renouvellement (jours)</span>
            <FormInput type="number" value={settings.renewalNoticeDays} onchange={(event) => number('renewalNoticeDays', event)} />
          </label>
          <label class="block">
            <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Fenêtre de rétention (jours)</span>
            <FormInput type="number" value={settings.retentionWindowDays} onchange={(event) => number('retentionWindowDays', event)} />
          </label>
        </div>
      </div>
    </SectionCard>

    <!-- ── Alertes ─────────────────────────────────────────────────────── -->
    <SectionCard title="Alertes" description="Par où le staff est prévenu">
      <div class="space-y-3">
        {#each notifications as item (item.key)}
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings[item.key]} onchange={() => toggle(item.key)} />
            <span class="text-body-sm text-on-surface">{item.label}</span>
          </label>
        {/each}

        <label class="block pt-2 border-t border-outline-variant/10">
          <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Bilan périodique</span>
          <FormSelect
            value={settings.digestFrequency}
            className="w-full"
            onchange={(event) => set('digestFrequency', (event.target as HTMLSelectElement).value)}
          >
            <option value="none">Aucun</option>
            <option value="weekly">Hebdomadaire</option>
            <option value="monthly">Mensuel</option>
          </FormSelect>
        </label>
      </div>
    </SectionCard>

    <!-- ── Annuaire et réseau ──────────────────────────────────────────── -->
    <SectionCard title="Annuaire et réseau" description="Ce qui sort de votre serveur">
      <div class="space-y-3">
        <label class="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={settings.directoryOptIn} onchange={() => toggle('directoryOptIn')} class="mt-0.5" />
          <span>
            <span class="text-body-sm text-on-surface block">Se référencer dans l'annuaire Kotbo</span>
            <span class="text-2xs text-on-surface-variant">
              Seule la fiche que vous rédigez est publiée, et l'effectif y figure par tranche.
            </span>
          </span>
        </label>

        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={settings.directoryAcceptProposals} onchange={() => toggle('directoryAcceptProposals')} />
          <span class="text-body-sm text-on-surface">Accepter les propositions reçues</span>
        </label>

        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={settings.matchmakingEnabled} onchange={() => toggle('matchmakingEnabled')} />
          <span class="text-body-sm text-on-surface">Suggestions de partenaires compatibles</span>
        </label>

        <div class="pt-2 border-t border-outline-variant/10 space-y-3">
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.reputationShare} onchange={() => toggle('reputationShare')} class="mt-0.5" />
            <span>
              <span class="text-body-sm text-on-surface block">Partager mes signalements graves</span>
              <span class="text-2xs text-on-surface-variant">
                Anonymisés : les autres serveurs voient le nombre et la nature, jamais qui a signalé.
              </span>
            </span>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.reputationConsume} onchange={() => toggle('reputationConsume')} class="mt-0.5" />
            <span>
              <span class="text-body-sm text-on-surface block">Consulter les signaux du réseau</span>
              <span class="text-2xs text-on-surface-variant">
                Affichés lors d'une demande. Un signal n'a jamais refusé un partenariat tout seul.
              </span>
            </span>
          </label>
        </div>
      </div>
    </SectionCard>

    <!-- ── Finance ─────────────────────────────────────────────────────── -->
    <SectionCard title="Finance" description="Suivi déclaratif des sponsors">
      <label class="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={settings.financeEnabled} onchange={() => toggle('financeEnabled')} class="mt-0.5" />
        <span>
          <span class="text-body-sm text-on-surface block">Suivre les montants et les échéances</span>
          <span class="text-2xs text-on-surface-variant">
            Kotbo n'encaisse rien : il tient le carnet et rappelle les dates.
          </span>
        </span>
      </label>

      <div class="grid grid-cols-2 gap-3 mt-3">
        <label class="block">
          <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Devise</span>
          <FormInput value={settings.currency} onchange={(event) => set('currency', (event.target as HTMLInputElement).value)} />
        </label>
        <label class="block">
          <span class="text-2xs font-bold text-on-surface-variant/80 ml-1 mb-1.5 block">Rappel avant échéance (jours)</span>
          <FormInput type="number" value={settings.paymentReminderDays} onchange={(event) => number('paymentReminderDays', event)} />
        </label>
      </div>

      <p class="text-2xs text-on-surface-variant mt-3 flex items-start gap-1.5">
        <Papicon icon="info" size={12} class="mt-0.5 shrink-0" />
        <span>Les montants saisis ici ne déclenchent aucun paiement et ne remontent pas à la facturation Kotbo.</span>
      </p>
    </SectionCard>
  </div>
{/if}
