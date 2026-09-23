<script lang="ts">
  interface Props {
    message?: string;
    error?: string;
    idleText?: string;
    state?: {
      state: {
        message: string;
        error: string;
      };
    };
  }

  const {
    message = '',
    error = '',
    idleText = '',
    state = undefined
  }: Props = $props();

  const displayMessage = $derived(state ? state.state.message : message);
  const displayError = $derived(state ? state.state.error : error);
  const hasError = $derived(!!displayError);
  const hasMessage = $derived(!!displayMessage);
</script>

{#if hasError || hasMessage || idleText}
  <div class="text-xs font-semibold {hasError ? 'text-error' : hasMessage ? 'text-success' : 'text-on-surface-variant'}">
    {#if hasError}
      <span>{displayError}</span>
    {:else if hasMessage}
      <span>{displayMessage}</span>
    {:else}
      <span>{idleText}</span>
    {/if}
  </div>
{/if}
