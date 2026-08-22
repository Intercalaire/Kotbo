/**
 * Règles de mise, de crédit et de remboursement des paris en points de clan.
 *
 * Ces fonctions décident combien de points changent de mains : une erreur ici
 * fabrique ou détruit des points de clan sans que rien ne le signale.
 */
import { describe, expect, test } from 'bun:test';
import {
  applyDebtRepayment,
  checkStake,
  normalizeClanBetSettings,
  planStakeFunding,
  BET_DEBT_CEILING,
  BET_STAKE_CEILING,
  DEFAULT_CLAN_BET_SETTINGS,
  computeBetPot,
  computeBetNetGain,
  betSideStake,
  buildBettorStandings,
  normalizeBetSubject,
  buildBetThreadName,
} from '@kotbo/shared';

describe('normalisation des réglages', () => {
  test('réordonne des mises saisies à l\'envers plutôt que de les refuser', () => {
    const settings = normalizeClanBetSettings({ betMinStake: 900, betMaxStake: 100 });
    expect(settings.betMinStake).toBe(100);
    expect(settings.betMaxStake).toBe(900);
  });

  test('ramène les valeurs hors bornes dans leur intervalle', () => {
    const settings = normalizeClanBetSettings({
      betMinStake: 0,
      betMaxStake: BET_STAKE_CEILING * 10,
      betMaxOpenPerMember: 0,
      betAcceptWindowHours: 100_000,
      betMaxDebt: -5,
    });
    expect(settings.betMinStake).toBe(1);
    expect(settings.betMaxStake).toBe(BET_STAKE_CEILING);
    expect(settings.betMaxOpenPerMember).toBe(1);
    expect(settings.betAcceptWindowHours).toBe(720);
    expect(settings.betMaxDebt).toBe(0);
  });

  test('une absence de réglage retombe sur les valeurs par défaut', () => {
    expect(normalizeClanBetSettings(null)).toEqual(DEFAULT_CLAN_BET_SETTINGS);
  });
});

describe('contrôle de la mise', () => {
  const settings = { betMinStake: 10, betMaxStake: 500 };

  test('accepte une mise dans les bornes du serveur', () => {
    expect(checkStake(100, settings)).toEqual({ ok: true, stake: 100 });
    expect(checkStake(10, settings)).toEqual({ ok: true, stake: 10 });
    expect(checkStake(500, settings)).toEqual({ ok: true, stake: 500 });
  });

  test('refuse hors bornes et hors entiers', () => {
    expect(checkStake(9, settings)).toMatchObject({ ok: false, reason: 'below-min' });
    expect(checkStake(501, settings)).toMatchObject({ ok: false, reason: 'above-max' });
    expect(checkStake(10.5, settings)).toMatchObject({ ok: false, reason: 'not-integer' });
  });
});

describe('financement de la mise', () => {
  const base = { allowDebt: false, maxDebt: 0, currentDebt: 0 };

  test('une mise couverte ne touche jamais au crédit', () => {
    expect(planStakeFunding({ ...base, stake: 100, availablePoints: 300 }))
      .toEqual({ ok: true, fromPoints: 100, fromDebt: 0 });
  });

  test('sans mode dette, un solde insuffisant refuse le pari', () => {
    expect(planStakeFunding({ ...base, stake: 300, availablePoints: 100 }))
      .toEqual({ ok: false, reason: 'insufficient-points', available: 100 });
  });

  test('avec le mode dette, les points partent avant le crédit', () => {
    expect(planStakeFunding({ stake: 300, availablePoints: 100, allowDebt: true, maxDebt: 1000, currentDebt: 0 }))
      .toEqual({ ok: true, fromPoints: 100, fromDebt: 200 });
  });

  test('le plafond de dette tient compte de ce qui est déjà dû', () => {
    const plan = planStakeFunding({ stake: 300, availablePoints: 0, allowDebt: true, maxDebt: 500, currentDebt: 400 });
    expect(plan).toEqual({ ok: false, reason: 'debt-ceiling', available: 0, maxDebt: 500, currentDebt: 400 });
  });

  // Le cas qui motive la réserve sur les paris en attente : un membre à 100
  // points a bien de quoi tenir chaque défi pris isolément, mais pas les deux.
  test('les points déjà promis à un pari en attente ne sont plus disponibles', () => {
    const points = 100;
    const alreadyCommitted = 100;

    expect(planStakeFunding({ ...base, stake: 100, availablePoints: points }))
      .toEqual({ ok: true, fromPoints: 100, fromDebt: 0 });
    expect(planStakeFunding({ ...base, stake: 100, availablePoints: points - alreadyCommitted }))
      .toEqual({ ok: false, reason: 'insufficient-points', available: 0 });
  });

  test('un solde négatif est traité comme un solde vide', () => {
    expect(planStakeFunding({ stake: 50, availablePoints: -200, allowDebt: true, maxDebt: 1000, currentDebt: 0 }))
      .toEqual({ ok: true, fromPoints: 0, fromDebt: 50 });
  });
});

