-- Interactions entre membres (réponses, mentions) et temps de réponse par salon.
-- Compteurs uniquement, jamais de contenu.
CREATE TABLE IF NOT EXISTS "member_interaction_daily_stats" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "mentions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "member_interaction_daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "member_interaction_daily_stats_guildId_dateKey_userId_targetUserId_key"
    ON "member_interaction_daily_stats"("guildId", "dateKey", "userId", "targetUserId");
CREATE INDEX IF NOT EXISTS "member_interaction_daily_stats_guildId_dateKey_idx"
    ON "member_interaction_daily_stats"("guildId", "dateKey");

DO $$ BEGIN
    ALTER TABLE "member_interaction_daily_stats" ADD CONSTRAINT "member_interaction_daily_stats_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "channel_response_daily_stats" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "answered" INTEGER NOT NULL DEFAULT 0,
    "unanswered" INTEGER NOT NULL DEFAULT 0,
    "delaySumSec" INTEGER NOT NULL DEFAULT 0,
    "under1m" INTEGER NOT NULL DEFAULT 0,
    "under5m" INTEGER NOT NULL DEFAULT 0,
    "under15m" INTEGER NOT NULL DEFAULT 0,
    "under1h" INTEGER NOT NULL DEFAULT 0,
    "under6h" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "channel_response_daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_response_daily_stats_guildId_dateKey_channelId_key"
    ON "channel_response_daily_stats"("guildId", "dateKey", "channelId");
CREATE INDEX IF NOT EXISTS "channel_response_daily_stats_guildId_dateKey_idx"
    ON "channel_response_daily_stats"("guildId", "dateKey");

DO $$ BEGIN
    ALTER TABLE "channel_response_daily_stats" ADD CONSTRAINT "channel_response_daily_stats_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
