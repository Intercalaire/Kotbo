import { describe, expect, test } from 'bun:test';
import {
  averageClanSize,
  measureActivity,
  planRebalance,
  type Activity,
  type RebalanceCandidate,
} from '../../services/community/clanRebalancePolicy.js';

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 24 * 60 * 60 * 1000);

// Saison 1 du jour 0 au jour 90, saison 2 ouverte depuis dix jours.
const PREVIOUS = { start: day(0), end: day(90) };
const CURRENT = { start: day(90), end: day(100) };

function activityOf(joinedAt: Date | null, previousPoints: number, currentPoints = 0): Activity {
  return measureActivity({
    joinedAt,
    previous: { ...PREVIOUS, points: previousPoints },
    current: { ...CURRENT, points: currentPoints },
  });
}

function candidate(key: string, clanId: string, rate: number, extra: Partial<RebalanceCandidate> = {}): RebalanceCandidate {
  return {
    key,
    userIds: [key],
    clanId,
    activity: { basis: 'previous', points: rate * 90, presenceDays: 90, rate },
    exclusion: null,
    ...extra,
  };
}

describe('mesure de l\'activité', () => {
  test('un membre présent toute la saison précédente est jugé sur celle-ci', () => {
    const activity = activityOf(day(-30), 180);
    expect(activity.basis).toBe('previous');
    expect(activity.presenceDays).toBe(90);
    expect(activity.rate).toBe(2);
  });

  // Le coeur du sujet : trois semaines de présence ne doivent pas se comparer à trois mois.
  test('une arrivée en cours de saison est ramenée à ses jours de présence', () => {
    const lateButActive = activityOf(day(70), 60);
    const earlyButQuiet = activityOf(day(-10), 90);
    expect(lateButActive.presenceDays).toBe(20);
    expect(lateButActive.rate).toBe(3);
    expect(earlyButQuiet.rate).toBe(1);
    expect(lateButActive.rate).toBeGreaterThan(earlyButQuiet.rate);
  });

  test('trop peu de jours sur la saison précédente renvoie à la saison en cours', () => {
    const activity = activityOf(day(87), 0, 40);
    expect(activity.basis).toBe('current');
    expect(activity.presenceDays).toBe(10);
    expect(activity.rate).toBe(4);
  });

  test('une arrivée après la clôture est jugée sur la saison en cours', () => {
    const activity = activityOf(day(95), 0, 25);
    expect(activity.basis).toBe('current');
    expect(activity.presenceDays).toBe(5);
    expect(activity.rate).toBe(5);
  });

  test('une arrivée de moins d\'un jour n\'a pas de rythme', () => {
    const activity = activityOf(new Date(day(100).getTime() - 3_600_000), 0, 50);
    expect(activity.basis).toBe('none');
    expect(activity.rate).toBe(0);
  });

  test('sans saison précédente, tout le monde est jugé sur la saison en cours', () => {
    const activity = measureActivity({ joinedAt: null, previous: null, current: { ...CURRENT, points: 30 } });
    expect(activity.basis).toBe('current');
    expect(activity.rate).toBe(3);
  });

  test('une date d\'arrivée inconnue vaut présence sur toute la saison', () => {
    expect(activityOf(null, 90).presenceDays).toBe(90);
  });

  test('une saison précédente très courte abaisse le seuil de présence', () => {
    const activity = measureActivity({
      joinedAt: day(1),
      previous: { start: day(0), end: day(4), points: 12 },
      current: { start: day(4), end: day(10), points: 0 },
    });
    expect(activity.basis).toBe('previous');
    expect(activity.rate).toBe(4);
  });

  test('un solde négatif ne descend pas sous zéro', () => {
    expect(activityOf(day(-10), -50).points).toBe(0);
  });
});

