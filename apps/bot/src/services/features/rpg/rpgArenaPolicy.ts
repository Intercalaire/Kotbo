/**
 * Règles de l'arène PvP, sans accès base.
 *
 * Tout ce qui décide — appariement, points échangés, récompenses, verrous — vit ici pour
 * être testable sans base ni client Discord. Le service se contente de lire, d'appeler ces
 * fonctions et d'écrire.
 *
 * PARTI PRIS : le duel est asynchrone. Le défenseur n'a pas à être connecté, son
 * personnage se bat seul avec ses statistiques du moment. C'est ce qui rend l'arène
 * jouable sur un Discord, où deux joueurs sont rarement présents en même temps.
 */

/** Points de départ de tout nouveau combattant. */
export const ARENA_START_RATING = 1000;

/** Plancher de classement : perdre ne doit pas enfermer un joueur dans une spirale. */
export const ARENA_RATING_FLOOR = 100;

/** Niveau minimum pour entrer dans l'arène, aligné sur le choix de classe. */
export const ARENA_MIN_LEVEL = 5;

/** Énergie dépensée par duel, et temps d'attente entre deux. */
export const ARENA_ENERGY_COST = 20;
export const ARENA_COOLDOWN_MS = 5 * 60 * 1000;

/** Écart de classement maximal entre deux adversaires proposés. */
export const ARENA_RATING_WINDOW = 250;

/**
 * Facteur K de la formule Elo.
 *
 * Volontairement élevé pour un classement de serveur Discord : à K plus faible, il
 * faudrait des centaines de duels pour que le tableau se trie, et personne ne jouerait
 * assez pour le voir bouger.
 */
export const ARENA_K_FACTOR = 32;

/** Nombre maximal de tours d'un duel, pour qu'aucun ne s'éternise. */
export const ARENA_MAX_TURNS = 40;

export type ArenaRating = { rating: number };

/** Probabilité que `a` l'emporte sur `b`, au sens Elo. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * Points échangés à l'issue d'un duel, toujours positifs.
 *
 * Battre plus fort que soi rapporte davantage, et perdre contre plus faible coûte plus
 * cher : c'est la seule façon de décourager l'acharnement sur les mêmes cibles faibles.
 * Le minimum d'un point évite qu'un duel très déséquilibré ne compte pour rien.
 */
export function ratingExchange(winnerRating: number, loserRating: number): number {
  const gain = ARENA_K_FACTOR * (1 - expectedScore(winnerRating, loserRating));
  return Math.max(1, Math.round(gain));
}

/** Nouveau classement après un duel, plancher appliqué. */
export function applyRating(rating: number, delta: number): number {
  return Math.max(ARENA_RATING_FLOOR, rating + delta);
}

/**
 * Série en cours après un duel.
 *
 * Positive pour des victoires, négative pour des défaites : une victoire après une
 * défaite repart de +1, pas de 0, pour que la série se lise directement.
 */
export function nextStreak(streak: number, won: boolean): number {
  if (won) return streak >= 0 ? streak + 1 : 1;
  return streak <= 0 ? streak - 1 : -1;
}

export type ArenaReward = { coins: number; xp: number };

/**
 * Récompense du vainqueur.
 *
 * Elle suit les points gagnés, et non le niveau : indexée sur le niveau, elle
 * transformerait l'arène en ferme à pièces pour les hauts niveaux qui écrasent des
 * débutants, précisément ce que l'échange de points cherche à décourager.
 */
export function arenaReward(ratingGain: number, won: boolean): ArenaReward {
  if (!won) {
    // Le perdant repart avec de quoi ne pas avoir perdu son énergie pour rien.
    return { coins: 0, xp: 5 };
  }
  return { coins: 40 + ratingGain * 6, xp: 15 + ratingGain * 2 };
}

export type ArenaEntryCheck =
  | { ok: true }
  | { ok: false; reason: 'level' | 'energy' | 'cooldown'; retryInMs?: number };

/** Le challenger peut-il lancer un duel maintenant ? */
export function canEnterArena(
  challenger: { level: number; energy: number },
  lastMatchAt: Date | null,
  now: Date = new Date(),
): ArenaEntryCheck {
  if (challenger.level < ARENA_MIN_LEVEL) return { ok: false, reason: 'level' };
  if (challenger.energy < ARENA_ENERGY_COST) return { ok: false, reason: 'energy' };

  if (lastMatchAt) {
    const elapsed = now.getTime() - lastMatchAt.getTime();
    if (elapsed < ARENA_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', retryInMs: ARENA_COOLDOWN_MS - elapsed };
    }
  }

  return { ok: true };
}

export type ArenaCandidate = {
  userId: string;
  level: number;
  rating: number;
};

/**
 * Adversaires proposables à un challenger.
 *
 * On retient d'abord la fenêtre de classement ; si elle est vide — cas courant sur un
 * petit serveur, ou pour qui est très haut ou très bas — on élargit à tout le monde
 * plutôt que de laisser l'écran vide. Un adversaire mal apparié vaut mieux qu'aucun,
 * l'échange de points corrigeant déjà le déséquilibre.
 */
export function eligibleOpponents(
  challengerId: string,
  challengerRating: number,
  candidates: ArenaCandidate[],
): ArenaCandidate[] {
  const pool = candidates.filter(
    (candidate) => candidate.userId !== challengerId && candidate.level >= ARENA_MIN_LEVEL,
  );

  const inWindow = pool.filter(
    (candidate) => Math.abs(candidate.rating - challengerRating) <= ARENA_RATING_WINDOW,
  );

  const chosen = inWindow.length > 0 ? inWindow : pool;

  // Du plus proche au plus lointain : le duel le plus intéressant se présente en premier.
  return [...chosen].sort(
    (a, b) => Math.abs(a.rating - challengerRating) - Math.abs(b.rating - challengerRating),
  );
}

/** Palier affiché à côté du classement. Purement cosmétique, mais c'est ce qu'on vise. */
export function arenaTier(rating: number): { name: string; emoji: string } {
  if (rating >= 1600) return { name: 'Champion', emoji: '👑' };
  if (rating >= 1400) return { name: 'Maître', emoji: '💎' };
  if (rating >= 1200) return { name: 'Vétéran', emoji: '🥇' };
  if (rating >= 1000) return { name: 'Combattant', emoji: '🥈' };
  if (rating >= 800) return { name: 'Recrue', emoji: '🥉' };
  return { name: 'Bleu', emoji: '🪵' };
}
