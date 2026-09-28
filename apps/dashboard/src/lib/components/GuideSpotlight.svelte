<!--
  Mise en evidence d'un reglage, lancee par `guide.start()`.

  Attend que la page cible ait rendu l'element `data-guide` demande, le fait
  defiler au centre, assombrit le reste et pose a cote une bulle qui dit quoi
  faire. Si la page est bloquee (module eteint, hors offre), c'est l'encadre
  qui l'explique qui est montre d'abord ; une fois le module rallume, la mise
  en evidence passe d'elle-meme au reglage.

  Le voile ne capte aucun clic : le premier clic dans la page, sur le reglage
  ou ailleurs, termine le guidage. Une liste deroulante ouverte dans le champ
  ne reste donc jamais sous le voile.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { guide } from '../stores/guide.svelte';
  import { toast } from '../stores/toast.svelte';
  import { m } from '../i18n';
  import Button from './ui/Button.svelte';

  /** Delai pour que la page charge et rende le repere. */
  const FIND_TIMEOUT_MS = 10_000;
  const PADDING = 6;
  const GAP = 12;
  const MARGIN = 16;

  type Found = { element: HTMLElement; blocker: string | null };

  let found = $state<Found | null>(null);
  let rect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
  let bubble = $state<HTMLDivElement | null>(null);
  let bubbleHeight = $state(0);
  let viewport = $state({ width: 0, height: 0 });

  let frame = 0;
  let arrived = false;
  /** Debut de la recherche en cours : relance quand le repere disparait. */
  let searchingSince = 0;

  function onPath(path: string, expected: string): boolean {
    return path === expected || path.startsWith(`${expected}/`);
  }

  function locate(target: string): Found | null {
    const blocker = document.querySelector<HTMLElement>('[data-guide-blocker]');
    if (blocker) return { element: blocker, blocker: blocker.dataset.guideBlocker ?? null };
    const element = document.querySelector<HTMLElement>(`[data-guide="${CSS.escape(target)}"]`);
    return element ? { element, blocker: null } : null;
  }

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    found = null;
    rect = null;
    arrived = false;
    searchingSince = Date.now();
  }

  function tickGuide() {
    const current = guide.active;
    if (!current) return reset();

    const path = window.location.pathname;
    if (onPath(path, current.path)) {
      arrived = true;
    } else if (arrived) {
      // Le lecteur est parti ailleurs : la bulle n'a plus rien a montrer.
      guide.stop();
      return reset();
    }

    const next = arrived ? locate(current.target) : null;
    if (next && next.element !== found?.element) {
      found = next;
      next.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (!next && found && !found.element.isConnected) {
      // La page se re-rend (module rallume, section qui se deplie) : on
      // reprend la recherche avec un delai neuf.
      found = null;
      rect = null;
      searchingSince = Date.now();
    }

    if (found) {
      const box = found.element.getBoundingClientRect();
      rect = {
        top: box.top - PADDING,
        left: box.left - PADDING,
        width: box.width + PADDING * 2,
        height: box.height + PADDING * 2,
      };
      viewport = { width: window.innerWidth, height: window.innerHeight };
    } else if (Date.now() - searchingSince > FIND_TIMEOUT_MS) {
      toast.info(m.guide_not_found());
      guide.stop();
      return reset();
    }

    frame = requestAnimationFrame(tickGuide);
  }

  $effect(() => {
    // Relancer la boucle a chaque nouveau guidage, y compris quand un guidage
    // en remplace un autre avant la fin du premier.
    const current = guide.active;
    reset();
    if (current) frame = requestAnimationFrame(tickGuide);
    return () => cancelAnimationFrame(frame);
  });

  onDestroy(() => cancelAnimationFrame(frame));

  function onPointerDown(event: PointerEvent) {
    if (!found) return;
    const target = event.target as Node;
    if (bubble?.contains(target)) return;
    // L'encadre bloquant porte le bouton qui debloque la page : cliquer dessus
    // doit laisser le guidage se poursuivre jusqu'au reglage.
    if (found.blocker && found.element.contains(target)) return;
    guide.stop();
  }

  function onKeydown(event: KeyboardEvent) {
    if (found && event.key === 'Escape') guide.stop();
  }

  const texts = $derived.by(() => {
    const current = guide.active;
    if (!current || !found) return null;
    if (found.blocker === 'module-off') {
      return { eyebrow: m.guide_eyebrow_first(), title: m.guide_blocker_module_off_title(), body: m.guide_blocker_module_off_body() };
    }
    if (found.blocker === 'plan') {
      return { eyebrow: m.guide_eyebrow_first(), title: m.guide_blocker_plan_title(), body: m.guide_blocker_plan_body() };
    }
    return { eyebrow: m.guide_eyebrow(), title: current.title, body: current.body };
  });

  const bubbleWidth = $derived(Math.min(320, viewport.width - MARGIN * 2));

  const bubblePosition = $derived.by(() => {
    if (!rect) return null;
    const below = rect.top + rect.height + GAP;
    const above = rect.top - GAP - bubbleHeight;
    let top = below;
    if (below + bubbleHeight > viewport.height - MARGIN) {
      top = above >= MARGIN ? above : viewport.height - MARGIN - bubbleHeight;
    }
    const left = Math.min(Math.max(MARGIN, rect.left), viewport.width - bubbleWidth - MARGIN);
    return { top: Math.max(MARGIN, top), left };
  });
</script>

<svelte:window onpointerdowncapture={onPointerDown} onkeydown={onKeydown} />

{#if rect && texts && bubblePosition}
  <div
    class="guide-ring"
    style="top: {rect.top}px; left: {rect.left}px; width: {rect.width}px; height: {rect.height}px;"
    aria-hidden="true"
  ></div>

  <div
    bind:this={bubble}
    bind:offsetHeight={bubbleHeight}
    class="guide-bubble"
    style="top: {bubblePosition.top}px; left: {bubblePosition.left}px; width: {bubbleWidth}px;"
    role="status"
    aria-live="polite"
  >
    <p class="text-xs font-medium text-primary">{texts.eyebrow}</p>
    <p class="mt-1 text-sm font-semibold text-on-surface">{texts.title}</p>
    <p class="mt-1 text-sm text-on-surface-variant leading-relaxed">{texts.body}</p>
    <div class="mt-3 flex items-center justify-between gap-3">
      <span class="text-xs text-on-surface-variant">{m.guide_hint_escape()}</span>
      <Button size="sm" variant="primary" onclick={() => guide.stop()}>{m.guide_got_it()}</Button>
    </div>
  </div>
{/if}

<style>
  .guide-ring {
    position: fixed;
    z-index: 150;
    border-radius: 0.75rem;
    border: 2px solid var(--color-primary);
    /* Le voile est l'ombre de l'anneau : aucun second calque a garder aligne. */
    box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.5);
    pointer-events: none;
    transition: top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease;
    animation: guide-pulse 1.6s ease-out 3;
  }

  .guide-bubble {
    position: fixed;
    z-index: 160;
    padding: 1rem;
    border-radius: 0.75rem;
    border: 1px solid var(--outline-variant);
    background: var(--surface-container-lowest);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);
  }

  @keyframes guide-pulse {
    0% { outline: 0 solid color-mix(in srgb, var(--color-primary) 60%, transparent); }
    100% { outline: 10px solid transparent; }
  }

  @media (prefers-reduced-motion: reduce) {
    .guide-ring {
      transition: none;
      animation: none;
    }
  }
</style>
