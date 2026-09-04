<script lang="ts">
  /**
   * Le rythme des niveaux, et les roles a debloquer.
   *
   * La page Niveaux du tableau de bord expose l'XP par message, le palier
   * vocal, le delai anti-farm et la courbe. Ici, on choisit une allure : le
   * detail se regle apres, quand on a vu tourner le systeme et qu'on sait ce
   * qu'on veut corriger.
   *
   * L'apercu montre la montee de niveau telle qu'elle sera annoncee dans le
   * salon. C'est ce message-la qui fait qu'on regarde sa progression, et c'est
   * lui qu'il faut voir pour juger le rythme.
   */
  import { toast } from '../../../stores/toast.svelte';
  import { wizard } from '../../../stores/onboardingWizard.svelte';
  import { onboardingData } from '../../../stores/onboardingData.svelte';
  import {
    LEVEL_RHYTHMS,
    PANEL_COLORS,
    REWARD_TIERS,
    celebrateStep,
    type LevelRhythm,
  } from '../../../onboarding';
  import { addLevelingReward, updateLevelingConfig } from '../../../api';
  import ChoiceCard from '../ChoiceCard.svelte';
  import DiscordPreview from '../DiscordPreview.svelte';
  import DiscordEmbed from '../DiscordEmbed.svelte';
  import Papicon from '../../Papicon.svelte';
  import WizardShell from '../WizardShell.svelte';

  const { onEditTracks, skip }: { onEditTracks: () => void; skip: () => void } = $props();

  const rhythm = $derived<LevelRhythm>(wizard.rhythm ?? 'standard');
  const roles = $derived(onboardingData.roles);
  const panelColor = $derived(wizard.panelColor ?? PANEL_COLORS[0].value);

  const config = $derived(
    LEVEL_RHYTHMS.find((entry) => entry.key === rhythm)?.config ?? LEVEL_RHYTHMS[1].config
  );

  let rewards = $state<Record<number, string>>({});

  const firstReward = $derived(
    roles.find((role) => role.id === rewards[REWARD_TIERS[0]])?.name ?? null
  );

  async function apply() {
    if (onboardingData.busy) return;
    onboardingData.busy = true;
    try {
      await updateLevelingConfig({ enabled: true, ...config }, undefined, { silent: true });

      // Un palier deja pris - la table impose un role par niveau et par serveur -
      // fait echouer sa seule ligne. Le reste des paliers doit passer quand meme.
      for (const level of REWARD_TIERS) {
        const roleId = rewards[level];
        if (!roleId) continue;
        try {
          await addLevelingReward(level, roleId, undefined, { silent: true });
        } catch {
          toast.info(`Le palier ${level} avait déjà une récompense : il n'a pas été remplacé.`);
        }
      }

      celebrateStep();
      wizard.complete('levels');
    } catch (err: any) {
      toast.error(err?.message || "La progression n'a pas pu être enregistrée.");
    } finally {
      onboardingData.busy = false;
    }
  }
</script>

<WizardShell
  title="Faut-il récompenser les membres actifs ?"
  lead="Chaque message et chaque minute en vocal rapportent de l'expérience. Les membres montent en niveau, et peuvent gagner des rôles en chemin."
  {onEditTracks}
>
  <div class="space-y-3">
    {#each LEVEL_RHYTHMS as entry (entry.key)}
      <ChoiceCard
        label={entry.label}
        pitch={entry.pitch}
        detail={entry.detail}
        icon={entry.icon}
        selected={rhythm === entry.key}
        badge={entry.key === 'standard' ? 'Recommandé' : undefined}
        onclick={() => { wizard.answer({ rhythm: entry.key }); celebrateStep(); }}
      />
    {/each}
  </div>

  <div class="mt-6">
    <p class="flex items-center gap-2 text-[13px] font-semibold text-on-surface mb-1">
      <Papicon icon="award" size={14} class="text-primary" />
      Des rôles à débloquer
      <span class="font-normal text-on-surface-variant/50">— facultatif</span>
    </p>
    <p class="text-[12.5px] text-on-surface-variant/60 leading-relaxed mb-3">
      Le rôle est donné automatiquement au passage du niveau. C'est ce qui fait qu'on
      regarde sa progression.
    </p>

    {#if roles.length === 0}
      <p class="rounded-xl border border-outline-variant/30 bg-surface-container-low/30 px-4 py-3 text-[13px] text-on-surface-variant/60">
        Aucun rôle attribuable n'a été trouvé. Vous ajouterez vos paliers depuis la page Niveaux.
      </p>
    {:else}
      <div class="space-y-2">
        {#each REWARD_TIERS as level (level)}
          <div class="flex items-center gap-3 rounded-xl border border-outline-variant/35 bg-surface-container-low/25 px-4 py-2.5">
            <span class="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-surface">
              <span class="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-[12px] font-bold">
                {level}
              </span>
              Niveau {level}
            </span>
            <select
              bind:value={rewards[level]}
              aria-label={`Rôle offert au niveau ${level}`}
              class="flex-1 min-w-0 rounded-lg border border-outline-variant/40 bg-surface-container-lowest/60 px-3 py-1.5 text-[13px] text-on-surface focus:outline-none focus:border-primary/50"
            >
              <option value={undefined}>Aucun rôle</option>
              {#each roles as role (role.id)}
                <option value={role.id}>@{role.name}</option>
              {/each}
            </select>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#snippet preview()}
    <DiscordPreview channel="niveaux">
      <DiscordEmbed
        color={panelColor}
        title={`🎉 Niveau ${REWARD_TIERS[0]} atteint !`}
        description="Maë vient de passer un palier."
        fields={[
          { emoji: '⚡', name: 'Gain par message', value: `${config.xpMin} à ${config.xpMax} XP` },
          { emoji: '🎧', name: 'Gain en vocal', value: `${config.vocalXpPerMin} XP par minute` },
          ...(firstReward
            ? [{ emoji: '🏅', name: 'Rôle débloqué', value: `@${firstReward}` }]
            : []),
        ]}
      />
    </DiscordPreview>

    <p class="mt-3 flex items-start gap-2 text-[12.5px] text-on-surface-variant/55 leading-relaxed">
      <Papicon icon="clock" size={13} class="mt-0.5 shrink-0 text-on-surface-variant/35" />
      <span>
        Un message ne rapporte qu'une fois toutes les {config.cooldownSeconds} s : c'est ce qui
        empêche de monter en écrivant vite plutôt qu'en participant.
      </span>
    </p>
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
      class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
    >
      {onboardingData.busy ? 'Enregistrement…' : 'Activer la progression'}
      <Papicon icon="ChevronRight" size={15} />
    </button>
  {/snippet}
</WizardShell>
