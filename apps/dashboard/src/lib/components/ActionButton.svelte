<!--
  Ancienne API de bouton, gardee pour ses nombreux appels : elle rend
  desormais le Button des primitives. Pour du code neuf, importer
  `Button` depuis `lib/components/ui`.
-->
<script lang="ts">
  import Button from './ui/Button.svelte';

  type ButtonVariant = 'primary' | 'success' | 'muted' | 'danger' | 'neutral' | 'warning';
  type ButtonSize = 'sm' | 'md' | 'lg';

  const {
    onClick,
    onclick,
    type = 'button',
    variant = 'neutral',
    size = 'md',
    fullWidth = false,
    disabled = false,
    title = '',
    icon = '',
    label,
    className = '',
  }: {
    onClick?: (event: MouseEvent) => void;
    onclick?: (event: MouseEvent) => void;
    type?: 'button' | 'submit' | 'reset';
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    disabled?: boolean;
    title?: string;
    icon?: string;
    label: string;
    className?: string;
    children?: import('svelte').Snippet;
  } = $props();

  // Succes et avertissement n'ont jamais ete que des teintes : le libelle
  // porte le sens, le bouton reste une action secondaire.
  const VARIANTS = {
    primary: 'primary',
    neutral: 'secondary',
    success: 'secondary',
    warning: 'secondary',
    muted: 'ghost',
    danger: 'danger',
  } as const;
</script>

<Button
  {type}
  variant={VARIANTS[variant]}
  size={size === 'sm' ? 'sm' : 'md'}
  {icon}
  {fullWidth}
  {disabled}
  title={title || undefined}
  class={className}
  onclick={onClick ?? onclick}
>
  {label}
</Button>
