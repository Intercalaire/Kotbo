/**
 * Un ticket dont le salon a été supprimé directement depuis Discord restait
 * `OPEN` **pour toujours**. Le cron d'inactivité le reprenait toutes les dix
 * minutes (`checkTicketInactivity`), faisait un `client.channels.fetch` qui
 * échouait, et passait au suivant sans rien écrire. Ni le staff ni le dashboard
 * ne pouvaient voir que ce ticket n'existait plus.
 *
 * `decideOrphanedTicket` est pure — elle ne touche ni à la base ni à Discord.
 * Comme `ticketGatekeeping.test.ts`, ce fichier importe donc `ticketService`
 * sans `mock.module`, et n'a pas besoin du préfixe `zz-`.
 */
import { describe, expect, test } from 'bun:test';
import { decideOrphanedTicket, type EtatTicketOrphelin } from '../../services/features/ticketService.js';

const BOT = 'bot-1';
const SALON = 'salon-1';
const MAINTENANT = Date.parse('2026-09-21T10:00:00.000Z');

// Dates franches : `resolveDeletionLock` lit l'horloge réelle pour juger de
// l'expiration, un verrou daté du passé reste donc expiré, et un verrou daté
// d'un futur lointain reste actif, quelle que soit la date d'exécution.
const VERROU_EXPIRE = new Date('2020-01-01T00:00:00.000Z');
const VERROU_ACTIF = new Date('2099-01-01T00:00:00.000Z');

function ticket(surcharges: Partial<EtatTicketOrphelin['ticket']> = {}): EtatTicketOrphelin['ticket'] {
  return {
    id: 'ticket-1',
    guildId: 'guilde-1',
    channelId: SALON,
    status: 'OPEN',
    deletionLocked: false,
    deletionLockedUntil: null,
    deletionLockReason: null,
    deletionLockedById: null,
    deletionLockedByName: null,
    ...surcharges,
  };
}

function etat(surcharges: Partial<EtatTicketOrphelin> = {}): EtatTicketOrphelin {
  return {
    ticket: ticket(),
    salonSupprime: SALON,
    auteur: { id: 'humain-1', name: 'Modo#0001', reason: null },
    botUserId: BOT,
    maintenant: MAINTENANT,
    ...surcharges,
  };
}

describe('decideOrphanedTicket', () => {
  test("ignore la suppression d'un salon qui n'est pas celui du ticket", () => {
    expect(decideOrphanedTicket(etat({ salonSupprime: 'un-autre-salon' })))
      .toEqual({ action: 'ignorer', cause: 'autre-salon' });
  });

  test('ignore un ticket qui ne pouvait déjà plus recevoir de messages', () => {
    for (const status of ['CLOSED', 'ARCHIVED', 'PENDING', 'REJECTED', 'ORPHANED'] as const) {
      expect(decideOrphanedTicket(etat({ ticket: ticket({ status }) })))
        .toEqual({ action: 'ignorer', cause: 'deja-clos' });
    }
  });

  test('ignore une suppression pilotée par le bot lui-même', () => {
    // Les boutons du ticket, le dashboard et le MCP écrivent déjà `channelId:
    // null` avant leur `setTimeout`, ou suppriment la ligne entière dans la
    // foulée. Repasser derrière eux ferait un travail pour rien, sur une ligne
    // qui vient peut-être de disparaître.
    expect(decideOrphanedTicket(etat({ auteur: { id: BOT, name: 'Kotbo', reason: 'Ticket supprimé' } })))
      .toEqual({ action: 'ignorer', cause: 'suppression-du-bot' });
  });

  test('marque orphelin un ticket ouvert ou pris en charge, supprimé par un humain', () => {
    for (const status of ['OPEN', 'CLAIMED'] as const) {
      const decision = decideOrphanedTicket(etat({ ticket: ticket({ status }) }));
      if (decision.action !== 'marquer-orphelin') throw new Error(`attendu marquer-orphelin, reçu ${decision.action}`);

      // `channelId: null` est ce qui sort le ticket du champ du cron
      // d'inactivité : sans ça, il serait retenté toutes les dix minutes.
      expect(decision.donnees.status).toBe('ORPHANED');
      expect(decision.donnees.channelId).toBeNull();
      expect(decision.donnees.closedById).toBe('humain-1');
      expect(decision.donnees.closedAt.getTime()).toBe(MAINTENANT);
      expect(decision.verrouContourne).toBeFalse();
    }
  });

  test("dit « auteur inconnu » quand le journal d'audit ne corrèle rien", () => {
    // `MemberMove`/`ChannelDelete` peuvent ne rien rendre : audit illisible,
    // entrée non corrélée, serveur indisponible. On le dit plutôt que de
    // laisser croire à une attribution.
    const decision = decideOrphanedTicket(etat({ auteur: null }));
    if (decision.action !== 'marquer-orphelin') throw new Error('attendu marquer-orphelin');

    expect(decision.donnees.closedById).toBeNull();
    expect(decision.donnees.closedByName).toContain('auteur inconnu');
  });

  test('signale explicitement un verrou anti-suppression contourné', () => {
    // Le verrou n'agit que sur les boutons du bot. Une suppression faite
    // directement depuis Discord passe outre — le staff doit l'apprendre par le
    // journal, pas le découvrir plus tard.
    const decision = decideOrphanedTicket(etat({
      ticket: ticket({
        deletionLocked: true,
        deletionLockedUntil: VERROU_ACTIF,
        deletionLockedById: 'staff-1',
        deletionLockedByName: 'Staff#0001',
        deletionLockReason: 'Litige en cours',
      }),
    }));
    if (decision.action !== 'marquer-orphelin') throw new Error('attendu marquer-orphelin');

    expect(decision.verrouContourne).toBeTrue();
    expect(decision.journal).toContain('contourne');
    expect(decision.journal).toContain('Litige en cours');
    expect(decision.donnees.closedByName).toContain('verrou contourne');
  });

  test("un verrou expiré n'est pas présenté comme contourné", () => {
    const decision = decideOrphanedTicket(etat({
      ticket: ticket({ deletionLocked: true, deletionLockedUntil: VERROU_EXPIRE }),
    }));
    if (decision.action !== 'marquer-orphelin') throw new Error('attendu marquer-orphelin');

    expect(decision.verrouContourne).toBeFalse();
    expect(decision.journal).not.toContain('contourne');
  });
});
