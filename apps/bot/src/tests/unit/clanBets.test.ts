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
  engagedAmount,
  splitPot,
  memberStakeAt,
  sideOdds,
  allowedBetShapes,
  parseBetSides,
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

  // Les mises étant prélevées à l'entrée, le second pari se heurte au solde réel
  // du membre : il n'y a plus de promesse à réserver, les points sont partis.
  test('une mise déjà engagée ailleurs a quitté le solde', () => {
    expect(planStakeFunding({ ...base, stake: 100, availablePoints: 100 }))
      .toEqual({ ok: true, fromPoints: 100, fromDebt: 0 });
    expect(planStakeFunding({ ...base, stake: 100, availablePoints: 0 }))
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

describe('mise individuelle selon le mode', () => {
  test('en mise par personne, la capacité du camp ne change rien', () => {
    expect(memberStakeAt({ stake: 100, stakeMode: 'PER_MEMBER', capacity: 3, index: 0 })).toBe(100);
    expect(memberStakeAt({ stake: 100, stakeMode: 'PER_MEMBER', capacity: 3, index: 2 })).toBe(100);
  });

  test('en mise par camp, le total se divise entre les places', () => {
    const stakes = [0, 1, 2].map((index) => memberStakeAt({ stake: 90, stakeMode: 'PER_SIDE', capacity: 3, index }));
    expect(stakes).toEqual([30, 30, 30]);
  });

  // Le reste va aux premières places, qui touchent aussi davantage au partage :
  // les deux suivent le même prorata et se compensent.
  test('un total indivisible ne perd ni ne crée de point', () => {
    const stakes = [0, 1, 2].map((index) => memberStakeAt({ stake: 100, stakeMode: 'PER_SIDE', capacity: 3, index }));
    expect(stakes).toEqual([34, 33, 33]);
    expect(stakes.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  test('un camp d\'une seule place engage le total', () => {
    expect(memberStakeAt({ stake: 100, stakeMode: 'PER_SIDE', capacity: 1, index: 0 })).toBe(100);
  });
});

describe('enjeu du pot', () => {
  test('additionne les prélèvements et les parts à crédit de tous les camps', () => {
    expect(computeBetPot([
      { escrow: 100, debt: 200 },
      { escrow: 300, debt: 0 },
    ])).toBe(600);
  });

  test('un pari sans crédit vaut la somme de ce qui a été prélevé', () => {
    expect(computeBetPot([{ escrow: 250, debt: 0 }, { escrow: 250, debt: 0 }])).toBe(500);
  });

  test('ignore des colonnes négatives plutôt que de rogner le pot', () => {
    expect(computeBetPot([{ escrow: -50, debt: 0 }, { escrow: 100, debt: 0 }])).toBe(100);
  });

  test('une mise à crédit pèse autant qu\'une mise en points', () => {
    expect(engagedAmount({ escrow: 0, debt: 100 })).toBe(engagedAmount({ escrow: 100, debt: 0 }));
  });
});

describe('partage du pot', () => {
  const evenly = (count: number, stake = 100) =>
    Array.from({ length: count }, (_, i) => ({ userKey: `p${i}`, escrow: stake, debt: 0 }));

  test('un gagnant unique rafle tout le pot', () => {
    expect(splitPot(200, [{ userKey: 'a', escrow: 100, debt: 0 }])).toEqual([{ userKey: 'a', payout: 200 }]);
  });

  // Le duel d'aujourd'hui : chacun a mis 100, le gagnant reçoit 200 et donc
  // gagne 100 net, exactement ce que l'autre perd.
  test('le duel garde son compte : le gagnant touche deux mises', () => {
    const [winner] = splitPot(200, [{ userKey: 'a', escrow: 100, debt: 0 }]);
    expect(winner.payout - 100).toBe(100);
  });

  test('un camp de trois se partage le pot à parts égales', () => {
    expect(splitPot(300, evenly(3))).toEqual([
      { userKey: 'p0', payout: 100 },
      { userKey: 'p1', payout: 100 },
      { userKey: 'p2', payout: 100 },
    ]);
  });

  // Le cas 1 contre 3 : le camp de trois a mis 300, le solitaire 100. S'il perd,
  // les trois se partagent 400.
  test('le reste d\'une division inégale va aux premiers inscrits', () => {
    const shares = splitPot(400, evenly(3));
    expect(shares.map((s) => s.payout)).toEqual([134, 133, 133]);
  });

  test('le versement total vaut toujours exactement le pot', () => {
    for (const [pot, count] of [[400, 3], [1000, 7], [17, 5], [1, 4], [999_999, 13]] as const) {
      const total = splitPot(pot, evenly(count)).reduce((sum, s) => sum + s.payout, 0);
      expect(total).toBe(pot);
    }
  });

  test('le partage suit l\'engagement réel, pas le nombre de têtes', () => {
    // Le plafond de saison a rogné le prélèvement du second : il a engagé moitié
    // moins, il touche moitié moins.
    const shares = splitPot(300, [
      { userKey: 'a', escrow: 100, debt: 0 },
      { userKey: 'b', escrow: 50, debt: 0 },
    ]);
    expect(shares).toEqual([{ userKey: 'a', payout: 200 }, { userKey: 'b', payout: 100 }]);
  });

  test('un camp qui n\'a rien pu engager partage tout de même le pot', () => {
    const shares = splitPot(100, [
      { userKey: 'a', escrow: 0, debt: 0 },
      { userKey: 'b', escrow: 0, debt: 0 },
    ]);
    expect(shares.reduce((sum, s) => sum + s.payout, 0)).toBe(100);
  });

  test('sans gagnant, rien n\'est versé', () => {
    expect(splitPot(500, [])).toEqual([]);
  });
});

describe('cote affichée', () => {
  test('un camp en sous-nombre paie davantage', () => {
    // 1 contre 3, 100 chacun : le solitaire touche 4 fois sa mise, les autres
    // 1,33 fois la leur.
    expect(sideOdds(100, 400)).toBe(4);
    expect(sideOdds(300, 400)).toBeCloseTo(1.333, 3);
  });

  test('deux camps équilibrés paient le double de la mise', () => {
    expect(sideOdds(100, 200)).toBe(2);
  });

  test('un camp vide n\'a pas de cote', () => {
    expect(sideOdds(0, 200)).toBe(0);
  });
});

describe('formes autorisées', () => {
  test('le duel reste ouvert même tout éteint', () => {
    expect(allowedBetShapes({ betAllowPool: false, betAllowTeams: false })).toEqual(['DUEL']);
  });

  test('les réglages ouvrent les formes une à une', () => {
    expect(allowedBetShapes({ betAllowPool: true, betAllowTeams: false })).toEqual(['DUEL', 'POOL']);
    expect(allowedBetShapes({ betAllowPool: true, betAllowTeams: true })).toEqual(['DUEL', 'POOL', 'TEAMS']);
  });
});

describe('palmarès des parieurs', () => {
  /** Duel de 100 chacun, en points, tranché à la date donnée. */
  const duel = (winnerId: string, loserId: string, day: number) => ({
    entries: [
      { userId: winnerId, engaged: 100, payout: 200, won: true },
      { userId: loserId, engaged: 100, payout: 0, won: false },
    ],
    resolvedAt: new Date(Date.UTC(2026, 0, day)),
  });

  test('une victoire rapporte la mise de l\'adversaire, pas le pot', () => {
    const [first] = buildBettorStandings([duel('a', 'b', 1)]);
    expect(first).toMatchObject({ userId: 'a', wins: 1, losses: 0, netGain: 100 });
  });

  test('les gains des uns sont exactement les pertes des autres', () => {
    const standings = buildBettorStandings([duel('a', 'b', 1), duel('c', 'a', 2)]);
    expect(standings.reduce((sum, s) => sum + s.netGain, 0)).toBe(0);
  });

  test('compte les séries dans l\'ordre des verdicts, pas celui de la source', () => {
    // Volontairement mélangé : a gagne les jours 1, 2 et 4, perd le jour 3.
    const standings = buildBettorStandings([
      duel('a', 'b', 4),
      duel('a', 'b', 1),
      duel('b', 'a', 3),
      duel('a', 'b', 2),
    ]);
    expect(standings.find((s) => s.userId === 'a')).toMatchObject({
      wins: 3, losses: 1, bestStreak: 2, currentStreak: 1,
    });
  });

  test('une mise à crédit perdue compte comme une perte réelle', () => {
    const standings = buildBettorStandings([{
      entries: [
        { userId: 'a', engaged: 100, payout: 0, won: false },
        { userId: 'b', engaged: 100, payout: 200, won: true },
      ],
      resolvedAt: new Date(Date.UTC(2026, 0, 1)),
    }]);
    expect(standings.find((s) => s.userId === 'a')?.netGain).toBe(-100);
    expect(standings.find((s) => s.userId === 'b')?.netGain).toBe(100);
  });

  test('un pari à plusieurs camps reste à somme nulle', () => {
    // 1 contre 3, 100 chacun : le solitaire l'emporte et rafle 400.
    const standings = buildBettorStandings([{
      entries: [
        { userId: 'seul', engaged: 100, payout: 400, won: true },
        { userId: 'x', engaged: 100, payout: 0, won: false },
        { userId: 'y', engaged: 100, payout: 0, won: false },
        { userId: 'z', engaged: 100, payout: 0, won: false },
      ],
      resolvedAt: new Date(Date.UTC(2026, 0, 1)),
    }]);
    expect(standings.find((s) => s.userId === 'seul')?.netGain).toBe(300);
    expect(standings.reduce((sum, s) => sum + s.netGain, 0)).toBe(0);
  });

  test('un camp gagnant à plusieurs compte une victoire pour chacun', () => {
    const standings = buildBettorStandings([{
      entries: [
        { userId: 'x', engaged: 100, payout: 134, won: true },
        { userId: 'y', engaged: 100, payout: 133, won: true },
        { userId: 'z', engaged: 100, payout: 133, won: true },
        { userId: 'seul', engaged: 100, payout: 0, won: false },
      ],
      resolvedAt: new Date(Date.UTC(2026, 0, 1)),
    }]);
    expect(standings.filter((s) => s.wins === 1)).toHaveLength(3);
    expect(standings.find((s) => s.userId === 'x')?.netGain).toBe(34);
    expect(standings.reduce((sum, s) => sum + s.netGain, 0)).toBe(0);
  });

  test('classe par gain net, puis par victoires', () => {
    const standings = buildBettorStandings([duel('a', 'b', 1), duel('c', 'd', 2)]);
    expect(standings[0].netGain).toBeGreaterThanOrEqual(standings[1].netGain);
    expect(standings.at(-1)?.netGain).toBeLessThan(0);
  });
});

describe('comptes lies replies sur un seul parieur', () => {
  const duel = (winnerId: string, loserId: string, day: number) => ({
    entries: [
      { userId: winnerId, engaged: 100, payout: 200, won: true },
      { userId: loserId, engaged: 100, payout: 0, won: false },
    ],
    resolvedAt: new Date(Date.UTC(2026, 0, day)),
  });

  // Le principal gagne le jour 1, le double compte gagne le jour 2, contre deux
  // adversaires differents. Sans repli, on lit deux parieurs a une victoire ;
  // avec, une seule personne a deux victoires d'affilee.
  const brut = [duel('principal', 'x', 1), duel('double', 'y', 2)];
  const replie = brut.map((bet) => ({
    ...bet,
    entries: bet.entries.map((e) => ({ ...e, userId: e.userId === 'double' ? 'principal' : e.userId })),
  }));

  test('sans repli, la personne compte pour deux parieurs', () => {
    const standings = buildBettorStandings(brut);
    expect(standings.filter((s) => s.userId === 'principal' || s.userId === 'double')).toHaveLength(2);
  });

  test('avec repli, ses victoires et sa serie se cumulent', () => {
    const merged = buildBettorStandings(replie).find((s) => s.userId === 'principal');
    expect(merged).toMatchObject({ wins: 2, losses: 0, netGain: 200, bestStreak: 2 });
    expect(buildBettorStandings(replie).some((s) => s.userId === 'double')).toBe(false);
  });

  // Deux comptes lies du meme camp : replies, ils ne doivent compter qu'une
  // victoire pour le pari, pas une par compte.
  test('deux comptes lies dans un meme pari ne comptent qu\'une fois', () => {
    const standings = buildBettorStandings([{
      entries: [
        { userId: 'principal', engaged: 100, payout: 150, won: true },
        { userId: 'principal', engaged: 100, payout: 150, won: true },
        { userId: 'adverse', engaged: 100, payout: 0, won: false },
      ],
      resolvedAt: new Date(Date.UTC(2026, 0, 1)),
    }]);
    expect(standings.find((s) => s.userId === 'principal')).toMatchObject({ wins: 1, netGain: 100 });
  });
});

describe('lecture des camps saisis', () => {
  const limits = { maxSides: 4, maxParticipants: 10, stakeMode: 'PER_MEMBER' as const };

  test('deux camps sans places restent sans limite d\'effectif', () => {
    expect(parseBetSides('Rouge, Bleu', limits)).toEqual({
      ok: true,
      sides: [{ label: 'Rouge', capacity: null }, { label: 'Bleu', capacity: null }],
    });
  });

  // Le cas 1 contre 3 : c'est le suffixe qui déclare le déséquilibre.
  test('le suffixe fixe le nombre de places', () => {
    expect(parseBetSides('Équipe A:1, Équipe B:3', limits)).toEqual({
      ok: true,
      sides: [{ label: 'Équipe A', capacity: 1 }, { label: 'Équipe B', capacity: 3 }],
    });
  });

  test('refuse un seul camp', () => {
    expect(parseBetSides('Rouge', limits)).toMatchObject({ ok: false, reason: 'too-few' });
  });

  test('refuse plus de camps que le serveur n\'en autorise', () => {
    expect(parseBetSides('a, b, c, d, e', limits)).toMatchObject({ ok: false, reason: 'too-many' });
  });

  test('refuse deux camps de même nom, à la casse près', () => {
    expect(parseBetSides('Rouge, rouge', limits)).toMatchObject({ ok: false, reason: 'duplicate-label' });
  });

  test('refuse un total de places au-dessus du plafond du serveur', () => {
    expect(parseBetSides('Rouge:8, Bleu:8', limits)).toMatchObject({ ok: false, reason: 'over-capacity' });
  });

  // En mise par camp, la part de chacun se déduit du nombre de places : sans lui
  // elle changerait à chaque arrivée, donc après le prélèvement des précédents.
  test('la mise par camp exige des places déclarées', () => {
    expect(parseBetSides('Rouge, Bleu', { ...limits, stakeMode: 'PER_SIDE' }))
      .toMatchObject({ ok: false, reason: 'capacity-required' });
    expect(parseBetSides('Rouge:2, Bleu:2', { ...limits, stakeMode: 'PER_SIDE' })).toMatchObject({ ok: true });
  });

  test('ignore les espaces et les virgules en trop', () => {
    expect(parseBetSides('  Rouge:1 ,, Bleu:2 , ', limits)).toEqual({
      ok: true,
      sides: [{ label: 'Rouge', capacity: 1 }, { label: 'Bleu', capacity: 2 }],
    });
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
