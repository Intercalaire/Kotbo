/**
 * analyticsTrackers.ts
 *
 * Trackers légers pour les statistiques avancées :
 *  - Fréquence des mots (agrégats anonymes, opt-in via wordStatsEnabled)
 *  - Complétion de l'onboarding Discord (membership screening : pending → validé)
 */

import { Client, Events, ChannelType, type Message } from 'discord.js';
import prisma from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { getCachedGuild } from '../utils/cache.js';
import { isGuildActivated } from '../utils/activation.js';
import { trackMessageWords, startWordStatsFlusher } from '../services/analytics/wordStatsService.js';
import { isAnalyticsCollectionEnabled } from '../services/analytics/analyticsConsent.js';

async function handleMessageForWordStats(message: Message): Promise<void> {
  const guildId = message.guild?.id;
  if (!guildId || message.author.bot || !message.content) return;
  if (message.channel.type === ChannelType.DM) return;
  if (!isGuildActivated(guildId)) return;

  const guildConfig = await getCachedGuild(guildId);
  // `analyticsEnabled` prime : couper le module de collecte doit tout arrêter,
  // y compris les agrégats de mots restés activés dans un coin de la config.
  if (!guildConfig?.analyticsEnabled || !guildConfig.wordStatsEnabled) return;

  trackMessageWords(guildId, message.content);
}

export function registerAnalyticsTrackers(client: Client): void {
  startWordStatsFlusher();

  client.on(Events.MessageCreate, (message: Message) => {
    void handleMessageForWordStats(message).catch((err) => {
      logger.error('AnalyticsTrackers', 'Erreur word stats:', err);
    });
  });

  // Onboarding Discord complété : le membre passe de pending à validé
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      if (!oldMember.pending || newMember.pending) return;
      if (!isGuildActivated(newMember.guild.id)) return;
      if (!(await isAnalyticsCollectionEnabled(newMember.guild.id))) return;

      await prisma.memberProfile.updateMany({
        where: {
          guildId: newMember.guild.id,
          userId: newMember.id,
          onboardingCompletedAt: null,
        },
        data: { onboardingCompletedAt: new Date() },
      });
    } catch (err) {
      logger.error('AnalyticsTrackers', 'Erreur tracking onboarding:', err);
    }
  });

  logger.success('AnalyticsTrackers', 'Trackers analytics avancés enregistrés');
}
