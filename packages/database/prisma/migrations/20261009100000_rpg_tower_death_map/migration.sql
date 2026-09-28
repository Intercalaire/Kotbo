-- La Tour : salle de la mort et empreinte de son étage, pour la carte des morts du dashboard.
ALTER TABLE "rpg_tower_runs" ADD COLUMN "deathRoom" TEXT;
ALTER TABLE "rpg_tower_runs" ADD COLUMN "deathFloorKey" TEXT;
CREATE INDEX "rpg_tower_runs_guildId_deathFloorKey_idx" ON "rpg_tower_runs"("guildId", "deathFloorKey");
