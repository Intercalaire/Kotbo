/**
 * Le repli vu depuis un appelant — le seul cas de ce lot qui rougit sur
 * l'ancien code sans passer par un fichier qui n'y existe pas.
 *
 * `logTicketEvent` est l'appelant le plus testable des onze : il est exporté,
 * il reçoit son `Client` en argument (donc on le fournit), et le chemin exercé
 * ici ne touche pas la base. `broadcastDashboardStateChange` n'est appelée que
 * si `ticket.guildId` est une chaîne : le ticket ci-dessous n'en porte pas, la
 * diffusion n'est donc jamais sollicitée.
 *
 * Pas de `mock.module`, donc pas de préfixe `zz-` : le module est importé tel
 * quel, comme le fait déjà `tests/unit/ticketGatekeeping.test.ts`.
 *
 * Le faux salon est posé sur `TextChannel.prototype` À DESSEIN. L'ancien code
 * filtre par `instanceof TextChannel`, le nouveau par `isSendable()`. Un objet
 * nu passerait le second et échouerait le premier : le test rougirait alors sur
 * l'ancien code pour la mauvaise raison et ne prouverait rien du repli. Ici les
 * deux filtres acceptent le même objet, et la seule différence qui subsiste
 * entre les deux versions est le `fetch`.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { TextChannel, type Client } from 'discord.js';
import { logTicketEvent } from '../../services/features/ticketService.js';
import { resetLogChannelBackoff } from '../../utils/logChannel.js';

const SALON = 'salon-de-logs';

function salonDeLog() {
  const send = mock(async () => ({ id: 'message-1' }));
  const salon = Object.create(TextChannel.prototype) as Record<string, unknown>;
  salon.id = SALON;
  // `isTextBased()` répond `'messages' in this` et `isSendable()` répond
  // `'send' in this` : les deux propriétés sont nécessaires pour que le même
  // objet soit accepté par l'ancien code comme par le nouveau.
  salon.messages = {};
  salon.send = send;
  return { salon, send };
}

function clientAvec(options: { enCache?: unknown; recuperable?: unknown }) {
  const cache = new Map<string, unknown>();
  if (options.enCache !== undefined) cache.set(SALON, options.enCache);
  const fetch = mock(async () => options.recuperable ?? null);
  return { fetch, client: { channels: { cache, fetch } } as unknown as Client };
}

const CONFIG = { ticketLogChannelId: SALON };
// Volontairement sans `guildId` : c'est ce qui neutralise la diffusion
// dashboard, seule dépendance du chemin exercé.
const TICKET = { id: 'ticket-1', channelId: 'salon-ticket', userId: 'membre-1', username: 'Membre' };
const AUTEUR = { id: 'staff-1', username: 'Staff' };

// Le repli du resolveur est un etat de module, partage entre fichiers de test :
// `logChannel.test.ts` arme le sien sur le meme identifiant de salon.
beforeEach(() => resetLogChannelBackoff());

describe('logTicketEvent', () => {
  test('envoie le log quand le salon est absent du cache mais récupérable', async () => {
    // LE cas. Bot redémarré, salon de logs peu actif, cache évincé : c'est
    // l'état normal du bot quelques minutes après un déploiement. L'ancien code
    // abandonne ici sans exception et sans trace, et les dix actions de cycle
    // de vie d'un ticket cessent d'être journalisées.
    const { salon, send } = salonDeLog();
    const { client, fetch } = clientAvec({ recuperable: salon });

    await logTicketEvent(client, CONFIG, 'CLOSED', TICKET, AUTEUR);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('témoin : le cache reste le chemin normal, sans appel réseau', async () => {
    // Ce cas passe des deux côtés — il ne garde rien, il PROUVE autre chose :
    // que le montage (faux salon, faux client) est capable de rendre l'ancien
    // code vert. Sans lui, le rouge du cas précédent sur `recette` pourrait
    // venir d'un faux salon que l'ancien code refuse, et non du repli manquant.
    const { salon, send } = salonDeLog();
    const { client, fetch } = clientAvec({ enCache: salon });

    await logTicketEvent(client, CONFIG, 'CLOSED', TICKET, AUTEUR);

    expect(send).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