describe('remboursement de la dette', () => {
  test('un gain plus petit que la dette part entièrement au remboursement', () => {
    expect(applyDebtRepayment(80, 200)).toEqual({ repaid: 80, credited: 0, remainingDebt: 120 });
  });

  test('un gain plus grand solde la dette et crédite le reste', () => {
    expect(applyDebtRepayment(300, 200)).toEqual({ repaid: 200, credited: 100, remainingDebt: 0 });
  });

  test('sans dette, le gain passe intact', () => {
    expect(applyDebtRepayment(300, 0)).toEqual({ repaid: 0, credited: 300, remainingDebt: 0 });
  });

  test('le plafond de dette reste sous l\'entier 32 bits de Postgres', () => {
    expect(BET_DEBT_CEILING).toBeLessThan(2_147_483_647);
  });
});

describe('enjeu du pot', () => {
  test('additionne les prélèvements et les parts à crédit des deux côtés', () => {
    expect(computeBetPot({ challengerEscrow: 100, opponentEscrow: 300, challengerDebt: 200, opponentDebt: 0 }))
      .toBe(600);
  });

  test('un pari sans crédit vaut deux fois ce qui a été prélevé', () => {
    expect(computeBetPot({ challengerEscrow: 250, opponentEscrow: 250, challengerDebt: 0, opponentDebt: 0 }))
      .toBe(500);
  });

  test('ignore des colonnes négatives plutôt que de rogner le pot', () => {
    expect(computeBetPot({ challengerEscrow: -50, opponentEscrow: 100, challengerDebt: 0, opponentDebt: 0 }))
      .toBe(100);
  });
});

describe('gain net annoncé', () => {
  // Le cas de tous les jours : 100 chacun, pas de crédit. Le gagnant récupère sa
  // mise et empoche celle de l'autre, donc +100, pas +200.
  const plain = { challengerEscrow: 100, opponentEscrow: 100, challengerDebt: 0, opponentDebt: 0 };

  test('le gagnant gagne exactement la mise de l\'adversaire', () => {
    expect(computeBetNetGain(plain, 'challenger')).toBe(100);
    expect(computeBetNetGain(plain, 'opponent')).toBe(100);
  });

  test('ce que l\'un gagne est ce que l\'autre perd', () => {
    expect(computeBetNetGain(plain, 'challenger')).toBe(betSideStake(plain, 'opponent'));
  });

  test('une mise à crédit vaut la même chose qu\'une mise en points', () => {
    const onCredit = { challengerEscrow: 0, opponentEscrow: 100, challengerDebt: 100, opponentDebt: 0 };
    expect(computeBetNetGain(onCredit, 'challenger')).toBe(100);
    expect(computeBetNetGain(onCredit, 'opponent')).toBe(100);
  });
});

describe('palmarès des parieurs', () => {
  /** Pari de 100 chacun, en points, tranché à la date donnée. */
  const bet = (challengerId: string, opponentId: string, winnerId: string, day: number) => ({
    challengerId,
    opponentId,
    winnerId,
    challengerEscrow: 100,
    opponentEscrow: 100,
    challengerDebt: 0,
    opponentDebt: 0,
    resolvedAt: new Date(Date.UTC(2026, 0, day)),
  });

  test('une victoire rapporte la mise de l\'adversaire, pas le pot', () => {
    const [first] = buildBettorStandings([bet('a', 'b', 'a', 1)]);
    expect(first).toMatchObject({ userId: 'a', wins: 1, losses: 0, netGain: 100 });
  });

  test('les gains des uns sont exactement les pertes des autres', () => {
    const standings = buildBettorStandings([bet('a', 'b', 'a', 1), bet('a', 'c', 'c', 2)]);
    expect(standings.reduce((sum, s) => sum + s.netGain, 0)).toBe(0);
  });

  test('compte les séries dans l\'ordre des verdicts, pas celui de la source', () => {
    // Volontairement mélangé : a gagne les jours 1, 2 et 4, perd le jour 3.
    const standings = buildBettorStandings([
      bet('a', 'b', 'a', 4),
      bet('a', 'b', 'a', 1),
      bet('a', 'b', 'b', 3),
      bet('a', 'b', 'a', 2),
    ]);
    const a = standings.find((s) => s.userId === 'a');
    expect(a).toMatchObject({ wins: 3, losses: 1, bestStreak: 2, currentStreak: 1 });
  });

  test('une mise à crédit perdue compte comme une perte réelle', () => {
    const onCredit = {
      challengerId: 'a', opponentId: 'b', winnerId: 'b',
      challengerEscrow: 0, opponentEscrow: 100, challengerDebt: 100, opponentDebt: 0,
      resolvedAt: new Date(Date.UTC(2026, 0, 1)),
    };
    const standings = buildBettorStandings([onCredit]);
    expect(standings.find((s) => s.userId === 'a')?.netGain).toBe(-100);
    expect(standings.find((s) => s.userId === 'b')?.netGain).toBe(100);
  });

  test('classe par gain net, puis par victoires', () => {
    const standings = buildBettorStandings([bet('a', 'b', 'a', 1), bet('c', 'd', 'c', 2)]);
    expect(standings[0].netGain).toBeGreaterThanOrEqual(standings[1].netGain);
    expect(standings.at(-1)?.netGain).toBeLessThan(0);
  });
});

describe('mise en forme', () => {
  test('le sujet est aplati sur une seule ligne', () => {
    expect(normalizeBetSubject('  qui   gagne\nle match  ')).toBe('qui gagne le match');
  });

  test('le nom du fil tient dans les 100 caractères de Discord', () => {
    expect(buildBetThreadName('x'.repeat(300))).toHaveLength(100);
    expect(buildBetThreadName('duel')).toBe('Pari - duel');
  });
});
