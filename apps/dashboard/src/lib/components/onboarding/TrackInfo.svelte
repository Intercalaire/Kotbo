<script lang="ts">
  /**
   * Le « i » d'une piste : ce qu'est le module, et ce qu'on verra sur Discord.
   *
   * Une infobulle plutot qu'une ligne de plus sur la carte : onze apercus
   * deplies noieraient le choix. `popover="auto"` la pose au premier plan et la
   * referme sur Echap ou un clic ailleurs ; survol et focus clavier l'ouvrent.
   */
  import { tick } from 'svelte';
  import { m } from '../../i18n';
  import type { Track, TrackKey } from '../../onboarding';
  import DiscordPreview from './DiscordPreview.svelte';
  import DiscordEmbed from './DiscordEmbed.svelte';
  import Papicon from '../Papicon.svelte';

  const { track, class: className = '' }: { track: Track; class?: string } = $props();

  type Sample = { channel: string; title: string; body: string; button?: string };

  const SAMPLES: Record<TrackKey, () => Sample> = {
    structure: () => ({ channel: m.onb_info_structure_channel(), title: m.onb_info_structure_title(), body: m.onb_info_structure_body() }),
    moderation: () => ({ channel: m.onb_info_moderation_channel(), title: m.onb_info_moderation_title(), body: m.onb_info_moderation_body() }),
    logs: () => ({ channel: m.onb_info_logs_channel(), title: m.onb_info_logs_title(), body: m.onb_info_logs_body() }),
    greeting: () => ({ channel: m.onb_info_greeting_channel(), title: m.onb_info_greeting_title(), body: m.onb_info_greeting_body() }),
    rules: () => ({ channel: m.onb_info_rules_channel(), title: m.onb_info_rules_title(), body: m.onb_info_rules_body() }),
    tickets: () => ({ channel: m.onb_info_tickets_channel(), title: m.onb_info_tickets_title(), body: m.onb_info_tickets_body(), button: m.onb_info_tickets_button() }),
    levels: () => ({ channel: m.onb_info_levels_channel(), title: m.onb_info_levels_title(), body: m.onb_info_levels_body() }),
    economy: () => ({ channel: m.onb_info_economy_channel(), title: m.onb_info_economy_title(), body: m.onb_info_economy_body() }),
    animation: () => ({ channel: m.onb_info_animation_channel(), title: m.onb_info_animation_title(), body: m.onb_info_animation_body(), button: m.onb_info_animation_button() }),
    staff: () => ({ channel: m.onb_info_staff_channel(), title: m.onb_info_staff_title(), body: m.onb_info_staff_body() }),
    mcp: () => ({ channel: m.onb_info_mcp_channel(), title: m.onb_info_mcp_title(), body: m.onb_info_mcp_body() }),
  };

  const id = $derived(`track-info-${track.key}`);
  const sample = $derived(SAMPLES[track.key]());

  let trigger: HTMLButtonElement;
  let panel: HTMLDivElement;
  let open = $state(false);
  let closing: ReturnType<typeof setTimeout> | undefined;

  const GAP = 8;

  /** Sous le bouton s'il y a la place, au-dessus sinon, toujours dans la fenetre. */
  function place() {
    const anchor = trigger.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = panel;
    const below = anchor.bottom + GAP;
    const top = below + height <= window.innerHeight ? below : anchor.top - GAP - height;
    panel.style.top = `${Math.max(GAP, top)}px`;
    panel.style.left = `${Math.max(GAP, Math.min(anchor.right - width, window.innerWidth - width - GAP))}px`;
  }

  async function show() {
    clearTimeout(closing);
    if (open) return;
    open = true;
    panel.showPopover();
    await tick();
    place();
  }

  /** Un delai court : le temps d'aller du bouton a l'infobulle. */
  function hideSoon() {
    clearTimeout(closing);
    closing = setTimeout(() => panel?.hidePopover(), 160);
  }

  $effect(() => {
    if (!open) return;
    // L'apercu Discord prend sa taille apres le premier rendu.
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    const hide = () => panel.hidePopover();
    window.addEventListener('scroll', hide, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', hide);
    };
  });

  $effect(() => () => clearTimeout(closing));
</script>

<button
  bind:this={trigger}
  type="button"
  aria-label={m.onb_info_aria({ name: track.label() })}
  aria-expanded={open}
  aria-controls={id}
  onclick={show}
  onfocus={show}
  onblur={hideSoon}
  onpointerenter={(event) => { if (event.pointerType === 'mouse') void show(); }}
  onpointerleave={(event) => { if (event.pointerType === 'mouse') hideSoon(); }}
  class="inline-flex w-7 h-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant
         transition-colors hover:bg-primary/10 hover:text-primary
         focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 {className}"
>
  <Papicon icon="info" size={15} />
</button>

<div
  bind:this={panel}
  {id}
  popover="auto"
  role="tooltip"
  ontoggle={(event) => { open = (event as ToggleEvent).newState === 'open'; }}
  onpointerenter={() => clearTimeout(closing)}
  onpointerleave={(event) => { if (event.pointerType === 'mouse') hideSoon(); }}
  class="track-info rounded-2xl border border-outline-variant bg-surface-container-high p-4 text-left text-on-surface shadow-xl"
>
  {#if open}
    <p class="flex items-center gap-2 text-body-sm font-semibold">
      <Papicon icon={track.icon} size={15} class="text-primary" />
      {track.label()}
    </p>
    <p class="mt-1.5 mb-3 text-xs text-on-surface-variant leading-relaxed">{track.outcome()}</p>
    <DiscordPreview channel={sample.channel}>
      <DiscordEmbed
        color="#5865f2"
        title={sample.title}
        description={sample.body}
        buttons={sample.button ? [{ label: sample.button }] : []}
      />
    </DiscordPreview>
  {/if}
</div>

<style>
  .track-info {
    position: fixed;
    inset: auto;
    margin: 0;
    width: min(23rem, calc(100vw - 1rem));
    max-height: calc(100vh - 1rem);
    overflow: auto;
  }
</style>
