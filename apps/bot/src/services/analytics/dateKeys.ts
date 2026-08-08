/**
 * Helpers de clés temporelles pour l'analytics.
 *
 * INVARIANT: toutes les tables analytics (`GuildDailyStat`, `GuildHourlyStat`,
 * `PulseSnapshot`, …) sont indexées sur des clés **UTC**. `analyticsService`
 * écrit `dateKey` via `toISOString()` et `hour` via `getUTCHours()`.
 * Tout code qui relit ces tables doit donc raisonner en UTC - utiliser
 * `getDay()`/`getHours()` (locaux) décale les agrégats d'un jour ou d'une heure
 * selon le fuseau de la machine.
 */

/** Clé jour `YYYY-MM-DD` en UTC. */
export function toDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Clé jour décalée de `offset` jours (négatif = passé) par rapport à `from`. */
export function shiftDateKey(offset: number, from: Date = new Date()): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + offset);
  return toDateKey(d);
}

/**
 * Dernier jour **complet** en UTC (= hier).
 *
 * Les snapshots quotidiens doivent porter sur un jour terminé : le cron tourne
 * à 03h00 Europe/Paris, soit 01h/02h UTC, moment où le jour UTC courant ne
 * contient qu'une ou deux heures de données.
 */
export function lastCompleteDateKey(now: Date = new Date()): string {
  return shiftDateKey(-1, now);
}

/** Jour de la semaine (0 = dimanche) d'une clé `YYYY-MM-DD`, en UTC. */
export function dateKeyWeekday(dateKey: string): number {
  const ts = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isNaN(ts) ? 0 : new Date(ts).getUTCDay();
}

/** Bornes `[début, fin[` d'une clé jour, en UTC. */
export function dateKeyBounds(dateKey: string): { start: Date; end: Date } {
  const start = new Date(`${dateKey}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

/** Liste ordonnée des `count` clés jour se terminant à `endKey` inclus. */
export function dateKeyRange(endKey: string, count: number): string[] {
  const end = new Date(`${endKey}T00:00:00.000Z`);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) keys.push(shiftDateKey(-i, end));
  return keys;
}
