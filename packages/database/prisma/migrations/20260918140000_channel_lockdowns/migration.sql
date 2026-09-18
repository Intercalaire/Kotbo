-- CreateTable
CREATE TABLE IF NOT EXISTS "channel_lockdowns" (
  "guildId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "everyoneWas" JSONB NOT NULL,
  "botWas" JSONB,
  "reason" TEXT,
  "lockedById" TEXT NOT NULL,
  "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "channel_lockdowns_pkey" PRIMARY KEY ("guildId", "channelId")
);

ALTER TABLE "channel_lockdowns"
  DROP CONSTRAINT IF EXISTS "channel_lockdowns_guildId_fkey";
ALTER TABLE "channel_lockdowns"
  ADD CONSTRAINT "channel_lockdowns_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
