/**
 * `/privacy` - ce que Kotbo sait de toi, et comment le faire cesser.
 *
 * La reponse est ephemere : demander ou en sont ses donnees ne doit pas
 * s'afficher devant le serveur.
 *
 * Rien ne s'efface d'ici. Sans verification d'identite, un compte emprunte cinq
 * minutes suffirait a effacer les donnees de son proprietaire - sanctions et
 * appels de bannissement compris, qui appartiennent aussi aux serveurs qui les
 * ont prononces. La commande dit donc ou ecrire, ce qui part et ce qui reste,
 * et renvoie a `/opt-out presence` pour ce qu'un membre peut couper seul.
 */

import type { SlashCommandDefinition } from '../../commands.js';
import {
  SlashCommandBuilder,
  MessageFlags,
  InteractionContextType,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { baseEmbed, COLORS } from '../../utils/embeds.js';
import { E } from '../../utils/emojis.js';
import { getEffectiveLocale, getCommandMetadata } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';

const meta = getCommandMetadata('privacy');

/** Adresses publiques, ecrites une seule fois : elles partent dans deux langues. */
export const SITE_URL = 'https://kotbo.fr';
export const PRIVACY_POLICY_URL = 'https://kotbo.fr/privacy';
export const COOKIES_POLICY_URL = 'https://kotbo.fr/cookies';
export const PRIVACY_EMAIL = 'privacy@kotbo.fr';
export const CONTACT_EMAIL = 'contact@kotbo.fr';

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  // Ecrit noir sur blanc plutot que laisse au defaut de l'API : la commande
  // doit rester joignable en message prive, la ou se trouve le membre qui ne
  // veut plus rien avoir a faire avec un serveur - ou qui l'a deja quitte.
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const locale = await getEffectiveLocale(interaction);

  // Le cadenas plutot que le « i » d'information : c'est l'emoji d'application
  // qui dit de quoi parle la fiche. `infoEmbed` impose le sien, d'ou l'embed
  // monte ici sur la meme base - couleur, horodatage et pied de page communs.
  const embed = baseEmbed(COLORS.info)
    .setTitle(`${E.lock} ${m.privacy_title({}, { locale })}`)
    .setDescription(m.privacy_intro({}, { locale }))
    .addFields([
      {
        name: m.privacy_field_data_title({}, { locale }),
        value: m.privacy_field_data_value({}, { locale }),
      },
      {
        name: m.privacy_field_rights_title({}, { locale }),
        value: m.privacy_field_rights_value({}, { locale }),
      },
      {
        // L'identifiant est repris ici pour etre colle dans la demande : sans
        // lui, la boite ne peut la rattacher a aucun compte.
        name: m.privacy_field_erase_title({}, { locale }),
        value: m.privacy_field_erase_value(
          { privacyEmail: PRIVACY_EMAIL, userId: interaction.user.id },
          { locale },
        ),
      },
      {
        name: m.privacy_field_kept_title({}, { locale }),
        value: m.privacy_field_kept_value({}, { locale }),
      },
      {
        name: m.privacy_field_links_title({}, { locale }),
        value: m.privacy_field_links_value(
          {
            siteUrl: SITE_URL,
            policyUrl: PRIVACY_POLICY_URL,
            cookiesUrl: COOKIES_POLICY_URL,
            contactEmail: CONTACT_EMAIL,
          },
          { locale },
        ),
      },
    ]);

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

export const privacyCommand = { data, execute } satisfies SlashCommandDefinition;
