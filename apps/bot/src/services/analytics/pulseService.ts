/**
 * Pulse - score de santé quotidien d'un serveur.
 *
 * Deux corrections structurelles par rapport à la version précédente :
 *
 * - **Les snapshots portent sur un jour terminé.** Le cron tourne à 03h00
 *   Europe/Paris, soit 01h/02h UTC. L'ancienne version calculait le snapshot du
 *   jour UTC *courant*, qui ne contenait alors qu'une ou deux heures de données :
 *   le score d'activité était systématiquement écrasé. On calcule désormais le
 *   dernier jour complet (J-1), et l'aperçu « aujourd'hui » est exposé à part,
 *   marqué comme partiel.
 *
 * - **Les entrées/sorties sont groupées.** `runPulseForAllGuilds` faisait 5
 *   requêtes par serveur en série. On charge maintenant toutes les guildes en un
 *   nombre fixe de requêtes, puis on écrit par lots.
 */
import prisma, { prismaRead } from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import type { Client } from 'discord.js';
import {
  toDateKey,
  shiftDateKey,
  lastCompleteDateKey,
  dateKeyBounds,
  dateKeyRange,
} from './dateKeys.js';
import {
  computePulseScores,
  generateAlerts,
  median,
  resolveTrend,
  type PulseAlert,
  type PulseBaseline,
  type PulseScoreInput,
} from './pulseScoring.js';

/** Fenêtre de référence servant à calculer les médianes du serveur. */
const BASELINE_DAYS = 28;
/** Nombre de jours d'historique renvoyés au dashboard. */
const HISTORY_DAYS = 30;
/** Taille des lots d'écriture (une transaction par lot). */
const WRITE_CHUNK = 25;

export interface PulseSnapshotView {
  dateKey: string;
  score: number;
  activityScore: number;
  moderationScore: number;
  growthScore: number;
  engagementScore: number;
  healthScore: number;
  trend: string;
  trendDelta: number;
  alerts: PulseAlert[];
  /** Vrai si le jour n'est pas terminé (aperçu « aujourd'hui »). */
  partial: boolean;
}

export interface PulseMetrics {
  totalMessages: number;
  totalVoiceMinutes: number;
  activeMembers: number;
  totalMembers: number;
  membersJoined: number;
  membersLeft: number;
  sanctionsCount: number;
  ticketsResolved: number;
  ticketsOpen: number;
  channelsHealthy: number;
  channelsUnhealthy: number;
}

export interface PulseData {
  /** Faux quand aucun snapshot n'existe : le dashboard doit afficher un état vide. */
  hasData: boolean;
  current: PulseSnapshotView;
  /** Aperçu du jour en cours, recalculé à la volée. `null` si pas de données. */
  today: (PulseSnapshotView & { metrics: PulseMetrics }) | null;
  history: Array<{
    dateKey: string;
    score: number;
    activityScore: number;
    moderationScore: number;
    growthScore: number;
    engagementScore: number;
    healthScore: number;
  }>;
  metrics: PulseMetrics;
}

const EMPTY_METRICS: PulseMetrics = {
  totalMessages: 0,
  totalVoiceMinutes: 0,
  activeMembers: 0,
  totalMembers: 0,
  membersJoined: 0,
  membersLeft: 0,
  sanctionsCount: 0,
  ticketsResolved: 0,
  ticketsOpen: 0,
  channelsHealthy: 0,
  channelsUnhealthy: 0,
};

const UNHEALTHY_ALERT_TYPES = ['SPLIT_SUGGESTED', 'ARCHIVE_SUGGESTED', 'MERGE_SUGGESTED'] as const;

// ---------------------------------------------------------------------------
// Chargement groupé des entrées
// ---------------------------------------------------------------------------

type DailyRow = {
  guildId: string;
  dateKey: string;
  totalMembers: number;
  totalBots: number;
  totalHumans: number;
  messagesCount: number;
  voiceMinutes: number;
  activeMembers: number;
  activeVoiceMembers: number;
  membersJoined: number;
  membersLeft: number;
  sanctionsCount: number;
};

