/**
 * Partenariats - abonnements au bus.
 *
 * Tout passe par `subscribeForModule`, qui n'appelle le gestionnaire que si le
 * module est allumé pour ce serveur : la garde d'exécution et l'offre
 * commerciale sont ainsi appliquées sans qu'aucun gestionnaire ait à y penser.
 *
 * Ce que le module écoute, et pourquoi :
 *   - `member:join:invite` : rattacher une arrivée au partenariat qui l'a
 *     amenée. Le seul événement qui porte le code d'invitation utilisé ;
 *   - `member:leave` : une arrivée qui repart le lendemain ne vaut pas une
 *     arrivée qui reste, et seul le départ permet de le dire ;
 *   - `message:new` : activité des membres apportés, et présence des
 *     représentants du partenaire ;
 *   - `sanction:applied` : un partenaire dont les arrivants se font sanctionner
 *     coûte plus qu'il ne rapporte.
 */
import type { Client } from 'discord.js';
import { subscribeForModule } from '../services/core/moduleScope.js';
import { logger } from '../utils/logger.js';
import {
  attributeJoinToPartnership,
  recordReferralActivity,
  recordReferralLeave,
  recordReferralSanction,
} from '../services/partnerships/partnershipAttributionService.js';
import { touchContactPresence } from '../services/partnerships/partnerService.js';
import { markPromotionPostDeleted } from '../services/partnerships/partnershipPromotionService.js';
import { isPartnershipsActive } from '../services/partnerships/partnershipSettings.js';

const MODULE_KEY = 'partnerships';
const MODULE_NAME = 'partnerships';

export function registerPartnershipBusSubscribers(client: Client): void {
  // ── Arrivée attribuée ────────────────────────────────────────────────────
  subscribeForModule(
    MODULE_KEY,
    'member:join:invite',
    async (payload) => {
      if (payload.isBot) return;
      if (!(await isPartnershipsActive(payload.guildId))) return;

      const partnershipId = await attributeJoinToPartnership({
        guildId: payload.guildId,
        userId: payload.userId,
        inviteCode: payload.inviteCode,
      });

      if (partnershipId) {
        logger.debug('Partenariats', `Arrivee ${payload.userId} attribuee au dossier ${partnershipId}`);
      }
    },
    MODULE_NAME,
  );

  // ── Départ ───────────────────────────────────────────────────────────────
  subscribeForModule(
    MODULE_KEY,
    'member:leave',
    async (payload) => {
      if (payload.isBot) return;
      await recordReferralLeave(payload.guildId, payload.userId);
    },
    MODULE_NAME,
  );

  // ── Activité et présence ─────────────────────────────────────────────────
  subscribeForModule(
    MODULE_KEY,
    'message:new',
    async (payload) => {
      if (payload.isBot) return;
      if (!(await isPartnershipsActive(payload.guildId))) return;

      await recordReferralActivity({ guildId: payload.guildId, userId: payload.authorId, messages: 1 });
      // Alimente l'engagement « représentant présent », qui ne pourrait sinon
      // se constater qu'à la main.
      await touchContactPresence(payload.authorId);
    },
    MODULE_NAME,
  );

  // ── Publicité supprimée ──────────────────────────────────────────────────
  subscribeForModule(
    MODULE_KEY,
    'message:delete',
    async (payload) => {
      if (!(await isPartnershipsActive(payload.guildId))) return;
      // `moderator` par défaut : les suppressions du bot sont déjà notées à la
      // source, par la rotation elle-même.
      await markPromotionPostDeleted(payload.messageId, 'moderator');
    },
    MODULE_NAME,
  );

  // ── Sanction reçue par un membre apporté ─────────────────────────────────
  subscribeForModule(
    MODULE_KEY,
    'sanction:applied',
    async (payload) => {
      if (!(await isPartnershipsActive(payload.guildId))) return;
      await recordReferralSanction(payload.guildId, payload.targetId);
    },
    MODULE_NAME,
  );

  void client;
}
