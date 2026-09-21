/**
 * Nature d'un echec : base injoignable, cache absent, permission Discord
 * manquante, doublon...
 *
 * La meme panne se presente des deux cotes du bot. Une route dashboard doit la
 * traduire en statut HTTP, une commande Discord en phrase adressee au joueur.
 * Le classement, lui, est identique : il vit donc ici, et non dans l'un des
 * deux appelants.
 *
 * Le code est stable et testable ; le message decrit la panne en francais,
 * a charge de l'appelant de l'habiller.
 */
import { Prisma } from '@prisma/client';
import { DiscordAPIError } from 'discord.js';
import { errorCode } from './errors.js';

/** Code applicatif rendu au dashboard, en plus du statut HTTP. */
export type FailureCode =
  | 'database_unavailable'
  | 'database_timeout'
  | 'cache_unavailable'
  | 'upstream_unavailable'
  | 'upstream_timeout'
  | 'duplicate'
  | 'constraint_violation'
  | 'not_found'
  | 'missing_permissions'
  | 'discord_unknown_resource'
  | 'discord_rate_limited'
  | 'discord_invalid_payload'
  | 'internal_error';

type Classification = {
  status: number;
  code: FailureCode;
  /** Texte propre a la panne, prefere au message de l'appelant quand il existe. */
  message?: string;
};

/**
 * Codes Prisma d'une base hors d'atteinte.
 *
 * P1001 serveur injoignable, P1002 delai de connexion depasse, P1008 delai
 * d'operation depasse, P1017 connexion fermee par le serveur. Tous decrivent
 * une infrastructure absente, pas une requete fautive : la meme requete
 * passera quand la base reviendra.
 */
const PRISMA_UNREACHABLE = new Set(['P1000', 'P1001', 'P1002', 'P1010', 'P1011', 'P1017']);
const PRISMA_TIMEOUT = new Set(['P1008', 'P2024']);

/** Codes systeme d'une dependance qui n'accepte pas la connexion. */
const NETWORK_DOWN = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE']);
const NETWORK_TIMEOUT = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT']);

/**
 * Codes Discord qui decrivent une ressource disparue.
 *
 * Un salon supprime, un message efface, un membre parti : la route n'a rien
 * fait de mal, la cible n'existe plus. Un 404 le dit, un 500 laissait croire
 * a une panne du bot.
 */
const DISCORD_UNKNOWN = new Set([10003, 10004, 10007, 10008, 10011, 10013, 10015, 10026, 10062]);

/** Codes Discord de droits insuffisants. */
const DISCORD_FORBIDDEN = new Set([50001, 50013, 50021, 50025]);

/**
 * Corps de requete refuse par Discord : champ trop long, champ vide, embed
 * hors limites. Contrairement aux precedents, celui-ci n'accuse ni la
 * configuration du serveur ni ses droits — il dit que le message que NOUS avons
 * construit est invalide. C'est un defaut du bot, et le confondre avec une
 * panne interne quelconque empeche de le voir.
 */
const DISCORD_INVALID_PAYLOAD = new Set([50035]);

function classifyPrisma(err: unknown): Classification | null {
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      code: 'database_unavailable',
      message: 'Base de donnees injoignable. Reessayez dans quelques instants.',
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (PRISMA_UNREACHABLE.has(err.code)) {
      return {
        status: 503,
        code: 'database_unavailable',
        message: 'Base de donnees injoignable. Reessayez dans quelques instants.',
      };
    }
    if (PRISMA_TIMEOUT.has(err.code)) {
      return {
        status: 503,
        code: 'database_timeout',
        message: 'La base de donnees met trop de temps a repondre. Reessayez dans quelques instants.',
      };
    }
    if (err.code === 'P2002') {
      return { status: 409, code: 'duplicate', message: 'Cet element existe deja.' };
    }
    if (err.code === 'P2003' || err.code === 'P2014') {
      return {
        status: 409,
        code: 'constraint_violation',
        message: 'Cet element est encore utilise ailleurs et ne peut pas etre modifie ainsi.',
      };
    }
    if (err.code === 'P2025') {
      return { status: 404, code: 'not_found', message: "Cet element n'existe plus." };
    }
  }

  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return {
      status: 503,
      code: 'database_unavailable',
      message: 'Base de donnees indisponible. Reessayez dans quelques instants.',
    };
  }

  return null;
}

