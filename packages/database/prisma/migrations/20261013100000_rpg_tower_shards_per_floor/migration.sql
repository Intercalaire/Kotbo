-- La Tour : les éclats tombent à l'étage gravi et non plus à chaque salle. Le défaut passe de
-- 2 à 10 pour garder des gains comparables ; les serveurs restés sur l'ancien défaut suivent.
ALTER TABLE "rpg_tower_configs" ALTER COLUMN "shardsPerFloor" SET DEFAULT 10;
UPDATE "rpg_tower_configs" SET "shardsPerFloor" = 10 WHERE "shardsPerFloor" = 2;
