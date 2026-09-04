/**
 * Parcours de configuration : ce qui est en place, ce qui manque, et ou aller.
 *
 * Kotbo a une centaine de reglages repartis sur autant de pages. Un serveur qui
 * vient de l'activer n'a aucun moyen de savoir par ou commencer, ni de verifier
 * qu'il n'a rien oublie d'essentiel. Cette route repond aux deux questions au
 * meme endroit, en lisant la configuration reelle plutot qu'en tenant un
 * compteur d'etapes franchies - un reglage efface doit redevenir « a faire ».
 *
 * Le parcours sert aussi de tunnel d'entree : c'est ce qu'on monte avant de
 * payer. D'ou deux exigences qu'un simple pense-bete n'aurait pas.
 *
 * D'abord aller assez loin. Un serveur reduit a un salon de logs et un role
 * moderateur n'a pas de quoi convaincre : on ne mesure Kotbo qu'une fois
 * l'accueil, les tickets et les niveaux poses. Les etapes couvrent donc les
 * quatre moments du serveur, pas seulement ses fondations.
 *
 * Ensuite distinguer l'indispensable du souhaitable. Toutes les etapes ne se
 * valent pas : sans salon de logs le bot travaille en silence, sans starboard
 * il ne manque rien. `essential` porte cette difference, et c'est elle qui
 * permet au tunnel de dire « le serveur tient debout » sans exiger que les
 * seize points soient coches.
 */
import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { json, resolveDashboardAccess, type AuthClaims } from '../../shared.js';

/**
 * Les quatre moments d'un serveur, dans l'ordre ou ils se posent.
 *
 * Ce sont aussi les categories de la formation apres activation : un parcours
 * et une formation qui ne decoupent pas le sujet pareil obligeraient a tenir
 * deux tables des matieres pour le meme serveur.
 */
type SetupGroup = 'fondations' | 'moderation' | 'accueil' | 'engagement';

type SetupStep = {
  key: string;
  /** Regroupement affiche : l'ordre des groupes est l'ordre conseille. */
  group: SetupGroup;
  label: string;
  /** Ce que le serveur y gagne. Sans cela, une case a cocher n'est qu'une corvee. */
  why: string;
  done: boolean;
  /**
   * Vrai quand le serveur fonctionne mal sans ce point - pas quand il serait
   * mieux avec. C'est ce qui separe « a faire avant d'ouvrir » de « a voir un
   * jour », et le tunnel s'en sert pour savoir quand il peut conclure.
   */
  essential: boolean;
  /** Page ou regler le point. */
  href: string;
  /** Ce qui manque precisement, quand ce n'est pas evident. */
  detail?: string;
};

/** Vrai si la chaine porte une valeur exploitable. */
function filled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Enumere ce qui manque parmi des pieces nommees : « catégorie, rôle du staff ». */
function missing(pieces: { label: string; ok: boolean }[]): string | undefined {
  const absent = pieces.filter((piece) => !piece.ok).map((piece) => piece.label);
  return absent.length > 0 ? absent.join(', ') : undefined;
}

