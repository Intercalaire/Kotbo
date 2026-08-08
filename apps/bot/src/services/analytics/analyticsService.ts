import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { isAnalyticsCollectionEnabled } from './analyticsConsent.js';

/**
 * Helper to get the date string (YYYY-MM-DD) in a specific timezone or UTC
 */
export const getDateKey = (date: Date = new Date()): string => {
  return date.toISOString().split('T')[0];
};

/**
 * Helper to get the current hour (0-23)
 */
export const getHourKey = (date: Date = new Date()): number => {
  return date.getUTCHours();
};

// ============================================================================
// IN-MEMORY BUFFER MAPS
// ============================================================================

const guildDailyStatsBuffer = new Map<string, {
  messagesCount?: number;
  voiceMinutes?: number;
  voiceSessionsCount?: number;
  membersJoined?: number;
  membersLeft?: number;
  reactionsCount?: number;
}>();

const guildHourlyStatsBuffer = new Map<string, {
  messagesCount?: number;
  voiceMinutes?: number;
  joinsCount?: number;
  leavesCount?: number;
  reactionsCount?: number;
  threadsCount?: number;
}>();

const channelDailyStatsBuffer = new Map<string, {
  messagesCount?: number;
  voiceMinutes?: number;
}>();

const memberDailyStatsBuffer = new Map<string, {
  messagesCount?: number;
  voiceMinutes?: number;
  reactionsCount?: number;
  threadsCreated?: number;
  repliesCount?: number;
}>();

const channelDailyAuthors = new Map<string, Set<string>>();

// ============================================================================
// BUFFERING HELPERS
// ============================================================================

function queueGuildDaily(guildId: string, dateKey: string, increments: Record<string, number>) {
  const key = `${guildId}:${dateKey}`;
  const existing = guildDailyStatsBuffer.get(key) || {};
  for (const [col, val] of Object.entries(increments)) {
    const counters = existing as Record<string, number>;
    counters[col] = (counters[col] || 0) + val;
  }
  guildDailyStatsBuffer.set(key, existing);
}

function queueGuildHourly(guildId: string, dateKey: string, hour: number, increments: Record<string, number>) {
  const key = `${guildId}:${dateKey}:${hour}`;
  const existing = guildHourlyStatsBuffer.get(key) || {};
  for (const [col, val] of Object.entries(increments)) {
    const counters = existing as Record<string, number>;
    counters[col] = (counters[col] || 0) + val;
  }
  guildHourlyStatsBuffer.set(key, existing);
}

function queueChannelDaily(guildId: string, channelId: string, dateKey: string, increments: Record<string, number>) {
  const key = `${guildId}:${channelId}:${dateKey}`;
  const existing = channelDailyStatsBuffer.get(key) || {};
  for (const [col, val] of Object.entries(increments)) {
    const counters = existing as Record<string, number>;
    counters[col] = (counters[col] || 0) + val;
  }
  channelDailyStatsBuffer.set(key, existing);
}

function queueMemberDaily(guildId: string, userId: string, dateKey: string, increments: Record<string, number>) {
  const key = `${guildId}:${userId}:${dateKey}`;
  const existing = memberDailyStatsBuffer.get(key) || {};
  for (const [col, val] of Object.entries(increments)) {
    const counters = existing as Record<string, number>;
    counters[col] = (counters[col] || 0) + val;
  }
  memberDailyStatsBuffer.set(key, existing);
}

// ============================================================================
// FLUSH PROCESSORS
// ============================================================================

async function flushGuildDailyStats(): Promise<void> {
  const entries = [...guildDailyStatsBuffer.entries()];
  guildDailyStatsBuffer.clear();

  const ops = entries.map(([key, data]) => {
    const [guildId, dateKey] = key.split(':');
    if (!guildId || !dateKey) return null;

    const updateData: Record<string, unknown> = {};
    const createData: Record<string, unknown> = { guildId, dateKey };

    for (const [col, val] of Object.entries(data)) {
      if (val !== undefined && val !== 0) {
        updateData[col] = { increment: val };
        createData[col] = val;
      }
    }

    if (Object.keys(updateData).length === 0) return null;

    return prisma.guildDailyStat.upsert({
      where: { guildId_dateKey: { guildId, dateKey } },
      update: updateData as never,
      create: createData as never,
    });
  }).filter((op) => op !== null);

  if (ops.length > 0) {
    await prisma.$transaction(ops).catch((error) => {
      logger.error('Analytics', 'Error flushing GuildDailyStats batch:', error);
    });
  }
}

