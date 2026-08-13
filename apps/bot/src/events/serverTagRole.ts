/**
 * Déclencheurs des auto-rôles « identité de serveur » (module Annonces).
 *
 * Le tag de serveur vit sur l'objet User, pas sur le membre : c'est
 * `Events.UserUpdate` qui signale sa pose/dépose, pas `GuildMemberUpdate`.
 * Le statut personnalisé, lui, arrive par `Events.PresenceUpdate`.
 */

import {
  Events,
  type Client,
  type GuildMember,
  type PartialGuildMember,
  type Presence,
  type User,
  type PartialUser,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import {
  collectPresenceText,
  getAutoRoleConfig,
  isAutoRoleActive,
  syncMemberAutoRoles,
} from '../services/features/serverTagRoleService.js';

export function registerServerTagRoleListener(client: Client): void {
  // ── Arrivée : le membre peut déjà porter le tag ou le mot-clé ───────────────
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      await syncMemberAutoRoles(member);
    } catch (err) {
      logger.error('ServerTagRole', `Erreur GuildMemberAdd pour ${member.id}`, err);
    }
  });

  // ── Mise à jour de membre (rôles, pseudo serveur, boost) ───────────────────
  client.on(Events.GuildMemberUpdate, async (_old: GuildMember | PartialGuildMember, member: GuildMember) => {
    try {
      await syncMemberAutoRoles(member);
    } catch (err) {
      logger.error('ServerTagRole', `Erreur GuildMemberUpdate pour ${member.id}`, err);
    }
  });

  // ── Mise à jour d'utilisateur : pose ou retrait du tag de serveur ──────────
  client.on(Events.UserUpdate, async (_old: User | PartialUser, user: User) => {
    try {
      for (const guild of client.guilds.cache.values()) {
        const member = guild.members.cache.get(user.id);
        if (!member) continue; // Pas en cache : le sync suivra au prochain event.

        const config = await getAutoRoleConfig(guild.id);
        if (!config?.tagAutoRoleEnabled || !config.tagAutoRoleId) continue;

        await syncMemberAutoRoles(member, config);
      }
    } catch (err) {
      logger.error('ServerTagRole', `Erreur UserUpdate pour ${user.id}`, err);
    }
  });

  // ── Présence : statut personnalisé / activité ──────────────────────────────
  // Cet event est très bavard (chaque changement de statut de chaque membre).
  // On sort au plus tôt : pas de guilde, pas de config, ou texte inchangé.
  client.on(Events.PresenceUpdate, async (oldPresence: Presence | null, presence: Presence) => {
    try {
      const member = presence.member;
      if (!presence.guild || !member || member.user.bot) return;

      const config = await getAutoRoleConfig(presence.guild.id);
      if (!config?.statusScanEnabled || !isAutoRoleActive(config)) return;

      const scope = config.statusScanScope;
      const before = collectPresenceText(oldPresence?.activities, scope);
      const after = collectPresenceText(presence.activities, scope);
      if (before === after) return;

      await syncMemberAutoRoles(member, config);
    } catch (err) {
      logger.error('ServerTagRole', `Erreur PresenceUpdate pour ${presence.userId}`, err);
    }
  });
}
