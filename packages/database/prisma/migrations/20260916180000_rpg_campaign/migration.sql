-- Campagne : une etape active a la fois, decrite par chapitre + index.
-- Le contenu reste cote bot, seule la progression est stockee.
CREATE TABLE IF NOT EXISTS "rpg_campaign_progress" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "stepIndex" INTEGER NOT NULL DEFAULT 0,
  "counter" INTEGER NOT NULL DEFAULT 0,
  "completedChapters" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rpg_campaign_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rpg_campaign_progress_guildId_userId_key"
  ON "rpg_campaign_progress"("guildId", "userId");
CREATE INDEX IF NOT EXISTS "rpg_campaign_progress_guildId_idx"
  ON "rpg_campaign_progress"("guildId");

ALTER TABLE "rpg_campaign_progress" DROP CONSTRAINT IF EXISTS "rpg_campaign_progress_guildId_fkey";
ALTER TABLE "rpg_campaign_progress"
  ADD CONSTRAINT "rpg_campaign_progress_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
