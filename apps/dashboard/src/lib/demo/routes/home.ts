/**
 * L'accueil : statistiques, tâches à traiter, préférences, langue et fuseau.
 *
 * Formes reprises de `routes/dashboard/analytics.ts`, `homeTasks.ts` et
 * `general.ts` côté bot, réduites aux champs que les pages lisent.
 */
import type { HomeTasksData } from '@kotbo/contracts';
import { route } from '../backend';
import { demoDb } from '../db';
import { HOUR, MEMBERS, PEOPLE, ago, channelByName, personByName, role } from '../fixtures';
import { SANCTIONS } from './session';
import { sanctionsSeed } from '../stories';

const DAY_MS = 86_400_000;
const DAY = 24 * HOUR;

/** Sept jours d'activité, du plus ancien au plus récent. Même courbe à chaque visite. */
function dailyTrend(days: number) {
  const base = [612, 548, 701, 655, 830, 1_190, 1_064, 720, 598, 640, 712, 905, 1_240, 1_110];
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * DAY_MS);
    const messages = base[(i + 14 - days) % base.length];
    return {
      dateKey: date.toISOString().slice(0, 10),
      messages,
      voiceMinutes: Math.round(messages * 1.7),
      membersJoined: [3, 1, 4, 2, 6, 5, 2, 1, 3, 4, 2, 5, 7, 3][i % 14],
      membersLeft: [1, 0, 2, 1, 1, 0, 1, 2, 0, 1, 1, 0, 2, 1][i % 14],
      sanctions: [1, 0, 0, 2, 1, 0, 1, 0, 1, 0, 0, 1, 2, 1][i % 14],
      activeMembers: Math.round(messages / 9),
    };
  });
}

function analytics(period: number) {
  const trend = dailyTrend(Math.min(Math.max(period, 7), 14));
  const joins = trend.reduce((s, d) => s + d.membersJoined, 0);
  const leaves = trend.reduce((s, d) => s + d.membersLeft, 0);
  const sanctions = demoDb.get(SANCTIONS, sanctionsSeed);
  const count = (type: string) => sanctions.filter((s) => s.type === type).length;
  const online = MEMBERS.filter((m) => m.status === 'online').length;
  const idle = MEMBERS.filter((m) => m.status === 'idle').length;
  const dnd = MEMBERS.filter((m) => m.status === 'dnd').length;

  return {
    dailyTrend: trend,
    live: {
      humansCount: MEMBERS.length,
      botsCount: 2,
      onlineMembers: online,
      idleMembers: idle,
      dndMembers: dnd,
      voiceConnected: 6,
    },
    totals: {
      joins,
      leaves,
      netGrowth: joins - leaves,
      messages: trend.reduce((s, d) => s + d.messages, 0),
      voiceMinutes: trend.reduce((s, d) => s + d.voiceMinutes, 0),
    },
    topChannels: [
      { channelId: channelByName('général').id, channelName: 'général', messagesCount: 2_840 },
      { channelId: channelByName('recherche-de-groupe').id, channelName: 'recherche-de-groupe', messagesCount: 1_310 },
      { channelId: channelByName('niveaux').id, channelName: 'niveaux', messagesCount: 640 },
      { channelId: channelByName('boutique').id, channelName: 'boutique', messagesCount: 420 },
      { channelId: channelByName('staff').id, channelName: 'staff', messagesCount: 310 },
    ],
    topMessageMembers: ['Lina', 'Noé', 'Maëlle', 'Arka', 'Lena'].map((name, i) => {
      const p = personByName(name);
      return { userId: p.id, name: p.displayName, avatarUrl: null, messageCount: [612, 540, 433, 390, 352][i] };
    }),
    moderation: {
      totals: { warns: count('WARN'), timeouts: count('TIMEOUT'), kicks: count('KICK'), bans: count('BAN') },
      activeSanctions: sanctions.filter((s) => s.status === 'ACTIVE').length,
      recentSanctions: sanctions.slice(0, 5).map((s) => ({
        id: s.id,
        type: s.type,
        targetName: s.targetTag,
        moderatorName: s.moderatorTag,
        reason: s.reason,
        createdAt: s.createdAt,
      })),
    },
  };
}

function homeTasks(): HomeTasksData {
  return {
    tasks: [
      {
        key: 'tickets_unclaimed',
        severity: 'warning',
        count: 2,
        oldestAt: ago(3 * HOUR),
        href: '/tickets',
        preview: [
          { id: 't148', label: '#0148 · Bug sur la boutique', at: ago(3 * HOUR) },
          { id: 't149', label: '#0149 · Question sur les rôles', at: ago(40) },
        ],
      },
      {
        key: 'sanction_reports_missing',
        severity: 'info',
        count: 1,
        mine: 0,
        href: '/security/sanctions',
        preview: [{ id: 's501', label: 'Vantar · Avertissement sans rapport', at: ago(2 * HOUR) }],
      },
      {
        key: 'absences_pending',
        severity: 'info',
        count: 1,
        href: '/absences',
        preview: [{ id: 'abs1', label: 'Kylian · du lundi au mercredi', at: ago(5 * HOUR) }],
      },
      {
        key: 'meetings_upcoming',
        severity: 'info',
        count: 1,
        href: '/meetings',
        preview: [{ id: 'meet1', label: 'Réunion staff du dimanche', at: new Date(Date.now() + 2 * DAY_MS).toISOString() }],
      },
    ],
    setup: null,
    generatedAt: new Date().toISOString(),
  };
}

