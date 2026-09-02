/**
 * Base de detection des bots tiers.
 *
 * Le service de reprise ne se contentait que d'un nom et d'une liste de
 * fonctions couvertes : assez pour dire « MEE6 est la », pas pour en tirer quoi
 * que ce soit. Ce registre porte trois choses de plus, dans l'ordre ou la
 * reprise s'en sert :
 *
 *  1. `usernames` - les noms sous lesquels le bot se presente, pour le
 *     reconnaitre ;
 *  2. `signatures` - les traces qu'il laisse sur le serveur (noms de salons, de
 *     categories, de roles), pour savoir quelles fonctions il utilise vraiment
 *     plutot que celles qu'il pourrait utiliser ;
 *  3. `presets` - ce que Kotbo peut poser d'emblee pour prendre sa suite, sans
 *     que le staff ait a ressaisir des reglages equivalents.
 *
 * Le nom d'utilisateur reste la clef de reconnaissance, pas l'identifiant
 * d'application : un identifiant recopie ne se verifie pas depuis le code, et
 * une valeur fausse produirait une detection silencieusement erronee. Le nom se
 * lit sur le serveur, se compare sans risque, et ne sert ici qu'a suggerer -
 * jamais a accorder un droit.
 */

export type BotFeature =
  | 'welcome'
  | 'leveling'
  | 'automod'
  | 'reactionRoles'
  | 'tickets'
  | 'stats'
  | 'logs';

/**
 * Reglages de niveaux equivalents a ceux d'un autre bot.
 *
 * `source` dit sur quoi repose le profil : une formule publique et connue, ou
 * un reglage generique. La distinction compte - on ne presente pas de la meme
 * facon une reprise fidele et une valeur par defaut raisonnable.
 */
export type LevelingProfile = {
  key: string;
  label: string;
  source: string;
  xpMin: number;
  xpMax: number;
  cooldownSeconds: number;
  vocalXpPerMin: number;
  curveBaseXp: number;
  curveLinearXp: number;
  curveExponent: number;
};

export const LEVELING_PROFILES: Record<string, LevelingProfile> = {
  /**
   * MEE6 : le palier `n` coute `5n² + 50n + 100` XP, les messages rapportent
   * 15 a 25 XP avec une minute de pause, et rien n'est accorde en vocal.
   *
   * La courbe de Kotbo n'a pas la meme forme (`base * n^exposant + lineaire * n`
   * donne l'XP *totale* d'un niveau, la la somme des paliers de MEE6). Les
   * valeurs ci-dessous en sont l'approximation la plus proche sur les cinquante
   * premiers niveaux : moins de 6 % d'ecart partout. C'est une reprise
   * d'allure, pas une egalite - les niveaux des membres, eux, ne se transferent
   * pas sans export.
   */
  mee6: {
    key: 'mee6',
    label: 'Progression façon MEE6',
    source: 'Formule publique de MEE6 (5n² + 50n + 100 par palier), approximée à moins de 6 %.',
    xpMin: 15,
    xpMax: 25,
    cooldownSeconds: 60,
    vocalXpPerMin: 0,
    curveBaseXp: 10,
    curveLinearXp: 200,
    curveExponent: 2.6,
  },

  /**
   * Profil generique pour les bots dont la courbe n'est pas publiee. On ne
   * l'annonce pas comme une reprise : ce sont les reglages par defaut de
   * Kotbo, avec l'XP vocale allumee pour les bots qui en accordent.
   */
  standard: {
    key: 'standard',
    label: 'Progression standard',
    source: "Réglages par défaut de Kotbo : la courbe de l'ancien bot n'est pas publique.",
    xpMin: 15,
    xpMax: 25,
    cooldownSeconds: 60,
    vocalXpPerMin: 5,
    curveBaseXp: 100,
    curveLinearXp: 200,
    curveExponent: 2,
  },
};

export type TicketTypePreset = {
  id: string;
  label: string;
  description: string;
  emoji: string;
};

