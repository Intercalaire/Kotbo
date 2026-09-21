/**
 * La classification des erreurs Discord.
 *
 * Le défaut corrigé : `classifyDiscord` écartait tout ce qui n'avait pas
 * exactement `name === 'DiscordAPIError'`. Or `@discordjs/rest` redéfinit cet
 * accesseur pour y glisser le code — `DiscordAPIError[50013]`. La comparaison
 * était donc **toujours** fausse, et toute la classification retombait en
 * silence sur « erreur interne » : droits insuffisants, ressource absente,
 * quota dépassé, panne amont, tout se ressemblait.
 *
 * Aucun `mock.module` : `classifyFailure` est une fonction pure, et les erreurs
 * sont de vraies instances de `DiscordAPIError`. C'est indispensable ici —
 * une doublure qui se contenterait de poser `name` et `code` ne prouverait
 * rien, puisque c'est précisément le comportement de l'accesseur réel qui est
 * en cause.
 */
import { describe, expect, test } from 'bun:test';
import { DiscordAPIError } from 'discord.js';
import { classifyFailure } from '../../utils/failureKind.js';

function erreurDiscord(code: number, status: number, message = 'Erreur'): DiscordAPIError {
  return new DiscordAPIError(
    { code, message },
    code,
    status,
    'POST',
    '/channels/123/messages',
    { body: undefined, files: undefined },
  );
}

describe('classifyFailure sur une erreur Discord', () => {
  test("le nom d'un DiscordAPIError porte son code, jamais la chaîne nue", () => {
    // Le fait qui rendait la garde morte. Si cette assertion venait à changer
    // (nouvelle version de @discordjs/rest), c'est ici qu'on le verrait
    // d'abord, avant que la classification ne redevienne silencieusement
    // fausse.
    const erreur = erreurDiscord(50013, 403);
    expect(erreur.name).not.toBe('DiscordAPIError');
    expect(erreur.name).toBe('DiscordAPIError[50013]');
  });

  test('droits insuffisants : 403, pas une erreur interne', () => {
    expect(classifyFailure(erreurDiscord(50013, 403)).code).toBe('missing_permissions');
    expect(classifyFailure(erreurDiscord(50013, 403)).status).toBe(403);
  });

  test('ressource inconnue : 404, pas une erreur interne', () => {
    expect(classifyFailure(erreurDiscord(10003, 404)).code).toBe('discord_unknown_resource');
  });

  test('un corps de requête refusé est nommé pour ce qu il est', () => {
    // 50035 dit que le message que NOUS avons construit est invalide — un champ
    // trop long, un champ vide. C'est un défaut du bot, pas de la configuration
    // du serveur ni de ses droits. Le confondre avec une panne interne
    // quelconque empêche de le voir.
    const resultat = classifyFailure(erreurDiscord(50035, 400, 'Invalid Form Body'));
    expect(resultat.code).toBe('discord_invalid_payload');
    expect(resultat.status).toBe(400);
  });

  test('quota dépassé : reconnu comme tel', () => {
    expect(classifyFailure(erreurDiscord(0, 429)).code).toBe('discord_rate_limited');
  });

  test('panne amont : reconnue comme telle', () => {
    expect(classifyFailure(erreurDiscord(0, 503)).code).toBe('upstream_unavailable');
  });

  test("témoin : une erreur qui n'est pas de Discord reste une erreur interne", () => {
    // Ce cas passe des deux côtés — il prouve que le montage ne classe pas tout
    // et n'importe quoi en erreur Discord, donc que les cas précédents
    // mesurent bien quelque chose.
    expect(classifyFailure(new Error('quelque chose a mal tourné')).code).toBe('internal_error');
  });
});
