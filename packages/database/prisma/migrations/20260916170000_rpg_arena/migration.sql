-- Arene PvP : un classement par joueur, un journal par duel.
-- Le defenseur n'est pas connecte quand le duel a lieu : le journal est le seul
-- moyen pour lui d'apprendre qu'il a ete attaque, et par qui.
CREATE TABLE IF NOT EXISTS "rpg_arena_records" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL DEFAULT 1000,
  "bestRating" INTEGER NOT NULL DEFAULT 1000,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "streak" INTEGER NOT NULL DEFAULT 0,
  "lastMatchAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rpg_arena_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rpg_arena_records_guildId_userId_key"
  ON "rpg_arena_records"("guildId", "userId");
CREATE INDEX IF NOT EXISTS "rpg_arena_records_guildId_rating_idx"
  ON "rpg_arena_records"("guildId", "rating");

CREATE TABLE IF NOT EXISTS "rpg_arena_matches" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "challengerId" TEXT NOT NULL,
  "opponentId" TEXT NOT NULL,
  "winnerId" TEXT NOT NULL,
  "ratingChange" INTEGER NOT NULL DEFAULT 0,
  "challengerRatingAfter" INTEGER NOT NULL DEFAULT 0,
  "opponentRatingAfter" INTEGER NOT NULL DEFAULT 0,
  "coinsAwarded" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rpg_arena_matches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rpg_arena_matches_guildId_createdAt_idx"
  ON "rpg_arena_matches"("guildId", "createdAt");
CREATE INDEX IF NOT EXISTS "rpg_arena_matches_guildId_opponentId_createdAt_idx"
  ON "rpg_arena_matches"("guildId", "opponentId", "createdAt");

ALTER TABLE "rpg_arena_records" DROP CONSTRAINT IF EXISTS "rpg_arena_records_guildId_fkey";
ALTER TABLE "rpg_arena_records"
  ADD CONSTRAINT "rpg_arena_records_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rpg_arena_matches" DROP CONSTRAINT IF EXISTS "rpg_arena_matches_guildId_fkey";
ALTER TABLE "rpg_arena_matches"
  ADD CONSTRAINT "rpg_arena_matches_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
