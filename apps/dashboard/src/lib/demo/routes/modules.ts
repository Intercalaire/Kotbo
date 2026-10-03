/**
 * Routes de démo pour l'activation et les presets des modules.
 */
import { route } from '../backend';
import { demoDb } from '../db';
import { moduleItems, moduleStatesSeed } from '../fixtures';

export function registerModulesRoutes(): void {
  // GET /api/dashboard/guilds/:id/modules
  route('GET', '/api/dashboard/guilds/:id/modules', () => {
    const states = demoDb.get('module-states', moduleStatesSeed);
    return { modules: moduleItems(states) };
  });

  // PUT /api/dashboard/guilds/:id/modules/:moduleId
  route('PUT', '/api/dashboard/guilds/:id/modules/:moduleId', ({ params, body }) => {
    const moduleId = params.moduleId;
    const requestedStatus = body?.status;
    const isActivating = requestedStatus === 'active';

    const states = demoDb.update('module-states', moduleStatesSeed, (current) => {
      return { ...current, [moduleId]: isActivating };
    });

    return {
      success: true,
      status: states[moduleId] ? 'active' : 'inactive',
    };
  });

  // POST /api/dashboard/guilds/:id/presets
  route('POST', '/api/dashboard/guilds/:id/presets', ({ body }) => {
    const presetKey = body?.presetKey;
    demoDb.update('module-states', moduleStatesSeed, (current) => {
      const next = { ...current };
      if (presetKey === 'community') {
        next.leveling = true;
        next.economy = true;
        next.fun = true;
      } else if (presetKey === 'security') {
        next.automod = true;
        next.sanctions = true;
        next.logs = true;
      }
      return next;
    });
    return { success: true };
  });
}
