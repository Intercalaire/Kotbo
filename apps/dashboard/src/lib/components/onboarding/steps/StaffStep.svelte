<script lang="ts">
  /**
   * Qui modere, et ou Kotbo doit s'adresser a eux.
   *
   * Sans cette reponse, un serveur configure de bout en bout reste muet le jour
   * ou quelque chose se passe : les sanctions s'appliquent, les raids sont
   * bloques, et personne n'en est prevenu. C'est aussi ce qui permet aux pages
   * d'equipe du tableau de bord d'exister - un rapport d'activite du staff n'a
   * rien a compter tant qu'on ne sait pas qui en fait partie.
   *
   * L'ecran ne demande pas de construire une hierarchie : il demande de
   * designer des roles qui existent deja sur le serveur. Le premier retenu
   * devient le role de moderation de reference, celui auquel Kotbo rattache les
   * permissions par defaut ; les suivants sont declares comme staff. Batir des
   * echelons se fait depuis la page Equipe, quand on sait qui fait quoi.
   */
  import { m } from '../../../i18n';
  import { toast } from '../../../stores/toast.svelte';
  import { wizard } from '../../../stores/onboardingWizard.svelte';
  import { onboardingData } from '../../../stores/onboardingData.svelte';
  import { celebrateStep } from '../../../onboarding';
  import { updateGlobalSettings } from '../../../api';
  import ToggleCard from '../ToggleCard.svelte';
  import Papicon from '../../Papicon.svelte';
  import WizardShell from '../WizardShell.svelte';

  const { onEditTracks, skip }: { onEditTracks: () => void; skip: () => void } = $props();

  const roles = $derived(onboardingData.roles);
  const channels = $derived(onboardingData.channels);

  /**
   * Ce qui est coche a l'ouverture.
   *
   * Les roles dont le nom parle de moderation sont proposes : sur un serveur
   * habite, ce sont presque toujours les bons, et confirmer coute infiniment
   * moins cher que parcourir trente roles.
   */
  const suggested = $derived(
    roles
      .filter((role) => /mod|admin|staff|resp|helper|support/i.test(role.name))
      .slice(0, 4)
      .map((role) => role.id)
  );
  const selection = $derived(wizard.staffRoleIds ?? suggested);

  const suggestedAlert = $derived(
    channels.find((channel) => /alert|staff|mod|log/i.test(channel.name))?.id ?? ''
  );
  const alertChannelId = $derived(wizard.staffAlertChannelId ?? suggestedAlert);

  function toggle(id: string) {
    wizard.answer({
      staffRoleIds: selection.includes(id)
        ? selection.filter((entry) => entry !== id)
        : [...selection, id],
    });
    celebrateStep();
  }

  async function apply() {
    if (onboardingData.busy) return;
    onboardingData.busy = true;
    try {
      await updateGlobalSettings({
        // Le premier retenu fait reference : c'est celui auquel les permissions
        // par defaut se rattachent. L'ordre affiche est celui de la hierarchie
        // Discord, donc le plus haut role coche l'emporte - ce qui est bien ce
        // qu'on veut.
        moderatorRoleId: selection[0] ?? null,
        baseStaffRoleId: selection[0] ?? null,
        sanctionAlertChannelId: alertChannelId || null,
      });
      wizard.answer({ staffRoleIds: selection, staffAlertChannelId: alertChannelId || null });
      celebrateStep();
      wizard.complete('staff');
    } catch (err: any) {
      toast.error(err?.message || "L'équipe n'a pas pu être enregistrée.");
    } finally {
      onboardingData.busy = false;
    }
  }
</script>

<WizardShell
  title={m.onb_staff_title()}
  lead={m.onb_staff_lead()}
  {onEditTracks}
>
  <div class="space-y-7">
    <div>
      <p class="text-[13px] font-semibold text-on-surface mb-2.5">{m.onb_staff_pick()}</p>

      {#if roles.length === 0}
        <p class="rounded-2xl border border-dashed border-outline-variant/40 px-4 py-6 text-center text-[13px] text-on-surface-variant/55 leading-relaxed">
          {m.onb_staff_empty()}
        </p>
      {:else}
        <div class="grid gap-2.5 sm:grid-cols-2 max-h-[380px] overflow-y-auto pr-1">
          {#each roles as role (role.id)}
            <ToggleCard
              label={role.name}
              selected={selection.includes(role.id)}
              onclick={() => toggle(role.id)}
            >
              <span
                class="mt-1.5 inline-block w-8 h-1.5 rounded-full"
                style="background-color: {role.color && role.color !== '#000000' ? role.color : 'var(--outline-variant, #64748b)'}"
              ></span>
            </ToggleCard>
          {/each}
        </div>
        <p class="mt-2 text-[12px] text-on-surface-variant/45 tabular-nums">
          {m.onb_staff_selected({ count: selection.length })}
        </p>
      {/if}
    </div>

    <div>
      <label for="staff-alert" class="block text-[13px] font-semibold text-on-surface mb-1.5">
        {m.onb_staff_alert_label()}
      </label>
      <select
        id="staff-alert"
        value={alertChannelId}
        onchange={(event) => wizard.answer({ staffAlertChannelId: event.currentTarget.value || null })}
        class="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest/60 px-3.5 py-2.5
               text-[14px] text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <option value="">{m.onb_logs_channel_none()}</option>
        {#each channels as channel (channel.id)}
          <option value={channel.id}>#{channel.name}</option>
        {/each}
      </select>
      <p class="mt-1.5 text-[12.5px] text-on-surface-variant/50">{m.onb_staff_alert_hint()}</p>
    </div>
  </div>

  {#snippet preview()}
    <!-- Pas un faux salon Discord : ce que cet ecran rend possible, ce sont les
         pages d'equipe du tableau de bord, et c'est cela qu'on montre. -->
    <div class="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest/50 p-4">
      <p class="text-[12.5px] font-semibold text-on-surface mb-3">{m.onb_staff_preview_title()}</p>

      <div class="space-y-2">
        {#each roles.filter((role) => selection.includes(role.id)).slice(0, 4) as role (role.id)}
          <div class="flex items-center gap-2.5">
            <span
              class="w-2 h-2 rounded-full shrink-0"
              style="background-color: {role.color && role.color !== '#000000' ? role.color : '#64748b'}"
            ></span>
            <span class="text-[13px] text-on-surface-variant/80 flex-1 min-w-0 truncate">{role.name}</span>
            <span class="text-[11px] tabular-nums text-on-surface-variant/35">—</span>
          </div>
        {:else}
          <p class="text-[12.5px] text-on-surface-variant/40 py-3">Aucun rôle retenu pour l'instant.</p>
        {/each}
      </div>

      <p class="mt-4 pt-3 border-t border-outline-variant/20 text-[12px] text-on-surface-variant/50 leading-relaxed">
        {m.onb_staff_preview_hint()}
      </p>
    </div>
  {/snippet}

  {#snippet footer()}
    <button
      type="button"
      onclick={skip}
      class="text-[13px] font-medium text-on-surface-variant/50 hover:text-on-surface transition-colors"
    >
      Passer
    </button>
    <button
      type="button"
      onclick={apply}
      disabled={onboardingData.busy}
      class="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[14px] font-semibold text-on-primary
             hover:brightness-110 transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {onboardingData.busy ? 'Enregistrement…' : 'Continuer'}
      <Papicon icon="ChevronRight" size={15} />
    </button>
  {/snippet}
</WizardShell>
