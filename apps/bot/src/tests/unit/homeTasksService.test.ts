import { describe, expect, mock, test } from 'bun:test';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { compareHomeTasks, type HomeTask } from '@kotbo/contracts';

const prismaMock = {};

const moduleMocks: Array<[string, () => Record<string, unknown>]> = [
  ['../../utils/db', () => ({ default: prismaMock, prisma: prismaMock, prismaRead: prismaMock })],
  ['../../services/core/moduleGate', () => ({ getModuleStates: mock(async () => ({})) })],
  ['../../services/core/setupJourney', () => ({ computeSetupJourney: mock(async () => null) })],
];

for (const [relativePath, factory] of moduleMocks) {
  mock.module(path.resolve(import.meta.dir, `${relativePath}.ts`), factory);
  mock.module(path.resolve(import.meta.dir, `${relativePath}.js`), factory);
}

const { missingBotPermissions, findBrokenReferences, isTaskVisible } = await import(
  '../../services/core/homeTasksService.js'
);

describe('missingBotPermissions', () => {
  test('un administrateur ne manque de rien', () => {
    expect(missingBotPermissions(PermissionFlagsBits.Administrator)).toEqual([]);
  });

  test('liste ce qui manque, par libelle', () => {
    const all = Object.values(PermissionFlagsBits).reduce((acc, flag) => acc | flag, 0n);
    const withoutBan = all & ~PermissionFlagsBits.Administrator & ~PermissionFlagsBits.BanMembers;
    expect(missingBotPermissions(withoutBan)).toEqual(['Bannir des membres']);
  });

  test('aucune permission : tout manque', () => {
    expect(missingBotPermissions(0n).length).toBeGreaterThan(10);
  });
});

describe('findBrokenReferences', () => {
  const exists = (kind: 'channel' | 'role', id: string) => (kind === 'channel' ? id === 'c1' : id === 'r1');

  test('ignore les reglages vides et les cibles presentes', () => {
    const broken = findBrokenReferences(
      [
        { key: 'logChannelId', kind: 'channel', value: 'c1', label: 'Logs', href: '/logs' },
        { key: 'moderatorRoleId', kind: 'role', value: null, label: 'Modo', href: '/x' },
        { key: 'publicChannelId', kind: 'channel', value: '', label: 'Accueil', href: '/y' },
      ],
      exists,
    );
    expect(broken).toEqual([]);
  });

  test('signale un salon ou un role supprime', () => {
    const broken = findBrokenReferences(
      [
        { key: 'logChannelId', kind: 'channel', value: 'gone', label: 'Logs', href: '/logs' },
        { key: 'moderatorRoleId', kind: 'role', value: 'r1', label: 'Modo', href: '/x' },
        { key: 'ticketStaffRoleId', kind: 'role', value: 'gone', label: 'Staff tickets', href: '/t' },
      ],
      exists,
    );
    expect(broken.map((item) => item.id)).toEqual(['logChannelId', 'ticketStaffRoleId']);
  });
});

describe('isTaskVisible', () => {
  const member = (canView: (key: string) => boolean) => ({ userId: 'u', canManageSettings: false, canView });
  const admin = { userId: 'a', canManageSettings: true, canView: () => false };

  test('les sujets de configuration restent aux administrateurs', () => {
    expect(isTaskVisible('bot_permissions', member(() => true))).toBeFalse();
    expect(isTaskVisible('bot_permissions', admin)).toBeTrue();
  });

  test('un sujet suit le droit de lecture de sa section', () => {
    expect(isTaskVisible('ban_appeals_pending', member((key) => key === 'ban_appeals'))).toBeTrue();
    expect(isTaskVisible('ban_appeals_pending', member(() => false))).toBeFalse();
    expect(isTaskVisible('ban_appeals_pending', admin)).toBeTrue();
  });
});

describe('compareHomeTasks', () => {
  const make = (partial: Partial<HomeTask>): HomeTask => ({
    key: 'suggestions_pending',
    severity: 'info',
    count: 1,
    href: '/',
    ...partial,
  });

  test('le plus grave passe devant, puis ce qui revient au lecteur, puis le plus ancien', () => {
    const sorted = [
      make({ key: 'suggestions_pending', severity: 'info', count: 40 }),
      make({ key: 'tickets_unclaimed', severity: 'warning', oldestAt: '2026-09-27T10:00:00.000Z' }),
      make({ key: 'ban_appeals_pending', severity: 'warning', oldestAt: '2026-09-20T10:00:00.000Z' }),
      make({ key: 'sanction_reports_missing', severity: 'warning', mine: 2, oldestAt: '2026-09-28T10:00:00.000Z' }),
      make({ key: 'bot_permissions', severity: 'critical' }),
    ].sort(compareHomeTasks);

    expect(sorted.map((item) => item.key)).toEqual([
      'bot_permissions',
      'sanction_reports_missing',
      'ban_appeals_pending',
      'tickets_unclaimed',
      'suggestions_pending',
    ]);
  });
});
