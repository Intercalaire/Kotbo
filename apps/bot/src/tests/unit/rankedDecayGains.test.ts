import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DECAY_CONFIG,
  applyRpMultipliers,
  computeRankedDecay,
  computeRpGain,
  computeScheduledDecay,
  eventAppliesToSource,
  grantedWithinDailyRpCap,
  rpFromXp,
  type DecayConfig,
} from '@kotbo/shared';

const FLAT: DecayConfig = { enabled: true, graceDays: 3, rpPerDay: 25, percentPerDay: 0, floorRp: 0 };

describe('computeRankedDecay', () => {
  test('ne retire rien pendant le delai de grace', () => {
    expect(computeRankedDecay(1000, 3, FLAT).lost).toBe(0);
    expect(computeRankedDecay(1000, 0, FLAT).lost).toBe(0);
  });

  test('facture chaque jour au-dela du delai de grace', () => {
    expect(computeRankedDecay(1000, 4, FLAT).lost).toBe(25);
    expect(computeRankedDecay(1000, 8, FLAT).lost).toBe(125);
  });

  test('ne descend jamais sous le plancher ni sous zero', () => {
    const floored = computeRankedDecay(500, 100, { ...FLAT, floorRp: 400 });
    expect(floored.newRp).toBe(400);

    const zero = computeRankedDecay(40, 100, FLAT);
    expect(zero.newRp).toBe(0);
    expect(zero.lost).toBe(40);
  });

  test('un decay desactive est un no-op', () => {
    const outcome = computeRankedDecay(1000, 30, { ...FLAT, enabled: false });
    expect(outcome.newRp).toBe(1000);
    expect(outcome.daysApplied).toBe(0);
  });

  test('sans perte configuree, rien ne bouge', () => {
    expect(computeRankedDecay(1000, 30, { ...FLAT, rpPerDay: 0, percentPerDay: 0 }).lost).toBe(0);
  });

  test('la part proportionnelle est composee jour par jour, pas multipliee en bloc', () => {
    const config: DecayConfig = { enabled: true, graceDays: 0, rpPerDay: 0, percentPerDay: 0.1, floorRp: 0 };

    const twoDaysAtOnce = computeRankedDecay(1000, 2, config).newRp;
    const dayOne = computeRankedDecay(1000, 1, config).newRp;
    const dayTwo = computeRankedDecay(dayOne, 1, config).newRp;

    expect(twoDaysAtOnce).toBe(dayTwo);
    // 10 % compose deux fois retire moins que 20 % d'un coup.
    expect(twoDaysAtOnce).toBeGreaterThan(800);
  });

  test('un membre deja sous le plancher est laisse tranquille', () => {
    expect(computeRankedDecay(300, 90, { ...FLAT, floorRp: 400 }).lost).toBe(0);
  });
});

describe('computeScheduledDecay', () => {
  const config: DecayConfig = { ...DEFAULT_DECAY_CONFIG, enabled: true, graceDays: 3, rpPerDay: 25, percentPerDay: 0 };

  test('ne facture pas deux fois le meme jour', () => {
    const outcome = computeScheduledDecay(
      { rp: 1000, lastActiveDate: '2026-08-01', lastDecayDate: '2026-08-13', today: '2026-08-13' },
      config,
    );
    expect(outcome.lost).toBe(0);
  });

  test('facture les jours ecoules depuis la derniere facturation', () => {
    const outcome = computeScheduledDecay(
      { rp: 1000, lastActiveDate: '2026-08-01', lastDecayDate: '2026-08-10', today: '2026-08-13' },
      config,
    );
    expect(outcome.lost).toBe(75);
  });

  test('sans facturation connue, ne rattrape pas tout l historique', () => {
    // Un serveur qui active le decay aujourd'hui ne doit pas amputer d'un coup
    // ses membres absents depuis un an.
    const outcome = computeScheduledDecay(
      { rp: 10_000, lastActiveDate: '2025-08-13', lastDecayDate: null, today: '2026-08-13' },
      config,
    );
    expect(outcome.lost).toBe(25);
  });

  test('un membre encore dans le delai de grace ne perd rien', () => {
    const outcome = computeScheduledDecay(
      { rp: 1000, lastActiveDate: '2026-08-11', lastDecayDate: null, today: '2026-08-13' },
      config,
    );
    expect(outcome.lost).toBe(0);
  });

  test('sans date d activite connue, rien n est facture', () => {
    const outcome = computeScheduledDecay(
      { rp: 1000, lastActiveDate: null, lastDecayDate: null, today: '2026-08-13' },
      config,
    );
    expect(outcome.lost).toBe(0);
    expect(outcome.newRp).toBe(1000);
  });
});

