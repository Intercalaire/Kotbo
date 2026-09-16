-- Arbre de compétences : points à dépenser sur le profil, nœuds achetés dans leur table.
-- L'arbre lui-même reste du contenu statique côté bot ; seule la progression est stockée.
ALTER TABLE "rpg_profiles"
  ADD COLUMN IF NOT EXISTS "skillPoints" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "rpg_skill_unlocks" (
  "id" TEXT NOT NULL,
  "rpgProfileId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rpg_skill_unlocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rpg_skill_unlocks_rpgProfileId_nodeId_key"
  ON "rpg_skill_unlocks"("rpgProfileId", "nodeId");
CREATE INDEX IF NOT EXISTS "rpg_skill_unlocks_rpgProfileId_idx"
  ON "rpg_skill_unlocks"("rpgProfileId");

ALTER TABLE "rpg_skill_unlocks"
  DROP CONSTRAINT IF EXISTS "rpg_skill_unlocks_rpgProfileId_fkey";
ALTER TABLE "rpg_skill_unlocks"
  ADD CONSTRAINT "rpg_skill_unlocks_rpgProfileId_fkey"
  FOREIGN KEY ("rpgProfileId") REFERENCES "rpg_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
