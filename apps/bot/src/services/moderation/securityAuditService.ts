import { type Guild, GuildVerificationLevel, GuildExplicitContentFilter, GuildMFALevel, PermissionFlagsBits } from 'discord.js';
import { getCachedGuild } from '../../utils/cache.js';
import { getRaidProtectionConfig } from './raidProtectionService.js';

export type AuditSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'OK';

export type AuditFinding = {
  severity: AuditSeverity;
  title: string;
  detail: string;
  recommendation?: string;
};

export type SecurityAuditResult = {
  score: number; // 0-100
  findings: AuditFinding[];
};

const DANGEROUS_PERMISSIONS = [
  { flag: PermissionFlagsBits.Administrator, label: 'Administrateur' },
  { flag: PermissionFlagsBits.ManageGuild, label: 'Gérer le serveur' },
  { flag: PermissionFlagsBits.ManageRoles, label: 'Gérer les rôles' },
  { flag: PermissionFlagsBits.ManageChannels, label: 'Gérer les salons' },
  { flag: PermissionFlagsBits.ManageWebhooks, label: 'Gérer les webhooks' },
  { flag: PermissionFlagsBits.BanMembers, label: 'Bannir des membres' },
  { flag: PermissionFlagsBits.KickMembers, label: 'Expulser des membres' },
  { flag: PermissionFlagsBits.MentionEveryone, label: 'Mentionner @everyone' },
] as const;

/**
 * Analyse la configuration de sécurité du serveur et retourne un score
 * accompagné de recommandations.
 */
