import { type Client, Events, type GuildMember, type Invite, type Message, type PartialGuildMember, type Typing, type VoiceState } from 'discord.js';
import { logger } from '../utils/logger.js';
import {
  getRaidProtectionConfig,
  trackJoinAndDetectRaid,
  handleJoinDuringLock,
  handleJoinDuringRaidKick,
} from '../services/moderation/raidProtectionService.js';
import { startCaptchaChallenge, handleCaptchaMessage } from '../services/moderation/captchaService.js';
import { handleScamMessage } from '../services/moderation/scamFilterService.js';
import { syncMemberTagRole } from '../services/moderation/tagRoleService.js';
import { handleInviteCreate } from '../services/moderation/inviteGuardService.js';
import { handleVoiceStateUpdate } from '../services/moderation/voiceCaptchaService.js';
import { handleSpamMessage, handleTypingStart } from '../services/moderation/spam/index.js';

export function registerRaidProtectionListener(client: Client): void {
  // ── Arrivées : join lock → raid kick → détection de raid → captcha → tag role
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      const config = await getRaidProtectionConfig(member.guild.id);
      if (!config) return;

      // 1. Join lock actif : kick immédiat (filet au-delà de la pause des invitations)
      if (await handleJoinDuringLock(member, config)) return;

      // 2. Raid mode en action KICK
      if (await handleJoinDuringRaidKick(member, config)) return;

      // 3. Détection de raid (fenêtre glissante)
      await trackJoinAndDetectRaid(member, config);

      // 4. Captcha : activé en permanence, ou forcé par le raid mode (action CAPTCHA)
      const captchaForced = config.raidModeActive && config.antiRaidAction === 'CAPTCHA';
      if (config.captchaEnabled || captchaForced) {
        await startCaptchaChallenge(member, config);
      }

      // 5. Tag role (si le membre arrive déjà avec le tag du serveur)
      await syncMemberTagRole(member, config);
    } catch (err) {
      logger.error('RaidProtection', `Erreur GuildMemberAdd pour ${member.id}`, err);
    }
  });

  // ── Messages : réponse captcha, filtre anti-scam, moteur anti-spam ──────────
  client.on(Events.MessageCreate, async (message: Message) => {
    if (!message.guild || message.author.bot) return;
    try {
      // Le salon captcha consomme le message (comparaison du code + nettoyage)
      if (await handleCaptchaMessage(message)) return;
      // Le filtre anti-scam passe avant : un lien de phishing identifié est une
      // certitude, là où le moteur anti-spam raisonne en probabilité.
      if (await handleScamMessage(message)) return;
      await handleSpamMessage(message);
    } catch (err) {
      logger.error('RaidProtection', `Erreur MessageCreate`, err);
    }
  });

  // ── Frappe : alimente le signal « message posté sans indicateur de frappe » ──
  client.on(Events.TypingStart, (typing: Typing) => {
    if (!typing.guild || typing.user.bot) return;
    handleTypingStart(typing.guild.id, typing.user.id);
  });

  // ── Invitations : urgence, règle unitaire, validation staff, anti-spam ──────
  client.on(Events.InviteCreate, async (invite: Invite) => {
    try {
      await handleInviteCreate(invite);
    } catch (err) {
      logger.error('RaidProtection', `Erreur InviteCreate (${invite.code})`, err);
    }
  });

  // ── Vocal : entrée/sortie de la file du captcha vocal ───────────────────────
  client.on(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
    try {
      await handleVoiceStateUpdate(oldState, newState);
    } catch (err) {
      logger.error('RaidProtection', 'Erreur VoiceStateUpdate (captcha vocal)', err);
    }
  });

  // ── Mise à jour de membre : synchronisation du tag role ─────────────────────
  client.on(Events.GuildMemberUpdate, async (_old: GuildMember | PartialGuildMember, member: GuildMember) => {
    try {
      await syncMemberTagRole(member);
    } catch (err) {
      logger.error('RaidProtection', `Erreur GuildMemberUpdate pour ${member.id}`, err);
    }
  });
}
