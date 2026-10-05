import { describe, expect, test } from 'bun:test';
import { admitJob, isLate, QUEUE_LIMITS, type AegisJob } from '../../services/moderation/aegis/aegisQueue';

const limits = { ...QUEUE_LIMITS, emotionShedDepth: 10, maxDepth: 100 };

function job(patch: Partial<AegisJob> = {}): AegisJob {
  return {
    source: 'MESSAGE',
    guildId: 'g',
    channelId: 'c',
    statsChannelId: 'c',
    messageId: 'm',
    authorId: 'u',
    text: 'bonjour',
    excerpt: 'bonjour',
    targetUserId: null,
    wantToxicity: true,
    wantEmotion: true,
    countStats: true,
    enqueuedAt: 0,
    ...patch,
  };
}

describe('admitJob', () => {
  test('file courte : tout passe', () => {
    expect(admitJob(job(), 0, limits)).toEqual({ job: job(), outcome: 'queued' });
  });

  test('file longue : on lâche les émotions, pas la toxicité', () => {
    const admitted = admitJob(job(), 10, limits);
    expect(admitted.outcome).toBe('queued_without_emotion');
    expect(admitted.job).toEqual(job({ wantEmotion: false }));
  });

  test('un job qui ne voulait que l’émotion disparaît avec elle', () => {
    expect(admitJob(job({ wantToxicity: false }), 10, limits)).toEqual({ job: null, outcome: 'dropped' });
  });

  test('au plafond, plus rien n’entre', () => {
    expect(admitJob(job(), 100, limits)).toEqual({ job: null, outcome: 'dropped' });
  });
});

describe('isLate', () => {
  test('au-delà du délai, la note arrive trop tard', () => {
    expect(isLate({ enqueuedAt: 0 }, QUEUE_LIMITS.staleMs)).toBe(false);
    expect(isLate({ enqueuedAt: 0 }, QUEUE_LIMITS.staleMs + 1)).toBe(true);
  });
});
