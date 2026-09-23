<!--
  Un champ de formulaire : libelle, controle, aide ou erreur.
  Le controle recoit l'identifiant a poser sur son element, pour que le
  libelle et l'aide lui soient relies :

    <Field label="Seuil" hint="Nombre de reactions">
      {#snippet children(id, describedBy)}
        <input {id} aria-describedby={describedBy} class="input" type="number" bind:value={seuil} />
      {/snippet}
    </Field>
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    label,
    hint = '',
    error = '',
    required = false,
    id: forcedId = undefined,
    class: className = '',
    children,
  }: {
    label: string;
    hint?: string;
    /** Message d'erreur : remplace l'aide et passe le champ en rouge. */
    error?: string;
    required?: boolean;
    /** Identifiant impose, si le controle en a deja un. */
    id?: string;
    class?: string;
    children: Snippet<[string, string | undefined]>;
  } = $props();

  const generated = $props.id();
  const id = $derived(forcedId ?? generated);
  const describedBy = $derived(error || hint ? `${id}-desc` : undefined);
</script>

<div class="field {error ? 'field--invalid' : ''} {className}">
  <label for={id} class="field-label">
    {label}{#if required}<span class="field-required" aria-hidden="true"> *</span>{/if}
  </label>
  {@render children(id, describedBy)}
  {#if error}
    <p id={describedBy} class="field-error">{error}</p>
  {:else if hint}
    <p id={describedBy} class="field-hint">{hint}</p>
  {/if}
</div>
