/**
 * Tracker de rafale générique en mémoire - généralise le pattern de fenêtre
 * glissante utilisé par l'anti-spam (autoModService.ts) pour n'importe quel
 * type d'action et n'importe quel nombre de fenêtres temporelles vérifiées
 * simultanément (ex: 5 actions/1s OU 10 actions/1min).
 */

const timestampsByKey = new Map<string, number[]>();
const MAX_TRACKED_BURSTS = 50_000;

export type BurstWindow = { limit: number; windowMs: number };

/**
 * Enregistre une occurrence pour `key` à l'instant `now`, purge les entrées
 * hors de la plus grande fenêtre, puis retourne true si au moins une des
 * fenêtres fournies est dépassée (nombre d'occurrences strictement supérieur
 * à sa limite).
 */
export function recordAndCheckBurst(key: string, now: number, windows: BurstWindow[]): boolean {
  if (windows.length === 0) return false;

  const maxWindowMs = Math.max(...windows.map((w) => w.windowMs));
  const times = timestampsByKey.get(key) || [];
  const recentTimes = times.filter((t) => t > now - maxWindowMs);
  recentTimes.push(now);
  timestampsByKey.delete(key);
  timestampsByKey.set(key, recentTimes);
  while (timestampsByKey.size > MAX_TRACKED_BURSTS) {
    const oldest = timestampsByKey.keys().next().value as string | undefined;
    if (!oldest) break;
    timestampsByKey.delete(oldest);
  }

  return windows.some((w) => recentTimes.filter((t) => t > now - w.windowMs).length > w.limit);
}

/** Réinitialise le compteur d'une clé (ex: après une suspension appliquée). */
export function resetBurst(key: string): void {
  timestampsByKey.delete(key);
}
