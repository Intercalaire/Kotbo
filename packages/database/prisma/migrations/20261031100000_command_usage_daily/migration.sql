-- Usage des commandes slash par jour, commande et membre.
CREATE TABLE IF NOT EXISTS "command_usage_daily_stats" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "command_usage_daily_stats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "command_usage_daily_stats_guildId_dateKey_commandName_userId_key"
    ON "command_usage_daily_stats"("guildId", "dateKey", "commandName", "userId");
CREATE INDEX IF NOT EXISTS "command_usage_daily_stats_guildId_dateKey_idx"
    ON "command_usage_daily_stats"("guildId", "dateKey");
DO $$ BEGIN
    ALTER TABLE "command_usage_daily_stats" ADD CONSTRAINT "command_usage_daily_stats_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
