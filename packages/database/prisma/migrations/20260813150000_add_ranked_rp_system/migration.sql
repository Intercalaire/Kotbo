-- CreateEnum
CREATE TYPE "RankedEventStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'ENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ranked_configs" (
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rpPerXp" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "reactionRp" INTEGER NOT NULL DEFAULT 2,
    "reactionDailyCap" INTEGER NOT NULL DEFAULT 15,
    "dailyRpCap" INTEGER NOT NULL DEFAULT 0,
    "streakEnabled" BOOLEAN NOT NULL DEFAULT true,
    "streakBonusPerDay" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "streakMaxBonus" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "streakGraceDays" INTEGER NOT NULL DEFAULT 1,
    "streakWeeklyFreezes" INTEGER NOT NULL DEFAULT 1,
    "streakMaxFreezes" INTEGER NOT NULL DEFAULT 2,
    "decayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "decayGraceDays" INTEGER NOT NULL DEFAULT 3,
    "decayRpPerDay" INTEGER NOT NULL DEFAULT 25,
    "decayPercentPerDay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "decayFloorTierKey" TEXT,
    "ladder" JSONB,
    "tierRolesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tierRolesExclusive" BOOLEAN NOT NULL DEFAULT true,
    "announceChannelId" TEXT,
    "announcePromotions" BOOLEAN NOT NULL DEFAULT true,
    "announceDemotions" BOOLEAN NOT NULL DEFAULT false,
    "globalLeaderboard" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ranked_configs_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "ranked_members" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rp" INTEGER NOT NULL DEFAULT 0,
    "peakRp" INTEGER NOT NULL DEFAULT 0,
    "tierKey" TEXT NOT NULL DEFAULT 'BRONZE_1',
    "previousTierKey" TEXT,
    "peakTierKey" TEXT,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" TEXT,
    "streakFreezes" INTEGER NOT NULL DEFAULT 0,
    "dailyRp" INTEGER NOT NULL DEFAULT 0,
    "dailyRpDate" TEXT,
    "dailyReactions" INTEGER NOT NULL DEFAULT 0,
    "lastDecayDate" TEXT,
    "totalRpEarned" INTEGER NOT NULL DEFAULT 0,
    "globalOptOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ranked_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranked_tier_roles" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "tierKey" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "ranked_tier_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranked_rp_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "rpAfter" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranked_rp_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranked_events" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "RankedEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "announceChannelId" TEXT,
    "announceMessageId" TEXT,
    "createdBy" TEXT,
    "bonusRpGranted" INTEGER NOT NULL DEFAULT 0,
    "participants" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ranked_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranked_season_entries" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rp" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "tierKey" TEXT NOT NULL DEFAULT 'BRONZE_1',
    "peakRp" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranked_season_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ranked_members_guildId_userId_key" ON "ranked_members"("guildId", "userId");

-- CreateIndex
CREATE INDEX "ranked_members_guildId_rp_idx" ON "ranked_members"("guildId", "rp");

-- CreateIndex
CREATE INDEX "ranked_members_guildId_streakDays_idx" ON "ranked_members"("guildId", "streakDays");

-- CreateIndex
CREATE INDEX "ranked_members_userId_idx" ON "ranked_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ranked_tier_roles_guildId_tierKey_key" ON "ranked_tier_roles"("guildId", "tierKey");

-- CreateIndex
CREATE INDEX "ranked_rp_logs_guildId_userId_createdAt_idx" ON "ranked_rp_logs"("guildId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "ranked_rp_logs_guildId_createdAt_idx" ON "ranked_rp_logs"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ranked_events_guildId_status_startsAt_idx" ON "ranked_events"("guildId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ranked_season_entries_seasonId_userId_key" ON "ranked_season_entries"("seasonId", "userId");

-- CreateIndex
CREATE INDEX "ranked_season_entries_guildId_seasonId_idx" ON "ranked_season_entries"("guildId", "seasonId");

-- CreateIndex
CREATE INDEX "ranked_season_entries_seasonId_rp_idx" ON "ranked_season_entries"("seasonId", "rp");

-- AddForeignKey
ALTER TABLE "ranked_configs" ADD CONSTRAINT "ranked_configs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranked_members" ADD CONSTRAINT "ranked_members_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranked_tier_roles" ADD CONSTRAINT "ranked_tier_roles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranked_rp_logs" ADD CONSTRAINT "ranked_rp_logs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranked_events" ADD CONSTRAINT "ranked_events_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranked_season_entries" ADD CONSTRAINT "ranked_season_entries_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranked_season_entries" ADD CONSTRAINT "ranked_season_entries_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "leveling_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