describe('rpFromXp', () => {
  test('convertit l XP accordee au taux configure', () => {
    expect(rpFromXp(100, 0.35)).toBe(35);
  });

  test('garantit au moins 1 RP pour un gain d XP reel', () => {
    // Sinon un taux bas rendrait tout gain nul par troncature et le classement
    // paraitrait casse.
    expect(rpFromXp(3, 0.1)).toBe(1);
  });

  test('un taux nul ou une XP nulle ne donne rien', () => {
    expect(rpFromXp(100, 0)).toBe(0);
    expect(rpFromXp(0, 0.35)).toBe(0);
    expect(rpFromXp(Number.NaN, 0.35)).toBe(0);
  });
});

describe('applyRpMultipliers / computeRpGain', () => {
  test('cumule serie et evenement', () => {
    expect(applyRpMultipliers(100, { streak: 1.5, event: 2 })).toBe(300);
  });

  test('des multiplicateurs invalides retombent sur du neutre', () => {
    expect(applyRpMultipliers(100, { streak: Number.NaN, event: Number.NaN })).toBe(100);
  });

  test('la chaine complete donne le meme chiffre au bot et au dashboard', () => {
    const gain = computeRpGain({ xpGranted: 100, rpPerXp: 0.5, streakDays: 5, eventMultiplier: 2 });
    expect(gain.baseRp).toBe(50);
    expect(gain.streakMult).toBeCloseTo(1.2, 5);
    expect(gain.finalRp).toBe(120);
  });
});

describe('grantedWithinDailyRpCap', () => {
  test('laisse passer tant que le plafond n est pas atteint', () => {
    expect(grantedWithinDailyRpCap(80, 30, 100)).toBe(30);
  });

  test('ne rend que la part restante en cas de depassement', () => {
    expect(grantedWithinDailyRpCap(110, 30, 100)).toBe(20);
    expect(grantedWithinDailyRpCap(200, 30, 100)).toBe(0);
  });

  test('un plafond nul veut dire illimite', () => {
    expect(grantedWithinDailyRpCap(9999, 30, 0)).toBe(30);
  });
});

describe('eventAppliesToSource', () => {
  test('un Message Rush ne double pas le RP vocal', () => {
    expect(eventAppliesToSource('MESSAGE_RUSH', 'text')).toBe(true);
    expect(eventAppliesToSource('MESSAGE_RUSH', 'voice')).toBe(false);
    expect(eventAppliesToSource('MESSAGE_RUSH', 'reaction')).toBe(false);
  });

  test('chaque type cible sa propre source', () => {
    expect(eventAppliesToSource('REACTION_STORM', 'reaction')).toBe(true);
    expect(eventAppliesToSource('VOCAL_TIME', 'voice')).toBe(true);
    expect(eventAppliesToSource('VOCAL_TIME', 'text')).toBe(false);
  });

  test('un evenement personnalise couvre les trois sources d activite', () => {
    expect(eventAppliesToSource('CUSTOM', 'text')).toBe(true);
    expect(eventAppliesToSource('CUSTOM', 'voice')).toBe(true);
    expect(eventAppliesToSource('CUSTOM', 'reaction')).toBe(true);
  });

  test('jamais applique aux mouvements qui ne sont pas de l activite', () => {
    expect(eventAppliesToSource('CUSTOM', 'manual')).toBe(false);
    expect(eventAppliesToSource('CUSTOM', 'decay')).toBe(false);
  });
});
