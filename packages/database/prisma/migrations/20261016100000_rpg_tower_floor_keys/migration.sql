-- La Tour : empreinte de la carte de chaque étage atteint, pour les statistiques par carte.
ALTER TABLE "rpg_tower_runs" ADD COLUMN "floorKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