/**
 * Panne d'une dependance reseau : Redis, Discord, ou une API tierce.
 *
 * ioredis n'expose pas de classe d'erreur exploitable pour la coupure : on se
 * rabat sur le code systeme, puis sur le nom de l'erreur que la bibliotheque
 * pose elle-meme.
 */
function classifyNetwork(err: unknown): Classification | null {
  const code = errorCode(err);

  if (typeof code === 'string') {
    if (NETWORK_DOWN.has(code)) {
      return {
        status: 503,
        code: 'upstream_unavailable',
        message: 'Un service dont depend cette page est injoignable. Reessayez dans quelques instants.',
      };
    }
    if (NETWORK_TIMEOUT.has(code)) {
      return {
        status: 504,
        code: 'upstream_timeout',
        message: "Un service dont depend cette page n'a pas repondu a temps.",
      };
    }
  }

  const name = err instanceof Error ? err.name : '';
  if (name === 'MaxRetriesPerRequestError' || name === 'ClusterAllFailedError') {
    return {
      status: 503,
      code: 'cache_unavailable',
      message: 'Le cache est injoignable. Reessayez dans quelques instants.',
    };
  }
  if (name === 'TimeoutError' || name === 'AbortError') {
    return {
      status: 504,
      code: 'upstream_timeout',
      message: "Un service dont depend cette page n'a pas repondu a temps.",
    };
  }

  // ioredis annonce la coupure par un message, faute de code dedie.
  if (err instanceof Error && /Connection is (closed|already closed)|Stream isn't writeable/i.test(err.message)) {
    return {
      status: 503,
      code: 'cache_unavailable',
      message: 'Le cache est injoignable. Reessayez dans quelques instants.',
    };
  }

  return null;
}

function classifyDiscord(err: unknown): Classification | null {
  // `instanceof`, et non une comparaison sur `name` : `DiscordAPIError` redefinit
  // son accesseur `name` pour y glisser le code (`DiscordAPIError[50013]`,
  // @discordjs/rest). La comparaison a la chaine nue etait donc toujours fausse,
  // et TOUTE la classification Discord — droits, ressource absente, quota,
  // panne amont — retombait en silence sur « erreur interne ». C'est la forme
  // que prennent les cinq autres sites du depot qui attrapent cette erreur.
  if (!(err instanceof DiscordAPIError)) return null;

  const code = errorCode(err);
  if (typeof code === 'number') {
    if (DISCORD_INVALID_PAYLOAD.has(code)) {
      return {
        status: 400,
        code: 'discord_invalid_payload',
        message: "Le message envoye a Discord a ete refuse : un champ depasse la taille permise ou est vide.",
      };
    }
    if (DISCORD_FORBIDDEN.has(code)) {
      return {
        status: 403,
        code: 'missing_permissions',
        message: "Le bot n'a pas les permissions Discord necessaires pour cette action.",
      };
    }
    if (DISCORD_UNKNOWN.has(code)) {
      return {
        status: 404,
        code: 'discord_unknown_resource',
        message: "La ressource Discord visee n'existe plus.",
      };
    }
  }

  const status = (err as { status?: number }).status;
  if (status === 429) {
    return {
      status: 429,
      code: 'discord_rate_limited',
      message: 'Discord limite les appels du bot. Reessayez dans quelques instants.',
    };
  }
  if (typeof status === 'number' && status >= 500) {
    return {
      status: 503,
      code: 'upstream_unavailable',
      message: 'Discord est momentanement indisponible. Reessayez dans quelques instants.',
    };
  }

  return null;
}

/** Nature de l'echec, ou l'erreur interne par defaut. */
export function classifyFailure(err: unknown): Classification {
  return (
    classifyPrisma(err) ??
    classifyNetwork(err) ??
    classifyDiscord(err) ??
    { status: 500, code: 'internal_error' }
  );
}

/** Message adresse a un utilisateur Discord pour un echec de commande. */
export function interactionFailureMessage(err: unknown): string {
  const { code, message } = classifyFailure(err);
  if (code === 'internal_error' || !message) {
    return "Une erreur est survenue. L'incident a ete signale.";
  }
  return message;
}
