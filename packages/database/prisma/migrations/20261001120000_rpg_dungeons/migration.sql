-- Donjons du serveur : une suite de boss du bestiaire à enchaîner.
CREATE TABLE "rpg_dungeons" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "emoji" TEXT NOT NULL DEFAULT '🏰',
    "levelRequired" INTEGER NOT NULL DEFAULT 1,
    "energyCost" INTEGER NOT NULL DEFAULT 40,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "bossNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "completionCoins" INTEGER NOT NULL DEFAULT 0,
    "completionXp" INTEGER NOT NULL DEFAULT 0,
    "completionItemName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpg_dungeons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rpg_dungeons_guildId_name_key" ON "rpg_dungeons"("guildId", "name");

ALTER TABLE "rpg_dungeons" ADD CONSTRAINT "rpg_dungeons_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Parties des joueurs, avec le butin en attente jusqu'à la sortie.
CREATE TABLE "rpg_dungeon_runs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dungeonId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "bossNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "floorsCleared" INTEGER NOT NULL DEFAULT 0,
    "xpEarned" INTEGER NOT NULL DEFAULT 0,
    "coinsEarned" INTEGER NOT NULL DEFAULT 0,
    "loot" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "rpg_dungeon_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rpg_dungeon_runs_guildId_userId_status_idx" ON "rpg_dungeon_runs"("guildId", "userId", "status");
CREATE INDEX "rpg_dungeon_runs_dungeonId_userId_startedAt_idx" ON "rpg_dungeon_runs"("dungeonId", "userId", "startedAt");

ALTER TABLE "rpg_dungeon_runs" ADD CONSTRAINT "rpg_dungeon_runs_dungeonId_fkey" FOREIGN KEY ("dungeonId") REFERENCES "rpg_dungeons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rpg_dungeon_runs" ADD CONSTRAINT "rpg_dungeon_runs_guildId_userId_fkey" FOREIGN KEY ("guildId", "userId") REFERENCES "rpg_profiles"("guildId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
