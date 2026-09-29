import { describe, expect, test } from 'bun:test';
import {
  CLAN_TOWER_DEFAULTS,
  clanTowerAttemptIndex,
  clanTowerAttemptKey,
  clanTowerAwards,
  nextClanTowerAttempt,
  normalizeClanTowerSettings,
  rankClanTower,
} from '../../services/features/rpg/rpgClanTowerPolicy.js';

const HOUR = 60 * 60 * 1000;
const start = new Date('2026-10-03T16:00:00Z');
const end = new Date(start.getTime() + 48 * HOUR);

describe('réglages de la Tour de clan', () => {
  test('les valeurs hors bornes sont ramenées, les absentes gardent leur repli', () => {
    const settings = normalizeClanTowerSettings({ weekday: 9, hour: -3, durationHours: 500, pointsPerFloor: 'x', podiumPoints: [10], announceChannelId: 'pas-un-id' });
    expect(settings.weekday).toBe(6);
    expect(settings.hour).toBe(0);
    expect(settings.durationHours).toBe(96);
    expect(settings.pointsPerFloor).toBe(CLAN_TOWER_DEFAULTS.pointsPerFloor);
    expect(settings.podiumPoints).toEqual([10, 0, 0]);
    expect(settings.announceChannelId).toBeNull();
  });

  test('un nom vide reprend le nom par défaut', () => {
    expect(normalizeClanTowerSettings({ name: '   ' }).name).toBe(CLAN_TOWER_DEFAULTS.name);
  });
});

describe('tentatives', () => {
  test('une tentative par tranche de vingt-quatre heures depuis l\'ouverture', () => {
    expect(clanTowerAttemptIndex(start, new Date(start.getTime() + 2 * HOUR))).toBe(0);
    expect(clanTowerAttemptIndex(start, new Date(start.getTime() + 25 * HOUR))).toBe(1);
    expect(clanTowerAttemptKey('evt', start, new Date(start.getTime() + 25 * HOUR))).toBe('clan:evt:1');
  });

  test('la prochaine tentative n\'existe pas si l\'événement ferme avant', () => {
    expect(nextClanTowerAttempt(start, end, new Date(start.getTime() + HOUR))?.getTime()).toBe(start.getTime() + 24 * HOUR);
    expect(nextClanTowerAttempt(start, end, new Date(start.getTime() + 30 * HOUR))).toBeNull();
  });
});

describe('classement et points', () => {
  const at = (hours: number) => new Date(start.getTime() + hours * HOUR);
  const conquests = [
    { clanId: 'A', floor: 1, userId: 'a1', conqueredAt: at(1) },
    { clanId: 'A', floor: 2, userId: 'a1', conqueredAt: at(2) },
    { clanId: 'A', floor: 3, userId: 'a2', conqueredAt: at(5) },
    { clanId: 'B', floor: 1, userId: 'b1', conqueredAt: at(1) },
    { clanId: 'B', floor: 2, userId: 'b1', conqueredAt: at(1) },
    { clanId: 'B', floor: 3, userId: 'b2', conqueredAt: at(3) },
    { clanId: 'C', floor: 1, userId: 'c1', conqueredAt: at(4) },
  ];

  test('l\'étage le plus haut d\'abord, puis le premier arrivé', () => {
    const standings = rankClanTower(conquests);
    expect(standings.map((standing) => [standing.clanId, standing.floors, standing.rank])).toEqual([['B', 3, 1], ['A', 3, 2], ['C', 1, 3]]);
    expect(standings[1].climbers).toEqual([{ userId: 'a1', floors: 2 }, { userId: 'a2', floors: 1 }]);
  });

  test('chaque conquérant touche ses étages, le podium va au clan', () => {
    const awards = clanTowerAwards(rankClanTower(conquests), { pointsPerFloor: 10, podiumPoints: [150, 100, 50] });
    const a = awards.find((award) => award.clanId === 'A')!;
    expect(a.climbers).toEqual([{ userId: 'a1', floors: 2, points: 20 }, { userId: 'a2', floors: 1, points: 10 }]);
    expect(a.podium).toBe(100);
    expect(a.total).toBe(130);
    expect(awards.find((award) => award.clanId === 'C')!.total).toBe(60);
  });

  test('aucune conquête, aucun classement', () => {
    expect(rankClanTower([])).toEqual([]);
  });
});
