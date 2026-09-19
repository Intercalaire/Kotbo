/**
 * Catalogue d'enchantements.
 *
 * Le contenu a rejoint @kotbo/contracts : le dashboard doit le lire pour
 * proposer un enchantement a la creation d'un parchemin, et rien dans ce
 * catalogue ne depend du bot. Ce fichier ne fait plus que reexporter, les huit
 * modules qui l'importent restent inchanges.
 */
export {
  RPG_ENCHANTMENTS,
  ENCHANT_SLOTS_BY_RARITY,
  EFFECT_CAPS,
  getEnchantment,
  enchantmentsForSlot,
  enchantCapacity,
  parseEnchants,
  aggregateEnchantEffects,
  formatEnchant,
} from '@kotbo/contracts';
export type {
  EnchantSlot,
  EnchantEffect,
  RpgEnchantment,
  EnchantStack,
} from '@kotbo/contracts';
