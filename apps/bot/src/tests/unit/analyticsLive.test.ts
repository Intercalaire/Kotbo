import { describe, expect, test } from 'bun:test';
import { LiveWindow, LIVE_WINDOW_MINUTES } from '../../services/analytics/analyticsLiveService';

const T0 = Date.parse('2026-10-03T10:00:30Z');
const MIN = 60_000;

describe('LiveWindow', () => {
  test('compte messages, auteurs distincts et salons sur la fenêtre', () => {
    const w = new LiveWindow();
    w.message('general', 'alice', T0);
    w.message('general', 'bob', T0 + MIN);
    w.message('jeux', 'alice', T0 + 2 * MIN);
    w.join(T0);
    const s = w.summary(T0 + 2 * MIN);
    expect(s.minutes.length).toBe(LIVE_WINDOW_MINUTES);
    expect(s.messages).toBe(3);
    expect(s.authors).toBe(2);
    expect(s.joins).toBe(1);
    expect(s.channels).toEqual([['general', 2], ['jeux', 1]]);
    expect(s.perMinute).toBe(0.6);
  });

  test('ce qui sort des 30 minutes est oublié', () => {
    const w = new LiveWindow();
    w.message('general', 'alice', T0);
    expect(w.prune(T0 + 31 * MIN)).toBe(true);
    expect(w.summary(T0 + 31 * MIN).messages).toBe(0);
  });
});
