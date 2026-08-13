import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { isAnalyticsCollectionEnabled } from './analyticsConsent.js';

/**
 * Ghost Members Analyzer - collecte des signaux d'activité silencieuse.
 *
 * Les réactions, interactions (boutons, menus, commandes) et connexions au
 * dashboard sont bufferisées en mémoire puis écrites par lots sur
 * MemberProfile, sur le même principe que analyticsService : un membre très
 * actif ne déclenche pas une écriture par geste.
 */

type GhostSignal = 'reaction' | 'interaction' | 'dashboard';

interface BufferedSignals {
  reactionAt?: Date;
  dashboardAt?: Date;
  /** Réactions + interactions cumulées depuis le dernier flush */
  interactionDelta: number;
}

const FLUSH_INTERVAL_MS = 15_000;
/** Au-delà, on flush immédiatement pour ne pas laisser gonfler le buffer */
const MAX_BUFFER_SIZE = 5_000;

const signalBuffer = new Map<string, BufferedSignals>();

function bufferKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/**
 * Enregistre un signal d'activité silencieuse pour un membre.
 * Non bloquant : le buffer est vidé par l'intervalle de flush.
 */
export function trackGhostSignal(
  guildId: string,
  userId: string,
  signal: GhostSignal,
  at: Date = new Date(),
): void {
  if (!guildId || !userId) return;

  const key = bufferKey(guildId, userId);
  const entry = signalBuffer.get(key) ?? { interactionDelta: 0 };

  switch (signal) {
    case 'reaction':
      entry.reactionAt = at;
      entry.interactionDelta += 1;
      break;
    case 'interaction':
      entry.interactionDelta += 1;
      break;
    case 'dashboard':
      entry.dashboardAt = at;
      break;
  }

  signalBuffer.set(key, entry);

  if (signalBuffer.size >= MAX_BUFFER_SIZE) {
    void flushGhostSignals();
  }
}

/**
 * Regroupe les membres partageant exactement la même mise à jour pour n'émettre
 * qu'un `updateMany` par groupe plutôt qu'une requête par membre.
 */
function groupUpdates(
  entries: [string, BufferedSignals][],
): Map<string, { guildId: string; userIds: string[]; data: Record<string, unknown> }> {
  const groups = new Map<string, { guildId: string; userIds: string[]; data: Record<string, unknown> }>();

  for (const [key, signals] of entries) {
    const sep = key.indexOf(':');
    if (sep === -1) continue;
    const guildId = key.slice(0, sep);
    const userId = key.slice(sep + 1);
    if (!guildId || !userId) continue;

    const data: Record<string, unknown> = {};
    if (signals.reactionAt) data.lastReactionAt = signals.reactionAt;
    if (signals.dashboardAt) data.lastDashboardLoginAt = signals.dashboardAt;
    if (signals.interactionDelta > 0) data.interactionCount = { increment: signals.interactionDelta };
    if (Object.keys(data).length === 0) continue;

    // Les timestamps d'un même flush sont à quelques secondes près : on les
    // arrondit à la seconde pour maximiser le regroupement.
    const groupKey = [
      guildId,
      signals.reactionAt ? Math.floor(signals.reactionAt.getTime() / 1000) : '-',
      signals.dashboardAt ? Math.floor(signals.dashboardAt.getTime() / 1000) : '-',
      signals.interactionDelta,
    ].join('|');

    const group = groups.get(groupKey);
    if (group) {
      group.userIds.push(userId);
    } else {
      groups.set(groupKey, { guildId, userIds: [userId], data });
    }
  }

  return groups;
}

/**
 * Écrit les signaux bufferisés sur MemberProfile.
 *
 * On utilise `updateMany` : un membre sans profil enregistré est ignoré
 * silencieusement, le scraper de membres se chargeant de créer les profils
 * manquants.
 */
export async function flushGhostSignals(): Promise<void> {
  if (signalBuffer.size === 0) return;

  const entries = [...signalBuffer.entries()];
  signalBuffer.clear();

  const groups = groupUpdates(entries);
  if (groups.size === 0) return;

  // Le verrou de collecte est appliqué ici plutôt qu'à la mise en buffer :
  // `trackGhostSignal` est synchrone et appelé sur le chemin chaud, alors que la
  // seule chose qui compte est qu'aucune écriture n'atteigne la base. Les
  // signaux d'un serveur ayant coupé la collecte sont donc simplement jetés.
  const consentByGuild = new Map<string, boolean>();
  for (const { guildId } of groups.values()) {
    if (!consentByGuild.has(guildId)) {
      consentByGuild.set(guildId, await isAnalyticsCollectionEnabled(guildId));
    }
  }

  for (const { guildId, userIds, data } of groups.values()) {
    if (!consentByGuild.get(guildId)) continue;

    try {
      await prisma.memberProfile.updateMany({
        where: { guildId, userId: { in: userIds } },
        data,
      });
    } catch (error) {
      logger.error(
        'GhostAnalyzer',
        `Échec du flush des signaux pour ${userIds.length} membre(s) du serveur ${guildId}:`,
        error,
      );
    }
  }
}

const flushInterval = setInterval(() => {
  void flushGhostSignals();
}, FLUSH_INTERVAL_MS);

process.on('beforeExit', () => {
  clearInterval(flushInterval);
  void flushGhostSignals();
});

/**
 * Enregistre la consultation du dashboard d'un serveur par un membre.
 *
 * Le dashboard émet de nombreuses requêtes par session : on n'en retient qu'une
 * par heure et par couple membre/serveur, ce qui suffit largement à prouver
 * qu'un compte est toujours habité.
 */
const DASHBOARD_THROTTLE_MS = 60 * 60 * 1000;
const dashboardSeenAt = new Map<string, number>();

export function trackDashboardVisit(guildId: string, userId: string): void {
  if (!guildId || !userId) return;

  const key = bufferKey(guildId, userId);
  const now = Date.now();
  const last = dashboardSeenAt.get(key);
  if (last && now - last < DASHBOARD_THROTTLE_MS) return;

  dashboardSeenAt.set(key, now);
  trackGhostSignal(guildId, userId, 'dashboard', new Date(now));

  // Purge opportuniste des entrées périmées pour borner la mémoire
  if (dashboardSeenAt.size > MAX_BUFFER_SIZE) {
    for (const [entryKey, seenAt] of dashboardSeenAt) {
      if (now - seenAt >= DASHBOARD_THROTTLE_MS) dashboardSeenAt.delete(entryKey);
    }
  }
}

/** Réservé aux tests : vide le buffer sans écrire en base. */
export function __resetGhostBuffer(): void {
  signalBuffer.clear();
  dashboardSeenAt.clear();
}

/** Réservé aux tests : expose la taille courante du buffer. */
export function __ghostBufferSize(): number {
  return signalBuffer.size;
}
