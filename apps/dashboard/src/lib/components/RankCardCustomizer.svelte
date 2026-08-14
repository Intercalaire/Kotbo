<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    rankCardEmojiImageUrl,
    rankCardFontStack,
    DEFAULT_RANK_CARD_CUSTOMIZATION,
    RANK_CARD_BACKGROUNDS,
    RANK_CARD_EMOJIS,
    RANK_CARD_FONTS,
    RANK_CARD_MAX_EMOJIS,
    type RankCardBackgroundPreset,
    type RankCardCustomization,
  } from '@kotbo/shared';
  import { fetchRankCardCustomization, fetchRankCardPreview, saveRankCard } from '../api/rankCard';
  import { authStore } from '../stores/auth.svelte';
  import { toast } from '../stores/toast.svelte';
  import { m, getLocale } from '../i18n';
  import Papicon from './Papicon.svelte';

  // Catalogues compiles avec la page : c est la meme source que le canvas
  // serveur, donc aucune divergence possible entre choix offerts et rendu.
  const backgrounds = RANK_CARD_BACKGROUNDS;
  const fonts = RANK_CARD_FONTS;
  const availableEmojis = RANK_CARD_EMOJIS.map((emoji) => emoji.value);
  const maxEmojis = RANK_CARD_MAX_EMOJIS;

  let loading = $state(true);
  let saving = $state(false);

  let backgroundId = $state(DEFAULT_RANK_CARD_CUSTOMIZATION.backgroundId);
  let fontId = $state(DEFAULT_RANK_CARD_CUSTOMIZATION.fontId);
  let emojis = $state<string[]>([]);
  let savedSignature = $state('');

  let previewUrl = $state<string | null>(null);
  let previewLoading = $state(false);
  let previewFailed = $state(false);
  let previewIsReal = $state(false);
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let previewToken = 0;

  const draft = $derived<RankCardCustomization>({ backgroundId, fontId, emojis: [...emojis] });
  const dirty = $derived(signatureOf(draft) !== savedSignature);
  const customized = $derived(signatureOf(draft) !== signatureOf(DEFAULT_RANK_CARD_CUSTOMIZATION));

  /** Signature canonique : ne pas dependre de l ordre des cles renvoyees par l API. */
  function signatureOf(customization: RankCardCustomization): string {
    return JSON.stringify([customization.backgroundId, customization.fontId, customization.emojis]);
  }

  /** Reconstruit la vignette d un fond a partir de la meme recette que le canvas serveur. */
  function swatchStyle(preset: RankCardBackgroundPreset): string {
    const base = preset.gradient
      .map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
      .join(', ');
    const glows = preset.glows
      .map((glow) => `radial-gradient(circle at ${Math.round(glow.x * 100)}% ${Math.round(glow.y * 100)}%, ${glow.color}, transparent 60%)`)
      .join(', ');
    const layers = glows ? `${glows}, linear-gradient(135deg, ${base})` : `linear-gradient(135deg, ${base})`;
    return `background: ${layers};`;
  }

  function accentStyle(preset: RankCardBackgroundPreset): string {
    const stops = preset.accentBar
      .map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
      .join(', ');
    return `background: linear-gradient(90deg, ${stops});`;
  }

  function releasePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  async function refreshPreview(customization: RankCardCustomization, guildId: string | null) {
    const token = ++previewToken;
    previewLoading = true;
    try {
      const preview = await fetchRankCardPreview(customization, guildId);
      if (token !== previewToken) {
        if (preview) URL.revokeObjectURL(preview.url);
        return;
      }
      if (preview) {
        releasePreview();
        previewUrl = preview.url;
        previewIsReal = preview.realProgression;
        previewFailed = false;
      } else {
        previewFailed = true;
      }
    } catch {
      if (token === previewToken) previewFailed = true;
    } finally {
      if (token === previewToken) previewLoading = false;
    }
  }

  function toggleEmoji(emoji: string) {
    if (emojis.includes(emoji)) {
      emojis = emojis.filter((entry) => entry !== emoji);
      return;
    }
    if (emojis.length >= maxEmojis) {
      toast.warning(m.rc_emoji_limit({ count: maxEmojis }));
      return;
    }
    emojis = [...emojis, emoji];
  }

  function reset() {
    backgroundId = DEFAULT_RANK_CARD_CUSTOMIZATION.backgroundId;
    fontId = DEFAULT_RANK_CARD_CUSTOMIZATION.fontId;
    emojis = [...DEFAULT_RANK_CARD_CUSTOMIZATION.emojis];
  }

  async function save() {
    saving = true;
    try {
      const result = await saveRankCard(draft);
      if (!result) {
        toast.error(m.rc_save_error());
        return;
      }
      backgroundId = result.backgroundId;
      fontId = result.fontId;
      emojis = result.emojis;
      savedSignature = signatureOf(result);
      toast.success(m.rc_saved());
    } catch {
      toast.error(m.rc_save_error());
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    // Le rendu passe par le bot : on attend une pause dans les clics pour ne
    // pas enchainer un aller-retour par vignette survolee.
    //
    // Le serveur est lu ici et non dans `refreshPreview` : depuis le setTimeout
    // il sortirait du suivi reactif, et changer de serveur laisserait l apercu
    // sur la progression du precedent.
    const customization = draft;
    const guildId = authStore.selectedGuildId;
    if (loading) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => refreshPreview(customization, guildId), 250);
  });

  $effect(() => {
    void (async () => {
      try {
        const customization = await fetchRankCardCustomization();
        if (customization) {
          backgroundId = customization.backgroundId;
          fontId = customization.fontId;
          emojis = customization.emojis;
          savedSignature = signatureOf(customization);
        } else {
          toast.error(m.rc_load_error());
        }
      } catch {
        toast.error(m.rc_load_error());
      } finally {
        loading = false;
      }
    })();
  });

  onDestroy(() => {
    if (previewTimer) clearTimeout(previewTimer);
    releasePreview();
  });
