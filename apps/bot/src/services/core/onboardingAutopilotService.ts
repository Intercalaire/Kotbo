/**
 * Le pilote automatique du tunnel : monter le serveur a la place de l'admin.
 *
 * Le parcours de prise en main disait quoi regler et ou aller le regler. Seize
 * points, seize pages, et l'essentiel du travail restait a faire par quelqu'un
 * qui decouvre le produit - c'est-a-dire par quelqu'un qui ne sait pas encore
 * ce qu'il cherche. On lui demandait de fournir l'effort avant de lui avoir
 * montre le resultat, ce qui est l'ordre inverse de celui qui donne envie
 * d'acheter.
 *
 * Ici, Kotbo fait le travail et le montre. Quatre etapes, dans cet ordre, parce
 * que chacune s'appuie sur la precedente :
 *
 *   1. `structure` - salons, categories, roles, et les modules qui vont avec.
 *      C'est `applyServerTemplate` qui s'en charge, il sait deja le faire.
 *   2. `wiring`    - les reglages que la maquette ne branche pas d'elle-meme.
 *      Un salon cree ne sert a rien tant que rien ne pointe dessus.
 *   3. `demo`      - les artefacts visibles sur Discord. Un serveur qu'on peut
 *      aller regarder vaut mieux qu'un compte-rendu qui affirme.
 *   4. `trial`     - l'essai, qui allume ce que l'offre gardait eteint.
 *
 * Chaque etape est un appel distinct, et c'est deliberé : la page les enchaine
 * en montrant l'une apres l'autre ce qui vient d'etre fait. Un seul appel qui
 * rendrait tout d'un coup apres trente secondes de silence produirait le meme
 * serveur et pas le meme effet - le travail fourni ne se verrait pas, et c'est
 * sa visibilite qui donne au resultat sa valeur percue.
 *
 * Aucune etape n'ecrase un choix existant. Partout la regle est la meme : on
 * remplit ce qui est vide, on ne corrige pas ce qui est rempli. Un
 * administrateur qui repasse le pilote automatique apres avoir regle deux
 * choses a la main les retrouve intactes.
 */
import type { Client, Guild } from 'discord.js';
import { planForMemberCount } from '@kotbo/contracts';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { activatedGuilds } from '../../utils/activation.js';
import { buildAccessFields, MINUTES_PER_DAY } from '../system/accessService.js';
import { setGuildPlan } from '../system/planService.js';
import { TRIAL_DAYS, reserveTrial } from '../billing/trialService.js';
import { setDashboardModuleStatus } from './moduleActivationService.js';

export const AUTOPILOT_STEPS = ['structure', 'wiring', 'demo', 'trial'] as const;
export type AutopilotStep = (typeof AUTOPILOT_STEPS)[number];

export type AutopilotStepResult = {
  step: AutopilotStep;
  /** Ce qui vient d'etre fait, en clair. La page les affiche telles quelles. */
  done: string[];
  /**
   * Ce qui n'a pas pu etre fait sans que l'etape echoue pour autant. Les taire
   * laisserait croire a une mise en place complete qui ne l'est pas.
   */
  warnings: string[];
  /** Compteurs cumulables pour le recapitulatif final. */
  counts: {
    categories: number;
    channels: number;
    roles: number;
    modules: number;
    settings: number;
  };
};

const NO_COUNTS = { categories: 0, channels: 0, roles: 0, modules: 0, settings: 0 };

// ─────────────────────────────────────────────────────────────
// Branchements
// ─────────────────────────────────────────────────────────────

/**
 * Les reglages que la maquette ne branche pas d'elle-meme.
 *
 * Elle cree les salons et en enregistre quelques-uns ; le reste des colonnes
 * reste vide, et c'est ce que le parcours de prise en main comptait comme « a
 * regler ». Rien ici ne cree quoi que ce soit sur Discord : on branche sur ce
 * qui existe deja.
 *
 * Deux points sont volontairement laisses de cote, et ce n'est pas un oubli :
 *
 *   - la validation du reglement a l'entree ferme le serveur a tout arrivant
 *     tant qu'il n'a pas valide. L'allumer sans le demander sur un serveur
 *     habite couperait ses membres de leurs salons sans prevenir ;
 *   - la boite a suggestions demande un salon que la maquette ne prevoit pas.
 *     En creer un ici, hors du plan, le rendrait invisible a la reprise apres
 *     echec, qui ne connait que les clefs du plan.
 *
 * Tous deux restent au parcours, a regler quand l'admin le decide.
 */
