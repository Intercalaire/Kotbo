-- Carte `/rank` : cadres, motifs, styles de barre, titres et badges de succès.
-- Les défauts reprennent le rendu d'avant cette migration, les cartes
-- existantes ne changent donc pas d'apparence.
ALTER TABLE "rank_card_preferences"
  ADD COLUMN IF NOT EXISTS "frameId" TEXT NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS "patternId" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "barStyleId" TEXT NOT NULL DEFAULT 'solid',
  ADD COLUMN IF NOT EXISTS "titleId" TEXT,
  ADD COLUMN IF NOT EXISTS "badges" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS "user_achievements" (
  "userId" TEXT NOT NULL,
  "achievementId" TEXT NOT NULL,
  "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("userId", "achievementId")
);

CREATE TABLE IF NOT EXISTS "rank_card_supporters" (
  "userId" TEXT NOT NULL,
  "streakStartedAt" TIMESTAMP(3) NOT NULL,
  "coveredUntil" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rank_card_supporters_pkey" PRIMARY KEY ("userId")
);

-- Les succès sont évalués par utilisateur, tous serveurs confondus : les index
-- existants commencent par "guildId" et ne servent pas à ces lectures.
CREATE INDEX IF NOT EXISTS "member_levels_userId_idx" ON "member_levels"("userId");
CREATE INDEX IF NOT EXISTS "reputation_votes_receiverId_idx" ON "reputation_votes"("receiverId");
CREATE INDEX IF NOT EXISTS "quest_progress_userId_status_idx" ON "quest_progress"("userId", "status");
CREATE INDEX IF NOT EXISTS "starboard_entries_authorId_idx" ON "starboard_entries"("authorId");
