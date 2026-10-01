/**
 * Routes de démo pour la gestion des membres et la fiche membre.
 */
import type { MemberCaseResponse, SanctionItem } from '@kotbo/contracts';
import { route } from '../backend';
import { demoDb } from '../db';
import { MEMBERS, PEOPLE, ROLES, ago, role, ME, HOUR, DAY, type DemoPerson } from '../fixtures';
import { sanctionsSeed, auditSeed } from '../stories';

export function registerMembersRoutes(): void {
  // GET /api/dashboard/guilds/:id/members/search
  route('GET', '/api/dashboard/guilds/:id/members/search', ({ query }) => {
    const q = (query.get('q') ?? '').trim().toLowerCase();
    const page = Math.max(1, parseInt(query.get('page') ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.get('limit') ?? '24', 10) || 24));
    const roleId = query.get('roleId');
    const sort = query.get('sort') ?? 'lastSeenAt';

    let list = [...MEMBERS];
    if (q) {
      list = list.filter((m) => m.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q));
    }
    if (roleId) {
      list = list.filter((m) => m.roles.includes(roleId));
    }

    if (sort === 'messageCount') {
      list.sort((a, b) => b.messages - a.messages);
    } else if (sort === 'guildJoinedAt') {
      list.sort((a, b) => a.joinedMinutesAgo - b.joinedMinutesAgo);
    } else {
      list.sort((a, b) => (a.status === 'online' ? -1 : 1));
    }

    const totalFound = list.length;
    const totalPages = Math.max(1, Math.ceil(totalFound / limit));
    const offset = (page - 1) * limit;
    const paged = list.slice(offset, offset + limit);

    const members = paged.map((m) => ({
      id: m.id,
      username: m.username,
      displayName: m.displayName,
      avatarUrl: null,
      isBot: m.bot ?? false,
      lastSeenAt: ago(m.status === 'online' ? 2 : m.status === 'idle' ? 25 : 180),
      messageCount: m.messages,
      guildJoinedAt: ago(m.joinedMinutesAgo),
      guildLeftAt: null,
      isOnServer: true,
      presenceStatus: m.status,
    }));

    return {
      members,
      totalFound,
      totalPages,
      onServerCount: MEMBERS.length,
      leftCount: 0,
      botCount: 1,
    };
  });

  // GET /api/dashboard/guilds/:id/members/:userId
  route('GET', '/api/dashboard/guilds/:id/members/:userId', ({ params }) => {
    const userId = params.userId;
    const person = MEMBERS.find((p) => p.id === userId) || MEMBERS[0];
    const notes = demoDb.get<Record<string, string>>('member-notes', () => ({}));
    const note = notes[userId] ?? null;

    const allSanctions = demoDb.get<SanctionItem[]>('sanctions', sanctionsSeed);
    const memberSanctions = allSanctions.filter((s) => s.targetUserId === userId);

    const memberRoles = person.roles.map((rId) => {
      const r = ROLES.find((x) => x.id === rId);
      return r ? { id: r.id, name: r.name, mention: r.mention, permissions: r.permissions, position: r.position, color: r.color } : { id: rId, name: 'Membre', mention: `<@&${rId}>`, permissions: [] };
    });

    const response: MemberCaseResponse = {
      profile: {
        id: `profile-${person.id}`,
        userId: person.id,
        userTag: person.username,
        username: person.username,
        globalName: person.displayName,
        displayName: person.displayName,
        avatarUrl: null,
        bannerUrl: null,
        accentColor: null,
        locale: 'fr',
        isBot: person.bot ?? false,
        accountCreatedAt: ago(person.joinedMinutesAgo + 120 * DAY),
        guildJoinedAt: ago(person.joinedMinutesAgo),
        guildLeftAt: null,
        firstSeenAt: ago(person.joinedMinutesAgo),
        lastSeenAt: ago(person.status === 'online' ? 2 : 120),
        lastMessageAt: ago(15),
        lastMessageChannelId: '900000000000000313',
        messageCount: person.messages,
        voiceSessionCount: Math.round(person.voiceMinutes / 45),
        voiceTimeSeconds: person.voiceMinutes * 60,
        voiceLastChannelId: null,
        voiceLastJoinedAt: null,
        voiceLastLeftAt: null,
        rolesSnapshot: person.roles,
        presenceStatus: person.status,
        pronouns: null,
        isTutor: false,
        staffGrade: null,
        isSuspectedDC: person.username === 'vantar' || person.username === 'kyzo',
        moderatorNote: note,
        isOnServer: true,
      },
      invite: {
        code: 'nova',
        inviterId: '900000000000000401',
        inviterTag: 'Arka',
        inviterAvatarUrl: null,
        joinedAt: ago(person.joinedMinutesAgo),
      },
      roles: memberRoles,
      effectivePermissions: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
      sanctions: memberSanctions,
      logs: [
        {
          id: `log-${person.id}-1`,
          user: 'Kotbo',
          action: 'Arrivée',
          context: 'Atelier Nova',
          module: 'Membres',
          eventType: 'Automatique',
          source: 'discord',
          details: `${person.displayName} a rejoint le serveur`,
          dateIso: ago(person.joinedMinutesAgo),
          channelId: '900000000000000310',
        },
      ],
      messagesByChannel: [
        {
          channelId: '900000000000000313',
          channelName: 'général',
          count: Math.round(person.messages * 0.7),
          lastMessageAt: ago(15),
          recentMessages: [
            {
              id: `msg-${person.id}-1`,
              channelId: '900000000000000313',
              channelName: 'général',
              content: 'Salut tout le monde !',
              dateIso: ago(15),
            },
          ],
        },
      ],
      recentMessageCount: person.messages,
      recentLogCount: 1,
      connections: [],
      connectionsNote: '',
      candidatures: [],
      linkedAccounts: [],
      isSuspectedDC: person.username === 'vantar' || person.username === 'kyzo',
      sanctionReports: [],
      interactionGraph: { nodes: [], edges: [] },
      crossServerSanctions: {
        enabled: false,
        serverCount: 0,
        total: 0,
        breakdown: { WARN: 0, KICK: 0, TIMEOUT: 0, TEMP_BAN: 0, BAN: 0, SOFTBAN: 0 },
        recent: [],
      },
      crossServerLinks: {
        enabled: false,
        serverCount: 0,
        suggestions: [],
      },
      verifications: {
        entries: [],
        total: 0,
        lastRequestedAt: null,
        lastVerifiedAt: null,
        hasPending: false,
        cooldownUntil: null,
      },
    };

    return response;
  });

  // POST /api/dashboard/guilds/:id/members/:userId/actions
  route('POST', '/api/dashboard/guilds/:id/members/:userId/actions', ({ params, body }) => {
    const userId = params.userId;
    const person = MEMBERS.find((p) => p.id === userId) || MEMBERS[0];
    const actionType = body?.type as SanctionItem['type'] ?? 'WARN';
    const reason = body?.reason || 'Sanction appliquée via la fiche membre';

    const newSanction: SanctionItem = {
      id: `sanction-${Date.now()}`,
      type: actionType,
      status: 'ACTIVE',
      targetUserId: person.id,
      targetTag: person.username,
      moderatorUserId: ME.id,
      moderatorTag: ME.username,
      reason,
      durationSeconds: body?.durationMs ? Math.round(body.durationMs / 1000) : null,
      expiresAt: body?.durationMs ? new Date(Date.now() + body.durationMs).toISOString() : null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolutionNote: null,
      archivedAt: null,
      archiveReason: null,
      appealable: true,
      appealLockReason: null,
    };

    demoDb.update('sanctions', sanctionsSeed, (current) => [newSanction, ...current]);
    demoDb.update('audit-trail', auditSeed, (current) => [
      {
        id: `audit-${Date.now()}`,
        user: ME.displayName,
        action: actionType === 'WARN' ? 'Avertissement' : actionType === 'TIMEOUT' ? 'Exclusion temporaire' : actionType === 'KICK' ? 'Expulsion' : 'Bannissement',
        context: 'Atelier Nova',
        module: 'Sanctions',
        eventType: 'Manuel',
        source: 'dashboard' as const,
        details: `${person.displayName} : ${reason}`,
        dateIso: new Date().toISOString(),
        channelId: null,
      },
      ...current,
    ]);

    return { success: true, sanction: newSanction };
  });

  // PATCH /api/dashboard/guilds/:id/members/:userId/note
  route('PATCH', '/api/dashboard/guilds/:id/members/:userId/note', ({ params, body }) => {
    const userId = params.userId;
    const note = body?.note ?? '';
    demoDb.update<Record<string, string>>('member-notes', () => ({}), (notes) => ({ ...notes, [userId]: note }));
    return { success: true, note };
  });

  // GET /api/dashboard/guilds/:id/linked-accounts
  route('GET', '/api/dashboard/guilds/:id/linked-accounts', () => ({
    links: [],
    suggestions: [],
  }));
}