export async function runWiringStep(guild: Guild): Promise<AutopilotStepResult> {
  const guildId = guild.id;
  const done: string[] = [];
  const warnings: string[] = [];

  const config = await prisma.guild.findUnique({
    where: { id: guildId },
    select: {
      logChannelId: true,
      moderatorRoleId: true,
      baseStaffRoleId: true,
      sanctionAlertChannelId: true,
      publicChannelId: true,
      ticketCategoryId: true,
      ticketQuotaOpenEnabled: true,
      welcomeConfig: { select: { welcomeChannelId: true } },
      welcomeThreadConfig: { select: { enabled: true, channelId: true } },
    },
  });

  if (!config) {
    return { step: 'wiring', done, warnings: ['Serveur introuvable en base.'], counts: { ...NO_COUNTS } };
  }

  const data: Record<string, unknown> = {};

  // Le role moderateur decide qui sanctionne. La maquette pose un role staff et
  // l'enregistre pour les tickets ; sans ce report, seuls les administrateurs
  // Discord pouvaient moderer sur un serveur pourtant equipe d'un role staff.
  if (!config.moderatorRoleId && config.baseStaffRoleId) {
    data.moderatorRoleId = config.baseStaffRoleId;
    done.push('Rôle modérateur branché sur le rôle du staff');
  }

  // Les alertes de sanction vont au journal a defaut d'un salon dedie : le
  // staff les voit passer au lieu de les decouvrir dans le casier.
  if (!config.sanctionAlertChannelId && config.logChannelId) {
    data.sanctionAlertChannelId = config.logChannelId;
    done.push('Alertes de sanction dirigées vers le salon de logs');
  }

  // Le salon public porte ce que le bot annonce a tout le serveur. Le salon
  // systeme de Discord est celui que le serveur a lui-meme designe pour ca.
  if (!config.publicChannelId) {
    const target = guild.systemChannelId ?? config.welcomeConfig?.welcomeChannelId ?? null;
    if (target) {
      data.publicChannelId = target;
      done.push('Salon public principal désigné');
    }
  }

  // Un quota n'a de sens qu'une fois les tickets en place. Sans lui, rien
  // n'empeche un membre d'en ouvrir dix d'affilee.
  if (config.ticketCategoryId && !config.ticketQuotaOpenEnabled) {
    data.ticketQuotaOpenEnabled = true;
    done.push("Quota d'ouverture de tickets activé");
  }

  if (Object.keys(data).length > 0) {
    await prisma.guild.update({ where: { id: guildId }, data });
  }

  // Le fil d'accueil vit dans sa propre table : un fil prive par arrivant, dans
  // le salon de bienvenue que la maquette vient de poser.
  const welcomeChannelId = config.welcomeConfig?.welcomeChannelId ?? null;
  if (welcomeChannelId && !config.welcomeThreadConfig?.enabled) {
    await prisma.welcomeThreadConfig.upsert({
      where: { guildId },
      update: { enabled: true, channelId: config.welcomeThreadConfig?.channelId ?? welcomeChannelId },
      create: { guildId, enabled: true, channelId: welcomeChannelId },
    });
    done.push("Fil d'accueil activé");
  }

  // L'anti-raid n'a pas de salon a lui et ne figure donc pas dans la maquette,
  // qui raisonne par salon. C'est pourtant la moitie de « Protection activee »
  // au parcours - l'autre etant AutoMod, que la maquette allume.
  const raid = await setDashboardModuleStatus(guildId, 'raid_protection', true, 'Protection anti-raid', {
    recordIntentWhenLocked: true,
  }).catch((err) => {
    warnings.push("La protection anti-raid n'a pas pu être allumée.");
    logger.warn('Autopilot', `raid_protection refuse sur ${guildId}:`, err);
    return null;
  });
  if (raid) done.push('Protection anti-raid activée');

  if (done.length === 0) done.push('Tous les réglages étaient déjà branchés');

  return {
    step: 'wiring',
    done,
    warnings,
    counts: { ...NO_COUNTS, settings: done.length, modules: raid ? 1 : 0 },
  };
}

