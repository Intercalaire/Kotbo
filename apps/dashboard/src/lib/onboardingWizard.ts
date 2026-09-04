/**
 * Le parcours de configuration, decrit une fois.
 *
 * Onze ecrans, une decision par ecran. Ce n'est pas une contrainte esthetique :
 * un serveur Discord se configure sur une centaine de reglages, et les
 * presenter par pages en fait une administration a laquelle personne ne
 * s'attelle le jour ou il decouvre le produit. Une question a la fois, en plein
 * ecran, avec une reponse pre-selectionnee : on avance en confirmant.
 *
 * Onze ecrans plutot que sept, parce que ce parcours n'est pas qu'une mise en
 * place : c'est le seul moment ou l'on voit le produit avant de le payer. Un
 * reglement qu'on a ecrit, des tickets qu'on a nommes, une couleur qu'on a
 * choisie sont des choses qu'on n'abandonne pas volontiers a l'ecran suivant.
 * Le prix serait l'intimidation, et il est paye en deux fois : les quatre
 * ecrans ajoutes sont tous facultatifs et le disent, et la progression est
 * groupee en phases nommees plutot qu'egrenee en onze barres identiques.
 *
 * Le tableau de bord n'existe pas pendant ce parcours. Pas de barre laterale,
 * pas d'en-tete, aucune page a atteindre : il n'y a rien a piloter tant que
 * rien n'est monte. Ce qu'on ouvre en payant, c'est le pilotage ; ce qu'on
 * traverse ici, c'est la mise en place.
 *
 * Chaque etape ecrit en la validant. Un parcours abandonne au quatrieme ecran
 * laisse donc un serveur reellement structure, pas un formulaire perdu - et
 * revenir plus tard reprend a l'etape suivante plutot que de tout redemander.
 */
import type { ServerTemplatePlanItem, ServerTemplateSection } from './api';

/**
 * L'ordre n'est pas negociable, et ce n'est pas une question de recit.
 *
 * `identity` precede `structure` parce que la maquette nomme ses salons dans la
 * langue du serveur. `tickets` la precede aussi parce que la pose publie le
 * panneau de tickets : le regler apres laisserait dans le salon un panneau qui
 * ignore les motifs et la couleur qu'on vient de choisir, et le republier en
 * poserait un second a cote du premier.
 *
 * Inversement `greeting`, `rules` et `levels` la suivent : ils ecrivent dans un
 * salon ou sur des roles que la pose vient de creer.
 */
