/**
 * Reprise de configuration depuis les autres bots du serveur.
 *
 * Quand Kotbo arrive sur un serveur deja equipe, tout est a refaire a la main :
 * les tickets, le message de bienvenue, les roles par reaction. Ce service
 * repond a trois questions, dans cet ordre :
 *
 *  1. quels bots sont la, et que couvrent-ils (`detectBots`) ;
 *  2. qu'est-ce qui est lisible du serveur lui-meme (`scanServerConfig`) ;
 *  3. que peut-on reprendre automatiquement, et que faudra-t-il refaire
 *     a la main (`buildMigrationPlan`, `applyMigrationPlan`).
 *
 * Rien n'est applique sans que le staff n'ait coche la proposition : un import
 * approximatif qui ecrase une configuration existante coute plus cher que la
 * saisie manuelle qu'il pretend eviter.
 */
import { ChannelType, type Guild, type GuildBasedChannel } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';

/**
 * Bots reconnus, par nom d'utilisateur en minuscules.
 *
 * Le nom plutot que l'identifiant d'application : les identifiants ne se
 * verifient pas depuis le code, et une valeur inventee produirait une detection
 * silencieusement fausse. Le nom se lit sur le serveur, se compare sans risque,
 * et sert ici a suggerer - jamais a accorder un droit.
 */
const KNOWN_BOTS: Record<string, { label: string; covers: string[] }> = {
  'mee6': { label: 'MEE6', covers: ['welcome', 'leveling', 'automod', 'reactionRoles'] },
  'dyno': { label: 'Dyno', covers: ['welcome', 'automod', 'reactionRoles'] },
  'carl-bot': { label: 'Carl-bot', covers: ['welcome', 'reactionRoles', 'automod', 'tickets'] },
  'carlbot': { label: 'Carl-bot', covers: ['welcome', 'reactionRoles', 'automod', 'tickets'] },
  'ticket tool': { label: 'Ticket Tool', covers: ['tickets'] },
  'tickets': { label: 'Tickets', covers: ['tickets'] },
  'ticketsbot': { label: 'Tickets', covers: ['tickets'] },
  'yagpdb.xyz': { label: 'YAGPDB', covers: ['welcome', 'automod', 'reactionRoles'] },
  'probot': { label: 'ProBot', covers: ['welcome', 'automod', 'leveling'] },
  'arcane': { label: 'Arcane', covers: ['welcome', 'leveling'] },
  'wick': { label: 'Wick', covers: ['automod'] },
  'sapphire': { label: 'Sapphire', covers: ['welcome', 'automod', 'reactionRoles'] },
  'tatsu': { label: 'Tatsu', covers: ['leveling'] },
  'statbot': { label: 'Statbot', covers: ['stats'] },
};

export type DetectedBot = {
  id: string;
  username: string;
  /** Nom du bot reconnu, ou `null` s'il ne figure pas au registre. */
  label: string | null;
  covers: string[];
};

/** Bots presents sur le serveur, les connus d'abord. */
export async function detectBots(guild: Guild): Promise<DetectedBot[]> {
  // `fetch` plutot que le cache : sans l'intent des membres, le cache ne
  // contient souvent que le bot lui-meme.
  const members = await guild.members.fetch().catch(() => guild.members.cache);

  const bots = Array.from(members.values())
    .filter((member) => member.user.bot && member.user.id !== guild.client.user?.id)
    .map((member) => {
      const known = KNOWN_BOTS[member.user.username.toLowerCase()];
      return {
        id: member.user.id,
        username: member.user.username,
        label: known?.label ?? null,
        covers: known?.covers ?? [],
      };
    });

  return bots.sort((a, b) => Number(!!b.label) - Number(!!a.label) || a.username.localeCompare(b.username));
}

export type ScanFinding = {
  /** Identifiant stable, utilise par l'UI pour cocher la proposition. */
  key: string;
  feature: 'tickets' | 'welcome' | 'reactionRoles' | 'automod' | 'stats';
  title: string;
  detail: string;
  /** Ce que Kotbo ecrira si la proposition est retenue. */
  action: string | null;
  /** Salons ou entites reperes, pour que le staff verifie avant d'appliquer. */
  entities: { id: string; name: string }[];
};

/** Motifs de nom qui trahissent un salon dedie a une fonction. */
const NAME_HINTS = {
  ticketCategory: /ticket|support|assistance/i,
  welcome: /welcome|bienvenue|arriv|hello|entr[ée]e/i,
  reactionRoles: /r[oô]les?|roles|auto-?r[oô]le|reaction/i,
  logs: /logs?|journal|audit/i,
} as const;

