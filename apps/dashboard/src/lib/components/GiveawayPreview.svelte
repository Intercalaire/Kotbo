<script lang="ts">
  /**
   * Aperçu d'une annonce de concours, à côté des champs qui la façonnent.
   *
   * Les gabarits se réglaient sans rien voir : il fallait lancer un vrai
   * concours pour juger d'une couleur ou d'un titre. L'aperçu montre les
   * variables remplacées, le balisage rendu et le bouton tel qu'il sortira.
   */
  import { m } from '../i18n';
  import { authStore } from '../stores/auth.svelte';
  import { dashboardStore } from '../stores/dashboard.svelte';
  import { renderPreview, type PreviewLabels, type PreviewSample } from '../giveawayPreview';
  import type { GiveawayAppearance, GiveawayGeneratedLabels } from '../api';

  let {
    appearance,
    bonusRoles = [],
    showBonusRoles = true,
    generated = null,
    overrides = null,
    compact = false,
  }: {
    appearance: GiveawayAppearance;
    bonusRoles?: { name: string; weight: number }[];
    showBonusRoles?: boolean;
    /** Libellés du bot, dans la langue du serveur. */
    generated?: GiveawayGeneratedLabels | null;
    /**
     * Valeurs réelles à la place de l'exemple.
     *
     * L'aperçu des réglages n'a rien de vrai à montrer et invente un concours.
     * Une carte de modèle, elle, en a un sous la main : elle passe ses propres
     * lot, durée et récompenses, et cesse d'être un exemple.
     */
    overrides?: Partial<PreviewSample> | null;
    /** Sans en-tête ni légende : l'aperçu tient alors dans une carte. */
    compact?: boolean;
  } = $props();

  /**
   * Les blocs des récompenses et des rôles avantagés sont écrits par le bot,
   * dans la langue du serveur. Les traductions du dashboard ne servent que
   * tant que l'API n'a pas répondu, sinon l'aperçu parlerait la langue de la
   * personne connectée plutôt que celle du serveur.
   */
  const labels: PreviewLabels = $derived({
    rewardsTitle: generated?.rewardsTitle ?? m.giv_preview_rewards(),
    coins: generated?.coins ?? m.giv_preview_coins(),
    xp: generated?.xp ?? m.giv_preview_xp(),
    item: generated?.item ?? m.giv_preview_item(),
    validation: generated?.validation ?? m.giv_preview_validation(),
    bonusRolesTitle: generated?.bonusRolesTitle ?? m.giv_preview_bonus_roles(),
    endsIn: m.giv_preview_ends_in(),
  });

  // Date figée au montage : recalculée à chaque rendu, elle ferait clignoter
  // l'aperçu à chaque frappe dans un champ.
  const endsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

  /**
   * Récompenses du module RPG dans l'exemple, éteintes par défaut.
   *
   * L'aperçu les montrait toujours, pièces et XP en dur. Un concours met
   * pourtant presque toujours en jeu un lot remis à la main, sans rien toucher
   * à l'économie du serveur : le bloc annonçait donc une possibilité que la
   * plupart des serveurs n'utilisent pas, à un endroit qui prétend montrer
   * l'annonce telle qu'elle sortira.
   */
  let withRewards = $state(false);

  const example: PreviewSample = $derived({
    prize: m.giv_preview_sample_prize(),
    description: m.giv_preview_sample_description(),
    winnerCount: 2,
    participants: 37,
    winners: [m.giv_preview_sample_winner_a(), m.giv_preview_sample_winner_b()],
    // Le serveur et l'organisateur sont réels : ce sont les seules valeurs que
    // la page connaît vraiment, et les voir justes aide à juger le gabarit.
    host: (authStore.user as { username?: string } | null)?.username ?? m.giv_preview_sample_host(),
    serverName: dashboardStore.state.guildName ?? m.giv_preview_sample_server(),
    bonusRoles: showBonusRoles ? bonusRoles : [],
    coins: withRewards ? 250 : 0,
    xp: withRewards ? 100 : 0,
    item: '',
    needValidation: false,
    endsAt,
  });

  // Les valeurs fournies l'emportent : ce qu'on connaît du concours passe devant
  // ce qu'on aurait inventé pour l'illustrer.
  const sample: PreviewSample = $derived({ ...example, ...(overrides ?? {}) });

  const title = $derived(renderPreview(appearance.titleTemplate, sample, labels));
  const body = $derived.by(() => {
    const template = appearance.descriptionTemplate;
    const rendered = renderPreview(template, sample, labels);

    // Comme le bot : un corps d'annonce qui ne réserve pas de place aux rôles
    // avantagés les reçoit à la suite, plutôt que de les perdre.
    if (sample.bonusRoles.length > 0 && !template.includes('{bonusRoles}')) {
      return `${rendered}<br />${renderPreview('{bonusRoles}', sample, labels)}`;
    }
    return rendered;
  });
  const footer = $derived(renderPreview(appearance.footerTemplate, sample, labels));

  const buttonColors: Record<GiveawayAppearance['joinButtonStyle'], string> = {
    PRIMARY: 'background:#5865F2;color:#fff',
    SECONDARY: 'background:#4E5058;color:#fff',
    SUCCESS: 'background:#248046;color:#fff',
    DANGER: 'background:#DA373C;color:#fff',
  };

  /** Un emoji de serveur s'écrit `<:nom:id>` : on n'en montre que l'image. */
  const buttonEmoji = $derived.by(() => {
    const raw = appearance.joinButtonEmoji?.trim() ?? '';
    if (!raw) return null;
    const mention = raw.match(/^<(a?):([^:]+):(\d+)>$/);
    if (mention) {
      return { url: `https://cdn.discordapp.com/emojis/${mention[3]}.${mention[1] ? 'gif' : 'png'}?size=32` };
    }
    return { text: raw };
  });
