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
import type { Prisma } from '@prisma/client';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import {
  LEVELING_PROFILES,
  TICKET_PROFILES,
  matchKnownBot,
  type BotFeature,
  type BotSignature,
  type KnownBot,
} from './botRegistry.js';

export type DetectedBot = {
  id: string;
  username: string;
  /** Nom du bot reconnu, ou `null` s'il ne figure pas au registre. */
  label: string | null;
  /** Clef du registre, `null` pour un bot inconnu. Sert a nommer ses propositions. */
  key: string | null;
  /**
   * Photo de profil reelle du bot, telle que Discord la sert.
   *
   * Une icone generique ne distingue pas MEE6 de Dyno : la liste des bots
   * presents se lit d'un coup d'oeil quand chaque ligne porte la vignette que
   * le staff voit deja dans sa liste de membres.
   */
  avatarUrl: string;
  covers: BotFeature[];
  /** Fonctions dont une trace a ete trouvee sur le serveur, avec ce qui la prouve. */
  activeFeatures: { feature: BotFeature; evidence: string }[];
};

/**
 * Bots presents sur le serveur, les connus d'abord.
 *
 * Salons et roles sont charges au passage pour y chercher les traces de chaque
 * bot : un bot present ne se sert pas forcement de tout ce qu'il sait faire, et
 * une reprise batie sur ses capacites theoriques proposerait de reprendre ce
 * que personne n'utilise ici.
 */
export async function detectBots(guild: Guild): Promise<DetectedBot[]> {
  // `fetch` plutot que le cache : sans l'intent des membres, le cache ne
  // contient souvent que le bot lui-meme.
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  if (guild.channels.cache.size === 0) await guild.channels.fetch().catch(() => null);

  const bots = Array.from(members.values())
    .filter((member) => member.user.bot && member.user.id !== guild.client.user?.id)
    .map((member) => {
      const known = matchKnownBot(member.user.username);
      return {
        id: member.user.id,
        username: member.user.username,
        label: known?.label ?? null,
        key: known?.key ?? null,
        avatarUrl: member.user.displayAvatarURL({ size: 64, extension: 'png' }),
        covers: known?.covers ?? [],
        activeFeatures: known ? findBotSignatures(guild, known) : [],
      };
    });

  return bots.sort((a, b) => Number(!!b.label) - Number(!!a.label) || a.username.localeCompare(b.username));
}

/** Traces du bot effectivement trouvees sur le serveur, une par fonction. */
function findBotSignatures(guild: Guild, bot: KnownBot): { feature: BotFeature; evidence: string }[] {
  const found = new Map<BotFeature, string>();

  for (const signature of bot.signatures ?? []) {
    if (found.has(signature.feature)) continue;
    if (matchesSignature(guild, signature)) found.set(signature.feature, signature.label);
  }

  return Array.from(found.entries()).map(([feature, evidence]) => ({ feature, evidence }));
}

function matchesSignature(guild: Guild, signature: BotSignature): boolean {
  if (signature.target === 'role') {
    return guild.roles.cache.some((role) => signature.pattern.test(role.name ?? ''));
  }

  const wantedType = signature.target === 'category' ? ChannelType.GuildCategory : ChannelType.GuildText;
  return guild.channels.cache.some(
    (channel) => channel.type === wantedType && signature.pattern.test(channel.name ?? ''),
  );
}

