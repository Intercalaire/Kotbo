/**
 * Admin Permission Lock - Module d'enregistrement
 *
 * Câble le listener unifié GuildAuditLogEntryCreate (détection native +
 * auto-revert + anti-rafale). Le blocage bot-mediated (guardAdminGrant) est
 * appelé directement depuis les points de mutation (commandes, MCP), pas ici.
 */

import type { Client } from 'discord.js';
import { registerAdminLockAuditListener } from '../services/moderation/adminLockService.js';

export function registerAdminLockModule(client: Client): void {
  registerAdminLockAuditListener(client);
}
