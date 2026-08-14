<script lang="ts">
  import { toast, type Toast as ToastType } from '../stores/toast.svelte';
  import Papicon from './Papicon.svelte';
  import { m } from '../i18n';

  const { item }: { item: ToastType } = $props();

  const iconName = $derived({
    success: 'check_circle',
    error: 'error',
    warning: 'warning',
    info: 'info'
  }[item.type]);

  /**
   * La teinte se pose sur un fond opaque (degrade plat par-dessus la couleur de
   * surface) : en sombre, un simple `bg-emerald-500/10` laissait la page
   * transparaitre au travers de la bulle, et le texte devenait illisible des
   * qu'un champ passait dessous.
   */
  const colorClass = $derived({
    success: 'bg-emerald-50 dark:bg-surface-container-high dark:bg-linear-to-r dark:from-emerald-500/12 dark:to-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
    error: 'bg-red-50 dark:bg-surface-container-high dark:bg-linear-to-r dark:from-red-500/12 dark:to-red-500/12 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30',
    warning: 'bg-amber-50 dark:bg-surface-container-high dark:bg-linear-to-r dark:from-amber-500/12 dark:to-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
    info: 'bg-blue-50 dark:bg-surface-container-high dark:bg-linear-to-r dark:from-blue-500/12 dark:to-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
  }[item.type]);
</script>

<div
  class="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border shadow-lg shadow-black/10 dark:shadow-black/40 animate-in slide-in-from-right fade-in duration-200 {colorClass}"
  role="alert"
>
  <Papicon name={iconName} size={16} class="shrink-0" />
  <p class="text-sm flex-1">{item.message}</p>
  {#if item.action}
    <button
      onclick={async () => {
        try {
          await item.action.onClick();
        } catch (e) {
          console.error('Toast action failed:', e);
        }
        toast.remove(item.id);
      }}
      class="ml-1 px-2 py-1 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap"
    >
      {item.action.label}
    </button>
  {/if}
  <button
    onclick={() => toast.remove(item.id)}
    class="ml-auto p-0.5 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors cursor-pointer shrink-0"
    aria-label={m.d7_close()}
  >
    <Papicon name="close" size={14} />
  </button>
</div>
