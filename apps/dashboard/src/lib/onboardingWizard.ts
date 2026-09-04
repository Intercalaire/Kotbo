/**
 * Le parcours de configuration, decrit une fois.
 *
 * Sept ecrans, une decision par ecran. Ce n'est pas une contrainte esthetique :
 * un serveur Discord se configure sur une centaine de reglages, et les
 * presenter par pages en fait une administration a laquelle personne ne
 * s'attelle le jour ou il decouvre le produit. Une question a la fois, en plein
 * ecran, avec une reponse pre-selectionnee : on avance en confirmant.
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

export const WIZARD_STEPS = [
  'welcome',
  'kind',
  'theme',
  'structure',
  'moderation',
  'greeting',
  'checkout',
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Titre de l'etape dans la barre de progression, quand elle est nommee. */
export const STEP_TITLES: Record<WizardStep, string> = {
  welcome: 'Bienvenue',
  kind: 'Votre serveur',
  theme: 'Sa vocation',
  structure: 'La structure',
  moderation: 'La modération',
  greeting: "L'accueil",
  checkout: 'Mise en service',
};

export type ServerKind = 'new' | 'existing';
export type ThemeKey = 'gaming' | 'communaute' | 'entraide' | 'creation';
export type ModerationLevel = 'light' | 'standard' | 'strict';

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
    icon: 'feather',
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