const USER_SETTINGS = 'user-settings';
const LANGUAGE = 'language';
const TIMEZONE = 'timezone';

const staffPeople = () => PEOPLE.filter((p) => p.roles.some((id) => [role('Fondateur').id, role('Admin').id, role('Modérateur').id, role('Helper').id].includes(id)));

const gradeOf = (roles: string[]) =>
  roles.includes(role('Fondateur').id) ? 'Fondateur' : roles.includes(role('Admin').id) ? 'Admin' : roles.includes(role('Modérateur').id) ? 'Modérateur' : 'Helper';

export function staffMembers() {
  return staffPeople().map((p, i) => ({
    id: `staff-${p.username}`,
    guildId: '',
    userId: p.id,
    grade: gradeOf(p.roles),
    joinedStaffAt: ago(p.joinedMinutesAgo - 10 * DAY),
    currentRoleStartedAt: ago(Math.max(1, p.joinedMinutesAgo - 30 * DAY)),
    userTag: p.username,
    username: p.username,
    displayName: p.displayName,
    avatarUrl: null,
    isTutor: i === 2,
    suspendedAt: null,
    createdAt: ago(p.joinedMinutesAgo),
    updatedAt: ago(DAY),
    warnings: [],
    blacklistEntries: [],
    stats: { totalMessages: p.messages, totalVoiceMinutes: p.voiceMinutes, sanctionsIssued: 3 + i * 4 },
  }));
}

export const ABSENCES = 'absences';
export function absencesSeed() {
  const kylian = personByName('Kylian');
  const zenox = personByName('Zenox');
  return [
    {
      id: 'abs1',
      userId: kylian.id,
      userTag: kylian.username,
      displayName: kylian.displayName,
      reason: 'Partiels à la fac',
      startDate: new Date(Date.now() + 3 * DAY_MS).toISOString(),
      endDate: new Date(Date.now() + 5 * DAY_MS).toISOString(),
      status: 'PENDING',
      createdAt: ago(5 * HOUR),
    },
    {
      id: 'abs2',
      userId: zenox.id,
      userTag: zenox.username,
      displayName: zenox.displayName,
      reason: 'Vacances',
      startDate: ago(DAY),
      endDate: new Date(Date.now() + 4 * DAY_MS).toISOString(),
      status: 'ACKNOWLEDGED',
      createdAt: ago(6 * DAY),
    },
  ];
}

export const MEETINGS = 'meetings';
export function meetingsSeed() {
  return [
    {
      id: 'meet1',
      title: 'Réunion staff du dimanche',
      description: 'Bilan de la semaine, tickets en retard, préparation de la soirée quiz.',
      scheduledAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
      endedAt: null,
      timezone: 'Europe/Paris',
      createdAt: ago(3 * DAY),
    },
  ];
}

export function registerHomeRoutes(): void {
  route('GET', '/api/config', () => ({ discordClientId: '0' }));

  route('GET', '/api/dashboard/guilds/:guildId/analytics', ({ query }) => analytics(Number(query.get('period')) || 7));
  route('GET', '/api/dashboard/guilds/:guildId/home-tasks', () => homeTasks());
  route('GET', '/api/dashboard/guilds/:guildId/notifications', () => ({ notifications: [] }));
  route('GET', '/api/dashboard/guilds/:guildId/tutoring/apprentice-progress', () => ({ progress: null }));

  route('GET', '/api/dashboard/guilds/:guildId/user-settings', () => demoDb.get(USER_SETTINGS, () => ({})));
  route('PUT', '/api/dashboard/guilds/:guildId/user-settings', ({ body }) =>
    demoDb.update(USER_SETTINGS, () => ({}), (current) => ({ ...current, ...(body ?? {}) })),
  );

  const languageState = () => demoDb.get(LANGUAGE, () => ({ mode: 'auto', locale: 'fr' }));
  route('GET', '/api/dashboard/guilds/:guildId/language', () => ({ ...languageState(), detected: 'fr', available: ['fr', 'en'], rerender: null }));
  route('PATCH', '/api/dashboard/guilds/:guildId/language', ({ body }) => {
    const auto = body?.mode === 'auto' || body?.language === null;
    const next = demoDb.set(LANGUAGE, { mode: auto ? 'auto' : 'manual', locale: auto ? 'fr' : body?.language === 'en' ? 'en' : 'fr' });
    return { ...next, detected: 'fr', available: ['fr', 'en'], rerender: null };
  });

  const timezoneList = ['Europe/Paris', 'Europe/Brussels', 'Europe/Zurich', 'America/Montreal', 'UTC'];
  route('GET', '/api/dashboard/guilds/:guildId/timezone', () => ({ timezone: demoDb.get(TIMEZONE, () => 'Europe/Paris'), default: 'Europe/Paris', available: timezoneList }));
  route('PATCH', '/api/dashboard/guilds/:guildId/timezone', ({ body }) => {
    const timezone = typeof body?.timezone === 'string' ? body.timezone : 'Europe/Paris';
    demoDb.set(TIMEZONE, timezone);
    return { timezone, default: 'Europe/Paris', available: timezoneList };
  });

  route('GET', '/api/dashboard/guilds/:guildId/staff/members', () => ({ members: staffMembers() }));
  route('GET', '/api/dashboard/guilds/:guildId/absences', () => ({ absences: demoDb.get(ABSENCES, absencesSeed) }));
  route('GET', '/api/dashboard/guilds/:guildId/meetings', () => ({ meetings: demoDb.get(MEETINGS, meetingsSeed) }));
}