</script>

<div class="preview">
  {#if !compact}
    <div class="preview-head">
      <p class="preview-label">{m.giv_preview_title()}</p>
      <span class="preview-badge">{m.giv_preview_sample_badge()}</span>
      <label class="preview-toggle">
        <input type="checkbox" bind:checked={withRewards} />
        {m.giv_preview_show_rewards()}
      </label>
    </div>
  {/if}

  <div class="discord">
    <div class="embed" style="border-left-color: {appearance.embedColorActive}">
      <div class="embed-main">
        <div class="embed-text">
          <p class="embed-title">{@html title}</p>
          <p class="embed-body">{@html body}</p>
        </div>
        {#if appearance.thumbnailUrl}
          <img class="embed-thumb" src={appearance.thumbnailUrl} alt="" />
        {/if}
      </div>

      {#if appearance.imageUrl}
        <img class="embed-image" src={appearance.imageUrl} alt="" />
      {/if}

      <p class="embed-footer">{@html footer}</p>
    </div>

    <div class="actions">
      <span class="button" style={buttonColors[appearance.joinButtonStyle] ?? buttonColors.PRIMARY}>
        {#if buttonEmoji?.url}
          <img src={buttonEmoji.url} alt="" />
        {:else if buttonEmoji?.text}
          {buttonEmoji.text}
        {/if}
        {appearance.joinButtonLabel}
      </span>
    </div>
  </div>

  {#if !compact}
    <p class="field-hint">{m.giv_preview_hint()}</p>
  {/if}
</div>

<style>
  .preview-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .preview-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--on-surface);
  }

  .preview-badge {
    font-size: 0.6875rem;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: var(--surface-container-high);
    color: var(--on-surface-variant);
  }

  /* Poussé à droite : c'est une option de l'aperçu, pas un réglage du serveur. */
  .preview-toggle {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: var(--on-surface-variant);
    cursor: pointer;
  }

  .preview-toggle input {
    width: 0.875rem;
    height: 0.875rem;
    accent-color: var(--primary-color);
    cursor: pointer;
  }

  /* Fond sombre quel que soit le thème : Discord n'a pas celui du dashboard. */
  .discord {
    background: #313338;
    border-radius: 0.75rem;
    padding: 1rem;
    color: #dbdee1;
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .embed {
    background: #2b2d31;
    border-left: 4px solid #5865f2;
    border-radius: 0.25rem;
    padding: 0.75rem 1rem;
    max-width: 32rem;
  }

  .embed-main { display: flex; gap: 1rem; align-items: flex-start; }
  .embed-text { min-width: 0; flex: 1; }

  /* `.discord` en préfixe : les styles de paragraphe du dashboard passent
     devant sans lui, et l'aperçu perdait les couleurs de Discord. */
  .discord .embed-title {
    font-weight: 600;
    color: #f2f3f5;
    margin: 0 0 0.5rem;
    word-break: break-word;
  }

  .discord .embed-body {
    color: #dbdee1;
    margin: 0;
    white-space: normal;
    word-break: break-word;
  }

  .embed-thumb {
    width: 5rem;
    height: 5rem;
    object-fit: cover;
    border-radius: 0.25rem;
    flex-shrink: 0;
  }

  .embed-image {
    margin-top: 0.75rem;
    width: 100%;
    border-radius: 0.25rem;
  }

  .discord .embed-footer {
    margin: 0.75rem 0 0;
    font-size: 0.6875rem;
    color: #949ba4;
  }

  .actions { margin-top: 0.5rem; }

  .button {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    border-radius: 0.25rem;
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .button img { width: 1.125rem; height: 1.125rem; }

  .preview :global(.mention) {
    background: rgba(88, 101, 242, 0.3);
    color: #c9cdfb;
    border-radius: 0.1875rem;
    padding: 0 0.125rem;
  }

  .preview :global(code) {
    background: #1e1f22;
    border-radius: 0.1875rem;
    padding: 0.0625rem 0.1875rem;
    font-size: 0.75rem;
  }

  .preview :global(strong) { color: #f2f3f5; }
</style>
