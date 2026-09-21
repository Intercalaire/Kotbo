import { describe, expect, test } from 'bun:test';
import {
  chunkFeedLines,
  fitFieldValue,
  formatFeedLine,
  summarizeFeed,
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

  test('la mise en forme d\'un nom de clan est neutralisée', () => {
    expect(formatFeedLine(base, '*Loups*')).toBe('`+12` · <@123> · **\\*Loups\\*** · RPG - boss');
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

describe('récapitulatif d\'une grosse rafale', () => {
  const names = new Map([['c1', 'Loups'], ['c2', 'Corbeaux']]);
  const raid = (clanId: string, userId: string, amount: number) =>
    ({ clanId, userId, amount, source: 'RPG_RAID', credit: null });

  test('un champ par clan, du plus gros total au plus petit, membres cumulés', () => {
    const fields = summarizeFeed([
      raid('c2', 'a', 5),
      raid('c1', 'b', 12),
      raid('c1', 'c', 12),
      raid('c1', 'b', 3),
    ], names);

    expect(fields).toEqual([
      { name: 'Loups · +27', value: '**RPG - raid** · `+27`\n<@b> `+15` · <@c> `+12`' },
      { name: 'Corbeaux · +5', value: '**RPG - raid** · `+5`\n<@a> `+5`' },
    ]);
  });

  test('les membres qui ne rentrent pas sont comptés sans couper de mention', () => {
    const value = fitFieldValue([
      { text: '**Drop** · `+3`', member: false },
      { text: '<@1> `+1`', member: true },
      { text: '<@2> `+1`', member: true, sameLine: true },
      { text: '<@3> `+1`', member: true, sameLine: true },
    ], 40);

    expect(value).toBe('**Drop** · `+3`\n<@1> `+1`\n… et 2 autres');
    expect(value.length).toBeLessThanOrEqual(40);
  });
});
