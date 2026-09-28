-- La Tour : étages générés, ascension du jour, annonces des records et statistiques des parties.
ALTER TABLE "rpg_tower_configs" ADD COLUMN "floorsAfter" TEXT NOT NULL DEFAULT 'GENERATE';
ALTER TABLE "rpg_tower_configs" ADD COLUMN "dailyEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "rpg_tower_configs" ADD COLUMN "announceChannelId" TEXT;

ALTER TABLE "rpg_tower_profiles" ADD COLUMN "bestRooms" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "rpg_tower_runs" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'CLASSIC';
ALTER TABLE "rpg_tower_runs" ADD COLUMN "dailyKey" TEXT;
ALTER TABLE "rpg_tower_runs" ADD COLUMN "floorsCleared" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_tower_runs" ADD COLUMN "roomsExplored" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_tower_runs" ADD COLUMN "killedBy" TEXT;
CREATE INDEX "rpg_tower_runs_guildId_mode_dailyKey_idx" ON "rpg_tower_runs"("guildId", "mode", "dailyKey");

-- Les parties déjà closes retrouvent leur nombre d'étages, pour l'étage moyen du dashboard.
UPDATE "rpg_tower_runs"
SET "floorsCleared" = GREATEST(0, COALESCE(("state"->>'floorsCleared')::int, 0))
WHERE "status" <> 'ACTIVE';

-- Une tour déjà dessinée garde sa boucle sur ses étages : générer au-delà se choisit au dashboard.
UPDATE "rpg_tower_configs" SET "floorsAfter" = 'LOOP' WHERE jsonb_array_length("layouts") > 0;