async function flushGuildHourlyStats(): Promise<void> {
  const entries = [...guildHourlyStatsBuffer.entries()];
  guildHourlyStatsBuffer.clear();

  const ops = entries.map(([key, data]) => {
    const [guildId, dateKey, hourStr] = key.split(':');
    if (!guildId || !dateKey || !hourStr) return null;
    const hour = parseInt(hourStr, 10);

    const updateData: Record<string, unknown> = {};
    const createData: Record<string, unknown> = { guildId, dateKey, hour };

    for (const [col, val] of Object.entries(data)) {
      if (val !== undefined && val !== 0) {
        updateData[col] = { increment: val };
        createData[col] = val;
      }
    }

    if (Object.keys(updateData).length === 0) return null;

    return prisma.guildHourlyStat.upsert({
      where: { guildId_dateKey_hour: { guildId, dateKey, hour } },
      update: updateData as never,
      create: createData as never,
    });
  }).filter((op) => op !== null);

  if (ops.length > 0) {
    await prisma.$transaction(ops).catch((error) => {
      logger.error('Analytics', 'Error flushing GuildHourlyStats batch:', error);
    });
  }
}

async function flushChannelDailyStats(): Promise<void> {
  const currentDateKey = getDateKey();
  for (const key of channelDailyAuthors.keys()) {
    if (!key.endsWith(currentDateKey)) {
      channelDailyAuthors.delete(key);
    }
  }

  const entries = [...channelDailyStatsBuffer.entries()];
  channelDailyStatsBuffer.clear();

  const ops = entries.map(([key, data]) => {
    const [guildId, channelId, dateKey] = key.split(':');
    if (!guildId || !channelId || !dateKey) return null;

    const count = data.messagesCount || 0;
    const voiceMins = data.voiceMinutes || 0;
    const authorsSet = channelDailyAuthors.get(key);
    const uniqueCount = authorsSet ? authorsSet.size : 0;

    const updateData: Record<string, unknown> = {};
    const createData: Record<string, unknown> = { guildId, channelId, dateKey };

    if (count > 0) {
      updateData.messagesCount = { increment: count };
      createData.messagesCount = count;
    }
    if (uniqueCount > 0) {
      updateData.uniqueAuthors = uniqueCount;
      createData.uniqueAuthors = uniqueCount;
    }
    if (voiceMins > 0) {
      updateData.voiceMinutes = { increment: voiceMins };
      createData.voiceMinutes = voiceMins;
    }

    if (Object.keys(updateData).length === 0) return null;

    return prisma.channelDailyStat.upsert({
      where: { guildId_channelId_dateKey: { guildId, channelId, dateKey } },
      create: createData as never,
      update: updateData as never,
    });
  }).filter((op) => op !== null);

  if (ops.length > 0) {
    await prisma.$transaction(ops).catch((error) => {
      logger.error('Analytics', 'Error flushing ChannelDailyStats batch:', error);
    });
  }
}

async function flushMemberDailyStats(): Promise<void> {
  const entries = [...memberDailyStatsBuffer.entries()];
  memberDailyStatsBuffer.clear();

  // Member stats can have many entries - batch in chunks of 50 to avoid
  // transaction timeouts on large guilds
  const BATCH_SIZE = 50;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE);

    const ops = chunk.map(([key, data]) => {
      const [guildId, userId, dateKey] = key.split(':');
      if (!guildId || !userId || !dateKey) return null;

      const updateData: Record<string, unknown> = {};
      const createData: Record<string, unknown> = { guildId, userId, dateKey };

      for (const [col, val] of Object.entries(data)) {
        if (val !== undefined && val !== 0) {
          updateData[col] = { increment: val };
          createData[col] = val;
        }
      }

      if (Object.keys(updateData).length === 0) return null;

      return prisma.memberDailyStat.upsert({
        where: { guildId_userId_dateKey: { guildId, userId, dateKey } },
        update: updateData as never,
        create: createData as never,
      });
    }).filter((op) => op !== null);

    if (ops.length > 0) {
      await prisma.$transaction(ops).catch((error) => {
        logger.error('Analytics', `Error flushing MemberDailyStats batch (offset ${i}):`, error);
      });
    }
  }
}

export async function flushAllAnalyticsStats(): Promise<void> {
  await Promise.all([
    flushGuildDailyStats(),
    flushGuildHourlyStats(),
    flushChannelDailyStats(),
    flushMemberDailyStats(),
  ]);
}

// Background flush interval
const flushInterval = setInterval(() => {
  void flushAllAnalyticsStats();
}, 10000);

// Final flush on process exit
process.on('beforeExit', () => {
  clearInterval(flushInterval);
  void flushAllAnalyticsStats();
});

// ============================================================================
// SERVICE EXPORTS (BUFFERED API)
// ============================================================================

/**
 * Increment message counts in analytics tables
 */
export const trackMessage = async (guildId: string, channelId: string, userId: string) => {
  if (!(await isAnalyticsCollectionEnabled(guildId))) return;

  const dateKey = getDateKey();
  const hour = getHourKey();

  // 1. Queue Guild Daily Stat
  queueGuildDaily(guildId, dateKey, { messagesCount: 1 });

  // 2. Queue Guild Hourly Stat
  queueGuildHourly(guildId, dateKey, hour, { messagesCount: 1 });

  // 3. Queue Channel Daily Stat
  queueChannelDaily(guildId, channelId, dateKey, { messagesCount: 1 });

  // Track unique author
  const authorsKey = `${guildId}:${channelId}:${dateKey}`;
  let authorsSet = channelDailyAuthors.get(authorsKey);
  if (!authorsSet) {
    authorsSet = new Set<string>();
    channelDailyAuthors.set(authorsKey, authorsSet);
  }
  authorsSet.add(userId);

  // 4. Queue Member Daily Stat
  queueMemberDaily(guildId, userId, dateKey, { messagesCount: 1 });
};

