/**
 * Règles du rééquilibrage des clans vers des clans nouvellement créés.
 *
 * Aucun accès base ni Discord : le service voisin rassemble les membres, leurs points et
 * leurs dates d'arrivée, ce module décide qui part et où. La sélection doit pouvoir se
 * vérifier en test, les arrivées en cours de saison en premier.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Présence minimale sur la saison de référence pour que ses points jugent un membre.
 *
 * En dessous, quelques points sur deux jours diraient une activité dix fois plus forte
 * ou plus faible qu'elle ne l'est : on se rabat sur la saison en cours.
 */
export const MIN_REFERENCE_PRESENCE_DAYS = 7;

/** D'où vient la mesure d'activité d'un membre, affichée dans l'aperçu. */
export type ActivityBasis = 'previous' | 'current' | 'none';

export interface SeasonWindow {
  start: Date;
  end: Date;
}

export interface ActivityInput {
  /** Arrivée sur le serveur ; `null` quand Discord ne la donne pas, lue comme « depuis toujours ». */
  joinedAt: Date | null;
  /** Saison de référence et points du membre sur celle-ci ; `null` quand il n'y en a pas. */
  previous: (SeasonWindow & { points: number }) | null;
  current: SeasonWindow & { points: number };
}

export interface Activity {
  basis: ActivityBasis;
  /** Points retenus, sur la saison désignée par `basis`. */
  points: number;
  /** Jours de présence sur cette même saison. */
  presenceDays: number;
  /** Points par jour de présence : c'est ce qui classe les membres entre eux. */
  rate: number;
}

function presenceDays(joinedAt: Date | null, window: SeasonWindow): number {
  const from = joinedAt ? Math.max(joinedAt.getTime(), window.start.getTime()) : window.start.getTime();
  return Math.max(0, (window.end.getTime() - from) / MS_PER_DAY);
}

/**
 * Mesure l'activité d'un membre, ramenée à son temps de présence.
 *
 * Comparer des totaux bruts ferait partir en priorité ceux qui sont arrivés en fin de
 * saison : trois semaines de présence contre trois mois, ils ont forcément moins de
 * points, même en jouant chaque jour. Le rythme par jour de présence les met à égalité.
 */
export function measureActivity(input: ActivityInput): Activity {
  if (input.previous) {
    const windowDays = (input.previous.end.getTime() - input.previous.start.getTime()) / MS_PER_DAY;
    // Une saison de référence plus courte que le seuil ne jugerait personne : le seuil
    // suit alors sa durée.
    const threshold = Math.min(MIN_REFERENCE_PRESENCE_DAYS, windowDays / 2);
    const days = presenceDays(input.joinedAt, input.previous);
    if (days > 0 && days >= threshold) {
      const points = Math.max(0, input.previous.points);
      return { basis: 'previous', points, presenceDays: days, rate: points / days };
    }
  }

  const days = presenceDays(input.joinedAt, input.current);
  const points = Math.max(0, input.current.points);
  // Moins d'un jour : le rythme d'une poignée d'heures ne veut rien dire, dans un sens
  // comme dans l'autre.
  if (days >= 1) {
    return { basis: 'current', points, presenceDays: days, rate: points / days };
  }
  return { basis: 'none', points, presenceDays: days, rate: 0 };
}

/** Raisons qui retirent un membre de la sélection, quelle que soit son activité. */
export type RebalanceExclusion =
  | 'multi_clan'
  | 'split_accounts'
  | 'leader'
  | 'open_bet'
  | 'excluded'
  | 'protected';

export interface RebalanceCandidate {
  /** Identifiant canonique du groupe de comptes, celui qui porte les points. */
  key: string;
  /** Comptes présents sur le serveur : un double compte part avec son principal. */
  userIds: string[];
  clanId: string;
  activity: Activity;
  exclusion: RebalanceExclusion | null;
}

export interface RebalanceClan {
  id: string;
  count: number;
}

export interface RebalanceOptions {
  /** Clans à remplir ; les autres donnent. */
  targetClanIds: string[];
  /** Effectif au-delà duquel un clan cible ne reçoit plus personne. */
  targetSize: number;
  mode?: RebalanceMode;
  /** Graine du tirage et du départage ; la même graine redonne la même liste. */
  seed?: number;
}

export interface RebalanceMove {
  key: string;
  fromClanId: string;
  toClanId: string;
}

export interface RebalancePlan {
  moves: RebalanceMove[];
  /** Effectifs après application, par clan. */
  counts: Record<string, number>;
}

/** Effectif moyen, arrondi au-dessus : la taille visée par défaut d'un nouveau clan. */
export function averageClanSize(clans: RebalanceClan[]): number {
  if (clans.length === 0) return 0;
  const total = clans.reduce((sum, clan) => sum + clan.count, 0);
  return Math.ceil(total / clans.length);
}

