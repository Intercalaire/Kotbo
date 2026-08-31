/**
 * Pictogrammes du module RPG.
 *
 * Le hub s'écrivait entièrement en emojis Unicode. Rendu différent sur chaque
 * plateforme, aucune parenté visuelle d'un écran à l'autre, et des glyphes qui
 * ne disaient rien du jeu (🦺 pour une armure, 🧬 pour une fiche de
 * personnage). Le module partage désormais le jeu d'icônes Lucide déjà utilisé
 * par le reste du bot : un seul trait, une seule palette, et chaque écran se
 * lit comme une partie du même client de jeu.
 *
 * Tout passe par `icon()` : `E` renvoie une chaîne vide pour une clé inconnue,
 * et `setEmoji('')` fait rejeter le message entier par Discord. Un repli
 * Unicode explicite vaut mieux qu'un panneau qui ne s'affiche pas.
 */

import { E, UNICODE_FALLBACKS } from '../../../utils/emojis.js';

/** Repli de dernier recours : ni emoji d'application, ni fallback déclaré. */
const LAST_RESORT = '•';

export function icon(key: string): string {
  return E[key] || UNICODE_FALLBACKS[key] || LAST_RESORT;
}

/** Icône de rareté d'un objet. Une teinte par rang, un seul glyphe. */
export function rarityIcon(rarity: string | null | undefined): string {
  switch (rarity) {
    case 'UNCOMMON': return icon('rarUncommon');
    case 'RARE': return icon('rarRare');
    case 'EPIC': return icon('rarEpic');
    case 'LEGENDARY': return icon('rarLegendary');
    case 'COMMON': return icon('rarCommon');
    default: return '';
  }
}

/** Icône de catégorie d'objet, alignée sur les types de `RpgItem.type`. */
export function itemTypeIcon(type: string | null | undefined): string {
  switch (type) {
    case 'WEAPON': return icon('rpgSword');
    case 'ARMOR': return icon('rpgArmor');
    case 'ACCESSORY': return icon('rpgAccessory');
    case 'POTION': return icon('rpgPotion');
    case 'QUEST': return icon('rpgKey');
    default: return icon('rpgBag');
  }
}
