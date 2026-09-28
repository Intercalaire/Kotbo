import { describe, expect, test } from 'bun:test';
import { emptyHomeTodoPrefs, normalizeHomeTodoPrefs, type HomeSetupGap, type HomeTask } from '@kotbo/contracts';
import { applyHomeTodoPrefs, hideTask, pruneSnoozes, snoozeTask } from './homeTodoPrefs';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function task(key: HomeTask['key'], count: number): HomeTask {
  return { key, count, severity: 'warning', href: '/' };
}

const gaps: HomeSetupGap[] = [
  { key: 'logs', label: 'Salon de logs', href: '/logs/config' },
  { key: 'tickets', label: 'Tickets', href: '/tickets/config' },
];

describe('applyHomeTodoPrefs', () => {
  test('sans preference, tout reste visible', () => {
    const result = applyHomeTodoPrefs([task('polls_unvoted', 2)], gaps, emptyHomeTodoPrefs(), NOW);
    expect(result.tasks).toHaveLength(1);
    expect(result.hiddenTaskCount).toBe(0);
    expect(result.setupMissing).toHaveLength(2);
  });

  test('un sujet mis en attente revient des qu\'il grossit', () => {
    const prefs = snoozeTask(emptyHomeTodoPrefs(), task('tickets_unclaimed', 3), NOW);
    expect(applyHomeTodoPrefs([task('tickets_unclaimed', 3)], null, prefs, NOW + HOUR).tasks).toHaveLength(0);
    expect(applyHomeTodoPrefs([task('tickets_unclaimed', 4)], null, prefs, NOW + HOUR).tasks).toHaveLength(1);
  });

  test('une mise en attente expire au bout de trois jours', () => {
    const prefs = snoozeTask(emptyHomeTodoPrefs(), task('tickets_unclaimed', 3), NOW);
    expect(applyHomeTodoPrefs([task('tickets_unclaimed', 1)], null, prefs, NOW + 73 * HOUR).tasks).toHaveLength(1);
  });

  test('« ne plus afficher » retire le sujet quel que soit son compteur', () => {
    const prefs = hideTask(emptyHomeTodoPrefs(), 'polls_unvoted');
    const result = applyHomeTodoPrefs([task('polls_unvoted', 40)], null, prefs, NOW);
    expect(result.tasks).toHaveLength(0);
    expect(result.hiddenTaskCount).toBe(1);
  });

  test('les etapes ignorees sortent du bloc, le bloc masque sort en entier', () => {
    const partial = applyHomeTodoPrefs([], gaps, { ...emptyHomeTodoPrefs(), hiddenSetup: ['logs'] }, NOW);
    expect(partial.setupMissing?.map((gap) => gap.key)).toEqual(['tickets']);
    expect(partial.hiddenSetupCount).toBe(1);

    const hidden = applyHomeTodoPrefs([], gaps, { ...emptyHomeTodoPrefs(), setupHidden: true }, NOW);
    expect(hidden.setupMissing).toBeNull();
    expect(hidden.hiddenSetupCount).toBe(2);
  });
});

describe('pruneSnoozes', () => {
  test('ne reecrit rien quand toutes les mises en attente tiennent', () => {
    const prefs = snoozeTask(emptyHomeTodoPrefs(), task('polls_unvoted', 2), NOW);
    expect(pruneSnoozes(prefs, [task('polls_unvoted', 2)], NOW + HOUR)).toBeNull();
  });

  test('oublie un sujet disparu, pour qu\'il revienne des son prochain element', () => {
    const prefs = snoozeTask(emptyHomeTodoPrefs(), task('polls_unvoted', 2), NOW);
    expect(pruneSnoozes(prefs, [], NOW + HOUR)?.snoozedTasks).toEqual({});
  });
});

describe('normalizeHomeTodoPrefs', () => {
  test('ecarte les clefs inconnues et refuse de masquer pour de bon un sujet critique', () => {
    const prefs = normalizeHomeTodoPrefs({
      hiddenTasks: ['polls_unvoted', 'bot_permissions', 'nope', 42],
      snoozedTasks: { tickets_unclaimed: { count: 2, at: '2026-09-28T00:00:00Z' }, nope: { count: 1, at: 'x' } },
      hiddenSetup: ['logs', '../../etc', 'logs'],
      setupHidden: 'yes',
    });
    expect(prefs.hiddenTasks).toEqual(['polls_unvoted']);
    expect(Object.keys(prefs.snoozedTasks)).toEqual(['tickets_unclaimed']);
    expect(prefs.hiddenSetup).toEqual(['logs']);
    expect(prefs.setupHidden).toBe(false);
  });
});
