import { describe, expect, test } from 'bun:test';
import {
  clampCriterionScore,
  computeCriteriaAverage,
  computeSubmissionPoints,
  convertToClanPoints,
  formatWeekRangeLabel,
  getPreviousWeekKey,
  getSpeedBonus,
  getWeekBounds,
  getWeekDateKeys,
  getWeekKey,
  getZonedDateKey,
  getZonedIsoWeekday,
  isValidWeekKey,
  isWeekend,
  normalizeMultiplier,
  resolveRunMultiplier,
  roundCriteriaAverage,
  type DailyAlgoCriteriaScores,
} from '../../services/progression/dailyAlgoScoring.js';

function scores(
  correctness: number,
  comments: number,
  compactness: number,
  optimization: number,
  readability: number,
): DailyAlgoCriteriaScores {
  return { correctness, comments, compactness, optimization, readability };
}

const PARIS = 'Europe/Paris';

describe('critères de notation', () => {
  test('la moyenne est un multiple de 0.2 (cinq notes entières)', () => {
    expect(computeCriteriaAverage(scores(5, 5, 5, 5, 5))).toBe(5);
    expect(computeCriteriaAverage(scores(1, 1, 1, 1, 1))).toBe(1);
    // 22/5 = 4.4
    expect(computeCriteriaAverage(scores(5, 4, 5, 4, 4))).toBeCloseTo(4.4, 10);
    // 17/5 = 3.4
    expect(computeCriteriaAverage(scores(4, 3, 4, 3, 3))).toBeCloseTo(3.4, 10);
  });

  test('la moyenne affichée est arrondie au dixième', () => {
    expect(roundCriteriaAverage(3.4000000000000004)).toBe(3.4);
    expect(roundCriteriaAverage(4.44)).toBe(4.4);
  });

  test('une note de critère est bornée dans [1, 5] - jamais de 0', () => {
    expect(clampCriterionScore(0)).toBe(1);
    expect(clampCriterionScore(-3)).toBe(1);
    expect(clampCriterionScore(9)).toBe(5);
    expect(clampCriterionScore(3)).toBe(3);
    expect(clampCriterionScore(Number.NaN)).toBe(1);
  });

  test('le bonus de rapidité vaut 3 / 2 / 1 puis rien', () => {
    expect(getSpeedBonus(1)).toBe(3);
    expect(getSpeedBonus(2)).toBe(2);
    expect(getSpeedBonus(3)).toBe(1);
    expect(getSpeedBonus(4)).toBe(0);
    expect(getSpeedBonus(null)).toBe(0);
    expect(getSpeedBonus(undefined)).toBe(0);
  });
});