function channelName(channel: GuildBasedChannel): string {
  return channel.name ?? '';
}

/**
 * Lit du serveur ce qui se devine sans deviner.
 *
 * Le nom d'un salon ou d'une categorie est un indice, pas une preuve : chaque
 * constat est presente comme une proposition a verifier, et nomme les salons
 * concernes pour que le staff tranche.
 */
export async function scanServerConfig(guild: Guild): Promise<ScanFinding[]> {
  if (guild.channels.cache.size === 0) await guild.channels.fetch().catch(() => null);

  const findings: ScanFinding[] = [];
  const channels = Array.from(guild.channels.cache.values());

  // ── Tickets ───────────────────────────────────────────────────────────────
  const ticketCategories = channels.filter(
    (ch) => ch.type === ChannelType.GuildCategory && NAME_HINTS.ticketCategory.test(channelName(ch)),
  );
  if (ticketCategories.length > 0) {
    const category = ticketCategories[0]!;
    findings.push({
      key: 'tickets.category',
      feature: 'tickets',
      title: 'Catégorie de tickets existante',
      detail: `La catégorie « ${category.name} » ressemble à celle d'un système de tickets. Kotbo peut y créer les siens, à côté de ceux de l'ancien bot.`,
      action: 'Définir cette catégorie comme catégorie des tickets Kotbo',
      entities: ticketCategories.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  const openTicketChannels = channels.filter(
    (ch) => ch.type === ChannelType.GuildText && /^(ticket|🎫|support)[-_ ]/i.test(channelName(ch)),
  );
  if (openTicketChannels.length > 0) {
    findings.push({
      key: 'tickets.open',
      feature: 'tickets',
      // Sans action : reprendre des tickets ouverts par un autre bot demande de
      // recreer leur historique, que Kotbo n'a pas.
      title: `${openTicketChannels.length} ticket(s) encore ouvert(s)`,
      detail: "Ces salons appartiennent à l'ancien système. Fermez-les avant de basculer, sinon leurs auteurs auront deux tickets en cours et le staff deux fils à suivre.",
      action: null,
      entities: openTicketChannels.slice(0, 10).map((c) => ({ id: c.id, name: c.name })),
    });
  }

  // ── Bienvenue ─────────────────────────────────────────────────────────────
  const welcomeChannels = channels.filter(
    (ch) => ch.type === ChannelType.GuildText && NAME_HINTS.welcome.test(channelName(ch)),
  );
  if (welcomeChannels.length > 0) {
    findings.push({
      key: 'welcome.channel',
      feature: 'welcome',
      title: "Salon d'accueil repéré",
      detail: `« ${welcomeChannels[0]!.name} » sert visiblement à accueillir les arrivants. Kotbo peut y poster ses propres messages de bienvenue.`,
      action: "Définir ce salon comme salon de bienvenue",
      entities: welcomeChannels.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  // ── Roles par reaction ────────────────────────────────────────────────────
  const roleChannels = channels.filter(
    (ch) => ch.type === ChannelType.GuildText && NAME_HINTS.reactionRoles.test(channelName(ch)),
  );
  if (roleChannels.length > 0) {
    findings.push({
      key: 'reactionRoles.channel',
      feature: 'reactionRoles',
      // Sans action : les associations emoji/role vivent dans la base de
      // l'ancien bot, pas sur Discord. On ne peut que montrer ou chercher.
      title: 'Salon de rôles par réaction',
      detail: `« ${roleChannels[0]!.name} » contient probablement des menus de rôles. Les correspondances emoji/rôle ne sont lisibles que depuis l'ancien bot : elles sont à ressaisir dans Kotbo.`,
      action: null,
      entities: roleChannels.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  // ── AutoMod natif ─────────────────────────────────────────────────────────
  try {
    const rules = await guild.autoModerationRules.fetch();
    const enabled = rules.filter((rule) => rule.enabled);
    if (enabled.size > 0) {
      findings.push({
        key: 'automod.native',
        feature: 'automod',
        title: `${enabled.size} règle(s) AutoMod Discord actives`,
        detail: "Ces règles sont portées par Discord, pas par un bot : elles continueront de s'appliquer à côté de l'AutoMod de Kotbo. Vérifiez qu'elles ne font pas doublon.",
        action: null,
        entities: enabled.map((rule) => ({ id: rule.id, name: rule.name })).slice(0, 10),
      });
    }
  } catch {
    // Permission « Gérer le serveur » manquante : le constat est simplement absent.
  }

  // ── Salons de logs ────────────────────────────────────────────────────────
  const logChannels = channels.filter(
    (ch) => ch.type === ChannelType.GuildText && NAME_HINTS.logs.test(channelName(ch)),
  );
  if (logChannels.length > 0) {
    findings.push({
      key: 'logs.channel',
      feature: 'stats',
      title: 'Salon de logs repéré',
      detail: `« ${logChannels[0]!.name} » reçoit déjà des journaux. Kotbo peut y écrire les siens, ou vous pouvez lui en donner un autre.`,
      action: 'Définir ce salon comme salon de logs Kotbo',
      entities: logChannels.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  return findings;
}

export type MigrationPlan = {
  bots: DetectedBot[];
  findings: ScanFinding[];
  /** Fonctionnalites couvertes par un bot present et que Kotbo sait reprendre. */
  manualSteps: { feature: string; label: string; why: string }[];
};

/**
 * Ce que Kotbo ne peut pas lire du serveur et qu'il faudra ressaisir.
 *
 * Ces donnees vivent dans la base de l'ancien bot : aucune inspection du
 * serveur ne les rend. Les annoncer des le depart evite de croire la reprise
 * terminee alors que l'essentiel manque.
 */
const MANUAL_STEPS: Record<string, { label: string; why: string }> = {
  leveling: {
    label: "Niveaux et XP des membres",
    why: "L'XP accumulée vit dans la base de l'ancien bot. La plupart proposent un export ; sans lui, les compteurs repartent de zéro.",
  },
  reactionRoles: {
    label: 'Correspondances emoji → rôle',
    why: "Discord ne stocke que les réactions, pas le rôle qu'elles accordent. À recréer menu par menu.",
  },
  welcome: {
    label: "Texte et embed du message de bienvenue",
    why: "Le message n'est composé qu'au moment où quelqu'un arrive : il n'existe nulle part à copier.",
  },
  tickets: {
    label: 'Types de tickets et formulaires',
    why: "Le panneau visible ne montre que ses boutons. Les questions posées à l'ouverture sont à ressaisir.",
  },
  automod: {
    label: 'Listes de mots et règles personnalisées',
    why: "Les filtres d'un bot tiers ne sont pas exposés par Discord.",
  },
  stats: {
    label: 'Historique de statistiques',
    why: "Kotbo commence ses mesures à son arrivée ; l'antériorité ne se transfère pas.",
  },
};

export async function buildMigrationPlan(guild: Guild): Promise<MigrationPlan> {
  const [bots, findings] = await Promise.all([detectBots(guild), scanServerConfig(guild)]);

  const covered = new Set(bots.flatMap((bot) => bot.covers));
  const manualSteps = Array.from(covered)
    .filter((feature) => MANUAL_STEPS[feature])
    .map((feature) => ({ feature, ...MANUAL_STEPS[feature]! }));

  return { bots, findings, manualSteps };
}

/**
 * Applique les propositions retenues.
 *
 * Chaque cle correspond a un constat qui porte une `action`. Un constat sans
 * action est ignore meme s'il est coche : il n'existe que pour informer.
 */
export async function applyMigrationPlan(
  guild: Guild,
  keys: string[],
): Promise<{ applied: string[]; skipped: string[] }> {
  const findings = await scanServerConfig(guild);
  const selected = findings.filter((f) => keys.includes(f.key) && f.action);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const finding of selected) {
    const target = finding.entities[0];
    if (!target) {
      skipped.push(finding.key);
      continue;
    }

    try {
      const data = migrationUpdateFor(finding.key, target.id);
      if (!data) {
        skipped.push(finding.key);
        continue;
      }
      await prisma.guild.update({ where: { id: guild.id }, data });
      applied.push(finding.title);
    } catch (err) {
      logger.error('BotMigration', `Reprise ${finding.key} impossible sur ${guild.id}`, err);
      skipped.push(finding.key);
    }
  }

  return { applied, skipped };
}

/** Colonne de la guilde a ecrire pour une proposition donnee. */
function migrationUpdateFor(key: string, channelId: string): Record<string, string> | null {
  switch (key) {
    case 'tickets.category': return { ticketCategoryId: channelId };
    case 'welcome.channel': return { publicChannelId: channelId };
    case 'logs.channel': return { logChannelId: channelId };
    default: return null;
  }
}
