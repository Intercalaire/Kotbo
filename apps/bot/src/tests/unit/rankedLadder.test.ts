import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RANKED_LADDER,
  compareRankedTiers,
  normalizeRankedLadder,
  rankedFloorRp,
  rankedProgress,
  rankedTierByKey,
  rankedTierIndex,
  resolveRankedTier,
} from '@kotbo/shared';

describe('DEFAULT_RANKED_LADDER', () => {
  test('demarre a 0 RP et reste strictement croissante', () => {
    expect(DEFAULT_RANKED_LADDER[0].minRp).toBe(0);
    for (let i = 1; i < DEFAULT_RANKED_LADDER.length; i++) {
      expect(DEFAULT_RANKED_LADDER[i].minRp).toBeGreaterThan(DEFAULT_RANKED_LADDER[i - 1].minRp);
    }
  });

  test('n a aucune cle en double', () => {
    const keys = new Set(DEFAULT_RANKED_LADDER.map((tier) => tier.key));
    expect(keys.size).toBe(DEFAULT_RANKED_LADDER.length);
  });

  test('l apex n a pas de division', () => {
    expect(DEFAULT_RANKED_LADDER[DEFAULT_RANKED_LADDER.length - 1].division).toBe(0);
  });
});

describe('resolveRankedTier', () => {
  test('attribue toujours un palier, meme a 0 RP ou avec une valeur aberrante', () => {
    expect(resolveRankedTier(0).key).toBe('BRONZE_1');
    expect(resolveRankedTier(-500).key).toBe('BRONZE_1');
    expect(resolveRankedTier(Number.NaN).key).toBe('BRONZE_1');
  });

  test('bascule exactement au seuil, pas un RP avant', () => {
    const silver = DEFAULT_RANKED_LADDER.find((tier) => tier.key === 'SILVER_1')!;
    expect(resolveRankedTier(silver.minRp - 1).key).toBe('BRONZE_3');
    expect(resolveRankedTier(silver.minRp).key).toBe('SILVER_1');
  });

  test('un RP enorme reste a l apex', () => {
    const apex = DEFAULT_RANKED_LADDER[DEFAULT_RANKED_LADDER.length - 1];
    expect(resolveRankedTier(10_000_000).key).toBe(apex.key);
    expect(rankedTierIndex(10_000_000)).toBe(DEFAULT_RANKED_LADDER.length - 1);
  });
});

describe('rankedProgress', () => {
  test('rend 0 % au seuil du palier et 100 % juste avant le suivant', () => {
    const gold = DEFAULT_RANKED_LADDER.find((tier) => tier.key === 'GOLD_1')!;
    const gold2 = DEFAULT_RANKED_LADDER.find((tier) => tier.key === 'GOLD_2')!;

    expect(rankedProgress(gold.minRp).percent).toBe(0);
    expect(rankedProgress(gold2.minRp - 1).percent).toBeGreaterThanOrEqual(99);
  });

  test('le RP restant vise toujours le palier suivant', () => {
    const silver1 = DEFAULT_RANKED_LADDER.find((tier) => tier.key === 'SILVER_1')!;
    const silver2 = DEFAULT_RANKED_LADDER.find((tier) => tier.key === 'SILVER_2')!;

    // Juste sous le seuil : ce qu'il reste pour entrer dans Silver I.
    expect(rankedProgress(silver1.minRp - 10).rpRemaining).toBe(10);
    // Une fois promu, la cible devient Silver II, pas le palier qu'on occupe.
    expect(rankedProgress(silver1.minRp).rpRemaining).toBe(silver2.minRp - silver1.minRp);
  });

  test('a l apex il n y a pas de palier suivant et la barre est pleine', () => {
    const apex = DEFAULT_RANKED_LADDER[DEFAULT_RANKED_LADDER.length - 1];
    const progress = rankedProgress(apex.minRp + 5_000);
    expect(progress.next).toBeNull();
    expect(progress.percent).toBe(100);
    expect(progress.rpRemaining).toBe(0);
  });

  test('expose le palier inferieur pour l affichage « precedent »', () => {
    expect(rankedProgress(0).below).toBeNull();
    expect(rankedProgress(DEFAULT_RANKED_LADDER[2].minRp).below?.key).toBe(DEFAULT_RANKED_LADDER[1].key);
  });
});