describe('points d’une soumission', () => {
  test('aucun point à virgule, jamais', () => {
    const cases = [
      { s: scores(4, 3, 4, 3, 3), rank: null, multiplier: 1 },
      { s: scores(5, 4, 5, 4, 4), rank: 1, multiplier: 1 },
      { s: scores(5, 4, 5, 4, 4), rank: 1, multiplier: 1.5 },
      { s: scores(1, 2, 1, 2, 1), rank: 3, multiplier: 1.5 },
      { s: scores(3, 3, 3, 3, 4), rank: 2, multiplier: 1.25 },
    ];

    for (const item of cases) {
      const points = computeSubmissionPoints({
        scores: item.s,
        speedRank: item.rank,
        participationPoints: 1,
        pointsMultiplier: item.multiplier,
      });

      expect(Number.isInteger(points)).toBe(true);
    }
  });

  test('les profils de référence du cahier des charges', () => {
    // Participant moyen (moyenne 3.4), hors podium rapidité : ceil(1 + 3.4) = 5
    expect(computeSubmissionPoints({
      scores: scores(4, 3, 4, 3, 3),
      speedRank: null,
      participationPoints: 1,
      pointsMultiplier: 1,
    })).toBe(5);

    // Bon participant (moyenne 4.4), 1er à soumettre : ceil(1 + 4.4 + 3) = 9
    expect(computeSubmissionPoints({
      scores: scores(5, 4, 5, 4, 4),
      speedRank: 1,
      participationPoints: 1,
      pointsMultiplier: 1,
    })).toBe(9);

    // Le même un samedi : ceil(8.4 × 1.5) = ceil(12.6) = 13
    expect(computeSubmissionPoints({
      scores: scores(5, 4, 5, 4, 4),
      speedRank: 1,
      participationPoints: 1,
      pointsMultiplier: 1.5,
    })).toBe(13);

    // Participant moyen un samedi : ceil(4.4 × 1.5) = ceil(6.6) = 7
    expect(computeSubmissionPoints({
      scores: scores(4, 3, 4, 3, 3),
      speedRank: null,
      participationPoints: 1,
      pointsMultiplier: 1.5,
    })).toBe(7);
  });

  test('les totaux hebdomadaires de référence tombent juste', () => {
    const weekday = (s: DailyAlgoCriteriaScores, rank: number | null) => computeSubmissionPoints({
      scores: s, speedRank: rank, participationPoints: 1, pointsMultiplier: 1,
    });
    const weekend = (s: DailyAlgoCriteriaScores, rank: number | null) => computeSubmissionPoints({
      scores: s, speedRank: rank, participationPoints: 1, pointsMultiplier: 1.5,
    });

    const acharne = scores(5, 4, 5, 4, 4);
    expect(5 * weekday(acharne, 1) + 2 * weekend(acharne, 1)).toBe(71);

    const regulier = scores(4, 3, 4, 3, 3);
    expect(5 * weekday(regulier, null) + 2 * weekend(regulier, null)).toBe(39);

    const occasionnel = scores(3, 3, 3, 3, 3);
    expect(2 * weekday(occasionnel, null)).toBe(8);
  });

  test('un seul arrondi : arrondir avant le multiplicateur gonflerait le total', () => {
    // ceil(4.4 × 1.5) = 7, alors que ceil(4.4) × 1.5 = 7.5 → 8 après arrondi.
    const single = computeSubmissionPoints({
      scores: scores(4, 3, 4, 3, 3),
      speedRank: null,
      participationPoints: 1,
      pointsMultiplier: 1.5,
    });

    expect(single).toBe(7);
    expect(single).toBeLessThan(8);
  });

  test('même mal noté, un participant touche le plancher', () => {
    const points = computeSubmissionPoints({
      scores: scores(1, 1, 1, 1, 1),
      speedRank: null,
      participationPoints: 1,
      pointsMultiplier: 1,
    });

    // 1 (plancher) + 1 (moyenne minimale) = 2
    expect(points).toBe(2);
    expect(points).toBeGreaterThan(0);
  });

  test('le plancher est réglable, y compris à zéro', () => {
    expect(computeSubmissionPoints({
      scores: scores(1, 1, 1, 1, 1), speedRank: null, participationPoints: 0, pointsMultiplier: 1,
    })).toBe(1);

    expect(computeSubmissionPoints({
      scores: scores(1, 1, 1, 1, 1), speedRank: null, participationPoints: 5, pointsMultiplier: 1,
    })).toBe(6);
  });

  test('un multiplicateur absent ou aberrant vaut 1', () => {
    expect(normalizeMultiplier(undefined)).toBe(1);
    expect(normalizeMultiplier(null)).toBe(1);
    expect(normalizeMultiplier(0)).toBe(1);
    expect(normalizeMultiplier(-2)).toBe(1);
    expect(normalizeMultiplier(Number.NaN)).toBe(1);
    expect(normalizeMultiplier(1.5)).toBe(1.5);
  });
});

describe('conversion vers les points de clan', () => {
  test('1 pour 1 par défaut', () => {
    expect(convertToClanPoints(39, 1)).toBe(39);
    expect(convertToClanPoints(71, undefined)).toBe(71);
    expect(convertToClanPoints(8, null)).toBe(8);
  });

  test('un taux fractionnaire reste entier, arrondi à l’unité supérieure', () => {
    expect(convertToClanPoints(39, 0.5)).toBe(20); // 19.5 → 20
    expect(convertToClanPoints(71, 0.5)).toBe(36); // 35.5 → 36
    expect(convertToClanPoints(10, 2)).toBe(20);
  });

  test('zéro point ne donne rien', () => {
    expect(convertToClanPoints(0, 1)).toBe(0);
    expect(convertToClanPoints(-5, 1)).toBe(0);
  });
});

