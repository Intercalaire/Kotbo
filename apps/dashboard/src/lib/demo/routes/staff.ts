/**
 * Routes de démo pour la gestion du staff, des rôles et des hiérarchies.
 */
import { route } from '../backend';
import { demoDb } from '../db';
import { role, ROLES, ME } from '../fixtures';

function staffRolesSeed() {
  return [
    { id: 'staff-role-1', roleId: role('Fondateur').id, name: 'Fondateur', level: 3, permissions: ['*'] },
    { id: 'staff-role-2', roleId: role('Admin').id, name: 'Admin', level: 2, permissions: ['*'] },
    { id: 'staff-role-3', roleId: role('Modérateur').id, name: 'Modérateur', level: 1, permissions: ['sanctions', 'tickets'] },
    { id: 'staff-role-4', roleId: role('Helper').id, name: 'Helper', level: 1, permissions: ['tickets'] },
  ];
}

function staffConfigSeed() {
  return {
    baseStaffRoleId: role('Helper').id,
    testStaffRoleId: '',
    chiefStaffRoleId: role('Admin').id,
    chiefStaffUserId: ME.id,
    meetingAnnouncementChannelId: '900000000000000312',
    meetingVoiceChannelId: '900000000000000331',
    staffAnnouncementChannelId: '900000000000000318',
    warnsToDemote: 3,
    warnsToBlacklist: 5,
    blacklistPermanentByDefault: false,
    actionMode: 'MANUAL',
    demoteRemoveAllRoles: true,
  };
}

function staffHierarchiesSeed() {
  return [
    {
      id: 'hier-1',
      name: 'Hiérarchie Générale',
      roles: [role('Fondateur').id, role('Admin').id, role('Modérateur').id, role('Helper').id],
    },
  ];
}

export function registerStaffRoutes(): void {
  // GET /api/dashboard/guilds/:id/staff/roles
  route('GET', '/api/dashboard/guilds/:id/staff/roles', () => {
    return { roles: demoDb.get('staff-roles', staffRolesSeed) };
  });

  // POST /api/dashboard/guilds/:id/staff/roles
  route('POST', '/api/dashboard/guilds/:id/staff/roles', ({ body }) => {
    const roleId = body?.roleId;
    const r = ROLES.find((x) => x.id === roleId) || { name: 'Staff' };
    const newStaffRole = {
      id: `staff-role-${Date.now()}`,
      roleId,
      name: r.name,
      level: body?.level ?? 1,
      permissions: body?.permissions ?? [],
    };
    demoDb.update('staff-roles', staffRolesSeed, (list) => [...list, newStaffRole]);
    return { success: true, role: newStaffRole };
  });

  // PATCH /api/dashboard/guilds/:id/staff/roles/order
  route('PATCH', '/api/dashboard/guilds/:id/staff/roles/order', ({ body }) => {
    const order = body?.order as string[] ?? [];
    demoDb.update('staff-roles', staffRolesSeed, (list) => {
      return [...list].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    });
    return { success: true };
  });

  // PATCH /api/dashboard/guilds/:id/staff/roles/:roleId
  route('PATCH', '/api/dashboard/guilds/:id/staff/roles/:roleId', ({ params, body }) => {
    demoDb.update<any[]>('staff-roles', staffRolesSeed, (list) => {
      const idx = list.findIndex((r) => r.id === params.roleId);
      if (idx >= 0) list[idx] = { ...list[idx], ...body };
      return list;
    });
    return { success: true };
  });

  // DELETE /api/dashboard/guilds/:id/staff/roles/:roleId
  route('DELETE', '/api/dashboard/guilds/:id/staff/roles/:roleId', ({ params }) => {
    demoDb.update<any[]>('staff-roles', staffRolesSeed, (list) => list.filter((r) => r.id !== params.roleId));
    return { success: true };
  });

  // GET /api/dashboard/guilds/:id/staff/config
  route('GET', '/api/dashboard/guilds/:id/staff/config', () => {
    return { config: demoDb.get('staff-config', staffConfigSeed) };
  });

  // PATCH /api/dashboard/guilds/:id/staff/config
  route('PATCH', '/api/dashboard/guilds/:id/staff/config', ({ body }) => {
    const updated = demoDb.update('staff-config', staffConfigSeed, (current) => ({ ...current, ...body }));
    return { success: true, config: updated };
  });

  // GET /api/dashboard/guilds/:id/staff/hierarchies
  route('GET', '/api/dashboard/guilds/:id/staff/hierarchies', () => {
    return { hierarchies: demoDb.get('staff-hierarchies', staffHierarchiesSeed) };
  });

  // POST /api/dashboard/guilds/:id/staff/hierarchies
  route('POST', '/api/dashboard/guilds/:id/staff/hierarchies', ({ body }) => {
    const newHier = {
      id: `hier-${Date.now()}`,
      name: body?.name || 'Nouvelle Hiérarchie',
      roles: body?.roles || [],
    };
    demoDb.update('staff-hierarchies', staffHierarchiesSeed, (list) => [...list, newHier]);
    return { success: true, hierarchy: newHier };
  });

  // PATCH /api/dashboard/guilds/:id/staff/hierarchies
  route('PATCH', '/api/dashboard/guilds/:id/staff/hierarchies', ({ body }) => {
    return { success: true, ...body };
  });
}
