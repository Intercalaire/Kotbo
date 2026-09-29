-- Tour de clan : une tour hebdomadaire que les clans du serveur gravissent chacun de leur côté.

ALTER TABLE "rpg_tower_runs" ADD COLUMN "clanEventId" TEXT;
ALTER TABLE "rpg_tower_runs" ADD COLUMN "clanId" TEXT;
CREATE INDEX "rpg_tower_runs_clanEventId_userId_idx" ON "rpg_tower_runs"("clanEventId", "userId");

CREATE TABLE "rpg_clan_tower_configs" (
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL DEFAULT 'Tour de clan',
    "layouts" JSONB NOT NULL DEFAULT '[]',
    "floorsAfter" TEXT NOT NULL DEFAULT 'GENERATE',
    "generatedFog" BOOLEAN NOT NULL DEFAULT true,
    "weekday" INTEGER NOT NULL DEFAULT 6,
    "hour" INTEGER NOT NULL DEFAULT 18,
    "durationHours" INTEGER NOT NULL DEFAULT 48,
    "pointsPerFloor" INTEGER NOT NULL DEFAULT 10,
    "podiumPoints" INTEGER[] DEFAULT ARRAY[150, 100, 50]::INTEGER[],
    "announceChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpg_clan_tower_configs_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "rpg_clan_tower_events" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "announcedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpg_clan_tower_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rpg_clan_tower_conquests" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "clanId" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "conqueredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpg_clan_tower_conquests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rpg_clan_tower_events_guildId_startsAt_key" ON "rpg_clan_tower_events"("guildId", "startsAt");
CREATE INDEX "rpg_clan_tower_events_guildId_status_idx" ON "rpg_clan_tower_events"("guildId", "status");
CREATE UNIQUE INDEX "rpg_clan_tower_conquests_eventId_clanId_floor_key" ON "rpg_clan_tower_conquests"("eventId", "clanId", "floor");
CREATE INDEX "rpg_clan_tower_conquests_eventId_clanId_idx" ON "rpg_clan_tower_conquests"("eventId", "clanId");

ALTER TABLE "rpg_clan_tower_configs" ADD CONSTRAINT "rpg_clan_tower_configs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rpg_clan_tower_events" ADD CONSTRAINT "rpg_clan_tower_events_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rpg_clan_tower_conquests" ADD CONSTRAINT "rpg_clan_tower_conquests_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "rpg_clan_tower_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