export async function handleSetupRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  _url: URL,
  client: Client,
  user: AuthClaims,
): Promise<boolean> {
  if (parts[4] !== 'setup') return false;
  if (req.method !== 'GET' || parts.length !== 5) return false;

  const guildId = parts[3];

  const access = await resolveDashboardAccess(client, guildId, user.userId);
  if (!access.canManageSettings) {
    json(res, 403, { error: 'Accès refusé' });
    return true;
  }

  try {
    const [guild, features] = await Promise.all([
      prisma.guild.findUnique({
        where: { id: guildId },
        select: {
          logChannelId: true,
          moderatorRoleId: true,
          baseStaffRoleId: true,
          regulationChannelId: true,
          regulationVerificationEnabled: true,
          publicChannelId: true,
          timezone: true,
          language: true,
          ticketCategoryId: true,
          ticketStaffRoleId: true,
          ticketChannelId: true,
          sanctionAlertChannelId: true,
          ticketQuotaOpenEnabled: true,
          digestEnabled: true,
          digestChannelId: true,
          // Les trois configurations qui vivent dans leur propre table : les
          // lire ici evite trois allers-retours de plus pour trois booleens.
          welcomeConfig: {
            select: { welcomeEnabled: true, welcomeChannelId: true, joinRoleId: true },
          },
          welcomeThreadConfig: { select: { enabled: true, channelId: true } },
          levelConfig: { select: { enabled: true } },
        },
      }),
      prisma.dashboardFeatureConfig.findMany({
        where: { guildId },
        select: { featureKey: true, enabled: true },
      }),
    ]);

    if (!guild) {
      json(res, 404, { error: 'Serveur introuvable' });
      return true;
    }

    // Un module sans ligne de configuration est actif : c'est la convention du
    // reste du code, un serveur neuf ne doit pas apparaitre tout eteint.
    const enabled = (key: string) => features.find((f) => f.featureKey === key)?.enabled ?? true;

    const welcome = guild.welcomeConfig;
    const welcomeThread = guild.welcomeThreadConfig;

    const steps: SetupStep[] = [
      // ── Fondations : ce sur quoi tout le reste s'appuie ─────────────────
      {
        key: 'logs',
        group: 'fondations',
        label: 'Salon de logs',
        why: "Sans lui, aucune trace de ce que fait le bot ni de ce qui se passe sur le serveur.",
        done: filled(guild.logChannelId),
        essential: true,
        href: '/logs',
      },
      {
        key: 'moderator-role',
        group: 'fondations',
        label: 'Rôle modérateur',
        why: "Il décide qui peut sanctionner et prendre en charge un ticket. Sans lui, seuls les administrateurs le peuvent.",
        done: filled(guild.moderatorRoleId),
        essential: true,
        href: '/security/sanctions',
      },
      {
        key: 'staff-role',
        group: 'fondations',
        label: 'Rôle du staff',
        why: "Il désigne l'équipe : réunions, absences, tâches et évaluations s'adressent à ceux qui le portent.",
        done: filled(guild.baseStaffRoleId),
        essential: false,
        href: '/staff-management',
      },
      {
        key: 'timezone',
        group: 'fondations',
        label: 'Fuseau horaire',
        why: "Le bot tourne en UTC : sans fuseau, toute date affichée ou saisie est décalée.",
        // `timezone` a une valeur par defaut : le point est fait, il est
        // rappele pour que personne ne decouvre le decalage apres coup.
        done: filled(guild.timezone),
        essential: true,
        href: '/',
        detail: guild.timezone ?? undefined,
      },

      // ── Moderation : de quoi encadrer, et le defendre ───────────────────
      {
        key: 'regulation',
        group: 'moderation',
        label: 'Règlement publié',
        why: "Une sanction sans règle écrite se conteste. Le règlement sert aussi de référence aux rapports.",
        done: filled(guild.regulationChannelId),
        essential: true,
        href: '/regulation',
      },
      {
        key: 'security',
        group: 'moderation',
        label: 'Protection activée',
        why: "Filtres AutoMod et anti-raid. Un niveau de protection les règle tous d'un coup.",
        done: enabled('automod') && enabled('raid_protection'),
        essential: true,
        href: '/security/quick-setup',
      },
      {
        key: 'sanction-alerts',
        group: 'moderation',
        label: 'Salon des alertes de sanction',
        why: "Le staff voit passer les sanctions au lieu de les découvrir dans le casier.",
        done: filled(guild.sanctionAlertChannelId),
        essential: false,
        href: '/security/sanctions',
      },
      {
        key: 'regulation-verification',
        group: 'moderation',
        label: "Validation du règlement à l'entrée",
        why: "Un arrivant qui n'a pas validé le règlement n'accède à rien : les raids s'arrêtent à la porte.",
        done: guild.regulationVerificationEnabled,
        essential: false,
        href: '/regulation',
      },

      // ── Accueil : la premiere heure d'un arrivant ───────────────────────
      {
        key: 'welcome-message',
        group: 'accueil',
        label: "Message de bienvenue",
        why: "Un serveur qui n'accueille pas perd la moitié de ses arrivants dans la première heure.",
        done: enabled('welcome_goodbye')
          && !!welcome?.welcomeEnabled
          && filled(welcome?.welcomeChannelId),
        essential: true,
        href: '/welcome',
        detail: missing([
          { label: 'accueil activé', ok: !!welcome?.welcomeEnabled },
          { label: "salon d'accueil", ok: filled(welcome?.welcomeChannelId) },
        ]),
      },
      {
        key: 'join-role',
        group: 'accueil',
        label: "Rôle donné à l'arrivée",
        why: "Sans rôle automatique, chaque arrivant attend qu'un humain lui ouvre le serveur.",
        done: filled(welcome?.joinRoleId),
        essential: false,
        href: '/welcome/autoroles',
      },
      {
        key: 'welcome-thread',
        group: 'accueil',
        label: "Fil d'accueil",
        why: "Un fil privé par arrivant : il pose ses questions sans encombrer le salon général.",
        done: !!welcomeThread?.enabled && filled(welcomeThread?.channelId),
        essential: false,
        href: '/welcome/thread',
      },
      {
        key: 'public-channel',
        group: 'accueil',
        label: 'Salon public principal',
        why: "Ce que le bot annonce à tout le serveur - événements, résultats, rappels - se poste là.",
        done: filled(guild.publicChannelId),
        essential: false,
        href: '/',
      },

      // ── Vie du serveur : ce qui fait revenir ────────────────────────────
      {
        key: 'tickets',
        group: 'engagement',
        label: 'Tickets opérationnels',
        why: "Catégorie, rôle du staff et salon du panneau : sans les trois, un membre ne peut pas ouvrir de ticket.",
        done: enabled('tickets')
          && filled(guild.ticketCategoryId)
          && filled(guild.ticketStaffRoleId)
          && filled(guild.ticketChannelId),
        essential: true,
        href: '/tickets/config',
        detail: missing([
          { label: 'catégorie', ok: filled(guild.ticketCategoryId) },
          { label: 'rôle du staff', ok: filled(guild.ticketStaffRoleId) },
          { label: 'salon du panneau', ok: filled(guild.ticketChannelId) },
        ]),
      },
      {
        key: 'ticket-quotas',
        group: 'engagement',
        label: 'Quotas de tickets',
        why: "Sans quota, rien n'empêche un membre d'ouvrir dix tickets d'affilée.",
        done: guild.ticketQuotaOpenEnabled,
        essential: false,
        href: '/tickets/config',
      },
      {
        key: 'leveling',
        group: 'engagement',
        label: 'Niveaux activés',
        why: "L'XP donne une raison de revenir écrire, et une échelle lisible pour distribuer les rôles.",
        done: enabled('leveling') && !!guild.levelConfig?.enabled,
        essential: false,
        href: '/leveling',
      },
      {
        key: 'suggestions',
        group: 'engagement',
        label: 'Boîte à suggestions',
        why: "Les demandes des membres arrivent au même endroit au lieu de se perdre dans le général.",
        done: enabled('suggestions') && guild.digestEnabled && filled(guild.digestChannelId),
        essential: false,
        href: '/suggestions',
      },
    ];

    const done = steps.filter((s) => s.done).length;
    const essentials = steps.filter((s) => s.essential);
    const essentialDone = essentials.filter((s) => s.done).length;

    json(res, 200, {
      steps,
      progress: {
        done,
        total: steps.length,
        essentialDone,
        essentialTotal: essentials.length,
        /**
         * Le serveur tient debout : le tunnel peut conclure.
         *
         * Pas « tout est fait » - personne ne coche seize points d'affilee, et
         * attendre le seizieme pour proposer l'activation reviendrait a ne
         * jamais la proposer.
         */
        ready: essentialDone === essentials.length,
      },
    });
  } catch (err) {
    logger.error('SetupAPI', 'Erreur GET setup:', err);
    json(res, 500, { error: 'Erreur lors du calcul du parcours' });
  }
  return true;
}