export async function runSecurityAudit(guild: Guild): Promise<SecurityAuditResult> {
  const findings: AuditFinding[] = [];
  let score = 100;

  const penalize = (points: number, finding: AuditFinding) => {
    score -= points;
    findings.push(finding);
  };

  // ── Niveau de vérification Discord ──────────────────────────────────────────
  if (guild.verificationLevel <= GuildVerificationLevel.Low) {
    penalize(15, {
      severity: 'CRITICAL',
      title: 'Niveau de vérification trop bas',
      detail: `Le niveau de vérification du serveur est **${GuildVerificationLevel[guild.verificationLevel]}**.`,
      recommendation: 'Paramètres du serveur → Sécurité → passer au moins en « Moyen » (email vérifié).',
    });
  } else {
    findings.push({ severity: 'OK', title: 'Niveau de vérification', detail: `Niveau **${GuildVerificationLevel[guild.verificationLevel]}** - correct.` });
  }

  // ── 2FA obligatoire pour la modération ──────────────────────────────────────
  if (guild.mfaLevel === GuildMFALevel.None) {
    penalize(15, {
      severity: 'CRITICAL',
      title: '2FA non requise pour les modérateurs',
      detail: 'Un compte modérateur compromis peut bannir/supprimer sans obstacle.',
      recommendation: 'Paramètres du serveur → Sécurité → exiger la 2FA pour les actions de modération (owner uniquement).',
    });
  } else {
    findings.push({ severity: 'OK', title: '2FA modération', detail: 'La 2FA est requise pour les actions de modération.' });
  }

  // ── Filtre de contenu explicite ─────────────────────────────────────────────
  if (guild.explicitContentFilter !== GuildExplicitContentFilter.AllMembers) {
    penalize(5, {
      severity: 'WARNING',
      title: 'Filtre de contenu explicite incomplet',
      detail: 'Le scan des médias explicites ne couvre pas tous les membres.',
      recommendation: 'Paramètres du serveur → Modération → analyser les médias de tous les membres.',
    });
  }

  // ── Permissions dangereuses de @everyone ────────────────────────────────────
  const everyoneRole = guild.roles.everyone;
  const everyoneDangerous = DANGEROUS_PERMISSIONS.filter((p) => everyoneRole.permissions.has(p.flag));
  if (everyoneDangerous.length > 0) {
    penalize(20, {
      severity: 'CRITICAL',
      title: 'Permissions dangereuses accordées à @everyone',
      detail: `@everyone possède : ${everyoneDangerous.map((p) => `**${p.label}**`).join(', ')}.`,
      recommendation: 'Retirer immédiatement ces permissions du rôle @everyone.',
    });
  } else {
    findings.push({ severity: 'OK', title: 'Permissions @everyone', detail: 'Aucune permission dangereuse sur @everyone.' });
  }

  // ── Rôles avec permission Administrateur ────────────────────────────────────
  const adminRoles = guild.roles.cache.filter(
    (r) => r.permissions.has(PermissionFlagsBits.Administrator) && !r.managed && r.id !== guild.id
  );
  const adminMemberCount = new Set(
    adminRoles.map((r) => [...r.members.keys()]).flat()
  ).size;
  if (adminRoles.size > 3) {
    penalize(10, {
      severity: 'WARNING',
      title: 'Trop de rôles Administrateur',
      detail: `**${adminRoles.size} rôles** possèdent la permission Administrateur (${adminMemberCount} membres au total).`,
      recommendation: 'Limiter la permission Administrateur à 1-2 rôles de confiance ; préférer des permissions granulaires.',
    });
  } else {
    findings.push({ severity: 'OK', title: 'Rôles Administrateur', detail: `${adminRoles.size} rôle(s) admin - raisonnable.` });
  }

  // ── Rôles mentionnables avec permissions élevées ────────────────────────────
  const mentionableDangerous = guild.roles.cache.filter(
    (r) => r.mentionable && DANGEROUS_PERMISSIONS.some((p) => r.permissions.has(p.flag))
  );
  if (mentionableDangerous.size > 0) {
    penalize(5, {
      severity: 'WARNING',
      title: 'Rôles à permissions élevées mentionnables par tous',
      detail: `${mentionableDangerous.map((r) => r.name).slice(0, 5).join(', ')}${mentionableDangerous.size > 5 ? '…' : ''}`,
      recommendation: 'Désactiver « Autoriser tout le monde à mentionner ce rôle » sur ces rôles.',
    });
  }

  // ── Widget serveur (fuite de la liste des membres en ligne) ────────────────
  if (guild.widgetEnabled) {
    penalize(3, {
      severity: 'INFO',
      title: 'Widget serveur activé',
      detail: 'Le widget expose publiquement la liste des membres en ligne et une invitation instantanée.',
      recommendation: 'Le désactiver si vous ne l\'utilisez pas (Paramètres → Widget).',
    });
  }

  // ── Position du rôle du bot ─────────────────────────────────────────────────
  const me = guild.members.me;
  if (me) {
    const highestManaged = me.roles.highest;
    const rolesAbove = guild.roles.cache.filter((r) => r.position > highestManaged.position && r.id !== guild.id).size;
    if (rolesAbove > 10) {
      penalize(5, {
        severity: 'WARNING',
        title: 'Rôle du bot trop bas dans la hiérarchie',
        detail: `${rolesAbove} rôles sont au-dessus du bot : il ne peut pas modérer leurs détenteurs.`,
        recommendation: 'Monter le rôle du bot au-dessus des rôles des membres à modérer.',
      });
    }
  }

  // ── Modules de protection Kotbo ─────────────────────────────────────────────
  const [guildConfig, protectionConfig] = await Promise.all([
    getCachedGuild(guild.id) as Promise<{ honeypotEnabled?: boolean; logChannelId?: string | null } | null>,
    getRaidProtectionConfig(guild.id),
  ]);

  if (!protectionConfig?.antiRaidEnabled) {
    penalize(8, {
      severity: 'WARNING',
      title: 'Anti-raid Kotbo désactivé',
      detail: 'Aucune détection automatique des vagues d\'arrivées suspectes.',
      recommendation: 'Activer via `/protection antiraid activer`.',
    });
  } else {
    findings.push({ severity: 'OK', title: 'Anti-raid', detail: 'Détection de raid active.' });
  }

  if (!protectionConfig?.captchaEnabled) {
    penalize(5, {
      severity: 'INFO',
      title: 'Captcha désactivé',
      detail: 'Les nouveaux membres ne passent aucune vérification anti-bot.',
      recommendation: 'Activer via `/protection captcha activer`.',
    });
  } else {
    findings.push({ severity: 'OK', title: 'Captcha', detail: 'Vérification des nouveaux membres active.' });
  }

  if (!protectionConfig?.scamFilterEnabled) {
    penalize(4, {
      severity: 'INFO',
      title: 'Filtre anti-scam désactivé',
      detail: 'Les liens d\'arnaques (faux Nitro, phishing) ne sont pas filtrés.',
      recommendation: 'Activer via `/protection scam activer`.',
    });
  }

  if (!guildConfig?.honeypotEnabled) {
    penalize(3, {
      severity: 'INFO',
      title: 'Honeypot désactivé',
      detail: 'Aucun salon piège pour détecter les comptes compromis.',
      recommendation: 'Configurer un honeypot depuis le dashboard ou `/setup`.',
    });
  }

  if (!guildConfig?.logChannelId) {
    penalize(4, {
      severity: 'WARNING',
      title: 'Aucun salon de logs configuré',
      detail: 'Les actions de modération et alertes n\'ont pas de destination.',
      recommendation: 'Définir un salon de logs via `/config` ou le dashboard.',
    });
  }

  return { score: Math.max(0, Math.min(100, score)), findings };
}