/**
 * Increment voice minutes in analytics tables
 */
export const trackVoiceSession = async (guildId: string, userId: string, durationMinutes: number, channelId?: string) => {
  if (durationMinutes <= 0) return;
  if (!(await isAnalyticsCollectionEnabled(guildId))) return;

  const dateKey = getDateKey();
  const hour = getHourKey();

  queueGuildDaily(guildId, dateKey, {
    voiceMinutes: durationMinutes,
    voiceSessionsCount: 1
  });

  queueGuildHourly(guildId, dateKey, hour, {
    voiceMinutes: durationMinutes
  });

  queueMemberDaily(guildId, userId, dateKey, {
    voiceMinutes: durationMinutes
  });

  if (channelId) {
    queueChannelDaily(guildId, channelId, dateKey, {
      voiceMinutes: durationMinutes
    });
  }
};

/**
 * Record a member join
 */
export const trackMemberJoin = async (guildId: string) => {
  if (!(await isAnalyticsCollectionEnabled(guildId))) return;

  const dateKey = getDateKey();
  const hour = getHourKey();

  queueGuildDaily(guildId, dateKey, { membersJoined: 1 });
  queueGuildHourly(guildId, dateKey, hour, { joinsCount: 1 });
};

/**
 * Record a member leave
 */
export const trackMemberLeave = async (guildId: string) => {
  if (!(await isAnalyticsCollectionEnabled(guildId))) return;

  const dateKey = getDateKey();
  const hour = getHourKey();

  queueGuildDaily(guildId, dateKey, { membersLeft: 1 });
  queueGuildHourly(guildId, dateKey, hour, { leavesCount: 1 });
};

/**
 * Track message reactions
 */
export const trackReaction = async (guildId: string, userId: string) => {
  if (!(await isAnalyticsCollectionEnabled(guildId))) return;

  const dateKey = getDateKey();
  const hour = getHourKey();

  queueGuildDaily(guildId, dateKey, { reactionsCount: 1 });
  queueGuildHourly(guildId, dateKey, hour, { reactionsCount: 1 });
  queueMemberDaily(guildId, userId, dateKey, { reactionsCount: 1 });
};

/**
 * Track thread creation
 */
export const trackThreadCreation = async (guildId: string, userId: string) => {
  if (!(await isAnalyticsCollectionEnabled(guildId))) return;

  const dateKey = getDateKey();
  const hour = getHourKey();

  queueGuildHourly(guildId, dateKey, hour, { threadsCount: 1 });
  queueMemberDaily(guildId, userId, dateKey, { threadsCreated: 1 });
};

/**
 * Track message reply
 */
export const trackReply = async (guildId: string, userId: string) => {
  if (!(await isAnalyticsCollectionEnabled(guildId))) return;

  const dateKey = getDateKey();

  queueMemberDaily(guildId, userId, dateKey, { repliesCount: 1 });
};

/**
 * Snapshot server population (total members, online, offline, bots vs humans)
 */
export const snapshotServerPopulation = async (
  guildId: string, 
  stats: {
    totalMembers: number;
    onlineMembers: number;
    idleMembers: number;
    dndMembers: number;
    offlineMembers: number;
    totalBots: number;
    totalHumans: number;
    activeMembers?: number;
    activeVoiceMembers?: number;
  }
) => {
  if (!(await isAnalyticsCollectionEnabled(guildId))) return;

  const dateKey = getDateKey();

  const optionalFields = {
    ...(stats.activeMembers !== undefined ? { activeMembers: stats.activeMembers } : {}),
    ...(stats.activeVoiceMembers !== undefined ? { activeVoiceMembers: stats.activeVoiceMembers } : {}),
  };

  const populationData = {
    totalMembers: stats.totalMembers,
    onlineMembers: stats.onlineMembers,
    idleMembers: stats.idleMembers,
    dndMembers: stats.dndMembers,
    offlineMembers: stats.offlineMembers,
    totalBots: stats.totalBots,
    totalHumans: stats.totalHumans,
    ...optionalFields,
  };

  const hour = getHourKey();

  const [daily] = await Promise.all([
    prisma.guildDailyStat.upsert({
      where: { guildId_dateKey: { guildId, dateKey } },
      update: populationData,
      create: { guildId, dateKey, ...populationData },
    }),
    prisma.guildHourlyStat.upsert({
      where: { guildId_dateKey_hour: { guildId, dateKey, hour } },
      update: { onlineMembers: stats.onlineMembers },
      create: { guildId, dateKey, hour, onlineMembers: stats.onlineMembers },
    }),
  ]);

  if (stats.onlineMembers > daily.peakOnline) {
    await prisma.guildDailyStat.update({
      where: { id: daily.id },
      data: { peakOnline: stats.onlineMembers },
    });
  }
};
