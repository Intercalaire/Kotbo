import { describe, expect, test } from 'bun:test';
import { buildFishBook } from '../../services/features/rpg/rpgFishBook.js';

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
