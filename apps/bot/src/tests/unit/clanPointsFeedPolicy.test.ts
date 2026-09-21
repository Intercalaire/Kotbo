import { describe, expect, test } from 'bun:test';
import {
  chunkFeedLines,
  formatFeedLine,
  CLAN_WIDE_USER_ID,
} from '../../services/community/clanPointsFeedPolicy.js';

const base = { clanId: 'c1', userId: '123', amount: 12, source: 'RPG_BOSS', credit: null };

describe('ligne du flux des points de clan', () => {
  test('cite le membre, le montant, le clan et l\'origine', () => {
    expect(formatFeedLine(base, 'Loups')).toBe('`+12` · <@123> · **Loups** · RPG - boss');
  });

  test('un gain attribué au clan entier ne cite personne', () => {
    expect(formatFeedLine({ ...base, userId: CLAN_WIDE_USER_ID, source: 'ADMIN' }, 'Loups'))
      .toBe('`+12` · Tout le clan · **Loups** · Staff');
  });

  test('un retrait garde son signe', () => {
    expect(formatFeedLine({ ...base, amount: -30, source: 'DEBT' }, 'Loups'))
      .toBe('`-30` · <@123> · **Loups** · Remboursement de dette');
  });

  test('une mise entièrement à crédit affiche sa part à crédit', () => {
    expect(formatFeedLine({ ...base, amount: 0, credit: 20, source: 'BET' }, 'Loups'))
      .toBe('`±0` (dont 20 à crédit) · <@123> · **Loups** · Pari');
  });

  test('une origine inconnue est affichée telle quelle', () => {
    expect(formatFeedLine({ ...base, source: 'NOUVEAU' }, null)).toBe('`+12` · <@123> · clan supprimé · NOUVEAU');
  });
});

describe('découpage du flux en embeds', () => {
  test('regroupe les lignes sous la limite sans en couper aucune', () => {
    expect(chunkFeedLines(['aaaa', 'bbbb', 'cccc'], 9)).toEqual(['aaaa\nbbbb', 'cccc']);
  });

  test('rien à publier, aucun embed', () => {
    expect(chunkFeedLines([])).toEqual([]);
  });
});
