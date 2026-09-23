import { describe, expect, test } from 'bun:test';
import { buildFishBook, fishBookProgress, normalizeFishBookReward } from '../../services/features/rpg/rpgFishBook.js';

const CATALOG = [
  { name: 'Sardine', emoji: '🐟', rarity: 'COMMON' },
  { name: 'Barracuda', emoji: '🦈', rarity: 'RARE' },
  { name: 'Kraken Bébé', emoji: '🦑', rarity: 'LEGENDARY' },
];

describe('carnet de pêche', () => {
  test('compte les espèces découvertes et les prises', () => {
    const book = buildFishBook(CATALOG, new Map([['Sardine', 12], ['Barracuda', 1]]));
    expect(book.discovered).toBe(2);
    expect(book.total).toBe(3);
    expect(book.totalCaught).toBe(13);
    expect(book.entries.map((entry) => entry.caught)).toEqual([12, 1, 0]);
  });

  test('un joueur qui n\'a rien pêché voit tout le catalogue à découvrir', () => {
    const book = buildFishBook(CATALOG, new Map());
    expect(book.discovered).toBe(0);
    expect(book.entries).toHaveLength(3);
  });

  test('une espèce retirée du catalogue compte dans le total sans ligne à elle', () => {
    const book = buildFishBook(CATALOG, new Map([['Anguille', 4], ['Sardine', 1]]));
    expect(book.totalCaught).toBe(5);
    expect(book.discovered).toBe(1);
    expect(book.entries.some((entry) => entry.name === 'Anguille')).toBe(false);
  });
});

describe('paliers du carnet de pêche', () => {
  test('une rareté se termine quand toutes ses espèces sont pêchées', () => {
    const book = buildFishBook(CATALOG, new Map([['Sardine', 3], ['Barracuda', 1]]));
    const progress = fishBookProgress(book);
    expect(progress.find((tier) => tier.tier === 'COMMON')).toMatchObject({ caught: 1, total: 1, complete: true });
    expect(progress.find((tier) => tier.tier === 'LEGENDARY')?.complete).toBe(false);
    expect(progress.find((tier) => tier.tier === 'COMPLETE')).toMatchObject({ caught: 2, total: 3, complete: false });
  });

  test('une rareté sans espèce n\'a pas de palier à offrir', () => {
    const progress = fishBookProgress(buildFishBook(CATALOG, new Map()));
    expect(progress.some((tier) => tier.tier === 'UNCOMMON' || tier.tier === 'EPIC')).toBe(false);
  });

  test('le carnet complet suit le catalogue actif', () => {
    const book = buildFishBook(CATALOG, new Map([['Sardine', 1], ['Barracuda', 1], ['Kraken Bébé', 1]]));
    expect(fishBookProgress(book).every((tier) => tier.complete)).toBe(true);
  });

  test('la saisie d\'une récompense écarte un rôle invalide et borne les montants', () => {
    expect(normalizeFishBookReward({ coinReward: -1, xpReward: '50', clanPoints: 1e9, roleId: 'abc', itemName: '  ', titleId: 't1' })).toEqual({
      coinReward: 0,
      xpReward: 50,
      clanPoints: 100_000,
      itemName: null,
      roleId: null,
      titleId: 't1',
    });
  });
});
