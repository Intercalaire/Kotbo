import prisma from '../../utils/db.js';

/**
 * Salons et fils dont on sait qu'ils ne portent aucun ticket.
 *
 * Plusieurs écouteurs `messageCreate` cherchent le ticket du salon à chaque
 * message, sur tous les serveurs, alors que presque aucun salon n'en porte.
 * Un ticket s'attache toujours à un salon ou un fil qu'il vient de créer, et
 * l'enregistre quelques secondes plus tard : un salon créé depuis plus de
 * `NON_TICKET_CHANNEL_MIN_AGE_MS` sans ticket n'en portera donc jamais, et peut
 * être mémorisé. Un chemin qui rattacherait un ticket à un salon existant
 * casserait cette hypothèse.
 */
const NON_TICKET_CHANNEL_MIN_AGE_MS = 10 * 60 * 1000;
const NON_TICKET_CHANNELS_MAX = 50_000;
const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const nonTicketChannels = new Set<string>();
const ticketChannelLookups = new Map<string, Promise<boolean>>();

function channelCreatedAtMs(channelId: string): number {
  return Number((BigInt(channelId) >> 22n) + DISCORD_EPOCH_MS);
}

/**
 * `false` quand aucun ticket, quel que soit son statut, n'utilise ce salon ou
 * ce fil. Les écouteurs d'un même message partagent la même lecture.
 */
export async function mayBeTicketChannel(channelId: string): Promise<boolean> {
  if (nonTicketChannels.has(channelId)) return false;

  const pending = ticketChannelLookups.get(channelId);
  if (pending) return pending;

  const lookup = (async () => {
    const ticket = await prisma.ticket.findFirst({
      where: { OR: [{ channelId }, { threadId: channelId }] },
      select: { id: true },
    });
    if (ticket) return true;

    if (Date.now() - channelCreatedAtMs(channelId) > NON_TICKET_CHANNEL_MIN_AGE_MS) {
      if (nonTicketChannels.size >= NON_TICKET_CHANNELS_MAX) nonTicketChannels.clear();
      nonTicketChannels.add(channelId);
    }
    return false;
  })().finally(() => {
    ticketChannelLookups.delete(channelId);
  });

  ticketChannelLookups.set(channelId, lookup);
  return lookup;
}