// ─────────────────────────────────────────────────────────────
// Ce qui se voit sur Discord
// ─────────────────────────────────────────────────────────────

/**
 * Un reglement de depart, publie.
 *
 * Le salon de regles cree par la maquette reste vide : la table des articles
 * est vierge sur un serveur neuf, et publier n'y poserait qu'un cadre sans
 * contenu. Or c'est le premier artefact qu'un arrivant lit, et le point
 * d'appui de toute sanction defendable.
 *
 * Six articles volontairement generiques et courts, faits pour etre relus et
 * modifies - ils le sont depuis la page Reglement, et la republication suit.
 * Poses uniquement si la table est vide : personne ne veut voir revenir des
 * regles qu'il avait supprimees.
 */
const STARTER_ARTICLES: { emoji: string; title: string; description: string }[] = [
  {
    emoji: '🤝',
    title: 'Respect',
    description: "Insultes, harcèlement, propos haineux et discriminations n'ont pas leur place ici, sous aucune forme, y compris en plaisantant.",
  },
  {
    emoji: '🔞',
    title: 'Contenus interdits',
    description: 'Aucun contenu à caractère sexuel, violent, choquant ou illégal, ni dans les messages, ni dans les pseudos, ni dans les avatars.',
  },
  {
    emoji: '📢',
    title: 'Publicité',
    description: "Pas de publicité ni de démarchage, en salon comme en message privé, sans l'accord du staff.",
  },
  {
    emoji: '🧵',
    title: 'Salons',
    description: "Chaque salon a son sujet : les messages hors-sujet sont déplacés. Évitez le spam, les mentions répétées et les majuscules inutiles.",
  },
  {
    emoji: '🔒',
    title: 'Vie privée',
    description: "Ne publiez jamais d'informations personnelles, les vôtres ou celles d'autrui, sans consentement explicite.",
  },
  {
    emoji: '⚖️',
    title: 'Décisions du staff',
    description: "Les décisions du staff se contestent en ticket, pas en salon public. Toute sanction peut faire l'objet d'un recours.",
  },
];

export async function runDemoStep(client: Client, guild: Guild): Promise<AutopilotStepResult> {
  const guildId = guild.id;
  const done: string[] = [];
  const warnings: string[] = [];
  let settings = 0;

  const config = await prisma.guild.findUnique({
    where: { id: guildId },
    select: { regulationChannelId: true },
  });

  if (!config?.regulationChannelId) {
    warnings.push("Aucun salon de règlement : la publication a été passée.");
  } else {
    const existing = await prisma.guildRegulationArticle.count({ where: { guildId } });
    if (existing === 0) {
      await prisma.guildRegulationArticle.createMany({
        data: STARTER_ARTICLES.map((article, index) => ({
          guildId,
          emoji: article.emoji,
          title: article.title,
          description: article.description,
          sortOrder: index,
        })),
      });
      done.push(`${STARTER_ARTICLES.length} articles de règlement rédigés`);
      settings += 1;
    }

    try {
      const { publishOrUpdateRegulationMessage } = await import('../staff/regulationService.js');
      await publishOrUpdateRegulationMessage(client, guildId);
      done.push('Règlement publié sur Discord');
      settings += 1;
    } catch (err) {
      warnings.push("Le règlement n'a pas pu être publié : vérifiez les droits du bot sur le salon.");
      logger.warn('Autopilot', `Publication du règlement refusée sur ${guildId}:`, err);
    }
  }

  if (done.length === 0) done.push('Rien à publier : tout était déjà en place');

  return { step: 'demo', done, warnings, counts: { ...NO_COUNTS, settings } };
}

// ─────────────────────────────────────────────────────────────
// L'essai
// ─────────────────────────────────────────────────────────────

export type TrialOutcome = {
  granted: boolean;
  days: number;
  expiresAt: string | null;
  plan: string | null;
  /** Pourquoi l'essai n'a pas ete accorde, quand il ne l'a pas ete. */
  reason: 'already_used' | 'has_subscription' | null;
};