const DAILY_SELECT = {
  guildId: true,
  dateKey: true,
  totalMembers: true,
  totalBots: true,
  totalHumans: true,
  messagesCount: true,
  voiceMinutes: true,
  activeMembers: true,
  activeVoiceMembers: true,
  membersJoined: true,
  membersLeft: true,
  sanctionsCount: true,
} as const;

/**
 * Effectif humain d'un jour. `totalHumans` peut être à 0 sur d'anciennes lignes
 * écrites avant que la colonne existe : on retombe alors sur `totalMembers - totalBots`.
 */
function resolveHumans(row: Pick<DailyRow, 'totalHumans' | 'totalMembers' | 'totalBots'>): number {
  if (row.totalHumans > 0) return row.totalHumans;
  const derived = row.totalMembers - row.totalBots;
  return derived > 0 ? derived : row.totalMembers;
}

/**
 * Médianes du serveur sur les jours précédant `dateKey` (le jour évalué est
 * exclu, sinon il tirerait sa propre référence vers lui).
 */
function buildBaseline(rows: DailyRow[], dateKey: string): PulseBaseline | null {
  const previous = rows.filter((r) => r.dateKey < dateKey);
  if (previous.length === 0) return null;

  const messagesPerHuman: number[] = [];
  const voicePerHuman: number[] = [];
  const participation: number[] = [];

  for (const row of previous) {
    const humans = resolveHumans(row);
    if (humans <= 0) continue;
    messagesPerHuman.push(row.messagesCount / humans);
    voicePerHuman.push(row.voiceMinutes / humans);
    participation.push(row.activeMembers / humans);
  }

  if (messagesPerHuman.length === 0) return null;

  return {
    messagesPerHuman: median(messagesPerHuman),
    voicePerHuman: median(voicePerHuman),
    participationRate: median(participation),
    sampleDays: messagesPerHuman.length,
  };
}

interface GuildPulseContext {
  daily: DailyRow[];
  ticketsOpen: number;
  ticketsResolved: number;
  channelsUnhealthy: number;
  totalChannels: number;
  previousScore: number | null;
}

/**
 * Charge, en un nombre fixe de requêtes, tout ce qui est nécessaire pour calculer
 * le snapshot de `dateKey` sur l'ensemble des `guildIds`.
 */