export type ScanFinding = {
  /** Identifiant stable, utilise par l'UI pour cocher la proposition. */
  key: string;
  feature: BotFeature;
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
export async function scanServerConfig(guild: Guild, bots: DetectedBot[] = []): Promise<ScanFinding[]> {
  if (guild.channels.cache.size === 0) await guild.channels.fetch().catch(() => null);

  const findings: ScanFinding[] = [...buildPresetFindings(bots)];
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

/**
 * Prefixe des constats qui posent un prereglage plutot qu'un identifiant.
 *
 * Les autres constats designent un salon existant : leur application ecrit une
 * colonne de la guilde avec cet identifiant. Ceux-la n'ont pas d'entite - ils
 * posent une configuration entiere, tiree du registre des bots.
 */
const PRESET_PREFIX = 'preset:';

/**
 * Ce que Kotbo peut poser d'emblee pour prendre la suite des bots detectes.
 *
 * Une proposition n'apparait que si le bot laisse une trace de la fonction sur
 * le serveur : MEE6 present mais sans un seul role de niveau ne justifie pas de
 * proposer une courbe d'XP. La trace est citee dans le constat, pour que le
 * staff sache sur quoi repose la suggestion.
 */
function buildPresetFindings(bots: DetectedBot[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const seen = new Set<string>();

  for (const bot of bots) {
    if (!bot.key || !bot.label) continue;
    const known = matchKnownBot(bot.username);
    if (!known) continue;

    const active = new Set(bot.activeFeatures.map((entry) => entry.feature));
    const evidenceOf = (feature: BotFeature) =>
      bot.activeFeatures.find((entry) => entry.feature === feature)?.evidence ?? '';

    const levelingProfile = known.leveling ? LEVELING_PROFILES[known.leveling] : null;
    if (levelingProfile && active.has('leveling') && !seen.has('leveling')) {
      seen.add('leveling');
      findings.push({
        key: `${PRESET_PREFIX}leveling:${levelingProfile.key}`,
        feature: 'leveling',
        title: `Reprendre la progression de ${bot.label}`,
        detail: `${bot.label} gère les niveaux ici (${evidenceOf('leveling')}). ${levelingProfile.source} Les niveaux déjà acquis, eux, ne se transfèrent pas : seule la façon de progresser est reprise.`,
        action: `Activer les niveaux Kotbo avec le profil « ${levelingProfile.label} »`,
        entities: [],
      });
    }

    const ticketProfile = known.tickets ? TICKET_PROFILES[known.tickets] : null;
    if (ticketProfile && active.has('tickets') && !seen.has('tickets')) {
      seen.add('tickets');
      findings.push({
        key: `${PRESET_PREFIX}tickets:${ticketProfile.key}`,
        feature: 'tickets',
        title: `Préparer les tickets à la place de ${bot.label}`,
        detail: `${bot.label} gère les tickets ici (${evidenceOf('tickets')}). ${ticketProfile.source} Kotbo pose un panneau et ${ticketProfile.types.length} sujets prêts à l'emploi, à ajuster ensuite depuis la page Tickets.`,
        action: `Poser le panneau et les ${ticketProfile.types.length} sujets du profil « ${ticketProfile.label} »`,
        entities: [],
      });
    }
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
  // Sequentiel et non parallele : le scan a besoin des bots detectes pour en
  // tirer les prereglages, et `detectBots` a deja charge salons et roles.
  const bots = await detectBots(guild);
  const findings = await scanServerConfig(guild, bots);

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
  const bots = await detectBots(guild);
  const findings = await scanServerConfig(guild, bots);
  const selected = findings.filter((f) => keys.includes(f.key) && f.action);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const finding of selected) {
    if (finding.key.startsWith(PRESET_PREFIX)) {
      try {
        const done = await applyPreset(guild, finding.key);
        if (done) applied.push(finding.title);
        else skipped.push(finding.key);
      } catch (err) {
        logger.error('BotMigration', `Prereglage ${finding.key} impossible sur ${guild.id}`, err);
        skipped.push(finding.key);
      }
      continue;
    }

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

/**
 * Pose un prereglage du registre.
 *
 * Deux garde-fous, communs aux deux profils : on n'ecrase jamais une
 * configuration que le staff a deja renseignee dans Kotbo, et on ne remplace
 * jamais des sujets de tickets existants - on complete. Une reprise qui efface
 * du travail deja fait coute plus cher que la saisie qu'elle pretend eviter.
 *
 * Rend `false` quand il n'y a rien a poser : la proposition est alors comptee
 * comme ignoree, pas comme appliquee.
 */
async function applyPreset(guild: Guild, key: string): Promise<boolean> {
  const [, kind, profileKey] = key.split(':');

  if (kind === 'leveling') {
    const profile = LEVELING_PROFILES[profileKey ?? ''];
    if (!profile) return false;

    const existing = await prisma.levelConfig.findUnique({
      where: { guildId: guild.id },
      select: { enabled: true },
    });
    // Des niveaux deja actifs veulent dire une courbe deja choisie : la
    // remplacer deplacerait tous les membres d'un coup.
    if (existing?.enabled) return false;

    const values = {
      enabled: true,
      xpMin: profile.xpMin,
      xpMax: profile.xpMax,
      cooldownSeconds: profile.cooldownSeconds,
      vocalXpPerMin: profile.vocalXpPerMin,
      curveBaseXp: profile.curveBaseXp,
      curveLinearXp: profile.curveLinearXp,
      curveExponent: profile.curveExponent,
    };

    await prisma.levelConfig.upsert({
      where: { guildId: guild.id },
      update: values,
      create: { guildId: guild.id, ...values },
    });
    return true;
  }

  if (kind === 'tickets') {
    const profile = TICKET_PROFILES[profileKey ?? ''];
    if (!profile) return false;

    const current = await prisma.guild.findUnique({
      where: { id: guild.id },
      select: { ticketTypes: true },
    });
    const existingTypes: Prisma.JsonArray = Array.isArray(current?.ticketTypes)
      ? (current.ticketTypes as Prisma.JsonArray)
      : [];
    const existingIds = new Set(
      existingTypes
        .map((type) => (type && typeof type === 'object' ? (type as { id?: unknown }).id : null))
        .filter((id): id is string => typeof id === 'string'),
    );

    const added = profile.types
      .filter((type) => !existingIds.has(type.id))
      .map((type) => ({
        id: type.id,
        label: type.label,
        description: type.description,
        emoji: type.emoji,
        categoryId: null,
        staffRoleId: null,
        fields: null,
      }));

    if (added.length === 0) return false;

    await prisma.guild.update({
      where: { id: guild.id },
      data: {
        ticketTypes: [...existingTypes, ...added] satisfies Prisma.JsonArray,
        // Le panneau n'est repris que s'il n'a jamais ete touche : un titre
        // deja personnalise appartient au staff, pas au prereglage.
        ...(existingTypes.length === 0
          ? {
              ticketEmbedTitle: profile.embedTitle,
              ticketEmbedDesc: profile.embedDesc,
              ticketEmbedButtonText: profile.embedButtonText,
              ticketEmbedType: 'DROPDOWN',
            }
          : {}),
      },
    });
    return true;
  }

  return false;
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