export type TicketProfile = {
  key: string;
  label: string;
  source: string;
  embedTitle: string;
  embedDesc: string;
  embedButtonText: string;
  types: TicketTypePreset[];
};

export const TICKET_PROFILES: Record<string, TicketProfile> = {
  /**
   * Le panneau visible d'un bot de tickets ne montre que ses boutons : les
   * questions posees a l'ouverture vivent dans sa base et ne se lisent pas.
   * Ce profil ne pretend donc pas copier l'ancien systeme - il pose les trois
   * motifs qu'on retrouve partout, pour que le staff parte d'un panneau qui
   * marche plutot que d'une page vide.
   */
  support: {
    key: 'support',
    label: 'Tickets de support',
    source: "Motifs communs aux systèmes de tickets : les formulaires de l'ancien bot ne sont pas lisibles depuis Discord.",
    embedTitle: 'Support',
    embedDesc: "Un souci, une question ? Ouvrez un ticket : l'équipe vous répond ici.",
    embedButtonText: 'Ouvrir un ticket',
    types: [
      { id: 'support', label: 'Support', description: 'Une question ou un souci technique', emoji: '🛠️' },
      { id: 'signalement', label: 'Signalement', description: 'Signaler un membre ou un message', emoji: '🚨' },
      { id: 'partenariat', label: 'Partenariat', description: 'Proposer un partenariat', emoji: '🤝' },
    ],
  },
};

/**
 * Trace qu'un bot laisse sur le serveur.
 *
 * Un bot present ne se sert pas forcement de tout ce qu'il sait faire : MEE6
 * peut n'etre la que pour l'accueil. Ces motifs distinguent « il pourrait » de
 * « il le fait », en cherchant ce que la fonction cree reellement - un salon,
 * une categorie, une famille de roles.
 */
export type BotSignature = {
  feature: BotFeature;
  /** Ce qu'on cherche : un salon, une categorie ou un role. */
  target: 'channel' | 'category' | 'role';
  pattern: RegExp;
  /** Ce que la trace prouve, dit au staff. */
  label: string;
};

export type KnownBot = {
  key: string;
  label: string;
  /** Noms d'utilisateur Discord, en minuscules. */
  usernames: string[];
  covers: BotFeature[];
  signatures?: BotSignature[];
  /** Profils que Kotbo peut poser pour prendre la suite de ce bot. */
  leveling?: string;
  tickets?: string;
};

const LEVEL_ROLE_PATTERN = /^(niveau|level|lvl)\s*\d+/i;

