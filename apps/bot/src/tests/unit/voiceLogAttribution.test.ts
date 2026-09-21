/**
 * Garde de **câblage**, lue sur la source — et c'est délibéré.
 *
 * Le registre d'intention est couvert par `voiceIntentRegistry.test.ts`, qui
 * l'exerce vraiment. Mais un registre correct ne garantit rien si le site de
 * consommation revient à `safeTag(member, userId)` : c'était précisément le
 * bug — le log annonçait « Action réalisée par » la personne qui subissait
 * l'action. Le défaut vit dans **deux lignes d'appel**, pas dans une fonction.
 *
 * Exercer ces deux lignes pour de vrai demanderait de faire tourner l'écouteur
 * `VoiceStateUpdate` d'`advancedLogs.ts` : un module qui touche Prisma, Redis,
 * le journal d'audit et une douzaine de services. Le coût du harnais
 * dépasserait de loin ce qu'il garderait.
 *
 * Ce que ce fichier garde, donc : que les deux appels ne repassent pas l'auteur
 * de l'événement comme s'il en était la cause, et qu'ils demandent bien au
 * registre. Ce qu'il ne garde pas : que l'ensemble fonctionne à l'exécution —
 * il ne remplace pas un test de bout en bout, il empêche une régression de
 * revenir sans qu'on la voie.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE = readFileSync(
  path.resolve(import.meta.dir, '../../events/advancedLogs.ts'),
  'utf8',
).split('\n');

function appelSendLogEmbed(eventType: string): { ligne: string; contexteAvant: string } {
  const index = SOURCE.findIndex((ligne) => ligne.includes('sendLogEmbed(') && ligne.includes(`'${eventType}'`));
  if (index === -1) throw new Error(`Aucun appel à sendLogEmbed pour « ${eventType} » dans advancedLogs.ts`);
  return { ligne: SOURCE[index], contexteAvant: SOURCE.slice(Math.max(0, index - 8), index).join('\n') };
}

describe('attribution des événements vocaux', () => {
  for (const [eventType, genre] of [['voice_leave', 'disconnect'], ['voice_move', 'move']] as const) {
    test(`${eventType} n'attribue plus l'action au membre qui la subit`, () => {
      const { ligne } = appelSendLogEmbed(eventType);
      expect(ligne).not.toContain('safeTag');
    });

    test(`${eventType} demande son auteur au registre, en genre « ${genre} »`, () => {
      const { contexteAvant } = appelSendLogEmbed(eventType);
      expect(contexteAvant).toContain('prendreIntentionVocale(');
      expect(contexteAvant).toContain(`'${genre}'`);
    });
  }

  test("voice_join garde son auteur : un membre ne peut pas être connecté de force", () => {
    // Témoin, et précision du périmètre. Discord ne permet pas de déplacer vers
    // un salon vocal quelqu'un qui n'y est pas déjà : une arrivée est
    // nécessairement volontaire, `safeTag(member, userId)` y désigne donc bien
    // l'auteur. Corriger ce site-là serait une régression.
    const { ligne } = appelSendLogEmbed('voice_join');
    expect(ligne).toContain('safeTag');
  });
});
