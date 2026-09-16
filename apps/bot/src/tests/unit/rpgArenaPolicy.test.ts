import { describe, expect, test } from 'bun:test';
import {
  ARENA_COOLDOWN_MS,
  ARENA_ENERGY_COST,
  ARENA_MIN_LEVEL,
  ARENA_RATING_FLOOR,
  ARENA_RATING_WINDOW,
  ARENA_START_RATING,
  applyRating,
  arenaReward,
  arenaTier,
  canEnterArena,
  eligibleOpponents,
  expectedScore,
  nextStreak,
  ratingExchange,
} from '../../services/features/rpg/rpgArenaPolicy.js';

describe('expectedScore', () => {
  test('deux combattants de même niveau sont à cinquante-cinquante', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 5);
  });

  test('le mieux classé est favori', () => {
    expect(expectedScore(1400, 1000)).toBeGreaterThan(0.5);
    expect(expectedScore(1000, 1400)).toBeLessThan(0.5);
  });
});

describe('ratingExchange', () => {
  test('battre plus fort que soi rapporte plus que battre plus faible', () => {
    // C'est la seule mécanique qui décourage l'acharnement sur les mêmes cibles faibles.
    const upset = ratingExchange(1000, 1400);
    const expectedWin = ratingExchange(1400, 1000);

    expect(upset).toBeGreaterThan(expectedWin);
  });

  test('un duel très déséquilibré rapporte quand même un point', () => {
    // À zéro, le duel ne compterait pour rien et le classement ne bougerait jamais.
    expect(ratingExchange(2500, 100)).toBeGreaterThanOrEqual(1);
  });

  test('à classement égal, l échange vaut la moitié du facteur K', () => {
    expect(ratingExchange(1000, 1000)).toBe(16);
  });
});

describe('applyRating', () => {
  test('ajoute et retranche les points', () => {
    expect(applyRating(1000, 24)).toBe(1024);
    expect(applyRating(1000, -24)).toBe(976);
  });

  test('ne descend jamais sous le plancher', () => {
    // Sans plancher, une série de défaites enfermerait le joueur dans une spirale.
    expect(applyRating(ARENA_RATING_FLOOR, -500)).toBe(ARENA_RATING_FLOOR);
  });
});

describe('nextStreak', () => {
  test('une victoire prolonge une série de victoires', () => {
    expect(nextStreak(3, true)).toBe(4);
  });

  test('une victoire après des défaites repart à un', () => {
    // Repartir de 0 rendrait la série illisible : « 0 » ne dit pas qu'on vient de gagner.
    expect(nextStreak(-3, true)).toBe(1);
  });

  test('une défaite après des victoires repart à moins un', () => {
    expect(nextStreak(4, false)).toBe(-1);
  });

  test('une défaite prolonge une série de défaites', () => {
    expect(nextStreak(-2, false)).toBe(-3);
  });
});

describe('arenaReward', () => {
  test('le perdant repart avec un peu d XP, pas de pièces', () => {
    const reward = arenaReward(20, false);
    expect(reward.coins).toBe(0);
    expect(reward.xp).toBeGreaterThan(0);
  });

  test('la récompense suit les points gagnés', () => {
    // Indexée sur le niveau, elle ferait de l'arène une ferme à pièces pour les hauts
    // niveaux qui écrasent des débutants.
    expect(arenaReward(30, true).coins).toBeGreaterThan(arenaReward(5, true).coins);
  });
});

describe('canEnterArena', () => {
  const now = new Date('2026-09-16T12:00:00Z');

  test('accepte un combattant reposé et de niveau suffisant', () => {
    const check = canEnterArena({ level: ARENA_MIN_LEVEL, energy: ARENA_ENERGY_COST }, null, now);
    expect(check.ok).toBe(true);
  });

  test('refuse sous le niveau minimum', () => {
    const check = canEnterArena({ level: ARENA_MIN_LEVEL - 1, energy: 100 }, null, now);
    expect(check).toEqual({ ok: false, reason: 'level' });
  });

  test('refuse sans l énergie requise', () => {
    const check = canEnterArena({ level: 20, energy: ARENA_ENERGY_COST - 1 }, null, now);
    expect(check).toEqual({ ok: false, reason: 'energy' });
  });

  test('refuse pendant le temps d attente, et dit combien il reste', () => {
    const lastMatch = new Date(now.getTime() - ARENA_COOLDOWN_MS / 2);
    const check = canEnterArena({ level: 20, energy: 100 }, lastMatch, now);

    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toBe('cooldown');
    expect(check.ok === false && check.retryInMs).toBeCloseTo(ARENA_COOLDOWN_MS / 2, -2);
  });

  test('accepte une fois le temps d attente écoulé', () => {
    const lastMatch = new Date(now.getTime() - ARENA_COOLDOWN_MS);
    expect(canEnterArena({ level: 20, energy: 100 }, lastMatch, now).ok).toBe(true);
  });

  test('le niveau prime sur l énergie', () => {
    // C'est l'ordre qui aide : l'énergie revient toute seule, pas le niveau.
    const check = canEnterArena({ level: 1, energy: 0 }, null, now);
    expect(check.ok === false && check.reason).toBe('level');
  });
});

describe('eligibleOpponents', () => {
  const candidates = [
    { userId: 'moi', level: 20, rating: 1000 },
    { userId: 'proche', level: 20, rating: 1050 },
    { userId: 'loin', level: 20, rating: 1000 + ARENA_RATING_WINDOW + 200 },
    { userId: 'trop_bas_niveau', level: ARENA_MIN_LEVEL - 1, rating: 1010 },
  ];

  test('exclut le challenger lui-même', () => {
    const opponents = eligibleOpponents('moi', 1000, candidates);
    expect(opponents.map((o) => o.userId)).not.toContain('moi');
  });

  test('exclut ceux qui n ont pas le niveau de l arène', () => {
    const opponents = eligibleOpponents('moi', 1000, candidates);
    expect(opponents.map((o) => o.userId)).not.toContain('trop_bas_niveau');
  });

  test('retient d abord la fenêtre de classement', () => {
    const opponents = eligibleOpponents('moi', 1000, candidates);
    expect(opponents.map((o) => o.userId)).toEqual(['proche']);
  });

  test('élargit à tout le monde quand la fenêtre est vide', () => {
    // Sur un petit serveur, ou pour qui est très haut, la fenêtre ne contient personne :
    // un adversaire mal apparié vaut mieux qu'un écran vide.
    const opponents = eligibleOpponents('moi', 5000, candidates);
    expect(opponents.length).toBeGreaterThan(0);
  });

  test('classe du plus proche au plus lointain', () => {
    const pool = [
      { userId: 'a', level: 20, rating: 1200 },
      { userId: 'b', level: 20, rating: 1010 },
      { userId: 'c', level: 20, rating: 1100 },
    ];

    expect(eligibleOpponents('moi', 1000, pool).map((o) => o.userId)).toEqual(['b', 'c', 'a']);
  });

  test('rend une liste vide quand personne ne convient', () => {
    expect(eligibleOpponents('moi', 1000, [candidates[0]])).toEqual([]);
  });
});

describe('arenaTier', () => {
  test('le classement de départ tombe dans un palier nommé', () => {
    expect(arenaTier(ARENA_START_RATING).name.length).toBeGreaterThan(0);
  });

  test('les paliers montent avec le classement', () => {
    expect(arenaTier(1700).name).toBe('Champion');
    expect(arenaTier(500).name).toBe('Bleu');
  });
});
