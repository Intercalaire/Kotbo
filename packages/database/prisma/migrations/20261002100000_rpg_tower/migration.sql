-- La Tour : mode roguelite du RPG, avec son profil, ses parties et ses récompenses.
CREATE TABLE "rpg_tower_configs" (
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL DEFAULT 'La Tour',
    "emoji" TEXT NOT NULL DEFAULT '🗼',
    "description" TEXT NOT NULL DEFAULT '',
    "entryMode" TEXT NOT NULL DEFAULT 'COMPRESSED',
    "inheritCapPercent" INTEGER NOT NULL DEFAULT 50,
    "titleCapPercent" INTEGER NOT NULL DEFAULT 30,
    "floorGrowthPercent" INTEGER NOT NULL DEFAULT 8,
    "bossEvery" INTEGER NOT NULL DEFAULT 10,
    "blessingEvery" INTEGER NOT NULL DEFAULT 5,
    "maxBlessings" INTEGER NOT NULL DEFAULT 6,
    "shardsPerFloor" INTEGER NOT NULL DEFAULT 2,
    "deathShardPercent" INTEGER NOT NULL DEFAULT 50,
    "weeklyShardCap" INTEGER NOT NULL DEFAULT 0,
    "idleTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "currencyName" TEXT NOT NULL DEFAULT 'Éclats de Tour',
    "currencyEmoji" TEXT NOT NULL DEFAULT '💠',
    "layoutEnabled" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB,
    "seasonStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpg_tower_configs_pkey" PRIMARY KEY ("guildId")
);

ALTER TABLE "rpg_tower_configs" ADD CONSTRAINT "rpg_tower_configs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "rpg_tower_rewards" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "emoji" TEXT NOT NULL DEFAULT '🎁',
    "price" INTEGER NOT NULL DEFAULT 0,
    "floor" INTEGER NOT NULL DEFAULT 0,
    "repeatable" BOOLEAN NOT NULL DEFAULT false,
    "titleId" TEXT,
    "roleId" TEXT,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "clanPoints" INTEGER NOT NULL DEFAULT 0,
    "itemName" TEXT,
    "shards" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpg_tower_rewards_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rpg_tower_rewards_guildId_kind_idx" ON "rpg_tower_rewards"("guildId", "kind");

ALTER TABLE "rpg_tower_rewards" ADD CONSTRAINT "rpg_tower_rewards_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "rpg_tower_profiles" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shards" INTEGER NOT NULL DEFAULT 0,
    "lifetimeShards" INTEGER NOT NULL DEFAULT 0,
    "bestFloor" INTEGER NOT NULL DEFAULT 0,
    "bestFloorAt" TIMESTAMP(3),
    "bestFloorAllTime" INTEGER NOT NULL DEFAULT 0,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "weekShards" INTEGER NOT NULL DEFAULT 0,
    "weekStart" TIMESTAMP(3),
    "upgrades" JSONB NOT NULL DEFAULT '{}',
    "claimedRewardIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpg_tower_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rpg_tower_profiles_guildId_userId_key" ON "rpg_tower_profiles"("guildId", "userId");
CREATE INDEX "rpg_tower_profiles_guildId_bestFloor_idx" ON "rpg_tower_profiles"("guildId", "bestFloor");

ALTER TABLE "rpg_tower_profiles" ADD CONSTRAINT "rpg_tower_profiles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "rpg_tower_runs" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "floor" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,
    "shardsEarned" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "rpg_tower_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rpg_tower_runs_profileId_status_idx" ON "rpg_tower_runs"("profileId", "status");
CREATE INDEX "rpg_tower_runs_guildId_userId_status_idx" ON "rpg_tower_runs"("guildId", "userId", "status");

ALTER TABLE "rpg_tower_runs" ADD CONSTRAINT "rpg_tower_runs_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "rpg_tower_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