describe('fuseau horaire du serveur', () => {
  test('la journée est celle du fuseau, pas celle d’UTC', () => {
    // 22:30 UTC un dimanche = 00:30 le lundi à Paris (UTC+2 en été).
    const instant = new Date('2026-07-26T22:30:00Z');

    expect(getZonedDateKey(instant, PARIS)).toBe('2026-07-27');
    expect(getZonedDateKey(instant, 'UTC')).toBe('2026-07-26');
  });

  test('le week-end est déterminé dans le fuseau du serveur', () => {
    // Dimanche 22:30 UTC = lundi à Paris : ce n’est plus le week-end.
    const instant = new Date('2026-07-26T22:30:00Z');

    expect(isWeekend(instant, 'UTC')).toBe(true);
    expect(isWeekend(instant, PARIS)).toBe(false);
  });

  test('samedi et dimanche comptent comme week-end', () => {
    expect(isWeekend(new Date('2026-07-25T12:00:00Z'), PARIS)).toBe(true); // samedi
    expect(isWeekend(new Date('2026-07-26T12:00:00Z'), PARIS)).toBe(true); // dimanche
    expect(isWeekend(new Date('2026-07-27T12:00:00Z'), PARIS)).toBe(false); // lundi
    expect(isWeekend(new Date('2026-07-31T12:00:00Z'), PARIS)).toBe(false); // vendredi
  });

  test('le jour ISO va de 1 (lundi) à 7 (dimanche)', () => {
    expect(getZonedIsoWeekday(new Date('2026-07-27T12:00:00Z'), PARIS)).toBe(1);
    expect(getZonedIsoWeekday(new Date('2026-08-02T12:00:00Z'), PARIS)).toBe(7);
  });

  test('un fuseau invalide retombe sur UTC au lieu de planter', () => {
    const instant = new Date('2026-07-26T22:30:00Z');
    expect(getZonedDateKey(instant, 'Pas/UnFuseau')).toBe('2026-07-26');
  });

  test('le multiplicateur de run est figé selon le fuseau', () => {
    expect(resolveRunMultiplier({
      date: new Date('2026-07-25T12:00:00Z'), timeZone: PARIS, weekendMultiplier: 1.5,
    })).toBe(1.5);

    expect(resolveRunMultiplier({
      date: new Date('2026-07-27T12:00:00Z'), timeZone: PARIS, weekendMultiplier: 1.5,
    })).toBe(1);

    // Dimanche soir UTC, déjà lundi à Paris → pas de majoration.
    expect(resolveRunMultiplier({
      date: new Date('2026-07-26T22:30:00Z'), timeZone: PARIS, weekendMultiplier: 1.5,
    })).toBe(1);
  });
});

