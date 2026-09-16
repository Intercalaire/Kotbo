<script lang="ts">
  /**
   * Affiche un texte comme Discord le ferait des emojis personnalisés.
   *
   * Depuis que le sélecteur propose les emojis du serveur, un champ « emoji »
   * peut contenir `<:nom:id>`. Rendu brut, l'utilisateur lit le code au lieu de
   * voir son image et croit son réglage cassé : ce composant sert partout où
   * une de ces valeurs est affichée plutôt que saisie - la valeur seule, ou
   * une phrase dans laquelle elle a été glissée.
   */
  import { customEmojiSegments } from '../emojiParser';

  let {
    value = '',
    /** Taille des images. En `em`, elles suivent la taille du texte voisin. */
    size = '1.15em',
    class: extraClass = '',
  }: {
    value?: string | null;
    size?: string;
    class?: string;
  } = $props();

  const segments = $derived(customEmojiSegments(value));

  const hasCustom = $derived(segments.some((segment) => segment.type === 'emoji'));
</script>

<!-- Boucle sur une seule ligne : Svelte rend les sauts de ligne du gabarit, et
     un parent en `whitespace-pre-wrap` les afficherait au milieu de la phrase. -->
{#if hasCustom}<span class={extraClass}>{#each segments as segment}{#if segment.type === 'emoji'}<img src={segment.url} alt=":{segment.name}:" title=":{segment.name}:" loading="lazy" class="inline-block align-[-0.2em] object-contain" style="width: {size}; height: {size};" />{:else}{segment.value}{/if}{/each}</span>{:else}<span class={extraClass}>{value ?? ''}</span>{/if}