async function loadPulseContexts(
  client: Client,
  guildIds: string[],
  dateKey: string,
): Promise<Map<string, GuildPulseContext>> {
  const contexts = new Map<string, GuildPulseContext>();
  if (guildIds.length === 0) return contexts;

  const { end: dayEnd, start: dayStart } = dateKeyBounds(dateKey);
  const windowStartKey = shiftDateKey(-BASELINE_DAYS, new Date(`${dateKey}T00:00:00.000Z`));

  const [dailyRows, openTickets, resolvedTickets, healthAlerts, previousSnapshots, channelRows] =
    await Promise.all([
      prismaRead.guildDailyStat.findMany({
        where: { guildId: { in: guildIds }, dateKey: { gte: windowStartKey, lte: dateKey } },
        select: DAILY_SELECT,
        orderBy: { dateKey: 'asc' },
      }),
      // Backlog tel qu'il était à la fin du jour évalué, pas tel qu'il est maintenant.
      prismaRead.ticket.groupBy({
        by: ['guildId'],
        where: {
          guildId: { in: guildIds },
          createdAt: { lt: dayEnd },
          OR: [{ closedAt: null }, { closedAt: { gte: dayEnd } }],
        },
        _count: { _all: true },
      }),
      prismaRead.ticket.groupBy({
        by: ['guildId'],
        where: { guildId: { in: guildIds }, closedAt: { gte: dayStart, lt: dayEnd } },
        _count: { _all: true },
      }),
      prismaRead.channelHealthAlert.groupBy({
        by: ['guildId'],
        where: {
          guildId: { in: guildIds },
          status: 'PENDING',
          type: { in: [...UNHEALTHY_ALERT_TYPES] },
          createdAt: { lt: dayEnd },
        },
        _count: { _all: true },
      }),
      // Dernier snapshot antérieur : on remonte jusqu'à 7 jours pour que la
      // tendance reste calculable après une coupure du bot.
      prismaRead.pulseSnapshot.findMany({
        where: {
          guildId: { in: guildIds },
          dateKey: { in: dateKeyRange(shiftDateKey(-1, new Date(`${dateKey}T00:00:00.000Z`)), 7) },
        },
        select: { guildId: true, dateKey: true, score: true },
        orderBy: { dateKey: 'desc' },
      }),
      // Nombre de salons connus, pour les guildes absentes du cache (sharding).
      prismaRead.channelDailyStat.groupBy({
        by: ['guildId', 'channelId'],
        where: { guildId: { in: guildIds }, dateKey: { gte: windowStartKey, lte: dateKey } },
      }),
    ]);

  const dailyByGuild = new Map<string, DailyRow[]>();
  for (const row of dailyRows) {
    const list = dailyByGuild.get(row.guildId);
    if (list) list.push(row as DailyRow);
    else dailyByGuild.set(row.guildId, [row as DailyRow]);
  }

  const toCount = (rows: Array<{ guildId: string; _count: { _all: number } }>) =>
    new Map(rows.map((r) => [r.guildId, r._count._all]));

  const openMap = toCount(openTickets as any);
  const resolvedMap = toCount(resolvedTickets as any);
  const unhealthyMap = toCount(healthAlerts as any);

  const previousMap = new Map<string, number>();
  for (const snap of previousSnapshots) {
    // Trié par dateKey décroissant : la première occurrence est la plus récente.
    if (!previousMap.has(snap.guildId)) previousMap.set(snap.guildId, snap.score);
  }

  const dbChannelCount = new Map<string, number>();
  for (const row of channelRows as Array<{ guildId: string }>) {
    dbChannelCount.set(row.guildId, (dbChannelCount.get(row.guildId) ?? 0) + 1);
  }

  for (const guildId of guildIds) {
    const cached = client.guilds.cache.get(guildId);
    const cachedChannels = cached
      ? cached.channels.cache.filter((c) => c.isTextBased() && !c.isThread()).size
      : 0;

    contexts.set(guildId, {
      daily: dailyByGuild.get(guildId) ?? [],
      ticketsOpen: openMap.get(guildId) ?? 0,
      ticketsResolved: resolvedMap.get(guildId) ?? 0,
      channelsUnhealthy: unhealthyMap.get(guildId) ?? 0,
      // Le cache Discord est la source la plus juste ; sinon on retombe sur les
      // salons vus dans les stats (guilde sur un autre shard, cache non peuplé).
      totalChannels: cachedChannels > 0 ? cachedChannels : (dbChannelCount.get(guildId) ?? 0),
      previousScore: previousMap.get(guildId) ?? null,
    });
  }

  return contexts;
}

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

interface ComputedSnapshot {
  guildId: string;
  dateKey: string;
  scores: ReturnType<typeof computePulseScores>;
  input: PulseScoreInput;
  alerts: PulseAlert[];
  trend: string;
  trendDelta: number;
  metrics: PulseMetrics;
}

function buildSnapshot(guildId: string, dateKey: string, ctx: GuildPulseContext): ComputedSnapshot {
  const dayRow = ctx.daily.find((r) => r.dateKey === dateKey) ?? null;
  const humans = dayRow ? resolveHumans(dayRow) : 0;

  const channelsUnhealthy = Math.min(ctx.channelsUnhealthy, ctx.totalChannels || ctx.channelsUnhealthy);
  const channelsHealthy = Math.max(0, ctx.totalChannels - channelsUnhealthy);

  const input: PulseScoreInput = {
    humans,
    totalMembers: dayRow?.totalMembers ?? 0,
    messages: dayRow?.messagesCount ?? 0,
    voiceMinutes: dayRow?.voiceMinutes ?? 0,
    activeMembers: dayRow?.activeMembers ?? 0,
    activeVoiceMembers: dayRow?.activeVoiceMembers ?? 0,
    membersJoined: dayRow?.membersJoined ?? 0,
    membersLeft: dayRow?.membersLeft ?? 0,
    sanctionsCount: dayRow?.sanctionsCount ?? 0,
    ticketsOpen: ctx.ticketsOpen,
    ticketsResolved: ctx.ticketsResolved,
    channelsHealthy,
    channelsUnhealthy,
    baseline: buildBaseline(ctx.daily, dateKey),
  };

  const scores = computePulseScores(input);
  const alerts = generateAlerts(scores, input);

  const trendDelta = ctx.previousScore === null ? 0 : scores.score - ctx.previousScore;
  const trend = ctx.previousScore === null ? 'STABLE' : resolveTrend(trendDelta);

  return {
    guildId,
    dateKey,
    scores,
    input,
    alerts,
    trend,
    trendDelta,
    metrics: {
      totalMessages: input.messages,
      totalVoiceMinutes: input.voiceMinutes,
      activeMembers: input.activeMembers,
      totalMembers: input.totalMembers,
      membersJoined: input.membersJoined,
      membersLeft: input.membersLeft,
      sanctionsCount: input.sanctionsCount,
      ticketsResolved: input.ticketsResolved,
      ticketsOpen: input.ticketsOpen,
      channelsHealthy,
      channelsUnhealthy,
    },
  };
}