/**
 * Ouvre l'essai sans carte, a la fin de la mise en place.
 *
 * L'essai existant passe par Stripe : il demande une carte, que Stripe ne
 * debite pas, et gere ensuite le rappel de fin d'essai et la bascule en
 * abonnement. C'est le bon dispositif pour quelqu'un qui a decide d'acheter -
 * ce n'est pas celui qui convient a la fin d'une mise en place, ou demander une
 * carte pour voir le serveur qu'on vient de monter fonctionner arreterait net
 * la moitie des gens juste avant le moment qui donne envie.
 *
 * L'essai pose ici n'est donc pas un abonnement : c'est un acces date, du meme
 * type que celui qu'un code d'essai accorde, et le cron `access-lifecycle` le
 * fait vivre sans rien savoir de sa provenance.
 *
 * Deux choses le rendent non farmable, et elles etaient deja la : la table
 * `BillingTrial` porte une unicite par compte Discord *et* par serveur. Cet
 * essai la consomme comme l'autre - c'est le meme essai, une seule fois, quelle
 * que soit la porte par laquelle on le prend.
 *
 * L'offre monte en meme temps que l'acces, et c'est indispensable : `moduleGate`
 * lit `Guild.plan` et rien d'autre. Un acces accorde sans offre laisserait
 * l'integralite des modules eteints - un essai pendant lequel rien ne
 * fonctionne.
 */
export async function runTrialStep(
  guild: Guild,
  discordUserId: string,
): Promise<AutopilotStepResult & { trial: TrialOutcome }> {
  const guildId = guild.id;
  const plan = planForMemberCount(guild.memberCount ?? null);

  const existing = await prisma.guild.findUnique({
    where: { id: guildId },
    select: { stripeSubscriptionId: true },
  });
  if (existing?.stripeSubscriptionId) {
    return {
      step: 'trial',
      done: [],
      warnings: ["Ce serveur a déjà un abonnement : l'essai n'a pas lieu d'être."],
      counts: { ...NO_COUNTS },
      trial: { granted: false, days: TRIAL_DAYS, expiresAt: null, plan: null, reason: 'has_subscription' },
    };
  }

  // Reserve avant d'accorder, et non apres : c'est l'insertion qui fait le
  // verrou, et deux clics simultanes ne peuvent donc pas ouvrir deux essais.
  const reserved = await reserveTrial(guildId, discordUserId, plan, 'month');
  if (!reserved) {
    return {
      step: 'trial',
      done: [],
      warnings: ["L'essai gratuit a déjà été utilisé, sur ce serveur ou avec ce compte."],
      counts: { ...NO_COUNTS },
      trial: { granted: false, days: TRIAL_DAYS, expiresAt: null, plan: null, reason: 'already_used' },
    };
  }

  const access = buildAccessFields('TRIAL', TRIAL_DAYS * MINUTES_PER_DAY);

  await prisma.guild.update({
    where: { id: guildId },
    data: {
      activated: true,
      // `activationCode` reste nul : aucun code n'a ete consomme, et c'est ce
      // qui distingue en base un essai libre-service d'un essai offert.
      ...access,
    },
  });
  activatedGuilds.add(guildId);

  // Apres l'acces, jamais avant : une offre posee sur un acces qui echouerait
  // ensuite laisserait un serveur payant sans date de fin.
  await setGuildPlan(guildId, plan, `essai automatique de ${TRIAL_DAYS} jours`);

  logger.success(
    'Autopilot',
    `Essai de ${TRIAL_DAYS} jours ouvert sur ${guildId} (offre ${plan}, fin le ${access.accessExpiresAt?.toISOString()}).`,
  );

  return {
    step: 'trial',
    done: [
      `Essai de ${TRIAL_DAYS} jours ouvert, sans carte bancaire`,
      `Tous les modules de l'offre ${plan} sont allumés`,
    ],
    warnings: [],
    counts: { ...NO_COUNTS },
    trial: {
      granted: true,
      days: TRIAL_DAYS,
      expiresAt: access.accessExpiresAt?.toISOString() ?? null,
      plan,
      reason: null,
    },
  };
}