describe('plan de rééquilibrage', () => {
  test('la taille visée par défaut est la moyenne arrondie au-dessus', () => {
    expect(averageClanSize([{ id: 'a', count: 10 }, { id: 'b', count: 10 }, { id: 'n', count: 0 }])).toBe(7);
  });

  test('les moins actifs des gros clans partent vers le nouveau clan', () => {
    const clans = [{ id: 'a', count: 6 }, { id: 'n', count: 0 }];
    const candidates = [0, 1, 2, 3, 4, 5].map((rate) => candidate(`a${rate}`, 'a', rate));
    const plan = planRebalance(clans, candidates, { targetClanIds: ['n'], targetSize: 3 });

    expect(plan.moves.map((move) => move.key).sort()).toEqual(['a0', 'a1', 'a2']);
    expect(plan.counts).toEqual({ a: 3, n: 3 });
  });

  test('le plus gros donneur donne en premier', () => {
    const clans = [{ id: 'a', count: 8 }, { id: 'b', count: 4 }, { id: 'n', count: 0 }];
    const candidates = [
      ...Array.from({ length: 8 }, (_, i) => candidate(`a${i}`, 'a', i)),
      ...Array.from({ length: 4 }, (_, i) => candidate(`b${i}`, 'b', i)),
    ];
    const plan = planRebalance(clans, candidates, { targetClanIds: ['n'], targetSize: 4 });

    expect(plan.moves.every((move) => move.fromClanId === 'a')).toBe(true);
    expect(plan.counts).toEqual({ a: 4, b: 4, n: 4 });
  });

  test('aucun transfert qui rendrait le donneur plus petit que la cible', () => {
    const clans = [{ id: 'a', count: 5 }, { id: 'n', count: 4 }];
    const plan = planRebalance(clans, [candidate('a0', 'a', 0)], { targetClanIds: ['n'], targetSize: 10 });
    expect(plan.moves).toEqual([]);
  });

  test('les membres exclus ne partent jamais, le suivant prend leur place', () => {
    const clans = [{ id: 'a', count: 4 }, { id: 'n', count: 0 }];
    const candidates = [
      candidate('leader', 'a', 0, { exclusion: 'leader' }),
      candidate('bet', 'a', 0, { exclusion: 'open_bet' }),
      candidate('quiet', 'a', 1),
      candidate('active', 'a', 9),
    ];
    const plan = planRebalance(clans, candidates, { targetClanIds: ['n'], targetSize: 1 });
    expect(plan.moves).toEqual([{ key: 'quiet', fromClanId: 'a', toClanId: 'n' }]);
  });

  test('une arrivée récente active reste, un ancien inactif part', () => {
    const clans = [{ id: 'a', count: 2 }, { id: 'n', count: 0 }];
    const plan = planRebalance(clans, [
      { key: 'late', userIds: ['late'], clanId: 'a', activity: activityOf(day(70), 60), exclusion: null },
      { key: 'old', userIds: ['old'], clanId: 'a', activity: activityOf(day(-10), 90), exclusion: null },
    ], { targetClanIds: ['n'], targetSize: 1 });
    expect(plan.moves.map((move) => move.key)).toEqual(['old']);
  });

  test('à rythme nul, le membre observé le plus longtemps part d\'abord', () => {
    const clans = [{ id: 'a', count: 2 }, { id: 'n', count: 0 }];
    const plan = planRebalance(clans, [
      { key: 'newcomer', userIds: ['newcomer'], clanId: 'a', activity: activityOf(day(99.5), 0, 0), exclusion: null },
      { key: 'ghost', userIds: ['ghost'], clanId: 'a', activity: activityOf(day(-10), 0), exclusion: null },
    ], { targetClanIds: ['n'], targetSize: 1 });
    expect(plan.moves.map((move) => move.key)).toEqual(['ghost']);
  });

  test('un double compte part avec son principal et compte pour deux', () => {
    const clans = [{ id: 'a', count: 6 }, { id: 'n', count: 0 }];
    const plan = planRebalance(clans, [
      candidate('pair', 'a', 0, { userIds: ['pair', 'pair-alt'] }),
      candidate('solo', 'a', 1),
    ], { targetClanIds: ['n'], targetSize: 3 });
    expect(plan.moves.map((move) => move.key)).toEqual(['pair', 'solo']);
    expect(plan.counts).toEqual({ a: 3, n: 3 });
  });

  test('un groupe trop lourd est sauté sans bloquer les membres seuls', () => {
    const clans = [{ id: 'a', count: 5 }, { id: 'n', count: 2 }];
    const plan = planRebalance(clans, [
      candidate('trio', 'a', 0, { userIds: ['t1', 't2', 't3'] }),
      candidate('solo', 'a', 1),
    ], { targetClanIds: ['n'], targetSize: 10 });
    expect(plan.moves.map((move) => move.key)).toEqual(['solo']);
  });

  test('les clans cibles se remplissent à tour de rôle', () => {
    const clans = [{ id: 'a', count: 12 }, { id: 'n1', count: 0 }, { id: 'n2', count: 0 }];
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(`a${i}`, 'a', i));
    const plan = planRebalance(clans, candidates, { targetClanIds: ['n1', 'n2'], targetSize: 4 });
    expect(plan.counts).toEqual({ a: 4, n1: 4, n2: 4 });
  });

  test('un arrivé du jour passe après un ancien qui joue un peu', () => {
    const clans = [{ id: 'a', count: 2 }, { id: 'n', count: 0 }];
    const plan = planRebalance(clans, [
      { key: 'newcomer', userIds: ['newcomer'], clanId: 'a', activity: activityOf(day(99.5), 0, 0), exclusion: null },
      candidate('slow', 'a', 0.1),
    ], { targetClanIds: ['n'], targetSize: 1 });
    expect(plan.moves.map((move) => move.key)).toEqual(['slow']);
  });

  test('en mode plus actifs, les meilleurs partent en premier', () => {
    const clans = [{ id: 'a', count: 6 }, { id: 'n', count: 0 }];
    const candidates = [0, 1, 2, 3, 4, 5].map((rate) => candidate(`a${rate}`, 'a', rate));
    const plan = planRebalance(clans, candidates, { targetClanIds: ['n'], targetSize: 2, mode: 'most_active' });
    expect(plan.moves.map((move) => move.key)).toEqual(['a5', 'a4']);
  });

  test('en mode plus actifs, un arrivé du jour ne passe pas pour un pilier', () => {
    const clans = [{ id: 'a', count: 2 }, { id: 'n', count: 0 }];
    const plan = planRebalance(clans, [
      { key: 'newcomer', userIds: ['newcomer'], clanId: 'a', activity: activityOf(day(99.5), 0, 0), exclusion: null },
      candidate('regular', 'a', 1),
    ], { targetClanIds: ['n'], targetSize: 1, mode: 'most_active' });
    expect(plan.moves.map((move) => move.key)).toEqual(['regular']);
  });

  test('le tirage au sort est reproductible à graine égale', () => {
    const clans = [{ id: 'a', count: 40 }, { id: 'n', count: 0 }];
    const candidates = Array.from({ length: 40 }, (_, i) => candidate(`member-${i}`, 'a', i));
    const draw = (seed: number) => planRebalance(clans, candidates, { targetClanIds: ['n'], targetSize: 10, mode: 'random', seed })
      .moves.map((move) => move.key);

    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
    expect(draw(42)).toHaveLength(10);
  });

  test('le tirage au sort ignore l\'activité', () => {
    const clans = [{ id: 'a', count: 40 }, { id: 'n', count: 0 }];
    const candidates = Array.from({ length: 40 }, (_, i) => candidate(`member-${i}`, 'a', i));
    const leastActive = candidates.slice(0, 10).map((entry) => entry.key).sort();
    const drawn = planRebalance(clans, candidates, { targetClanIds: ['n'], targetSize: 10, mode: 'random', seed: 7 })
      .moves.map((move) => move.key).sort();
    expect(drawn).not.toEqual(leastActive);
  });

  test('plusieurs nouveaux clans se remplissent depuis plusieurs donneurs', () => {
    const clans = [{ id: 'a', count: 15 }, { id: 'b', count: 9 }, { id: 'n1', count: 0 }, { id: 'n2', count: 0 }];
    const candidates = [
      ...Array.from({ length: 15 }, (_, i) => candidate(`a${i}`, 'a', i)),
      ...Array.from({ length: 9 }, (_, i) => candidate(`b${i}`, 'b', i)),
    ];
    const plan = planRebalance(clans, candidates, { targetClanIds: ['n1', 'n2'], targetSize: averageClanSize(clans) });
    expect(plan.counts).toEqual({ a: 6, b: 6, n1: 6, n2: 6 });
  });

  test('les membres d\'un clan cible ne sont jamais déplacés', () => {
    const clans = [{ id: 'a', count: 1 }, { id: 'n', count: 5 }];
    const plan = planRebalance(clans, [candidate('n0', 'n', 0)], { targetClanIds: ['n'], targetSize: 10 });
    expect(plan.moves).toEqual([]);
  });
});