function snapshotWriteData(snap: ComputedSnapshot) {
  return {
    score: snap.scores.score,
    activityScore: snap.scores.activityScore,
    moderationScore: snap.scores.moderationScore,
    growthScore: snap.scores.growthScore,
    engagementScore: snap.scores.engagementScore,
    healthScore: snap.scores.healthScore,
    totalMessages: snap.metrics.totalMessages,
    totalVoiceMinutes: snap.metrics.totalVoiceMinutes,
    activeMembers: snap.metrics.activeMembers,
    totalMembers: snap.metrics.totalMembers,
    membersJoined: snap.metrics.membersJoined,
    membersLeft: snap.metrics.membersLeft,
    sanctionsCount: snap.metrics.sanctionsCount,
    ticketsResolved: snap.metrics.ticketsResolved,
    ticketsOpen: snap.metrics.ticketsOpen,
    channelsHealthy: snap.metrics.channelsHealthy,
    channelsUnhealthy: snap.metrics.channelsUnhealthy,
    trend: snap.trend,
    trendDelta: snap.trendDelta,
    alerts: snap.alerts as any,
  };
}

async function persistSnapshots(snapshots: ComputedSnapshot[]): Promise<void> {
  for (let i = 0; i < snapshots.length; i += WRITE_CHUNK) {
    const chunk = snapshots.slice(i, i + WRITE_CHUNK);
    try {
      await prisma.$transaction(
        chunk.map((snap) => {
          const data = snapshotWriteData(snap);
          return prisma.pulseSnapshot.upsert({
            where: { guildId_dateKey: { guildId: snap.guildId, dateKey: snap.dateKey } },
            create: { guildId: snap.guildId, dateKey: snap.dateKey, ...data },
            update: data,
          });
        }),
      );
    } catch (error) {
      // Un lot en échec ne doit pas faire tomber les autres : on réessaie ligne à ligne.
      logger.warn('Pulse', `Lot d'écriture en échec (${chunk.length} snapshots), reprise unitaire`, error);
      for (const snap of chunk) {
        const data = snapshotWriteData(snap);
        try {
          await prisma.pulseSnapshot.upsert({
            where: { guildId_dateKey: { guildId: snap.guildId, dateKey: snap.dateKey } },
            create: { guildId: snap.guildId, dateKey: snap.dateKey, ...data },
            update: data,
          });
        } catch (err) {
          logger.error('Pulse', `Écriture du snapshot ${snap.guildId}/${snap.dateKey} impossible:`, err);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Calcule et enregistre le snapshot d'un serveur.
 *
 * @param dateKey Jour à évaluer. Par défaut le dernier jour **complet** (J-1).
 *                Le jour en cours n'est jamais persisté : il serait comparé à des
 *                journées entières et ferait plonger la tendance chaque matin.
 *                Pour l'afficher, voir {@link getPulseDashboardDataWithToday}.
 */
export async function computePulseSnapshot(
  client: Client,
  guildId: string,
  dateKey: string = lastCompleteDateKey(),
): Promise<void> {
  if (dateKey >= toDateKey()) {
    logger.warn('Pulse', `Snapshot ignoré pour ${guildId}: ${dateKey} n'est pas un jour terminé`);
    return;
  }

  try {
    const contexts = await loadPulseContexts(client, [guildId], dateKey);
    const ctx = contexts.get(guildId);
    if (!ctx) return;

    const snapshot = buildSnapshot(guildId, dateKey, ctx);
    await persistSnapshots([snapshot]);

    logger.debug('Pulse', `Snapshot ${dateKey} pour ${guildId}: score=${snapshot.scores.score}`);
  } catch (error) {
    logger.error('Pulse', `Erreur lors du calcul du pulse pour ${guildId}:`, error);
  }
}

/**
 * Recalcule les `days` derniers jours complets d'un serveur.
 *
 * Sert au bouton « Recalculer » du dashboard : les snapshots écrits par les
 * versions antérieures portaient sur une journée à peine entamée et sont donc
 * faux. Les rejouer sur le même jour, avec les données désormais complètes,
 * répare l'historique affiché.
 *
 * Les jours sont traités du plus ancien au plus récent pour que chaque tendance
 * soit calculée à partir d'un jour précédent déjà corrigé.
 */
export async function backfillPulseHistory(
  client: Client,
  guildId: string,
  days = 7,
): Promise<number> {
  const bounded = Math.min(Math.max(Math.trunc(days) || 1, 1), 30);
  const keys = dateKeyRange(lastCompleteDateKey(), bounded);

  let written = 0;
  for (const dateKey of keys) {
    try {
      const contexts = await loadPulseContexts(client, [guildId], dateKey);
      const ctx = contexts.get(guildId);
      if (!ctx) continue;
      await persistSnapshots([buildSnapshot(guildId, dateKey, ctx)]);
      written++;
    } catch (error) {
      logger.error('Pulse', `Backfill ${guildId}/${dateKey} en échec:`, error);
    }
  }

  return written;
}

/**
 * Recalcule le snapshot du dernier jour complet pour tous les serveurs.
 *
 * Coût : un nombre fixe de lectures (6) quel que soit le nombre de guildes, puis
 * une transaction d'écriture par lot de {@link WRITE_CHUNK}.
 */
export async function runPulseForAllGuilds(
  client: Client,
  dateKey: string = lastCompleteDateKey(),
): Promise<void> {
  if (dateKey >= toDateKey()) {
    logger.warn('Pulse', `Calcul groupé ignoré: ${dateKey} n'est pas un jour terminé`);
    return;
  }

  const started = Date.now();
  const guilds = await prismaRead.guild.findMany({ select: { id: true } });
  const guildIds = guilds.map((g) => g.id);
  if (guildIds.length === 0) return;

  try {
    const contexts = await loadPulseContexts(client, guildIds, dateKey);
    const snapshots = guildIds
      .map((guildId) => {
        const ctx = contexts.get(guildId);
        return ctx ? buildSnapshot(guildId, dateKey, ctx) : null;
      })
      .filter((s): s is ComputedSnapshot => s !== null);

    await persistSnapshots(snapshots);

    logger.info(
      'Pulse',
      `${snapshots.length} snapshots calculés pour ${dateKey} en ${Date.now() - started}ms`,
    );
  } catch (error) {
    logger.error('Pulse', `Erreur lors du calcul groupé du pulse (${dateKey}):`, error);
  }
}

function toView(snapshot: {
  dateKey: string;
  score: number;
  activityScore: number;
  moderationScore: number;
  growthScore: number;
  engagementScore: number;
  healthScore: number;
  trend: string;
  trendDelta: number;
  alerts: unknown;
}, partial: boolean): PulseSnapshotView {
  return {
    dateKey: snapshot.dateKey,
    score: snapshot.score,
    activityScore: snapshot.activityScore,
    moderationScore: snapshot.moderationScore,
    growthScore: snapshot.growthScore,
    engagementScore: snapshot.engagementScore,
    healthScore: snapshot.healthScore,
    trend: snapshot.trend,
    trendDelta: snapshot.trendDelta,
    alerts: Array.isArray(snapshot.alerts) ? (snapshot.alerts as PulseAlert[]) : [],
    partial,
  };
}

/**
 * Données du dashboard Pulse.
 *
 * `current` est le dernier jour **complet** enregistré ; `today` est un aperçu du
 * jour en cours recalculé à la volée (donc partiel, non persisté).
 */
export async function getPulseDashboardData(guildId: string): Promise<PulseData> {
  const history = await prismaRead.pulseSnapshot.findMany({
    where: { guildId },
    orderBy: { dateKey: 'desc' },
    take: HISTORY_DAYS,
    select: {
      dateKey: true,
      score: true,
      activityScore: true,
      moderationScore: true,
      growthScore: true,
      engagementScore: true,
      healthScore: true,
      trend: true,
      trendDelta: true,
      alerts: true,
      totalMessages: true,
      totalVoiceMinutes: true,
      activeMembers: true,
      totalMembers: true,
      membersJoined: true,
      membersLeft: true,
      sanctionsCount: true,
      ticketsResolved: true,
      ticketsOpen: true,
      channelsHealthy: true,
      channelsUnhealthy: true,
    },
  });

  const latest = history[0] ?? null;

  if (!latest) {
    return {
      hasData: false,
      current: {
        dateKey: lastCompleteDateKey(),
        score: 0,
        activityScore: 0,
        moderationScore: 0,
        growthScore: 0,
        engagementScore: 0,
        healthScore: 0,
        trend: 'STABLE',
        trendDelta: 0,
        alerts: [],
        partial: false,
      },
      today: null,
      history: [],
      metrics: { ...EMPTY_METRICS },
    };
  }

  const todayKey = toDateKey();

  return {
    hasData: true,
    current: toView(latest, latest.dateKey === todayKey),
    today: null,
    history: history
      .slice()
      .reverse()
      .map((s) => ({
        dateKey: s.dateKey,
        score: s.score,
        activityScore: s.activityScore,
        moderationScore: s.moderationScore,
        growthScore: s.growthScore,
        engagementScore: s.engagementScore,
        healthScore: s.healthScore,
      })),
    metrics: {
      totalMessages: latest.totalMessages,
      totalVoiceMinutes: latest.totalVoiceMinutes,
      activeMembers: latest.activeMembers,
      totalMembers: latest.totalMembers,
      membersJoined: latest.membersJoined,
      membersLeft: latest.membersLeft,
      sanctionsCount: latest.sanctionsCount,
      ticketsResolved: latest.ticketsResolved,
      ticketsOpen: latest.ticketsOpen,
      channelsHealthy: latest.channelsHealthy,
      channelsUnhealthy: latest.channelsUnhealthy,
    },
  };
}

/**
 * Variante enrichie : ajoute l'aperçu (non persisté) du jour en cours.
 * Utilisée par le dashboard, qui affiche « aujourd'hui, en cours » à côté du
 * dernier jour consolidé.
 */
export async function getPulseDashboardDataWithToday(
  client: Client,
  guildId: string,
): Promise<PulseData> {
  const todayKey = toDateKey();
  const [base, contexts] = await Promise.all([
    getPulseDashboardData(guildId),
    loadPulseContexts(client, [guildId], todayKey),
  ]);

  const ctx = contexts.get(guildId);
  if (!ctx) return base;

  const snapshot = buildSnapshot(guildId, todayKey, ctx);
  const hasSignal = snapshot.metrics.totalMessages > 0 || snapshot.metrics.totalVoiceMinutes > 0;
  if (!hasSignal) return base;

  return {
    ...base,
    hasData: true,
    today: {
      ...toView(
        {
          ...snapshot.scores,
          dateKey: todayKey,
          // Une journée entamée sera toujours « en baisse » face à une journée
          // entière : afficher cette tendance ferait croire chaque matin à un
          // effondrement. La comparaison n'a de sens qu'entre jours complets,
          // c'est `current.trend` qui la porte.
          trend: 'STABLE',
          trendDelta: 0,
          // Même raison pour les alertes : à 9 h du matin, « activité très
          // faible » est un artefact de l'heure, pas un diagnostic.
          alerts: [],
        },
        true,
      ),
      metrics: snapshot.metrics,
    },
  };
}
