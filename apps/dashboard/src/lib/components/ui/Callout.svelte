<!--
  Encadre d'information dans le flux de la page : module eteint, salon
  manquant, reglage a risque. Remplace le bloc ambre recopie de page en page.
  Pour un retour apres une action, c'est un toast.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Papicon from '../Papicon.svelte';

  type Variant = 'info' | 'success' | 'warning' | 'danger';

  const {
    variant = 'info',
    title = '',
    icon = '',
    class: className = '',
    children,
    actions,
  }: {
    variant?: Variant;
    title?: string;
    /** Remplace l'icone par defaut de la variante. */
    icon?: string;
    class?: string;
    children?: Snippet;
    actions?: Snippet;
  } = $props();

  const DEFAULT_ICON: Record<Variant, string> = {
    info: 'info',
    success: 'check-circle',
    warning: 'warning',
    danger: 'alert-octagon',
  };
</script>

<div
  class="callout callout--{variant} {className}"
  role={variant === 'danger' || variant === 'warning' ? 'alert' : 'status'}
>
  <span class="callout__icon" aria-hidden="true">
    <Papicon icon={icon || DEFAULT_ICON[variant]} size={16} />
  </span>
  <div class="callout__body">
    {#if title}
      <p class="callout__title">{title}</p>
    {/if}
    {#if children}
      <div class="callout__text">{@render children()}</div>
    {/if}
    {#if actions}
      <div class="callout__actions">{@render actions()}</div>
    {/if}
  </div>
</div>
