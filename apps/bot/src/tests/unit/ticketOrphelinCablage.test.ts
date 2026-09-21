/**
 * Garde de câblage, lue sur la source — même choix que `voiceLogAttribution`.
 *
 * `decideOrphanedTicket` est exercée pour de vrai par `ticketOrphelin.test.ts`.
 * Mais une décision correcte ne sert à rien si personne ne l'appelle, et deux
 * détails du branchement comptent autant que la décision elle-même :
 *
 * 1. L'abonnement doit vivre dans le module `tickets`. Dans `advancedLogs.ts`,
 *    couper le module « logs » — purement cosmétique — désactiverait du même
 *    coup une protection fonctionnelle.
 * 2. Il doit filtrer sur `OPEN`/`CLAIMED` avant d'appeler quoi que ce soit :
 *    c'est ce qui évite de travailler sur un ticket que la suppression pilotée
 *    par le bot est en train de traiter.
 *
 * Exercer l'abonnement pour de vrai demanderait de mocker Prisma, la porte des
 * modules et le bus — un harnais plus gros que ce qu'il garderait.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function source(relatif: string): string {
  return readFileSync(path.resolve(import.meta.dir, relatif), 'utf8');
}

const MODULE_TICKETS = source('../../modules/tickets.module.ts');

describe('câblage du ticket orphelin', () => {
  test("l'abonnement channel:delete vit dans le module tickets", () => {
    expect(MODULE_TICKETS).toContain("subscribeForModule('tickets', 'channel:delete'");
    expect(MODULE_TICKETS).toContain('markTicketOrphaned(');
  });

  test('il ne considère que les tickets encore ouverts ou pris en charge', () => {
    const debut = MODULE_TICKETS.indexOf("'channel:delete'");
    const bloc = MODULE_TICKETS.slice(debut, debut + 600);
    expect(bloc).toContain("status: { in: ['OPEN', 'CLAIMED'] }");
  });

  test("il n'est pas branché sur le module des logs, qui est cosmétique", () => {
    expect(source('../../events/advancedLogs.ts')).not.toContain('markTicketOrphaned');
  });
});
