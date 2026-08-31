import { describe, expect, test } from 'bun:test';
import { icon, itemTypeIcon, rarityIcon } from '../../services/features/rpg/rpgIcons.js';
import { UNICODE_FALLBACKS } from '../../utils/emojis.js';

describe('icon', () => {
  test('rend un emoji utilisable pour toutes les clés du module RPG', () => {
    // `setEmoji('')` fait rejeter le message entier par Discord : une clé du hub
    // qui ne résout rien casserait l'écran, pas seulement son bouton.
    const keys = [
      'rpgSword', 'rpgArmor', 'rpgAccessory', 'rpgPotion', 'rpgKey',
      'rpgBag', 'rpgShop', 'rpgFight', 'rpgBoss', 'rpgTravel', 'rpgCharacter',
      'rpgCraft', 'rpgForge', 'rpgEnchant', 'rpgBestiary', 'rpgGuild', 'rpgWar',
      'rpgClan', 'rpgDaily', 'rpgFish', 'rpgBlackMarket', 'rpgRaid', 'rpgPay',
      'rpgSell', 'rpgHp', 'rpgEnergy', 'rpgXp', 'rpgAtk', 'rpgDef', 'rpgSpd',
      'rpgBack', 'rpgPrev', 'rpgNext', 'rpgRefresh',
    ];

    for (const key of keys) {
      expect(icon(key)).not.toBe('');
      expect(UNICODE_FALLBACKS[key]).toBeTruthy();
    }
  });

  test('retombe sur un glyphe visible pour une clé inconnue', () => {
    expect(icon('cleQuiNExistePas')).toBe('•');
  });
});

describe('rarityIcon', () => {
  test('donne une icône distincte à chaque rareté connue', () => {
    const rarities = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
    const icons = rarities.map(rarityIcon);

    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(rarities.length);
  });

  test('ne rend rien pour une rareté absente ou inconnue', () => {
    // La rareté vient de la base : un objet créé au dashboard peut en porter une
    // qui n'existe plus. La ligne doit rester lisible, sans glyphe parasite.
    expect(rarityIcon(null)).toBe('');
    expect(rarityIcon(undefined)).toBe('');
    expect(rarityIcon('MYTHIQUE')).toBe('');
  });
});

describe('itemTypeIcon', () => {
  test('donne une icône distincte à chaque catégorie de la boutique', () => {
    const types = ['WEAPON', 'ARMOR', 'ACCESSORY', 'POTION', 'QUEST'];
    const icons = types.map(itemTypeIcon);

    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(types.length);
  });

  test('retombe sur le sac pour un type inconnu', () => {
    expect(itemTypeIcon('AUTRE')).toBe(icon('rpgBag'));
    expect(itemTypeIcon(null)).toBe(icon('rpgBag'));
  });
});