export const WIZARD_STEPS = [
  'welcome',
  'kind',
  'identity',
  'theme',
  'tickets',
  'structure',
  'moderation',
  'greeting',
  'rules',
  'levels',
  'checkout',
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Titre de l'etape dans la barre de progression. */
export const STEP_TITLES: Record<WizardStep, string> = {
  welcome: 'Bienvenue',
  kind: 'Votre serveur',
  identity: 'Sa langue',
  theme: 'Sa vocation',
  structure: 'La structure',
  moderation: 'La modération',
  greeting: "L'accueil",
  rules: 'Le règlement',
  tickets: 'Le support',
  levels: 'La progression',
  checkout: 'Mise en service',
};

/**
 * L'icone qui accompagne le titre de l'ecran, au-dessus de la question.
 *
 * Prise dans le jeu que `Papicon` sait rendre : un nom inconnu ne laisse pas un
 * vide, il affiche un point d'interrogation - ce qui se voit bien plus qu'une
 * icone absente.
 */
export const STEP_ICONS: Record<WizardStep, string> = {
  welcome: 'sparkles',
  kind: 'search',
  identity: 'globe',
  theme: 'compass',
  tickets: 'inbox',
  structure: 'layout-grid',
  moderation: 'shield',
  greeting: 'door-open',
  rules: 'book-open',
  levels: 'crown',
  checkout: 'gem',
};

/**
 * Les etapes qu'on peut traverser sans rien decider.
 *
 * Elles portent un « Passer » visible. Onze ecrans obligatoires seraient un
 * formulaire ; onze ecrans dont quatre s'esquivent d'un clic sont une visite.
 */
export const OPTIONAL_STEPS: readonly WizardStep[] = ['rules', 'tickets', 'levels'];

/**
 * La progression, groupee.
 *
 * « Etape 8 sur 11 » decourage a l'ecran 2. Quatre phases nommees disent la
 * meme longueur en la rendant lisible : on ne compte plus des ecrans, on voit
 * ou l'on en est d'un parcours qui a une forme.
 */
export const WIZARD_PHASES: { key: string; label: string; steps: WizardStep[] }[] = [
  { key: 'discovery', label: 'Découverte', steps: ['welcome', 'kind', 'identity'] },
  { key: 'intent', label: 'Votre serveur', steps: ['theme', 'tickets'] },
  { key: 'build', label: 'Construction', steps: ['structure', 'moderation'] },
  { key: 'polish', label: 'Personnalisation', steps: ['greeting', 'rules', 'levels'] },
  { key: 'launch', label: 'Lancement', steps: ['checkout'] },
];

export function phaseOf(step: WizardStep): string {
  return WIZARD_PHASES.find((phase) => phase.steps.includes(step))?.label ?? '';
}

export type ServerKind = 'new' | 'existing';
export type ThemeKey = 'gaming' | 'communaute' | 'entraide' | 'creation';
export type ModerationLevel = 'light' | 'standard' | 'strict';
export type LevelRhythm = 'calm' | 'standard' | 'intense';

export type Theme = {
  key: ThemeKey;
  label: string;
  pitch: string;
  icon: string;
  /**
   * Sections de la maquette retenues. `access` et `staff` n'en sont jamais
   * absentes : la premiere porte le role Membre a qui tous les salons fermes
   * sont rouverts, la seconde le role sans lequel les salons du staff ne
   * seraient visibles que du bot.
   */
  sections: ServerTemplateSection[];
};

export const THEMES: Theme[] = [
  {
    key: 'communaute',
    label: 'Une communauté',
    pitch: 'On discute, on se retrouve, on organise des choses ensemble.',
    icon: 'users',
    sections: ['access', 'security', 'staff', 'tickets', 'welcome', 'text', 'voice'],
  },
  {
    key: 'gaming',
    label: 'Du jeu',
    pitch: 'Des vocaux, des niveaux, une économie et de quoi se classer.',
    icon: 'trophy',
    sections: ['access', 'security', 'staff', 'tickets', 'welcome', 'text', 'bots', 'voice'],
  },
  {
    key: 'entraide',
    label: "De l'entraide",
    pitch: "On pose des questions, on y répond. Les tickets font le gros du travail.",
    icon: 'help-circle',
    sections: ['access', 'security', 'staff', 'tickets', 'welcome', 'text'],
  },
  {
    key: 'creation',
    label: 'De la création',
    pitch: 'On publie, on montre, on commente. Salons médias et vocaux ouverts.',
    icon: 'sparkles',
    sections: ['access', 'security', 'staff', 'tickets', 'welcome', 'text', 'voice'],
  },
];

export const MODERATION_LEVELS: {
  key: ModerationLevel;
  label: string;
  pitch: string;
  detail: string;
  icon: string;
}[] = [
  {
    key: 'light',
    label: 'Souple',
    pitch: 'Le strict nécessaire',
    detail:
      "Liens d'invitation et spam évident sont bloqués, le reste passe. À choisir si votre communauté est petite et se connaît.",
    icon: 'smile',
  },
  {
    key: 'standard',
    label: 'Équilibré',
    pitch: 'Ce que choisissent la plupart des serveurs',
    detail:
      "Filtres d'insultes, de liens et de spam, plus une détection de vague d'arrivées suspecte. Assez ferme sans être pénible.",
    icon: 'shield',
  },
  {
    key: 'strict',
    label: 'Strict',
    pitch: 'Pour un serveur exposé',
    detail:
      "Tous les filtres, seuils anti-raid resserrés, comptes trop récents mis à l'écart. À choisir si vous avez déjà subi des raids.",
    icon: 'lock',
  },
];

// ── Écran « langue » ─────────────────────────────────────────────────────────

/**
 * Une poignee de fuseaux, pas la liste complete.
 *
 * Le runtime du bot en connait plusieurs centaines et la page de reglages les
 * propose tous. Ici, un menu de six cents entrees serait une question a laquelle
 * personne ne repond : on montre les fuseaux qui couvrent la francophonie et
 * l'Europe, et le reglage complet reste dans le tableau de bord.
 */
export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: 'Europe/Paris', label: 'Paris, Bruxelles, Madrid' },
  { value: 'Europe/London', label: 'Londres, Lisbonne' },
  { value: 'Europe/Zurich', label: 'Genève, Zurich' },
  { value: 'America/Montreal', label: 'Montréal, Québec' },
  { value: 'Africa/Casablanca', label: 'Casablanca, Rabat' },
  { value: 'Indian/Reunion', label: 'La Réunion' },
  { value: 'America/New_York', label: 'New York, Toronto' },
  { value: 'UTC', label: 'UTC (heure universelle)' },
];

