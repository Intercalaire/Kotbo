/**
 * Vocabulaire des emplacements d'équipement.
 *
 * Il vit dans son propre module parce que quatre systèmes en dépendent - la forge, l'autel
 * d'enchantement, l'équipement et le panneau - et que le faire porter par l'un d'eux créait
 * un cycle d'imports dès que le suivant en avait besoin.
 *
 * RÈGLE : un emplacement est identifié par sa clé (`accessory2`), jamais par son index. Les
 * clés sont écrites dans les `customId` des boutons ; les renommer casserait les messages
 * déjà envoyés.
 */

export type EquipmentSlot = 'weapon' | 'armor' | 'accessory' | 'accessory2' | 'accessory3';
export type AccessorySlot = 'accessory' | 'accessory2' | 'accessory3';

export type SlotItemField = 'weaponId' | 'armorId' | 'accessoryId' | 'accessory2Id' | 'accessory3Id';

export const SLOT_ITEM_FIELD: Record<EquipmentSlot, SlotItemField> = {
  weapon: 'weaponId',
  armor: 'armorId',
  accessory: 'accessoryId',
  accessory2: 'accessory2Id',
  accessory3: 'accessory3Id',
};

/** Les trois emplacements d'accessoire, dans l'ordre où ils se débloquent. */
export const ACCESSORY_SLOTS: AccessorySlot[] = ['accessory', 'accessory2', 'accessory3'];

/**
 * Niveau requis pour ouvrir chaque emplacement d'accessoire.
 *
 * Le premier est ouvert d'entrée : c'est le comportement d'avant les emplacements
 * multiples, et un personnage qui en portait déjà un ne doit rien perdre. Les deux
 * suivants tombent après le choix de classe (niveau 5) puis après le palier d'équipement
 * épique (niveau 18), pour que chaque ouverture arrive quand le joueur a de quoi la
 * remplir.
 */
export const ACCESSORY_SLOT_LEVELS: Record<AccessorySlot, number> = {
  accessory: 1,
  accessory2: 12,
  accessory3: 24,
};

/** Tous les emplacements, accessoires compris, dans l'ordre d'affichage. */
export const ALL_EQUIPMENT_SLOTS: EquipmentSlot[] = ['weapon', 'armor', ...ACCESSORY_SLOTS];

export function isEquipmentSlot(value: string): value is EquipmentSlot {
  // `in` accepterait aussi les clés héritées (`constructor`, `toString`) lues dans un customId.
  return Object.prototype.hasOwnProperty.call(SLOT_ITEM_FIELD, value);
}

export function isAccessorySlot(value: string): value is AccessorySlot {
  return (ACCESSORY_SLOTS as string[]).includes(value);
}

/**
 * Emplacement d'équipement correspondant à un type d'objet.
 *
 * C'est l'emplacement *canonique* : un accessoire renvoie `accessory`, jamais `accessory2`.
 * Le choix de l'emplacement physique réellement occupé revient à `firstFreeAccessorySlot`.
 */
export function slotForItemType(type: string): 'weapon' | 'armor' | 'accessory' | null {
  if (type === 'WEAPON') return 'weapon';
  if (type === 'ARMOR') return 'armor';
  if (type === 'ACCESSORY') return 'accessory';
  return null;
}

/**
 * Emplacement « canonique » d'un emplacement physique.
 *
 * Les trois emplacements d'accessoire acceptent exactement les mêmes objets et les mêmes
 * enchantements : le catalogue n'en connaît donc qu'un, `accessory`. C'est la traduction
 * à faire avant toute comparaison avec une déclaration de catalogue.
 */
export function canonicalSlot(slot: EquipmentSlot): 'weapon' | 'armor' | 'accessory' {
  return isAccessorySlot(slot) ? 'accessory' : slot;
}

/** Emplacements d'accessoire réellement ouverts au niveau atteint. */
export function unlockedAccessorySlots(level: number): AccessorySlot[] {
  return ACCESSORY_SLOTS.filter((slot) => level >= ACCESSORY_SLOT_LEVELS[slot]);
}

/** Emplacements utilisables au niveau atteint : arme, armure et accessoires ouverts. */
export function unlockedSlots(level: number): EquipmentSlot[] {
  return ['weapon', 'armor', ...unlockedAccessorySlots(level)];
}

/** Sous-ensemble du profil suffisant pour lire l'équipement porté. */
export type SlottedProfile = Record<SlotItemField, string | null>;

/** Identifiant de l'objet porté dans un emplacement, `null` si vide. */
export function itemIdInSlot(profile: SlottedProfile, slot: EquipmentSlot): string | null {
  return profile[SLOT_ITEM_FIELD[slot]];
}

/** Emplacement où un objet est porté, `null` s'il ne l'est pas. */
export function slotHoldingItem(profile: SlottedProfile, itemId: string): EquipmentSlot | null {
  return ALL_EQUIPMENT_SLOTS.find((slot) => itemIdInSlot(profile, slot) === itemId) ?? null;
}

/** Identifiants de tout ce qui est porté, sans doublon ni trou. */
export function equippedItemIds(profile: SlottedProfile): string[] {
  const ids = ALL_EQUIPMENT_SLOTS
    .map((slot) => itemIdInSlot(profile, slot))
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/**
 * Premier emplacement d'accessoire libre et ouvert au niveau atteint.
 *
 * Renvoie `null` quand ils sont tous pris : l'appelant refuse alors l'équipement plutôt
 * que d'écraser un accessoire au hasard, le joueur devant choisir lui-même lequel retirer.
 */
export function firstFreeAccessorySlot(profile: SlottedProfile, level: number): AccessorySlot | null {
  return unlockedAccessorySlots(level).find((slot) => itemIdInSlot(profile, slot) === null) ?? null;
}
