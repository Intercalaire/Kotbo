/**
 * Profil du serveur au moment de l'aiguillage : d'ou part-il ?
 *
 * La premiere page du tunnel pose une question - serveur tout neuf ou serveur
 * deja en place - dont la reponse decide de tout le reste du parcours. La
 * poser a froid, c'est demander a quelqu'un de choisir entre deux mots dont il
 * ne mesure pas les consequences, et se tromper une fois sur deux.
 *
 * Or le serveur porte la reponse. Sa date de creation, son nombre de salons,
 * ses roles, les bots qui y tournent deja : tout cela se lit sans rien
 * demander. Cette route rend ces observations et la recommandation qu'elles
 * dictent, avec les raisons en clair - une recommandation qu'on ne peut pas
 * justifier n'est qu'une case pre-cochee.
 *
 * Elle recommande, elle ne decide pas : les deux cartes restent cliquables.
 * Un serveur ancien qu'on repart de zero existe, et l'inverse aussi.
 */
import { IncomingMessage, ServerResponse } from 'node:http';
import { ChannelType, Client } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { json, readJsonBody, resolveDashboardAccess, pushAudit, getGuildName, type AuthClaims } from '../../shared.js';
import {
  runWiringStep,
  runDemoStep,
  runTrialStep,
  type AutopilotStep,
} from '../../../services/core/onboardingAutopilotService.js';
import { errorMessage } from '../../../utils/errors.js';

/** Au-dela, le serveur a vecu : ses habitudes sont prises, ses salons aussi. */
const ESTABLISHED_AGE_DAYS = 30;
const ESTABLISHED_MEMBERS = 30;
const ESTABLISHED_CHANNELS = 10;
const ESTABLISHED_ROLES = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

type Recommendation = {
  path: 'new' | 'existing';
  /** `sure` quand les signaux concordent, `likely` quand ils se contredisent. */
  confidence: 'sure' | 'likely';
  /** Ce qu'on a observe, en clair. La page les affiche telles quelles. */
  reasons: string[];
};

/** « il y a 3 jours », « il y a 8 mois » - la duree telle qu'on la dirait. */
function humanizeAge(days: number): string {
  if (days < 1) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 31) return `il y a ${days} jours`;
  const months = Math.round(days / 30);
  if (months < 24) return `il y a ${months} mois`;
  return `il y a ${Math.round(days / 365)} ans`;
}

