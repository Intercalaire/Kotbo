/**
 * Registre des offres commerciales Kotbo — source de vérité unique.
 *
 * `MODULE_REGISTRY` dit *quels* modules existent ; ce fichier dit *lesquels sont
 * vendus avec quelle offre*. Les deux sont volontairement séparés : ajouter un
 * module ne doit pas obliger à toucher la grille tarifaire, et changer un prix
 * ne doit pas risquer de casser une fonctionnalité.
 *
 * Le lien entre les deux se fait par `planIncludesModule`, consulté par
 * `moduleGate` côté bot (garde d'exécution) et par le dashboard (affichage du
 * cadenas). C'est le seul endroit à modifier pour déplacer un module d'une offre
 * à l'autre.
 *
 * Ce paquet ne dépend de rien (ni Prisma, ni Stripe, ni discord.js) : le bot,
 * le dashboard et les scripts l'importent tel quel. Les identifiants Stripe ne
 * sont donc **pas** ici — ils vivent dans les variables d'environnement, dont ce
 * fichier ne connaît que les noms.
 */

import { MODULE_REGISTRY, type ModuleCategory } from './modules.js';

/**
 * Offres, de la plus faible à la plus forte. L'ordre du tableau fait foi pour
 * `comparePlans` : un plan situé plus loin inclut tout ce que porte le précédent.
 *
 * - `FREE`     : état d'un serveur sans abonnement. Ce n'est pas « bot éteint » :
 *                le serveur garde la modération de base, ce qui laisse une porte
 *                d'entrée et évite qu'un impayé rende le serveur ingérable.
 * - `PRO`      : offre principale, en libre-service depuis le dashboard.
 * - `ULTIMATE` : tout le catalogue, en libre-service également.
 * - `CUSTOM`   : accord négocié (grand serveur, white-label, partenariat). Jamais
 *                vendu par Stripe en libre-service : il est posé à la main depuis
 *                l'administration, et débloque tout le catalogue.
 */
export const PLAN_KEYS = ['FREE', 'PRO', 'ULTIMATE', 'CUSTOM'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** Périodicité de facturation. Une offre peut n'en proposer aucune (FREE, CUSTOM). */
export type BillingInterval = 'month' | 'year';

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  /** Accroche courte, affichée sur la carte de l'offre. */
  tagline: string;
  description: string;
  /**
   * Modules débloqués, en plus des modules `core` (toujours inclus, quel que
   * soit le plan : sans eux le serveur n'est plus administrable).
   *
   * `'all'` débloque tout le catalogue, y compris les modules ajoutés plus tard :
   * une offre haut de gamme ne doit pas se retrouver amputée parce qu'on a oublié
   * de mettre à jour une liste.
   */
  modules: 'all' | string[];
  /**
   * Noms des variables d'environnement portant les identifiants de prix Stripe
   * (`price_...`). On stocke le *nom* et pas la valeur pour que ce fichier reste
   * publiable et identique entre test et production — seul le `.env` change.
   *
   * `null` pour les offres qui ne passent pas par Stripe.
   */
  priceEnv: { month: string; year: string } | null;
  /**
   * Tarif affiché, en centimes d'euro. Purement indicatif : le montant réellement
   * débité est celui du prix Stripe. Sert à peindre la page tarifs sans un appel
   * à l'API Stripe à chaque chargement.
   */
  displayPriceCents: { month: number; year: number } | null;
  /** Vendue en libre-service depuis le dashboard (bouton « S'abonner »). */
  selfServe: boolean;
}

/** Catégories entièrement incluses dans l'offre Pro. */
const PRO_CATEGORIES: ModuleCategory[] = ['moderation', 'staff', 'community', 'content'];

/**
 * Modules laissés gratuits. Choisis pour qu'un serveur non abonné reste
 * défendable (sanctions, automod, journaux) et accueillant (règlement, arrivées),
 * sans rien de ce qui fait la valeur des offres payantes.
 */
const FREE_MODULES = [
  'sanctions',
  'automod',
  'logs',
  'regulation',
  'welcome_goodbye',
  'reaction_roles',
  'auto_responses',
  'polls',
  'suggestions',
  'fun',
];

const PRO_MODULES = [
  ...new Set([
    ...FREE_MODULES,
    ...MODULE_REGISTRY.filter((m) => PRO_CATEGORIES.includes(m.category)).map((m) => m.key),
  ]),
];

export const PLAN_REGISTRY: PlanDefinition[] = [
  {
    key: 'FREE',
    name: 'Gratuit',
    tagline: 'De quoi tenir un serveur propre.',
    description:
      "Modération, journaux, règlement et accueil. Aucun engagement, aucune carte bancaire : c'est l'état d'un serveur sans abonnement.",
    modules: FREE_MODULES,
    priceEnv: null,
    displayPriceCents: null,
    selfServe: false,
  },
  {
    key: 'PRO',
    name: 'Pro',
    tagline: 'La communauté et le staff au complet.',
    description:
      "Toute la modération avancée, la gestion du staff, la progression, l'économie, les tickets, les événements et la publication de contenu.",
    modules: PRO_MODULES,
    priceEnv: { month: 'STRIPE_PRICE_PRO_MONTHLY', year: 'STRIPE_PRICE_PRO_YEARLY' },
    displayPriceCents: { month: 999, year: 4_999 },
    selfServe: true,
  },
  {
    key: 'ULTIMATE',
    name: 'Ultimate',
    tagline: 'Tout le catalogue, sans exception.',
    description:
      "Tout Pro, plus les intégrations (analytics, YouTube, Twitch, workflows, santé des salons) et le cross-serveur. Les modules ajoutés plus tard sont inclus d'office.",
    modules: 'all',
    priceEnv: { month: 'STRIPE_PRICE_ULTIMATE_MONTHLY', year: 'STRIPE_PRICE_ULTIMATE_YEARLY' },
    displayPriceCents: { month: 2_500, year: 14_999 },
    selfServe: true,
  },
  {
    key: 'CUSTOM',
    name: 'Sur mesure',
    tagline: 'Accord négocié, facturation hors Stripe.',
    description:
      "Tout le catalogue, sur des conditions convenues au cas par cas. Posé à la main depuis l'administration Kotbo, jamais souscrit en ligne.",
    modules: 'all',
    priceEnv: null,
    displayPriceCents: null,
    selfServe: false,
  },
];