/**
 * Ordre dans lequel les membres quittent un clan donneur.
 *
 * - `least_active` : le rythme le plus faible d'abord, pour ne pas affaiblir les clans qui donnent.
 * - `most_active` : l'inverse, pour donner d'emblée une vraie équipe aux nouveaux clans.
 * - `random` : tirage au sort, reproductible à graine égale.
 */
export type RebalanceMode = 'least_active' | 'most_active' | 'random';

export const REBALANCE_MODES: readonly RebalanceMode[] = ['least_active', 'most_active', 'random'];

/**
 * Hachage stable d'une clé, mêlé à une graine.
 *
 * Sert à départager les égalités et à tirer au sort. Beaucoup de membres finissent à zéro
 * point : sans départage, l'ordre des identifiants Discord déciderait, et ce seraient
 * toujours les comptes les plus anciens qui partent. À graine égale, l'ordre reste le même
 * d'un aperçu à l'autre, ce qui permet de garder un membre sans rebattre toute la liste.
 */
function hashKey(key: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d);
  hash ^= hash >>> 12;
  return hash >>> 0;
}

/**
 * Construit l'ordre de départ d'un clan donneur pour un mode donné.
 *
 * Un membre sans mesure (arrivé depuis moins d'un jour) passe après tous ceux qui en ont
 * une, quel que soit le mode trié : son rythme nul ne dit pas qu'il est inactif, seulement
 * qu'on ne sait rien de lui encore. En `least_active`, il partirait sinon avant un ancien
 * qui joue un peu, ce qui revient à juger quelqu'un sur ses premières heures.
 *
 * À rythme égal en `least_active`, le membre observé le plus longtemps part avant : zéro
 * point en deux mois est une inactivité établie, zéro point en trois jours pas encore.
 */
export function departureOrder(mode: RebalanceMode, seed = 0) {
  return (a: RebalanceCandidate, b: RebalanceCandidate): number => {
    if (mode === 'random') return hashKey(a.key, seed) - hashKey(b.key, seed);

    const aMeasured = a.activity.basis !== 'none';
    const bMeasured = b.activity.basis !== 'none';
    if (aMeasured !== bMeasured) return aMeasured ? -1 : 1;

    if (a.activity.rate !== b.activity.rate) {
      return mode === 'least_active' ? a.activity.rate - b.activity.rate : b.activity.rate - a.activity.rate;
    }
    if (mode === 'least_active' && a.activity.presenceDays !== b.activity.presenceDays) {
      return b.activity.presenceDays - a.activity.presenceDays;
    }
    return hashKey(a.key, seed) - hashKey(b.key, seed);
  };
}

/**
 * Choisit qui quitte les clans donneurs et vers quel clan cible.
 *
 * À chaque tour, le plus petit clan cible reçoit le prochain partant du plus gros clan
 * donneur, dans l'ordre fixé par le mode. Un transfert n'a lieu que s'il ne rend pas le
 * donneur plus petit que la cible : au-delà, on déplacerait des gens pour créer le
 * déséquilibre inverse.
 */
export function planRebalance(
  clans: RebalanceClan[],
  candidates: RebalanceCandidate[],
  options: RebalanceOptions,
): RebalancePlan {
  const counts: Record<string, number> = Object.fromEntries(clans.map((clan) => [clan.id, clan.count]));
  const targets = new Set(options.targetClanIds.filter((id) => id in counts));
  const moves: RebalanceMove[] = [];

  const queues = new Map<string, RebalanceCandidate[]>();
  for (const clan of clans) {
    if (targets.has(clan.id)) continue;
    const queue = candidates
      .filter((candidate) => candidate.clanId === clan.id && candidate.exclusion === null && candidate.userIds.length > 0)
      .sort(departureOrder(options.mode ?? 'least_active', options.seed ?? 0));
    if (queue.length > 0) queues.set(clan.id, queue);
  }

  if (targets.size === 0) return { moves, counts };

  const byCountThenId = (a: string, b: string) => counts[a] - counts[b] || a.localeCompare(b);

  while (queues.size > 0) {
    const target = [...targets].sort(byCountThenId)[0];
    if (counts[target] >= options.targetSize) break;

    const source = [...queues.keys()].sort((a, b) => byCountThenId(b, a))[0];
    const queue = queues.get(source)!;
    const candidate = queue.shift()!;
    if (queue.length === 0) queues.delete(source);

    const size = candidate.userIds.length;
    if (counts[source] - size < counts[target] + size) {
      // Un membre seul qui ne passe pas signifie que plus aucun donneur ne peut aider,
      // puisque c'est le plus gros qui a été essayé. Un groupe de comptes, lui, peut être
      // trop lourd là où un membre seul passerait encore.
      if (size === 1) break;
      continue;
    }

    counts[source] -= size;
    counts[target] += size;
    moves.push({ key: candidate.key, fromClanId: source, toClanId: target });
  }

  return { moves, counts };
}