export const KNOWN_BOTS: KnownBot[] = [
  {
    key: 'mee6',
    label: 'MEE6',
    usernames: ['mee6'],
    covers: ['welcome', 'leveling', 'automod', 'reactionRoles'],
    leveling: 'mee6',
    signatures: [
      { feature: 'leveling', target: 'role', pattern: LEVEL_ROLE_PATTERN, label: 'des rôles de niveau existent' },
      { feature: 'leveling', target: 'channel', pattern: /level|niveau|rank|classement/i, label: 'un salon de niveaux existe' },
    ],
  },
  {
    key: 'dyno',
    label: 'Dyno',
    usernames: ['dyno'],
    covers: ['welcome', 'automod', 'reactionRoles', 'logs'],
    signatures: [
      { feature: 'logs', target: 'channel', pattern: /dyno|mod-?logs?/i, label: 'un salon de logs dédié existe' },
    ],
  },
  {
    key: 'carlbot',
    label: 'Carl-bot',
    usernames: ['carl-bot', 'carlbot', 'carl'],
    covers: ['welcome', 'reactionRoles', 'automod', 'tickets', 'logs'],
    tickets: 'support',
    signatures: [
      { feature: 'reactionRoles', target: 'channel', pattern: /r[oô]les?|roles|auto-?r[oô]le|reaction/i, label: 'un salon de rôles existe' },
      { feature: 'tickets', target: 'category', pattern: /ticket|support|assistance/i, label: 'une catégorie de tickets existe' },
    ],
  },
  {
    key: 'ticket-tool',
    label: 'Ticket Tool',
    usernames: ['ticket tool', 'tickettool'],
    covers: ['tickets'],
    tickets: 'support',
    signatures: [
      { feature: 'tickets', target: 'category', pattern: /ticket|support|assistance/i, label: 'une catégorie de tickets existe' },
      { feature: 'tickets', target: 'channel', pattern: /^(ticket|🎫|support)[-_ ]/i, label: 'des tickets sont encore ouverts' },
    ],
  },
  {
    key: 'ticketsbot',
    label: 'Tickets',
    usernames: ['tickets', 'ticketsbot', 'tickets.bot'],
    covers: ['tickets'],
    tickets: 'support',
    signatures: [
      { feature: 'tickets', target: 'category', pattern: /ticket|support|assistance/i, label: 'une catégorie de tickets existe' },
    ],
  },
  {
    key: 'yagpdb',
    label: 'YAGPDB',
    usernames: ['yagpdb.xyz', 'yagpdb'],
    covers: ['welcome', 'automod', 'reactionRoles', 'logs'],
  },
  {
    key: 'probot',
    label: 'ProBot',
    usernames: ['probot'],
    covers: ['welcome', 'automod', 'leveling'],
    leveling: 'standard',
    signatures: [
      { feature: 'leveling', target: 'role', pattern: LEVEL_ROLE_PATTERN, label: 'des rôles de niveau existent' },
    ],
  },
  {
    key: 'arcane',
    label: 'Arcane',
    usernames: ['arcane'],
    covers: ['welcome', 'leveling'],
    leveling: 'standard',
    signatures: [
      { feature: 'leveling', target: 'role', pattern: LEVEL_ROLE_PATTERN, label: 'des rôles de niveau existent' },
    ],
  },
  {
    key: 'tatsu',
    label: 'Tatsu',
    usernames: ['tatsu', 'tatsumaki'],
    covers: ['leveling'],
    leveling: 'standard',
    signatures: [
      { feature: 'leveling', target: 'role', pattern: LEVEL_ROLE_PATTERN, label: 'des rôles de niveau existent' },
    ],
  },
  {
    key: 'amari',
    label: 'Amari',
    usernames: ['amaribot', 'amari'],
    covers: ['leveling'],
    leveling: 'standard',
    signatures: [
      { feature: 'leveling', target: 'role', pattern: LEVEL_ROLE_PATTERN, label: 'des rôles de niveau existent' },
    ],
  },
  {
    key: 'wick',
    label: 'Wick',
    usernames: ['wick'],
    covers: ['automod', 'logs'],
  },
  {
    key: 'sapphire',
    label: 'Sapphire',
    usernames: ['sapphire'],
    covers: ['welcome', 'automod', 'reactionRoles', 'tickets'],
    tickets: 'support',
  },
  {
    key: 'statbot',
    label: 'Statbot',
    usernames: ['statbot'],
    covers: ['stats'],
  },
  {
    key: 'invite-tracker',
    label: 'InviteTracker',
    usernames: ['invitetracker', 'invite tracker', 'invitelogger'],
    covers: ['stats', 'welcome'],
  },
];

const BY_USERNAME = new Map<string, KnownBot>(
  KNOWN_BOTS.flatMap((bot) => bot.usernames.map((username) => [username, bot] as const)),
);

/** Le bot du registre qui porte ce nom d'utilisateur, s'il y en a un. */
export function matchKnownBot(username: string): KnownBot | null {
  return BY_USERNAME.get(username.trim().toLowerCase()) ?? null;
}

/** Libelles francais des fonctions, partages par l'API et le dashboard. */
export const FEATURE_LABELS: Record<BotFeature, string> = {
  welcome: 'Bienvenue',
  leveling: 'Niveaux',
  automod: 'AutoMod',
  reactionRoles: 'Rôles par réaction',
  tickets: 'Tickets',
  stats: 'Statistiques',
  logs: 'Logs',
};
