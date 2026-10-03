-- La Tour : salles piégées rencontrées par chaque joueur, dévoilées dans son guide des salles.
ALTER TABLE "rpg_tower_profiles" ADD COLUMN "discoveredRooms" TEXT[] DEFAULT ARRAY[]::TEXT[];
