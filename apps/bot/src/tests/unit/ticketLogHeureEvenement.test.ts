/**
 * Un log de ticket doit porter l'heure des faits, pas celle de son envoi.
 *
 * Le symptôme observé en production : un ticket fermé à 01h47, journalisé à
 * 01h57. La cause est mécanique — `logTicketEvent` construisait son embed avec
 * `.setTimestamp()` **sans argument**, ce qui prend `Date.now()`. Or trois
 * chemins (fermeture, renommage, réouverture) appellent `channel.setName()`
 * juste avant de journaliser, et Discord plafonne le renommage à deux par
 * tranche de dix minutes et par salon. `@discordjs/rest` ne rejette pas sur un
 * 429 : il attend la fin de la fenêtre. Le log partait donc plusieurs minutes
 * après les faits, en prétendant les dater.
 *
 * Deux niveaux de garde ici, et il faut les deux :
 *   1. `logTicketEvent` honore l'heure qu'on lui donne (la fonction) ;
 *   2. `renameTicketChannel` la capture AVANT l'appel plafonné (le câblage).
 * Un test qui ne ferait que le premier laisserait passer un site d'appel qui
 * oublie le paramètre, ou qui le calcule trop tard — c'est-à-dire le bug
 * entier, la fonction restant irréprochable.
 *
 * Aucun `mock.module` : `logTicketEvent` et `renameTicketChannel` reçoivent
 * leur `Client` en argument, et les chemins exercés ne touchent pas la base —
 * `broadcastDashboardStateChange` (`api/shared/sharding.ts:157`) appelle un
 * diffuseur optionnel que rien n'a enregistré ici, donc c'est un no-op. Donc
 * pas de préfixe `zz-`.
 */
import { afterAll, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { TextChannel, type Client } from 'discord.js';
import { logTicketEvent, renameTicketChannel } from '../../services/features/ticketService.js';

// L'horloge est déplacée par ces cas : sans restauration, les fichiers chargés
// ensuite hériteraient d'une date fausse.
afterAll(() => setSystemTime());

const SALON_LOGS = 'salon-de-logs';
const SALON_TICKET = 'salon-ticket';
const FERME_A = new Date('2026-09-21T01:47:00.000Z');
const ENVOYE_A = new Date('2026-09-21T01:57:00.000Z');

function salonDeLogs() {
  const send = mock(async () => ({ id: 'message-1' }));
  const salon = Object.create(TextChannel.prototype) as Record<string, unknown>;
  salon.id = SALON_LOGS;
  salon.messages = {};
  salon.send = send;
  return { salon, send };
}

function clientAvec(salon: unknown): Client {
  return {
    channels: { cache: { get: () => salon } },
  } as unknown as Client;
}

const CONFIG = { ticketLogChannelId: SALON_LOGS };
// Sans `guildId` : c'est ce qui neutralise la diffusion dashboard.
const TICKET = { id: 'ticket-1', channelId: SALON_TICKET, userId: 'membre-1', username: 'Membre' };
const AUTEUR = { id: 'staff-1', username: 'Staff' };

function horodatageEnvoye(send: ReturnType<typeof mock>): string | undefined {
  const [charge] = send.mock.calls[0] as unknown as [{ embeds: Array<{ toJSON: () => { timestamp?: string } }> }];
  return charge.embeds[0].toJSON().timestamp;
}

describe('logTicketEvent', () => {
  test("porte l'heure de la fermeture, pas celle de l'envoi", async () => {
    // Dix minutes séparent les faits de l'envoi — la durée exacte du symptôme
    // observé, et l'ordre de grandeur d'une fenêtre de renommage épuisée.
    const { salon, send } = salonDeLogs();
    setSystemTime(ENVOYE_A);

    await logTicketEvent(clientAvec(salon), CONFIG, 'CLOSED', TICKET, AUTEUR, undefined, FERME_A);

    expect(send).toHaveBeenCalledTimes(1);
    expect(horodatageEnvoye(send)).toBe(FERME_A.toISOString());
    expect(horodatageEnvoye(send)).not.toBe(ENVOYE_A.toISOString());
  });

  test("sans heure fournie, l'embed retombe sur l'heure d'envoi", async () => {
    // Témoin, et garantie de compatibilité : les vingt-et-un sites d'appel qui
    // ne passent pas encore l'heure des faits gardent exactement le
    // comportement d'avant. Le paramètre est optionnel, pas une rupture.
    const { salon, send } = salonDeLogs();
    setSystemTime(ENVOYE_A);

    await logTicketEvent(clientAvec(salon), CONFIG, 'OPENED', TICKET, AUTEUR);

    expect(horodatageEnvoye(send)).toBe(ENVOYE_A.toISOString());
  });
});

const TICKET_A_RENOMMER = {
  id: 'ticket-1',
  guildId: 'guilde-1',
  channelId: SALON_TICKET,
  userId: 'membre-1',
  username: 'Membre',
  reason: 'Assistance',
  description: 'Besoin d’aide',
};

/**
 * Le salon du ticket, dont `setName` **fait attendre** — c'est tout l'intérêt
 * du cas. `@discordjs/rest` ne rejette pas un 429 de renommage : il dort
 * jusqu'à la fin de la fenêtre, puis rend la main comme si de rien n'était.
 * Avancer l'horloge dans le corps du `setName` reproduit ça exactement, sans
 * minuterie réelle : au retour, dix minutes se sont écoulées.
 */
function salonDeTicketQuiFaitAttendre(reprendLaMainA: Date) {
  const send = mock(async () => ({ id: 'message-confirmation' }));
  const setName = mock(async () => {
    setSystemTime(reprendLaMainA);
    return salon;
  });
  const salon = Object.create(TextChannel.prototype) as Record<string, unknown>;
  salon.id = SALON_TICKET;
  salon.messages = {};
  salon.send = send;
  salon.setName = setName;
  return { salon, setName };
}

describe('renameTicketChannel', () => {
  test("date le log du renommage, pas de la fin de l'attente imposée par Discord", async () => {
    const { salon: salonLogs, send: envoiLog } = salonDeLogs();
    const { salon: salonTicket, setName } = salonDeTicketQuiFaitAttendre(ENVOYE_A);
    const client = {
      channels: {
        cache: { get: (id: string) => (id === SALON_LOGS ? salonLogs : null) },
        fetch: async () => salonTicket,
      },
    } as unknown as Client;

    setSystemTime(FERME_A);
    const nomFinal = await renameTicketChannel(client, TICKET_A_RENOMMER, CONFIG, { id: 'staff-1', username: 'Staff' }, 'litige-paiement');

    expect(nomFinal).toBe('ticket-litige-paiement');
    expect(setName).toHaveBeenCalledTimes(1);
    // L'attente a bien eu lieu : au retour de `setName`, on est à 01h57.
    expect(Date.now()).toBe(ENVOYE_A.getTime());
    // Et pourtant le log date les faits, pas la fin de l'attente.
    expect(envoiLog).toHaveBeenCalledTimes(1);
    expect(horodatageEnvoye(envoiLog)).toBe(FERME_A.toISOString());
    expect(horodatageEnvoye(envoiLog)).not.toBe(ENVOYE_A.toISOString());
  });
});
