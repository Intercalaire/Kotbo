<script lang="ts">
  /**
   * Aperçu d'une annonce de concours, à côté des champs qui la façonnent.
   *
   * Les gabarits se réglaient sans rien voir : il fallait lancer un vrai
   * concours pour juger d'une couleur ou d'un titre. L'aperçu montre les
   * variables remplacées, le balisage rendu et le bouton tel qu'il sortira.
   */
  import { m } from '../i18n';
  import { renderPreview, type PreviewLabels, type PreviewSample } from '../giveawayPreview';
  import type { GiveawayAppearance } from '../api';

  let {
    appearance,
    bonusRoles = [],
    showBonusRoles = true,
  }: {
    appearance: GiveawayAppearance;
    bonusRoles?: { name: string; weight: number }[];
    showBonusRoles?: boolean;
  } = $props();

  const labels: PreviewLabels = {
    rewardsTitle: m.giv_preview_rewards(),
    coins: m.giv_preview_coins(),
    xp: m.giv_preview_xp(),
    item: m.giv_preview_item(),
    validation: m.giv_preview_validation(),
    bonusRolesTitle: m.giv_preview_bonus_roles(),
    endsIn: m.giv_preview_ends_in(),
  };

  // Date figée au montage : recalculée à chaque rendu, elle ferait clignoter
  // l'aperçu à chaque frappe dans un champ.
  const endsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

  const sample: PreviewSample = $derived({
    prize: m.giv_preview_sample_prize(),
    description: m.giv_preview_sample_description(),
    winnerCount: 2,
    participants: 37,
    winners: [m.giv_preview_sample_winner_a(), m.giv_preview_sample_winner_b()],
    host: m.giv_preview_sample_host(),
    serverName: m.giv_preview_sample_server(),
    bonusRoles: showBonusRoles ? bonusRoles : [],
    coins: 250,
    xp: 100,
    item: '',
    needValidation: false,
    endsAt,
  });

  const title = $derived(renderPreview(appearance.titleTemplate, sample, labels));
  const body = $derived(renderPreview(appearance.descriptionTemplate, sample, labels));
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
  <p class="preview-label">{m.giv_preview_title()}</p>

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

  <p class="field-hint">{m.giv_preview_hint()}</p>
</div>

<style>
  .preview-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--on-surface);
    margin-bottom: 0.5rem;
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

  .embed-title {
    font-weight: 600;
    color: #f2f3f5;
    margin-bottom: 0.5rem;
    word-break: break-word;
  }

  .embed-body { white-space: normal; word-break: break-word; }

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

  .embed-footer {
    margin-top: 0.75rem;
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