// ── Écran « règlement » ──────────────────────────────────────────────────────

export type RulePreset = {
  key: string;
  emoji: string;
  title: string;
  description: string;
  /** Retenu d'office a l'ouverture de l'ecran. */
  byDefault: boolean;
};

/**
 * Un reglement pret a publier, qu'on ajuste plutot qu'on ne redige.
 *
 * Personne n'ecrit huit articles depuis une page blanche le jour ou il decouvre
 * un bot. Ceux-ci couvrent ce qu'on retrouve sur presque tous les serveurs ; ils
 * s'editent sur place, et c'est cette edition qui fait qu'on les considere comme
 * les siens.
 */
export const RULE_PRESETS: RulePreset[] = [
  {
    key: 'respect',
    emoji: '🤝',
    title: 'Respect de tous',
    description:
      "Insultes, harcèlement, propos haineux, discriminations : aucun n'a sa place ici. On peut être en désaccord sans être désagréable.",
    byDefault: true,
  },
  {
    key: 'spam',
    emoji: '🔇',
    title: 'Pas de spam',
    description:
      "Messages répétés, mentions en rafale, majuscules permanentes : gardez les salons lisibles pour les autres.",
    byDefault: true,
  },
  {
    key: 'pub',
    emoji: '📢',
    title: 'Pas de publicité',
    description:
      "Aucune invitation vers un autre serveur ni promotion personnelle sans l'accord du staff, messages privés compris.",
    byDefault: true,
  },
  {
    key: 'nsfw',
    emoji: '🚫',
    title: 'Contenu interdit',
    description:
      "Rien de choquant, illégal ou à caractère sexuel. Cela vaut aussi pour les pseudos, avatars et bannières.",
    byDefault: true,
  },
  {
    key: 'channels',
    emoji: '🗂️',
    title: 'Chaque salon a son sujet',
    description:
      "Postez au bon endroit : c'est ce qui permet de retrouver une discussion plus tard sans tout relire.",
    byDefault: true,
  },
  {
    key: 'privacy',
    emoji: '🔒',
    title: 'Vie privée',
    description:
      "Ne publiez jamais d'informations personnelles, les vôtres ou celles d'un autre membre, sans son accord explicite.",
    byDefault: false,
  },
  {
    key: 'staff',
    emoji: '🛡️',
    title: 'Décisions du staff',
    description:
      "L'équipe tranche et peut sanctionner. Un désaccord se discute en ticket, pas en public.",
    byDefault: false,
  },
  {
    key: 'discord-tos',
    emoji: '📜',
    title: 'Conditions de Discord',
    description:
      "Les règles de Discord s'appliquent en plus des nôtres, et vous devez avoir l'âge minimum requis pour utiliser la plateforme.",
    byDefault: false,
  },
];

// ── Écran « support » ────────────────────────────────────────────────────────

export type TicketPreset = {
  key: string;
  emoji: string;
  label: string;
  description: string;
  /** Vocations pour lesquelles ce motif est coche d'office. */
  themes: ThemeKey[];
};

/**
 * Les motifs d'ouverture proposes sur le panneau de tickets.
 *
 * Coches d'apres la vocation deja choisie : un serveur d'entraide n'a pas les
 * memes demandes qu'un serveur de creation, et re-poser la question serait
 * demander deux fois la meme chose.
 */
