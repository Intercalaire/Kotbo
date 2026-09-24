import { beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';

let config: Record<string, unknown> | null;
let youngAccount = false;
const tracked: string[] = [];

const raid = {
  getRaidProtectionConfig: mock(async () => config),
  handleJoinDuringLock: mock(async () => false),
  handleJoinDuringRaidKick: mock(async () => false),
  trackJoinAndDetectRaid: mock(async (member: { id: string }) => { tracked.push(member.id); }),
};
const ageGuard = { handleJoinAccountAgeGuard: mock(async () => youngAccount) };

for (const ext of ['ts', 'js']) {
  mock.module(path.resolve(import.meta.dir, `../../services/moderation/raidProtectionService.${ext}`), () => raid);
  mock.module(path.resolve(import.meta.dir, `../../services/moderation/accountAgeGuardService.${ext}`), () => ageGuard);
}

const { admitJoiningMember } = await import('../../services/moderation/joinAdmissionService.js');

let counter = 0;
function member(id?: string, joinedTimestamp = Date.now()) {
  counter += 1;
  return { id: id ?? `user-${counter}`, joinedTimestamp, guild: { id: 'guild-1' } } as never;
}

beforeEach(() => {
  config = { accountAgeGuardEnabled: true };
  youngAccount = false;
  tracked.length = 0;
});

describe('admission des arrivées', () => {
  test('un compte trop récent est refusé pour tous les écouteurs', async () => {
    youngAccount = true;
    const newcomer = member();
    const verdicts = await Promise.all([admitJoiningMember(newcomer), admitJoiningMember(newcomer), admitJoiningMember(newcomer)]);
    expect(verdicts).toEqual([false, false, false]);
  });

  test('les contrôles ne tournent qu\'une fois par arrivée', async () => {
    const newcomer = member();
    await Promise.all([admitJoiningMember(newcomer), admitJoiningMember(newcomer)]);
    expect(tracked).toEqual([(newcomer as { id: string }).id]);
  });

  test('un compte ancien est admis', async () => {
    expect(await admitJoiningMember(member())).toBe(true);
  });

  test('sans configuration anti-raid, tout le monde entre', async () => {
    config = null;
    youngAccount = true;
    expect(await admitJoiningMember(member())).toBe(true);
  });

  test('un membre refoulé qui revient aussitôt repasse les contrôles', async () => {
    youngAccount = true;
    expect(await admitJoiningMember(member('revenant', 1_000))).toBe(false);

    // Il revient : cette fois il est refoulé à nouveau, et non laissé sans contrôle.
    expect(await admitJoiningMember(member('revenant', 2_000))).toBe(false);
    expect(tracked.filter((id) => id === 'revenant')).toHaveLength(2);
  });
});
