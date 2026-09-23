import { describe, expect, test } from 'bun:test';
import {
  chunkFeedLines,
  feedSourceLabel,
  fitClanBlock,
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

describe('découpage du flux en messages', () => {
  test('regroupe les lignes sous la limite sans en couper aucune', () => {
    expect(chunkFeedLines(['aaaa', 'bbbb', 'cccc'], 9)).toEqual(['aaaa\nbbbb', 'cccc']);
  });

  test('rien à publier, aucun message', () => {
    expect(chunkFeedLines([])).toEqual([]);
  });
});

describe('récapitulatif d\'une grosse rafale', () => {
  const names = new Map([['c1', 'Loups'], ['c2', 'Corbeaux']]);
  const raid = (clanId: string, userId: string, amount: number) =>
    ({ clanId, userId, amount, source: 'RPG_RAID', credit: null });

  test('un bloc par clan, du plus gros total au plus petit, membres cumulés', () => {
    const message = summarizeFeed([
      raid('c2', 'a', 5),
      raid('c1', 'b', 12),
      raid('c1', 'c', 12),
      raid('c1', 'b', 3),
    ], names);

    expect(message).toBe([
      '**4 mouvements de points de clan**',
      '',
      '**Loups · +27**',
      'RPG - raid · `+27`',
      '<@b> `+15` · <@c> `+12`',
      '',
      '**Corbeaux · +5**',
      'RPG - raid · `+5`',
      '<@a> `+5`',
    ].join('\n'));
  });

  test('le message reste sous la limite Discord et compte les clans écartés', () => {
    const events = Array.from({ length: 40 }, (_, clan) =>
      Array.from({ length: 30 }, (_, member) => raid(`clan${clan}`, `${clan}0${member}0000000000`, 12))
    ).flat();
    const message = summarizeFeed(events, new Map(), 5);

    expect(message.length).toBeLessThanOrEqual(2000);
    expect(message).toMatch(/^\*\*1\s?205 mouvements de points de clan\*\* \(5 non détaillés\)/);
    expect(message).toMatch(/… et \d+ autres clans$/);
  });

  test('les membres qui ne rentrent pas sont comptés sans couper de mention', () => {
    const value = fitClanBlock([
      { text: '**Drop** · `+3`', member: false },
      { text: '<@1> `+1`', member: true },
      { text: '<@2> `+1`', member: true, sameLine: true },
      { text: '<@3> `+1`', member: true, sameLine: true },
    ], 40);

    expect(value).toBe('**Drop** · `+3`\n<@1> `+1`\n… et 2 autres');
    expect(value.length).toBeLessThanOrEqual(40);
  });
});

describe('libellé de provenance', () => {
  test('la prime du premier vainqueur a son propre libellé', () => {
    expect(feedSourceLabel('RPG_FIRST_KILL')).toBe('Premier vainqueur');
    expect(feedSourceLabel('RPG_FISHBOOK')).toBe('Carnet de pêche');
  });
});
