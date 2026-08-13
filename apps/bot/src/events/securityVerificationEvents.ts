import { Client, Events, type GuildMember } from 'discord.js';
import prisma from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { sendVerificationDM, cleanupExpiredVerifications } from '../services/moderation/securityVerificationService.js';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5173';

export function registerSecurityVerificationListener(client: Client) {
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    if (member.user.bot) return;

    try {
      const guildConfig = await prisma.guild.findUnique({
        where: { id: member.guild.id },
        select: {
          verificationEnabled: true,
          verificationMode: true,
          verificationOnJoin: true,
          verificationChannelId: true,
        },
      });

      if (!guildConfig?.verificationEnabled || !guildConfig.verificationOnJoin) return;

      if (guildConfig.verificationMode === 'DM') {
        await sendVerificationDM(member, DASHBOARD_URL);
      }
      // EMBED mode: the embed is already deployed in the channel via /verify deploy or dashboard config
      // No action needed on join for EMBED mode - user clicks the persistent button
    } catch (err) {
      logger.error('SecurityVerif', `Erreur lors de la vérification auto pour ${member.user.tag}:`, err);
    }
  });

  // Cleanup expired verifications every 6 hours
  setInterval(async () => {
    try {
      const count = await cleanupExpiredVerifications();
      if (count > 0) {
        logger.info('SecurityVerif', `${count} vérifications expirées nettoyées.`);
      }
    } catch (err) {
      logger.error('SecurityVerif', 'Erreur lors du nettoyage des vérifications expirées:', err);
    }
  }, 6 * 60 * 60 * 1000);

  logger.info('System', 'Écouteur de vérification de sécurité enregistré.');
}
