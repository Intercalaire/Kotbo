/**
 * Creation du salon piege : le meme salon, qu'il vienne de la page Gestion des
 * salons ou de la mise en place guidee. Les deux entrees doivent poser le meme
 * appat, sans quoi un serveur monte d'un cote se ferait piloter par l'autre.
 */
import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type OverwriteResolvable,
  type TextChannel,
} from 'discord.js';
import type { BotLocale } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';

export function honeypotChannelName(locale: BotLocale): string {
  return m.setup_template_channel_honeypot({}, { locale });
}

/**
 * Le salon est pose hors categorie et en tete de la liste : un appat range au
 * milieu des salons du serveur ne serait vu par personne, la ou le premier
 * salon de la colonne est celui qu'un bot de spam ouvre en arrivant.
 *
 * Il reste ouvert a @everyone meme sur un serveur ferme : sans le droit d'y
 * ecrire, il n'attrape rien.
 */
export async function provisionHoneypotChannel(guild: Guild, input: {
  name: string;
  reason?: string;
  extraOverwrites?: OverwriteResolvable[];
}): Promise<TextChannel> {
  const channel = await guild.channels.create({
    name: input.name,
    type: ChannelType.GuildText,
    position: 0,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
      ...(input.extraOverwrites ?? []),
    ],
    reason: input.reason,
  });

  const embed = new EmbedBuilder()
    .setTitle('⚠️ SALON PROTECTEUR - NE PAS ÉCRIRE ⚠️')
    .setDescription(
      '### 🛡️ Honeypot de Sécurité\n\n' +
      "Ce salon sert d'appât pour intercepter les bots de spam et les comptes compromis.\n\n" +
      '> 🛑 **RÈGLE CRUCIALE** : Ne postez **absolument aucun** message dans ce salon sous peine de **BANNISSEMENT DÉFINITIF ET IMMÉDIAT** de ce serveur Discord.\n\n' +
      '*Si vous êtes un utilisateur légitime, ignorez ou masquez simplement ce salon.*'
    )
    .setColor(0xEE5555)
    .setTimestamp()
    .setFooter({ text: 'Système de protection Kotbo' });

  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);

  return channel;
}