export const TICKET_PRESETS: TicketPreset[] = [
  {
    key: 'question',
    emoji: '❓',
    label: 'Une question',
    description: 'Pour tout ce qui ne rentre nulle part ailleurs.',
    themes: ['communaute', 'gaming', 'entraide', 'creation'],
  },
  {
    key: 'help',
    emoji: '🆘',
    label: "Demande d'aide",
    description: "Un problème à résoudre, un coup de main à demander.",
    themes: ['entraide'],
  },
  {
    key: 'report',
    emoji: '⚠️',
    label: 'Signaler un membre',
    description: "Un comportement à porter à la connaissance du staff.",
    themes: ['communaute', 'gaming', 'entraide', 'creation'],
  },
  {
    key: 'bug',
    emoji: '🐛',
    label: 'Signaler un bug',
    description: "Quelque chose ne marche pas comme prévu.",
    themes: ['entraide', 'gaming'],
  },
  {
    key: 'apply',
    emoji: '📝',
    label: 'Candidature',
    description: "Rejoindre le staff, une équipe ou un projet.",
    themes: ['communaute', 'gaming'],
  },
  {
    key: 'partner',
    emoji: '🤝',
    label: 'Partenariat',
    description: "Proposer une collaboration entre serveurs ou créateurs.",
    themes: ['communaute', 'creation'],
  },
  {
    key: 'feedback',
    emoji: '💡',
    label: 'Suggestion',
    description: "Une idée pour améliorer le serveur.",
    themes: ['creation'],
  },
];

export function defaultTicketKeys(theme: ThemeKey): string[] {
  return TICKET_PRESETS.filter((entry) => entry.themes.includes(theme)).map((entry) => entry.key);
}

/**
 * La couleur des panneaux que le bot publie.
 *
 * Discord ne connait pas de couleur d'accent de serveur : cette teinte est
 * celle des embeds que Kotbo poste - panneau de tickets d'abord. C'est le seul
 * reglage du parcours qui ne change rien au fonctionnement, et c'est aussi
 * celui qu'on ouvre en premier : choisir une couleur, c'est commencer a
 * s'approprier ce qu'on installe.
 */
export const PANEL_COLORS: { value: string; label: string }[] = [
  { value: '#5865F2', label: 'Discord' },
  { value: '#00E5FF', label: 'Kotbo' },
  { value: '#10B981', label: 'Émeraude' },
  { value: '#F59E0B', label: 'Ambre' },
  { value: '#EF4444', label: 'Rouge' },
  { value: '#EC4899', label: 'Rose' },
  { value: '#8B5CF6', label: 'Violet' },
  { value: '#64748B', label: 'Ardoise' },
];

// ── Écran « progression » ────────────────────────────────────────────────────

/**
 * Le rythme des niveaux, en trois reglages plutot qu'en six curseurs.
 *
 * La page Niveaux du tableau de bord expose l'XP par message, le palier vocal,
 * le delai anti-farm et la courbe. Ici, on choisit une allure : le detail se
 * regle apres, quand on a vu tourner le systeme et qu'on sait ce qu'on veut
 * corriger.
 */
export const LEVEL_RHYTHMS: {
  key: LevelRhythm;
  label: string;
  pitch: string;
  detail: string;
  icon: string;
  config: { xpMin: number; xpMax: number; cooldownSeconds: number; vocalXpPerMin: number };
}[] = [
  {
    key: 'calm',
    label: 'Calme',
    pitch: 'Les niveaux montent lentement',
    detail:
      "Un palier se mérite sur plusieurs semaines. À choisir si les rôles de niveau doivent rester rares.",
    icon: 'smile',
    config: { xpMin: 5, xpMax: 10, cooldownSeconds: 90, vocalXpPerMin: 2 },
  },
  {
    key: 'standard',
    label: 'Équilibré',
    pitch: 'Le rythme par défaut de Kotbo',
    detail:
      "Un membre actif tous les jours passe les premiers niveaux dans la semaine, puis la courbe se resserre.",
    icon: 'sliders-horizontal',
    config: { xpMin: 15, xpMax: 25, cooldownSeconds: 60, vocalXpPerMin: 5 },
  },
  {
    key: 'intense',
    label: 'Nerveux',
    pitch: 'Ça monte vite, ça se voit',
    detail:
      "Les montées de niveau sont fréquentes et animent le salon. À choisir sur un serveur qui parle beaucoup.",
    icon: 'zap',
    config: { xpMin: 25, xpMax: 40, cooldownSeconds: 30, vocalXpPerMin: 10 },
  },
];