describe('semaines ISO', () => {
  test('clés de semaine sur des cas connus', () => {
    // Le 1er janvier 2026 est un jeudi : semaine 1 de 2026.
    expect(getWeekKey(new Date('2026-01-01T12:00:00Z'), 'UTC')).toBe('2026-W01');
    // Le 1er janvier 2021 est un vendredi : il appartient à la semaine 53 de 2020.
    expect(getWeekKey(new Date('2021-01-01T12:00:00Z'), 'UTC')).toBe('2020-W53');
    // Le 30 décembre 2024 est un lundi : il ouvre la semaine 1 de 2025.
    expect(getWeekKey(new Date('2024-12-30T12:00:00Z'), 'UTC')).toBe('2025-W01');
    expect(getWeekKey(new Date('2026-12-31T12:00:00Z'), 'UTC')).toBe('2026-W53');
    expect(getWeekKey(new Date('2026-07-25T12:00:00Z'), 'UTC')).toBe('2026-W30');
    expect(getWeekKey(new Date('2026-07-27T12:00:00Z'), 'UTC')).toBe('2026-W31');
  });

  test('la clé de semaine dépend du fuseau', () => {
    // Dimanche 22:30 UTC (semaine 30) = lundi à Paris (semaine 31).
    const instant = new Date('2026-07-26T22:30:00Z');

    expect(getWeekKey(instant, 'UTC')).toBe('2026-W30');
    expect(getWeekKey(instant, PARIS)).toBe('2026-W31');
  });

  test('les clés de journée d’une semaine vont du lundi au dimanche', () => {
    expect(getWeekDateKeys('2026-W31')).toEqual({
      firstDateKey: '2026-07-27',
      lastDateKey: '2026-08-02',
    });

    expect(getWeekDateKeys('2025-W01')).toEqual({
      firstDateKey: '2024-12-30',
      lastDateKey: '2025-01-05',
    });

    expect(getWeekDateKeys('2020-W53')).toEqual({
      firstDateKey: '2020-12-28',
      lastDateKey: '2021-01-03',
    });
  });

  test('les clés de journée sont triables comme des chaînes', () => {
    const { firstDateKey, lastDateKey } = getWeekDateKeys('2026-W31');

    expect(firstDateKey < lastDateKey).toBe(true);
    expect('2026-07-30' >= firstDateKey && '2026-07-30' <= lastDateKey).toBe(true);
    expect('2026-08-03' <= lastDateKey).toBe(false);
  });

  test('les bornes d’une semaine tiennent compte du fuseau', () => {
    const bounds = getWeekBounds('2026-W31', PARIS);

    // Lundi 00:00 à Paris = dimanche 22:00 UTC (UTC+2 en été).
    expect(bounds.startsAt.toISOString()).toBe('2026-07-26T22:00:00.000Z');
    // Dimanche 23:59:59 à Paris = 21:59:59 UTC.
    expect(bounds.endsAt.toISOString()).toBe('2026-08-02T21:59:59.000Z');
    expect(bounds.startsAt.getTime()).toBeLessThan(bounds.endsAt.getTime());
  });

  test('les bornes restent correctes de part et d’autre du changement d’heure', () => {
    // L’heure d’été 2026 commence le dimanche 29 mars en Europe.
    // Semaine 13 : lundi 23 mars, encore en UTC+1.
    expect(getWeekBounds('2026-W13', PARIS).startsAt.toISOString())
      .toBe('2026-03-22T23:00:00.000Z');

    // Semaine 14 : lundi 30 mars, déjà en UTC+2.
    expect(getWeekBounds('2026-W14', PARIS).startsAt.toISOString())
      .toBe('2026-03-29T22:00:00.000Z');
  });

  test('en UTC les bornes sont minuit pile', () => {
    const bounds = getWeekBounds('2026-W31', 'UTC');

    expect(bounds.startsAt.toISOString()).toBe('2026-07-27T00:00:00.000Z');
    expect(bounds.endsAt.toISOString()).toBe('2026-08-02T23:59:59.000Z');
  });

  test('semaine précédente, y compris au passage d’année', () => {
    expect(getPreviousWeekKey('2026-W31')).toBe('2026-W30');
    expect(getPreviousWeekKey('2026-W01')).toBe('2025-W52');
    expect(getPreviousWeekKey('2021-W01')).toBe('2020-W53');
  });

  test('validation du format de clé', () => {
    expect(isValidWeekKey('2026-W31')).toBe(true);
    expect(isValidWeekKey('2026-W01')).toBe(true);
    expect(isValidWeekKey('2026-31')).toBe(false);
    expect(isValidWeekKey('26-W31')).toBe(false);
    expect(isValidWeekKey('')).toBe(false);
  });

  test('libellé lisible d’une semaine', () => {
    expect(formatWeekRangeLabel('2026-W31')).toBe('du 27 juillet au 2 août 2026');
  });

  test('aller-retour clé de semaine → bornes → clé de semaine', () => {
    for (const weekKey of ['2026-W01', '2026-W13', '2026-W14', '2026-W31', '2026-W53', '2020-W53']) {
      const { startsAt, endsAt } = getWeekBounds(weekKey, PARIS);

      expect(getWeekKey(startsAt, PARIS)).toBe(weekKey);
      expect(getWeekKey(endsAt, PARIS)).toBe(weekKey);
    }
  });
});
