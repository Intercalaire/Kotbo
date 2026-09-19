import type { Ticket } from '@prisma/client';

/**
 * Salon du ticket sur son propre serveur, ou null : en mode MP le fil est un
 * espace staff, et un ticket relayé vit sur le serveur staff lié.
 */
export function ticketGuildChannelId(ticket: Pick<Ticket, 'mode' | 'staffServerGuildId' | 'channelId' | 'threadId'>): string | null {
  if (ticket.mode === 'DM' || ticket.staffServerGuildId) return null;
  return ticket.channelId ?? ticket.threadId;
}
