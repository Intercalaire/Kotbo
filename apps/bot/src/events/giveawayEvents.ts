import { Client, Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { removeMemberFromActiveGiveaways } from '../services/features/giveawayService.js';

/**
 * Ecouteurs des giveaways lies au cycle de vie des membres.
 *
 * Un participant qui quitte le serveur restait inscrit et pouvait etre tire au
 * sort : le lot partait alors a quelqu'un d'injoignable, au detriment des
 * membres encore presents.
 */
export function registerGiveawayEventsListener(client: Client): void {
  client.on(Events.GuildMemberRemove, (member) => {
    // Les bots ne participent pas, inutile d'interroger la base pour eux.
    if (member.user?.bot) return;

    void removeMemberFromActiveGiveaways(client, member.guild.id, member.id)
      .then((removed) => {
        if (removed > 0) {
          logger.info(
            'GiveawayService',
            `${member.id} retire de ${removed} giveaway(s) apres son depart de ${member.guild.id}`,
          );
        }
      })
      .catch((err) =>
        logger.error(
          'GiveawayService',
          `Erreur lors du retrait de ${member.id} des giveaways de ${member.guild.id} :`,
          err,
        ),
      );
  });

  logger.success('GiveawayService', 'Ecouteur de depart des participants enregistre');
}
