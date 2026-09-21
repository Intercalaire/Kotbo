import { describe, expect, test } from 'bun:test';
import {
  ADVENTURE_CHOICE_TEXT_MAX,
  ADVENTURE_CHOICES_MAX,
  AdventureEventError,
  normalizeAdventureEventInput,
  parseAdventureChoices,
} from '../../services/features/rpg/rpgAdventureEventPolicy.js';

const VALID = {
  title: 'Le Marchand Ambulant',
  description: 'Un marchand vous propose une affaire.',
  emoji: '🧙',
  choices: [
    { text: 'Acheter', hpEffect: 0, coinEffect: -30, xpEffect: 10, minLevel: 1 },
    { text: 'Refuser', hpEffect: 0, coinEffect: 0, xpEffect: 2, minLevel: 0 },
  ],
};

describe('normalizeAdventureEventInput', () => {
  test('accepte un événement complet et nettoie les espaces', () => {
    const event = normalizeAdventureEventInput({ ...VALID, title: '  Le Marchand Ambulant  ' });
    expect(event.title).toBe('Le Marchand Ambulant');
    expect(event.choices).toHaveLength(2);
    expect(event.choices[0]).toEqual({ text: 'Acheter', hpEffect: 0, coinEffect: -30, xpEffect: 10, minLevel: 1 });
  });

  test('prend un emoji par défaut quand il manque', () => {
    expect(normalizeAdventureEventInput({ ...VALID, emoji: '' }).emoji).toBe('🌲');
  });

  test('refuse un événement sans choix', () => {
    expect(() => normalizeAdventureEventInput({ ...VALID, choices: [] })).toThrow(AdventureEventError);
  });

  test('refuse plus de choix qu une rangée de boutons ne peut en porter', () => {
    const choices = Array.from({ length: ADVENTURE_CHOICES_MAX + 1 }, (_, i) => ({ text: `Choix ${i}` }));
    expect(() => normalizeAdventureEventInput({ ...VALID, choices })).toThrow(/au plus/);
  });

  test('refuse un libellé plus long qu un bouton Discord', () => {
    const choices = [{ text: 'x'.repeat(ADVENTURE_CHOICE_TEXT_MAX + 1) }];
    expect(() => normalizeAdventureEventInput({ ...VALID, choices })).toThrow(/libellé/);
  });

  test('refuse un gain d XP négatif, que l écran de voyage afficherait en « +-5 »', () => {
    const choices = [{ text: 'Fuir', xpEffect: -5 }];
    expect(() => normalizeAdventureEventInput({ ...VALID, choices })).toThrow(/XP/);
  });

  test('refuse un titre vide', () => {
    expect(() => normalizeAdventureEventInput({ ...VALID, title: '   ' })).toThrow(/titre/);
  });

  test('les effets omis valent zéro', () => {
    const event = normalizeAdventureEventInput({ ...VALID, choices: [{ text: 'Attendre' }] });
    expect(event.choices[0]).toEqual({ text: 'Attendre', hpEffect: 0, coinEffect: 0, xpEffect: 0, minLevel: 0 });
  });
});

describe('parseAdventureChoices', () => {
  test('ignore les entrées abîmées au lieu de lever', () => {
    expect(parseAdventureChoices(null)).toEqual([]);
    expect(parseAdventureChoices([{ text: '' }, 'texte', { text: 'Ok', hpEffect: '3' }])).toEqual([
      { text: 'Ok', hpEffect: 3, coinEffect: 0, xpEffect: 0, minLevel: 0 },
    ]);
  });
});
