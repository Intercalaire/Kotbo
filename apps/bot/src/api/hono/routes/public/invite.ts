/**
 * Entrée du tunnel d'acquisition : « Ajouter le bot à mon serveur ».
 *
 * Pourquoi une redirection côté bot plutôt qu'un lien écrit en dur sur la
 * landing : c'est le seul endroit où l'on voit passer *tous* ceux qui
 * cliquent, y compris ceux qui abandonnent plus loin. Sans ce point de
 * passage, la première mesure disponible est l'arrivée du bot sur un serveur -
 * on ne mesure alors que les gagnants.
 *
 * Où mène le clic : vers « Mes serveurs » du dashboard, et non plus vers
 * l'écran d'autorisation Discord. L'ancien trajet envoyait un visiteur anonyme
 * choisir un serveur dans une liste Discord, puis le laissait sur un écran de
 * fin sans rien à faire ensuite - le bot était posé, personne ne savait où
 * aller. En passant par le dashboard, la connexion Discord a lieu d'abord, le
 * serveur est choisi dans une liste qui sait lesquels ont déjà Kotbo, et
 * l'invitation qui suit préselectionne le bon serveur puis revient sur la
 * prise en main.
 *
 * La route ne pose toujours aucun cookie et ne lit aucune session : elle est
 * appelée par des visiteurs anonymes, souvent avant même d'avoir un compte.
 * C'est le dashboard, à l'arrivée, qui demande la connexion.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { PermissionFlagsBits } from 'discord.js';
import { getDiscordClientId, getDashboardUrl } from '../../../shared.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Permissions demandées à l'invitation.
 *
 * Énumérées plutôt que résumées par `Administrator` : un administrateur qui
 * découvre Kotbo lit cet écran, et « Administrateur » sur un bot inconnu fait
 * fermer l'onglet. La liste est longue parce que le produit est large, mais
 * chaque ligne correspond à une fonctionnalité réellement vendue - et Discord
 * l'affiche telle quelle.
 *
 * Calculé à partir de `PermissionFlagsBits` et non écrit en nombre magique :
 * un entier de vingt chiffres ne se relit pas, et personne ne saurait dire ce
 * qu'on y a ajouté six mois plus tard.
 */
const INVITE_PERMISSIONS = [
  // Mise en place du serveur : salons, rôles, catégories.
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ViewChannel,
  // Modération.
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageNicknames,
  // Journaux et statistiques : sans l'audit, on ne sait pas *qui* a agi.
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.ManageGuild,
  // Publication : panneaux, annonces, tickets, accueil.
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.MentionEveryone,
  // Fils : tickets, candidatures, accueil guidé.
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.ManageThreads,
  // Webhooks : journaux et relais entre serveurs.
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.CreateInstantInvite,
  PermissionFlagsBits.ManageGuildExpressions,
  // Vocal : salons temporaires, modération vocale, événements.
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.ManageEvents,
].reduce((acc, flag) => acc | flag, 0n).toString();

/**
 * Provenances acceptées. Fermé plutôt qu'ouvert : la valeur finit dans les
 * journaux et, plus tard, dans les statistiques d'acquisition. Laisser passer
 * une chaîne libre venue de l'URL y ferait entrer n'importe quoi.
 */
const KNOWN_SOURCES = new Set(['landing', 'docs', 'discord', 'dashboard', 'direct']);

function normalizeSource(value: string | undefined): string {
  if (!value) return 'direct';
  const trimmed = value.trim().toLowerCase();
  return KNOWN_SOURCES.has(trimmed) ? trimmed : 'other';
}

export function createPublicInviteRouter(): OpenAPIHono {
  const router = new OpenAPIHono();

  // GET /api/public/invite - mène à « Mes serveurs » du dashboard.
  //
  // `?direct=1` court-circuite le détour et repart vers l'écran d'autorisation
  // Discord : c'est le trajet dont ont besoin les liens déjà publiés (Discord,
  // documentation, signatures) et le support quand un compte ne peut pas se
  // connecter au dashboard. Le trajet par défaut, lui, reste celui du tunnel.
  router.get('/api/public/invite', (c) => {
    const clientId = getDiscordClientId();

    // Sans `client_id`, l'URL Discord serait valide mais mènerait à une page
    // d'erreur : mieux vaut le dire ici, où le message est lisible.
    if (!clientId) {
      logger.error('Invite', "DISCORD_CLIENT_ID absent : l'invitation ne peut pas être construite.");
      return c.json({ error: "L'invitation n'est pas disponible pour le moment." }, 503);
    }

    const source = normalizeSource(c.req.query('utm_source'));
    const direct = c.req.query('direct') === '1';

    // Trace minimale en attendant la table du tunnel d'acquisition : elle
    // permet déjà de comparer les volumes par provenance dans les journaux.
    logger.info('Invite', `Invitation lancée depuis « ${source} »${direct ? ' (trajet direct)' : ''}.`);

    if (!direct) {
      // La provenance est repassée au dashboard : c'est lui qui, à l'arrivée,
      // saura dire combien de visiteurs venus de la landing sont allés
      // jusqu'à poser le bot.
      const dashboard = getDashboardUrl().replace(/\/$/, '');
      return c.redirect(`${dashboard}/servers?utm_source=${encodeURIComponent(source)}`, 302);
    }

    const params = new URLSearchParams({
      client_id: clientId,
      permissions: INVITE_PERMISSIONS,
      // `applications.commands` en plus de `bot` : sans lui, aucune commande
      // slash n'apparaît, et le serveur croit le bot cassé.
      scope: 'bot applications.commands',
      // L'écran laisse choisir le serveur. Le forcer supposerait qu'on sache
      // déjà lequel, ce qui n'est pas le cas sur ce trajet de secours.
      disable_guild_select: 'false',
    });

    return c.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`, 302);
  });

  return router;
}