/** Les paliers proposes a l'ecran. Trois : de quoi voir l'idee, pas un tableau. */
export const REWARD_TIERS = [5, 15, 30] as const;

/**
 * Les clefs de la maquette a poser, d'apres la vocation choisie.
 *
 * Sur un serveur deja habite, rien de tout cela : on ne pose pas une
 * arborescence par-dessus la sienne, ou l'on doublerait des salons dont des
 * gens se servent. Seuls les modules sont retenus - ils n'ecrivent rien sur
 * Discord.
 *
 * Les modules suivent leurs salons : poser un salon de niveaux sans allumer le
 * leveling ne produirait rien. Ceux qui n'ont pas de salon a eux - AutoMod,
 * moderation des pseudos - sont retenus dans tous les cas.
 *
 * La selection est renvoyee brute : c'est le serveur qui la remet en etat
 * coherent (`normalizeSelection`), une categorie ne pouvant pas manquer quand
 * un de ses salons est retenu.
 */
export function selectionFor(
  plan: ServerTemplatePlanItem[],
  kind: ServerKind,
  theme: ThemeKey,
): string[] {
  const modules = plan.filter((item) => item.kind === 'module');

  if (kind === 'existing') {
    return modules.map((item) => item.key);
  }

  const wanted = new Set(THEMES.find((entry) => entry.key === theme)?.sections ?? []);
  const kept = plan.filter((item) => item.kind !== 'module' && wanted.has(item.section));
  const keptKeys = new Set(kept.map((item) => item.key));

  const keptModules = modules.filter(
    (item) => !item.linkedTo || keptKeys.has(item.linkedTo),
  );

  return [...keptKeys, ...keptModules.map((item) => item.key)];
}

/** Ce que la selection va poser, resume par nature plutot qu'enumere. */
export function summarize(plan: ServerTemplatePlanItem[], selection: string[]) {
  const selected = new Set(selection);
  const items = plan.filter((item) => selected.has(item.key));
  return {
    roles: items.filter((item) => item.kind === 'role').length,
    categories: items.filter((item) => item.kind === 'category').length,
    channels: items.filter((item) => item.kind === 'text' || item.kind === 'voice').length,
    modules: items.filter((item) => item.kind === 'module').length,
    names: items.filter((item) => item.kind !== 'module').map((item) => item.name),
  };
}

/**
 * Ce que la sequence de montage fait defiler, dans l'ordre ou Discord le cree.
 *
 * Les roles d'abord - les permissions des salons s'y adossent -, puis chaque
 * categorie suivie de ses salons. C'est l'ordre reel de la pose : l'animation
 * ne raconte pas une histoire, elle montre celle qui se deroule pendant qu'elle
 * joue.
 */
export function buildSequence(
  plan: ServerTemplatePlanItem[],
  selection: string[],
): { key: string; name: string; kind: ServerTemplatePlanItem['kind'] }[] {
  const selected = new Set(selection);
  const items = plan.filter((item) => selected.has(item.key) && item.kind !== 'module');

  const roles = items.filter((item) => item.kind === 'role');
  const categories = items.filter((item) => item.kind === 'category');
  const children = items.filter((item) => item.kind === 'text' || item.kind === 'voice');

  const ordered = [...roles];
  for (const category of categories) {
    ordered.push(category);
    ordered.push(...children.filter((item) => item.parent === category.key));
  }
  // Un salon dont la categorie n'est pas retenue reste a poser : sans cette
  // reprise, il manquerait a l'animation alors qu'il est bien cree.
  ordered.push(...children.filter((item) => !ordered.includes(item)));

  return ordered.map((item) => ({ key: item.key, name: item.name, kind: item.kind }));
}
