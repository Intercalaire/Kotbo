/**
 * Classement des echecs de route, et reponse correspondante.
 *
 * Les routes du dashboard repondaient toutes `500` avec un texte ecrit a la
 * main : « Erreur serveur », « Erreur lors de la mise a jour », « Erreur de
 * base de donnees ». Du cote du navigateur, rien ne permettait de distinguer
 * une base injoignable d'un bug de la route, ni de savoir s'il valait la peine
 * de reessayer. Le dashboard, lui, sait quoi faire d'un 503 : il annonce une
 * coupure et suspend les ecritures. Encore faut-il qu'on le lui envoie.
 *
 * `jsonFailure` regarde ce qui a ete leve, en deduit un statut et un code
 * stable, journalise, et repond. Le texte passe par l'appelant reste le
 * message par defaut : il decrit l'operation, ce qu'aucune classification ne
 * peut deviner.
 */
import type { ServerResponse } from 'node:http';
import { Prisma } from '@prisma/client';
import { json } from './core.js';
import { logger } from '../../utils/logger.js';
import { errorCode, errorMessage } from '../../utils/errors.js';

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
  if (!err || typeof err !== 'object') return null;
  if ((err as { name?: string }).name !== 'DiscordAPIError') return null;

  const code = errorCode(err);
  if (typeof code === 'number') {
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

/**
 * Repond a une route qui a echoue.
 *
 * `fallbackMessage` decrit l'operation ratee et sert quand la panne n'a rien
 * de particulier a dire. Une panne d'infrastructure, elle, impose son propre
 * texte : « Erreur lors de la mise a jour » n'aide personne quand la base est
 * tombee.
 */
export function jsonFailure(
  res: ServerResponse,
  err: unknown,
  fallbackMessage: string,
  scope = 'API',
): void {
  const { status, code, message } = classifyFailure(err);

  // Une panne d'infrastructure vaut une ligne de journal distincte : c'est
  // elle qu'on cherche quand plusieurs routes echouent en meme temps. Les
  // erreurs ordinaires n'en ont pas besoin : la route les journalise deja
  // juste avant d'appeler ici, et doubler la ligne brouillerait la lecture.
  if (code !== 'internal_error') {
    logger.error(scope, `[${code}] ${fallbackMessage} (HTTP ${status}): ${errorMessage(err)}`);
  }

  json(res, status, { error: message ?? fallbackMessage, code });
}
