-- Rébus emoji écrits par le staff, et choix d'y mêler ceux fournis avec Kotbo.
ALTER TABLE "guilds"
  ADD COLUMN IF NOT EXISTS "funEmojiRiddleUseDefaults" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "fun_emoji_riddles" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "emojis" TEXT NOT NULL,
  "answers" TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fun_emoji_riddles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fun_emoji_riddles_guildId_idx"
  ON "fun_emoji_riddles"("guildId");

ALTER TABLE "fun_emoji_riddles"
  DROP CONSTRAINT IF EXISTS "fun_emoji_riddles_guildId_fkey";
ALTER TABLE "fun_emoji_riddles"
  ADD CONSTRAINT "fun_emoji_riddles_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