describe('normalizeRankedLadder', () => {
  test('retombe sur l echelle par defaut pour une entree vide ou invalide', () => {
    expect(normalizeRankedLadder(null)).toBe(DEFAULT_RANKED_LADDER);
    expect(normalizeRankedLadder([])).toBe(DEFAULT_RANKED_LADDER);
    expect(normalizeRankedLadder('nope')).toBe(DEFAULT_RANKED_LADDER);
    expect(normalizeRankedLadder([{ minRp: 'abc' }])).toBe(DEFAULT_RANKED_LADDER);
  });

  test('trie par RP et ramene le premier seuil a 0', () => {
    const ladder = normalizeRankedLadder([
      { key: 'B', tier: 'B', minRp: 900 },
      { key: 'A', tier: 'A', minRp: 300 },
    ]);

    expect(ladder.map((tier) => tier.key)).toEqual(['A', 'B']);
    expect(ladder[0].minRp).toBe(0);
  });

  test('rejette deux paliers au meme RP : l attribution doit rester deterministe', () => {
    const ladder = normalizeRankedLadder([
      { key: 'A', tier: 'A', minRp: 0 },
      { key: 'B', tier: 'B', minRp: 0 },
      { key: 'C', tier: 'C', minRp: 500 },
    ]);

    expect(ladder).toHaveLength(2);
    expect(ladder.map((tier) => tier.key)).toEqual(['A', 'C']);
  });

  test('rejette une cle en double', () => {
    const ladder = normalizeRankedLadder([
      { key: 'A', tier: 'A', minRp: 0 },
      { key: 'A', tier: 'A', minRp: 500 },
    ]);
    expect(ladder).toHaveLength(1);
  });

  test('remplace une couleur invalide par un repli lisible', () => {
    const [tier] = normalizeRankedLadder([{ key: 'A', tier: 'A', minRp: 0, color: 'rouge' }]);
    expect(tier.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('une echelle personnalisee reste utilisable par resolveRankedTier', () => {
    const ladder = normalizeRankedLadder([
      { key: 'START', tier: 'START', minRp: 0, name: 'Depart' },
      { key: 'END', tier: 'END', minRp: 100, name: 'Fin' },
    ]);

    expect(resolveRankedTier(50, ladder).key).toBe('START');
    expect(resolveRankedTier(100, ladder).key).toBe('END');
    expect(rankedProgress(50, ladder).percent).toBe(50);
  });
});

describe('rankedTierByKey / rankedFloorRp', () => {
  test('une cle orpheline ne bloque pas le decay', () => {
    expect(rankedTierByKey('DISPARU')).toBeNull();
    expect(rankedFloorRp('DISPARU')).toBe(0);
    expect(rankedFloorRp(null)).toBe(0);
  });

  test('le plancher vaut le seuil du palier protege', () => {
    const gold = DEFAULT_RANKED_LADDER.find((tier) => tier.key === 'GOLD_1')!;
    expect(rankedFloorRp('GOLD_1')).toBe(gold.minRp);
  });
});

describe('compareRankedTiers', () => {
  test('distingue promotion, retrogradation et palier inchange', () => {
    expect(compareRankedTiers('BRONZE_1', 'SILVER_1')).toBeGreaterThan(0);
    expect(compareRankedTiers('SILVER_1', 'BRONZE_1')).toBeLessThan(0);
    expect(compareRankedTiers('GOLD_2', 'GOLD_2')).toBe(0);
  });

  test('renvoie 0 quand un palier est introuvable, plutot que d annoncer un mouvement faux', () => {
    expect(compareRankedTiers('INCONNU', 'GOLD_1')).toBe(0);
    expect(compareRankedTiers('GOLD_1', undefined)).toBe(0);
  });
});
