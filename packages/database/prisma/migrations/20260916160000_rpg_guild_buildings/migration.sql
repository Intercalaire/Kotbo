-- Village de guilde : chaque batiment ameliore quelque chose pour tous les membres.
-- Le catalogue reste cote bot, seule la progression est stockee.
CREATE TABLE IF NOT EXISTS "rpg_guild_buildings" (
  "id" TEXT NOT NULL,
  "rpgGuildId" TEXT NOT NULL,
  "buildingId" TEXT NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rpg_guild_buildings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rpg_guild_buildings_rpgGuildId_buildingId_key"
  ON "rpg_guild_buildings"("rpgGuildId", "buildingId");
CREATE INDEX IF NOT EXISTS "rpg_guild_buildings_rpgGuildId_idx"
  ON "rpg_guild_buildings"("rpgGuildId");

ALTER TABLE "rpg_guild_buildings"
  DROP CONSTRAINT IF EXISTS "rpg_guild_buildings_rpgGuildId_fkey";
ALTER TABLE "rpg_guild_buildings"
  ADD CONSTRAINT "rpg_guild_buildings_rpgGuildId_fkey"
  FOREIGN KEY ("rpgGuildId") REFERENCES "rpg_guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