</script>

<div class="space-y-6">
  <div>
    <h3 class="text-[15px] font-semibold text-on-surface">{m.rc_title()}</h3>
    <p class="mt-1 text-[13px] text-on-surface-variant">{m.rc_subtitle()}</p>
  </div>

  {#if loading}
    <div class="h-[180px] animate-pulse rounded-xl bg-surface-container-low"></div>
  {:else}
    <div class="relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low">
      {#if previewUrl}
        <img src={previewUrl} alt={m.rc_preview_alt()} class="w-full" />
      {:else if previewFailed}
        <div class="flex aspect-[934/282] w-full items-center justify-center px-4 text-center text-[13px] text-on-surface-variant">
          {m.rc_preview_error()}
        </div>
      {:else}
        <div class="aspect-[934/282] w-full animate-pulse bg-surface-container-high"></div>
      {/if}
      {#if previewLoading}
        <div class="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
          {m.rc_preview_loading()}
        </div>
      {/if}
    </div>
    <p class="text-[12px] text-on-surface-variant">
      {previewIsReal ? m.rc_preview_note_real() : m.rc_preview_note()}
    </p>

    <div>
      <h4 class="mb-2 text-[13px] font-medium text-on-surface">{m.rc_background_title()}</h4>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {#each backgrounds as preset (preset.id)}
          <button
            type="button"
            onclick={() => (backgroundId = preset.id)}
            aria-pressed={backgroundId === preset.id}
            class="group overflow-hidden rounded-lg border text-left transition-all {backgroundId === preset.id ? 'border-primary ring-2 ring-primary/40' : 'border-outline-variant hover:border-primary/50'}"
          >
            <div class="h-14 w-full" style={swatchStyle(preset)}>
              <div class="h-[3px] w-full" style={accentStyle(preset)}></div>
            </div>
            <div class="flex items-center justify-between px-2 py-1.5">
              <span class="text-[12px] text-on-surface">{getLocale() === 'fr' ? preset.label.fr : preset.label.en}</span>
              {#if backgroundId === preset.id}
                <Papicon icon="Check" size={13} class="text-primary" />
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </div>

    <div>
      <h4 class="mb-2 text-[13px] font-medium text-on-surface">{m.rc_font_title()}</h4>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {#each fonts as preset (preset.id)}
          <button
            type="button"
            onclick={() => (fontId = preset.id)}
            aria-pressed={fontId === preset.id}
            class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-all {fontId === preset.id ? 'border-primary ring-2 ring-primary/40' : 'border-outline-variant hover:border-primary/50'}"
          >
            <!-- L echantillon est ecrit dans la police proposee : un nom de
                 famille ne dit rien de son allure. -->
            <span
              class="truncate text-[15px] font-bold text-on-surface"
              style="font-family: {rankCardFontStack(preset)};"
            >
              {getLocale() === 'fr' ? preset.label.fr : preset.label.en}
            </span>
            {#if fontId === preset.id}
              <Papicon icon="Check" size={13} class="shrink-0 text-primary" />
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <div>
      <h4 class="mb-2 text-[13px] font-medium text-on-surface">
        {m.rc_emojis_title()}
        <span class="ml-1 font-normal text-on-surface-variant">{emojis.length}/{maxEmojis}</span>
      </h4>
      <div class="flex flex-wrap gap-2">
        {#each availableEmojis as emoji (emoji)}
          <button
            type="button"
            onclick={() => toggleEmoji(emoji)}
            aria-pressed={emojis.includes(emoji)}
            class="flex h-10 w-10 items-center justify-center rounded-lg border transition-all {emojis.includes(emoji) ? 'border-primary bg-primary/10' : 'border-outline-variant hover:border-primary/50'}"
          >
            <!-- Meme asset que le canvas serveur : la police emoji du systeme
                 ne ressemble pas au rendu de la carte. -->
            <img src={rankCardEmojiImageUrl(emoji)} alt={emoji} class="h-5 w-5" />
          </button>
        {/each}
      </div>
    </div>

    <div class="flex items-center gap-3">
      <button
        type="button"
        onclick={save}
        disabled={saving || !dirty}
        class="rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-on-primary transition-all hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? m.rc_saving() : m.rc_save()}
      </button>
      <button
        type="button"
        onclick={reset}
        disabled={saving || !customized}
        class="rounded-lg border border-outline-variant px-4 py-2 text-[13px] font-medium text-on-surface transition-all hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {m.rc_reset()}
      </button>
      {#if dirty}
        <span class="text-[12px] text-on-surface-variant">{m.rc_unsaved()}</span>
      {/if}
    </div>
  {/if}
</div>
