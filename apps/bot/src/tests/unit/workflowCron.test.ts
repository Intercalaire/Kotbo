import { describe, expect, test } from 'bun:test';
import {
  cronMatches,
  cronToSchedule,
  isValidCron,
  parseCron,
  scheduleToCron,
} from '@kotbo/shared';

/** Raccourci lisible : l'heure locale, seule base du matcher. */
const at = (iso: string) => new Date(iso);

describe('validation des motifs', () => {
  test('accepte les formes standard', () => {
    for (const pattern of ['* * * * *', '0 9 * * *', '30 8 * * 1', '0 0 1 * *', '*/15 * * * *', '0 9-17 * * 1-5', '0 0,12 * * *']) {
      expect(isValidCron(pattern)).toBeTrue();
    }
  });

  test('refuse ce qu\'elle ne sait pas interpréter', () => {
    for (const pattern of ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '0 0 0 * *', '0 0 * 13 *', '@daily', '0 0 L * *', 'a b c d e', '0 0 * * 1#2', '5-1 * * * *']) {
      expect(isValidCron(pattern)).toBeFalse();
    }
  });

  test('7 et 0 designent tous deux le dimanche', () => {
    const sunday = at('2026-08-16T12:00:00');
    expect(sunday.getDay()).toBe(0);
    expect(cronMatches('0 12 * * 7', sunday)).toBeTrue();
    expect(cronMatches('0 12 * * 0', sunday)).toBeTrue();
  });
});

describe('correspondance a la minute', () => {
  test('tous les jours a 9h00', () => {
    expect(cronMatches('0 9 * * *', at('2026-08-18T09:00:00'))).toBeTrue();
    expect(cronMatches('0 9 * * *', at('2026-08-18T09:01:00'))).toBeFalse();
    expect(cronMatches('0 9 * * *', at('2026-08-18T10:00:00'))).toBeFalse();
  });

  test('un pas couvre les minutes attendues', () => {
    expect(cronMatches('*/15 * * * *', at('2026-08-18T10:00:00'))).toBeTrue();
    expect(cronMatches('*/15 * * * *', at('2026-08-18T10:15:00'))).toBeTrue();
    expect(cronMatches('*/15 * * * *', at('2026-08-18T10:30:00'))).toBeTrue();
    expect(cronMatches('*/15 * * * *', at('2026-08-18T10:07:00'))).toBeFalse();
  });

  test('un intervalle de jours de semaine exclut le week-end', () => {
    // 2026-08-17 est un lundi, 2026-08-22 un samedi.
    expect(cronMatches('0 8 * * 1-5', at('2026-08-17T08:00:00'))).toBeTrue();
    expect(cronMatches('0 8 * * 1-5', at('2026-08-22T08:00:00'))).toBeFalse();
  });

  test('une liste accepte chacune de ses valeurs', () => {
    expect(cronMatches('0 0,12 * * *', at('2026-08-18T00:00:00'))).toBeTrue();
    expect(cronMatches('0 0,12 * * *', at('2026-08-18T12:00:00'))).toBeTrue();
    expect(cronMatches('0 0,12 * * *', at('2026-08-18T06:00:00'))).toBeFalse();
  });

  test('jour du mois et jour de semaine se combinent par un OU', () => {
    // Regle historique de cron : « le 1er du mois, et aussi tous les lundis ».
    // 2026-09-01 est un mardi, 2026-09-07 un lundi.
    expect(cronMatches('0 0 1 * 1', at('2026-09-01T00:00:00'))).toBeTrue();
    expect(cronMatches('0 0 1 * 1', at('2026-09-07T00:00:00'))).toBeTrue();
    expect(cronMatches('0 0 1 * 1', at('2026-09-08T00:00:00'))).toBeFalse();
  });

  test('un champ restreint seul reste un ET avec le reste', () => {
    expect(cronMatches('0 0 1 * *', at('2026-09-01T00:00:00'))).toBeTrue();
    expect(cronMatches('0 0 1 * *', at('2026-09-02T00:00:00'))).toBeFalse();
  });

  test('un motif invalide ne declenche jamais', () => {
    expect(cronMatches('nawak', at('2026-08-18T09:00:00'))).toBeFalse();
  });
});

describe('composition depuis l editeur', () => {
  test('chaque frequence produit un motif valide et relisible', () => {
    const presets = [
      { frequency: 'hourly' as const, minute: 30, hour: 9, weekday: 1, day: 1 },
      { frequency: 'daily' as const, minute: 0, hour: 20, weekday: 1, day: 1 },
      { frequency: 'weekly' as const, minute: 15, hour: 8, weekday: 3, day: 1 },
      { frequency: 'monthly' as const, minute: 0, hour: 7, weekday: 1, day: 15 },
    ];

    for (const preset of presets) {
      const cron = scheduleToCron(preset);
      expect(isValidCron(cron)).toBeTrue();

      const read = cronToSchedule(cron);
      expect(read).not.toBeNull();
      expect(read!.frequency).toBe(preset.frequency);
      expect(read!.minute).toBe(preset.minute);
      if (preset.frequency !== 'hourly') expect(read!.hour).toBe(preset.hour);
      if (preset.frequency === 'weekly') expect(read!.weekday).toBe(preset.weekday);
      if (preset.frequency === 'monthly') expect(read!.day).toBe(preset.day);
    }
  });

  test('un motif hors des quatre frequences se relit en null', () => {
    // L'editeur bascule alors sur la saisie brute plutot que d'afficher des
    // reglages qui ne correspondent pas.
    expect(cronToSchedule('*/15 * * * *')).toBeNull();
    expect(cronToSchedule('0 9-17 * * *')).toBeNull();
    expect(cronToSchedule('0 0 1 1 *')).toBeNull();
    expect(cronToSchedule('0 0 1 * 1')).toBeNull();
  });

  test('les valeurs aberrantes sont ramenees dans les bornes', () => {
    expect(scheduleToCron({ frequency: 'daily', minute: 99, hour: -3, weekday: 1, day: 1 })).toBe('59 0 * * *');
  });
});

describe('structure analysee', () => {
  test('parseCron distingue l etoile d une enumeration complete', () => {
    expect(parseCron('* * * * *')!.dayOfWeekWildcard).toBeTrue();
    expect(parseCron('* * * * 0-6')!.dayOfWeekWildcard).toBeFalse();
  });
});
