-- Reprise idempotente du sticky bot et du scan de tag/presence, pour les bases
-- deja en production ou l'historique de migration a diverge.

CREATE TABLE IF NOT EXISTS "sticky_messages" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "content" TEXT NOT NULL DEFAULT '',
    "embedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "embedTitle" TEXT,
    "embedColor" TEXT NOT NULL DEFAULT '#5865F2',
    "messageThreshold" INTEGER NOT NULL DEFAULT 5,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 10,
    "lastMessageId" TEXT,
    "lastPostedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sticky_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sticky_messages_guildId_idx" ON "sticky_messages"("guildId");
CREATE UNIQUE INDEX IF NOT EXISTS "sticky_messages_guildId_channelId_key" ON "sticky_messages"("guildId", "channelId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sticky_messages_guildId_fkey'
  ) THEN
    ALTER TABLE "sticky_messages"
      ADD CONSTRAINT "sticky_messages_guildId_fkey"
      FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "welcome_configs" DROP COLUMN IF EXISTS "tagAutoRoleWord";

ALTER TABLE "welcome_configs"
    ADD COLUMN IF NOT EXISTS "statusScanEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "statusScanKeyword" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "statusScanRoleId" TEXT,
    ADD COLUMN IF NOT EXISTS "statusScanScope" TEXT NOT NULL DEFAULT 'STATUS';