const PLAN_BY_KEY = new Map(PLAN_REGISTRY.map((plan) => [plan.key, plan]));

/** Rang d'une offre dans l'échelle. Sert aux comparaisons « au moins ». */
const PLAN_RANK: Record<PlanKey, number> = {
  FREE: 0,
  PRO: 1,
  ULTIMATE: 2,
  // Un accord sur mesure débloque tout : il se compare comme le sommet de
  // l'échelle, même s'il ne s'achète pas.
  CUSTOM: 3,
};

/**
 * Ramène une valeur venue de la base ou d'une requête à une offre connue. Toute
 * valeur inattendue retombe sur `FREE` : en cas de donnée corrompue, on ferme,
 * on n'ouvre pas.
 */
export function normalizePlanKey(value: unknown): PlanKey {
  const candidate = typeof value === 'string' ? value.toUpperCase() : '';
  return (PLAN_KEYS as readonly string[]).includes(candidate) ? (candidate as PlanKey) : 'FREE';
}

export function getPlanDefinition(plan: PlanKey): PlanDefinition {
  return PLAN_BY_KEY.get(plan) ?? PLAN_BY_KEY.get('FREE')!;
}

/** Négatif si `a` est en dessous de `b`, 0 si égal, positif si au-dessus. */
export function comparePlans(a: PlanKey, b: PlanKey): number {
  return PLAN_RANK[a] - PLAN_RANK[b];
}

/**
 * Clés des modules ouverts par une offre, modules `core` compris. Toujours une
 * liste concrète, y compris pour `'all'`, pour être affichable telle quelle.
 */
export function modulesForPlan(plan: PlanKey): string[] {
  const definition = getPlanDefinition(plan);
  if (definition.modules === 'all') return MODULE_REGISTRY.map((m) => m.key);

  const included = new Set(definition.modules);
  for (const mod of MODULE_REGISTRY) {
    if (mod.core) included.add(mod.key);
  }
  return MODULE_REGISTRY.filter((m) => included.has(m.key)).map((m) => m.key);
}

const MODULES_BY_PLAN = new Map<PlanKey, Set<string>>(
  PLAN_KEYS.map((key) => [key, new Set(modulesForPlan(key))]),
);

/**
 * L'offre `plan` donne-t-elle accès au module `moduleKey` ?
 *
 * Un module inconnu du registre est considéré inclus : la grille tarifaire ne
 * doit pas fermer une fonctionnalité qu'elle ne sait pas décrire — même règle
 * que `moduleGate`, pour que les deux gardes se comportent pareil.
 */
export function planIncludesModule(plan: PlanKey, moduleKey: string): boolean {
  if (!MODULE_REGISTRY.some((m) => m.key === moduleKey)) return true;
  return MODULES_BY_PLAN.get(plan)?.has(moduleKey) ?? false;
}

/**
 * Offre la plus basse qui ouvre ce module — c'est elle qu'on propose à l'achat
 * quand un administrateur clique sur un module verrouillé. `null` si le module
 * est déjà gratuit, ou inconnu.
 *
 * `CUSTOM` est écarté : on ne propose pas un accord négocié comme solution à un
 * clic sur un cadenas.
 */
export function lowestPlanWithModule(moduleKey: string): PlanKey | null {
  if (planIncludesModule('FREE', moduleKey)) return null;
  for (const key of PLAN_KEYS) {
    if (key === 'CUSTOM' || key === 'FREE') continue;
    if (planIncludesModule(key, moduleKey)) return key;
  }
  return null;
}

/**
 * Durée de l'essai gratuit offert à la première souscription, en jours.
 *
 * Ici et pas dans une variable d'environnement : la durée est un engagement
 * commercial affiché sur la page tarifs et dans les CGU, elle doit être la même
 * sur toutes les instances et lisible depuis le dashboard comme depuis le bot.
 * Stripe n'en garde aucune trace côté prix — c'est le paramètre
 * `trial_period_days` de la session de paiement qui la porte, à chaque fois.
 */
export const TRIAL_DAYS = 15;

/**
 * Cette offre ouvre-t-elle droit à l'essai gratuit ?
 *
 * Seules les offres vendues en libre-service : `FREE` n'a rien à essayer, et un
 * accord `CUSTOM` se négocie, période de découverte comprise.
 */
export function planAllowsTrial(plan: PlanKey): boolean {
  return getPlanDefinition(plan).selfServe;
}