export async function handleOnboardingRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  _url: URL,
  client: Client,
  user: AuthClaims,
): Promise<boolean> {
  if (parts[4] !== 'onboarding') return false;

  const guildId = parts[3];

  const access = await resolveDashboardAccess(client, guildId, user.userId);
  if (!access.canManageSettings) {
    json(res, 403, { error: 'Accès refusé' });
    return true;
  }

  // POST /api/dashboard/guilds/:guildId/onboarding/autopilot
  //
  // Une etape a la fois. Le decoupage n'est pas une commodite d'implementation :
  // la page les enchaine en montrant l'une apres l'autre ce qui vient d'etre
  // fait, et un appel unique qui rendrait tout apres trente secondes de silence
  // produirait le meme serveur sans le meme effet.
  //
  // La pose de la structure n'est pas ici : elle a deja sa route
  // (`server-template/apply`), avec son verrou de concurrence, son plafond
  // global et sa trace d'audit. La rejouer ici aurait duplique les trois.
  if (parts.length === 6 && parts[5] === 'autopilot' && req.method === 'POST') {
    // Ces etapes creent des roles, ecrivent sur Discord et ouvrent un essai :
    // elles n'ont rien a faire dans les mains d'un moderateur.
    if (access.level !== 'admin') {
      json(res, 403, { error: 'Seuls les administrateurs peuvent lancer la mise en place.' });
      return true;
    }

    const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      json(res, 404, { error: 'Serveur Discord introuvable.' });
      return true;
    }

    const body = await readJsonBody(req) as { step?: unknown } | null;
    const step = typeof body?.step === 'string' ? body.step as AutopilotStep : null;

    try {
      let result;
      if (step === 'wiring') result = await runWiringStep(guild);
      else if (step === 'demo') result = await runDemoStep(client, guild);
      else if (step === 'trial') result = await runTrialStep(guild, user.userId);
      else {
        json(res, 400, { error: "Étape inconnue (attendu : wiring, demo ou trial)." });
        return true;
      }

      await pushAudit(guildId, {
        user: user.username ?? user.userId,
        action: `Mise en place automatique — ${step}`,
        context: getGuildName(client, guildId),
        module: 'Configuration',
        eventType: 'Manuel',
        details: `${result.done.join(' | ') || 'Rien à faire'}${result.warnings.length ? ` — Avertissements : ${result.warnings.join(' | ')}` : ''}`,
        channelId: null,
      });

      json(res, 200, result);
    } catch (err) {
      logger.error('OnboardingAPI', `Étape ${step} en échec sur ${guildId}:`, err);
      json(res, 500, { error: `Étape interrompue : ${errorMessage(err)}` });
    }
    return true;
  }

  if (req.method !== 'GET' || parts.length !== 5) return false;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      json(res, 404, { error: 'Serveur introuvable' });
      return true;
    }

    // Le cache des salons peut etre vide sur une guilde tout juste rejointe :
    // sans eux, le compte vaudrait zero et ferait passer n'importe quel
    // serveur pour un serveur neuf.
    if (guild.channels.cache.size === 0) await guild.channels.fetch().catch(() => null);

    const channels = guild.channels.cache;
    const channelCount = channels.filter((channel) => channel.type !== ChannelType.GuildCategory).size;
    const categoryCount = channels.filter((channel) => channel.type === ChannelType.GuildCategory).size;

    // Les roles geres appartiennent a une integration - Kotbo compris : les
    // compter reviendrait a compter les bots deux fois.
    const roleCount = guild.roles.cache.filter((role) => role.id !== guild.id && !role.managed).size;

    /**
     * Les bots deja presents, lus dans le cache sans `fetch`.
     *
     * L'aiguillage doit repondre vite : un `guild.members.fetch()` sur un gros
     * serveur tient l'ecran plusieurs secondes pour un signal qui n'est qu'un
     * appoint. Le cache peut donc etre incomplet, et c'est pourquoi l'absence
     * de bot ne compte jamais comme un signe de serveur neuf : elle ne prouve
     * rien. Leur presence, elle, est certaine.
     *
     * La page `/migration` fait la vraie detection, avec `fetch`, quand c'est
     * son sujet.
     */
    const otherBots = Array.from(guild.members.cache.values())
      .filter((member) => member.user.bot && member.user.id !== client.user?.id)
      .map((member) => ({ id: member.user.id, username: member.user.username }))
      .sort((a, b) => a.username.localeCompare(b.username, 'fr'));

    const ageDays = Math.floor((Date.now() - guild.createdTimestamp) / DAY_MS);
    const memberCount = guild.memberCount ?? 0;

    // Chaque signal vaut un point vers « serveur deja en place ». Aucun ne
    // tranche seul : un serveur ancien peut etre vide, un serveur d'une
    // semaine peut deja compter mille membres.
    const signals: { hit: boolean; reason: string }[] = [
      {
        hit: ageDays >= ESTABLISHED_AGE_DAYS,
        reason: `Serveur créé ${humanizeAge(ageDays)}`,
      },
      {
        hit: memberCount >= ESTABLISHED_MEMBERS,
        reason: `${memberCount} membres`,
      },
      {
        hit: channelCount >= ESTABLISHED_CHANNELS,
        reason: `${channelCount} salons répartis en ${categoryCount} catégorie${categoryCount > 1 ? 's' : ''}`,
      },
      {
        hit: roleCount >= ESTABLISHED_ROLES,
        reason: `${roleCount} rôles déjà en place`,
      },
      {
        hit: otherBots.length > 0,
        reason:
          otherBots.length === 1
            ? `Un autre bot y tourne déjà (${otherBots[0].username})`
            : `${otherBots.length} autres bots y tournent déjà`,
      },
    ];

    const score = signals.filter((signal) => signal.hit).length;
    const isExisting = score >= 2;

    const recommendation: Recommendation = {
      path: isExisting ? 'existing' : 'new',
      confidence: isExisting ? (score >= 3 ? 'sure' : 'likely') : score === 0 ? 'sure' : 'likely',
      reasons: isExisting
        ? signals.filter((signal) => signal.hit).map((signal) => signal.reason)
        : // Un serveur neuf se decrit par ce qu'il n'a pas encore : reprendre
          // les signaux manquants dirait « 0 membres », ce qui est faux et
          // vexant. On dit ce qu'on voit.
          [
            `Serveur créé ${humanizeAge(ageDays)}`,
            `${channelCount} salon${channelCount > 1 ? 's' : ''}, ${roleCount} rôle${roleCount > 1 ? 's' : ''}`,
            otherBots.length === 0 ? 'Aucun autre bot détecté' : null,
          ].filter((reason): reason is string => reason !== null),
    };

    json(res, 200, {
      guild: {
        id: guild.id,
        name: guild.name,
        createdAt: new Date(guild.createdTimestamp).toISOString(),
        ageDays,
        memberCount,
        channelCount,
        categoryCount,
        roleCount,
        otherBots,
      },
      recommendation,
    });
  } catch (err) {
    logger.error('OnboardingAPI', 'Erreur GET onboarding:', err);
    json(res, 500, { error: "Erreur lors de la lecture du serveur" });
  }
  return true;
}
