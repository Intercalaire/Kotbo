/**
 * analyticsLiveTracker.ts
 *
 * Alimente le temps réel d'Analytics (analyticsLiveService) : messages,
 * arrivées et départs, pour les serveurs qui collectent leurs analytics.
 * Les bots, messages système et webhooks ne comptent pas.
 */

import { Events, type Client, type GuildMember, type Message, type PartialGuildMember } from 'discord.js';
import { logger } from '../utils/logger.js';
import { isGuildActivated } from '../utils/activation.js';
import { isAnalyticsCollectionEnabled } from '../services/analytics/analyticsConsent.js';
import { liveJoin, liveLeave, liveMessage } from '../services/analytics/analyticsLiveService.js';

async function collecting(guildId: string): Promise<boolean> {
  return isGuildActivated(guildId) && (await isAnalyticsCollectionEnabled(guildId));
}

export function registerAnalyticsLiveTracker(client: Client): void {
  client.on(Events.MessageCreate, (message: Message) => {
    const guild = message.guild;
    if (!guild || message.author.bot || message.system || message.webhookId) return;
    void collecting(guild.id)
      .then((ok) => {
        if (!ok) return;
        const channel = message.channel;
        const channelId = channel.isThread() && channel.parentId ? channel.parentId : message.channelId;
        liveMessage(guild.id, channelId, message.author.id, message.createdTimestamp);
      })
      .catch((err) => logger.error('AnalyticsLive', 'Suivi live impossible :', err));
  });

  const onMember = (kind: 'join' | 'leave') => (member: GuildMember | PartialGuildMember) => {
    if (member.user?.bot) return;
    void collecting(member.guild.id)
      .then((ok) => {
        if (ok) (kind === 'join' ? liveJoin : liveLeave)(member.guild.id);
      })
      .catch((err) => logger.error('AnalyticsLive', 'Suivi live impossible :', err));
  };
  client.on(Events.GuildMemberAdd, onMember('join'));
  client.on(Events.GuildMemberRemove, onMember('leave'));
}
