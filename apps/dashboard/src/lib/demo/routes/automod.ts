/**
 * Routes de démo pour le module AutoMod.
 */
import { route } from '../backend';
import { demoDb } from '../db';
import { row, merge } from '../model';

function autoModSeed() {
  return row('AutoModConfig', {
    discordAutoModEnabled: true,
    spamEnabled: true,
    spamLimit: 5,
    spamIntervalSeconds: 5,
    spamAction: 'TIMEOUT',
    linksEnabled: true,
    linksAction: 'DELETE_AND_WARN',
    linksWhitelist: ['youtube.com', 'twitch.tv', 'github.com', 'twitter.com', 'x.com'],
    capsEnabled: true,
    capsThresholdPercent: 75,
    capsMinLength: 10,
    emojisEnabled: false,
    emojisLimit: 8,
    mentionsEnabled: true,
    mentionsLimit: 4,
    ghostPingEnabled: true,
    ghostPingAction: 'ALERT',
    antiEveryoneEnabled: true,
    antiEveryoneAction: 'DELETE_AND_WARN',
  });
}

export function registerAutoModRoutes(): void {
  // GET /api/dashboard/guilds/:id/automod
  route('GET', '/api/dashboard/guilds/:id/automod', () => {
    const config = demoDb.get('automod-config', autoModSeed);
    return { config, isOwner: true };
  });

  // PATCH /api/dashboard/guilds/:id/automod
  route('PATCH', '/api/dashboard/guilds/:id/automod', ({ body }) => {
    const config = demoDb.update('automod-config', autoModSeed, (current) => merge(current, body));
    return { success: true, config };
  });
}
